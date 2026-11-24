import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { churnRate } from "./formulas";
import { defaultPlan } from "./plan";
import { estimateRivals, projectTurn } from "./project";
import { resolveTurn } from "./resolveTurn";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, planOf, plansOf, reportFor, resolve, withCompany, withState } from "./testKit";
import type { Plan } from "./types";
import { viewFor } from "./view";

const NEVER = { ...CONFIG, events: { ...CONFIG.events, chance: 0 } };

describe("projectTurn", () => {
  it("matches the engine exactly for a company alone in the market", () => {
    const state = withState(
      onlyActive(launchedCompany(newGame(), HUMAN, { headcount: 5, headcountAtLastClose: 5, cash: 400_000, hype: 20 }), [HUMAN]),
      { turn: 3, carryOverUsers: 700 },
    );
    const plan = planOf(state, HUMAN, { allocation: { product: 2, growth: 2, recruiting: 1 }, marketing: 50_000, price: "premium" });
    const projection = projectTurn(viewFor(state, HUMAN), plan, CONFIG);
    const report = reportFor(resolveTurn(state, [plan], 1, CONFIG), HUMAN);
    expect(projection.plan).toEqual(report.plan);
    expect(projection.quality).toBe(report.quality.end);
    expect(projection.usersChurned).toBe(report.users.churned);
    expect(projection.usersWon).toBe(report.users.won);
    expect(projection.users).toBe(report.users.end);
    expect(projection.revenue).toBe(report.revenue);
    expect(projection.costs).toEqual(report.costs);
    expect(projection.cash).toBe(report.cash.end);
    expect(projection.profitable).toBe(report.profitable);
    expect(projection.runway).toBe(report.runway);
    expect(projection.hype).toBe(report.hype.end);
    expect(projection.valuation).toBe(report.valuation);
    expect(projection.hires).toBe(report.hiring.hired);
    expect(projection.headcount).toBe(report.headcount.end);
  });

  it("matches the engine on everything that does not depend on rivals", () => {
    const plans: Partial<Plan>[] = [
      {},
      { allocation: { product: 1, growth: 1, recruiting: 1 }, marketing: 75_000, price: "budget" },
      { raisePercent: 20, allocation: { product: 1, growth: 1, recruiting: 0 } },
      { layoffs: 1, allocation: { product: 1, growth: 1, recruiting: 0 } },
      { raisePercent: 30, layoffs: 2 },
      { marketing: 60_000, hireLimit: 1, allocation: { product: 0, growth: 1, recruiting: 2 } },
    ];
    const state = launchedCompany(newGame(), HUMAN, { users: 8_000, hype: 35, cash: 300_000 });
    for (const patch of plans) {
      const plan = planOf(state, HUMAN, patch);
      const projection = projectTurn(viewFor(state, HUMAN), plan, CONFIG);
      const report = reportFor(resolve(state, { [HUMAN]: patch }), HUMAN);
      expect(projection.plan).toEqual(report.plan);
      expect(projection.notes).toEqual(report.notes);
      expect(projection.raise).toEqual(report.raise);
      expect(projection.work).toEqual(report.work);
      expect(projection.quality).toBe(report.quality.end);
      expect(projection.launchedNow).toBe(report.quality.launchedNow);
      expect(projection.usersChurned).toBe(report.users.churned);
      expect(projection.pull).toBe(report.users.pull);
      expect(projection.costs.salaries).toBe(report.costs.salaries);
      expect(projection.costs.marketing).toBe(report.costs.marketing);
      expect(projection.costs.severance).toBe(report.costs.severance);
      expect(projection.equity).toBe(report.equity);
      expect(projection.hiresWanted).toBe(report.hiring.wanted);
    }
  });

  it("projects a launch, and the Incumbent's catch-up bonus, from public information", () => {
    const fresh = newGame();
    expect(projectTurn(viewFor(fresh, HUMAN), null, CONFIG)).toMatchObject({ launchedNow: true, launched: true });
    const behind = launchedCompany(newGame(), HUMAN, { quality: 60 });
    const projection = projectTurn(viewFor(behind, INCUMBENT), null, CONFIG);
    expect(projection.quality).toBe(reportFor(resolve(behind), INCUMBENT).quality.end);
  });

  it("splits the pool with the rival estimate it is given", () => {
    const state = launchedCompany(newGame(), HUMAN, { users: 10_000 });
    const view = viewFor(state, HUMAN);
    const alone = projectTurn(view, null, CONFIG, { pull: 0, churn: 0 });
    const contested = projectTurn(view, null, CONFIG, { pull: alone.pull, churn: 2_000 });
    expect(alone.pool).toBe(20_000 + alone.usersChurned);
    expect(alone.usersWon).toBe(alone.pool);
    expect(contested.pool).toBe(alone.pool + 2_000);
    expect(contested.usersWon).toBe(Math.round(contested.pool / 2));
    expect(contested.share).toBeCloseTo(0.5, 9);
  });

  it("is conservative about hiring: it pays for every hire wanted", () => {
    const state = newGame();
    const projection = projectTurn(viewFor(state, HUMAN), planOf(state, HUMAN, { allocation: { product: 2, growth: 0, recruiting: 1 } }), CONFIG);
    expect(projection.hiresWanted).toBe(2);
    expect(projection.costs.hiring).toBe(20_000);
    expect(projection.hires).toBeLessThanOrEqual(2);
  });

  it("counts the poach fee and reports the odds", () => {
    const state = newGame();
    const projection = projectTurn(viewFor(state, INCUMBENT), planOf(state, INCUMBENT, { poachTarget: HUMAN }), CONFIG);
    expect(projection.costs.poaching).toBe(50_000);
    expect(projection.poachChance).toBeCloseTo(0.55, 9);
    expect(projectTurn(viewFor(state, INCUMBENT), null, CONFIG).poachChance).toBeNull();
  });

  it("flags the chance of being fired when investors hold the board and the quarter looks bad", () => {
    const idle = { allocation: { product: 0, growth: 3, recruiting: 0 } };
    const shrinking = launchedCompany(newGame(), HUMAN, { quality: 0, users: 50_000, cash: 5_000_000, investorSeats: 3 });
    expect(projectTurn(viewFor(shrinking, HUMAN), planOf(shrinking, HUMAN, idle), CONFIG).boardRisk).toBe(0.3);
    const founderLed = withCompany(shrinking, HUMAN, { investorSeats: 2 });
    expect(projectTurn(viewFor(founderLed, HUMAN), planOf(founderLed, HUMAN, idle), CONFIG).boardRisk).toBe(0);
    const healthy = launchedCompany(newGame(), HUMAN, { quality: 60, cash: 5_000_000, investorSeats: 3 });
    expect(projectTurn(viewFor(healthy, HUMAN), null, CONFIG).boardRisk).toBe(0);
  });

  it("uses the config file and its own rival estimate by default", () => {
    const view = viewFor(newGame(), HUMAN);
    expect(projectTurn(view, null)).toEqual(projectTurn(view, null, CONFIG, estimateRivals(view, CONFIG)));
  });
});

describe("estimateRivals", () => {
  it("works out each rival's pull from the users it won, carried forward along its quality and hype trend", () => {
    const first = resolve(newGame(), { [BLITZ]: { marketing: 100_000 } }, 1, NEVER);
    const estimate = estimateRivals(viewFor(first.state, HUMAN), CONFIG);
    // If the rivals simply repeat their plans, this is what their pull turns out to be.
    const second = resolveTurn(first.state, plansOf(first.state), 1, NEVER);
    const actual = [BLITZ, BOOT, INCUMBENT].reduce((sum, id) => sum + reportFor(second, id).users.pull, 0);
    expect(estimate.pull).toBeGreaterThan(0);
    expect(Math.abs(estimate.pull - actual) / actual).toBeLessThan(0.02);
  });

  it("expects a rival that is about to launch to join the market", () => {
    const slow = { [BOOT]: { allocation: { product: 2, growth: 1, recruiting: 0 } } };
    const first = resolve(newGame(), slow, 1, NEVER);
    expect(first.state.companies[BOOT].launched).toBe(false);
    const withBoot = estimateRivals(viewFor(first.state, HUMAN), CONFIG).pull;
    const withoutBoot = estimateRivals(viewFor(onlyActive(first.state, [HUMAN, BLITZ, INCUMBENT]), HUMAN), CONFIG).pull;
    expect(withBoot).toBeGreaterThan(withoutBoot);
    const second = resolveTurn(first.state, plansOf(first.state), 1, NEVER);
    expect(reportFor(second, BOOT).quality.launchedNow).toBe(true);
  });

  it("makes the projection land close to what happens when rivals repeat themselves", () => {
    const first = resolve(newGame(), {}, 1, NEVER);
    const projection = projectTurn(viewFor(first.state, HUMAN), null, CONFIG);
    const second = resolveTurn(first.state, plansOf(first.state), 1, NEVER);
    const actual = reportFor(second, HUMAN).users.end;
    expect(Math.abs(projection.users - actual) / actual).toBeLessThan(0.03);
  });

  it("guesses from public stats before it has a quarter of its own to compare with", () => {
    const state = newGame();
    const estimate = estimateRivals(viewFor(state, HUMAN), CONFIG);
    const incumbent = state.companies[INCUMBENT];
    // Only the Incumbent is launched on turn 1: quality 30 × guess × Standard × (1 + 20/100).
    expect(estimate.pull).toBeCloseTo(30 * CONFIG.projection.rivalPullGuess * 1 * 1.2, 9);
    expect(estimate.churn).toBe(Math.round(incumbent.users * churnRate(30, "standard", CONFIG)));
  });

  it("ignores rivals that are out or have not launched", () => {
    const state = onlyActive(newGame(), [HUMAN, BLITZ]);
    expect(estimateRivals(viewFor(state, HUMAN), CONFIG)).toEqual({ pull: 0, churn: 0 });
  });

  it("never reads a rival's private fields", () => {
    const state = resolve(newGame(), {}, 1, NEVER).state;
    const view = viewFor(state, HUMAN);
    const secret = withCompany(withCompany(state, BLITZ, { cash: 1, lastPull: 999_999, lastPlan: defaultPlan(state.companies[INCUMBENT]) }), INCUMBENT, { cash: 1, lastPull: 123 });
    expect(estimateRivals(viewFor(secret, HUMAN), CONFIG)).toEqual(estimateRivals(view, CONFIG));
  });
});
