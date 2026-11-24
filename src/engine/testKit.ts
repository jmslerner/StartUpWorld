// Helpers for the engine's tests. Not used by the game itself.

import { CONFIG } from "../config";
import { defaultPlan } from "./plan";
import { resolveTurn, type TurnResult } from "./resolveTurn";
import { createGame } from "./setup";
import type { Company, CompanyId, CompanyReport, GameSetup, GameState, Plan, PlanSet, RulesConfig } from "./types";

/** Seat ids used throughout the tests. */
export const HUMAN = 0;
export const BLITZ = 1;
export const BOOT = 2;
export const INCUMBENT = 3;

export const FOUR_SEATS: GameSetup = {
  seats: [
    { controller: "human", archetype: "startup", name: "Acme", pitch: "Your startup." },
    { controller: "blitzscaler", archetype: "startup", name: "Zipp", pitch: "Growth at all costs." },
    { controller: "bootstrapper", archetype: "startup", name: "Oakline", pitch: "Built to last." },
    { controller: "incumbent", archetype: "incumbent", name: "Nimbus", pitch: "The name you know." },
  ],
};

export const newGame = (config: RulesConfig = CONFIG): GameState => createGame(FOUR_SEATS, config);

/** A copy of the state with some fields replaced. */
export const withState = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

/** A copy of the state with one company's fields replaced. */
export const withCompany = (state: GameState, id: CompanyId, patch: Partial<Company>): GameState => ({
  ...state,
  companies: state.companies.map((company) => (company.id === id ? { ...company, ...patch } : company)),
});

/** The company's default plan with some fields replaced. */
export const planOf = (state: GameState, id: CompanyId, patch: Partial<Plan> = {}): Plan => ({
  ...defaultPlan(state.companies[id]),
  ...patch,
});

/** Default plans for everyone, with per-company patches. */
export const plansOf = (state: GameState, patches: Readonly<Record<number, Partial<Plan>>> = {}): PlanSet =>
  state.companies.map((company) => planOf(state, company.id, patches[company.id] ?? {}));

/** Take every company except the listed ones out of the game, as if they had gone bankrupt earlier. */
export const onlyActive = (state: GameState, ids: readonly CompanyId[]): GameState => ({
  ...state,
  companies: state.companies.map((company) =>
    ids.includes(company.id)
      ? company
      : { ...company, users: 0, headcount: 0, out: { turn: 0, reason: "bankrupt", users: 0, headcount: 0 } },
  ),
});

/** Sum of users held by companies plus users waiting in the pool. */
export const usersInSystem = (state: GameState): number =>
  state.companies.reduce((sum, company) => sum + company.users, 0) + state.carryOverUsers;

/** Resolve one turn with default plans plus per-company patches. */
export const resolve = (
  state: GameState,
  patches: Readonly<Record<number, Partial<Plan>>> = {},
  seed = 1,
  config: RulesConfig = CONFIG,
): TurnResult => resolveTurn(state, plansOf(state, patches), seed, config);

/** A company's report for the turn; throws if it was already out. */
export const reportFor = (result: TurnResult, id: CompanyId): CompanyReport => {
  const report = result.log.companies[id];
  if (!report) throw new Error(`company ${id} has no report`);
  return report;
};

/** The first seed (from 1) for which the predicate holds. */
export const seedWhere = (predicate: (seed: number) => boolean): number => {
  for (let seed = 1; seed < 100_000; seed++) if (predicate(seed)) return seed;
  throw new Error("no seed found");
};

/** A launched company with users, for tests that need a going concern. */
export const launchedCompany = (state: GameState, id: CompanyId, patch: Partial<Company> = {}): GameState => {
  const users = patch.users ?? 10_000;
  return withCompany(state, id, { launched: true, quality: 50, users, usersAtLastClose: users, ...patch });
};
