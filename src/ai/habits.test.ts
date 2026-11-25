import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { raiseBlocker } from "../engine/plan";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { CompanyView, CpuKind, Plan } from "../engine/types";
import { companyRunway, viewFor } from "../engine/view";
import { choosePlans } from "./choosePlans";
import { newGameSetup } from "./names";

// The rivals' habits are part of the design: a player learns to read them. The other planner tests
// run on the design's starting numbers; these play the numbers the game ships with, so tuning that
// quietly turns a rival into a different kind of player fails here.

interface Decision {
  readonly view: CompanyView;
  readonly plan: Plan;
}

const decisions: Record<CpuKind, Decision[]> = { blitzscaler: [], bootstrapper: [], incumbent: [] };
for (let seed = 1; seed <= 16; seed++) {
  let state = createGame(newGameSetup(seed, "Acme"), CONFIG);
  while (state.outcome === null) {
    const plans = choosePlans(state, seed, CONFIG);
    for (const company of state.companies) {
      if (company.out !== null || company.controller === "human" || company.controller === "baseline") continue;
      decisions[company.controller].push({ view: viewFor(state, company.id), plan: plans[company.id]! });
    }
    state = resolveTurn(state, plans, seed, CONFIG).state;
  }
}
const share = (list: readonly Decision[], test: (d: Decision) => boolean): number => list.filter(test).length / list.length;
const lastTurn = (d: Decision): boolean => d.view.turn >= CONFIG.game.maxTurns;

describe("the rivals' habits, on the numbers the game ships with", () => {
  it("has plenty of decisions to judge by", () => {
    for (const kind of ["blitzscaler", "bootstrapper", "incumbent"] as const) expect(decisions[kind].length, kind).toBeGreaterThan(150);
  });

  it("Blitzscaler: always Budget, and a 30% raise on every turn the rules allow", () => {
    const turns = decisions.blitzscaler;
    expect(share(turns, (d) => d.plan.price === "budget")).toBe(1);
    const eligible = turns.filter((d) => raiseBlocker(d.view.self, d.view.turn, CONFIG) === null);
    expect(eligible.length).toBeGreaterThan(20);
    expect(share(eligible, (d) => d.plan.raisePercent === 30)).toBe(1);
  });

  it("Blitzscaler: spends more of its cash on marketing than the other two", () => {
    const spend = (kind: CpuKind): number => {
      const launched = decisions[kind].filter((d) => d.view.self.launched && d.view.self.cash > 0 && !lastTurn(d));
      return launched.reduce((sum, d) => sum + d.plan.marketing / d.view.self.cash, 0) / launched.length;
    };
    expect(spend("blitzscaler")).toBeGreaterThan(spend("bootstrapper"));
    expect(spend("blitzscaler")).toBeGreaterThan(spend("incumbent"));
  });

  it("Bootstrapper: always Premium, never raises with 2 turns of runway, keeps a small team, product first", () => {
    const turns = decisions.bootstrapper;
    expect(share(turns, (d) => d.plan.price === "premium")).toBe(1);
    const comfortable = turns.filter((d) => {
      const runway = companyRunway(d.view.self, CONFIG);
      return runway === null || runway >= 2;
    });
    expect(share(comfortable, (d) => d.plan.raisePercent === 0)).toBe(1);
    const cap = CONFIG.cpu.personalities.bootstrapper.teamCap;
    expect(Math.max(...turns.map((d) => d.view.self.headcount))).toBeLessThanOrEqual(cap);
    expect(cap).toBeLessThan(Math.max(...decisions.blitzscaler.map((d) => d.view.self.headcount)));
    expect(share(turns.filter((d) => !lastTurn(d)), (d) => d.plan.allocation.product >= d.plan.allocation.growth)).toBe(1);
  });

  it("Incumbent: poaches in most of its turns, and has more builders than marketers in most", () => {
    const turns = decisions.incumbent.filter((d) => !lastTurn(d));
    expect(share(turns, (d) => d.plan.poachTarget !== null)).toBeGreaterThan(0.5);
    expect(share(turns, (d) => d.plan.allocation.product >= d.plan.allocation.growth)).toBeGreaterThan(0.7);
  });

  it("nobody but the Incumbent poaches, and nobody changes price", () => {
    expect(share(decisions.blitzscaler, (d) => d.plan.poachTarget === null)).toBe(1);
    expect(share(decisions.bootstrapper, (d) => d.plan.poachTarget === null)).toBe(1);
    expect(share(decisions.incumbent, (d) => d.plan.price === d.view.self.price)).toBe(1);
  });
});
