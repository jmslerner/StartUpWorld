import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraRig } from "../core/CameraRig";
import { getOfficeLayout } from "../office/layouts";
import { REBUILD_RISE_DELAY, REBUILD_RISE_SECONDS } from "../office/timing";
import { scene as sceneOf, Studio } from "../people/testKit";
import type { BurstKind, OfficeScene, QualityLevel, SceneEvent, WorldFrame } from "../types";
import { lowestFreeSlot } from "./FloatTextLayer";
import { formatCompact, formatCountDelta, formatHeadcountDelta, formatSignedCount } from "./format";
import { doorCounts, FxSystem, particleBudget, REDUCED_TEXT_SECONDS, SHAKE_SECONDS } from "./FxSystem";
import {
  BURST_KINDS,
  KIND_PROFILES,
  ParticlePool,
  SLOT_BALLISTIC,
  SLOT_FREE,
  SLOT_STREAM,
  STREAM_SECONDS,
} from "./particles";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Small deterministic PRNG (mulberry32) so particle tests are repeatable. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const FRAME = 1 / 60;

const run = (pool: ParticlePool, seconds: number, each?: () => void): void => {
  for (let t = 0; t < seconds; t += FRAME) {
    pool.step(FRAME);
    each?.();
  }
};

const live = (pool: ParticlePool): number[] => {
  const indices: number[] = [];
  for (let i = 0; i < pool.capacity; i += 1) if (pool.state[i] !== SLOT_FREE) indices.push(i);
  return indices;
};

const ORIGIN = { x: 0, y: 1, z: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// Number formatting
// ─────────────────────────────────────────────────────────────────────────────

describe("float text formatting", () => {
  it("shows small numbers in full and abbreviates large ones", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(340)).toBe("340");
    expect(formatCompact(3000)).toBe("3,000");
    expect(formatCompact(9999)).toBe("9,999");
    expect(formatCompact(10_000)).toBe("10K");
    expect(formatCompact(12_400)).toBe("12.4K");
    expect(formatCompact(250_000)).toBe("250K");
    expect(formatCompact(1_234_567)).toBe("1.2M");
    expect(formatCompact(40_000_000)).toBe("40M");
    expect(formatCompact(2_500_000_000)).toBe("2.5B");
    expect(formatCompact(1_000_000_000_000)).toBe("1T");
  });

  it("never prints a four-digit mantissa", () => {
    expect(formatCompact(999_499)).toBe("999K");
    expect(formatCompact(999_950)).toBe("1M");
    expect(formatCompact(99_960)).toBe("100K");
    expect(formatCompact(999_999_999)).toBe("1B");
  });

  it("drops the sign and rounds fractions", () => {
    expect(formatCompact(-3000)).toBe("3,000");
    expect(formatCompact(12.6)).toBe("13");
    expect(formatCompact(Number.NaN)).toBe("0");
  });

  it("formats signed deltas with a real minus sign", () => {
    expect(formatCountDelta(340, "users")).toBe("+340 users");
    expect(formatCountDelta(-3, "rep")).toBe("−3 rep");
    expect(formatHeadcountDelta(1, "product")).toBe("+1 Product");
    expect(formatHeadcountDelta(-2, "growth")).toBe("−2 Growth");
    expect(formatHeadcountDelta(3, "recruiting")).toBe("+3 Recruiting");
    expect(formatSignedCount(2)).toBe("+2");
    expect(formatSignedCount(-1)).toBe("−1");
    expect(formatSignedCount(-12_400)).toBe("−12.4K");
  });
});

describe("float text stacking", () => {
  it("gives simultaneous texts their own lines, lowest first", () => {
    expect(lowestFreeSlot(0b0)).toBe(0);
    expect(lowestFreeSlot(0b1)).toBe(1);
    expect(lowestFreeSlot(0b111)).toBe(3);
  });

  it("reuses a line as soon as it is free again", () => {
    expect(lowestFreeSlot(0b110)).toBe(0);
    expect(lowestFreeSlot(0b1011)).toBe(2);
  });

  it("never climbs without bound, however many texts pile up", () => {
    const top = lowestFreeSlot(0xffff);
    expect(top).toBeLessThan(10);
    expect(lowestFreeSlot(0xffff | (1 << top))).toBe(top);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Budgets
// ─────────────────────────────────────────────────────────────────────────────

describe("particle budgets", () => {
  it("halves the load on low quality and cuts it hard for reduced motion", () => {
    const high = particleBudget("high", false);
    const low = particleBudget("low", false);
    const calm = particleBudget("high", true);
    expect(high).toEqual({ capacity: 600, density: 1 });
    expect(low.capacity).toBeLessThanOrEqual(high.capacity / 2);
    expect(low.density).toBe(0.5);
    expect(calm.capacity).toBeLessThan(low.capacity);
    expect(calm.density).toBeLessThan(low.density);
    expect(particleBudget("low", true)).toEqual(calm);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Particle pool
// ─────────────────────────────────────────────────────────────────────────────

describe("ParticlePool", () => {
  it("spawns exactly what was asked for and retires everything by the end of its life", () => {
    for (const kind of BURST_KINDS) {
      const pool = new ParticlePool(200, seeded(1));
      pool.spawnBurst(kind, ORIGIN, 25);
      expect(pool.activeCount).toBe(25);
      for (const i of live(pool)) {
        expect(pool.state[i]).toBe(SLOT_BALLISTIC);
        expect(BURST_KINDS[pool.kind[i]]).toBe(kind);
      }
      run(pool, KIND_PROFILES[kind].life[1] + 0.1);
      expect(pool.activeCount).toBe(0);
    }
  });

  it("drops the oldest particles when the ring is full", () => {
    const pool = new ParticlePool(50, seeded(2));
    pool.spawnBurst("smoke", ORIGIN, 50);
    expect(pool.activeCount).toBe(50);
    pool.spawnBurst("confetti", ORIGIN, 20);
    expect(pool.activeCount).toBe(50);
    const kinds = live(pool).map((i) => BURST_KINDS[pool.kind[i]]);
    expect(kinds.filter((kind) => kind === "confetti")).toHaveLength(20);
    expect(kinds.filter((kind) => kind === "smoke")).toHaveLength(30);

    // Far more than fits: only the newest survive, and nothing breaks.
    pool.spawnBurst("sparkle", ORIGIN, 500);
    expect(pool.activeCount).toBe(50);
    expect(live(pool).every((i) => BURST_KINDS[pool.kind[i]] === "sparkle")).toBe(true);
  });

  it("keeps every value finite for every kind", () => {
    const pool = new ParticlePool(400, seeded(3));
    for (const kind of BURST_KINDS) pool.spawnBurst(kind, ORIGIN, 30);
    pool.spawnStream("users", { x: 4, y: 0.3, z: 4 }, { x: -3, y: 1, z: -3 }, 20);
    let checked = 0;
    let broken = 0;
    run(pool, 3, () => {
      for (const i of live(pool)) {
        const scale = pool.scaleOf(i);
        const sum = pool.px[i] + pool.py[i] + pool.pz[i] + pool.rot[i] + scale;
        checked += 1;
        if (!Number.isFinite(sum) || scale < 0) broken += 1;
      }
    });
    expect(checked).toBeGreaterThan(10_000);
    expect(broken).toBe(0);
    expect(pool.activeCount).toBe(0);
  });

  it("does nothing for a zero or negative time step", () => {
    const pool = new ParticlePool(10, seeded(4));
    pool.spawnBurst("confetti", ORIGIN, 5);
    const before = Array.from(pool.py);
    pool.step(0);
    pool.step(-1);
    expect(Array.from(pool.py)).toEqual(before);
  });

  it("throws confetti upward, then lets it flutter down and settle on the floor", () => {
    const pool = new ParticlePool(64, seeded(5));
    pool.spawnBurst("confetti", ORIGIN, 40);
    const indices = live(pool);
    for (const i of indices) expect(pool.vy[i]).toBeGreaterThan(0);

    let highest = 0;
    let lowest = Infinity;
    run(pool, 3, () => {
      for (const i of live(pool)) {
        highest = Math.max(highest, pool.py[i]);
        lowest = Math.min(lowest, pool.py[i]);
      }
    });
    expect(highest).toBeGreaterThan(ORIGIN.y + 0.4);
    // Paper lands on the floor; it never falls through it.
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(lowest).toBeLessThan(ORIGIN.y);
  });

  it("stops settled particles where they land and shrinks them away", () => {
    const pool = new ParticlePool(16, seeded(6));
    pool.spawnBurst("confetti", { x: 0, y: 0.05, z: 0 }, 16);
    run(pool, 1.2);
    const grounded = live(pool).filter((i) => pool.grounded[i] === 1);
    expect(grounded.length).toBeGreaterThan(0);
    const spot = grounded.map((i) => [pool.px[i], pool.py[i], pool.pz[i]]);
    pool.step(FRAME);
    grounded.forEach((i, n) => {
      if (pool.state[i] === SLOT_FREE) return;
      expect([pool.px[i], pool.py[i], pool.pz[i]]).toEqual(spot[n]);
    });
    // Landing shortens their life, so they do not litter the floor.
    run(pool, 0.6);
    expect(grounded.every((i) => pool.state[i] === SLOT_FREE)).toBe(true);
  });

  it("makes smoke, sparkles and hearts rise", () => {
    for (const kind of ["smoke", "sparkle", "hearts"] satisfies BurstKind[]) {
      const pool = new ParticlePool(32, seeded(7));
      pool.spawnBurst(kind, ORIGIN, 20);
      const start = live(pool).reduce((sum, i) => sum + pool.py[i], 0) / 20;
      run(pool, 0.5);
      const indices = live(pool);
      const after = indices.reduce((sum, i) => sum + pool.py[i], 0) / indices.length;
      expect(after).toBeGreaterThan(start + 0.15);
    }
  });

  it("starts money overhead and lets it drift down", () => {
    const pool = new ParticlePool(32, seeded(8));
    pool.spawnBurst("money", ORIGIN, 20);
    for (const i of live(pool)) expect(pool.py[i]).toBeGreaterThan(ORIGIN.y + 1);
    const start = live(pool).map((i) => pool.py[i]);
    run(pool, 1);
    live(pool).forEach((i, n) => expect(pool.py[i]).toBeLessThan(start[n]));
  });

  it("drops bugs to the floor and sends them scurrying outward", () => {
    const pool = new ParticlePool(32, seeded(9));
    pool.spawnBurst("bugs", ORIGIN, 12);
    run(pool, 0.9);
    const indices = live(pool);
    expect(indices.length).toBe(12);
    for (const i of indices) {
      expect(pool.grounded[i]).toBe(1);
      expect(pool.py[i]).toBeLessThan(0.1);
      expect(Math.hypot(pool.px[i], pool.pz[i])).toBeGreaterThan(0.5);
    }
    // Still running, not parked.
    const before = indices.map((i) => [pool.px[i], pool.pz[i]]);
    pool.step(FRAME);
    indices.forEach((i, n) => expect(Math.hypot(pool.px[i] - before[n][0], pool.pz[i] - before[n][1])).toBeGreaterThan(0));
  });

  it("bounces people-pegs on the floor without ever sinking into it", () => {
    const pool = new ParticlePool(32, seeded(10));
    pool.spawnBurst("users", { x: 0, y: 0.2, z: 0 }, 10);
    let bounced = false;
    const previous = new Map<number, number>();
    run(pool, 1.4, () => {
      for (const i of live(pool)) {
        expect(pool.py[i]).toBeGreaterThan(0);
        const last = previous.get(i);
        if (last !== undefined && last < 0 && pool.vy[i] > 0) bounced = true;
        previous.set(i, pool.vy[i]);
      }
    });
    expect(bounced).toBe(true);
  });

  it("shrinks particles in and out instead of popping them", () => {
    const pool = new ParticlePool(4, seeded(11));
    pool.spawnBurst("hearts", ORIGIN, 1);
    const [i] = live(pool);
    expect(pool.scaleOf(i)).toBeCloseTo(0, 9);
    let peak = 0;
    let last = 0;
    run(pool, pool.life[i] - 2 * FRAME, () => {
      last = pool.scaleOf(i);
      peak = Math.max(peak, last);
    });
    expect(peak).toBeGreaterThan(KIND_PROFILES.hearts.size[0]);
    expect(last).toBeLessThan(peak * 0.15);
  });

  it("clears on demand", () => {
    const pool = new ParticlePool(32, seeded(12));
    pool.spawnBurst("confetti", ORIGIN, 20);
    pool.spawnStream("sparkle", ORIGIN, { x: 3, y: 1, z: 3 }, 5);
    pool.clear();
    expect(pool.activeCount).toBe(0);
    pool.step(FRAME);
    expect(pool.arrivalCount).toBe(0);
  });
});

describe("ParticlePool streams", () => {
  const from = { x: 4, y: 0.3, z: 3 };
  const to = { x: -2, y: 1.1, z: -3 };

  it("staggers departures and delivers every particle to the destination", () => {
    const pool = new ParticlePool(64, seeded(20));
    pool.spawnStream("users", from, to, 10);
    const indices = live(pool);
    expect(indices).toHaveLength(10);
    for (const i of indices) expect(pool.state[i]).toBe(SLOT_STREAM);

    // Not everyone has set off after the first frame.
    pool.step(FRAME);
    const waiting = indices.filter((i) => pool.scaleOf(i) === 0);
    expect(waiting.length).toBeGreaterThan(5);

    let arrivals = 0;
    const landings: number[][] = [];
    run(pool, STREAM_SECONDS * 1.1 + 1, () => {
      for (let n = 0; n < pool.arrivalCount; n += 1) {
        arrivals += 1;
        landings.push(Array.from(pool.arrivals.subarray(n * 4, n * 4 + 4)));
      }
    });
    expect(arrivals).toBe(10);
    expect(pool.activeCount).toBe(0);
    for (const [x, y, z, kindId] of landings) {
      expect(Math.hypot(x - to.x, y - to.y, z - to.z)).toBeLessThan(0.3);
      expect(BURST_KINDS[kindId]).toBe("users");
    }
  });

  it("flies an arc: above both ends in the middle, close to the destination at the end", () => {
    const pool = new ParticlePool(8, seeded(21));
    pool.spawnStream("sparkle", from, to, 1);
    const [i] = live(pool);
    let highest = -Infinity;
    let closest = Infinity;
    run(pool, 2, () => {
      if (pool.state[i] === SLOT_FREE || pool.scaleOf(i) === 0) return;
      highest = Math.max(highest, pool.py[i]);
      closest = Math.min(closest, Math.hypot(pool.px[i] - to.x, pool.py[i] - to.y, pool.pz[i] - to.z));
    });
    expect(highest).toBeGreaterThan(Math.max(from.y, to.y) + 0.5);
    expect(closest).toBeLessThan(0.3);
  });

  it("takes about the advertised time per particle", () => {
    const pool = new ParticlePool(8, seeded(22));
    pool.spawnStream("money", from, to, 1);
    let elapsed = 0;
    while (pool.activeCount > 0 && elapsed < 5) {
      pool.step(FRAME);
      elapsed += FRAME;
    }
    expect(elapsed).toBeGreaterThan(STREAM_SECONDS * 0.85);
    expect(elapsed).toBeLessThan(STREAM_SECONDS * 1.3);
  });

  it("copes with a zero-length stream and a zero count", () => {
    const pool = new ParticlePool(8, seeded(23));
    pool.spawnStream("users", from, to, 0);
    expect(pool.activeCount).toBe(0);
    pool.spawnStream("users", from, from, 3);
    run(pool, 2, () => {
      for (const i of live(pool)) expect(Number.isFinite(pool.px[i] + pool.py[i] + pool.pz[i])).toBe(true);
    });
    expect(pool.activeCount).toBe(0);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Who came and who went, as numbers
// ─────────────────────────────────────────────────────────────────────────────

/** Frames as the world hands them out: each scene with its cast and events, and the frame before. */
const frames = (...scenes: OfficeScene[]): { next: WorldFrame; prev: WorldFrame | null } => {
  const studio = new Studio();
  let last = studio.frame(scenes[0]);
  for (const scene of scenes.slice(1)) last = studio.frame(scene);
  return { next: last.next, prev: last.prev };
};

const counts = (...scenes: OfficeScene[]): { arrived: number; left: number } => {
  const { next, prev } = frames(...scenes);
  return doorCounts(next, prev);
};

describe("the numbers at the door", () => {
  it("come from the cast's lists while everyone is drawn", () => {
    // Three hires: three new faces at desks.
    expect(counts(sceneOf([2, 1, 0]), sceneOf([3, 2, 1]))).toEqual({ arrived: 3, left: 0 });
    // The year moves on: the two who were let go are gone, and one new person starts.
    expect(counts(sceneOf([2, 1, 0], { leaving: 2 }), sceneOf([3, 1, 0], { year: 1991 }))).toEqual({ arrived: 1, left: 2 });
  });

  it("count somebody expected when they appear at the door, and not again when they are hired", () => {
    const waiting = sceneOf([2, 1, 0], { arriving: 2 });
    expect(counts(sceneOf([2, 1, 0]), waiting)).toEqual({ arrived: 2, left: 0 });
    expect(counts(sceneOf([2, 1, 0]), waiting, sceneOf([3, 2, 0], { year: 1991 }))).toEqual({ arrived: 0, left: 0 });
    // Expected hires that are called off walk away from the door.
    expect(counts(sceneOf([2, 1, 0]), waiting, sceneOf([2, 1, 0]))).toEqual({ arrived: 0, left: 2 });
  });

  it("say nothing for a fresh cast: the first frame, another run, an earlier year", () => {
    expect(counts(sceneOf([3, 2, 1]))).toEqual({ arrived: 0, left: 0 });
    expect(counts(sceneOf([3, 2, 1]), sceneOf([5, 5, 5], { runId: "another" }))).toEqual({ arrived: 0, left: 0 });
    expect(counts(sceneOf([3, 2, 1], { year: 1995 }), sceneOf([5, 5, 5], { year: 1990 }))).toEqual({ arrived: 0, left: 0 });
    // The same, past the cap, where the numbers come from the scenes.
    expect(counts(sceneOf([30, 30, 30]))).toEqual({ arrived: 0, left: 0 });
    expect(counts(sceneOf([30, 30, 30]), sceneOf([60, 60, 60], { runId: "another" }))).toEqual({ arrived: 0, left: 0 });
    expect(counts(sceneOf([30, 30, 30], { year: 1995 }), sceneOf([60, 60, 60], { year: 1990 }))).toEqual({ arrived: 0, left: 0 });
  });

  it("come from the head counts once more people work here than are drawn", () => {
    // 60 people and 5 let go; next year 70 work here. The drawn 50 hardly change, the company does.
    const before = sceneOf([20, 20, 20], { leaving: 5, office: 4, capacity: 150 });
    const after = sceneOf([30, 20, 20], { year: 1991, office: 4, capacity: 150 });
    const { next, prev } = frames(before, after);
    expect(prev?.cast.hidden).toBeGreaterThan(0);
    expect(next.cast.hidden).toBeGreaterThan(0);
    expect(doorCounts(next, prev)).toEqual({ arrived: 10, left: 5 });
    // The cast's lists would have told another story: they only know the 50 who are drawn.
    expect(next.cast.arrived.length).not.toBe(10);
  });

  it("use the head counts when only one of the two casts is past the cap", () => {
    // Growing past it: 45 → 80, though only five new faces are drawn.
    const grown = frames(sceneOf([15, 15, 15]), sceneOf([30, 25, 25], { year: 1991 }));
    expect(grown.prev?.cast.hidden).toBe(0);
    expect(grown.next.cast.hidden).toBe(30);
    expect(grown.next.cast.arrived).toHaveLength(5);
    expect(doorCounts(grown.next, grown.prev)).toEqual({ arrived: 35, left: 0 });
    // Shrinking back under it: 80 people of whom 40 were let go, then 40 the year after.
    const shrunk = frames(sceneOf([20, 10, 10], { leaving: 40 }), sceneOf([20, 10, 10], { year: 1991 }));
    expect(shrunk.prev?.cast.hidden).toBe(30);
    expect(shrunk.next.cast.hidden).toBe(0);
    expect(doorCounts(shrunk.next, shrunk.prev)).toEqual({ arrived: 0, left: 40 });
  });

  it("past the cap nobody leaves within a year, and a plan that only moves people says nothing", () => {
    const year = sceneOf([30, 30, 30]);
    // Ten are let go in the plan: they stand at the door, still of the company, until the year has played out.
    expect(counts(year, sceneOf([30, 30, 20], { leaving: 10 }))).toEqual({ arrived: 0, left: 0 });
    expect(counts(year, sceneOf([40, 30, 20]))).toEqual({ arrived: 0, left: 0 });
    // A plan redrawn within the year, with people already at the door: still nobody has gone.
    expect(counts(sceneOf([30, 30, 20], { leaving: 10 }), sceneOf([30, 30, 25], { leaving: 5 }))).toEqual({ arrived: 0, left: 0 });
    // Somebody away raising money is of the company all the while: back at a desk the year after, nobody arrived.
    expect(counts(sceneOf([30, 30, 30], { away: 1 }), sceneOf([30, 30, 31], { year: 1991 }))).toEqual({ arrived: 0, left: 0 });
    // People expected at the door are not of the company yet: past the cap they count when they are hired.
    expect(counts(year, sceneOf([30, 30, 30], { arriving: 4 }))).toEqual({ arrived: 0, left: 0 });
    expect(counts(year, sceneOf([30, 30, 30], { arriving: 4 }), sceneOf([34, 30, 30], { year: 1991 }))).toEqual({ arrived: 4, left: 0 });
  });

  it("never goes below nothing, and reads odd counts as the cast does", () => {
    // Fewer people than the year before with nobody let go: no arrivals, and nobody the scene says left.
    expect(counts(sceneOf([30, 30, 30]), sceneOf([20, 20, 20], { year: 1991 }))).toEqual({ arrived: 0, left: 0 });
    // Everyone let go, and nobody after.
    expect(counts(sceneOf([0, 0, 0], { leaving: 90 }), sceneOf([0, 0, 0], { year: 1991 }))).toEqual({ arrived: 0, left: 90 });
    // Half a person, a negative team and a team that is not a number are nobody.
    const odd = sceneOf([60.9, -4, Number.NaN], { leaving: 2.5, away: Number.POSITIVE_INFINITY });
    expect(counts(odd, sceneOf([70, 0, 0], { year: 1991 }))).toEqual({ arrived: 10, left: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FxSystem (runs without a DOM: sprites are simply skipped)
// ─────────────────────────────────────────────────────────────────────────────

const layout = getOfficeLayout(1);

const makeFx = (
  quality: QualityLevel = "high",
  reducedMotion = false
): { fx: FxSystem; scene: THREE.Scene; shakes: number[]; texts: { text: string; x: number; z: number; tone: string | undefined }[] } => {
  const scene = new THREE.Scene();
  const shakes: number[] = [];
  const fx = new FxSystem({
    scene,
    quality,
    reducedMotion,
    getLayout: () => layout,
    unitsPerPixel: () => 0.02,
    shakeCamera: (strength) => shakes.push(strength),
    random: seeded(99),
  });
  const texts: { text: string; x: number; z: number; tone: string | undefined }[] = [];
  const floatText = fx.floatText.bind(fx);
  vi.spyOn(fx, "floatText").mockImplementation((text, at, tone) => {
    texts.push({ text, x: at.x, z: at.z, tone });
    floatText(text, at, tone);
  });
  return { fx, scene, shakes, texts };
};

const plain = sceneOf([3, 2, 1]);
const frameOf = (scene: OfficeScene, patch: { arrived?: string[]; left?: string[]; hidden?: number } = {}, events: SceneEvent[] = []): WorldFrame => ({
  scene,
  cast: { runId: scene.runId, year: scene.year, people: [], hidden: 0, arrived: [], left: [], nextId: 0, ...patch },
  events,
});
const still = frameOf(plain);
const moved: SceneEvent = { kind: "office-changed", from: 1, to: 2 };

const kindsAlive = (fx: FxSystem): BurstKind[] => {
  const kinds = new Set<BurstKind>();
  for (let i = 0; i < fx.particles.capacity; i += 1) {
    if (fx.particles.state[i] !== SLOT_FREE) kinds.add(BURST_KINDS[fx.particles.kind[i]]);
  }
  return [...kinds];
};

/** Run the effects until they say they are at rest; the seconds it took (at most `limit`). */
const secondsToRest = (fx: FxSystem, limit = 30): number => {
  let t = 0;
  while (fx.busy() && t < limit) {
    fx.update(FRAME, t);
    t += FRAME;
  }
  return t;
};

/** Just enough of a page for text and bubbles to be drawn: a canvas whose 2D context accepts anything. */
const stubDocument = (): void => {
  const ctx: object = new Proxy(
    {},
    {
      get: (_target, key) => (key === "measureText" ? () => ({ width: 40 }) : () => ctx),
      set: () => true,
    }
  );
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FxSystem", () => {
  it("adds one root to the scene and removes it on dispose", () => {
    const { fx, scene } = makeFx();
    expect(scene.children).toEqual([fx.root]);
    fx.burst("confetti", ORIGIN);
    fx.update(FRAME, FRAME);
    fx.dispose();
    expect(scene.children).toEqual([]);
    expect(fx.particles.activeCount).toBe(0);
  });

  it("emits bursts in proportion to intensity and quality", () => {
    const base = KIND_PROFILES.confetti.count;
    const high = makeFx("high").fx;
    high.burst("confetti", ORIGIN);
    expect(high.particles.activeCount).toBe(base);
    high.burst("confetti", ORIGIN, 2);
    expect(high.particles.activeCount).toBe(base * 3);

    const low = makeFx("low").fx;
    low.burst("confetti", ORIGIN);
    expect(low.particles.activeCount).toBe(Math.round(base * 0.5));

    const calm = makeFx("high", true).fx;
    calm.burst("confetti", ORIGIN);
    expect(calm.particles.activeCount).toBeLessThan(base * 0.5);
    expect(calm.particles.activeCount).toBeGreaterThan(0);
  });

  it("ignores empty requests and survives absurd ones", () => {
    const { fx } = makeFx();
    fx.burst("smoke", ORIGIN, 0);
    fx.burst("smoke", ORIGIN, -3);
    fx.stream("users", ORIGIN, { x: 1, y: 1, z: 1 }, 0);
    expect(fx.particles.activeCount).toBe(0);

    fx.burst("confetti", ORIGIN, 1e9);
    fx.stream("users", ORIGIN, { x: 1, y: 1, z: 1 }, 1e9);
    expect(fx.particles.activeCount).toBeLessThanOrEqual(fx.particles.capacity);
    fx.update(FRAME, FRAME);
  });

  it("pops a little something where each stream particle lands", () => {
    const { fx } = makeFx();
    fx.stream("users", { x: 3, y: 0.3, z: 3 }, { x: -2, y: 1, z: -2 }, 6);
    expect(fx.particles.activeCount).toBe(6);
    let sawPop = false;
    for (let t = 0; t < 2.5; t += FRAME) {
      fx.update(FRAME, t);
      for (let i = 0; i < fx.particles.capacity; i += 1) {
        if (fx.particles.state[i] !== SLOT_FREE && BURST_KINDS[fx.particles.kind[i]] === "sparkle") sawPop = true;
      }
    }
    expect(sawPop).toBe(true);
  });

  it("forwards shakes to the camera unless motion is reduced", () => {
    const moving = makeFx();
    moving.fx.shake(0.4);
    expect(moving.shakes).toEqual([0.4]);

    const calm = makeFx("high", true);
    calm.fx.shake(0.4);
    calm.fx.applyFrame(frameOf(plain, {}, [moved]), still);
    expect(calm.shakes).toEqual([]);
    // No dust rises either: under reduced motion a new office comes up still.
    expect(calm.fx.busy()).toBe(false);
    for (let t = 0; t < REBUILD_RISE_DELAY + REBUILD_RISE_SECONDS + 0.1; t += FRAME) calm.fx.update(FRAME, t);
    expect(kindsAlive(calm.fx)).toEqual([]);
    expect(calm.fx.busy()).toBe(false);
  });

  it("under reduced motion the numbers at the door stand still, and are gone within a second", () => {
    expect(REDUCED_TEXT_SECONDS).toBe(0.8);
    stubDocument();
    for (const step of [FRAME, 0.1]) {
      const { fx } = makeFx("high", true);
      const floats = fx.root.children[2];
      fx.applyFrame(frameOf({ ...plain, office: 2 }, { arrived: ["p6", "p7", "p8"], left: ["p2", "p3"] }, [moved]), still);
      const sprites = floats.children.filter((child) => child.visible);
      expect(sprites).toHaveLength(2);
      const placed = sprites.map((sprite) => [sprite.position.clone(), sprite.scale.clone()] as const);
      let t = 0;
      while (fx.busy() && t < 5) {
        fx.update(step, t);
        t += step;
        sprites.forEach((sprite, i) => {
          if (!sprite.visible) return;
          expect(sprite.position.equals(placed[i][0]), `moved at ${t}`).toBe(true);
          expect(sprite.scale.equals(placed[i][1]), `grew at ${t}`).toBe(true);
        });
      }
      // 0.8 s, a step at most past it: room under the one-second limit for a slow frame in a browser.
      expect(t, String(step)).toBeGreaterThanOrEqual(REDUCED_TEXT_SECONDS - 1e-9);
      expect(t, String(step)).toBeLessThan(REDUCED_TEXT_SECONDS + step + 1e-9);
      expect(t, String(step)).toBeLessThan(1);
      expect(kindsAlive(fx)).toEqual([]);
    }
    // With full motion they still rise, and last as long as before.
    const { fx } = makeFx();
    const floats = fx.root.children[2];
    fx.applyFrame(frameOf(plain, { arrived: ["p6"] }), still);
    const sprite = floats.children.find((child) => child.visible)!;
    const from = sprite.position.y;
    fx.update(0.5, 0.5);
    expect(sprite.position.y).toBeGreaterThan(from + 0.5);
    expect(secondsToRest(fx)).toBeGreaterThan(0.8);
  });

  it("treats text and bubbles as no-ops where there is no document", () => {
    const { fx } = makeFx();
    expect(() => {
      fx.floatText("+12", ORIGIN, "good");
      fx.bubble(new THREE.Object3D(), "code");
      fx.update(FRAME, FRAME);
    }).not.toThrow();
    expect(fx.busy()).toBe(false);
  });

  it("says how many arrived and how many left, once each, at the door", () => {
    const { fx, texts } = makeFx();
    fx.applyFrame(frameOf(plain, { arrived: ["p6", "p7"], left: ["p2"] }), still);
    expect(texts).toEqual([
      { text: "+2", x: layout.door.x, z: layout.door.z, tone: "good" },
      { text: "−1", x: layout.door.x, z: layout.door.z, tone: "bad" },
    ]);
    // Words about people are not particles.
    expect(fx.particles.activeCount).toBe(0);
    // The same frame's lists are said once: a frame with nothing new says nothing more.
    fx.applyFrame(still, frameOf(plain, { arrived: ["p6", "p7"], left: ["p2"] }));
    expect(texts).toHaveLength(2);
  });

  it("says only what happened: arrivals alone, departures alone, or nothing", () => {
    const { fx, texts } = makeFx();
    fx.applyFrame(frameOf(plain, { arrived: ["p6"] }), still);
    fx.applyFrame(frameOf(plain, { left: ["p0", "p1", "p2"] }), still);
    fx.applyFrame(still, still);
    expect(texts.map((entry) => entry.text)).toEqual(["+1", "−3"]);
  });

  it("a fresh cast says nothing", () => {
    const { fx, texts, shakes } = makeFx();
    // The first frame, whatever comes with it.
    fx.applyFrame(frameOf(plain, { arrived: ["p0", "p1"], left: ["p9"] }, [moved]), null);
    // Another run and an earlier year, as the world hands them out and with lists that should not be there.
    const reset: SceneEvent[] = [{ kind: "run-reset" }];
    fx.applyFrame(frameOf({ ...plain, runId: "another" }, { arrived: ["p0"], left: ["p1"] }, reset), still);
    fx.applyFrame(frameOf({ ...plain, year: plain.year - 1 }, { arrived: ["p0"], left: ["p1"] }, reset), still);
    fx.update(1, 1);
    expect(texts).toEqual([]);
    expect(shakes).toEqual([]);
    expect(fx.particles.activeCount).toBe(0);
    expect(fx.busy()).toBe(false);
  });

  it("past the cap, says the company's numbers and not the drawn people's", () => {
    const { fx, texts } = makeFx();
    const { next, prev } = frames(sceneOf([20, 20, 20], { leaving: 5 }), sceneOf([30, 20, 20], { year: 1991 }));
    fx.applyFrame(next, prev);
    expect(texts.map((entry) => entry.text)).toEqual(["+10", "−5"]);
  });

  it("raises dust, and nothing else, as a new office comes up", () => {
    const { fx, texts, shakes } = makeFx();
    fx.applyFrame(frameOf({ ...plain, office: 2 }, {}, [moved]), still);
    expect(texts).toEqual([]);
    expect(shakes).toEqual([0.4]);
    // Nothing yet: the dust belongs to the building's rise, which starts a moment after the frame.
    expect(fx.particles.activeCount).toBe(0);
    expect(fx.busy()).toBe(true);
    let peak = 0;
    let first = -1;
    let seen: BurstKind[] = [];
    const { minX, maxX, minZ, maxZ } = layout.floor;
    for (let t = 0; t < REBUILD_RISE_DELAY + REBUILD_RISE_SECONDS + 0.1; t += FRAME) {
      const before = fx.particles.activeCount;
      fx.update(FRAME, t);
      if (first < 0 && fx.particles.activeCount > 0) first = t;
      peak = Math.max(peak, fx.particles.activeCount);
      seen = [...new Set([...seen, ...kindsAlive(fx)])];
      // A puff starts low, on the floor of the office.
      if (before === 0 && fx.particles.activeCount > 0) {
        for (let i = 0; i < fx.particles.capacity; i += 1) {
          if (fx.particles.state[i] === SLOT_FREE) continue;
          expect(fx.particles.py[i]).toBeLessThan(1);
          expect(fx.particles.px[i]).toBeGreaterThan(minX - 0.5);
          expect(fx.particles.px[i]).toBeLessThan(maxX + 0.5);
          expect(fx.particles.pz[i]).toBeGreaterThan(minZ - 0.5);
          expect(fx.particles.pz[i]).toBeLessThan(maxZ + 0.5);
        }
      }
    }
    expect(seen).toEqual(["dust"]);
    expect(first).toBeGreaterThanOrEqual(REBUILD_RISE_DELAY - FRAME);
    // Spread over the rise, not all in one frame.
    expect(peak).toBeGreaterThan(KIND_PROFILES.dust.count);
    expect(secondsToRest(fx)).toBeLessThan(5);
  });

  it("raises no dust for a new year, an ending, or the first office", () => {
    const { fx, shakes } = makeFx();
    fx.applyFrame(frameOf({ ...plain, year: 1991 }, {}, [{ kind: "year-advanced", from: 1990, to: 1991 }]), still);
    fx.applyFrame(frameOf({ ...plain, ending: "won" }, {}, [{ kind: "ended", ending: "won" }]), still);
    fx.applyFrame(frameOf({ ...plain, office: 2 }, {}, [moved]), null);
    fx.update(2, 2);
    expect(fx.particles.activeCount).toBe(0);
    expect(shakes).toEqual([]);
    expect(fx.busy()).toBe(false);
  });

  it("clears everything, including bursts still waiting to fire, on a run reset", () => {
    const { fx } = makeFx();
    fx.applyFrame(frameOf({ ...plain, office: 2 }, {}, [moved]), still);
    for (let t = 0; t < REBUILD_RISE_DELAY + 0.1; t += FRAME) fx.update(FRAME, t);
    expect(fx.particles.activeCount).toBeGreaterThan(0);

    fx.applyFrame(frameOf({ ...plain, runId: "another" }, {}, [{ kind: "run-reset" }]), still);
    expect(fx.particles.activeCount).toBe(0);
    expect(fx.busy()).toBe(false);
    for (let t = 0; t < 3; t += FRAME) fx.update(FRAME, t);
    expect(fx.particles.activeCount).toBe(0);
  });
});

describe("FxSystem at rest", () => {
  it("is at rest until something is asked of it", () => {
    const { fx } = makeFx();
    expect(fx.busy()).toBe(false);
    fx.update(FRAME, FRAME);
    fx.applyFrame(still, null);
    fx.applyFrame(still, still);
    expect(fx.busy()).toBe(false);
  });

  it("is busy while a particle is alive, and comes to rest", () => {
    for (const kind of BURST_KINDS) {
      const { fx } = makeFx();
      fx.burst(kind, ORIGIN, 2);
      expect(fx.busy(), kind).toBe(true);
      const seconds = secondsToRest(fx);
      expect(seconds, kind).toBeGreaterThan(0.2);
      expect(seconds, kind).toBeLessThan(10);
      expect(fx.particles.activeCount, kind).toBe(0);
    }
    const { fx } = makeFx();
    fx.stream("users", { x: 3, y: 0.3, z: 3 }, { x: -2, y: 1, z: -2 }, 40);
    expect(fx.busy()).toBe(true);
    expect(secondsToRest(fx)).toBeLessThan(10);
  });

  it("is busy while dust is still waiting to rise, with no particle alive yet", () => {
    const { fx } = makeFx();
    fx.applyFrame(frameOf({ ...plain, office: 2 }, {}, [moved]), still);
    expect(fx.particles.activeCount).toBe(0);
    expect(fx.busy()).toBe(true);
    for (let t = 0; t < REBUILD_RISE_DELAY - FRAME; t += FRAME) fx.update(FRAME, t);
    expect(fx.particles.activeCount).toBe(0);
    expect(fx.busy()).toBe(true);
    const seconds = secondsToRest(fx);
    expect(seconds).toBeGreaterThan(REBUILD_RISE_DELAY + REBUILD_RISE_SECONDS);
    expect(seconds).toBeLessThan(5);
  });

  it("is busy while a shake plays, for as long as the camera really shakes", () => {
    const { fx } = makeFx();
    fx.shake(1);
    expect(fx.busy()).toBe(true);
    const seconds = secondsToRest(fx);
    expect(seconds).toBeGreaterThanOrEqual(SHAKE_SECONDS - FRAME);
    expect(seconds).toBeLessThan(SHAKE_SECONDS + 2 * FRAME);

    // The camera's own shake is over within that time, at any strength.
    const rig = new CameraRig();
    rig.shake(5);
    let t = 0;
    while (rig.isAnimating && t < 5) {
      rig.update(FRAME);
      t += FRAME;
    }
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThanOrEqual(SHAKE_SECONDS);

    // Reduced motion: no shake, nothing to wait for.
    const calm = makeFx("high", true).fx;
    calm.shake(1);
    expect(calm.busy()).toBe(false);
    // A shake of nothing is nothing.
    const none = makeFx().fx;
    none.shake(0);
    none.shake(Number.NaN);
    expect(none.busy()).toBe(false);
  });

  it("is busy while a text floats or a bubble shows, and comes to rest", () => {
    stubDocument();
    const text = makeFx().fx;
    text.applyFrame(frameOf(plain, { arrived: ["p6", "p7"], left: ["p2"] }), still);
    expect(text.busy()).toBe(true);
    const textSeconds = secondsToRest(text);
    expect(textSeconds).toBeGreaterThan(0.5);
    expect(textSeconds).toBeLessThan(3);

    const { fx, scene } = makeFx();
    const head = new THREE.Object3D();
    scene.add(head);
    fx.bubble(head, "coffee", 2);
    expect(fx.busy()).toBe(true);
    const bubbleSeconds = secondsToRest(fx);
    expect(bubbleSeconds).toBeGreaterThan(1.5);
    expect(bubbleSeconds).toBeLessThan(3);

    // A bubble whose owner leaves the scene goes with them.
    fx.bubble(head, "coffee", 60);
    head.removeFromParent();
    expect(secondsToRest(fx)).toBeLessThan(0.1);
  });

  it("comes to rest after everything at once, and stays there", () => {
    stubDocument();
    const { fx, scene } = makeFx();
    const head = new THREE.Object3D();
    scene.add(head);
    fx.applyFrame(frameOf({ ...plain, office: 2 }, { arrived: ["p6"], left: ["p2"] }, [moved]), still);
    fx.bubble(head, "idea");
    fx.stream("money", ORIGIN, { x: 2, y: 1, z: 2 }, 12);
    const seconds = secondsToRest(fx);
    expect(seconds).toBeGreaterThan(REBUILD_RISE_DELAY + REBUILD_RISE_SECONDS);
    expect(seconds).toBeLessThan(10);
    for (let t = 0; t < 2; t += FRAME) fx.update(FRAME, t);
    expect(fx.busy()).toBe(false);
  });

  it("a frame whose length is not a positive, finite number passes no time and poisons nothing", () => {
    stubDocument();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0]) {
      const { fx, scene } = makeFx();
      const head = new THREE.Object3D();
      scene.add(head);
      fx.applyFrame(frameOf({ ...plain, office: 2 }, { arrived: ["p6"], left: ["p2"] }, [moved]), still);
      fx.bubble(head, "idea", 2);
      fx.burst("confetti", ORIGIN);
      fx.shake(1);
      const alive = fx.particles.activeCount;
      fx.update(bad, 1);
      fx.update(bad, Number.NaN);
      // Nothing has aged: everything that was playing still is.
      expect(fx.busy(), String(bad)).toBe(true);
      expect(fx.particles.activeCount, String(bad)).toBe(alive);
      // And ordinary frames after it bring the effects to rest in their ordinary time.
      const seconds = secondsToRest(fx);
      expect(seconds, String(bad)).toBeGreaterThan(REBUILD_RISE_DELAY + REBUILD_RISE_SECONDS);
      expect(seconds, String(bad)).toBeLessThan(10);
      expect(fx.busy(), String(bad)).toBe(false);
    }
  });

  it("a bubble cannot last for ever: no length that is not a number, none without end, none beyond a minute", () => {
    stubDocument();
    for (const [asked, least, most] of [
      [Number.NaN, 1.5, 3],
      [Number.POSITIVE_INFINITY, 1.5, 3],
      [Number.NEGATIVE_INFINITY, 1.5, 3],
      [1e9, 59, 61],
    ] as const) {
      const { fx, scene } = makeFx();
      const head = new THREE.Object3D();
      scene.add(head);
      fx.bubble(head, "coffee", asked);
      expect(fx.busy(), String(asked)).toBe(true);
      const seconds = secondsToRest(fx, 120);
      expect(seconds, String(asked)).toBeGreaterThan(least);
      expect(seconds, String(asked)).toBeLessThan(most);
    }
  });

  it("is at rest once disposed, whatever was playing", () => {
    const { fx } = makeFx();
    fx.applyFrame(frameOf({ ...plain, office: 2 }, {}, [moved]), still);
    fx.burst("confetti", ORIGIN);
    fx.shake(1);
    fx.dispose();
    expect(fx.busy()).toBe(false);
  });
});
