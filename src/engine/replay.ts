// Replaying a recorded game. Because the engine is pure and every roll is keyed by the seed,
// the setup, the seed and each turn's plans are enough to rebuild a whole game.

import { CONFIG } from "../config";
import { resolveTurn } from "./resolveTurn";
import { createGame } from "./setup";
import type { GameSetup, GameState, PlanSet, RulesConfig, TurnLog } from "./types";

export interface GameRecord {
  readonly setup: GameSetup;
  readonly seed: number;
  /** One set of plans per turn played, every company's included. */
  readonly plans: readonly PlanSet[];
}

export interface Replay {
  readonly state: GameState;
  readonly logs: readonly TurnLog[];
}

/** Plays the record from turn 1; stops where the game ended, even if more plans follow. */
export const replayGame = (record: GameRecord, config: RulesConfig = CONFIG): Replay => {
  let state = createGame(record.setup, config);
  const logs: TurnLog[] = [];
  for (const plans of record.plans) {
    if (state.outcome !== null) break;
    const result = resolveTurn(state, plans, record.seed, config);
    state = result.state;
    logs.push(result.log);
  }
  return { state, logs };
};
