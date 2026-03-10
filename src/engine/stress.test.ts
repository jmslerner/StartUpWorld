import { describe, it, expect } from "vitest";
import { calcStress, successPenaltyFromStress } from "./stress";
import { makeState } from "./testHelpers";

describe("calcStress", () => {
  it("zero runway gives high stress", () => {
    const state = makeState({ cash: 0, burn: 5_000, mrr: 0, culture: { cohesion: 50, morale: 50 }, volatility: 50 });
    const stress = calcStress(state);
    expect(stress).toBeGreaterThanOrEqual(60);
  });

  it("high morale reduces stress", () => {
    const lowMorale = makeState({ culture: { cohesion: 50, morale: 20 }, cash: 50_000, burn: 5_000, mrr: 0 });
    const highMorale = makeState({ culture: { cohesion: 50, morale: 90 }, cash: 50_000, burn: 5_000, mrr: 0 });
    expect(calcStress(highMorale)).toBeLessThan(calcStress(lowMorale));
  });

  it("result is clamped 0-100", () => {
    // Best case: profitable, high morale, low volatility
    const best = makeState({ cash: 1_000_000, burn: 1_000, mrr: 20_000, culture: { cohesion: 100, morale: 100 }, volatility: 0 });
    const worst = makeState({ cash: 0, burn: 10_000, mrr: 0, culture: { cohesion: 0, morale: 0 }, volatility: 100 });
    expect(calcStress(best)).toBeGreaterThanOrEqual(0);
    expect(calcStress(best)).toBeLessThanOrEqual(100);
    expect(calcStress(worst)).toBeGreaterThanOrEqual(0);
    expect(calcStress(worst)).toBeLessThanOrEqual(100);
  });

  it("high volatility increases stress", () => {
    const calm = makeState({ volatility: 10, cash: 50_000, burn: 5_000, mrr: 0 });
    const chaotic = makeState({ volatility: 90, cash: 50_000, burn: 5_000, mrr: 0 });
    expect(calcStress(chaotic)).toBeGreaterThan(calcStress(calm));
  });
});

describe("successPenaltyFromStress", () => {
  it("returns ~0.05 at stress 0", () => {
    const state = makeState({ stress: 0 });
    expect(successPenaltyFromStress(state)).toBeCloseTo(0.05, 2);
  });

  it("returns 0.35 at stress 100", () => {
    const state = makeState({ stress: 100 });
    expect(successPenaltyFromStress(state)).toBe(0.35);
  });

  it("is always in [0.05, 0.35]", () => {
    for (let s = 0; s <= 100; s += 10) {
      const penalty = successPenaltyFromStress(makeState({ stress: s }));
      expect(penalty).toBeGreaterThanOrEqual(0.05);
      expect(penalty).toBeLessThanOrEqual(0.35);
    }
  });

  it("increases monotonically with stress", () => {
    let prev = 0;
    for (let s = 0; s <= 100; s += 10) {
      const penalty = successPenaltyFromStress(makeState({ stress: s }));
      expect(penalty).toBeGreaterThanOrEqual(prev);
      prev = penalty;
    }
  });
});
