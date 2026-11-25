// The simulator's career mode: whole careers played and told as the logs tell them, the summary of a batch, the five
// targets, the pilots that look for loopholes, the control without platform shifts, overrides of an era's numbers,
// and the report. The pilots run on CAREER_TEST, like the career's rule tests; whole careers on CAREER_DESIGN.

import { describe, expect, it } from "vitest";
import { baselinePlan } from "../ai/baselineBot";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import type { CareerGameConfig, PlayConfig } from "../config";
import { CAREER_DESIGN } from "../config.design";
import { rulesForTurn, turnOf, yearOf } from "../engine/career";
import { CAREER_TEST, atTurn, newCareer, qualify, withCareer, withCareerOf } from "../engine/careerKit";
import { founderStake } from "../engine/formulas";
import { normalizePlanFor } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import { BLITZ, BOOT, HUMAN, launchedCompany, withCompany, withState } from "../engine/testKit";
import type { CompanyReport, CompanyView, Controller, DatedCard, GameState, Plan, TurnLog } from "../engine/types";
import { viewFor } from "../engine/view";
import { applyOverrides } from "./overrides";
import {
  checkCareerTargets,
  checkLoophole,
  formatCareerReport,
  summarizeCareers,
  type CareerCheckId,
  type CareerPosition,
  type CareerSummary,
} from "./careerReport";
import { PILOT_NAMES, endgamePilot, listLastPilot, neverListPilot, overspendPilot, shiftAwarePilot, withoutShifts } from "./pilots";
import { runCareer, type CareerCompany, type CareerSnapshot, type SimCareer } from "./runCareer";

// ── Whole careers ──

interface Played {
  /** `states[i]` opens the year that `logs[i]` reports. */
  readonly states: readonly GameState[];
  readonly logs: readonly TurnLog[];
}

/** A whole career with the baseline bot in seat 0, played by hand as in career.flow.test.ts. */
const play = (seed: number, config: CareerGameConfig): Played => {
  let state = createGame(newGameSetup(seed, "Baseline", "baseline"), config);
  const states: GameState[] = [state];
  const logs: TurnLog[] = [];
  while (state.outcome === null) {
    const result = resolveTurn(state, choosePlans(state, seed, config), seed, config);
    logs.push(result.log);
    states.push(result.state);
    state = result.state;
  }
  return { states, logs };
};

/**
 * Every era's salary four times over: in seed 1 the player's company and seat 1's go out in 1992, both after a
 * rescue, and a newcomer takes seat 1 for 1994.
 */
const HARSH: CareerGameConfig = {
  ...CAREER_DESIGN,
  career: {
    ...CAREER_DESIGN.career,
    eras: CAREER_DESIGN.career.eras.map((era) => ({ ...era, values: { ...era.values, salary: (era.values.salary ?? CAREER_DESIGN.salary) * 4 } })),
  },
};

const CASES: readonly { readonly name: string; readonly seed: number; readonly config: CareerGameConfig }[] = [
  ...[1, 2, 3, 4, 5].map((seed) => ({ name: `seed ${seed}`, seed, config: CAREER_DESIGN })),
  { name: "seed 1 at four times the salaries", seed: 1, config: HARSH },
];

const cache = new Map<string, { readonly played: Played; readonly career: SimCareer }>();
const both = (name: string, seed: number, config: CareerGameConfig) => {
  const known = cache.get(name);
  if (known !== undefined) return known;
  const made = { played: play(seed, config), career: runCareer(seed, config) };
  cache.set(name, made);
  return made;
};

const careerFacts = (state: GameState, seat: number) => {
  const facts = state.companies[seat].career;
  if (facts === undefined) throw new Error(`seat ${seat} has no career facts`);
  return facts;
};

/** Each company's story, read off the logs one report at a time. */
const tell = ({ states, logs }: Played, config: CareerGameConfig): CareerCompany[] => {
  const year = (turn: number): number => yearOf(turn, config.career);
  type Story = { -readonly [K in keyof CareerCompany]: CareerCompany[K] };
  const fresh = (seat: number, founded: number, controller: Controller): Story => ({
    seat,
    founded,
    controller,
    listedYear: null,
    rescuedYear: null,
    outYear: null,
    outReason: null,
    finalStake: 0,
  });
  const stories: Story[] = states[0].companies.map((company) => fresh(company.id, 1, company.controller));
  const holder = stories.map((_, seat) => seat);
  logs.forEach((log, i) => {
    log.companies.forEach((report, seat) => {
      if (report === null) return;
      const story = stories[holder[seat]];
      if (report.career?.listing) story.listedYear = year(log.turn);
      if (report.career?.rescue) story.rescuedYear = year(log.turn);
      if (report.out !== null) {
        story.outYear = year(log.turn);
        story.outReason = report.out;
      }
      story.finalStake = report.out !== null ? 0 : founderStake(report.equity, report.valuation);
    });
    for (const seat of log.entrants ?? []) holder[seat] = stories.push(fresh(seat, log.turn + 1, states[i + 1].companies[seat].controller)) - 1;
  });
  return stories;
};

/** The company with the largest founder's stake as a year closes, among those still in it; ties by valuation, then seat. */
const leaderOf = (log: TurnLog): CompanyReport | undefined =>
  log.companies
    .filter((report): report is CompanyReport => report !== null && report.out === null)
    .sort((a, b) => founderStake(b.equity, b.valuation) - founderStake(a.equity, a.valuation) || b.valuation - a.valuation || a.companyId - b.companyId)[0];

it("plays a whole career with the baseline bot in the player's seat", () => {
  const career = runCareer(1, CAREER_DESIGN);
  expect(career.player).toMatchObject({ seat: 0, founded: 1, controller: "baseline" });
  expect(career.companies.slice(0, 4).map((company) => [company.seat, company.founded])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
  expect(Object.keys(career.checkpoints).map(Number)).toEqual([...CAREER_DESIGN.sim.checkpointYears]);
  expect(runCareer(1, CAREER_DESIGN)).toEqual(career);
});

describe.each(CASES)("a career, $name", ({ name, seed, config }) => {
  it("tells each company's story as the logs tell it", () => {
    const { played, career } = both(name, seed, config);
    const stories = tell(played, config);
    expect(career.seed).toBe(seed);
    expect(career.companies).toEqual(stories);
    expect(career.player).toEqual(stories[0]);
    const final = played.states[played.states.length - 1];
    const winnerId = final.outcome?.winnerId ?? null;
    expect(career.winnerSeat).toBe(winnerId);
    expect(career.winner).toBe(winnerId === null ? null : final.companies[winnerId].controller);
    expect(career.winnerFounded).toBe(winnerId === null ? null : careerFacts(final, winnerId).founded);
  });

  it("says whether the leader of 2010 won", () => {
    const { played, career } = both(name, seed, config);
    const i = turnOf(config.sim.leaderYear, config.career) - 1;
    const leader = leaderOf(played.logs[i]);
    const final = played.states[played.states.length - 1];
    const winnerId = final.outcome?.winnerId ?? null;
    if (leader === undefined) {
      expect(career.leaderHeld).toBeNull();
      return;
    }
    const founded = careerFacts(played.states[i], leader.companyId).founded;
    expect(career.leaderHeld).toBe(winnerId === leader.companyId && careerFacts(final, winnerId).founded === founded);
  });

  it("records the dated cards that hit one company, the idle rivals and the checkpoint years", () => {
    const { played, career } = both(name, seed, config);
    const targeted = config.career.dated.filter((card) => card.target !== undefined);
    expect(targeted.length).toBeGreaterThan(0);
    expect(career.targetedCards).toEqual(
      targeted.map((card) => ({ year: card.year, hit: (played.logs[turnOf(card.year, config.career) - 1].event?.targetId ?? null) !== null })),
    );
    const idle = played.logs.reduce((sum, log, i) => {
      const rules = rulesForTurn(config, log.turn);
      const opening = played.states[i].companies.filter(
        (company) => company.id !== 0 && company.out === null && company.headcount >= 1 && company.headcount <= 2 && company.cash >= 10 * company.headcount * rules.salary,
      );
      return sum + opening.length;
    }, 0);
    expect(career.idleRivalYears).toBe(idle);
    for (const year of config.sim.checkpointYears) {
      const i = turnOf(year, config.career) - 1;
      const log = played.logs[i];
      const snapshots = career.checkpoints[year];
      expect(snapshots).toHaveLength(4);
      snapshots.forEach((snapshot, seat) => {
        const report = log.companies[seat];
        const inGame = report !== null && report.out === null;
        expect(snapshot.inGame, `${year}, seat ${seat}`).toBe(inGame);
        expect(snapshot.controller).toBe(played.states[i].companies[seat].controller);
        if (report === null || !inGame) return;
        expect(snapshot).toEqual({
          controller: played.states[i].companies[seat].controller,
          inGame: true,
          listed: careerFacts(played.states[i], seat).listed !== null || (report.career?.listing ?? null) !== null,
          users: report.users.end,
          cash: report.cash.end,
          headcount: report.headcount.end,
          quality: report.quality.end,
          stake: founderStake(report.equity, report.valuation),
          equity: report.equity,
        });
      });
    }
  });
});

it("the harsh career has companies going out, a rescue and a newcomer, so the story test reads them all", () => {
  const { career } = both(CASES[5].name, CASES[5].seed, CASES[5].config);
  expect(career.companies.length).toBeGreaterThan(4);
  expect(career.companies.some((company) => company.outYear !== null)).toBe(true);
  expect(career.companies.some((company) => company.rescuedYear !== null)).toBe(true);
});

// ── The summary ──

const company = (seat: number, controller: Controller, patch: Partial<CareerCompany> = {}): CareerCompany => ({
  seat,
  founded: 1,
  controller,
  listedYear: null,
  rescuedYear: null,
  outYear: null,
  outReason: null,
  finalStake: 0,
  ...patch,
});

const snapshot = (controller: Controller, patch: Partial<CareerSnapshot> = {}): CareerSnapshot => ({
  controller,
  inGame: true,
  listed: false,
  users: 0,
  cash: 0,
  headcount: 0,
  quality: 0,
  stake: 0,
  equity: 1,
  ...patch,
});

interface Hand {
  readonly winner: Controller | null;
  readonly winnerFounded?: number;
  readonly player?: Partial<CareerCompany>;
  /** Rivals of 1990 that went out, and any newcomers. */
  readonly rivals?: readonly CareerCompany[];
  readonly idle?: number;
  readonly leaderHeld: boolean | null;
}

const RIVALS: readonly CareerCompany[] = [company(1, "blitzscaler"), company(2, "bootstrapper"), company(3, "incumbent")];
const allOut = (year: number): CareerCompany[] => RIVALS.map((rival) => ({ ...rival, outYear: year, outReason: "bankrupt" }));

const built = (hand: Hand, i: number): SimCareer => {
  const player = company(0, "baseline", hand.player);
  const rivals = hand.rivals ?? RIVALS;
  const companies = [player, ...rivals];
  const winnerSeat = hand.winner === null ? null : (companies.find((c) => c.controller === hand.winner && c.founded === (hand.winnerFounded ?? 1))?.seat ?? null);
  return {
    seed: i + 1,
    idleRivalYears: hand.idle ?? 0,
    winner: hand.winner,
    winnerSeat,
    winnerFounded: hand.winner === null ? null : (hand.winnerFounded ?? 1),
    companies,
    player,
    leaderHeld: hand.leaderHeld,
    checkpoints: {
      2010: [
        snapshot("baseline", { users: 100 * (i + 1), cash: 1_000 * (i + 1), headcount: i + 1, quality: 10 + i, equity: 1 - i / 20, listed: i % 2 === 0 }),
        snapshot("blitzscaler", { inGame: i < 5, users: 7 }),
        snapshot("bootstrapper", { users: 3 }),
        snapshot("incumbent", { users: 5 }),
      ],
    },
    targetedCards: [{ year: 2011, hit: i % 2 === 0 }],
  };
};

const TEN: readonly SimCareer[] = (
  [
    { winner: "baseline", player: { listedYear: 1996 }, leaderHeld: true },
    { winner: "baseline", player: { listedYear: 1998 }, idle: 2, leaderHeld: true },
    { winner: "baseline", player: { rescuedYear: 1993, listedYear: 2001 }, leaderHeld: false },
    { winner: "blitzscaler", player: { rescuedYear: 1995, outYear: 2004, outReason: "bankrupt" }, idle: 1, leaderHeld: true },
    {
      winner: "blitzscaler",
      winnerFounded: 12,
      player: { rescuedYear: 2002, outYear: 2010, outReason: "fired" },
      rivals: [{ ...RIVALS[0], outYear: 1999, outReason: "bankrupt" }, RIVALS[1], RIVALS[2], company(1, "blitzscaler", { founded: 12 })],
      leaderHeld: null,
    },
    { winner: "bootstrapper", player: { listedYear: 2005 }, idle: 3, leaderHeld: null },
    { winner: "incumbent", leaderHeld: false },
    {
      winner: "incumbent",
      winnerFounded: 20,
      player: { rescuedYear: 1993 },
      rivals: [RIVALS[0], RIVALS[1], { ...RIVALS[2], outYear: 2007, outReason: "fired" }, company(3, "incumbent", { founded: 20 })],
      idle: 4,
      leaderHeld: true,
    },
    { winner: null, player: { rescuedYear: 1994, outYear: 1999, outReason: "bankrupt" }, rivals: allOut(2003), leaderHeld: null },
    { winner: null, player: { rescuedYear: 1996, listedYear: 1997, outYear: 2001, outReason: "bankrupt" }, rivals: allOut(2005), leaderHeld: null },
  ] satisfies readonly Hand[]
).map(built);

describe("the summary", () => {
  const summary = summarizeCareers(TEN);

  it("counts wins by the style the winner plays, newcomers included, and says how many were the 1990 company's", () => {
    expect(summary.careers).toBe(10);
    expect(summary.winShare).toEqual({ baseline: 0.3, blitzscaler: 0.2, bootstrapper: 0.1, incumbent: 0.2, nobody: 0.2 });
    expect(summary.originalWinShare).toEqual({ baseline: 0.3, blitzscaler: 0.1, bootstrapper: 0.1, incumbent: 0.1 });
    expect(summary.newcomerWinShare).toBe(0.2);
  });

  it("counts the years a rival spent doing nothing", () => {
    expect(summary.idleRivalYearsPerCareer).toBe(1);
    expect(summary.rivalsOutPerCareer).toBeCloseTo(0.8, 12);
  });

  it("counts how often the baseline bot's career ended early, was rescued, went public", () => {
    expect([summary.baselineOutShare, summary.baselineRescuedShare, summary.baselineListedShare]).toEqual([0.4, 0.6, 0.5]);
    expect(summary.medianOutYear).toBe(2002.5);
    expect(summary.medianListingYear).toBe(1998);
    expect(summary.rescuedInYearShare).toEqual({ 1993: 0.2, 1994: 0.1, 1995: 0.1, 1996: 0.1, 2002: 0.1 });
    expect(summarizeCareers(TEN.slice(5, 7))).toMatchObject({ baselineOutShare: 0, medianOutYear: null });
  });

  it("leaves careers with nobody in the game in 2010 out of the lead figure", () => {
    expect(summary.leaderHeldShare).toBeCloseTo(4 / 6, 12);
    expect(summarizeCareers(TEN.filter((career) => career.leaderHeld === null)).leaderHeldShare).toBe(0);
  });

  it("says how often a card that hits one company found one, and the typical position among companies in the game", () => {
    expect(summary.cardHitShare).toEqual({ 2011: 0.5 });
    const player = summary.positions[2010].baseline;
    expect(player).toMatchObject({ companies: 1, listed: 0.5, users: 550, cash: 5_500, headcount: 5.5, quality: 14.5 });
    expect(player.equity).toBeCloseTo(0.775, 12);
    expect(summary.positions[2010].blitzscaler).toMatchObject({ companies: 0.5, users: 7 });
  });
});

// ── The five targets ──

const position: CareerPosition = { companies: 1, listed: 0.5, users: 2_000_000, cash: 3_000_000, headcount: 40, quality: 60, equity: 0.4 };
const passing: CareerSummary = {
  careers: 20,
  winShare: { baseline: 0.25, blitzscaler: 0.25, bootstrapper: 0.25, incumbent: 0.2, nobody: 0.05 },
  originalWinShare: { baseline: 0.25, blitzscaler: 0.2, bootstrapper: 0.2, incumbent: 0.15 },
  newcomerWinShare: 0.15,
  baselineOutShare: 0.2,
  baselineRescuedShare: 0.4,
  baselineListedShare: 0.6,
  medianOutYear: 2004,
  medianListingYear: 2001,
  playerMedianStake: 50_000_000,
  leaderHeldShare: 0.5,
  rivalsOutPerCareer: 1.2,
  idleRivalYearsPerCareer: 0.5,
  cardHitShare: { 2011: 0.8, 2035: 0.6 },
  rescuedInYearShare: { 1993: 0.1, 2001: 0.15 },
  positions: { 2010: { baseline: position, blitzscaler: position, bootstrapper: position, incumbent: position } },
};

describe("the five targets", () => {
  const check = (id: CareerCheckId, patch: Partial<CareerSummary>) =>
    checkCareerTargets({ ...passing, ...patch }, CAREER_DESIGN.sim.targets, 2010).find((each) => each.id === id)!;

  it("passes a summary inside every target", () => {
    expect(checkCareerTargets(passing, CAREER_DESIGN.sim.targets, 2010).map((each) => [each.id, each.pass])).toEqual([
      ["cpu-cap", true],
      ["baseline", true],
      ["early-end", true],
      ["listed", true],
      ["lead", true],
    ]);
  });

  it("a range passes on its bounds and fails just outside", () => {
    expect(check("early-end", { baselineOutShare: 0.1 }).pass).toBe(true);
    expect(check("early-end", { baselineOutShare: 0.0999 }).pass).toBe(false);
    expect(check("listed", { baselineListedShare: 0.8 }).pass).toBe(true);
    expect(check("listed", { baselineListedShare: 0.8001 }).pass).toBe(false);
    expect(check("baseline", { winShare: { ...passing.winShare, baseline: 0.35 } }).pass).toBe(true);
    expect(check("baseline", { winShare: { ...passing.winShare, baseline: 0.3501 } }).pass).toBe(false);
  });

  it("the CPU cap is on the style's pooled share, newcomers included", () => {
    expect(check("cpu-cap", { winShare: { ...passing.winShare, incumbent: 0.4 } }).pass).toBe(true);
    expect(check("cpu-cap", { winShare: { ...passing.winShare, incumbent: 0.4001 }, originalWinShare: { ...passing.originalWinShare, incumbent: 0.2 } }).pass).toBe(false);
  });

  it("the lead target needs to be under its figure", () => {
    expect(check("lead", { leaderHeldShare: 0.6 }).pass).toBe(false);
    expect(check("lead", { leaderHeldShare: 0.5999 }).pass).toBe(true);
  });

  it("says them in the owner's words", () => {
    expect(checkCareerTargets(passing, CAREER_DESIGN.sim.targets, 2010).map((each) => each.label)).toEqual([
      "No CPU type wins more than 40.0%",
      "Baseline bot wins 15.0% to 35.0%",
      "Baseline bot's career ends early in 10.0% to 30.0%",
      "Baseline bot goes public in 40.0% to 80.0%",
      "The leader of 2010 wins in less than 60.0%",
    ]);
  });
});

// ── The pilots ──

const step = CAREER_TEST.pull.marketingStep;
const at = (turn: number): GameState => atTurn(newCareer(), turn);

/**
 * 2010, seat 0 qualified to list, at the bar's users, after a year that lost $100,000: $1M is ten years of cash.
 * Short of cash it has $200,000, two years. In 2038 it is the same company in the final year.
 */
const qualifiedIn = (turn: number, cash: number): GameState =>
  withCompany(qualify(at(turn), HUMAN), HUMAN, { cash, lastRevenue: 750_000, lastCosts: 850_000 });
const qualifiedView = viewFor(qualifiedIn(21, 1_000_000), HUMAN);
const qualifiedViewShortOfCash = viewFor(qualifiedIn(21, 200_000), HUMAN);
const qualifiedViewIn2038 = viewFor(qualifiedIn(49, 1_000_000), HUMAN);

/**
 * 2038, seat 0 public since 2000, founders holding the board (two seats to one), $1M in hand, far under the largest
 * budget. With 250,000 users its revenue covers its costs; with 20,000 it does not.
 */
const publicIn2038 = (users: number): GameState =>
  withCareerOf(
    launchedCompany(at(49), HUMAN, { users, cash: 1_000_000, investorSeats: 1, founderEquity: 0.8, lastRevenue: users * 3, lastCosts: 120_000 }),
    HUMAN,
    { qualified: true, listed: { turn: 11, valuation: 10_000_000, amount: 2_000_000 } },
  );
const viewIn2038 = viewFor(publicIn2038(250_000), HUMAN);
const viewIn2038AtALoss = viewFor(publicIn2038(20_000), HUMAN);

/** CAREER_TEST with a platform shift to 30 dated to 2011. */
const SHIFT: DatedCard = {
  id: "test-shift",
  name: "Test shift",
  text: "A new platform: every product starts again.",
  year: 2011,
  effects: [
    { kind: "qualityCeiling", ceiling: 30, turns: 1 },
    { kind: "userWave", multiplier: 1.3, turns: 3 },
  ],
};
const config = withCareer({ dated: [SHIFT] });
/** A launched company of six in 2010, the year before the shift, at quality 80 or 20; and in 2011 itself, at 30. */
const viewBeforeShift = viewFor(launchedCompany(at(21), HUMAN, { headcount: 6, quality: 80 }), HUMAN);
const viewBelowCeiling = viewFor(launchedCompany(at(21), HUMAN, { headcount: 6, quality: 20 }), HUMAN);
const viewInShiftYear = viewFor(withState(launchedCompany(at(22), HUMAN, { headcount: 6, quality: 30 }), { event: { cardId: SHIFT.id, targetId: null } }), HUMAN);

/**
 * Seat 0 launched with six people, 10,000 users and $1M, four years of payroll: it does not raise. Seat 2 has the most
 * users but one person, too few to lose anyone; seat 1 has the most of those it may poach from.
 */
const overspender = (turn: number): GameState =>
  launchedCompany(launchedCompany(launchedCompany(at(turn), HUMAN, { headcount: 6, users: 10_000, cash: 1_000_000 }), BLITZ, { users: 50_000 }), BOOT, {
    users: 80_000,
    headcount: 1,
  });
const viewIn1992 = viewFor(overspender(3), HUMAN);
const viewIn1993 = viewFor(overspender(4), HUMAN);
const viewIn1994 = viewFor(overspender(5), HUMAN);
const viewIn1994Rescued = viewFor(withCareerOf(overspender(5), HUMAN, { rescue: { turn: 4, reason: "bankrupt" } }), HUMAN);
const largestRivalIn1993 = viewIn1993.rivals[0];

const notesOn = (view: CompanyView, plan: Plan, on: PlayConfig = CAREER_TEST): readonly string[] =>
  normalizePlanFor(view.self, view.turn, view.rivals, plan, on, view.climate.multiplier).notes;

describe("the pilots", () => {
  it("one is the baseline bot that never goes public", () => {
    expect(baselinePlan(qualifiedView, CAREER_TEST).goPublic).toBe(true);
    expect(neverListPilot(qualifiedView, CAREER_TEST)).toEqual({ ...baselinePlan(qualifiedView, CAREER_TEST), goPublic: false });
    expect(baselinePlan(qualifiedViewShortOfCash, CAREER_TEST)).toMatchObject({ goPublic: true, raisePercent: 0 });
    expect(neverListPilot(qualifiedViewShortOfCash, CAREER_TEST)).toMatchObject({ goPublic: false, raisePercent: 20 });
    expect(notesOn(qualifiedViewShortOfCash, neverListPilot(qualifiedViewShortOfCash, CAREER_TEST))).toEqual([]);
  });

  it("have the names the report prints", () => {
    expect([PILOT_NAMES.neverList, PILOT_NAMES.listLast, PILOT_NAMES.endgame, PILOT_NAMES.overspend(1993)]).toEqual([
      "Never goes public",
      "Goes public in the final year",
      "Spends everything in the final year",
      "Overspends from 1993 until rescued",
    ]);
    expect(PILOT_NAMES.shiftAware).toBe("Reads the timeline");
  });

  it("one waits to go public until the final year, unless it runs short of cash first", () => {
    expect(listLastPilot(qualifiedView, CAREER_TEST)).toEqual({ ...baselinePlan(qualifiedView, CAREER_TEST), goPublic: false });
    expect(listLastPilot(qualifiedViewShortOfCash, CAREER_TEST)).toEqual(baselinePlan(qualifiedViewShortOfCash, CAREER_TEST));
    expect(listLastPilot(qualifiedViewIn2038, CAREER_TEST)).toEqual(baselinePlan(qualifiedViewIn2038, CAREER_TEST));
    expect(baselinePlan(qualifiedViewIn2038, CAREER_TEST).goPublic).toBe(true);
  });

  it("one plays the final year for its stake alone, and is the baseline bot until then", () => {
    expect(endgamePilot(viewIn2038, CAREER_TEST)).toEqual({ ...baselinePlan(viewIn2038, CAREER_TEST), price: "budget", marketing: Math.floor(viewIn2038.self.cash / step) * step });
    expect(notesOn(viewIn2038, endgamePilot(viewIn2038, CAREER_TEST))).toEqual([]);
    // The same company at a loss before any marketing: it spends only what it can cover.
    const careful = endgamePilot(viewIn2038AtALoss, CAREER_TEST);
    expect(projectTurn(viewIn2038AtALoss, careful, CAREER_TEST).cashFloor).toBeGreaterThanOrEqual(0);
    expect(careful.marketing).toBeGreaterThan(0);
    expect(careful.marketing).toBeLessThan(Math.floor(viewIn2038AtALoss.self.cash / step) * step);
    expect(notesOn(viewIn2038AtALoss, careful)).toEqual([]);
    expect(endgamePilot(qualifiedView, CAREER_TEST)).toEqual(baselinePlan(qualifiedView, CAREER_TEST));
  });

  it("one reads the timeline: no Product work on a product that a shift is about to cut down", () => {
    const base = baselinePlan(viewBeforeShift, config);
    expect(base.allocation.product).toBeGreaterThan(0);
    expect(base.allocation.growth).toBeGreaterThan(0);
    expect(shiftAwarePilot(viewBeforeShift, config)).toEqual({
      ...base,
      allocation: { product: 0, growth: base.allocation.product + base.allocation.growth, recruiting: base.allocation.recruiting },
    });
    expect(notesOn(viewBeforeShift, shiftAwarePilot(viewBeforeShift, config), config)).toEqual([]);
    expect(shiftAwarePilot(viewBelowCeiling, config)).toEqual(baselinePlan(viewBelowCeiling, config));
    expect(shiftAwarePilot(viewBeforeShift, CAREER_TEST)).toEqual(baselinePlan(viewBeforeShift, CAREER_TEST));
    // In the shift's own year, with the ceiling held: the same swap.
    expect(baselinePlan(viewInShiftYear, config).allocation.product).toBeGreaterThan(0);
    expect(shiftAwarePilot(viewInShiftYear, config).allocation.product).toBe(0);
  });

  it("one spends all it can from its year on, until it has been rescued", () => {
    expect(baselinePlan(viewIn1993, CAREER_TEST).raisePercent).toBe(0);
    expect(viewIn1993.self.cash).toBeLessThan(CAREER_TEST.pull.maxMarketing);
    const plan = overspendPilot(1993)(viewIn1993, CAREER_TEST);
    expect(plan.marketing).toBe(Math.floor(viewIn1993.self.cash / step) * step);
    expect(plan.allocation.recruiting).toBe(Math.max(1, Math.round(viewIn1993.self.headcount / 3)));
    expect(plan.hireLimit).toBeNull();
    expect(largestRivalIn1993.id).toBe(BLITZ);
    expect(plan.poachTarget).toBe(largestRivalIn1993.id);
    expect(normalizePlanFor(viewIn1993.self, 4, viewIn1993.rivals, plan, CAREER_TEST).notes).toEqual([]);
    expect(overspendPilot(1993)(viewIn1992, CAREER_TEST)).toEqual(baselinePlan(viewIn1992, CAREER_TEST));
    expect(overspendPilot(1993)(viewIn1994, CAREER_TEST).hireLimit).toBeNull();
    expect(overspendPilot(1993)(viewIn1994Rescued, CAREER_TEST)).toEqual(baselinePlan(viewIn1994Rescued, CAREER_TEST));
  });

  it("is flagged only when it beats the baseline bot by more than the margin", () => {
    const winning = (baseline: number): CareerSummary => ({ ...passing, winShare: { ...passing.winShare, baseline } });
    expect(checkLoophole("x", winning(0.26), winning(0.23), 0.03).flagged).toBe(false);
    expect(checkLoophole("x", winning(0.27), winning(0.23), 0.03).flagged).toBe(true);
    expect(checkLoophole("x", winning(0.27), winning(0.23), 0.03)).toMatchObject({ name: "x", winShare: 0.27, baselineWinShare: 0.23 });
  });

  it("says how the pilot's final stake compares, and how often it was rescued", () => {
    const result = checkLoophole("x", { ...passing, playerMedianStake: 1_200, baselineRescuedShare: 0.9 }, { ...passing, playerMedianStake: 1_000 }, 0.03);
    expect([result.stakeRatio, result.rescuedShare]).toEqual([1.2, 0.9]);
    expect(checkLoophole("x", passing, { ...passing, playerMedianStake: 0 }, 0.03).stakeRatio).toBeNull();
  });
});

it("the control has every platform shift switched off, and nothing else changed", () => {
  const control = withoutShifts(CAREER_DESIGN);
  const effects = control.career.dated.flatMap((card) => card.effects);
  expect(effects.flatMap((effect) => (effect.kind === "qualityCeiling" ? [effect.ceiling] : []))).toEqual([100, 100, 100, 100]);
  expect(effects.flatMap((effect) => (effect.kind === "userWave" ? [effect.multiplier] : []))).toEqual([1, 1, 1, 1]);
  const outline = (each: CareerGameConfig) => each.career.dated.map((card) => [card.id, card.year, card.effects.map((effect) => effect.kind)]);
  expect(outline(control)).toEqual(outline(CAREER_DESIGN));
  expect({ ...control, career: { ...control.career, dated: [] } }).toEqual({ ...CAREER_DESIGN, career: { ...CAREER_DESIGN.career, dated: [] } });
});

it("an override can give an era a number it did not set", () => {
  const changed = applyOverrides(CAREER_DESIGN, { "career.eras.2.values.quality.decay": 7 });
  expect(CAREER_DESIGN.career.eras[2].values.quality?.decay).toBeUndefined();
  expect(rulesForTurn(changed, turnOf(2000, changed.career)).quality.decay).toBe(7);
  expect(rulesForTurn(changed, 1).quality.decay).toBe(CAREER_DESIGN.quality.decay);
  // A list the era does not set is copied from the base whole, with the one entry changed.
  const options = applyOverrides(CAREER_DESIGN, { "career.eras.2.values.raise.options.0": 5 });
  expect(rulesForTurn(options, turnOf(2000, options.career)).raise.options).toEqual([5, ...CAREER_DESIGN.raise.options.slice(1)]);
  expect(() => applyOverrides(CAREER_DESIGN, { "career.eras.2.values.quality.decline": 7 })).toThrow(/No such config number/);
  expect(() => applyOverrides(CAREER_DESIGN, { "career.eras.2.values.quality.decay": "fast" })).toThrow(/is a number, not a string/);
});

it("an override of a base number that every era sets is refused, with the way to do it", () => {
  expect(() => applyOverrides(CAREER_DESIGN, { salary: 90_000 })).toThrow("salary has no effect: every era sets its own (use career.eras.<n>.values.salary)");
  expect(applyOverrides(CAREER_DESIGN, { "quality.decay": 7 }).quality.decay).toBe(7);
});

it("the report speaks in years and shows every target, the three loophole pilots and both measures", () => {
  const checks = checkCareerTargets(passing, CAREER_DESIGN.sim.targets, 2010);
  const loopholes = [PILOT_NAMES.neverList, PILOT_NAMES.listLast, PILOT_NAMES.overspend(1993)].map((name) => checkLoophole(name, passing, passing, 0.03));
  const text = formatCareerReport(passing, checks, loopholes, CAREER_DESIGN, { withoutShifts: passing, endgame: passing, shiftAware: passing });
  expect(text.split("\n")[0]).toBe("Career simulation: 20 careers, 1990 to 2038");
  for (const check of checks) expect(text).toContain(check.label);
  expect(text).toContain("Never goes public");
  expect(text).toContain("Goes public in the final year");
  expect(text).toContain("Overspends from 1993 until rescued");
  expect(text).toContain("with the platform shifts switched off");
  expect(text).toContain("Spends everything in the final year");
  expect(text).toContain("Reads the timeline");
  expect(text).not.toMatch(/\bturn \d/i);
  expect(text.split("\n").filter((line) => /PASS|FAIL/.test(line))).toHaveLength(5);
});
