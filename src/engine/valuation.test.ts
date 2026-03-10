import { describe, it, expect } from "vitest";
import { calcArr, calcValuation, STAGE_VALUATION_FLOOR } from "./valuation";
import { makeState, makeCtx } from "./testHelpers";

describe("calcArr", () => {
  it("is MRR * 12", () => {
    const state = makeState({ mrr: 10_000 });
    expect(calcArr(state)).toBe(120_000);
  });

  it("returns 0 for negative MRR", () => {
    const state = makeState({ mrr: -100 });
    expect(calcArr(state)).toBe(0);
  });
});

describe("calcValuation", () => {
  it("never goes below stage floor", () => {
    const state = makeState({ mrr: 0, stage: "garage" });
    const ctx = makeCtx({ mrrGrowthRate: 0 });
    const val = calcValuation(state, ctx);
    expect(val).toBeGreaterThanOrEqual(STAGE_VALUATION_FLOOR.garage);
  });

  it("higher MRR growth increases valuation", () => {
    // Use high MRR to exceed stage floor so growth difference is visible
    const state = makeState({ mrr: 500_000, stage: "series-a" });
    const lowGrowth = calcValuation(state, makeCtx({ mrrGrowthRate: 0.01 }));
    const highGrowth = calcValuation(state, makeCtx({ mrrGrowthRate: 0.3 }));
    expect(highGrowth).toBeGreaterThan(lowGrowth);
  });

  it("high stress reduces valuation", () => {
    // Use high MRR to exceed stage floor so stress difference is visible
    const base = makeState({ mrr: 500_000, stage: "series-a", stress: 10 });
    const stressed = makeState({ mrr: 500_000, stage: "series-a", stress: 90 });
    const ctx = makeCtx();
    expect(calcValuation(stressed, ctx)).toBeLessThan(calcValuation(base, ctx));
  });

  it("returns a rounded number (multiple of 1000)", () => {
    const state = makeState({ mrr: 5_000 });
    const val = calcValuation(state, makeCtx());
    expect(val % 1000).toBe(0);
  });

  it("respects stage cap", () => {
    // Garage cap is $25M
    const state = makeState({
      mrr: 200_000,
      stage: "garage",
      vcReputation: 100,
      reputation: 100,
      volatility: 100,
      stress: 0,
    });
    const val = calcValuation(state, makeCtx({ mrrGrowthRate: 0.5 }));
    expect(val).toBeLessThanOrEqual(25_000_000);
  });
});
