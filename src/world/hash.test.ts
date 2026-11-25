import { describe, expect, it } from "vitest";
import { hashText32, mix32 } from "./hash";

const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);

describe("hashText32", () => {
  it("gives the same number for the same seed and text, every time", () => {
    expect(hashText32(7, "p0")).toBe(hashText32(7, "p0"));
    expect(Number.isInteger(hashText32(7, "p0")) && hashText32(7, "p0") >= 0 && hashText32(7, "p0") <= 0xffffffff).toBe(true);
  });

  it("tells neighbours apart: p0 to p49 under one seed share no value, and their low byte takes at least 40 values", () => {
    const values = ids.map((id) => hashText32(7, id));
    expect(new Set(values).size).toBe(50);
    expect(new Set(values.map((value) => value & 0xff)).size).toBeGreaterThanOrEqual(40);
  });

  it("changes with the seed", () => {
    expect(hashText32(7, "p0")).not.toBe(hashText32(8, "p0"));
  });

  it("stays an unsigned 32-bit whole number for any seed: negative, fractional or huge", () => {
    for (const seed of [-1, 0, 0.5, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER]) {
      for (const value of [hashText32(seed, ""), hashText32(seed, "p0")]) {
        expect(Number.isInteger(value) && value >= 0 && value <= 0xffffffff).toBe(true);
      }
    }
  });
});

describe("mix32", () => {
  it("spreads neighbouring numbers over the low byte", () => {
    const values = Array.from({ length: 50 }, (_, i) => mix32(i + 1));
    expect(new Set(values).size).toBe(50);
    expect(new Set(values.map((value) => value & 0xff)).size).toBeGreaterThanOrEqual(40);
  });
});
