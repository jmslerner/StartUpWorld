// Plays whole careers headlessly, 1990 to 2038: the baseline bot (or a pilot built on it) in the player's seat against
// the three computer styles, with newcomers taking the seats of rivals that go out. What it records is read off the
// logs and the states as they are; nothing is added to the engine for it.

import { baselinePlan } from "../ai/baselineBot";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CAREER, type CareerGameConfig, type PlayConfig } from "../config";
import { rulesForTurn, turnOf, yearOf } from "../engine/career";
import { founderStake } from "../engine/formulas";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { Company, CompanyId, CompanyReport, CompanyView, Controller, GameState, OutReason, Plan, TurnLog } from "../engine/types";
import { viewFor } from "../engine/view";

/** Plans the player's seat each year, from what that company can see. */
export type Pilot = (view: CompanyView, config: PlayConfig) => Plan;

/** One company that held a seat, as the logs tell it. */
export interface CareerCompany {
  readonly seat: CompanyId;
  /** The turn it entered the game: 1 for the first four. */
  readonly founded: number;
  readonly controller: Controller;
  readonly listedYear: number | null;
  readonly rescuedYear: number | null;
  readonly outYear: number | null;
  readonly outReason: OutReason | null;
  /** Its founder's stake as the career closes: equity times the valuation in its last report. $0 when it is out. */
  readonly finalStake: number;
}

/** One seat as a checkpoint year closes, read off that year's report. */
export interface CareerSnapshot {
  readonly controller: Controller;
  readonly inGame: boolean;
  readonly listed: boolean;
  readonly users: number;
  readonly cash: number;
  readonly headcount: number;
  readonly quality: number;
  readonly stake: number;
  readonly equity: number;
}

export interface SimCareer {
  readonly seed: number;
  /** Years in which a rival had one or two people and cash for ten years of their salaries or more: a company doing nothing. */
  readonly idleRivalYears: number;
  readonly winner: Controller | null;
  /** The winning company: its seat, and the turn it was founded (1 for the first four). Both null with no winner. */
  readonly winnerSeat: CompanyId | null;
  readonly winnerFounded: number | null;
  /** The four that started, by seat, then newcomers in the order they arrived. */
  readonly companies: readonly CareerCompany[];
  /** The company in seat 0. */
  readonly player: CareerCompany;
  /** Whether the company with the largest founder's stake at the end of `sim.leaderYear` won. null if no company was in the game then. */
  readonly leaderHeld: boolean | null;
  /** By year, then by seat. */
  readonly checkpoints: Readonly<Record<number, readonly CareerSnapshot[]>>;
  /** For each dated card that hits one company: the year, and whether it found one. */
  readonly targetedCards: readonly { readonly year: number; readonly hit: boolean }[];
}

type Story = { -readonly [K in keyof CareerCompany]: CareerCompany[K] };

const founded = (company: Company): number => company.career?.founded ?? 1;

const freshStory = (company: Company): Story => ({
  seat: company.id,
  founded: founded(company),
  controller: company.controller,
  listedYear: null,
  rescuedYear: null,
  outYear: null,
  outReason: null,
  finalStake: 0,
});

/** A report's company still in the game as its year closes. */
const stillIn = (report: CompanyReport | null): report is CompanyReport => report !== null && report.out === null;

const stakeOf = (report: CompanyReport): number => founderStake(report.equity, report.valuation);

/** The company not out with the largest founder's stake as a year closes; ties go to the higher valuation, then the lower seat. */
const leaderOf = (log: TurnLog): CompanyReport | null => {
  let leader: CompanyReport | null = null;
  for (const report of log.companies) {
    if (!stillIn(report)) continue;
    if (leader === null) {
      leader = report;
      continue;
    }
    const byStake = stakeOf(report) - stakeOf(leader);
    if (byStake > 0 || (byStake === 0 && report.valuation > leader.valuation)) leader = report;
  }
  return leader;
};

/** Each seat as the year closes: the companies that opened it, with the year's report. */
const snapshotOf = (opening: GameState, log: TurnLog): CareerSnapshot[] =>
  opening.companies.map((company) => {
    const report = log.companies[company.id];
    const listed = (company.career?.listed ?? null) !== null || (report?.career?.listing ?? null) !== null;
    if (report === null || report.out !== null) {
      // Out before the year or during it: nothing left in the game, and no stake.
      return {
        controller: company.controller,
        inGame: false,
        listed,
        users: 0,
        cash: report?.cash.end ?? company.cash,
        headcount: 0,
        quality: report?.quality.end ?? company.quality,
        stake: 0,
        equity: report?.equity ?? company.founderEquity,
      };
    }
    return {
      controller: company.controller,
      inGame: true,
      listed,
      users: report.users.end,
      cash: report.cash.end,
      headcount: report.headcount.end,
      quality: report.quality.end,
      stake: stakeOf(report),
      equity: report.equity,
    };
  });

/** Rivals in the game as the year opens with one or two people and cash for ten years of their salaries or more. */
const idleRivals = (opening: GameState, config: CareerGameConfig): number => {
  const rules = rulesForTurn(config, opening.turn);
  return opening.companies.filter(
    (company) => company.id !== 0 && company.out === null && company.headcount >= 1 && company.headcount <= 2 && company.cash >= 10 * company.headcount * rules.salary,
  ).length;
};

/** One whole career. `pilot` plans seat 0 while its company is in the game; by default the baseline bot does. Pure. */
export const runCareer = (seed: number, config: CareerGameConfig = CAREER, pilot: Pilot = baselinePlan): SimCareer => {
  const career = config.career;
  const year = (turn: number): number => yearOf(turn, career);
  const leaderTurn = turnOf(config.sim.leaderYear, career);
  const checkpointTurns = new Set(config.sim.checkpointYears.map((each) => turnOf(each, career)));

  let state = createGame(newGameSetup(seed, "Baseline", "baseline"), config);
  const stories: Story[] = state.companies.map(freshStory);
  /** Which story each seat's company is telling. */
  const holder = stories.map((_, seat) => seat);
  const checkpoints: Record<number, CareerSnapshot[]> = {};
  const targetedCards: { year: number; hit: boolean }[] = [];
  const targetedYears = new Set(career.dated.filter((card) => card.target !== undefined).map((card) => card.year));
  let idleRivalYears = 0;
  let leader: { readonly seat: CompanyId; readonly founded: number } | null = null;

  while (state.outcome === null) {
    const opening = state;
    const turn = opening.turn;
    idleRivalYears += idleRivals(opening, config);
    const plans = [...choosePlans(opening, seed, config)];
    if (opening.companies[0].out === null) plans[0] = pilot(viewFor(opening, 0), config);
    const { state: next, log } = resolveTurn(opening, plans, seed, config);

    log.companies.forEach((report, seat) => {
      if (report === null) return;
      const story = stories[holder[seat]];
      if (report.career?.listing) story.listedYear = year(turn);
      if (report.career?.rescue) story.rescuedYear = year(turn);
      if (report.out !== null) {
        story.outYear = year(turn);
        story.outReason = report.out;
      }
      story.finalStake = report.out === null ? stakeOf(report) : 0;
    });
    if (targetedYears.has(year(turn))) targetedCards.push({ year: year(turn), hit: (opening.event?.targetId ?? null) !== null });
    if (checkpointTurns.has(turn)) checkpoints[year(turn)] = snapshotOf(opening, log);
    if (turn === leaderTurn) {
      const best = leaderOf(log);
      leader = best === null ? null : { seat: best.companyId, founded: founded(opening.companies[best.companyId]) };
    }
    // Newcomers take their seats for the next year: the turn after this log.
    for (const seat of log.entrants ?? []) holder[seat] = stories.push(freshStory(next.companies[seat])) - 1;
    state = next;
  }

  const winnerSeat = state.outcome.winnerId;
  const winner = winnerSeat === null ? null : state.companies[winnerSeat];
  const winnerFounded = winner === null ? null : founded(winner);
  return {
    seed,
    idleRivalYears,
    winner: winner === null ? null : winner.controller,
    winnerSeat,
    winnerFounded,
    companies: stories,
    player: stories[0],
    leaderHeld: leader === null ? null : leader.seat === winnerSeat && leader.founded === winnerFounded,
    checkpoints,
    targetedCards,
  };
};

/** Careers with seeds firstSeed, firstSeed + 1, … */
export const runCareerBatch = (careers: number, firstSeed: number, config: CareerGameConfig = CAREER, pilot: Pilot = baselinePlan): SimCareer[] =>
  Array.from({ length: careers }, (_, i) => runCareer(firstSeed + i, config, pilot));
