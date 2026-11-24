import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { defaultPlan } from "./plan";
import { replayGame } from "./replay";
import { resolveTurn } from "./resolveTurn";
import { nextFloat01, streamSeed } from "./rng";
import { FOUR_SEATS, newGame, usersInSystem } from "./testKit";
import { PRICE_TIERS } from "./types";
import type { GameState, Plan, PlanSet, TurnLog } from "./types";
import { publicReport } from "./view";

/** A stream of test-only random numbers; never shared with the engine's own streams. */
const randomSource = (seed: number) => {
  let state = streamSeed(seed, 0, 250);
  return (): number => {
    const draw = nextFloat01(state);
    state = draw.rng;
    return draw.value;
  };
};

/** A plan that is often illegal on purpose: the engine has to cope. */
const randomPlan = (state: GameState, id: number, random: () => number): Plan => {
  const company = state.companies[id];
  const product = Math.floor(random() * (company.headcount + 1));
  const growth = Math.floor(random() * (company.headcount + 1 - product));
  return {
    allocation: { product, growth, recruiting: company.headcount - product - growth },
    marketing: Math.floor(random() * 10) * 25_000,
    price: PRICE_TIERS[Math.floor(random() * 3)],
    raisePercent: random() < 0.35 ? [10, 20, 30][Math.floor(random() * 3)] : 0,
    poachTarget: random() < 0.25 ? Math.floor(random() * 4) : null,
    layoffs: random() < 0.12 ? Math.floor(random() * 3) : 0,
    hireLimit: random() < 0.5 ? null : Math.floor(random() * 4),
  };
};

interface Played {
  readonly states: GameState[];
  readonly logs: TurnLog[];
  readonly plans: PlanSet[];
}

const playRandomGame = (seed: number, planSeed = seed): Played => {
  const random = randomSource(planSeed);
  const states = [newGame()];
  const logs: TurnLog[] = [];
  const plans: PlanSet[] = [];
  while (states[states.length - 1].outcome === null) {
    const state = states[states.length - 1];
    const turnPlans = state.companies.map((company) => (company.out === null ? randomPlan(state, company.id, random) : null));
    const result = resolveTurn(state, turnPlans, seed, DESIGN);
    plans.push(turnPlans);
    logs.push(result.log);
    states.push(result.state);
    if (states.length > 40) throw new Error("the game did not end");
  }
  return { states, logs, plans };
};

const everyNumber = (value: unknown, visit: (n: number, path: string) => void, path = ""): void => {
  if (typeof value === "number") visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, i) => everyNumber(item, visit, `${path}[${i}]`));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) everyNumber(item, visit, `${path}.${key}`);
  }
};

describe("replay", () => {
  it("gives the same states and logs for the same seed and plans", () => {
    const a = playRandomGame(42);
    const b = playRandomGame(42);
    expect(b.states).toEqual(a.states);
    expect(b.logs).toEqual(a.logs);
  });

  it("gives a different game for a different seed with the same plans", () => {
    const base = playRandomGame(42);
    const state = newGame();
    let differs = false;
    for (const otherSeed of [43, 44, 45]) {
      let current = state;
      for (const [turn, plans] of base.plans.entries()) {
        if (current.outcome !== null) break;
        current = resolveTurn(current, plans, otherSeed, DESIGN).state;
        if (JSON.stringify(current) !== JSON.stringify(base.states[turn + 1])) differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it("replays a recorded game to the same end", () => {
    const played = playRandomGame(7);
    const replayed = replayGame({ setup: FOUR_SEATS, seed: 7, plans: played.plans }, DESIGN);
    expect(replayed.state).toEqual(played.states[played.states.length - 1]);
    expect(replayed.logs).toEqual(played.logs);
  });

  it("stops a replay where the game ended, ignoring any plans after that", () => {
    const played = playRandomGame(7);
    const extra = [...played.plans, played.plans[0], played.plans[0]];
    expect(replayGame({ setup: FOUR_SEATS, seed: 7, plans: extra }, DESIGN).logs).toHaveLength(played.logs.length);
  });

  it("replays a game from default plans alone", () => {
    const replayed = replayGame({ setup: FOUR_SEATS, seed: 3, plans: Array.from({ length: 20 }, () => []) }, DESIGN);
    expect(replayed.logs.length).toBeLessThanOrEqual(20);
    expect(replayed.state.outcome).not.toBeNull();
  });

  it("keeps one company's rolls independent of another company's plan", () => {
    const state = newGame();
    const base = state.companies.map((company) => defaultPlan(company));
    const withPoach: PlanSet = base.map((plan, id) => (id === 3 ? { ...plan, poachTarget: 0 } : plan));
    const noisy: PlanSet = withPoach.map((plan, id) => (id === 1 ? { ...plan!, marketing: 200_000, poachTarget: 2, allocation: { product: 1, growth: 1, recruiting: 1 } } : plan));
    for (let seed = 1; seed <= 50; seed++) {
      const a = resolveTurn(state, withPoach, seed, DESIGN).log.companies[3]?.poach?.success;
      const b = resolveTurn(state, noisy, seed, DESIGN).log.companies[3]?.poach?.success;
      expect(b, `seed ${seed}`).toBe(a);
    }
  });
});

describe("public reports", () => {
  it("show a rival's moves but not its books or its plan", () => {
    const played = playRandomGame(11);
    const report = played.logs[0].companies[3]!;
    const shown = publicReport(report);
    expect(Object.keys(shown).sort()).toEqual(
      ["boardFired", "companyId", "equity", "headcount", "hype", "out", "poach", "price", "quality", "raise", "users", "valuation"].sort(),
    );
    expect(shown.price).toBe(report.plan.price);
    expect(shown.users.end).toBe(report.users.end);
    expect("pull" in shown.users).toBe(false);
    expect("gain" in shown.quality).toBe(false);
    for (const hidden of ["plan", "cash", "costs", "revenue", "runway", "work", "hiring", "notes", "profitable", "board"]) {
      expect(hidden in shown, hidden).toBe(false);
    }
  });
});

describe("whole random games", () => {
  const games = Array.from({ length: 120 }, (_, i) => playRandomGame(1_000 + i));

  it("end within 20 turns with an outcome", () => {
    for (const game of games) {
      const last = game.states[game.states.length - 1];
      expect(last.outcome).not.toBeNull();
      expect(last.outcome!.turn).toBeLessThanOrEqual(20);
      expect(game.logs.length).toBe(last.outcome!.turn);
      expect(game.logs[game.logs.length - 1].outcome).toEqual(last.outcome);
    }
  });

  it("count turns one at a time", () => {
    for (const game of games) {
      game.logs.forEach((log, i) => expect(log.turn).toBe(i + 1));
      game.states.forEach((state, i) => expect(state.turn).toBe(Math.min(i + 1, game.logs.length)));
    }
  });

  it("conserve users every turn", () => {
    for (const game of games) {
      game.logs.forEach((log, i) => {
        expect(usersInSystem(game.states[i + 1]), `turn ${log.turn}`).toBe(usersInSystem(game.states[i]) + log.market.newUsers);
      });
    }
  });

  it("account for every person: joiners are hires or poaches, leavers are layoffs, poaches or burnout", () => {
    for (const game of games) {
      game.logs.forEach((log) => {
        const reports = log.companies.filter((r) => r !== null);
        const sum = (pick: (r: (typeof reports)[number]) => number) => reports.reduce((n, r) => n + pick(r), 0);
        for (const r of reports) {
          expect(r.headcount.end).toBe(r.headcount.start - r.headcount.laidOff + r.headcount.hired + r.headcount.poachedIn - r.headcount.poachedOut);
          expect(r.headcount.start - r.headcount.laidOff).toBeGreaterThanOrEqual(1);
          expect(r.headcount.end).toBeGreaterThanOrEqual(1);
          expect(r.headcount.hired).toBe(r.hiring.hired);
        }
        expect(sum((r) => r.headcount.poachedIn)).toBe(sum((r) => r.headcount.poachedOut));
        expect(sum((r) => r.headcount.hired)).toBe(log.hiring.picks.length);
        expect(log.hiring.picks.length).toBeLessThanOrEqual(log.hiring.candidates);
      });
    }
  });

  it("keep every company's numbers in range", () => {
    for (const game of games) {
      for (const state of game.states) {
        for (const company of state.companies) {
          if (company.out !== null) {
            expect(company.users).toBe(0);
            expect(company.headcount).toBe(0);
            continue;
          }
          expect(company.headcount).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(company.users)).toBe(true);
          expect(company.users).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(company.cash)).toBe(true);
          expect(company.quality).toBeGreaterThanOrEqual(0);
          expect(company.quality).toBeLessThanOrEqual(100);
          expect(company.hype).toBeGreaterThanOrEqual(0);
          expect(company.hype).toBeLessThanOrEqual(100);
          expect(company.founderEquity).toBeGreaterThan(0);
          expect(company.founderEquity).toBeLessThanOrEqual(1);
          if (!company.launched) expect(company.users).toBe(0);
          // A company still in the game never has negative cash: that is bankruptcy.
          if (state.outcome === null) expect(company.cash).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("balance each company's books", () => {
    for (const game of games) {
      for (const log of game.logs) {
        for (const r of log.companies) {
          if (r === null) continue;
          expect(r.costs.total).toBe(r.costs.salaries + r.costs.marketing + r.costs.hiring + r.costs.poaching + r.costs.severance);
          expect(r.cash.end).toBe(r.cash.start + (r.raise?.amount ?? 0) + r.revenue - r.costs.total);
          expect(r.users.end).toBe(r.users.open - r.users.lostToEvent - r.users.churned + r.users.won);
          expect(r.profitable).toBe(r.revenue >= r.costs.total);
        }
      }
    }
  });

  it("only crown a company that is still in the game", () => {
    for (const game of games) {
      const last = game.states[game.states.length - 1];
      const outcome = last.outcome!;
      if (outcome.kind === "wipeout") expect(outcome.winnerId).toBeNull();
      else expect(last.companies[outcome.winnerId!].out).toBeNull();
    }
  });

  it("stay plain JSON with no NaN or Infinity anywhere", () => {
    for (const game of games.slice(0, 30)) {
      for (const item of [...game.states, ...game.logs]) {
        expect(JSON.parse(JSON.stringify(item))).toEqual(item);
        everyNumber(item, (n, path) => expect(Number.isFinite(n), path).toBe(true));
      }
    }
  });

  it("see every kind of ending except, perhaps, a wipeout", () => {
    const kinds = new Set(games.map((game) => game.states[game.states.length - 1].outcome!.kind));
    expect(kinds.has("turnLimit") || kinds.has("ipo") || kinds.has("lastStanding")).toBe(true);
  });
});
