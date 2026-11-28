/**
 * Which view the canvas shows, the office (as it starts) or the market, and how the camera frames each.
 *
 * Only the shown view's roots are drawn, and so can be picked: the core roots always (the lights, the highlights, the
 * effects), and then the market's root or the office's (every other child of the scene). The camera's framing, its
 * pan limits and the shadow frustum follow the shown view. The office's come from the layout of each scene applied
 * and are kept while the market shows, so going back restores them; the market's come from the market's layout.
 * Also here: where the market's buildings and bar are drawn on screen, for the labels over them.
 */
import type * as THREE from "three";
import { marketFrame } from "../market/marketLayout";
import type { MarketSystem } from "../market/MarketSystem";
import { computeBuildingFrame, type LayoutFrame } from "../office/framing";
import type { MarketScene, MarketScreenMarks, ScreenPoint, WorldViewKind } from "../types";
import type { CameraRig, GroundBounds } from "./CameraRig";
import { layoutBounds } from "./layoutBounds";
import type { Lighting } from "./Lighting";
import type { StagedFrame } from "./sceneFrames";

/** How far past the content the centre of the view may be dragged, in world units. */
const PAN_MARGIN = 1.5;
/**
 * Share of the viewport's binding dimension (height on a wide, short canvas,
 * width on a phone in portrait) the building fills at the default zoom. The
 * building is diamond-shaped on screen, so the corners the HUD sits in stay
 * clear even at this size.
 */
const FRAME_FILL = 0.85;

export interface WorldViewsDeps {
  readonly scene: THREE.Scene;
  readonly rig: CameraRig;
  /** Its shadow frustum follows the shown view's bounds. */
  readonly lighting: Pick<Lighting, "setBounds">;
  readonly market: Pick<MarketSystem, "root" | "show" | "setActive" | "layout" | "marks">;
  /** Scene children drawn in either view: the world's own systems' roots. The market's is shown and hidden here. */
  readonly coreRoots: ReadonlySet<THREE.Object3D>;
  /** Cut to a new framing in the market and back, instead of gliding. */
  readonly reducedMotion: boolean;
}

export class WorldViews {
  private readonly scene: THREE.Scene;
  private readonly rig: CameraRig;
  private readonly lighting: WorldViewsDeps["lighting"];
  private readonly market: WorldViewsDeps["market"];
  private readonly coreRoots: ReadonlySet<THREE.Object3D>;
  private readonly reducedMotion: boolean;
  /** Which view the canvas shows. */
  private shown: WorldViewKind = "office";
  /** The office's pan and shadow bounds, kept while the market shows so going back restores them. */
  private officeBounds: GroundBounds | null = null;
  /** The market bounds last applied while the market shows; null in the office. */
  private marketBounds: GroundBounds | null = null;
  /** The office's building frame: the one the camera was last pointed at in the office, kept while the market shows. */
  private shot: LayoutFrame | null = null;

  constructor(deps: WorldViewsDeps) {
    this.scene = deps.scene;
    this.rig = deps.rig;
    this.lighting = deps.lighting;
    this.market = deps.market;
    this.coreRoots = deps.coreRoots;
    this.reducedMotion = deps.reducedMotion;
  }

  /** Which view the canvas shows. */
  get kind(): WorldViewKind {
    return this.shown;
  }

  /**
   * Show `view`, which is not the one shown: only its roots drawn, the market's companies targets only in the market,
   * and the camera, its pan limits and the shadow frustum on it.
   */
  show(view: WorldViewKind): void {
    this.shown = view;
    this.applyVisibility();
    this.market.setActive(view === "market");
    if (view === "market") this.frameMarket(true);
    else this.frameOffice();
  }

  /** The market to draw in the market view. While the market shows, the camera follows a change of its bounds. */
  setMarket(market: MarketScene): void {
    this.market.show(market);
    if (this.shown === "market") this.frameMarket(false);
  }

  /** Only the shown view's roots are drawn (and so picked): the core roots always, the market's or the office's. */
  applyVisibility(): void {
    const market = this.shown === "market";
    for (const child of this.scene.children) {
      if (child === this.market.root) child.visible = market;
      else if (!this.coreRoots.has(child)) child.visible = !market;
    }
  }

  /** Point the camera, the pan limits and the shadow frustum at the office layout being applied. */
  frameLayout({ next, prev, layout }: StagedFrame): void {
    // Bounds first: the new framing's target is clamped against them. Pan limits
    // reach the whole diorama (the ground tile and the doorway), and the shadow
    // frustum covers the same: the scenery on the tile casts shadows too.
    // Kept for the office in any case; applied only while the office shows (the market has bounds of its own).
    const bounds = layoutBounds(layout);
    this.officeBounds = bounds;
    const shown = this.shown === "office";
    if (shown) {
      this.rig.setBounds(bounds, PAN_MARGIN);
      // The lighting does not call itself busy for this; setScene wakes the loop, so it is drawn all the same.
      this.lighting.setBounds(bounds);
    }

    // The default shot frames the building — floor, walls and doorway — tightly,
    // as on-screen extents, and the rig fits whichever of its width and height
    // binds on this canvas. Scenery (lawn, street, skyline) may crop at the
    // edges; the player can pan to it.
    const frame = computeBuildingFrame(layout);
    const previousFrame = this.shot;
    this.shot = frame;
    const firstScene = prev === null || previousFrame === null;
    const officeChanged =
      firstScene || prev.scene.office !== next.scene.office || next.events.some((event) => event.kind === "office-changed");
    const frameChanged =
      previousFrame === null ||
      frame.width !== previousFrame.width ||
      frame.height !== previousFrame.height ||
      frame.target.x !== previousFrame.target.x ||
      frame.target.z !== previousFrame.target.z;
    // While the market shows, the kept framing is all that changes: the camera stays on the market.
    if (!shown || (!officeChanged && !frameChanged)) return;
    this.rig.setFraming(frame.target, frame.height, { instant: firstScene, fitWidth: frame.width, fill: FRAME_FILL });
  }

  /** The market's marks projected with the camera as it stands now; null unless the market shows. */
  marketMarks(): MarketScreenMarks | null {
    if (this.shown !== "market") return null;
    const marks = this.market.marks();
    if (marks === null) return null;
    const project = (point: { x: number; y: number; z: number }): ScreenPoint => this.rig.project(point, { x: 0, y: 0 });
    return {
      lots: marks.lots.map(({ seat, centre, corners }) => ({
        seat,
        top: { x: project(centre).x, y: Math.min(...corners.map((corner) => project(corner).y)) },
      })),
      bar: marks.bar === null ? null : { left: project(marks.bar.left), right: project(marks.bar.right), top: project(marks.bar.top) },
    };
  }

  /**
   * The interaction registry was emptied for a new run, and forgot the market's companies too: while the market
   * shows, off and on registers them again.
   */
  reregisterMarket(): void {
    if (this.shown === "market") {
      this.market.setActive(false);
      this.market.setActive(true);
    }
  }

  /** Forget the kept bounds and framing (the world is disposed). */
  clear(): void {
    this.shot = null;
    this.officeBounds = null;
    this.marketBounds = null;
  }

  /** Bounds and framing on the market's layout. `always`: frame even when the bounds are those already applied. */
  private frameMarket(always: boolean): void {
    const layout = this.market.layout();
    if (!layout) return;
    const bounds: GroundBounds = { ...layout.bounds };
    const previous = this.marketBounds;
    const same =
      previous !== null &&
      previous.minX === bounds.minX &&
      previous.maxX === bounds.maxX &&
      previous.minZ === bounds.minZ &&
      previous.maxZ === bounds.maxZ;
    this.marketBounds = bounds;
    if (same && !always) return;
    this.rig.setBounds(bounds, PAN_MARGIN);
    this.lighting.setBounds(bounds);
    const frame = marketFrame(layout);
    this.rig.setFraming(frame.target, frame.height, { instant: this.reducedMotion, fitWidth: frame.width, fill: FRAME_FILL });
  }

  /** Back to the office's kept bounds and framing. */
  private frameOffice(): void {
    this.marketBounds = null;
    if (this.officeBounds) {
      this.rig.setBounds(this.officeBounds, PAN_MARGIN);
      this.lighting.setBounds(this.officeBounds);
    }
    const shot = this.shot;
    if (shot) this.rig.setFraming(shot.target, shot.height, { instant: this.reducedMotion, fitWidth: shot.width, fill: FRAME_FILL });
  }
}
