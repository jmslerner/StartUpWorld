import { describe, it, expect } from "vitest";
import { STREAM, chance, firstFloat, nextFloat01, nextIntInclusive, nextUint32, pickWeightedIndex, signedUnit, streamSeed } from "./rng";

describe("nextUint32", () => {
  it("is deterministic (same seed → same output)", () => {
    const a = nextUint32(42);
    const b = nextUint32(42);
    expect(a.value).toBe(b.value);
    expect(a.rng).toBe(b.rng);
  });

  it("produces a valid uint32", () => {
    const { value } = nextUint32(12345);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("advances state (output rng differs from input)", () => {
    const { rng } = nextUint32(12345);
    expect(rng).not.toBe(12345);
  });
});

describe("nextFloat01", () => {
  it("returns a value in [0, 1)", () => {
    let rng = 99999;
    for (let i = 0; i < 50; i++) {
      const d = nextFloat01(rng);
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThan(1);
      rng = d.rng;
    }
  });

  it("is deterministic", () => {
    expect(nextFloat01(42).value).toBe(nextFloat01(42).value);
  });
});

describe("nextIntInclusive", () => {
  it("returns values within bounds", () => {
    let rng = 777;
    for (let i = 0; i < 50; i++) {
      const d = nextIntInclusive(rng, 5, 10);
      expect(d.value).toBeGreaterThanOrEqual(5);
      expect(d.value).toBeLessThanOrEqual(10);
      rng = d.rng;
    }
  });

  it("handles min === max", () => {
    const d = nextIntInclusive(42, 7, 7);
    expect(d.value).toBe(7);
  });

  it("handles swapped min/max", () => {
    const d = nextIntInclusive(42, 10, 5);
    expect(d.value).toBeGreaterThanOrEqual(5);
    expect(d.value).toBeLessThanOrEqual(10);
  });
});

describe("chance", () => {
  it("p=0 always returns false", () => {
    let rng = 1;
    for (let i = 0; i < 20; i++) {
      const d = chance(rng, 0);
      expect(d.value).toBe(false);
      rng = d.rng;
    }
  });

  it("p=1 always returns true", () => {
    let rng = 1;
    for (let i = 0; i < 20; i++) {
      const d = chance(rng, 1);
      expect(d.value).toBe(true);
      rng = d.rng;
    }
  });

  it("is deterministic", () => {
    expect(chance(42, 0.5).value).toBe(chance(42, 0.5).value);
  });
});

describe("signedUnit", () => {
  it("returns values in [-1, 1]", () => {
    let rng = 54321;
    for (let i = 0; i < 50; i++) {
      const d = signedUnit(rng);
      expect(d.value).toBeGreaterThanOrEqual(-1);
      expect(d.value).toBeLessThanOrEqual(1);
      rng = d.rng;
    }
  });
});

describe("pickWeightedIndex", () => {
  it("returns null for all-zero weights", () => {
    const d = pickWeightedIndex(42, [0, 0, 0]);
    expect(d.value).toBeNull();
  });

  it("returns null for empty weights", () => {
    const d = pickWeightedIndex(42, []);
    expect(d.value).toBeNull();
  });

  it("always picks the only positive weight", () => {
    let rng = 1;
    for (let i = 0; i < 20; i++) {
      const d = pickWeightedIndex(rng, [0, 0, 5, 0]);
      expect(d.value).toBe(2);
      rng = d.rng;
    }
  });

  it("returns a valid index", () => {
    let rng = 999;
    for (let i = 0; i < 50; i++) {
      const d = pickWeightedIndex(rng, [1, 2, 3, 4]);
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value!).toBeLessThan(4);
      rng = d.rng;
    }
  });
});

describe("streams", () => {
  it("gives the same stream for the same key, and never the stuck state 0", () => {
    for (const seed of [0, 1, 2, 86, 0xffffffff]) {
      for (let turn = 0; turn <= 20; turn++) {
        const a = streamSeed(seed, turn, STREAM.poach, 2);
        expect(a).toBe(streamSeed(seed, turn, STREAM.poach, 2));
        expect(a).not.toBe(0);
        expect(a).toBe(a >>> 0);
      }
    }
  });

  it("gives every (turn, purpose, company) of a game its own stream", () => {
    const seen = new Set<number>();
    let count = 0;
    for (let turn = 0; turn <= 20; turn++) {
      for (const purpose of Object.values(STREAM)) {
        for (let company = 0; company < 4; company++) {
          seen.add(streamSeed(12345, turn, purpose, company));
          count++;
        }
      }
    }
    expect(seen.size).toBe(count);
  });

  it("does not let small neighbouring seeds share their first roll", () => {
    let below = 0;
    const n = 2000;
    for (let seed = 1; seed <= n; seed++) {
      if (firstFloat(seed, 3, STREAM.eventRoll) < 0.5) below++;
    }
    expect(below / n).toBeGreaterThan(0.45);
    expect(below / n).toBeLessThan(0.55);
  });

  it("keeps purpose ids fixed, so a new purpose never shifts an old stream", () => {
    expect(STREAM).toMatchObject({
      eventRoll: 1,
      eventCard: 2,
      eventTarget: 3,
      hiringOrder: 4,
      poachOrder: 5,
      poach: 6,
      board: 7,
      cpuNoise: 8,
      names: 9,
    });
  });

  it("firstFloat is the first draw of the stream, in [0, 1)", () => {
    const value = firstFloat(7, 4, STREAM.board, 1);
    expect(value).toBe(nextFloat01(streamSeed(7, 4, STREAM.board, 1)).value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});
