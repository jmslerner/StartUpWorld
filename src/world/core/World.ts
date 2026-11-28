/**
 * The 3D world on a canvas: builds the camera rig, the lighting, the interaction layer, the effects, the market and
 * the systems the scenes feed, wires them together, and implements the WorldHandle the screens drive it through.
 *
 * The rest lives beside it: the GPU context and renderer from their making to their release (./GpuLifetime.ts), the
 * drawing, frame by frame and at what size and quality (./RenderLoop.ts), which view shows and how it is framed
 * (./WorldViews.ts), and the app's sound listener (./WorldSound.ts).
 */
import * as THREE from "three";
import { FxSystem } from "../fx/FxSystem";
import { Interaction } from "../interaction/Interaction";
import { MarketSystem } from "../market/MarketSystem";
import { OfficeSystem } from "../office/OfficeSystem";
import { EmployeeSystem } from "../people/EmployeeSystem";
import { teamOfTarget } from "../targets";
import type {
  InteractableTarget,
  MarketScene,
  OfficeLayout,
  OfficeScene,
  MarketScreenMarks,
  ScreenPoint,
  ScreenRect,
  WorldCallbacks,
  WorldContext,
  WorldFocusOptions,
  WorldHandle,
  WorldOptions,
  WorldSignals,
  WorldStats,
  WorldViewKind,
} from "../types";
import { detectQuality, prefersReducedMotion } from "../ui/environment";
import { CameraRig } from "./CameraRig";
import { clearScene, GpuLifetime } from "./GpuLifetime";
import { clamp } from "./math";
import { getLightingState, Lighting } from "./Lighting";
import { qualityGovernor, RenderLoop } from "./RenderLoop";
import { SceneFrames, type StagedFrame } from "./sceneFrames";
import { SystemRunner } from "./SystemRunner";
import { WorldSound } from "./WorldSound";
import { WorldViews } from "./WorldViews";

export { WorldUnsupportedError } from "./GpuLifetime";

/** Internals for the dev sandbox and for debugging. Not part of the app-facing API. */
export interface WorldDebug {
  readonly ctx: WorldContext;
  readonly rig: CameraRig;
  readonly renderer: THREE.WebGLRenderer;
}

/** A focused target must be at least this far (CSS px) inside the visible area to count as in view. */
const FOCUS_PADDING_PX = 16;

/** Systems written by other owners; rebuilt from scratch when a new run starts. */
const REBUILT_ON_RESET = ["office", "people"] as const;

const debugByHandle = new WeakMap<WorldHandle, WorldDebug>();

class World {
  readonly handle: WorldHandle;

  private readonly callbacks: WorldCallbacks;
  /** The canvas's WebGL 2 context and the renderer on it, from their making to their release. */
  private readonly gpu: GpuLifetime;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly interaction: Interaction;
  private readonly lighting: Lighting;
  private readonly fx: FxSystem;
  /** The market view, drawn on the same canvas, camera and lights; its root is shown only while the view is the market's. */
  private readonly market: MarketSystem;
  /** Which view the canvas shows, and how the camera frames it. */
  private readonly views: WorldViews;
  private readonly runner = new SystemRunner();
  /** Scene children that belong to this file's own systems; anything else is a rebuildable system's. */
  private readonly coreRoots: ReadonlySet<THREE.Object3D>;

  /**
   * Turns each scene into the one frame every system is handed: the cast, the events, the office's plan and the
   * seating, in that order. It owns the seating plan, one for the life of the world, handed to systems as
   * ctx.seating; the layout it holds is what ctx.getLayout() answers.
   */
  private readonly frames = new SceneFrames((label, error) => this.runner.reportFailure(label, error));
  /** The people system now running, for its count of figures. Replaced when a new run rebuilds it. */
  private people: EmployeeSystem | null = null;
  /** What the systems tell each other, and what the world tells them (whether it is being kept awake). */
  private readonly signals: WorldSignals = { doorTraffic: 0 };
  private readonly focusCentre = new THREE.Vector3();
  /** Scratch for focus(): the rect and the projected centre are read immediately, so they never need to allocate (L6). */
  private readonly focusRect: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly focusScreen: ScreenPoint = { x: 0, y: 0 };
  /** The app's optional sound listener (WorldOptions.sound), as the systems and the loop reach it. */
  private readonly sound: WorldSound;
  /**
   * When frames are drawn, what each one does, and at what size and quality (./RenderLoop.ts). Everything that
   * changes what is on screen wakes it.
   */
  private readonly loop: RenderLoop;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks, options: WorldOptions) {
    this.callbacks = callbacks;
    const quality = options.quality ?? detectQuality();
    const governor = qualityGovernor(quality);
    const soundListener = options.sound ?? null;
    const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

    // Everything that can fail for lack of WebGL happens before anything else
    // is built, so an unsupported device leaves nothing half-initialised behind.
    this.gpu = new GpuLifetime(canvas, quality);
    const { renderer } = this.gpu;
    const { scene } = this;

    this.rig = new CameraRig({ reducedMotion });
    this.lighting = new Lighting({ scene, quality, reducedMotion });
    this.interaction = new Interaction({ canvas, scene, rig: this.rig, callbacks, reducedMotion });
    this.sound = new WorldSound(soundListener, this.rig.camera, getLightingState(scene), () => this.disposed);

    const seating = this.frames.seating;
    const getLayout = (): OfficeLayout => this.frames.layout;
    this.fx = new FxSystem({
      scene,
      quality,
      reducedMotion,
      getLayout,
      unitsPerPixel: () => this.rig.unitsPerPixel(),
      shakeCamera: (strength) => this.rig.shake(strength),
      onBubble: this.sound.bubbleSink(),
    });
    this.market = new MarketSystem({ interactables: this.interaction, reducedMotion });
    this.market.root.visible = false;
    scene.add(this.market.root);
    this.coreRoots = new Set<THREE.Object3D>([this.lighting.root, this.interaction.root, this.fx.root, this.market.root]);
    this.views = new WorldViews({
      scene,
      rig: this.rig,
      lighting: this.lighting,
      market: this.market,
      coreRoots: this.coreRoots,
      reducedMotion,
    });

    const ctx: WorldContext = {
      scene,
      camera: this.rig.camera,
      quality,
      reducedMotion,
      interactables: this.interaction,
      fx: this.fx,
      seating,
      signals: this.signals,
      getLayout,
      focusCamera: (target, viewHeight, seconds) => this.rig.focus(target, viewHeight, seconds),
      sound: this.sound.sink(),
    };

    // Registration order is the order frames are applied and updated: the office before the people (who read its
    // seats), the effects last (they read the layout the frame brought).
    this.runner.register("office", () => new OfficeSystem(ctx));
    this.runner.register("people", () => (this.people = new EmployeeSystem(ctx)));
    this.runner.register("lighting", () => this.lighting);
    this.runner.register("fx", () => this.fx);
    this.runner.register("market", () => this.market);
    this.runner.start();

    this.loop = new RenderLoop({
      canvas,
      renderer,
      scene,
      rig: this.rig,
      runner: this.runner,
      interaction: this.interaction,
      lighting: this.lighting,
      governor,
      frames: this.frames,
      afterUpdate: () => this.sound.reportDusk(),
      callbacks,
    });
    this.loop.listen();
    // Until the shell reports a size, go by the canvas's own CSS box.
    this.loop.applySize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);

    this.handle = {
      setScene: (next) => this.setScene(next),
      resize: (width, height) => this.resize(width, height),
      setSelected: (target) => this.setSelected(target),
      project: (target) => this.project(target),
      screenBounds: (target) => this.screenBounds(target),
      focus: (target, focusOptions) => this.focus(target, focusOptions),
      freeDeskSlots: () => (this.disposed ? [] : this.frames.seating.freeDeskSlots()),
      hiddenCount: () => (this.disposed ? 0 : this.frames.seating.hiddenCount()),
      zoomBy: (factor) => this.zoomBy(factor),
      resetCamera: () => this.resetCamera(),
      setPaused: (paused) => this.setPaused(paused),
      setKeepAwake: (on) => this.setKeepAwake(on),
      stats: () => this.stats(),
      loseContext: () => this.loseContext(),
      restoreContext: () => this.restoreContext(),
      teamOf: (target) =>
        this.disposed || this.views.kind !== "office" ? null : teamOfTarget(target, this.frames.last?.cast ?? null, this.frames.seating),
      personAt: (desk) => (this.disposed || this.views.kind !== "office" ? null : this.frames.seating.deskOccupant(desk)),
      releaseFirst: (personId) => {
        if (!this.disposed) this.frames.releaseFirst(personId);
      },
      settle: () => this.settle(),
      setMarket: (market) => this.setMarket(market),
      setView: (view) => this.setView(view),
      view: () => this.views.kind,
      marketMarks: () => this.marketMarks(),
      onFrame: (listener) => this.onFrame(listener),
      dispose: () => this.dispose(),
    };
    debugByHandle.set(this.handle, { ctx, rig: this.rig, renderer });
    this.loop.start();
  }

  // ── WorldHandle ───────────────────────────────────────────────────────────

  private setScene(scene: OfficeScene): void {
    if (this.disposed) return;
    let staged: StagedFrame;
    try {
      // A scene of another run: the rebuildable systems are taken down before the seating and the layout move on.
      staged = this.frames.stage(scene, () => this.rebuildForNewRun());
    } catch (error) {
      // A scene nothing can be made of: the world keeps showing the one it has.
      this.runner.reportFailure("scene", error);
      return;
    }
    this.views.frameLayout(staged);
    // One frame for every system, in registration order. The layout and the seating are already this frame's.
    this.runner.applyFrame(staged.next, staged.prev);
    // A rebuilt office brings new roots: while the market shows, they stay hidden.
    this.views.applyVisibility();
    // The systems read each other's signals in their updates (a desk goes dark for someone away): one update must
    // run before this scene is drawn, whoever draws it.
    this.loop.sceneApplied();
  }

  private setMarket(market: MarketScene): void {
    if (this.disposed) return;
    this.views.setMarket(market);
    this.loop.wake();
  }

  private setView(view: WorldViewKind): void {
    if (this.disposed || view === this.views.kind) return;
    this.views.show(view);
    this.loop.wake();
  }

  private resize(width: number, height: number): void {
    if (this.disposed) return;
    this.loop.applySize(width, height);
    this.loop.wake();
  }

  private setSelected(target: InteractableTarget | null): void {
    if (this.disposed) return;
    this.interaction.setSelected(target);
    this.loop.wake();
  }

  private project(target: InteractableTarget): ScreenPoint | null {
    return this.disposed ? null : this.interaction.project(target);
  }

  /** The market's marks projected with the camera as it stands now; null unless the market shows. */
  private marketMarks(): MarketScreenMarks | null {
    return this.disposed ? null : this.views.marketMarks();
  }

  private screenBounds(target: InteractableTarget): ScreenRect | null {
    return this.disposed ? null : this.interaction.screenBounds(target);
  }

  private focus(target: InteractableTarget, options: WorldFocusOptions = {}): void {
    if (this.disposed) return;
    const centre = this.focusCentre;
    const rect = this.interaction.screenBounds(target, centre, this.focusRect);
    if (!rect) return;
    const { width, height } = this.rig.viewport;
    const visibleBottom = height - clamp(options.avoidBottomPx ?? 0, 0, height * 0.8);
    const visibleTop = clamp(options.avoidTopPx ?? 0, 0, visibleBottom * 0.5);
    const pad = Math.min(FOCUS_PADDING_PX, (visibleBottom - visibleTop) * 0.08);
    const inView =
      rect.left >= pad && rect.right <= width - pad && rect.top >= visibleTop + pad && rect.bottom <= visibleBottom - pad;
    if (inView) return;
    // Centre the drawn box in the visible area; one too tall for it keeps its top (the anchor, the face) in view.
    const rectHeight = rect.bottom - rect.top;
    const wantY =
      rectHeight > visibleBottom - visibleTop - 2 * pad ? visibleTop + pad + rectHeight / 2 : (visibleTop + visibleBottom) / 2;
    // Projection is affine, so moving the box's centre by an offset moves its world centre by the same offset.
    const drawn = this.rig.project(centre, this.focusScreen);
    const at = {
      x: drawn.x + (width / 2 - (rect.left + rect.right) / 2),
      y: drawn.y + (wantY - (rect.top + rect.bottom) / 2),
    };
    this.rig.focusPoint(centre, at, { seconds: options.seconds });
    this.loop.wake();
  }

  private zoomBy(factor: number): void {
    if (this.disposed) return;
    const before = this.rig.zoom;
    this.rig.zoomAt(factor);
    const after = this.rig.zoom;
    this.loop.wake();
    if (after !== before && before > 0) this.callbacks.onZoom?.(after / before);
  }

  private resetCamera(): void {
    if (this.disposed) return;
    this.rig.reset();
    this.loop.wake();
  }

  private setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.loop.setPaused(paused);
  }

  private setKeepAwake(on: boolean): void {
    if (this.disposed) return;
    // The people read this: only while the world is kept awake does anybody wander from a desk.
    this.signals.keepAwake = on;
    this.loop.setKeepAwake(on);
  }

  private stats(): WorldStats {
    // The renderer's counts stay readable once it is disposed: that is how a check sees that nothing was left.
    const { render, memory } = this.gpu.renderer.info;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      figures: this.disposed ? 0 : (this.people?.figureCount ?? 0),
      hidden: this.disposed ? 0 : this.frames.seating.hiddenCount(),
      framesDrawn: this.loop.framesDrawn,
    };
  }

  private loseContext(): void {
    if (this.disposed) return;
    this.gpu.loseContext();
  }

  private restoreContext(): void {
    if (this.disposed) return;
    this.gpu.restoreContext();
  }

  private settle(): void {
    if (this.disposed) return;
    this.loop.settle();
  }

  private onFrame(listener: () => void): () => void {
    if (this.disposed) return () => {};
    return this.loop.onFrame(listener);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // No frame is requested from here on, nothing can start the loop again, and the canvas is no longer listened to.
    this.loop.dispose();
    this.gpu.disposeStage(this.scene, () => {
      this.runner.stop();
      this.interaction.dispose();
    });
    this.frames.clear();
    this.people = null;
    this.views.clear();
    debugByHandle.delete(this.handle);
    this.gpu.release();
  }

  // ── Scenes ────────────────────────────────────────────────────────────────

  /**
   * A different run: tear the rebuildable systems down to nothing and start
   * them again, so no desk, person or particle can leak from one company into
   * the next whatever state they were in.
   */
  private rebuildForNewRun(): void {
    this.runner.stop(REBUILT_ON_RESET);
    this.interaction.clearRegistry();
    this.views.reregisterMarket();
    // Whatever the stopped systems left on stage still owns GPU memory; the world's own roots stay.
    clearScene(this.scene, this.coreRoots);
    this.fx.reset();
    this.runner.forgetFailures();
    this.runner.start(REBUILT_ON_RESET);
    // M2: a fresh stage compiles its shaders again over the next frames.
    this.loop.warmUp();
  }
}

/**
 * Build the 3D world on a canvas. The caller owns the canvas element and its
 * CSS size, reports size changes through `resize`, and must call `dispose`.
 * Creating a new world on the same canvas after disposing the old one is supported.
 *
 * Only one world may live at a time: the art kit's caches belong to the module, and disposing a world empties
 * them. mountWorld (../mountWorld.ts) is the one caller and sees to it, by taking the earlier world down first.
 *
 * @throws WorldUnsupportedError when a WebGL 2 context cannot be created.
 */
export const createWorld = (
  canvas: HTMLCanvasElement,
  callbacks: WorldCallbacks,
  options: WorldOptions = {}
): WorldHandle => new World(canvas, callbacks, options).handle;

/** Dev/test access to a live world's internals. Returns null once the world is disposed. */
export const inspectWorld = (handle: WorldHandle): WorldDebug | null => debugByHandle.get(handle) ?? null;
