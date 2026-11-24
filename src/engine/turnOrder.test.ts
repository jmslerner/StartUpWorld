import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { effectiveWork } from "./formulas";
import { defaultPlan } from "./plan";
import { resolveTurn } from "./resolveTurn";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, plansOf, reportFor, resolve, withCompany } from "./testKit";

describe("resolveTurn", () => {
  it("moves the game to the next turn and leaves its inputs untouched", () => {
    const state = newGame();
    const plans = plansOf(state);
    const before = JSON.stringify({ state, plans });
    const result = resolveTurn(state, plans, 1, CONFIG);
    expect(result.log.turn).toBe(1);
    expect(result.state.turn).toBe(2);
    expect(result.state).not.toBe(state);
    expect(JSON.stringify({ state, plans })).toBe(before);
  });

  it("uses the config file when no config is passed", () => {
    const state = newGame();
    expect(resolveTurn(state, plansOf(state), 5)).toEqual(resolveTurn(state, plansOf(state), 5, CONFIG));
  });

  it("reports on every company still in the game and leaves the others alone", () => {
    const state = onlyActive(newGame(), [HUMAN, INCUMBENT]);
    const result = resolve(state);
    expect(result.log.companies.map((r) => r?.companyId ?? null)).toEqual([HUMAN, null, null, INCUMBENT]);
    expect(result.state.companies[BLITZ]).toBe(state.companies[BLITZ]);
    expect(result.state.companies[BOOT]).toBe(state.companies[BOOT]);
  });

  it("repeats a company's last plan when it sends none", () => {
    const state = withCompany(newGame(), HUMAN, {
      price: "budget",
      lastPlan: { ...defaultPlan(newGame().companies[HUMAN]), allocation: { product: 2, growth: 1, recruiting: 0 }, marketing: 50_000, price: "budget" },
    });
    const result = resolveTurn(state, [null, null, null, null], 1, CONFIG);
    expect(reportFor(result, HUMAN).plan).toEqual(defaultPlan(state.companies[HUMAN]));
    expect(reportFor(result, HUMAN).plan.marketing).toBe(50_000);
    expect(resolveTurn(state, [], 1, CONFIG)).toEqual(result);
  });

  it("stores the plan as resolved, so it is the default next turn", () => {
    const state = newGame();
    const result = resolve(state, { [HUMAN]: { allocation: { product: 2, growth: 1, recruiting: 0 }, marketing: 25_000, price: "premium" } });
    const next = result.state.companies[HUMAN];
    expect(next.price).toBe("premium");
    expect(defaultPlan(next)).toMatchObject({ allocation: { product: 2, growth: 1, recruiting: 0 }, marketing: 25_000, price: "premium" });
  });

  it("passes the fix-up notes of an illegal plan into the report", () => {
    const result = resolve(newGame(), { [HUMAN]: { raisePercent: 30 } });
    expect(reportFor(result, HUMAN).plan.raisePercent).toBe(0);
    expect(reportFor(result, HUMAN).notes.join(" ")).toMatch(/Raise dropped/);
    expect(reportFor(result, HUMAN).raise).toBeNull();
  });

  it("does nothing to a game that is over", () => {
    const over = { ...newGame(), outcome: { kind: "ipo", turn: 1, winnerId: INCUMBENT } as const };
    const result = resolve(over);
    expect(result.state).toBe(over);
    expect(result.log.outcome).toEqual(over.outcome);
    expect(result.log.companies).toEqual([null, null, null, null]);
  });
});

describe("turn order", () => {
  it("lays people off before the work is done: they neither work nor draw a salary", () => {
    const state = withCompany(newGame(), HUMAN, { headcount: 6, headcountAtLastClose: 6 });
    const result = resolve(state, { [HUMAN]: { layoffs: 2, allocation: { product: 4, growth: 0, recruiting: 0 } } });
    const report = reportFor(result, HUMAN);
    expect(report.headcount.laidOff).toBe(2);
    expect(report.work.effective).toBe(effectiveWork(4, 0.9));
    expect(report.costs.salaries).toBe(4 * 40_000);
    expect(report.costs.severance).toBe(2 * 20_000);
  });

  it("closes the raise before the bills: its cash can avert bankruptcy", () => {
    const broke = launchedCompany(newGame(), HUMAN, { cash: 10_000, hype: 20 });
    const without = resolve(broke);
    expect(without.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    const withRaise = resolve(broke, { [HUMAN]: { raisePercent: 20, allocation: { product: 2, growth: 0, recruiting: 0 } } });
    expect(reportFor(withRaise, HUMAN).raise?.amount).toBe(360_000);
    expect(withRaise.state.companies[HUMAN].out).toBeNull();
    expect(withRaise.state.companies[HUMAN].cash).toBeGreaterThan(0);
  });

  it("builds before the market opens: a product that launches this turn wins users this turn", () => {
    const result = resolve(newGame());
    const report = reportFor(result, HUMAN);
    expect(report.quality.launchedNow).toBe(true);
    expect(report.users.won).toBeGreaterThan(0);
    expect(report.revenue).toBe(report.users.end * 3);
    expect(result.state.companies[HUMAN].users).toBe(report.users.end);
  });

  it("uses this turn's quality for churn: building cuts the churn of the same turn", () => {
    const state = onlyActive(launchedCompany(newGame(), HUMAN, { quality: 40 }), [HUMAN]);
    const building = reportFor(resolve(state, { [HUMAN]: { allocation: { product: 3, growth: 0, recruiting: 0 } } }), HUMAN);
    const coasting = reportFor(resolve(state, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }), HUMAN);
    expect(building.quality.end).toBeGreaterThan(coasting.quality.end);
    expect(building.users.churned).toBeLessThan(coasting.users.churned);
  });

  it("starts hires next turn: a fee now, a salary from next turn", () => {
    const state = newGame();
    const first = resolve(state, { [HUMAN]: { allocation: { product: 2, growth: 0, recruiting: 1 } } });
    const report = reportFor(first, HUMAN);
    expect(report.hiring.hired).toBe(2);
    expect(report.costs.hiring).toBe(2 * 10_000);
    expect(report.costs.salaries).toBe(3 * 40_000);
    expect(report.headcount.end).toBe(5);
    expect(first.state.companies[HUMAN].headcount).toBe(5);
    const second = resolve(first.state);
    expect(reportFor(second, HUMAN).costs.salaries).toBe(5 * 40_000);
  });

  it("charges revenue on end-of-turn users", () => {
    const state = launchedCompany(newGame(), HUMAN, { users: 10_000 });
    const report = reportFor(resolve(state), HUMAN);
    expect(report.users.end).not.toBe(10_000);
    expect(report.revenue).toBe(report.users.end * 3);
  });

  it("decays hype before adding this turn's bonuses", () => {
    const state = withCompany(newGame(), HUMAN, { hype: 50 });
    const idle = reportFor(resolve(state, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }), HUMAN);
    expect(idle.hype).toMatchObject({ start: 50, end: 40, launch: 0, raise: 0, growth: 0, layoffs: 0 });
    const launching = reportFor(resolve(state), HUMAN);
    expect(launching.hype).toMatchObject({ start: 50, end: 55, launch: 15 });
  });

  it("checks for an IPO before bankruptcy and the board: an IPO ends the game at once", () => {
    let state = launchedCompany(newGame(), HUMAN, { users: 300_000, quality: 90, cash: 1_000_000 });
    state = withCompany(state, BLITZ, { cash: 0 });
    const result = resolve(state);
    expect(reportFor(result, HUMAN).profitable).toBe(true);
    expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
    expect(result.log.outcome).toEqual(result.state.outcome);
    expect(reportFor(result, BLITZ).cash.end).toBeLessThan(0);
    expect(result.state.companies[BLITZ].out).toBeNull();
    expect(result.state.turn).toBe(1);
  });
});
