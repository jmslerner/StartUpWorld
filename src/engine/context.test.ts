import { describe, it, expect } from "vitest";
import { computeTeamSize, computeContext } from "./context";
import { makeState } from "./testHelpers";

describe("computeTeamSize", () => {
  it("sums all roles", () => {
    const state = makeState({
      team: { engineering: 3, design: 1, marketing: 2, sales: 0, ops: 1, hr: 0, legal: 0, data: 0, product: 0, executive: 0 },
    });
    expect(computeTeamSize(state)).toBe(7);
  });

  it("returns 0 for empty team", () => {
    const state = makeState({
      team: { engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0 },
    });
    expect(computeTeamSize(state)).toBe(0);
  });
});

describe("computeContext", () => {
  it("nearBankruptcy is true when runway <= 3", () => {
    // Very low cash, high burn → short runway
    const state = makeState({ cash: 5_000, burn: 5_000, mrr: 0 });
    const ctx = computeContext(state);
    expect(ctx.nearBankruptcy).toBe(true);
  });

  it("nearBankruptcy is true when cash < 0", () => {
    const state = makeState({ cash: -1, burn: 1000, mrr: 0 });
    const ctx = computeContext(state);
    expect(ctx.nearBankruptcy).toBe(true);
  });

  it("nearBankruptcy is false with healthy runway", () => {
    const state = makeState({ cash: 500_000, burn: 5_000, mrr: 0 });
    const ctx = computeContext(state);
    expect(ctx.nearBankruptcy).toBe(false);
  });

  it("profitable is true when revenue exceeds burn", () => {
    const state = makeState({ burn: 1_000, mrr: 20_000 });
    const ctx = computeContext(state);
    expect(ctx.profitable).toBe(true);
  });

  it("profitable is false when burning more than earning", () => {
    const state = makeState({ burn: 5_000, mrr: 1_000 });
    const ctx = computeContext(state);
    expect(ctx.profitable).toBe(false);
  });

  it("growth rates are clamped", () => {
    // Simulate huge growth: 10 users → 1000 users
    const state = makeState({ users: 1000, lastWeek: { users: 10, mrr: 1, cash: 100_000, teamSize: 1 }, mrr: 100 });
    const ctx = computeContext(state);
    expect(ctx.usersGrowthRate).toBeLessThanOrEqual(2.0);
    expect(ctx.mrrGrowthRate).toBeLessThanOrEqual(2.0);
  });
});
