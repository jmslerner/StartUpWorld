import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../engine";
import { getOfficeLayout } from "../office/layouts";
import { buildWorldSnapshot } from "../snapshot";
import type { BurstKind, QualityLevel, SeatingApi, WorldEvent } from "../types";
import { lowestFreeSlot } from "./FloatTextLayer";
import { formatCompact, formatCountDelta, formatHeadcountDelta, formatMoneyDelta } from "./format";
import { FxSystem, magnitudeIntensity, particleBudget } from "./FxSystem";
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
    expect(formatMoneyDelta(1_200_000)).toBe("+$1.2M");
    expect(formatMoneyDelta(-3000)).toBe("−$3,000");
    expect(formatCountDelta(340, "users")).toBe("+340 users");
    expect(formatCountDelta(-3, "rep")).toBe("−3 rep");
    expect(formatHeadcountDelta(1, "engineering")).toBe("+1 Eng");
    expect(formatHeadcountDelta(-2, "sales")).toBe("−2 Sales");
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

  it("scales burst intensity with the order of magnitude, within limits", () => {
    const small = magnitudeIntensity(50_000, 25_000, 0.7, 2.4);
    const medium = magnitudeIntensity(5_000_000, 25_000, 0.7, 2.4);
    const large = magnitudeIntensity(500_000_000, 25_000, 0.7, 2.4);
    expect(small).toBeGreaterThanOrEqual(0.7);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
    // 100× more money is a visibly bigger burst, not a 100× bigger one.
    expect(medium / small).toBeLessThan(2.5);
    expect(magnitudeIntensity(1e15, 25_000, 0.7, 2.4)).toBe(2.4);
    expect(magnitudeIntensity(0, 25_000, 0.7, 2.4)).toBe(0.7);
    expect(magnitudeIntensity(-5_000_000, 25_000, 0.7, 2.4)).toBe(medium);
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
// FxSystem (runs without a DOM: sprites are simply skipped)
// ─────────────────────────────────────────────────────────────────────────────

const seating: SeatingApi = { seatOf: () => null, freeDeskSlots: () => [], hiddenCount: () => 0 };
const layout = getOfficeLayout("garage", []);
const snapshot = buildWorldSnapshot(createInitialState());

const makeFx = (
  quality: QualityLevel = "high",
  reducedMotion = false
): { fx: FxSystem; scene: THREE.Scene; shakes: number[] } => {
  const scene = new THREE.Scene();
  const shakes: number[] = [];
  const fx = new FxSystem({
    scene,
    quality,
    reducedMotion,
    seating,
    getLayout: () => layout,
    unitsPerPixel: () => 0.02,
    shakeCamera: (strength) => shakes.push(strength),
    random: seeded(99),
  });
  return { fx, scene, shakes };
};

const countAfter = (events: WorldEvent[]): number => {
  const { fx } = makeFx();
  fx.applySnapshot(snapshot, snapshot, events);
  return fx.particles.activeCount;
};

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
    calm.fx.applySnapshot(snapshot, snapshot, [{ type: "ship", ok: false, reputationDelta: -3 }]);
    expect(calm.shakes).toEqual([]);
  });

  it("treats text and bubbles as no-ops where there is no document", () => {
    const { fx } = makeFx();
    expect(() => {
      fx.floatText("+12 rep", ORIGIN, "good");
      fx.bubble(new THREE.Object3D(), "code");
      fx.update(FRAME, FRAME);
    }).not.toThrow();
  });

  it("plays nothing for the first snapshot, whatever events come with it", () => {
    const { fx, shakes } = makeFx();
    fx.applySnapshot(snapshot, null, [
      { type: "ship", ok: false, reputationDelta: -3 },
      { type: "raise", ok: true, amount: 1_000_000, source: "vc" },
      { type: "phase-changed", from: "garage", to: "coworking" },
    ]);
    fx.update(1, 1);
    expect(fx.particles.activeCount).toBe(0);
    expect(shakes).toEqual([]);
  });

  it("reacts to each event the spec assigns to it", () => {
    const loud: WorldEvent[] = [
      { type: "ship", ok: true, reputationDelta: 4 },
      { type: "ship", ok: false, reputationDelta: -3 },
      { type: "launch", ok: true, usersDelta: 340 },
      { type: "launch", ok: false, usersDelta: 0 },
      { type: "pitch", ok: true },
      { type: "pitch", ok: false },
      { type: "raise", ok: true, amount: 1_500_000, source: "vc" },
      { type: "raise", ok: false, amount: 1_500_000, source: "vc" },
      { type: "board-action", action: "dinner", ok: true },
      { type: "board-action", action: "blackmail", ok: false },
      { type: "users-changed", delta: 50 },
      { type: "stage-changed", from: "garage", to: "seed" },
      { type: "asset-acquired", assetId: "lounge" },
      { type: "setup-completed" },
      { type: "pricing-changed" },
    ];
    for (const event of loud) expect(countAfter([event]), event.type).toBeGreaterThan(0);

    // These are animated by the office and the characters, or only produce text.
    const quiet: WorldEvent[] = [
      { type: "hired", role: "engineering", personIds: ["engineering-1"] },
      { type: "departed", role: "sales", personIds: ["sales-0"] },
      { type: "week-advanced", week: 2 },
      { type: "cash-changed", delta: -3000 },
      { type: "users-changed", delta: -20 },
      { type: "event-opened", title: "Uh oh" },
      { type: "event-resolved" },
      { type: "easter-egg", command: "coffee" },
      { type: "command-failed", command: "ship" },
    ];
    for (const event of quiet) expect(countAfter([event]), event.type).toBe(0);
  });

  it("shakes the camera for a failed ship and a phase change only", () => {
    const { fx, shakes } = makeFx();
    fx.applySnapshot(snapshot, snapshot, [{ type: "ship", ok: true, reputationDelta: 4 }]);
    expect(shakes).toEqual([]);
    fx.applySnapshot(snapshot, snapshot, [{ type: "ship", ok: false, reputationDelta: -3 }]);
    expect(shakes).toEqual([0.3]);
    fx.applySnapshot(snapshot, snapshot, [{ type: "phase-changed", from: "garage", to: "coworking" }]);
    expect(shakes).toEqual([0.3, 0.4]);
  });

  it("does not double up: a launch already brings its users in", () => {
    const launch: WorldEvent = { type: "launch", ok: true, usersDelta: 340 };
    const alone = countAfter([launch]);
    expect(countAfter([launch, { type: "users-changed", delta: 340 }])).toBe(alone);
    expect(countAfter([{ type: "users-changed", delta: 340 }, launch])).toBe(alone);
    // A failed launch does not suppress organic growth arriving in the same batch.
    const failed: WorldEvent = { type: "launch", ok: false, usersDelta: 0 };
    expect(countAfter([failed, { type: "users-changed", delta: 340 }])).toBeGreaterThan(countAfter([failed]));
  });

  it("makes bigger raises and bigger launches visibly bigger", () => {
    const raise = (amount: number): number => countAfter([{ type: "raise", ok: true, amount, source: "vc" }]);
    expect(raise(40_000_000)).toBeGreaterThan(raise(150_000));
    const launch = (usersDelta: number): number => countAfter([{ type: "launch", ok: true, usersDelta }]);
    expect(launch(50_000)).toBeGreaterThan(launch(40));
  });

  it("spreads phase-change and victory confetti over time rather than in one frame", () => {
    for (const event of [
      { type: "phase-changed", from: "garage", to: "coworking" },
      { type: "game-over", ending: "ipo" },
    ] satisfies WorldEvent[]) {
      const { fx } = makeFx();
      fx.applySnapshot(snapshot, snapshot, [event]);
      fx.update(FRAME, FRAME);
      const early = fx.particles.activeCount;
      expect(early).toBeGreaterThan(0);
      let peak = early;
      for (let t = 0; t < 1; t += FRAME) {
        fx.update(FRAME, t);
        peak = Math.max(peak, fx.particles.activeCount);
      }
      expect(peak).toBeGreaterThan(early);
    }
  });

  it("answers a lost run with smoke, not confetti", () => {
    const { fx } = makeFx();
    fx.applySnapshot(snapshot, snapshot, [{ type: "game-over", ending: "bankruptcy" }]);
    for (let t = 0; t < 1.2; t += FRAME) fx.update(FRAME, t);
    const kinds = new Set<BurstKind>();
    for (let i = 0; i < fx.particles.capacity; i += 1) {
      if (fx.particles.state[i] !== SLOT_FREE) kinds.add(BURST_KINDS[fx.particles.kind[i]]);
    }
    expect([...kinds]).toEqual(["smoke"]);
  });

  it("clears everything, including bursts still waiting to fire, on a run reset", () => {
    const { fx } = makeFx();
    fx.applySnapshot(snapshot, snapshot, [{ type: "game-over", ending: "ipo" }]);
    fx.update(FRAME, FRAME);
    expect(fx.particles.activeCount).toBeGreaterThan(0);

    fx.applySnapshot(snapshot, snapshot, [{ type: "run-reset" }]);
    expect(fx.particles.activeCount).toBe(0);
    for (let t = 0; t < 3; t += FRAME) fx.update(FRAME, t);
    expect(fx.particles.activeCount).toBe(0);
  });
});
