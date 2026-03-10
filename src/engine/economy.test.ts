import { describe, it, expect } from "vitest";
import { calcBurn, calcWeeklyRevenue, calcNetBurn, calcRunwayWeeks, getApCost, getEffectiveMaxAp } from "./economy";
import { makeState } from "./testHelpers";

describe("calcBurn", () => {
  it("includes stage overhead even with zero team", () => {
    const state = makeState({
      team: { engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0 },
    });
    expect(calcBurn(state)).toBeGreaterThan(0);
  });

  it("increases with more team members", () => {
    const small = makeState({ team: { ...makeState().team, engineering: 1 } });
    const large = makeState({ team: { ...makeState().team, engineering: 5 } });
    expect(calcBurn(large)).toBeGreaterThan(calcBurn(small));
  });

  it("includes asset maintenance", () => {
    const without = makeState();
    const withAsset = makeState({ assets: [{ id: "helicopter", name: "Company Helicopter", purchaseWeek: 1 }] });
    expect(calcBurn(withAsset)).toBeGreaterThan(calcBurn(without));
  });
});

describe("calcWeeklyRevenue", () => {
  it("is MRR / 4", () => {
    const state = makeState({ mrr: 10_000 });
    expect(calcWeeklyRevenue(state)).toBe(2_500);
  });

  it("rounds to integer", () => {
    const state = makeState({ mrr: 1 });
    expect(Number.isInteger(calcWeeklyRevenue(state))).toBe(true);
  });
});

describe("calcNetBurn", () => {
  it("is positive when burning more than earning", () => {
    const state = makeState({ burn: 5000, mrr: 4000 }); // 5000 - 1000 = 4000
    expect(calcNetBurn(state)).toBeGreaterThan(0);
  });

  it("is negative (profitable) when revenue exceeds burn", () => {
    const state = makeState({ burn: 1000, mrr: 20_000 }); // 1000 - 5000 = -4000
    expect(calcNetBurn(state)).toBeLessThan(0);
  });
});

describe("calcRunwayWeeks", () => {
  it("returns 999 when profitable", () => {
    const state = makeState({ burn: 1000, mrr: 20_000, cash: 100_000 });
    expect(calcRunwayWeeks(state)).toBe(999);
  });

  it("calculates floor(cash / netBurn) when burning", () => {
    const state = makeState({ burn: 5000, mrr: 0, cash: 22_000 });
    // netBurn = 5000, runway = floor(22000/5000) = 4
    expect(calcRunwayWeeks(state)).toBe(4);
  });
});

describe("getApCost", () => {
  it("returns base cost for unknown actions", () => {
    const state = makeState();
    expect(getApCost(state, "unknown-action")).toBe(1);
  });

  it("hacker gets first ship free", () => {
    const state = makeState({ founder: { name: "Test", archetype: "hacker" }, freeActionUsed: {} });
    expect(getApCost(state, "ship")).toBe(0);
  });

  it("hacker pays base cost after free action used", () => {
    const state = makeState({
      founder: { name: "Test", archetype: "hacker" },
      freeActionUsed: { "hacker-free-ship": true },
    });
    expect(getApCost(state, "ship")).toBe(1);
  });

  it("sales-animal gets first pitch free", () => {
    const state = makeState({ founder: { name: "Test", archetype: "sales-animal" }, freeActionUsed: {} });
    expect(getApCost(state, "pitch")).toBe(0);
  });

  it("visionary gets first launch free", () => {
    const state = makeState({ founder: { name: "Test", archetype: "visionary" }, freeActionUsed: {} });
    expect(getApCost(state, "launch")).toBe(0);
  });

  it("philosopher gets no free actions", () => {
    const state = makeState({ founder: { name: "Test", archetype: "philosopher" }, freeActionUsed: {} });
    expect(getApCost(state, "ship")).toBe(1);
    expect(getApCost(state, "pitch")).toBe(1);
    expect(getApCost(state, "launch")).toBe(1);
  });
});

describe("getEffectiveMaxAp", () => {
  it("base AP is 3 for non-philosopher at garage", () => {
    const state = makeState({ founder: { name: "Test", archetype: "hacker" }, stage: "garage" });
    expect(getEffectiveMaxAp(state)).toBe(3);
  });

  it("philosopher gets +1 AP", () => {
    const state = makeState({ founder: { name: "Test", archetype: "philosopher" }, stage: "garage" });
    expect(getEffectiveMaxAp(state)).toBe(4);
  });

  it("series-a stage adds +1 AP", () => {
    const state = makeState({ founder: { name: "Test", archetype: "hacker" }, stage: "series-a" });
    expect(getEffectiveMaxAp(state)).toBe(4);
  });

  it("philosopher at series-a gets +2 total", () => {
    const state = makeState({ founder: { name: "Test", archetype: "philosopher" }, stage: "series-a" });
    expect(getEffectiveMaxAp(state)).toBe(5);
  });
});
