/**
 * The drawing loop: when a frame is asked of the page, and how long each one is taken to last.
 *
 * It draws while it is running in the sense of ./rest.ts, that is while something moves and for a second of the
 * page's time after, however slowly frames come, and then stops: at rest it draws nothing and has no frame
 * requested, so a still office costs the page nothing. `wake` starts it again. It also stops while paused (the
 * view is hidden or off screen) and while suspended (the graphics context is lost), and for good once disposed.
 * `setKeepAwake` holds it running whatever moves.
 *
 * It knows nothing of three.js or the page: frames are requested through the host it is given, so a test can play
 * them one by one. The world's render loop (./RenderLoop.ts) is its host.
 */
import { AWAKE, restStep } from "./rest";
import type { RestState } from "./rest";

/** Longest step a frame may simulate; a hitch or a backgrounded tab must not teleport anything. */
export const MAX_FRAME_SECONDS = 0.1;
/** Shortest step a frame is taken to last: the clock standing still, or running backwards, is still a frame. */
export const MIN_FRAME_SECONDS = 0.001;
/** What a frame is taken to last when there is none before it to measure from: the first one after any stop. */
export const FIRST_FRAME_SECONDS = 1 / 60;

/**
 * The seconds a frame simulates, from the milliseconds since the frame before it (not a number when there was
 * none). Always positive, finite and at most MAX_FRAME_SECONDS: the systems are never handed anything else.
 */
export const frameSeconds = (intervalMs: number): number => {
  if (Number.isNaN(intervalMs)) return FIRST_FRAME_SECONDS;
  const seconds = intervalMs / 1000;
  if (!(seconds > MIN_FRAME_SECONDS)) return MIN_FRAME_SECONDS;
  return Math.min(seconds, MAX_FRAME_SECONDS);
};

/**
 * How long a frame counts towards the quiet second before rest: the time since the frame before as the page's
 * clock tells it, or what the frame simulated when there is no such time to go by (the first frame after a stop, a
 * clock that stood still or ran backwards).
 */
const quietSeconds = (intervalMs: number, dt: number): number => (intervalMs > 0 && Number.isFinite(intervalMs) ? intervalMs / 1000 : dt);

export interface FrameLoopHost {
  /** The page's requestAnimationFrame and cancelAnimationFrame. */
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  /**
   * One frame: move everything on by `dt` seconds, draw, and say whether anything is still moving. `intervalMs` is
   * the raw time since the frame before, and not a number for the first frame after a stop.
   */
  frame(dt: number, intervalMs: number): boolean;
  /** Frames are about to be drawn again after a stop of any kind (rest, pause, a lost context) or for the first time. */
  started?(): void;
}

export class FrameLoop {
  private readonly host: FrameLoopHost;
  private rest: RestState = AWAKE;
  /** Something asked for a frame since the last one. */
  private woken = false;
  private begun = false;
  private paused = false;
  private suspended = false;
  private disposed = false;
  private keepAwake = false;
  /** The frame request that is out, if one is. There is never more than one. */
  private request: number | null = null;
  /** The page's time at the last frame; not a number when the next frame has none before it. */
  private lastFrameTime = Number.NaN;
  private frameCount = 0;

  constructor(host: FrameLoopHost) {
    this.host = host;
  }

  /** Frames played since creation. */
  get frames(): number {
    return this.frameCount;
  }

  /** True when nothing has moved for a second and nobody keeps the loop awake: no frame will be drawn until a wake. */
  get resting(): boolean {
    return !this.rest.running && !this.keepAwake;
  }

  get keptAwake(): boolean {
    return this.keepAwake;
  }

  /** Begin. Until this is called nothing is requested, whatever else is. */
  start(): void {
    if (this.disposed) return;
    this.begun = true;
    this.sync();
  }

  /** Something changed that a frame should show: draw again, and for a second after. */
  wake(): void {
    if (this.disposed) return;
    this.woken = true;
    if (!this.rest.running) this.rest = AWAKE;
    this.sync();
  }

  /** The view cannot be seen (a hidden tab, scrolled off screen): draw nothing until it can. */
  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    this.sync();
  }

  /** The view cannot be drawn (its graphics context is lost): draw nothing until it can. */
  setSuspended(suspended: boolean): void {
    if (this.disposed) return;
    this.suspended = suspended;
    this.sync();
  }

  /** Hold the loop running whether or not anything moves (true), or let it rest again (false). */
  setKeepAwake(on: boolean): void {
    if (this.disposed) return;
    // Let go, it rests like anything else: a second after the last movement, counted from now.
    if (this.keepAwake && !on) this.rest = AWAKE;
    this.keepAwake = on;
    this.sync();
  }

  /** Stop for good. No request is left behind and nothing starts the loop again. */
  dispose(): void {
    this.disposed = true;
    this.sync();
  }

  private get shouldRun(): boolean {
    return this.begun && !this.disposed && !this.paused && !this.suspended && (this.rest.running || this.keepAwake);
  }

  /** Have a frame requested exactly when one should be drawn. */
  private sync(): void {
    const shouldRun = this.shouldRun;
    if (shouldRun && this.request === null) {
      // However long the stop was, the first frame back does not simulate it.
      this.lastFrameTime = Number.NaN;
      this.host.started?.();
      this.request = this.host.requestFrame(this.tick);
    } else if (!shouldRun && this.request !== null) {
      this.host.cancelFrame(this.request);
      this.request = null;
    }
  }

  private readonly tick = (now: number): void => {
    this.request = null;
    if (!this.shouldRun) return;
    // Requested first, so that nothing thrown below can end the loop.
    this.request = this.host.requestFrame(this.tick);

    const interval = now - this.lastFrameTime;
    this.lastFrameTime = now;
    const dt = frameSeconds(interval);
    let busy = false;
    try {
      busy = this.host.frame(dt, interval) === true;
    } finally {
      // A frame that threw counts as one in which nothing moved: a fault must not keep the loop awake for good.
      this.frameCount += 1;
      // The quiet second is counted on the page's clock: a frame simulates at most a tenth of a second, but on a
      // page that draws slowly the loop would otherwise go on drawing an unchanged picture for several seconds.
      this.rest = restStep(this.rest, { dt: quietSeconds(interval, dt), busy, woken: this.woken });
      this.woken = false;
      // The frame may have brought the loop to rest, or paused or disposed it: then the request just made goes.
      // The next frame of an unbroken run is not a start, so this never restarts the clock.
      if (!this.shouldRun && this.request !== null) {
        this.host.cancelFrame(this.request);
        this.request = null;
      }
    }
  };
}
