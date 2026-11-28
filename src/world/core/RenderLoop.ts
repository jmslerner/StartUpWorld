/**
 * Drawing the world: when a frame is drawn, what each one does, and at what size and quality.
 *
 * It is the host of a FrameLoop (./FrameLoop.ts, which decides when a frame is asked of the page). Each frame moves
 * the world on (the systems, then the camera and the highlights), draws, and feeds the adaptive-quality governor
 * (./adaptiveQuality.ts), applying the rung it names: a lower pixel-ratio cap, then no shadows. Every picture the
 * world ever puts on the canvas goes through render(), which counts it and then tells the frame listeners.
 *
 * It owns the world's clock, the canvas's backing store (its size, at the governor's pixel-ratio cap, kept to the
 * screen's ratio), and what stops and starts the drawing: a pause, keep-awake, the context lost and given back, the
 * pointer on the canvas, and disposal.
 */
import type * as THREE from "three";
import type { Interaction } from "../interaction/Interaction";
import type { OfficeLayout, QualityLevel, WorldCallbacks } from "../types";
import { AdaptiveQualityGovernor } from "./adaptiveQuality";
import type { CameraRig } from "./CameraRig";
import { FrameLoop, MAX_FRAME_SECONDS, MIN_FRAME_SECONDS } from "./FrameLoop";
import type { Lighting } from "./Lighting";
import { settle } from "./settle";
import type { SystemRunner } from "./SystemRunner";

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

/** The adaptive-quality governor of a world of this quality: its pixel-ratio ladder, and shadows to shed on "high". */
export const qualityGovernor = (quality: QualityLevel): AdaptiveQualityGovernor =>
  new AdaptiveQualityGovernor({ steps: PIXEL_RATIO_STEPS[quality], canDropShadows: quality === "high" });

export interface RenderLoopDeps {
  /** The canvas drawn on: the pointer on it wakes the loop, and its context's loss and return stop and restart it. */
  readonly canvas: EventTarget;
  readonly renderer: Pick<THREE.WebGLRenderer, "render" | "setPixelRatio" | "setSize">;
  readonly scene: THREE.Scene;
  readonly rig: CameraRig;
  /** The systems, moved on every frame and asked whether anything still moves. */
  readonly runner: SystemRunner;
  /** The highlights, moved after the camera. */
  readonly interaction: Pick<Interaction, "update">;
  /** Told to turn its shadows off when the governor takes that rung. */
  readonly lighting: Pick<Lighting, "setShadowsEnabled">;
  /** M2: decides when to shed pixel ratio, then shadows (see qualityGovernor); owns the pixel-ratio cap in force. */
  readonly governor: AdaptiveQualityGovernor;
  /** The scene frames, whose layout is the office plan being shown: a new one means the stage was rebuilt. */
  readonly frames: { readonly layout: OfficeLayout };
  /** Run every frame right after the systems' update: the sound listener hears the time of day. */
  readonly afterUpdate: () => void;
  /** The app's callbacks, told once the drawing has stopped for a lost context and once it has started again. */
  readonly callbacks: Pick<WorldCallbacks, "onContextLost" | "onContextRestored">;
}

export class RenderLoop {
  private readonly canvas: EventTarget;
  private readonly renderer: RenderLoopDeps["renderer"];
  private readonly scene: THREE.Scene;
  private readonly rig: CameraRig;
  private readonly runner: SystemRunner;
  private readonly interaction: RenderLoopDeps["interaction"];
  private readonly lighting: RenderLoopDeps["lighting"];
  private readonly frames: RenderLoopDeps["frames"];
  private readonly afterUpdate: () => void;
  private readonly callbacks: RenderLoopDeps["callbacks"];
  /**
   * When frames are drawn: while something moves and for a second after, and not at all at rest (see ./FrameLoop.ts
   * and ./rest.ts). Everything that changes what is on screen wakes it.
   */
  private readonly loop: FrameLoop;
  /** M2: decides when to shed pixel ratio, then shadows; owns the pixel-ratio cap in force. */
  private readonly adaptive: AdaptiveQualityGovernor;
  /** M2: the layout the governor last saw; a new one means a stage rebuild, so it warms up again. */
  private adaptiveLayout: OfficeLayout | null = null;
  private pixelRatioQuery: MediaQueryList | null = null;
  private paused = false;
  private contextLost = false;
  private disposed = false;
  private elapsed = 0;
  /** A scene has been applied and no update has run since: one must, before anything is drawn. */
  private unsettled = false;
  /** The camera rig's revision at the last frame drawn; a different one now means the view moved. */
  private drawnRevision = -1;
  /** Frames drawn since creation, every call to the renderer counted. */
  private drawn = 0;
  /** Told after every frame drawn (WorldHandle.onFrame). */
  private readonly frameListeners = new Set<() => void>();

  constructor(deps: RenderLoopDeps) {
    this.canvas = deps.canvas;
    this.renderer = deps.renderer;
    this.scene = deps.scene;
    this.rig = deps.rig;
    this.runner = deps.runner;
    this.interaction = deps.interaction;
    this.lighting = deps.lighting;
    this.adaptive = deps.governor;
    this.frames = deps.frames;
    this.afterUpdate = deps.afterUpdate;
    this.callbacks = deps.callbacks;
    this.loop = new FrameLoop({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      frame: this.frame,
      // The frames right after a stop of any kind say nothing about steady load.
      started: () => this.adaptive.warmUp(),
    });
  }

  /** Frames drawn since creation, every call to the renderer counted. */
  get framesDrawn(): number {
    return this.drawn;
  }

  /** Listen to the canvas and the screen: the context lost and given back, the pointer, the device pixel ratio. */
  listen(): void {
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    for (const type of WAKING_EVENTS) this.canvas.addEventListener(type, this.onPointerActivity, { passive: true });
    this.watchPixelRatio();
  }

  /** Begin drawing. Until this is called no frame is requested. */
  start(): void {
    this.loop.start();
  }

  /** Something changed that a frame should show: draw again, and for a second after. */
  wake(): void {
    this.loop.wake();
  }

  /** A scene was applied: one update must run before it is drawn, whoever draws it. Wakes the loop. */
  sceneApplied(): void {
    this.unsettled = true;
    this.loop.wake();
  }

  /** Stop drawing while the view cannot be seen (true); shown again (false), it is drawn afresh. */
  setPaused(paused: boolean): void {
    const resumed = this.paused && !paused;
    this.paused = paused;
    this.loop.setPaused(paused);
    // Shown again: whatever the page did to the canvas while it was out of sight, it gets a fresh picture.
    if (resumed) this.loop.wake();
  }

  /** Draw every frame the page offers, whether or not anything moves (true), or rest again (false). */
  setKeepAwake(on: boolean): void {
    this.loop.setKeepAwake(on);
  }

  /** The adaptive-quality governor judges nothing for a while: the next frames say nothing about steady load. */
  warmUp(): void {
    this.adaptive.warmUp();
  }

  /** The canvas's CSS size: its backing store follows, at the pixel ratio in force, and is drawn at once. */
  applySize(width: number, height: number): void {
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

  /** Finish at once whatever is moving (walks, an office rising, the lights, the camera's glide), then draw it. */
  settle(): void {
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
      // The camera's glide to a new office's framing, and any shake, end at once too.
      this.rig.finish();
    } catch (error) {
      this.runner.reportFailure("settle", error);
    }
    this.loop.wake();
  }

  /** Call `listener` after every frame drawn, until the function returned is called. */
  onFrame(listener: () => void): () => void {
    // Wrapped, so the same function given twice is two listeners, each stopped by its own call.
    const own = (): void => listener();
    this.frameListeners.add(own);
    return () => {
      this.frameListeners.delete(own);
    };
  }

  /** Stop for good: no frame is requested from here on, nothing can start the loop again, and every listener goes. */
  dispose(): void {
    this.disposed = true;
    // No frame is requested from here on, and nothing can start the loop again.
    this.loop.dispose();
    this.frameListeners.clear();

    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    for (const type of WAKING_EVENTS) this.canvas.removeEventListener(type, this.onPointerActivity);
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatioChange);
    this.pixelRatioQuery = null;
  }

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
    this.afterUpdate();
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
    this.drawn += 1;
    try {
      this.renderer.render(this.scene, this.rig.camera);
    } catch (error) {
      this.runner.reportFailure("render", error);
    }
    for (const listener of this.frameListeners) {
      try {
        listener();
      } catch {
        // Whatever a listener does wrong stays out of the frame.
      }
    }
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
