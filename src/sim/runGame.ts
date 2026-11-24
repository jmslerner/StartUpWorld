// Plays whole games headlessly: the baseline bot in the player's seat against the three CPUs.
// Unlike the app, the simulator plays on after the player's seat is out, so every game has a winner.

import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CONFIG, type GameConfig } from "../config";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { Controller, EndingKind, GameState, OutReason } from "../engine/types";

/** Turns at which each seat's position is recorded, for the "typical position" table. */
export const CHECKPOINT_TURNS: readonly number[] = [5, 10, 15];

export interface SeatSnapshot {
  readonly controller: Controller;
  readonly inGame: boolean;
  readonly users: number;
  readonly cash: number;
  readonly headcount: number;
  readonly quality: number;
}

export interface SeatOutcome {
  readonly controller: Controller;
  readonly won: boolean;
  readonly out: OutReason | null;
  readonly outTurn: number | null;
  /** The turn its product launched; 0 if it started launched, null if it never did. */
  readonly launchTurn: number | null;
  readonly raises: number;
  /** As the game ended, or as the company went out. */
  readonly users: number;
  readonly headcount: number;
  readonly founderEquity: number;
}

export interface SimGame {
  readonly seed: number;
  readonly turns: number;
  readonly ending: EndingKind;
  readonly winner: Controller | null;
  readonly seats: readonly SeatOutcome[];
  /** Positions after each checkpoint turn the game reached. */
  readonly checkpoints: Readonly<Record<number, readonly SeatSnapshot[]>>;
}

const snapshot = (state: GameState): SeatSnapshot[] =>
  state.companies.map((company) => ({
    controller: company.controller,
    inGame: company.out === null,
    users: company.users,
    cash: company.cash,
    headcount: company.headcount,
    quality: company.quality,
  }));

export const runGame = (seed: number, config: GameConfig = CONFIG): SimGame => {
  let state = createGame(newGameSetup(seed, "Baseline", "baseline"), config);
  const launchTurn: (number | null)[] = state.companies.map((company) => (company.launched ? 0 : null));
  const raises = state.companies.map(() => 0);
  const checkpoints: Record<number, SeatSnapshot[]> = {};

  while (state.outcome === null) {
    const turn = state.turn;
    const result = resolveTurn(state, choosePlans(state, seed, config), seed, config);
    for (const report of result.log.companies) {
      if (report === null) continue;
      if (report.raise !== null) raises[report.companyId] += 1;
      if (report.quality.launchedNow) launchTurn[report.companyId] = turn;
    }
    state = result.state;
    if (CHECKPOINT_TURNS.includes(turn)) checkpoints[turn] = snapshot(state);
  }

  const outcome = state.outcome;
  return {
    seed,
    turns: outcome.turn,
    ending: outcome.kind,
    winner: outcome.winnerId === null ? null : state.companies[outcome.winnerId].controller,
    seats: state.companies.map((company) => ({
      controller: company.controller,
      won: company.id === outcome.winnerId,
      out: company.out?.reason ?? null,
      outTurn: company.out?.turn ?? null,
      launchTurn: launchTurn[company.id],
      raises: raises[company.id],
      users: company.out?.users ?? company.users,
      headcount: company.out?.headcount ?? company.headcount,
      founderEquity: company.founderEquity,
    })),
    checkpoints,
  };
};

/** Games with seeds firstSeed, firstSeed + 1, … */
export const runBatch = (games: number, firstSeed: number, config: GameConfig = CONFIG): SimGame[] =>
  Array.from({ length: games }, (_, i) => runGame(firstSeed + i, config));
