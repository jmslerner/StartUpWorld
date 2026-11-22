import { describe, expect, it } from "vitest";
import { AdaptiveQualityGovernor, type AdaptiveStep, WARM_UP_MS, WINDOW_MS } from "./adaptiveQuality";

const HIGH = [2, 1.5, 1] as const;
const LOW = [1.5, 1] as const;

interface Frame {
  /** requestAnimationFrame interval (ms) leading into this frame. */
  interval: number;
  /** Measured update + render time (ms). */
  work: number;
}

interface StepAt {
  step: AdaptiveStep;
  /** Real time (ms since the governor was created) at which it was returned. */
  at: number;
}

/** A deterministic PRNG so jittered timings are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

class Sim {
  time = 0;
  readonly governor: AdaptiveQualityGovernor;
  readonly steps: StepAt[] = [];
  dpr: number;

  constructor(options: { steps?: readonly number[]; shadows?: boolean; dpr?: number } = {}) {
    this.dpr = options.dpr ?? 2;
    this.governor = new AdaptiveQualityGovernor({
      steps: options.steps ?? HIGH,
      canDropShadows: options.shadows ?? true,
      now: () => this.time,
    });
  }

  /** Run frames from `frame(i, t)` until `untilMs` of real time has passed. */
  run(untilMs: number, frame: (index: number, time: number) => Frame): this {
    let i = 0;
    while (this.time < untilMs) {
      const { interval, work } = frame(i++, this.time);
      this.time += interval;
      const step = this.governor.sample(interval, work, this.dpr);
      if (step !== "none") this.steps.push({ step, at: this.time });
    }
    return this;
  }

  stepNames(): AdaptiveStep[] {
    return this.steps.map((entry) => entry.step);
  }
}

/** A steady display at `hz` with light (1-2 ms) work and ±0.5 ms of timestamp jitter. */
function steady(hz: number, seed = 1): (index: number) => Frame {
  const random = rng(seed);
  const vsync = 1000 / hz;
  return () => ({ interval: vsync + (random() - 0.5), work: 1 + random() });
}

/** The first frames after mount: a blocking first draw and a few shader compiles. */
function withMountHitches(base: (index: number) => Frame): (index: number) => Frame {
  const hitches = [400, 250, 120, 90, 60];
  return (index) => (index < hitches.length ? { interval: hitches[index], work: hitches[index] * 0.9 } : base(index));
}

describe("AdaptiveQualityGovernor: light work never steps", () => {
  for (const hz of [60, 120, 144]) {
    it(`at a steady ${hz} Hz, including the hitchy first frames after mount`, () => {
      const sim = new Sim().run(60_000, withMountHitches(steady(hz, hz)));
      expect(sim.steps).toEqual([]);
      expect(sim.governor.pixelRatioCap).toBe(2);
      expect(sim.governor.shadowsOff).toBe(false);
    });

    it(`at ${hz} Hz through stage rebuilds (two clamped 100 ms+ frames each), with or without warmUp()`, () => {
      for (const callWarmUp of [true, false]) {
        const base = steady(hz, hz + 7);
        const sim = new Sim();
        let nextRebuild = 5_000;
        let hitchFrames = 0;
        sim.run(60_000, (index, time) => {
          if (time >= nextRebuild) {
            nextRebuild += 7_000;
            hitchFrames = 3;
            if (callWarmUp) sim.governor.warmUp();
          }
          if (hitchFrames > 0) {
            hitchFrames--;
            return hitchFrames === 0 ? { interval: 40, work: 20 } : { interval: 180, work: 150 };
          }
          return base(index);
        });
        expect(sim.steps).toEqual([]);
      }
    });
  }

  for (const hz of [30, 48, 50]) {
    it(`at a steady ${hz} Hz display or browser cap (Low Power Mode, Energy Saver, 50 Hz monitors)`, () => {
      const sim = new Sim().run(60_000, withMountHitches(steady(hz, hz)));
      expect(sim.steps).toEqual([]);
    });
  }

  it("on a 30 fps browser cap that sometimes holds a frame for a third vsync", () => {
    const random = rng(30);
    const sim = new Sim().run(60_000, () => ({ interval: random() < 0.05 ? 50 : 33.33, work: 1.5 }));
    expect(sim.steps).toEqual([]);
  });

  it("with the occasional GC pause or long task at 60 Hz", () => {
    const random = rng(99);
    const sim = new Sim().run(60_000, () => {
      const r = random();
      if (r < 0.01) return { interval: 130, work: 60 };
      if (r < 0.06) return { interval: 33.33, work: 8 };
      return { interval: 16.67, work: 2 };
    });
    expect(sim.steps).toEqual([]);
  });
});

describe("AdaptiveQualityGovernor: sustained real overload steps down", () => {
  it("CPU-bound: work over budget on every frame (uniform half rate on a 60 Hz screen)", () => {
    const sim = new Sim().run(20_000, () => ({ interval: 33.33, work: 25 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
    expect(sim.governor.pixelRatioCap).toBe(1);
    expect(sim.governor.shadowsOff).toBe(true);
    // Warm-up then one full window before the first step; warm-up + window between steps.
    expect(sim.steps[0].at).toBeGreaterThanOrEqual(WARM_UP_MS + WINDOW_MS);
    expect(sim.steps[0].at).toBeLessThan(WARM_UP_MS + WINDOW_MS + 100);
    for (let i = 1; i < sim.steps.length; i++) {
      expect(sim.steps[i].at - sim.steps[i - 1].at).toBeGreaterThanOrEqual(WARM_UP_MS + WINDOW_MS);
    }
  });

  it("GPU-bound: half the frames miss vsync at 60 Hz with light CPU work", () => {
    const sim = new Sim().run(20_000, (index) => ({ interval: index % 2 === 0 ? 16.67 : 33.33, work: 2 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });

  it("GPU-bound on a 144 Hz screen: a third of frames take two or three vsyncs", () => {
    const vsync = 1000 / 144;
    const sim = new Sim().run(20_000, (index) => ({ interval: index % 3 === 0 ? vsync * (2 + (index % 2)) : vsync, work: 3 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });

  it("below 10 fps, where every frame is a clamped outlier", () => {
    const sim = new Sim().run(30_000, () => ({ interval: 150, work: 5 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });

  it("a steady 15 fps GPU-bound cadence (slower than any real display or browser cap)", () => {
    const sim = new Sim().run(30_000, () => ({ interval: 66.67, work: 2 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });

  it("documented limitation: a perfectly uniform 30 fps GPU-bound cadence reads as a 30 Hz display", () => {
    const sim = new Sim().run(30_000, () => ({ interval: 33.33, work: 2 }));
    expect(sim.steps).toEqual([]);
  });

  it("once everything is shed the ladder is a no-op, however slow the frames stay", () => {
    const sim = new Sim().run(120_000, () => ({ interval: 33.33, work: 40 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });
});

describe("AdaptiveQualityGovernor: warm-up", () => {
  it("ignores the first WARM_UP_MS after mount, however slow", () => {
    const sim = new Sim().run(30_000, (_index, time) =>
      time < WARM_UP_MS - 100 ? { interval: 90, work: 80 } : { interval: 16.67, work: 2 },
    );
    expect(sim.steps).toEqual([]);
  });

  it("ignores the frames right after warmUp() (a rebuild, a layout apply, a resume)", () => {
    const sim = new Sim();
    sim.run(10_000, steady(60));
    sim.governor.warmUp();
    const resumedAt = sim.time;
    sim.run(30_000, (_index, time) =>
      time - resumedAt < WARM_UP_MS - 100 ? { interval: 50, work: 40 } : { interval: 16.67, work: 2 },
    );
    expect(sim.steps).toEqual([]);
  });

  it("warmUp() discards a half-collected overloaded window", () => {
    const sim = new Sim();
    sim.run(WARM_UP_MS + WINDOW_MS - 200, () => ({ interval: 33.33, work: 30 }));
    sim.governor.warmUp();
    const after = sim.time;
    sim.run(after + WARM_UP_MS - 100, () => ({ interval: 33.33, work: 30 }));
    sim.run(30_000, steady(60));
    expect(sim.steps).toEqual([]);
  });

  it("treats a gap far beyond the clamp (hidden tab, debugger) as a restart", () => {
    const sim = new Sim();
    sim.run(10_000, steady(60));
    // The tab comes back: one huge interval, then slow re-raster frames for a while.
    let first = true;
    const backAt = sim.time;
    sim.run(30_000, (_index, time) => {
      if (first) {
        first = false;
        return { interval: 45_000, work: 3 };
      }
      return time - backAt < 45_000 + WARM_UP_MS - 100 ? { interval: 60, work: 50 } : { interval: 16.67, work: 2 };
    });
    expect(sim.steps).toEqual([]);
  });

  it("excludes the frames right after a step (the resize or shader recompile it causes)", () => {
    const sim = new Sim();
    let stepCount = 0;
    let lastStepAt = Number.NEGATIVE_INFINITY;
    sim.run(30_000, (_index, time) => {
      if (sim.steps.length !== stepCount) {
        stepCount = sim.steps.length;
        lastStepAt = time;
      }
      // Overloaded until the first step; afterwards only the post-step settling frames are slow.
      if (stepCount === 0) return { interval: 33.33, work: 25 };
      return time - lastStepAt < WARM_UP_MS - 100 ? { interval: 120, work: 110 } : { interval: 16.67, work: 2 };
    });
    expect(sim.stepNames()).toEqual(["pixel-ratio"]);
  });
});

describe("AdaptiveQualityGovernor: real-time clock", () => {
  it("times warm-ups and windows in real time, even at 5 fps where every frame would be clamped", () => {
    const sim = new Sim().run(30_000, () => ({ interval: 200, work: 5 }));
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
    expect(sim.steps[0].at).toBeGreaterThanOrEqual(WARM_UP_MS + WINDOW_MS);
    expect(sim.steps[0].at).toBeLessThanOrEqual(WARM_UP_MS + WINDOW_MS + 400);
    expect(sim.steps[2].at).toBeLessThanOrEqual(3 * (WARM_UP_MS + WINDOW_MS) + 3 * 400);
  });
});

describe("AdaptiveQualityGovernor: only rungs that lower the effective ratio", () => {
  const overload = (): Frame => ({ interval: 33.33, work: 25 });

  it("DPR 1, high: the first step is shadows off, and nothing follows", () => {
    const sim = new Sim({ dpr: 1 }).run(60_000, overload);
    expect(sim.stepNames()).toEqual(["shadows"]);
    expect(sim.steps[0].at).toBeLessThan(WARM_UP_MS + WINDOW_MS + 100);
  });

  for (const dpr of [1.25, 1.5]) {
    it(`DPR ${dpr}, high: straight to cap 1, then shadows`, () => {
      const sim = new Sim({ dpr }).run(60_000, overload);
      expect(sim.stepNames()).toEqual(["pixel-ratio", "shadows"]);
      expect(sim.governor.pixelRatioCap).toBe(1);
    });
  }

  it("DPR 2, high: every rung", () => {
    const sim = new Sim({ dpr: 2 }).run(60_000, overload);
    expect(sim.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });

  it("re-evaluates the effective ratio when devicePixelRatio changes at runtime", () => {
    const sim = new Sim({ dpr: 1 }).run(20_000, overload);
    expect(sim.stepNames()).toEqual(["shadows"]);
    // The window moves to a Retina screen: the cap-2 world is now drawing at 2x again.
    sim.dpr = 2;
    sim.governor.warmUp();
    sim.run(40_000, overload);
    expect(sim.stepNames()).toEqual(["shadows", "pixel-ratio", "pixel-ratio"]);
    expect(sim.governor.pixelRatioCap).toBe(1);
  });

  it("survives a nonsensical devicePixelRatio", () => {
    for (const dpr of [0, Number.NaN, -1]) {
      const sim = new Sim({ dpr }).run(30_000, overload);
      expect(sim.stepNames()).toEqual(["shadows"]);
    }
  });
});

describe("AdaptiveQualityGovernor: low quality and the floor", () => {
  const overload = (): Frame => ({ interval: 33.33, work: 25 });

  it("a low world on DPR 2 steps 1.5 -> 1 and then stays put", () => {
    const sim = new Sim({ steps: LOW, shadows: false, dpr: 2 }).run(60_000, overload);
    expect(sim.stepNames()).toEqual(["pixel-ratio"]);
    expect(sim.governor.pixelRatioCap).toBe(1);
    expect(sim.governor.shadowsOff).toBe(false);
  });

  it("a low world on DPR 1 has nothing to shed", () => {
    const sim = new Sim({ steps: LOW, shadows: false, dpr: 1 }).run(60_000, overload);
    expect(sim.steps).toEqual([]);
  });

  it("ignores invalid samples", () => {
    const sim = new Sim();
    expect(sim.governor.sample(Number.NaN, 2, 2)).toBe("none");
    expect(sim.governor.sample(16, -1, 2)).toBe("none");
  });

  it("judges a full ring buffer early on a very fast display without breaking", () => {
    const sim = new Sim().run(20_000, () => ({ interval: 1000 / 360, work: 1 }));
    expect(sim.steps).toEqual([]);
    const overloaded = new Sim().run(20_000, (index) => ({ interval: (1000 / 360) * (index % 2 === 0 ? 1 : 3), work: 1 }));
    expect(overloaded.stepNames()).toEqual(["pixel-ratio", "pixel-ratio", "shadows"]);
  });
});
