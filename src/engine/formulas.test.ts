import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import {
  churnRate,
  clamp,
  departmentWork,
  effectiveWork,
  founderStake,
  hiringCapacity,
  newUsersForTurn,
  nextQuality,
  poachChance,
  pullOf,
  qualityGain,
  raiseAmount,
  refitAllocation,
  runwayOf,
  splitByWeights,
  valuationOf,
} from "./formulas";

describe("effective work", () => {
  it("is headcount to the archetype's exponent", () => {
    expect(effectiveWork(3, 0.9)).toBeCloseTo(2.68788, 4);
    expect(effectiveWork(8, 0.8)).toBeCloseTo(5.27803, 4);
    expect(effectiveWork(1, 0.9)).toBe(1);
  });

  it("is zero for an empty payroll", () => {
    expect(effectiveWork(0, 0.9)).toBe(0);
  });

  it("is split across departments in proportion to their people", () => {
    const work = effectiveWork(3, 0.9);
    expect(departmentWork(work, 2, 3)).toBeCloseTo((work * 2) / 3, 6);
    expect(departmentWork(work, 0, 3)).toBe(0);
    expect(departmentWork(0, 0, 0)).toBe(0);
  });

  it("loses the fundraiser's share: two workers on a payroll of three do two thirds of the work", () => {
    const work = effectiveWork(3, 0.9);
    const done = departmentWork(work, 1, 3) + departmentWork(work, 1, 3);
    expect(done).toBeCloseTo((work * 2) / 3, 6);
  });
});

describe("product quality", () => {
  it("gains 5 × product work × (1 − quality/100)", () => {
    expect(qualityGain(0, 2, 1, CONFIG)).toBeCloseTo(10, 6);
    expect(qualityGain(30, 2, 1, CONFIG)).toBeCloseTo(7, 6);
    expect(qualityGain(100, 2, 1, CONFIG)).toBe(0);
  });

  it("multiplies the gain by the catch-up bonus", () => {
    expect(qualityGain(30, 2, 1.5, CONFIG)).toBeCloseTo(10.5, 6);
  });

  it("then loses the decay, and stays within 0–100", () => {
    expect(nextQuality(40, 7, CONFIG)).toBeCloseTo(45, 6);
    expect(nextQuality(1, 0, CONFIG)).toBe(0);
    expect(nextQuality(99.5, 50, CONFIG)).toBe(100);
  });

  it("lets three people on Product launch in one turn (quality 10 after the decay)", () => {
    const work = effectiveWork(3, 0.9);
    const quality = nextQuality(0, qualityGain(0, work, 1, CONFIG), CONFIG);
    expect(quality).toBeCloseTo(11.4394, 3);
    expect(quality).toBeGreaterThanOrEqual(CONFIG.quality.launchAt);
  });
});

describe("churn", () => {
  it("is 12% − 0.08 points per quality point on Standard", () => {
    expect(churnRate(0, "standard", CONFIG)).toBeCloseTo(0.12, 9);
    expect(churnRate(50, "standard", CONFIG)).toBeCloseTo(0.08, 9);
    expect(churnRate(100, "standard", CONFIG)).toBeCloseTo(0.04, 9);
  });

  it("adds 4 points on Premium and takes 2 off on Budget", () => {
    expect(churnRate(50, "premium", CONFIG)).toBeCloseTo(0.12, 9);
    expect(churnRate(50, "budget", CONFIG)).toBeCloseTo(0.06, 9);
  });

  it("never goes below the floor", () => {
    expect(churnRate(100, "budget", CONFIG)).toBeCloseTo(0.02, 9);
    const stricter = { ...CONFIG, churn: { ...CONFIG.churn, min: 0.05 } };
    expect(churnRate(100, "budget", stricter)).toBe(0.05);
    expect(churnRate(100, "standard", stricter)).toBe(0.05);
  });
});

describe("pull", () => {
  const base = { quality: 40, growthWork: 2, marketing: 100_000, tier: "standard", hype: 20, marketingModifier: 1 } as const;

  it("is quality × (1 + 0.3 × growth work + 0.5 × √(marketing ÷ $25K)) × price factor × (1 + hype/100)", () => {
    // 40 × (1 + 0.6 + 0.5 × 2) × 1 × 1.2
    expect(pullOf(base, CONFIG)).toBeCloseTo(124.8, 6);
  });

  it("applies the price factor", () => {
    expect(pullOf({ ...base, tier: "budget" }, CONFIG)).toBeCloseTo(156, 6);
    expect(pullOf({ ...base, tier: "premium" }, CONFIG)).toBeCloseTo(93.6, 6);
  });

  it("halves the marketing term when ad prices spike", () => {
    // 40 × (1 + 0.6 + 0.5) × 1.2
    expect(pullOf({ ...base, marketingModifier: 0.5 }, CONFIG)).toBeCloseTo(100.8, 6);
  });

  it("is zero without a product", () => {
    expect(pullOf({ ...base, quality: 0 }, CONFIG)).toBe(0);
  });

  it("works with no growth staff and no marketing", () => {
    expect(pullOf({ ...base, growthWork: 0, marketing: 0, hype: 0 }, CONFIG)).toBeCloseTo(40, 6);
  });
});

describe("money", () => {
  it("values a company at users × $150 × (1 + hype/100) × climate", () => {
    expect(valuationOf(10_000, 20, 1, CONFIG)).toBe(1_800_000);
    expect(valuationOf(10_000, 20, 0.6, CONFIG)).toBe(1_080_000);
    expect(valuationOf(0, 50, 1, CONFIG)).toBe(0);
  });

  it("raises valuation × percent, in whole dollars", () => {
    expect(raiseAmount(1_800_000, 20)).toBe(360_000);
    expect(raiseAmount(333_333, 10)).toBe(33_333);
  });

  it("measures the founder's stake as equity × valuation", () => {
    expect(founderStake(0.64, 1_000_000)).toBe(640_000);
  });

  it("gives runway as cash ÷ (costs − revenue)", () => {
    expect(runwayOf(300_000, 20_000, 120_000)).toBe(3);
  });

  it("has no runway limit when the quarter was profitable or broke even", () => {
    expect(runwayOf(300_000, 120_000, 120_000)).toBeNull();
    expect(runwayOf(300_000, 200_000, 120_000)).toBeNull();
  });
});

describe("hiring and poaching", () => {
  it("can hire 2 × recruiting work, rounded", () => {
    expect(hiringCapacity(0.896, CONFIG)).toBe(2);
    expect(hiringCapacity(0.2, CONFIG)).toBe(0);
    expect(hiringCapacity(1.25, CONFIG)).toBe(3);
    expect(hiringCapacity(0, CONFIG)).toBe(0);
  });

  it("poaches at 50% plus half the hype gap in points", () => {
    expect(poachChance(20, 10, CONFIG)).toBeCloseTo(0.55, 9);
    expect(poachChance(10, 20, CONFIG)).toBeCloseTo(0.45, 9);
    expect(poachChance(15, 15, CONFIG)).toBeCloseTo(0.5, 9);
  });

  it("clamps the poach chance to 10–90%", () => {
    expect(poachChance(100, 0, CONFIG)).toBe(0.9);
    expect(poachChance(0, 100, CONFIG)).toBe(0.1);
  });
});

describe("market size", () => {
  it("starts at 20,000 new users and grows 10% a turn", () => {
    expect(newUsersForTurn(1, 1, CONFIG)).toBe(20_000);
    expect(newUsersForTurn(2, 1, CONFIG)).toBe(22_000);
    expect(newUsersForTurn(3, 1, CONFIG)).toBe(24_200);
    expect(newUsersForTurn(20, 1, CONFIG)).toBe(122_318);
  });

  it("applies the event multiplier", () => {
    expect(newUsersForTurn(1, 1.5, CONFIG)).toBe(30_000);
  });
});

describe("splitByWeights", () => {
  it("splits in proportion and always hands out the whole total", () => {
    expect(splitByWeights(100, [3, 1])).toEqual([75, 25]);
    expect(splitByWeights(7, [0.5, 0.25, 0.25])).toEqual([3, 2, 2]);
    for (const total of [0, 1, 2, 999, 20_884]) {
      const parts = splitByWeights(total, [113.7, 12.6, 12.6, 12.6]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      for (const part of parts) expect(Number.isInteger(part)).toBe(true);
    }
  });

  it("gives leftover units to the largest remainders, lower index first on a tie", () => {
    expect(splitByWeights(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitByWeights(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("gives nothing to a zero weight and nothing at all when every weight is zero", () => {
    expect(splitByWeights(10, [0, 5, 0])).toEqual([0, 10, 0]);
    expect(splitByWeights(10, [0, 0])).toEqual([0, 0]);
    expect(splitByWeights(10, [])).toEqual([]);
  });
});

describe("refitAllocation", () => {
  it("keeps a split that already fits", () => {
    expect(refitAllocation({ product: 2, growth: 1, recruiting: 0 }, 3)).toEqual({ product: 2, growth: 1, recruiting: 0 });
  });

  it("scales a split to a different team size in proportion", () => {
    expect(refitAllocation({ product: 2, growth: 1, recruiting: 0 }, 5)).toEqual({ product: 3, growth: 2, recruiting: 0 });
    expect(refitAllocation({ product: 2, growth: 2, recruiting: 1 }, 4)).toEqual({ product: 2, growth: 1, recruiting: 1 });
  });

  it("puts everyone on Product when there is nothing to scale", () => {
    expect(refitAllocation({ product: 0, growth: 0, recruiting: 0 }, 3)).toEqual({ product: 3, growth: 0, recruiting: 0 });
  });

  it("returns an empty split when nobody is available", () => {
    expect(refitAllocation({ product: 2, growth: 1, recruiting: 0 }, 0)).toEqual({ product: 0, growth: 0, recruiting: 0 });
  });

  it("ignores negative and fractional entries", () => {
    expect(refitAllocation({ product: -3, growth: 1.9, recruiting: 1 }, 2)).toEqual({ product: 0, growth: 1, recruiting: 1 });
  });
});

describe("clamp", () => {
  it("keeps a value inside its bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
