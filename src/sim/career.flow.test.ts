// Whole careers, played by the baseline bot against the three CPUs from 1990 to 2038, checked year by year for what
// must hold in every year of every one: users neither made nor lost, plain JSON, four seats, career facts that only
// move one way, the dated cards in their years, a replay to the same end, and projections that keep their promises.
// Every rule has its own tests; these check that the rules hold together across eras, newcomers and endings.

import { describe, expect, it } from "vitest";
import { baselinePlan } from "../ai/baselineBot";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CAREER, type CareerGameConfig } from "../config";
import { CAREER_DESIGN } from "../config.design";
import { peopleCap, turnOf, yearOf } from "../engine/career";
import { founderStake } from "../engine/formulas";
import { projectTurn } from "../engine/project";
import { replayGame } from "../engine/replay";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import { usersInSystem } from "../engine/testKit";
import type { CompanyId, CompanyReport, DatedCard, EraConfig, GameSetup, GameState, PlanSet, TurnLog } from "../engine/types";
import { viewFor } from "../engine/view";
import { isGame, isTurnLog } from "../state/shape";

interface Career {
  readonly setup: GameSetup;
  /** Every state, the opening one first: `states[i]` opens the year that `logs[i]` reports. */
  readonly states: readonly GameState[];
  readonly logs: readonly TurnLog[];
  /** Every year's plans, as handed to the turn. */
  readonly plans: readonly PlanSet[];
}

/**
 * One whole career on this config. With `controller` "human", seat 0's plan each year is the baseline bot's plan for
 * its view, handed to `choosePlans` as the human's plan.
 */
const play = (seed: number, config: CareerGameConfig, controller: "human" | "baseline"): Career => {
  const setup = newGameSetup(seed, "Flow", controller);
  let state = createGame(setup, config);
  const states: GameState[] = [state];
  const logs: TurnLog[] = [];
  const plans: PlanSet[] = [];
  while (state.outcome === null) {
    const player = state.companies[0];
    const human: PlanSet = player.controller === "human" && player.out === null ? [baselinePlan(viewFor(state, 0), config)] : [];
    const yearPlans = choosePlans(state, seed, config, human);
    const result = resolveTurn(state, yearPlans, seed, config);
    plans.push(yearPlans);
    logs.push(result.log);
    states.push(result.state);
    state = result.state;
  }
  return { setup, states, logs, plans };
};

/** Each career on the starting numbers is played once and shared by every test that reads it. */
const played = new Map<number, Career>();
const careerOn = (seed: number): Career => {
  const known = played.get(seed);
  if (known !== undefined) return known;
  const career = play(seed, CAREER_DESIGN, "baseline");
  played.set(seed, career);
  return career;
};

/** CAREER_DESIGN with every era's values passed through `change`. */
const withEraValues = (change: (values: EraConfig["values"]) => EraConfig["values"]): CareerGameConfig => ({
  ...CAREER_DESIGN,
  career: { ...CAREER_DESIGN.career, eras: CAREER_DESIGN.career.eras.map((era) => ({ ...era, values: change(era.values) })) },
});

/**
 * Every era's salary times this makes companies of seed 1 go out, and a newcomer enter. Found by hand: playing seed 1
 * with the multiple raised from 1 in steps, 2 still loses nobody; at 3 only the player's company goes out (in 1992,
 * after its rescue), and the player's seat is never refilled; 4 is the first whole number at which a rival goes out
 * too (seat 1, also in 1992), and a newcomer takes its seat for 1994.
 */
const HARSH_SALARY_MULTIPLE = 4;

/** The company still in the game with the largest founder's stake as the year closes; ties go to the valuation, then the seat. */
const largestStake = (log: TurnLog): CompanyId | null =>
  log.companies
    .filter((report): report is CompanyReport => report !== null && report.out === null)
    .sort((a, b) => founderStake(b.equity, b.valuation) - founderStake(a.equity, a.valuation) || b.valuation - a.valuation || a.companyId - b.companyId)[0]
    ?.companyId ?? null;

/** The ceiling a year's dated card puts on quality, and whether it holds through the year; null for a card without one. */
const ceilingOf = (card: DatedCard): { readonly ceiling: number; readonly held: boolean } | null => {
  for (const effect of card.effects) if (effect.kind === "qualityCeiling") return { ceiling: effect.ceiling, held: effect.turns === 1 };
  return null;
};

/**
 * What must hold in every year of a career: four seats; hype, quality, equity and head count in bounds; career facts
 * that only move one way; marketing paid from the cash in hand plus the year's raise or listing (C11); and in each
 * year whose dated card has a quality ceiling, no company opening above it and, when it holds, none closing above it
 * (C4).
 */
const holdsTogether = ({ states, logs }: Career, config: CareerGameConfig): void => {
  const { career } = config;
  const cap = peopleCap(career);
  expect(cap).toBe(150);
  states.forEach((state, i) => {
    expect(state.companies.map((company) => company.id)).toEqual([0, 1, 2, 3]);
    for (const company of state.companies) {
      const where = `state ${i}, seat ${company.id}`;
      expect(company.hype, where).toBeGreaterThanOrEqual(0);
      expect(company.hype, where).toBeLessThanOrEqual(100);
      expect(company.quality, where).toBeGreaterThanOrEqual(0);
      expect(company.quality, where).toBeLessThanOrEqual(100);
      expect(company.founderEquity, where).toBeGreaterThanOrEqual(0);
      expect(company.founderEquity, where).toBeLessThanOrEqual(1);
      expect(company.headcount, where).toBeLessThanOrEqual(cap);
      const facts = company.career;
      if (facts === undefined) throw new Error(`${where} has no career facts`);
      // No year opens with more people in a company than its office holds.
      expect(company.headcount, where).toBeLessThanOrEqual(career.offices[facts.office].capacity);
    }
  });
  logs.forEach((log, i) => {
    const before = states[i];
    const after = states[i + 1];
    const card = career.dated.find((each) => each.year === yearOf(log.turn, career));
    const ceiling = card === undefined ? null : ceilingOf(card);
    for (const company of before.companies) {
      const where = `year ${i + 1}, seat ${company.id}`;
      const was = company.career;
      const now = after.companies[company.id].career;
      if (was === undefined || now === undefined) throw new Error(`${where} has no career facts`);
      const report = log.companies[company.id];
      // No report has a raise for a company already public.
      if (was.listed !== null) expect(report?.raise ?? null, where).toBeNull();
      if (report !== null) {
        // Marketing is paid from the cash the year opened with, never counted below $0, plus what a raise and a
        // listing brought in that year (C11).
        const proceeds = (report.raise?.amount ?? 0) + (report.career?.listing?.amount ?? 0);
        expect(report.plan.marketing, where).toBeLessThanOrEqual(Math.max(0, company.cash) + proceeds);
        // A shift's ceiling: nobody opens its year above it, and while it holds nobody closes above it (C4).
        if (ceiling !== null) {
          expect(company.quality, where).toBeLessThanOrEqual(ceiling.ceiling);
          if (ceiling.held) expect(report.quality.end, where).toBeLessThanOrEqual(ceiling.ceiling);
        }
      }
      // A newcomer took the seat: its facts start afresh.
      if (now.founded !== was.founded) {
        expect(now.founded, where).toBeGreaterThan(was.founded);
        continue;
      }
      expect(now.office, where).toBeGreaterThanOrEqual(was.office);
      expect(after.companies[company.id].founderEquity, where).toBeLessThanOrEqual(company.founderEquity);
      if (was.qualified) expect(now.qualified, where).toBe(true);
      if (was.listed !== null) expect(now.listed, where).toEqual(was.listed);
      if (was.rescue !== null) expect(now.rescue, where).toEqual(was.rescue);
    }
  });
};

const SEEDS = [1, 2, 3, 4, 5, 6];

describe.each(SEEDS)("career %i on the starting numbers", (seed) => {
  const { states, logs, plans, setup } = careerOn(seed);
  const final = states[states.length - 1];

  it("runs 49 years to an outcome", () => {
    expect(logs).toHaveLength(49);
    expect(final.outcome?.turn).toBe(49);
    expect(["turnLimit", "wipeout"]).toContain(final.outcome?.kind);
    // The winner is the company still in the game with the largest founder's stake (ruling 6).
    expect(final.outcome?.winnerId).toBe(largestStake(logs[logs.length - 1]));
    expect(final.outcome?.kind === "wipeout").toBe(final.outcome?.winnerId === null);
  });

  it("neither makes nor loses users in any year", () => {
    logs.forEach((log, i) => expect(usersInSystem(states[i + 1]), `year ${i + 1}`).toBe(usersInSystem(states[i]) + log.market.newUsers));
  });

  it("is plain JSON all the way through", () => {
    expect(JSON.parse(JSON.stringify(states))).toStrictEqual(states);
    expect(JSON.parse(JSON.stringify(logs))).toStrictEqual(logs);
  });

  it("keeps four seats, and what a career records only moves one way", () => {
    holdsTogether(careerOn(seed), CAREER_DESIGN);
  });

  it("deals every dated card in its year", () => {
    for (const card of CAREER_DESIGN.career.dated) expect(logs[turnOf(card.year, CAREER_DESIGN.career) - 1].event?.cardId).toBe(card.id);
  });

  it("replays to the same end across every era (Review Focus 2)", () => {
    expect(replayGame({ setup, seed, plans }, CAREER_DESIGN).state).toEqual(final);
  });

  it("a plan's projection keeps its promises in every year", () => {
    logs.forEach((log, i) => {
      plans[i].forEach((plan, id) => {
        if (plan === null) return;
        const where = `year ${i + 1}, seat ${id}`;
        const projection = projectTurn(viewFor(states[i], id), plan, CAREER_DESIGN);
        const report = log.companies[id];
        if (report === null) throw new Error(`${where} planned but has no report`);
        // The company's own product holds no surprises.
        expect(report.quality.end, where).toBe(projection.quality);
        expect(report.costs.total, where).toBeLessThanOrEqual(projection.costs.total);
        expect(report.cash.end, where).toBeGreaterThanOrEqual(projection.cashFloor);
      });
    });
  });
});

it("another seed gives another career", () => {
  expect(careerOn(2).states.at(-1)).not.toEqual(careerOn(1).states.at(-1));
});

it("every state and log of a career passes the save check", () => {
  const { states, logs } = play(1, CAREER_DESIGN, "human");
  expect(states[0].companies[0].controller).toBe("human");
  expect(states.every((state) => isGame(JSON.parse(JSON.stringify(state)), CAREER_DESIGN))).toBe(true);
  expect(logs.every((log) => isTurnLog(JSON.parse(JSON.stringify(log)), 4))).toBe(true);
});

it("the shipped numbers play whole careers too", () => {
  for (const seed of [1, 2, 3]) {
    const { states, logs } = play(seed, CAREER, "baseline");
    expect(logs).toHaveLength(49);
    logs.forEach((log, i) => expect(usersInSystem(states[i + 1]), `seed ${seed}, year ${i + 1}`).toBe(usersInSystem(states[i]) + log.market.newUsers));
  }
});

it("a career in which companies fail holds together too", () => {
  const harsh = withEraValues((values) => ({ ...values, salary: (values.salary ?? CAREER_DESIGN.salary) * HARSH_SALARY_MULTIPLE }));
  const career = play(1, harsh, "baseline");
  const { states, logs } = career;
  expect(logs.some((log) => log.companies.some((report) => report?.out))).toBe(true);
  // A rival went out, and a newcomer took its seat.
  expect(logs.some((log) => (log.entrants ?? []).length > 0)).toBe(true);
  logs.forEach((log, i) => expect(usersInSystem(states[i + 1]), `year ${i + 1}`).toBe(usersInSystem(states[i]) + log.market.newUsers));
  holdsTogether(career, harsh);
  expect(states.at(-1)?.outcome?.winnerId).toBe(largestStake(logs[logs.length - 1]));
});

it("nobody reads a number its era has replaced (Review Focus 2)", () => {
  // Every number below is set by all eight eras, so the base value underneath should never be read.
  const eras = CAREER_DESIGN.career.eras;
  expect(eras).toHaveLength(8);
  for (const { values } of eras) {
    expect(values.salary).toBeDefined();
    expect(values.market?.newUsersTurn1).toBeDefined();
    expect(values.market?.growthPerTurn).toBeDefined();
    expect(values.ipo?.users).toBeDefined();
    expect(values.valuation?.perUser).toBeDefined();
    expect(values.hiring?.candidatesPerTurn).toBeDefined();
    expect(values.pull?.maxMarketing).toBeDefined();
    expect(values.archetypes?.startup?.cash).toBeDefined();
    // An era's numbers for the computer players are typed as an object only: src/ai reads them.
    const cpu = values.cpu as { readonly personalities?: Readonly<Record<string, { readonly teamCap?: number }>> } | undefined;
    for (const style of ["blitzscaler", "bootstrapper", "incumbent"]) expect(cpu?.personalities?.[style]?.teamCap, style).toBeDefined();
  }
  const base = CAREER_DESIGN;
  const personalities = base.cpu.personalities;
  const sevenfold: CareerGameConfig = {
    ...base,
    salary: base.salary * 7,
    market: { newUsersTurn1: base.market.newUsersTurn1 * 7, growthPerTurn: base.market.growthPerTurn * 7 },
    ipo: { ...base.ipo, users: base.ipo.users * 7 },
    valuation: { ...base.valuation, perUser: base.valuation.perUser * 7 },
    hiring: { ...base.hiring, candidatesPerTurn: base.hiring.candidatesPerTurn * 7 },
    pull: { ...base.pull, maxMarketing: base.pull.maxMarketing * 7 },
    archetypes: { ...base.archetypes, startup: { ...base.archetypes.startup, cash: base.archetypes.startup.cash * 7 } },
    cpu: {
      ...base.cpu,
      personalities: {
        blitzscaler: { ...personalities.blitzscaler, teamCap: personalities.blitzscaler.teamCap * 7 },
        bootstrapper: { ...personalities.bootstrapper, teamCap: personalities.bootstrapper.teamCap * 7 },
        incumbent: { ...personalities.incumbent, teamCap: personalities.incumbent.teamCap * 7 },
      },
    },
  };
  expect(play(1, sevenfold, "baseline").states.at(-1)).toEqual(careerOn(1).states.at(-1));
});
