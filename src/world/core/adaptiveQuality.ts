/**
 * M2 adaptive quality: a pure governor that decides when a world sheds
 * rendering cost (pixel ratio first, then shadows) under sustained, real
 * overload. The render loop (RenderLoop.ts) feeds it once per frame and
 * applies whatever rung it names; all of the judgement lives here so it can
 * be tested with synthetic timings.
 *
 * Two signals, because neither alone tells overload from a slow display:
 *
 * - Work time: performance.now() around the frame's update + render. Over
 *   WORK_BUDGET_MS on most frames of a window means the CPU side (or GL
 *   back-pressure that surfaces as CPU time) cannot keep up.
 * - Missed vsyncs: the requestAnimationFrame interval measures the display
 *   (or browser cap) rate, not render cost, so it is never compared with a
 *   fixed budget. Instead each window calibrates the display interval as a
 *   low percentile of its own intervals, and a frame "misses" when its
 *   interval is over MISS_FACTOR times that (and at least MIN_MISS_SLACK_MS
 *   longer, so timestamp jitter on very fast displays is not read as missed
 *   frames). A sizeable share of misses means the GPU or compositor is
 *   dropping frames.
 *
 * Known limitation: a perfectly uniform slow cadence (every frame exactly two
 * vsyncs) looks the same as a display running at that rate, so a GPU-bound
 * world pinned at a steady 30 fps on a 60 Hz screen is treated as fine. The
 * calibrated interval is capped at MAX_DISPLAY_INTERVAL_MS (no real display or
 * browser cap runs below 30 Hz), so a steady cadence counts as missing only
 * once it is slower than that cap times MISS_FACTOR (about 52 ms, under
 * 19 fps); a uniform 20-29 fps GPU-bound cadence is also treated as fine.
 * Below 10 fps most frames are clamped outliers, which counts as overload on
 * its own. Below 1 fps every interval looks like a gap (see GAP_MS), so such
 * a world is never judged.
 *
 * Steps last for the rest of the session (there is no stepping back up), but
 * they now follow only sustained real overload: samples are ignored for a
 * warm-up after mount, resume, stage rebuilds, long gaps and each step, and
 * single outlier frames cannot tip a whole window.
 *
 * Timing (warm-ups, windows) runs on the injected real-time clock, never on
 * the world's clamped simulation time. No allocations per sample: the window's
 * intervals live in a fixed ring buffer.
 */

/** What the render loop should apply after a sample. */
export type AdaptiveStep = "none" | "pixel-ratio" | "shadows";

export interface AdaptiveQualityOptions {
  /** Pixel-ratio caps, highest first; the first is the starting cap, the last the floor. */
  readonly steps: readonly number[];
  /** Whether the last rung (shadows off) exists: true only for a world that casts shadows. */
  readonly canDropShadows: boolean;
  /** Real-time clock in milliseconds; performance.now() by default. Injected by tests. */
  readonly now?: () => number;
}

/** Samples are ignored this long (ms) after mount, resume, a rebuild, a long gap or a step. */
export const WARM_UP_MS = 2000;
/** Length (ms) of one judging window. */
export const WINDOW_MS = 2000;
/**
 * A window stays open until it has lasted WINDOW_MS and holds at least this
 * many frames, so a world below 5 fps is still judged, on a longer window
 * (dropping such a window instead would leave the slowest devices at full
 * quality for good).
 */
export const MIN_WINDOW_FRAMES = 10;
/** Window ring-buffer capacity: 2 s at 240 Hz fits; a fuller window is judged early. */
const WINDOW_CAPACITY = 512;
/** Work (update + render) over this many ms counts as an over-budget frame. */
export const WORK_BUDGET_MS = 14;
/** Over-budget work on at least this share of a window's frames is CPU overload. */
export const WORK_OVER_SHARE = 0.75;
/** The display interval is this percentile of the window's (non-outlier) intervals. */
const DISPLAY_PERCENTILE = 0.1;
/** No display or browser frame cap runs slower than 30 Hz (+5% jitter allowance). */
export const MAX_DISPLAY_INTERVAL_MS = (1000 / 30) * 1.05;
/** A frame misses vsync when its interval exceeds this multiple of the display interval. */
export const MISS_FACTOR = 1.5;
/**
 * ...and exceeds it by at least this many ms. On 165 Hz and slower displays
 * MISS_FACTOR alone decides; on 240 Hz, where 1.5x leaves only ~2 ms of
 * headroom and jittered or 1 ms-rounded timestamps (Firefox, Safari) pull the
 * low-percentile calibration down, this keeps ordinary frames from counting
 * as misses. A dropped frame there (one extra vsync, ~8.3 ms) still counts.
 */
export const MIN_MISS_SLACK_MS = 3;
/** Missed vsync on at least this share of a window's frames is GPU/compositor overload. */
export const MISS_SHARE = 0.25;
/**
 * Frames at or beyond the world's frame clamp (100 ms of interval or work) are
 * outliers: a blocking shader compile, a stage rebuild, a GC pause. They are
 * left out of the calibration and counts, unless they are the norm (half a
 * window or more), which only a world below 10 fps produces.
 */
export const OUTLIER_MS = 100;
export const OUTLIER_SHARE = 0.5;
/** An interval this long means the loop was not running (hidden tab, debugger): warm up again. */
export const GAP_MS = 1000;

export class AdaptiveQualityGovernor {
  private readonly steps: readonly number[];
  private readonly canDropShadows: boolean;
  private readonly now: () => number;

  private cap: number;
  private shadowsDropped = false;
  private warmUntil: number;

  // The current window. windowStart is NaN until its first sample.
  private windowStart = Number.NaN;
  private frames = 0;
  private outliers = 0;
  private workOver = 0;
  private intervalCount = 0;
  private readonly intervals = new Float64Array(WINDOW_CAPACITY);

  constructor(options: AdaptiveQualityOptions) {
    if (options.steps.length === 0) throw new Error("AdaptiveQualityGovernor needs at least one pixel-ratio step.");
    this.steps = options.steps;
    this.canDropShadows = options.canDropShadows;
    this.now = options.now ?? (() => performance.now());
    this.cap = options.steps[0];
    this.warmUntil = this.now() + WARM_UP_MS;
  }

  /** The pixel-ratio cap in force; the effective ratio is min(devicePixelRatio, cap). */
  get pixelRatioCap(): number {
    return this.cap;
  }

  /** The last rung (shadows off) has been taken. */
  get shadowsOff(): boolean {
    return this.shadowsDropped;
  }

  /**
   * Ignore samples for the next WARM_UP_MS: call after anything that makes the
   * following frames slow for reasons other than steady load (mount, resume,
   * a stage rebuild or layout change, a device-pixel-ratio change).
   */
  warmUp(): void {
    this.warmUntil = this.now() + WARM_UP_MS;
    this.resetWindow();
  }

  /**
   * Feed one frame: `intervalMs` is the raw requestAnimationFrame interval
   * since the previous frame, `workMs` the measured update + render time, and
   * `devicePixelRatio` the current one (it can change when the window moves
   * to another screen). Returns the rung the render loop must apply now, if any.
   */
  sample(intervalMs: number, workMs: number, devicePixelRatio: number): AdaptiveStep {
    if (!(intervalMs >= 0) || !(workMs >= 0)) return "none";
    if (intervalMs >= GAP_MS) {
      this.warmUp();
      return "none";
    }
    const t = this.now();
    if (t < this.warmUntil) return "none";
    if (Number.isNaN(this.windowStart)) this.windowStart = t;

    this.frames++;
    if (intervalMs >= OUTLIER_MS || workMs >= OUTLIER_MS) {
      this.outliers++;
    } else {
      if (workMs > WORK_BUDGET_MS) this.workOver++;
      this.intervals[this.intervalCount++] = intervalMs;
    }

    const windowOpen = t - this.windowStart < WINDOW_MS || this.frames < MIN_WINDOW_FRAMES;
    if (windowOpen && this.frames < WINDOW_CAPACITY) return "none";
    const overloaded = this.judgeWindow();
    this.resetWindow();
    if (!overloaded) return "none";
    const step = this.takeStep(devicePixelRatio);
    // The step itself costs frames (a resize, a shader recompile): judge
    // only what comes after it settles.
    if (step !== "none") this.warmUp();
    return step;
  }

  private judgeWindow(): boolean {
    const n = this.frames;
    if (this.outliers >= n * OUTLIER_SHARE) return true;
    if (this.workOver >= n * WORK_OVER_SHARE) return true;
    const count = this.intervalCount;
    if (count === 0) return false;
    const display = Math.min(selectKth(this.intervals, count, Math.floor((count - 1) * DISPLAY_PERCENTILE)), MAX_DISPLAY_INTERVAL_MS);
    const limit = Math.max(display * MISS_FACTOR, display + MIN_MISS_SLACK_MS);
    let missed = 0;
    for (let i = 0; i < count; i++) if (this.intervals[i] > limit) missed++;
    return missed >= n * MISS_SHARE;
  }

  /** Take the next rung that actually lowers cost at this device pixel ratio. */
  private takeStep(devicePixelRatio: number): AdaptiveStep {
    const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
    const effective = Math.min(dpr, this.cap);
    for (const cap of this.steps) {
      if (cap < this.cap && Math.min(dpr, cap) < effective) {
        this.cap = cap;
        return "pixel-ratio";
      }
    }
    if (this.canDropShadows && !this.shadowsDropped) {
      this.shadowsDropped = true;
      return "shadows";
    }
    return "none";
  }

  private resetWindow(): void {
    this.windowStart = Number.NaN;
    this.frames = 0;
    this.outliers = 0;
    this.workOver = 0;
    this.intervalCount = 0;
  }
}

/**
 * The k-th smallest of values[0, count) (0-based), by in-place quickselect.
 * Reorders that range; allocates nothing.
 */
function selectKth(values: Float64Array, count: number, k: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const swap = values[i];
        values[i] = values[j];
        values[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}
