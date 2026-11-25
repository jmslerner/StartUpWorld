import { describe, expect, it } from "vitest";
import { FIRST_FRAME_SECONDS, FrameLoop, frameSeconds, MAX_FRAME_SECONDS, MIN_FRAME_SECONDS } from "./FrameLoop";

/**
 * A page's frame clock for a test: remembers what was requested and cancelled, and plays a requested frame when
 * told to. Nothing here runs by itself, so "no request is pending" means "no frame will ever fire".
 */
class Clock {
  now = 1000;
  requested = 0;
  cancelled = 0;
  readonly pending = new Map<number, (now: number) => void>();
  private nextId = 1;

  readonly requestFrame = (callback: (now: number) => void): number => {
    const id = this.nextId++;
    this.requested += 1;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancelFrame = (id: number): void => {
    if (this.pending.delete(id)) this.cancelled += 1;
  };

  /** Let `ms` pass and fire the pending frame, if there is one. True when one fired. */
  tick(ms = 1000 / 60): boolean {
    this.now += ms;
    const entries = [...this.pending];
    this.pending.clear();
    for (const [, callback] of entries) callback(this.now);
    return entries.length > 0;
  }
}

interface Rig {
  clock: Clock;
  loop: FrameLoop;
  /** What each frame was handed. */
  frames: Array<{ dt: number; interval: number }>;
  starts: number;
  /** What the next frames answer to "is anything still moving?". */
  busy: boolean;
  /** Run in the middle of the next frame, once. */
  during: (() => void) | null;
}

const rig = (): Rig => {
  const clock = new Clock();
  const r: Rig = { clock, frames: [], starts: 0, busy: false, during: null } as unknown as Rig;
  r.loop = new FrameLoop({
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    frame: (dt, interval) => {
      r.frames.push({ dt, interval });
      const during = r.during;
      r.during = null;
      during?.();
      return r.busy;
    },
    started: () => {
      r.starts += 1;
    },
  });
  return r;
};

/** Fire frames until none is pending (or `limit` have fired); how many fired. */
const runOut = (r: Rig, limit = 10_000): number => {
  let fired = 0;
  while (fired < limit && r.clock.tick()) fired += 1;
  return fired;
};

describe("frameSeconds", () => {
  it("is the time since the last frame, in seconds", () => {
    expect(frameSeconds(1000 / 60)).toBeCloseTo(1 / 60, 12);
    expect(frameSeconds(50)).toBeCloseTo(0.05, 12);
  });

  it("is never more than a tenth of a second: a hitch or a tab left in the background teleports nothing", () => {
    expect(MAX_FRAME_SECONDS).toBe(0.1);
    expect(frameSeconds(100)).toBe(0.1);
    expect(frameSeconds(101)).toBe(0.1);
    expect(frameSeconds(3_600_000)).toBe(0.1);
    expect(frameSeconds(Number.MAX_VALUE)).toBe(0.1);
  });

  it("is always positive and finite, whatever the clock says", () => {
    expect(frameSeconds(Number.NaN)).toBe(FIRST_FRAME_SECONDS);
    expect(frameSeconds(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME_SECONDS);
    expect(frameSeconds(Number.NEGATIVE_INFINITY)).toBe(MIN_FRAME_SECONDS);
    expect(frameSeconds(0)).toBe(MIN_FRAME_SECONDS);
    expect(frameSeconds(-16)).toBe(MIN_FRAME_SECONDS);
    for (const ms of [Number.NaN, Infinity, -Infinity, 0, -1, 1e-9, 5, 16.7, 99, 100, 1e12]) {
      const seconds = frameSeconds(ms);
      expect(seconds > 0 && seconds <= MAX_FRAME_SECONDS && Number.isFinite(seconds), String(ms)).toBe(true);
    }
    expect(FIRST_FRAME_SECONDS).toBeGreaterThan(0);
    expect(FIRST_FRAME_SECONDS).toBeLessThanOrEqual(MAX_FRAME_SECONDS);
  });
});

describe("FrameLoop", () => {
  it("asks for nothing until it is started, then for one frame at a time", () => {
    const r = rig();
    expect(r.clock.requested).toBe(0);
    r.loop.start();
    expect(r.clock.pending.size).toBe(1);
    expect(r.starts).toBe(1);
    r.loop.start();
    expect(r.clock.pending.size).toBe(1);
    r.busy = true;
    for (let i = 0; i < 100; i += 1) {
      r.clock.tick();
      expect(r.clock.pending.size).toBe(1);
    }
    expect(r.frames).toHaveLength(100);
    expect(r.loop.frames).toBe(100);
    expect(r.starts).toBe(1);
  });

  it("hands each frame the time since the one before, and the first frame a nominal one", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    r.clock.tick(7);
    r.clock.tick(20);
    r.clock.tick(5000);
    r.clock.tick(0);
    r.clock.tick(-3);
    expect(r.frames.map((frame) => frame.dt)).toEqual([FIRST_FRAME_SECONDS, 0.02, MAX_FRAME_SECONDS, MIN_FRAME_SECONDS, MIN_FRAME_SECONDS]);
    expect(r.frames[0].interval).toBeNaN();
    expect(r.frames.slice(1).map((frame) => frame.interval)).toEqual([20, 5000, 0, -3]);
  });

  it("keeps drawing while something moves", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    for (let i = 0; i < 600; i += 1) r.clock.tick();
    expect(r.loop.frames).toBe(600);
    expect(r.loop.resting).toBe(false);
    expect(r.clock.pending.size).toBe(1);
  });

  it("comes to rest a second after the last movement: no frame is drawn and none is asked for", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    for (let i = 0; i < 30; i += 1) r.clock.tick();
    r.busy = false;
    const fired = runOut(r);
    expect(fired).toBeGreaterThanOrEqual(59);
    expect(fired).toBeLessThanOrEqual(62);
    expect(r.loop.resting).toBe(true);
    expect(r.clock.pending.size).toBe(0);
    const drawn = r.loop.frames;
    const asked = r.clock.requested;
    // A quiet minute: the page's clock runs on and nothing of ours is on it.
    for (let i = 0; i < 3600; i += 1) expect(r.clock.tick()).toBe(false);
    expect(r.loop.frames).toBe(drawn);
    expect(r.clock.requested).toBe(asked);
  });

  it("wakes when asked: one frame is requested however often, and a second of frames follows", () => {
    const r = rig();
    r.loop.start();
    runOut(r);
    expect(r.loop.resting).toBe(true);
    const before = r.loop.frames;
    r.loop.wake();
    r.loop.wake();
    r.loop.wake();
    expect(r.clock.pending.size).toBe(1);
    expect(r.loop.resting).toBe(false);
    expect(r.starts).toBe(2);
    r.clock.tick(60_000);
    // However long the rest was, the first frame back is a nominal one.
    expect(r.frames[r.frames.length - 1]).toEqual({ dt: FIRST_FRAME_SECONDS, interval: Number.NaN });
    const fired = 1 + runOut(r);
    expect(fired).toBeGreaterThanOrEqual(59);
    expect(fired).toBeLessThanOrEqual(62);
    expect(r.loop.frames).toBe(before + fired);
    expect(r.clock.pending.size).toBe(0);
  });

  it("a wake while frames are being drawn starts the quiet second again, without a second request", () => {
    const r = rig();
    r.loop.start();
    for (let i = 0; i < 50; i += 1) r.clock.tick();
    r.loop.wake();
    expect(r.clock.pending.size).toBe(1);
    expect(r.starts).toBe(1);
    const fired = runOut(r);
    expect(fired).toBeGreaterThanOrEqual(59);
    expect(fired).toBeLessThanOrEqual(62);
  });

  it("a wake from inside a frame is not lost", () => {
    const r = rig();
    r.loop.start();
    for (let i = 0; i < 58; i += 1) r.clock.tick();
    r.during = () => r.loop.wake();
    const fired = runOut(r);
    expect(fired).toBeGreaterThanOrEqual(59);
    expect(r.clock.pending.size).toBe(0);
  });

  it("something that starts to move by itself keeps the loop from resting", () => {
    const r = rig();
    r.loop.start();
    for (let i = 0; i < 40; i += 1) r.clock.tick();
    r.busy = true;
    for (let i = 0; i < 300; i += 1) r.clock.tick();
    expect(r.clock.pending.size).toBe(1);
    r.busy = false;
    expect(runOut(r)).toBeGreaterThanOrEqual(59);
  });

  it("paused, it draws nothing and asks for nothing, and remembers a wake for when it resumes", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    r.clock.tick();
    r.loop.setPaused(true);
    expect(r.clock.pending.size).toBe(0);
    expect(r.clock.cancelled).toBe(1);
    const drawn = r.loop.frames;
    r.loop.wake();
    expect(r.clock.tick()).toBe(false);
    expect(r.loop.frames).toBe(drawn);
    r.loop.setPaused(true);
    r.loop.setPaused(false);
    expect(r.clock.pending.size).toBe(1);
    r.clock.tick(90_000);
    // The time spent paused is not simulated.
    expect(r.frames[r.frames.length - 1].dt).toBe(FIRST_FRAME_SECONDS);

    // Paused while at rest, woken while paused: it runs once it is shown again.
    r.busy = false;
    runOut(r);
    r.loop.setPaused(true);
    r.loop.wake();
    expect(r.clock.pending.size).toBe(0);
    r.loop.setPaused(false);
    expect(r.clock.pending.size).toBe(1);
    expect(runOut(r)).toBeGreaterThanOrEqual(59);
  });

  it("resumed while at rest with nothing new, it stays at rest", () => {
    const r = rig();
    r.loop.start();
    runOut(r);
    r.loop.setPaused(true);
    r.loop.setPaused(false);
    expect(r.clock.pending.size).toBe(0);
    r.loop.setSuspended(true);
    r.loop.setSuspended(false);
    expect(r.clock.pending.size).toBe(0);
  });

  it("suspended (the graphics context is lost), it draws nothing until it is given back", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    r.clock.tick();
    r.loop.setSuspended(true);
    expect(r.clock.pending.size).toBe(0);
    r.loop.wake();
    r.loop.setPaused(true);
    r.loop.setPaused(false);
    expect(r.clock.pending.size).toBe(0);
    r.loop.setSuspended(false);
    expect(r.clock.pending.size).toBe(1);
  });

  it("kept awake, it draws every frame whether or not anything moves, and rests a second after it is let go", () => {
    const r = rig();
    r.loop.start();
    runOut(r);
    r.loop.setKeepAwake(true);
    expect(r.loop.keptAwake).toBe(true);
    expect(r.clock.pending.size).toBe(1);
    for (let i = 0; i < 600; i += 1) expect(r.clock.tick()).toBe(true);
    expect(r.clock.pending.size).toBe(1);
    // Kept awake does not mean drawn while hidden.
    r.loop.setPaused(true);
    expect(r.clock.pending.size).toBe(0);
    r.loop.setPaused(false);
    for (let i = 0; i < 10; i += 1) expect(r.clock.tick()).toBe(true);
    r.loop.setKeepAwake(false);
    const fired = runOut(r);
    expect(fired).toBeGreaterThanOrEqual(59);
    expect(fired).toBeLessThanOrEqual(62);
    expect(r.loop.resting).toBe(true);
  });

  it("a frame that throws does not end the loop, and does not keep it awake either", () => {
    const r = rig();
    r.loop.start();
    r.clock.tick();
    r.during = () => {
      throw new Error("a frame failed");
    };
    expect(() => r.clock.tick()).toThrow("a frame failed");
    expect(r.clock.pending.size).toBe(1);
    const fired = runOut(r);
    expect(fired).toBeGreaterThan(50);
    expect(fired).toBeLessThanOrEqual(62);
    expect(r.clock.pending.size).toBe(0);
  });

  it("a frame that pauses or disposes the loop is the last one", () => {
    const paused = rig();
    paused.busy = true;
    paused.loop.start();
    paused.during = () => paused.loop.setPaused(true);
    paused.clock.tick();
    expect(paused.clock.pending.size).toBe(0);

    const gone = rig();
    gone.busy = true;
    gone.loop.start();
    gone.during = () => gone.loop.dispose();
    gone.clock.tick();
    expect(gone.clock.pending.size).toBe(0);
    expect(gone.loop.frames).toBe(1);
  });

  it("disposed, it leaves no request behind and nothing can start it again", () => {
    const r = rig();
    r.busy = true;
    r.loop.start();
    r.clock.tick();
    r.loop.dispose();
    expect(r.clock.pending.size).toBe(0);
    r.loop.dispose();
    r.loop.wake();
    r.loop.start();
    r.loop.setKeepAwake(true);
    r.loop.setPaused(true);
    r.loop.setPaused(false);
    r.loop.setSuspended(false);
    expect(r.clock.pending.size).toBe(0);
    expect(r.clock.requested).toBe(r.clock.cancelled + r.loop.frames);
    expect(r.loop.frames).toBe(1);

    // Disposed at rest, and before it ever started: the same.
    const resting = rig();
    resting.loop.start();
    runOut(resting);
    resting.loop.dispose();
    resting.loop.wake();
    expect(resting.clock.pending.size).toBe(0);
    const unborn = rig();
    unborn.loop.dispose();
    unborn.loop.start();
    expect(unborn.clock.requested).toBe(0);
  });

  it("never has two requests out, through any order of pauses, wakes, losses and frames", () => {
    const r = rig();
    r.loop.start();
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 5000; i += 1) {
      const roll = random();
      if (roll < 0.5) r.clock.tick();
      else if (roll < 0.6) r.loop.wake();
      else if (roll < 0.7) r.loop.setPaused(random() < 0.5);
      else if (roll < 0.8) r.loop.setSuspended(random() < 0.5);
      else if (roll < 0.9) r.loop.setKeepAwake(random() < 0.5);
      else r.busy = random() < 0.5;
      expect(r.clock.pending.size).toBeLessThanOrEqual(1);
    }
    // Every request was either played or cancelled, bar the one that may be out now.
    expect(r.clock.requested).toBe(r.loop.frames + r.clock.cancelled + r.clock.pending.size);
    r.loop.dispose();
    expect(r.clock.pending.size).toBe(0);
  });
});
