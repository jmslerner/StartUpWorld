import { describe, expect, it } from "vitest";
import { resolveMarket } from "./market";

const total = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe("resolveMarket", () => {
  it("builds the pool from new users, everyone's churned users and users carried in", () => {
    const result = resolveMarket(
      [
        { id: 0, users: 1_000, churnRate: 0.1, pull: 10 },
        { id: 3, users: 10_000, churnRate: 0.08, pull: 30 },
      ],
      20_000,
      500,
    );
    expect(result.churned).toBe(100 + 800);
    expect(result.pool).toBe(20_000 + 900 + 500);
    expect(result.newUsers).toBe(20_000);
    expect(result.carriedIn).toBe(500);
    expect(result.carriedOut).toBe(0);
  });

  it("splits the pool in proportion to pull", () => {
    const result = resolveMarket(
      [
        { id: 0, users: 0, churnRate: 0.1, pull: 25 },
        { id: 1, users: 0, churnRate: 0.1, pull: 75 },
      ],
      1_000,
      0,
    );
    expect(result.companies.map((c) => c.won)).toEqual([250, 750]);
    expect(result.companies.map((c) => c.share)).toEqual([0.25, 0.75]);
    expect(result.companies.map((c) => c.users)).toEqual([250, 750]);
  });

  it("conserves users exactly, whatever the pulls", () => {
    const entries = [
      { id: 0, users: 1_737, churnRate: 0.106, pull: 27.1 },
      { id: 1, users: 4_595, churnRate: 0.0931, pull: 31.7 },
      { id: 2, users: 13, churnRate: 0.16, pull: 0.003 },
      { id: 3, users: 24_788, churnRate: 0.082, pull: 137.7 },
    ];
    const before = total(entries.map((e) => e.users));
    const result = resolveMarket(entries, 22_000, 321);
    expect(total(result.companies.map((c) => c.users)) + result.carriedOut).toBe(before + 22_000 + 321);
    expect(total(result.companies.map((c) => c.won))).toBe(result.pool);
    for (const c of result.companies) {
      expect(Number.isInteger(c.churned)).toBe(true);
      expect(Number.isInteger(c.won)).toBe(true);
    }
  });

  it("gives a company on its own all of the pool, its own churn included", () => {
    const result = resolveMarket([{ id: 3, users: 10_000, churnRate: 0.1, pull: 5 }], 2_000, 0);
    expect(result.companies[0]).toMatchObject({ id: 3, churned: 1_000, won: 3_000, users: 12_000, share: 1 });
  });

  it("holds the pool for next turn when nobody has any pull", () => {
    const result = resolveMarket([{ id: 0, users: 1_000, churnRate: 0.12, pull: 0 }], 5_000, 100);
    expect(result.companies[0]).toMatchObject({ churned: 120, won: 0, users: 880, share: 0 });
    expect(result.carriedOut).toBe(5_000 + 120 + 100);
  });

  it("holds the pool when nobody has launched", () => {
    const result = resolveMarket([], 20_000, 0);
    expect(result.companies).toEqual([]);
    expect(result.pool).toBe(20_000);
    expect(result.carriedOut).toBe(20_000);
  });

  it("rounds churn to whole users", () => {
    const result = resolveMarket([{ id: 0, users: 1_005, churnRate: 0.1, pull: 1 }], 0, 0);
    expect(result.companies[0].churned).toBe(101);
  });

  it("keeps companies in the order they were given", () => {
    const result = resolveMarket(
      [
        { id: 2, users: 0, churnRate: 0.1, pull: 1 },
        { id: 0, users: 0, churnRate: 0.1, pull: 1 },
      ],
      10,
      0,
    );
    expect(result.companies.map((c) => c.id)).toEqual([2, 0]);
  });
});
