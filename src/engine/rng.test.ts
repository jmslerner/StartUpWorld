import { describe, it, expect } from "vitest";
import { nextUint32, nextFloat01, nextIntInclusive, chance, signedUnit, pickWeightedIndex } from "./rng";

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
