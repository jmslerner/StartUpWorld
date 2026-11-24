import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { normalizePlanFor } from "../engine/plan";
import { BLITZ, HUMAN, INCUMBENT, launchedCompany, newGame, withCompany, withState } from "../engine/testKit";
import type { Company, GameState } from "../engine/types";
import { viewFor } from "../engine/view";
import { baselinePlan } from "./baselineBot";

const planFor = (state: GameState) => baselinePlan(viewFor(state, HUMAN), CONFIG);
/** A launched company with plenty of cash, so nothing but the team size drives the split. */
const launched = (patch: Partial<Company> = {}): GameState => launchedCompany(newGame(), HUMAN, { cash: 50_000_000, ...patch });

describe("baseline bot", () => {
  it("puts everyone on Product until it has launched", () => {
    expect(planFor(newGame()).allocation).toEqual({ product: 3, growth: 0, recruiting: 0 });
    const bigger = withCompany(newGame(), HUMAN, { headcount: 5, quality: 9.5 });
    expect(planFor(bigger).allocation).toEqual({ product: 5, growth: 0, recruiting: 0 });
  });

  it("splits 40 / 40 / 20 in whole people once launched", () => {
    const expected: Record<number, [number, number, number]> = {
      1: [1, 0, 0],
      2: [1, 1, 0],
      3: [1, 1, 1],
      4: [2, 1, 1],
      5: [2, 2, 1],
      6: [3, 2, 1],
      7: [3, 3, 1],
      8: [3, 3, 2],
      9: [4, 3, 2],
      10: [4, 4, 2],
      15: [6, 6, 3],
      20: [8, 8, 4],
    };
    for (const [headcount, [product, growth, recruiting]] of Object.entries(expected)) {
      const plan = planFor(launched({ headcount: Number(headcount) }));
      expect(plan.allocation, `headcount ${headcount}`).toEqual({ product, growth, recruiting });
    }
  });

  it("always charges Standard, spends nothing on marketing, and never poaches or lays off", () => {
    for (const state of [newGame(), launched(), launched({ cash: 10_000, headcount: 12 }), withCompany(launched(), HUMAN, { price: "premium" })]) {
      expect(planFor(state)).toMatchObject({ price: "standard", marketing: 0, poachTarget: null, layoffs: 0 });
    }
  });

  describe("raising", () => {
    // Last quarter: $120K costs, $20K revenue, so it burns $100K a turn.
    const burning = (cash: number, patch: Partial<Company> = {}): GameState => launchedCompany(newGame(), HUMAN, { cash, lastCosts: 120_000, lastRevenue: 20_000, ...patch });

    it("raises 20% when runway is under 3 turns", () => {
      expect(planFor(burning(299_999)).raisePercent).toBe(20);
      expect(planFor(burning(300_000)).raisePercent).toBe(0);
      expect(planFor(burning(900_000)).raisePercent).toBe(0);
    });

    it("does not raise while profitable, however little cash it has", () => {
      expect(planFor(burning(1_000, { lastRevenue: 120_000 })).raisePercent).toBe(0);
    });

    it("cannot raise without 1,000 users or inside the cooldown, and does not try", () => {
      expect(planFor(burning(50_000, { users: 999, usersAtLastClose: 999 })).raisePercent).toBe(0);
      const cooling = withState(burning(50_000, { lastRaise: { turn: 4, percent: 20, amount: 1 } }), { turn: 6 });
      expect(planFor(cooling).raisePercent).toBe(0);
      expect(planFor(withState(cooling, { turn: 7 })).raisePercent).toBe(20);
    });

    it("measures runway against salaries before its first quarter", () => {
      // 3 people cost $120K a turn: $359K is under 3 turns, $360K is not.
      const early = (cash: number) => withCompany(newGame(), HUMAN, { cash, users: 2_000, usersAtLastClose: 2_000, launched: true, quality: 20 });
      expect(planFor(early(359_000)).raisePercent).toBe(20);
      expect(planFor(early(360_000)).raisePercent).toBe(0);
    });

    it("takes the fundraiser out of the split", () => {
      const plan = planFor(burning(100_000, { headcount: 6, headcountAtLastClose: 6 }));
      expect(plan.raisePercent).toBe(20);
      expect(plan.allocation).toEqual({ product: 2, growth: 2, recruiting: 1 });
    });
  });

  describe("hiring", () => {
    it("hires only as many as leave it 3 turns of runway", () => {
      // Burn $120K. With h hires: (cash − 10K·h) ÷ (120K + 40K·h) ≥ 3  →  h ≤ (cash − 360K) ÷ 130K.
      const withCash = (cash: number) => planFor(launchedCompany(newGame(), HUMAN, { cash, lastCosts: 120_000, lastRevenue: 0 })).hireLimit;
      expect(withCash(360_000)).toBe(0);
      expect(withCash(489_999)).toBe(0);
      expect(withCash(490_000)).toBe(1);
      expect(withCash(620_000)).toBe(2);
      expect(withCash(100_000)).toBe(0);
    });

    it("counts on its revenue: a profitable company hires freely", () => {
      const profitable = launchedCompany(newGame(), HUMAN, { cash: 50_000, lastCosts: 120_000, lastRevenue: 400_000 });
      expect(planFor(profitable).hireLimit).toBeGreaterThanOrEqual(5);
    });
  });

  it("only ever produces a legal plan", () => {
    const states = [newGame(), launched(), launched({ headcount: 1 }), launched({ cash: 0, headcount: 9, lastCosts: 400_000, lastRevenue: 10_000 })];
    for (const state of states) {
      const view = viewFor(state, HUMAN);
      const plan = baselinePlan(view, CONFIG);
      expect(normalizePlanFor(view.self, view.turn, view.rivals, plan, CONFIG)).toEqual({ plan, notes: [] });
    }
  });

  it("decides from its own company alone: rivals do not change its plan", () => {
    const state = launched({ headcount: 7 });
    const changed = withCompany(withCompany(state, BLITZ, { users: 900_000, hype: 99, launched: true, quality: 90 }), INCUMBENT, { headcount: 40, cash: 1 });
    expect(planFor(changed)).toEqual(planFor(state));
  });
});
