// Helpers for the career's tests. Not used by the game itself.
//
// The career's rule tests run on the race's frozen design numbers (src/config.design.ts) with the career switched
// on, never on the numbers the career ships with, so those can be tuned without touching a single test.

import type { GameConfig, PlayEra } from "../config";
import { DESIGN } from "../config.design";
import { rulesForTurn } from "./career";
import { revenueOf } from "./formulas";
import { createGame } from "./setup";
import { FOUR_SEATS, launchedCompany, withCompany } from "./testKit";
import type { CareerRules, CompanyCareer, CompanyId, GameState, OfficeConfig } from "./types";

/** The five offices at the sizes the career's design starts from. */
export const OFFICES: readonly OfficeConfig[] = [
  { id: "garage", name: "Garage", capacity: 4 },
  { id: "shared", name: "Shared office", capacity: 9 },
  { id: "own", name: "Own office", capacity: 22 },
  { id: "floor", name: "Full floor", capacity: 40 },
  { id: "campus", name: "Campus", capacity: 150 },
];

/** The career's rules at the starting numbers of the career's own design, in one flat era from 1990 on with no dated cards. */
export const CAREER_RULES: CareerRules = {
  firstYear: 1990,
  eras: [{ id: "flat", name: "Flat", firstYear: 1990, invented: false, values: {} }],
  dated: [],
  shiftNoticeYears: 2,
  listing: { percent: 20, premium: 1.25, hype: 20, investorSeats: 1 },
  rescue: { equityKept: 0.5, investorSeats: 2, hype: -10, salaryYears: 1 },
  replacement: { afterYears: 2, styles: ["blitzscaler", "bootstrapper", "incumbent"] },
  offices: OFFICES,
  moving: { salaryYears: 0.5 },
};

/** The race's design numbers played as a career: 49 years, and no random card unless a test asks for one. */
export const CAREER_TEST: GameConfig = { ...DESIGN, game: { maxTurns: 49 }, events: { ...DESIGN.events, chance: 0 }, career: CAREER_RULES };

/** A config with some of the career's rules replaced. A base that has no career gets CAREER_RULES first. */
export const withCareer = (patch: Partial<CareerRules>, base: GameConfig = CAREER_TEST): GameConfig => ({
  ...base,
  career: { ...(base.career ?? CAREER_RULES), ...patch },
});

/** CAREER_TEST with these eras in place of its one flat era. */
export const withEras = (...eras: PlayEra[]): GameConfig => withCareer({ eras });

export const newCareer = (config: GameConfig = CAREER_TEST): GameState => createGame(FOUR_SEATS, config);

/** The same state, dated to another turn. */
export const atTurn = (state: GameState, turn: number): GameState => ({ ...state, turn });

/** A company's career facts; throws if it has none, as in a race game. */
export const careerOf = (state: GameState, id: CompanyId): CompanyCareer => {
  const career = state.companies[id].career;
  if (career === undefined) throw new Error(`company ${id} has no career facts`);
  return career;
};

/** A copy of the state with some of one company's career facts replaced. */
export const withCareerOf = (state: GameState, id: CompanyId, patch: Partial<CompanyCareer>): GameState =>
  withCompany(state, id, { career: { ...careerOf(state, id), ...patch } });

/**
 * A company that may go public: launched, with the users of the turn's bar, a last year whose revenue covered its
 * costs (its payroll), and `career.qualified` set.
 */
export const qualify = (state: GameState, id: CompanyId, config: GameConfig = CAREER_TEST): GameState => {
  const rules = rulesForTurn(config, state.turn);
  const company = state.companies[id];
  const users = rules.ipo.users;
  const launched = launchedCompany(state, id, { users, lastRevenue: revenueOf(users, company.price, rules), lastCosts: company.headcount * rules.salary });
  return withCareerOf(launched, id, { qualified: true });
};
