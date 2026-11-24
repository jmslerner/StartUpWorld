import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { defaultPlan, normalizePlan, raiseBlocker } from "./plan";
import { BLITZ, HUMAN, INCUMBENT, newGame, onlyActive, planOf, withCompany, withState } from "./testKit";

describe("defaultPlan", () => {
  it("repeats last turn's split, marketing, price and hire limit, and drops the one-off actions", () => {
    const state = withCompany(newGame(), HUMAN, {
      headcount: 5,
      price: "premium",
      lastPlan: {
        allocation: { product: 3, growth: 1, recruiting: 1 },
        marketing: 75_000,
        price: "premium",
        raisePercent: 20,
        poachTarget: INCUMBENT,
        layoffs: 2,
        hireLimit: 1,
      },
    });
    expect(defaultPlan(state.companies[HUMAN])).toEqual({
      allocation: { product: 3, growth: 1, recruiting: 1 },
      marketing: 75_000,
      price: "premium",
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
      hireLimit: 1,
    });
  });

  it("refits last turn's split when the team has grown or shrunk", () => {
    const base = withCompany(newGame(), HUMAN, {
      lastPlan: { ...planOf(newGame(), HUMAN), allocation: { product: 2, growth: 1, recruiting: 0 } },
    });
    const grown = withCompany(base, HUMAN, { headcount: 5 });
    expect(defaultPlan(grown.companies[HUMAN]).allocation).toEqual({ product: 3, growth: 2, recruiting: 0 });
    const shrunk = withCompany(base, HUMAN, { headcount: 2 });
    expect(defaultPlan(shrunk.companies[HUMAN]).allocation).toEqual({ product: 1, growth: 1, recruiting: 0 });
  });
});

describe("normalizePlan", () => {
  it("leaves a legal plan alone and says nothing", () => {
    const state = newGame();
    const plan = planOf(state, HUMAN, { allocation: { product: 2, growth: 1, recruiting: 0 }, marketing: 50_000, price: "budget", hireLimit: 0 });
    expect(normalizePlan(state, HUMAN, plan, DESIGN)).toEqual({ plan, notes: [] });
  });

  it("uses the default plan when none is given", () => {
    const state = newGame();
    expect(normalizePlan(state, HUMAN, null, DESIGN)).toEqual({ plan: defaultPlan(state.companies[HUMAN]), notes: [] });
  });

  describe("team split", () => {
    it("refits a split that does not add up to the people available", () => {
      const state = newGame();
      const { plan, notes } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { allocation: { product: 1, growth: 1, recruiting: 0 } }), DESIGN);
      expect(plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting).toBe(3);
      expect(notes).toHaveLength(1);
    });

    it("takes laid-off people out of the split", () => {
      const state = withCompany(newGame(), HUMAN, { headcount: 6 });
      const { plan } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { allocation: { product: 3, growth: 3, recruiting: 0 }, layoffs: 2 }), DESIGN);
      expect(plan.layoffs).toBe(2);
      expect(plan.allocation).toEqual({ product: 2, growth: 2, recruiting: 0 });
    });

    it("takes the fundraiser out of the split", () => {
      const state = withCompany(newGame(), HUMAN, { users: 5_000, usersAtLastClose: 5_000 });
      const { plan } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { allocation: { product: 2, growth: 0, recruiting: 0 }, raisePercent: 20 }), DESIGN);
      expect(plan.raisePercent).toBe(20);
      expect(plan.allocation).toEqual({ product: 2, growth: 0, recruiting: 0 });
    });

    it("leaves a solo founder who raises with nobody working", () => {
      const state = withCompany(newGame(), HUMAN, { headcount: 1, users: 5_000, usersAtLastClose: 5_000 });
      const { plan } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { raisePercent: 10 }), DESIGN);
      expect(plan.raisePercent).toBe(10);
      expect(plan.allocation).toEqual({ product: 0, growth: 0, recruiting: 0 });
    });
  });

  describe("layoffs", () => {
    it("always keeps one person", () => {
      const state = newGame();
      const { plan, notes } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { layoffs: 9 }), DESIGN);
      expect(plan.layoffs).toBe(2);
      expect(plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting).toBe(1);
      expect(notes.length).toBeGreaterThan(0);
    });

    it("treats negative or fractional layoffs as whole people, never below zero", () => {
      const state = newGame();
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { layoffs: -2 }), DESIGN).plan.layoffs).toBe(0);
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { layoffs: 1.7 }), DESIGN).plan.layoffs).toBe(1);
    });
  });

  describe("raise", () => {
    const withUsers = (users: number) => withCompany(newGame(), HUMAN, { users, usersAtLastClose: users });

    it("needs 1,000 users at the start of the turn", () => {
      expect(normalizePlan(withUsers(999), HUMAN, planOf(withUsers(999), HUMAN, { raisePercent: 20 }), DESIGN).plan.raisePercent).toBe(0);
      expect(normalizePlan(withUsers(1_000), HUMAN, planOf(withUsers(1_000), HUMAN, { raisePercent: 20 }), DESIGN).plan.raisePercent).toBe(20);
      expect(raiseBlocker(withUsers(999).companies[HUMAN], 1, DESIGN)).toBe("users");
    });

    it("is blocked for the two turns after a raise and allowed on the third", () => {
      const raised = withCompany(withUsers(5_000), HUMAN, { lastRaise: { turn: 5, percent: 20, amount: 100_000 } });
      for (const turn of [6, 7]) {
        const state = withState(raised, { turn });
        expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { raisePercent: 10 }), DESIGN).plan.raisePercent).toBe(0);
        expect(raiseBlocker(state.companies[HUMAN], turn, DESIGN)).toBe("cooldown");
      }
      const state = withState(raised, { turn: 8 });
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { raisePercent: 10 }), DESIGN).plan.raisePercent).toBe(10);
      expect(raiseBlocker(state.companies[HUMAN], 8, DESIGN)).toBeNull();
    });

    it("only sells the sizes on offer", () => {
      const state = withUsers(5_000);
      const { plan, notes } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { raisePercent: 15 }), DESIGN);
      expect(plan.raisePercent).toBe(0);
      expect(notes).toHaveLength(1);
    });

    it("says why a raise was dropped, and puts the fundraiser back to work", () => {
      const state = newGame();
      const { plan, notes } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { allocation: { product: 2, growth: 0, recruiting: 0 }, raisePercent: 30 }), DESIGN);
      expect(plan.raisePercent).toBe(0);
      expect(plan.allocation).toEqual({ product: 3, growth: 0, recruiting: 0 });
      expect(notes.join(" ")).toMatch(/1,000 users/);
    });

    it("lets the Incumbent raise on turn 1", () => {
      const state = newGame();
      expect(raiseBlocker(state.companies[INCUMBENT], 1, DESIGN)).toBeNull();
    });
  });

  describe("marketing", () => {
    it("snaps down to a $25K step", () => {
      const state = newGame();
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { marketing: 60_000 }), DESIGN).plan.marketing).toBe(50_000);
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { marketing: 24_999 }), DESIGN).plan.marketing).toBe(0);
    });

    it("is never negative and never above the largest spend", () => {
      const state = newGame();
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { marketing: -50_000 }), DESIGN).plan.marketing).toBe(0);
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { marketing: 9_000_000_000 }), DESIGN).plan.marketing).toBe(DESIGN.pull.maxMarketing);
    });

    it("is not limited by cash on hand: the planner only warns", () => {
      const state = withCompany(newGame(), HUMAN, { cash: 10_000 });
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { marketing: 500_000 }), DESIGN).plan.marketing).toBe(500_000);
    });
  });

  describe("poach", () => {
    it("drops an attempt on yourself, on a company that is out, or on nobody", () => {
      const state = onlyActive(newGame(), [HUMAN, INCUMBENT]);
      for (const target of [HUMAN, BLITZ, 7, -1, 1.5]) {
        const { plan, notes } = normalizePlan(state, HUMAN, planOf(state, HUMAN, { poachTarget: target }), DESIGN);
        expect(plan.poachTarget, String(target)).toBeNull();
        expect(notes, String(target)).toHaveLength(1);
      }
    });

    it("drops an attempt on a team that is too small to lose anyone", () => {
      const state = withCompany(newGame(), BLITZ, { headcount: 1 });
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { poachTarget: BLITZ }), DESIGN).plan.poachTarget).toBeNull();
    });

    it("keeps a legal target", () => {
      const state = newGame();
      expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { poachTarget: INCUMBENT }), DESIGN)).toEqual({
        plan: planOf(state, HUMAN, { poachTarget: INCUMBENT }),
        notes: [],
      });
    });
  });

  it("falls back to the current price for an unknown tier", () => {
    const state = withCompany(newGame(), HUMAN, { price: "budget" });
    const plan = { ...planOf(state, HUMAN), price: "freemium" as unknown as "budget" };
    expect(normalizePlan(state, HUMAN, plan, DESIGN).plan.price).toBe("budget");
  });

  it("cleans up the hire limit", () => {
    const state = newGame();
    expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { hireLimit: -1 }), DESIGN).plan.hireLimit).toBe(0);
    expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { hireLimit: 2.9 }), DESIGN).plan.hireLimit).toBe(2);
    expect(normalizePlan(state, HUMAN, planOf(state, HUMAN, { hireLimit: null }), DESIGN).plan.hireLimit).toBeNull();
  });
});
