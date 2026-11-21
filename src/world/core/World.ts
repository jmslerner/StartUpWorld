import * as THREE from "three";
import { FxSystem } from "../fx/FxSystem";
import { Interaction } from "../interaction/Interaction";
import { computeBuildingFrame, type LayoutFrame } from "../office/framing";
import { getOfficeLayout } from "../office/layouts";
import { OfficeSystem } from "../office/OfficeSystem";
import { EmployeeSystem } from "../people/EmployeeSystem";
import { SeatingPlan } from "../people/seating";
import type {
  InteractableTarget,
  OfficeLayout,
  QualityLevel,
  ScreenPoint,
  ScreenRect,
  WorldCallbacks,
  WorldContext,
  WorldEvent,
  WorldFocusOptions,
  WorldHandle,
  WorldOptions,
  WorldSnapshot,
} from "../types";
import { CameraRig } from "./CameraRig";
import { layoutBounds } from "./layoutBounds";
import { clamp } from "./math";
import { disposeSharedResources } from "./palette";
import { Lighting } from "./Lighting";
import { configureRenderer } from "./rendererLook";
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

/** Longest step a frame may simulate; a hitch or a backgrounded tab must not teleport anything. */
const MAX_FRAME_SECONDS = 0.1;
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
/** Spec §5: device-pixel-ratio caps per quality level. */
const MAX_PIXEL_RATIO: Record<QualityLevel, number> = { high: 2, low: 1.5 };
const CONTEXT_RELEASE_DELAY_MS = 300;
const NO_EVENTS: readonly WorldEvent[] = [];

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

/** Spec §5: touch-first devices and small screens get the cheaper path. */
const detectQuality = (): QualityLevel => {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  // The device's screen, not the window: a laptop user with a short browser
  // window still has a laptop's GPU.
  const small = Math.min(window.screen.width, window.screen.height) < 520;
  return coarse || small ? "low" : "high";
};

const prefersReducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

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
   * One plan for the life of the world, handed to systems as ctx.seating. It is
   * the concrete SeatingPlan, so systems that need more than SeatingApi (who sits
   * at a desk, what the last reconcile changed) can reach it.
   */
  private readonly seatingPlan = new SeatingPlan();
  private layout: OfficeLayout = getOfficeLayout("garage", []);
  private previous: WorldSnapshot | null = null;
  /** The building frame the camera was last pointed at. */
  private shot: LayoutFrame | null = null;
  private readonly focusCentre = new THREE.Vector3();
  private pixelRatioQuery: MediaQueryList | null = null;
  private frameRequest = 0;
  private running = false;
  private paused = false;
  private contextLost = false;
  private disposed = false;
  private lastFrameTime = 0;
  private skipNextDelta = true;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks, options: WorldOptions) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.quality = options.quality ?? detectQuality();
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

    this.rig = new CameraRig({ reducedMotion });
    this.lighting = new Lighting({ scene, quality: this.quality, reducedMotion });
    this.interaction = new Interaction({ canvas, scene, rig: this.rig, callbacks, reducedMotion });

    const seating = this.seatingPlan;
    const getLayout = (): OfficeLayout => this.layout;
    this.fx = new FxSystem({
      scene,
      quality: this.quality,
      reducedMotion,
      seating,
      getLayout,
      unitsPerPixel: () => this.rig.unitsPerPixel(),
      shakeCamera: (strength) => this.rig.shake(strength),
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
      signals: { doorTraffic: 0 },
      getLayout,
      focusCamera: (target, viewHeight, seconds) => this.rig.focus(target, viewHeight, seconds),
    };

    // Registration order is the order snapshots are applied and frames updated.
    this.runner.register("office", () => new OfficeSystem(ctx));
    this.runner.register("people", () => new EmployeeSystem(ctx));
    this.runner.register("lighting", () => this.lighting);
    this.runner.register("fx", () => this.fx);
    this.runner.start();

    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.watchPixelRatio();
    // Until the shell reports a size, go by the canvas's own CSS box.
    this.applySize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);

    this.handle = {
      setSnapshot: (next, events) => this.setSnapshot(next, events),
      resize: (width, height) => this.resize(width, height),
      setSelected: (target) => this.setSelected(target),
      project: (target) => this.project(target),
      screenBounds: (target) => this.screenBounds(target),
      focus: (target, focusOptions) => this.focus(target, focusOptions),
      freeDeskSlots: () => (this.disposed ? [] : this.seatingPlan.freeDeskSlots()),
      hiddenCount: () => (this.disposed ? 0 : this.seatingPlan.hiddenCount()),
      zoomBy: (factor) => this.zoomBy(factor),
      resetCamera: () => this.resetCamera(),
      setPaused: (paused) => this.setPaused(paused),
      dispose: () => this.dispose(),
    };
    debugByHandle.set(this.handle, { ctx, rig: this.rig, renderer });
    this.syncLoop();
  }

  // ── WorldHandle ───────────────────────────────────────────────────────────

  private setSnapshot(next: WorldSnapshot, events: readonly WorldEvent[] = NO_EVENTS): void {
    if (this.disposed) return;
    let prev = this.previous;
    let applied = events;
    const newRun = prev !== null && (prev.runId !== next.runId || events.some((event) => event.type === "run-reset"));
    if (newRun) {
      this.rebuildForNewRun();
      // From the systems' point of view a new run is a first snapshot: build
      // instantly, nothing to animate from.
      prev = null;
      applied = NO_EVENTS;
    }

    // If the floor plan cannot be produced the world keeps the one it has.
    this.runner.run("layout", () => {
      this.layout = getOfficeLayout(next.phase, next.ownedAssets);
    });
    const layout = this.layout;
    // Until setup is finished the company is just the founder: the engine's starting
    // engineer only "arrives" (with the cofounder) once the run actually begins.
    const roster = next.setupComplete ? next.people : next.people.filter((person) => person.kind === "founder");
    const beyondRoster = next.setupComplete ? next.hiddenPeople : 0;
    this.runner.run("seating.reconcile", () => this.seatingPlan.reconcile(roster, beyondRoster, layout));
    this.frameLayout(next, prev, applied);
    this.runner.applySnapshot(next, prev, applied);
    this.previous = next;
  }

  private resize(width: number, height: number): void {
    if (this.disposed) return;
    this.applySize(width, height);
  }

  private setSelected(target: InteractableTarget | null): void {
    if (this.disposed) return;
    this.interaction.setSelected(target);
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
    const rect = this.interaction.screenBounds(target, centre);
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
    const drawn = this.rig.project(centre);
    const at = {
      x: drawn.x + (width / 2 - (rect.left + rect.right) / 2),
      y: drawn.y + (wantY - (rect.top + rect.bottom) / 2),
    };
    this.rig.focusPoint(centre, at, { seconds: options.seconds });
  }

  private zoomBy(factor: number): void {
    if (this.disposed) return;
    this.rig.zoomAt(factor);
  }

  private resetCamera(): void {
    if (this.disposed) return;
    this.rig.reset();
  }

  private setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    this.syncLoop();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncLoop();

    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
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
    this.previous = null;
    this.shot = null;
    debugByHandle.delete(this.handle);
    releaseContextWhenOrphaned(this.canvas, this.gl);
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

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
    this.seatingPlan.reset();
    this.runner.forgetFailures();
    this.runner.start(REBUILT_ON_RESET);
  }

  /** Point the camera, the pan limits and the shadow frustum at the layout being applied. */
  private frameLayout(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    const layout = this.layout;
    // Bounds first: the new framing's target is clamped against them. Pan limits
    // reach the whole diorama (ground tile, everything for sale); the shadow
    // frustum covers the tile and what actually casts a shadow.
    this.rig.setBounds(layoutBounds(layout, [...next.ownedAssets, ...next.availableAssets]), PAN_MARGIN);
    this.lighting.setBounds(layoutBounds(layout, next.ownedAssets));

    // The default shot frames the building — floor, walls, doorway and owned
    // assets — tightly, as on-screen extents, and the rig fits whichever of its
    // width and height binds on this canvas. Scenery (lawn, street, skyline,
    // blueprints) may crop at the edges; the player can pan to it.
    const frame = computeBuildingFrame(layout, next.ownedAssets);
    const previousFrame = this.shot;
    this.shot = frame;
    const firstSnapshot = prev === null || previousFrame === null;
    const phaseChanged =
      firstSnapshot || prev.phase !== next.phase || events.some((event) => event.type === "phase-changed");
    const frameChanged =
      previousFrame === null ||
      frame.width !== previousFrame.width ||
      frame.height !== previousFrame.height ||
      frame.target.x !== previousFrame.target.x ||
      frame.target.z !== previousFrame.target.z;
    if (!phaseChanged && !frameChanged) return;
    this.rig.setFraming(frame.target, frame.height, { instant: firstSnapshot, fitWidth: frame.width, fill: FRAME_FILL });
  }

  // ── Size ──────────────────────────────────────────────────────────────────

  private applySize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO[this.quality]));
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
    this.applySize(this.rig.viewport.width, this.rig.viewport.height);
  };

  // ── Loop ──────────────────────────────────────────────────────────────────

  /** Start or stop the animation loop to match paused / context-lost / disposed. */
  private syncLoop(): void {
    const shouldRun = !this.paused && !this.contextLost && !this.disposed;
    if (shouldRun === this.running) return;
    this.running = shouldRun;
    if (shouldRun) {
      // However long we were stopped, the first frame back simulates no time.
      this.skipNextDelta = true;
      this.frameRequest = requestAnimationFrame(this.frame);
    } else {
      cancelAnimationFrame(this.frameRequest);
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    // Scheduled first so that nothing thrown below can end the loop.
    this.frameRequest = requestAnimationFrame(this.frame);

    let dt = 0;
    if (this.skipNextDelta) this.skipNextDelta = false;
    else dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0), MAX_FRAME_SECONDS);
    this.lastFrameTime = now;
    this.elapsed += dt;

    this.runner.update(dt, this.elapsed);
    // The camera and the highlights move last, so they see where everything ended up this frame.
    try {
      this.rig.update(dt);
      this.interaction.update(dt, this.elapsed);
    } catch (error) {
      // Usually a listener (onHover, onSelectedAnchorMove) throwing; the frame must still be drawn.
      this.runner.reportFailure("interaction.update", error);
    }
    // A listener called above may have disposed or paused the world.
    if (this.running) this.render();
  };

  private render(): void {
    try {
      this.renderer.render(this.scene, this.rig.camera);
    } catch (error) {
      this.runner.reportFailure("render", error);
    }
  }

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser will never offer the context back.
    event.preventDefault();
    this.contextLost = true;
    this.syncLoop();
    this.callbacks.onContextLost?.();
  };

  private readonly onContextRestored = (): void => {
    // three.js has already rebuilt its GL state in its own (earlier) listener.
    this.contextLost = false;
    this.syncLoop();
    this.callbacks.onContextRestored?.();
  };
}

/**
 * Build the 3D world on a canvas. The caller owns the canvas element and its
 * CSS size, reports size changes through `resize`, and must call `dispose`.
 * Creating a new world on the same canvas after disposing the old one is supported.
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
