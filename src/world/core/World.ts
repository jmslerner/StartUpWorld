import * as THREE from "three";
import { FxSystem } from "../fx/FxSystem";
import { Interaction } from "../interaction/Interaction";
import { computeBuildingFrame, type LayoutFrame } from "../office/framing";
import { OfficeSystem } from "../office/OfficeSystem";
import { EmployeeSystem } from "../people/EmployeeSystem";
import { teamOfTarget } from "../targets";
import type {
  InteractableTarget,
  OfficeLayout,
  OfficeScene,
  QualityLevel,
  ScreenPoint,
  ScreenRect,
  WorldCallbacks,
  WorldContext,
  WorldFocusOptions,
  WorldHandle,
  WorldOptions,
  WorldSignals,
  WorldSoundListener,
  WorldSoundSink,
  WorldStats,
} from "../types";
import { detectQuality, prefersReducedMotion } from "../ui/environment";
import { AdaptiveQualityGovernor } from "./adaptiveQuality";
import { CameraRig } from "./CameraRig";
import { FrameLoop, MAX_FRAME_SECONDS, MIN_FRAME_SECONDS } from "./FrameLoop";
import { layoutBounds } from "./layoutBounds";
import { clamp } from "./math";
import { disposeSharedResources } from "./palette";
import { getLightingState, Lighting } from "./Lighting";
import { configureRenderer } from "./rendererLook";
import { SceneFrames, type StagedFrame } from "./sceneFrames";
import { settle } from "./settle";
import { SystemRunner } from "./SystemRunner";

/** Thrown by createWorld when the browser cannot give us a usable WebGL 2 context. */
export class WorldUnsupportedError extends Error {
  constructor(message = "WebGL 2 is not available.", options?: ErrorOptions) {
    super(message, options);
    this.name = "WorldUnsupportedError";
  }
}

/** Internals for the dev sandbox and for debugging. Not part of the app-facing API. */
export interface WorldDebug {
  readonly ctx: WorldContext;
  readonly rig: CameraRig;
  readonly renderer: THREE.WebGLRenderer;
}

/** How far past the content the centre of the view may be dragged, in world units. */
const PAN_MARGIN = 1.5;
/**
 * Share of the viewport's binding dimension (height on a wide, short canvas,
 * width on a phone in portrait) the building fills at the default zoom. The
 * building is diamond-shaped on screen, so the corners the HUD sits in stay
 * clear even at this size.
 */
const FRAME_FILL = 0.85;
/** A focused target must be at least this far (CSS px) inside the visible area to count as in view. */
const FOCUS_PADDING_PX = 16;
/**
 * M2 adaptive quality: the pixel-ratio ladder a world walks down under
 * sustained real overload (see adaptiveQuality.ts for how that is judged),
 * one effective step at a time: a rung that would not lower
 * min(devicePixelRatio, cap) is skipped, so a DPR 1.25 or 1.5 screen goes
 * straight from cap 2 to cap 1 and a DPR 1 screen goes straight to shadows.
 * The first rung is the quality's device-pixel-ratio cap (spec §5: 2 on
 * "high", 1.5 on "low") and the last is the floor: a world never goes below
 * 1, and a "low" world starts on its own ladder, so it can only ever reach 1
 * (it has no shadows to shed). After the pixel ratio, a "high" world can turn
 * its shadows off. Steps never go back up mid-session.
 */
const PIXEL_RATIO_STEPS: Record<QualityLevel, readonly number[]> = { high: [2, 1.5, 1], low: [1.5, 1] };
const CONTEXT_RELEASE_DELAY_MS = 300;
/**
 * What on the canvas asks for a frame: anything the pointer does. The interaction layer listens to the same events
 * and acts on them; these listeners only wake the loop, so that what it did is drawn.
 */
const WAKING_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerleave",
  "wheel",
  "gesturestart",
  "gesturechange",
  "gestureend",
] as const;
/**
 * Sound pans are kept moderate: the canvas is a window in the page, not the whole sound
 * stage, so something at its edge sounds off to the side, never hard in one ear.
 */
const SOUND_PAN_SPREAD = 0.6;
/** Height (world units) at which a sound's position is projected: about a seated person's chest. */
const SOUND_HEIGHT = 0.8;
/** The lighting's dusk amount is passed on when it has moved this much (and at both ends). */
const DUSK_REPORT_STEP = 0.02;

/** Systems written by other owners; rebuilt from scratch when a new run starts. */
const REBUILT_ON_RESET = ["office", "people"] as const;

// Exactly what THREE.WebGLRenderer would ask for itself. We create the context
// first so that failing to get one never involves constructing a renderer.
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
  failIfMajorPerformanceCaveat: false,
};

/** Canvases whose GPU context is due to be released because their world was disposed. */
const pendingContextRelease = new WeakMap<HTMLCanvasElement, number>();
const debugByHandle = new WeakMap<WorldHandle, WorldDebug>();

const acquireContext = (canvas: HTMLCanvasElement): WebGL2RenderingContext => {
  // A world is being created on this canvas again (React StrictMode remounts
  // effects on the same element): the context is still wanted after all.
  const pending = pendingContextRelease.get(canvas);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    pendingContextRelease.delete(canvas);
  }
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  } catch {
    gl = null;
  }
  if (!gl) throw new WorldUnsupportedError("This browser or device cannot create a WebGL 2 context.");
  if (gl.isContextLost()) throw new WorldUnsupportedError("The WebGL context for this canvas has been lost.");
  return gl;
};

/**
 * renderer.dispose() frees what three.js allocated but keeps the context alive,
 * which is what lets a world be re-created on the same canvas. Once the canvas
 * has actually left the page nobody can do that, so hand the GPU memory back
 * rather than waiting for garbage collection (browsers cap live contexts).
 */
const releaseContextWhenOrphaned = (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): void => {
  const timer = window.setTimeout(() => {
    pendingContextRelease.delete(canvas);
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }, CONTEXT_RELEASE_DELAY_MS);
  pendingContextRelease.set(canvas, timer);
};

/** Free the GPU resources of an object tree that nobody else is going to clean up. */
const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((node) => {
    const mesh = node as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
};

class World {
  readonly handle: WorldHandle;

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: WorldCallbacks;
  private readonly quality: QualityLevel;
  private readonly gl: WebGL2RenderingContext;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly interaction: Interaction;
  private readonly lighting: Lighting;
  private readonly fx: FxSystem;
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
  /** The building frame the camera was last pointed at. */
  private shot: LayoutFrame | null = null;
  private readonly focusCentre = new THREE.Vector3();
  /** Scratch for focus(): the rect and the projected centre are read immediately, so they never need to allocate (L6). */
  private readonly focusRect: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly focusScreen: ScreenPoint = { x: 0, y: 0 };
  private readonly soundPoint = new THREE.Vector3();
  /** The app's optional sound listener (WorldOptions.sound). */
  private readonly sound: WorldSoundListener | null;
  /** The lighting's published state (a stable object per scene), read for the sound listener's dusk. */
  private readonly lightingState = getLightingState(this.scene);
  /** Last dusk amount handed to the sound listener; NaN before the first. */
  private reportedDusk = Number.NaN;
  private pixelRatioQuery: MediaQueryList | null = null;
  /**
   * When frames are drawn: while something moves and for a second after, and not at all at rest (see ./FrameLoop.ts
   * and ./rest.ts). Everything that changes what is on screen wakes it.
   */
  private readonly loop: FrameLoop;
  /** The extension that takes the context away and gives it back, fetched while there is a context to ask. */
  private readonly contextSwitch: WEBGL_lose_context | null;
  private paused = false;
  private contextLost = false;
  private disposed = false;
  private elapsed = 0;
  /** A scene has been applied and no update has run since: one must, before anything is drawn. */
  private unsettled = false;
  /** The camera rig's revision at the last frame drawn; a different one now means the view moved. */
  private drawnRevision = -1;
  /** Frames drawn since creation, every call to the renderer counted. */
  private framesDrawn = 0;
  /** M2: decides when to shed pixel ratio, then shadows; owns the pixel-ratio cap in force. */
  private readonly adaptive: AdaptiveQualityGovernor;
  /** M2: the layout the governor last saw; a new one means a stage rebuild, so it warms up again. */
  private adaptiveLayout: OfficeLayout | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks, options: WorldOptions) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.quality = options.quality ?? detectQuality();
    this.adaptive = new AdaptiveQualityGovernor({
      steps: PIXEL_RATIO_STEPS[this.quality],
      canDropShadows: this.quality === "high",
    });
    this.sound = options.sound ?? null;
    const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

    // Everything that can fail for lack of WebGL happens before anything else
    // is built, so an unsupported device leaves nothing half-initialised behind.
    this.gl = acquireContext(canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        context: this.gl,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (cause) {
      throw new WorldUnsupportedError("WebGL 2 is available, but the renderer could not start.", { cause });
    }
    const { renderer, scene } = this;
    configureRenderer(renderer, this.quality);
    this.contextSwitch = this.gl.getExtension("WEBGL_lose_context");
    this.loop = new FrameLoop({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      frame: this.frame,
      // The frames right after a stop of any kind say nothing about steady load.
      started: () => this.adaptive.warmUp(),
    });

    this.rig = new CameraRig({ reducedMotion });
    this.lighting = new Lighting({ scene, quality: this.quality, reducedMotion });
    this.interaction = new Interaction({ canvas, scene, rig: this.rig, callbacks, reducedMotion });

    const seating = this.frames.seating;
    const getLayout = (): OfficeLayout => this.frames.layout;
    this.fx = new FxSystem({
      scene,
      quality: this.quality,
      reducedMotion,
      getLayout,
      unitsPerPixel: () => this.rig.unitsPerPixel(),
      shakeCamera: (strength) => this.rig.shake(strength),
      onBubble: this.sound?.onBubble ? (at) => this.tellSound((sound) => sound.onBubble?.({ pan: this.soundPan(at.x, at.z) })) : undefined,
    });
    this.coreRoots = new Set<THREE.Object3D>([this.lighting.root, this.interaction.root, this.fx.root]);

    const ctx: WorldContext = {
      scene,
      camera: this.rig.camera,
      quality: this.quality,
      reducedMotion,
      interactables: this.interaction,
      fx: this.fx,
      seating,
      signals: this.signals,
      getLayout,
      focusCamera: (target, viewHeight, seconds) => this.rig.focus(target, viewHeight, seconds),
      sound: this.soundSink(),
    };

    // Registration order is the order frames are applied and updated: the office before the people (who read its
    // seats), the effects last (they read the layout the frame brought).
    this.runner.register("office", () => new OfficeSystem(ctx));
    this.runner.register("people", () => (this.people = new EmployeeSystem(ctx)));
    this.runner.register("lighting", () => this.lighting);
    this.runner.register("fx", () => this.fx);
    this.runner.start();

    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    for (const type of WAKING_EVENTS) canvas.addEventListener(type, this.onPointerActivity, { passive: true });
    this.watchPixelRatio();
    // Until the shell reports a size, go by the canvas's own CSS box.
    this.applySize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);

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
      teamOf: (target) => (this.disposed ? null : teamOfTarget(target, this.frames.last?.cast ?? null, this.frames.seating)),
      personAt: (desk) => (this.disposed ? null : this.frames.seating.deskOccupant(desk)),
      releaseFirst: (personId) => {
        if (!this.disposed) this.frames.releaseFirst(personId);
      },
      settle: () => this.settle(),
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
    this.frameLayout(staged);
    // One frame for every system, in registration order. The layout and the seating are already this frame's.
    this.runner.applyFrame(staged.next, staged.prev);
    // The systems read each other's signals in their updates (a desk goes dark for someone away): one update must
    // run before this scene is drawn, whoever draws it.
    this.unsettled = true;
    this.loop.wake();
  }

  private resize(width: number, height: number): void {
    if (this.disposed) return;
    this.applySize(width, height);
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
    const resumed = this.paused && !paused;
    this.paused = paused;
    this.loop.setPaused(paused);
    // Shown again: whatever the page did to the canvas while it was out of sight, it gets a fresh picture.
    if (resumed) this.loop.wake();
  }

  private setKeepAwake(on: boolean): void {
    if (this.disposed) return;
    // The people read this: only while the world is kept awake does anybody wander from a desk.
    this.signals.keepAwake = on;
    this.loop.setKeepAwake(on);
  }

  private stats(): WorldStats {
    // The renderer's counts stay readable once it is disposed: that is how a check sees that nothing was left.
    const { render, memory } = this.renderer.info;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      figures: this.disposed ? 0 : (this.people?.figureCount ?? 0),
      hidden: this.disposed ? 0 : this.frames.seating.hiddenCount(),
      framesDrawn: this.framesDrawn,
    };
  }

  private loseContext(): void {
    if (this.disposed || this.gl.isContextLost()) return;
    this.contextSwitch?.loseContext();
  }

  private restoreContext(): void {
    // Only a context taken away through the extension can be given back through it.
    if (this.disposed || !this.gl.isContextLost()) return;
    this.contextSwitch?.restoreContext();
  }

  private settle(): void {
    if (this.disposed) return;
    try {
      // Runs the systems on in whole frames of the longest length the loop ever hands them; the next frame drawn
      // (woken below) shows where everything ended up.
      settle(
        () => this.runner.busy(),
        (dt) => {
          this.elapsed += dt;
          this.runner.update(dt, this.elapsed);
        },
        MAX_FRAME_SECONDS
      );
    } catch (error) {
      this.runner.reportFailure("settle", error);
    }
    this.loop.wake();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // No frame is requested from here on, and nothing can start the loop again.
    this.loop.dispose();

    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    for (const type of WAKING_EVENTS) this.canvas.removeEventListener(type, this.onPointerActivity);
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatioChange);
    this.pixelRatioQuery = null;

    // Materials shared through caches outlive the systems that used them, and
    // each keeps a dispose-listener pointing back into this renderer. Note what
    // is on stage now so those links can be cut once the systems are gone
    // (disposing a cached material is harmless: it is rebuilt on next use).
    const materials = new Set<THREE.Material>();
    this.scene.traverse((node) => {
      const material = (node as Partial<THREE.Mesh>).material;
      if (Array.isArray(material)) for (const entry of material) materials.add(entry);
      else if (material) materials.add(material);
    });

    this.runner.stop();
    this.interaction.dispose();
    // Whatever a system left in the scene still owns GPU memory; take it back.
    // NOTE (L5): disposeTree() disposes the materials on stage, and the loop
    // after it disposes the collected set a second time, as does
    // disposeSharedResources() for cached materials below. That redundancy is
    // deliberate and safe — Material.dispose() is idempotent (it only emits
    // the dispose event; three.js drops the GL program on the next render) —
    // and it guarantees the renderer links noted above are cut even for a
    // material that left the stage before teardown. Do not "deduplicate" it
    // without re-proving that every path still cuts those links.
    for (const child of [...this.scene.children]) {
      this.scene.remove(child);
      disposeTree(child);
    }
    for (const material of materials) material.dispose();
    // The prop/character caches are module-level: free them with the world so a
    // re-created world (StrictMode, the 3D toggle) starts from clean GPU state.
    disposeSharedResources();
    // The context outlives this renderer whenever a new world is created on the
    // same canvas (React StrictMode does exactly that). Hand it back in its
    // default state: a leftover such as UNPACK_FLIP_Y would otherwise trip up
    // the next renderer's start-up texture uploads.
    this.renderer.resetState();
    this.renderer.dispose();
    this.frames.clear();
    this.people = null;
    this.shot = null;
    debugByHandle.delete(this.handle);
    releaseContextWhenOrphaned(this.canvas, this.gl);
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
    for (const child of [...this.scene.children]) {
      if (this.coreRoots.has(child)) continue;
      this.scene.remove(child);
      disposeTree(child);
    }
    this.fx.reset();
    this.runner.forgetFailures();
    this.runner.start(REBUILT_ON_RESET);
    // M2: a fresh stage compiles its shaders again over the next frames.
    this.adaptive.warmUp();
  }

  /** Point the camera, the pan limits and the shadow frustum at the layout being applied. */
  private frameLayout({ next, prev, layout }: StagedFrame): void {
    // Bounds first: the new framing's target is clamped against them. Pan limits
    // reach the whole diorama (the ground tile and the doorway), and the shadow
    // frustum covers the same: the scenery on the tile casts shadows too.
    const bounds = layoutBounds(layout);
    this.rig.setBounds(bounds, PAN_MARGIN);
    // The lighting does not call itself busy for this; setScene wakes the loop, so it is drawn all the same.
    this.lighting.setBounds(bounds);

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
    if (!officeChanged && !frameChanged) return;
    this.rig.setFraming(frame.target, frame.height, { instant: firstScene, fitWidth: frame.width, fill: FRAME_FILL });
  }

  // ── Sound ─────────────────────────────────────────────────────────────────

  /** The world-coordinate sink systems report to, or undefined when nobody listens for those sounds. */
  private soundSink(): WorldSoundSink | undefined {
    const sound = this.sound;
    if (!sound || (!sound.onFootsteps && !sound.onChairSit)) return undefined;
    return {
      footsteps: (from, to, steps, approach) =>
        this.tellSound((listener) =>
          listener.onFootsteps?.({ steps, approach, pan: this.soundPan(from.x, from.z), panTo: this.soundPan(to.x, to.z) })
        ),
      chairSit: (at) => this.tellSound((listener) => listener.onChairSit?.({ pan: this.soundPan(at.x, at.z) })),
    };
  }

  /** Stereo position of a point on the ground, from where the camera draws it. */
  private soundPan(x: number, z: number): number {
    const ndc = this.soundPoint.set(x, SOUND_HEIGHT, z).project(this.rig.camera).x;
    return Number.isFinite(ndc) ? clamp(ndc, -1, 1) * SOUND_PAN_SPREAD : 0;
  }

  /** Call the sound listener; whatever it does wrong stays out of the frame. */
  private tellSound(call: (listener: WorldSoundListener) => void): void {
    const sound = this.sound;
    if (!sound || this.disposed) return;
    try {
      call(sound);
    } catch {
      // A garnish: a broken listener must never cost a frame.
    }
  }

  /** Pass the lighting's time of day on to the sound listener when it has moved noticeably. */
  private reportDusk(): void {
    if (!this.sound?.onDusk) return;
    const dusk = this.lightingState.duskAmount;
    const last = this.reportedDusk;
    const atEnd = (dusk === 0 || dusk === 1) && dusk !== last;
    if (!atEnd && Math.abs(dusk - last) < DUSK_REPORT_STEP) return;
    this.reportedDusk = dusk;
    this.tellSound((sound) => sound.onDusk?.(dusk));
  }

  // ── Size ──────────────────────────────────────────────────────────────────

  private applySize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.adaptive.pixelRatioCap));
    // false: the shell sizes the canvas element with CSS; we only size its backing store.
    this.renderer.setSize(w, h, false);
    this.rig.setViewport(w, h);
    // Resizing clears the canvas, and resize observers fire after this frame's
    // animation callbacks have already run: without an immediate redraw the
    // browser would paint one blank frame per resize step.
    if (!this.contextLost) this.render();
  }

  /** devicePixelRatio changes when the window moves between screens or the page is zoomed. */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatioChange);
    this.pixelRatioQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) ?? null;
    this.pixelRatioQuery?.addEventListener("change", this.onPixelRatioChange);
  }

  private readonly onPixelRatioChange = (): void => {
    if (this.disposed) return;
    // The query matches one exact ratio, so it has to be re-armed for the new one.
    this.watchPixelRatio();
    // A new backing-store size (and a move between screens) costs a few frames.
    this.adaptive.warmUp();
    this.applySize(this.rig.viewport.width, this.rig.viewport.height);
    this.loop.wake();
  };

  // ── Loop ──────────────────────────────────────────────────────────────────

  /**
   * One frame, called by the loop while it runs: move everything on by `dt` seconds (positive, finite and at most a
   * tenth of a second: the loop sees to that), draw, and say whether anything is still moving. The loop rests a
   * second after this last answers yes, and then calls it no more until something wakes it.
   */
  private readonly frame = (dt: number, intervalMs: number): boolean => {
    const workStart = performance.now();
    this.elapsed += dt;

    this.unsettled = false;
    this.runner.update(dt, this.elapsed);
    this.reportDusk();
    // The camera and the highlights move last, so they see where everything ended up this frame.
    try {
      this.rig.update(dt);
      this.interaction.update(dt, this.elapsed);
    } catch (error) {
      // Usually a listener (onHover, onSelectedAnchorMove) throwing; the frame must still be drawn.
      this.runner.reportFailure("interaction.update", error);
    }
    // A listener called above may have disposed or paused the world.
    if (this.disposed || this.paused || this.contextLost) return false;
    this.render();
    this.trackQuality(intervalMs, performance.now() - workStart);

    // Still moving: any system, a camera glide or shake, or a camera that was moved since the last frame (a drag,
    // a zoom: those end when the hand does, and the second of grace covers the rest).
    const revision = this.rig.revision;
    const cameraMoved = revision !== this.drawnRevision;
    this.drawnRevision = revision;
    return this.runner.busy() || this.rig.isAnimating || cameraMoved;
  };

  /**
   * M2: feed this frame to the adaptive-quality governor and apply the rung
   * it names, if any. A new layout (another office, another run) means the
   * stage was rebuilt and new shaders compile, so the governor warms up again.
   * A change of quality is something to draw: it wakes the loop.
   */
  private trackQuality(intervalMs: number, workMs: number): void {
    const layout = this.frames.layout;
    if (layout !== this.adaptiveLayout) {
      this.adaptiveLayout = layout;
      this.adaptive.warmUp();
      return;
    }
    if (Number.isNaN(intervalMs)) return;
    const step = this.adaptive.sample(intervalMs, workMs, window.devicePixelRatio || 1);
    if (step === "pixel-ratio") {
      this.applySize(this.rig.viewport.width, this.rig.viewport.height);
      this.loop.wake();
    } else if (step === "shadows") {
      // The next frame compiles shadow-free shader variants (a one-off
      // stall); the governor's post-step warm-up keeps it out of the next decision.
      this.lighting.setShadowsEnabled(false);
      this.loop.wake();
    }
  }

  /** Draw. Every picture the world ever puts on the canvas goes through here, and is counted. */
  private render(): void {
    if (this.unsettled) {
      // A scene was applied and is about to be drawn by something other than the loop's own frame (a resize):
      // the systems get their one update first, of the shortest length there is.
      this.unsettled = false;
      this.runner.update(MIN_FRAME_SECONDS, this.elapsed);
    }
    this.framesDrawn += 1;
    try {
      this.renderer.render(this.scene, this.rig.camera);
    } catch (error) {
      this.runner.reportFailure("render", error);
    }
  }

  /** The pointer did something on the canvas: the interaction layer acts on it, and a frame shows the result. */
  private readonly onPointerActivity = (): void => {
    this.loop.wake();
  };

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser will never offer the context back.
    event.preventDefault();
    this.contextLost = true;
    this.loop.setSuspended(true);
    this.callbacks.onContextLost?.();
  };

  private readonly onContextRestored = (): void => {
    // three.js has already rebuilt its GL state in its own (earlier) listener.
    this.contextLost = false;
    this.loop.setSuspended(false);
    // Everything has to be drawn anew on the context that came back.
    this.loop.wake();
    this.callbacks.onContextRestored?.();
  };
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
