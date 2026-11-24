import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { normalizePlanFor, raiseBlocker } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { resolveTurn } from "../engine/resolveTurn";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, withCompany, withState } from "../engine/testKit";
import type { Company, CompanyView, CpuKind, GameState, Plan } from "../engine/types";
import { companyRunway, viewFor } from "../engine/view";
import { choosePlans } from "./choosePlans";
import { candidatePlans, chooseCpuPlan } from "./cpu";

const KINDS: readonly CpuKind[] = ["blitzscaler", "bootstrapper", "incumbent"];
const SEAT: Record<CpuKind, number> = { blitzscaler: BLITZ, bootstrapper: BOOT, incumbent: INCUMBENT };

interface Decision {
  readonly state: GameState;
  readonly view: CompanyView;
  readonly kind: CpuKind;
  readonly plan: Plan;
}

/** Every decision the three CPUs make over a few self-played games (the human seat repeats its default plan). */
const decisions: Decision[] = [];
for (let seed = 1; seed <= 12; seed++) {
  let state = newGame();
  while (state.outcome === null) {
    const plans = choosePlans(state, seed, CONFIG);
    for (const company of state.companies) {
      if (company.out !== null || company.controller === "human") continue;
      decisions.push({ state, view: viewFor(state, company.id), kind: company.controller as CpuKind, plan: plans[company.id]! });
    }
    state = resolveTurn(state, plans, seed, CONFIG).state;
  }
}
const of = (kind: CpuKind): Decision[] => decisions.filter((d) => d.kind === kind);

/** A well-funded, launched company in the given seat, to compare personalities from the same position. */
const established = (seat: number, patch: Partial<Company> = {}): GameState =>
  launchedCompany(withState(newGame(), { turn: 6 }), seat, { users: 40_000, quality: 45, cash: 2_000_000, headcount: 8, headcountAtLastClose: 8, hype: 25, lastCosts: 400_000, lastRevenue: 120_000, ...patch });

describe("candidate plans", () => {
  it("come by the dozen", () => {
    for (const d of decisions) {
      const count = candidatePlans(d.view, d.kind, CONFIG).length;
      expect(count, `${d.kind} turn ${d.view.turn}`).toBeGreaterThanOrEqual(3);
      expect(count, `${d.kind} turn ${d.view.turn}`).toBeLessThanOrEqual(160);
    }
    const typical = decisions.map((d) => candidatePlans(d.view, d.kind, CONFIG).length).sort((a, b) => a - b);
    expect(typical[Math.floor(typical.length / 2)]).toBeGreaterThanOrEqual(12);
  });

  it("are all legal as they stand", () => {
    for (const d of decisions.filter((_, i) => i % 7 === 0)) {
      for (const plan of candidatePlans(d.view, d.kind, CONFIG)) {
        expect(normalizePlanFor(d.view.self, d.view.turn, d.view.rivals, plan, CONFIG)).toEqual({ plan, notes: [] });
      }
    }
  });
});

describe("the chosen plan", () => {
  it("is always one of the candidates, and legal", () => {
    for (const d of decisions) {
      expect(normalizePlanFor(d.view.self, d.view.turn, d.view.rivals, d.plan, CONFIG).notes).toEqual([]);
    }
  });

  it("never ends the quarter below $0 on its own projection when another candidate would not", () => {
    for (const d of decisions) {
      const chosen = projectTurn(d.view, d.plan, CONFIG);
      if (chosen.cash >= 0) continue;
      const alternatives = candidatePlans(d.view, d.kind, CONFIG).map((plan) => projectTurn(d.view, plan, CONFIG).cash);
      expect(Math.max(...alternatives), `${d.kind} turn ${d.view.turn}`).toBeLessThan(0);
    }
  });

  it("is the same for the same seed", () => {
    for (const d of decisions.filter((_, i) => i % 5 === 0)) {
      expect(chooseCpuPlan(d.view, d.kind, 3, CONFIG)).toEqual(chooseCpuPlan(d.view, d.kind, 3, CONFIG));
    }
  });

  it("varies a little from seed to seed", () => {
    let differs = 0;
    for (const d of decisions.filter((_, i) => i % 5 === 0)) {
      const plans = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(chooseCpuPlan(d.view, d.kind, seed, CONFIG))));
      if (plans.size > 1) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it("does not depend on anything private about its rivals", () => {
    for (const d of decisions.filter((_, i) => i % 9 === 0)) {
      let secret = d.state;
      for (const company of d.state.companies) {
        if (company.id === d.view.self.id || company.out !== null) continue;
        secret = withCompany(secret, company.id, {
          cash: company.cash * 7 + 1,
          lastPull: 12_345,
          lastRevenue: 1,
          lastCosts: 2,
          lastPlan: { ...company.lastPlan, marketing: 975_000, allocation: { product: 0, growth: company.headcount, recruiting: 0 } },
          controller: "human",
        });
      }
      expect(chooseCpuPlan(viewFor(secret, d.view.self.id), d.kind, 5, CONFIG)).toEqual(chooseCpuPlan(d.view, d.kind, 5, CONFIG));
    }
  });

  it("copes with a one-person company", () => {
    for (const kind of KINDS) {
      const state = withCompany(newGame(), SEAT[kind], { headcount: 1, headcountAtLastClose: 1 });
      const view = viewFor(state, SEAT[kind]);
      const plan = chooseCpuPlan(view, kind, 1, CONFIG);
      expect(plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting).toBe(1);
      expect(plan.layoffs).toBe(0);
    }
  });

  it("lays people off rather than go bankrupt when it cannot raise", () => {
    for (const kind of KINDS) {
      // 10 people ($400K a turn), $250K in the bank, no users to raise against.
      const state = withCompany(newGame(), SEAT[kind], { headcount: 10, headcountAtLastClose: 10, cash: 250_000, users: 0, usersAtLastClose: 0, launched: false, quality: 2, lastCosts: 400_000, lastRevenue: 0 });
      const view = viewFor(state, SEAT[kind]);
      const plan = chooseCpuPlan(view, kind, 1, CONFIG);
      expect(plan.layoffs, kind).toBeGreaterThan(0);
      expect(projectTurn(view, plan, CONFIG).cash, kind).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the Blitzscaler", () => {
  it("always charges Budget", () => {
    for (const d of of("blitzscaler")) expect(d.plan.price).toBe("budget");
  });

  it("raises 30% on every turn the rules allow, and never otherwise", () => {
    expect(of("blitzscaler").some((d) => d.plan.raisePercent === 30)).toBe(true);
    for (const d of of("blitzscaler")) {
      const allowed = raiseBlocker(d.view.self, d.view.turn, CONFIG) === null;
      expect(d.plan.raisePercent, `turn ${d.view.turn}`).toBe(allowed ? 30 : 0);
    }
  });

  it("outspends the other two on marketing from the same position", () => {
    const spend = (kind: CpuKind) => chooseCpuPlan(viewFor(established(SEAT[kind]), SEAT[kind]), kind, 1, CONFIG).marketing;
    expect(spend("blitzscaler")).toBeGreaterThan(spend("bootstrapper"));
    expect(spend("blitzscaler")).toBeGreaterThan(spend("incumbent"));
  });

  it("never poaches", () => {
    for (const d of of("blitzscaler")) expect(d.plan.poachTarget).toBeNull();
  });
});

describe("the Bootstrapper", () => {
  it("always charges Premium", () => {
    for (const d of of("bootstrapper")) expect(d.plan.price).toBe("premium");
  });

  it("never raises while it has 2 turns of runway", () => {
    for (const d of of("bootstrapper")) {
      const runway = companyRunway(d.view.self, CONFIG);
      if (runway === null || runway >= 2) expect(d.plan.raisePercent, `turn ${d.view.turn}`).toBe(0);
    }
  });

  it("raises once it has less, if the rules allow", () => {
    const short = established(BOOT, { cash: 300_000, lastCosts: 400_000, lastRevenue: 120_000 });
    const plan = chooseCpuPlan(viewFor(short, BOOT), "bootstrapper", 1, CONFIG);
    expect([10, 20, 30]).toContain(plan.raisePercent);
    const comfortable = established(BOOT, { cash: 3_000_000 });
    expect(chooseCpuPlan(viewFor(comfortable, BOOT), "bootstrapper", 1, CONFIG).raisePercent).toBe(0);
  });

  it("keeps a small team: it never hires past its cap", () => {
    const cap = CONFIG.cpu.personalities.bootstrapper.teamCap;
    for (const d of of("bootstrapper")) {
      const projection = projectTurn(d.view, d.plan, CONFIG);
      if (d.view.self.headcount >= cap) expect(projection.hiresWanted, `turn ${d.view.turn}`).toBe(0);
      else expect(d.view.self.headcount + projection.hiresWanted, `turn ${d.view.turn}`).toBeLessThanOrEqual(cap);
    }
    const atCap = established(BOOT, { headcount: cap, headcountAtLastClose: cap, cash: 9_000_000 });
    expect(projectTurn(viewFor(atCap, BOOT), chooseCpuPlan(viewFor(atCap, BOOT), "bootstrapper", 1, CONFIG), CONFIG).hiresWanted).toBe(0);
  });

  it("puts product first: it never has more people on Growth than on Product", () => {
    for (const d of of("bootstrapper")) {
      expect(d.plan.allocation.product, `turn ${d.view.turn}`).toBeGreaterThanOrEqual(d.plan.allocation.growth);
    }
  });

  it("never poaches", () => {
    for (const d of of("bootstrapper")) expect(d.plan.poachTarget).toBeNull();
  });
});

describe("the Incumbent", () => {
  it("attempts a poach when it can afford one, on the rival with the most users", () => {
    let state = established(INCUMBENT);
    state = launchedCompany(state, HUMAN, { users: 9_000 });
    state = launchedCompany(state, BLITZ, { users: 30_000 });
    const plan = chooseCpuPlan(viewFor(state, INCUMBENT), "incumbent", 1, CONFIG);
    expect(plan.poachTarget).toBe(BLITZ);
  });

  it("does not poach when it cannot afford to", () => {
    // Under two turns of cash, and it raised last turn, so it cannot top up either.
    const poor = established(INCUMBENT, { cash: 450_000, lastCosts: 400_000, lastRevenue: 120_000, lastRaise: { turn: 5, percent: 10, amount: 1 } });
    const plan = chooseCpuPlan(viewFor(poor, INCUMBENT), "incumbent", 1, CONFIG);
    expect(plan.raisePercent).toBe(0);
    expect(plan.poachTarget).toBeNull();
  });

  it("never targets a company that is out or too small to lose anyone", () => {
    let state = onlyActive(established(INCUMBENT), [HUMAN, BOOT, INCUMBENT]);
    state = launchedCompany(state, HUMAN, { users: 90_000, headcount: 1, headcountAtLastClose: 1 });
    state = launchedCompany(state, BOOT, { users: 5_000 });
    expect(chooseCpuPlan(viewFor(state, INCUMBENT), "incumbent", 1, CONFIG).poachTarget).toBe(BOOT);
  });

  it("poaches in most of its turns over a game", () => {
    const turns = of("incumbent");
    expect(turns.filter((d) => d.plan.poachTarget !== null).length / turns.length).toBeGreaterThan(0.5);
  });

  it("is product-heavy: more builders than marketers in most turns", () => {
    const turns = of("incumbent");
    const heavy = turns.filter((d) => d.plan.allocation.product >= d.plan.allocation.growth).length;
    expect(heavy / turns.length).toBeGreaterThan(0.7);
  });
});

describe("the IPO push", () => {
  /** Past the user bar with the given team, and a $500K-a-turn marketing habit behind it. */
  const pastTheBar = (kind: CpuKind, headcount: number): GameState => {
    const seat = SEAT[kind];
    const state = established(seat, { users: 300_000, usersAtLastClose: 300_000, quality: 85, headcount, headcountAtLastClose: headcount, cash: 3_000_000, lastCosts: headcount * 40_000 + 500_000, lastRevenue: 600_000, investorSeats: 0 });
    return withCompany(state, seat, { lastPlan: { ...state.companies[seat].lastPlan, marketing: 500_000 } });
  };

  it("stops marketing and hiring to turn a profit and list", () => {
    for (const kind of KINDS) {
      // 12 people cost $480K; even on Budget, 300K users bring in $600K. Only the marketing stands in the way.
      const view = viewFor(pastTheBar(kind, 12), SEAT[kind]);
      const plan = chooseCpuPlan(view, kind, 1, CONFIG);
      const projection = projectTurn(view, plan, CONFIG);
      expect(plan.marketing, kind).toBe(0);
      expect(projection.hiresWanted, kind).toBe(0);
      expect(projection.profitable, kind).toBe(true);
      expect(projection.users, kind).toBeGreaterThanOrEqual(CONFIG.ipo.users);
    }
  });

  it("lays people off when the payroll alone is more than the revenue", () => {
    // 30 people cost $1.2M against $600K of Budget revenue. Severance means this quarter cannot be saved,
    // so it cuts deep enough for the next one to be profitable.
    const view = viewFor(pastTheBar("blitzscaler", 30), BLITZ);
    const plan = chooseCpuPlan(view, "blitzscaler", 1, CONFIG);
    const projection = projectTurn(view, plan, CONFIG);
    expect(plan.layoffs).toBeGreaterThanOrEqual(12);
    expect(projection.headcount * CONFIG.salary).toBeLessThanOrEqual(projection.revenue);
  });

  it("does not lay anyone off when cutting marketing is enough", () => {
    for (const kind of KINDS) {
      expect(chooseCpuPlan(viewFor(pastTheBar(kind, 12), SEAT[kind]), kind, 1, CONFIG).layoffs, kind).toBe(0);
    }
  });

  it("is not triggered below the bar: no layoffs from a healthy company", () => {
    for (const kind of KINDS) {
      const state = established(SEAT[kind]);
      expect(chooseCpuPlan(viewFor(state, SEAT[kind]), kind, 1, CONFIG).layoffs, kind).toBe(0);
    }
  });
});
