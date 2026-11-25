// The game in progress, kept in the browser so a refresh does not lose it.
//
// One localStorage key, with a version. A save this build cannot use (older or newer version,
// damaged, or not shaped like a game) is ignored and the player starts a new game: it never crashes.
// The old weekly game's keys ("startupworld:save" and friends) are left alone.

import { CONFIG } from "../config";
import { normalizePlan } from "../engine/plan";
import type { GameState, Plan, RulesConfig, TurnLog } from "../engine/types";
import { PLAYER_ID } from "./player";
import { isGame, isPlan, isRecord, isTurnLog } from "./shape";

export const SAVE_KEY = "startupworld:tb:save";

/** Bump whenever GameState, Plan or TurnLog changes shape, so an older save starts a new game instead of breaking this one. */
export const SAVE_VERSION = 1;

export interface SavedGame {
  readonly seed: number;
  readonly game: GameState;
  /** The plan the player was editing. */
  readonly draft: Plan;
  /** Last quarter's log, for the quarterly report. */
  readonly lastLog: TurnLog | null;
  readonly reportOpen: boolean;
}

export const serializeSave = (save: SavedGame): string => JSON.stringify({ version: SAVE_VERSION, ...save });

/**
 * The saved draft as the planning panel may hold it: every number legal, and people left without a
 * department still without one. Only a split holding more people than there are is refitted.
 */
const loadedDraft = (game: GameState, draft: Plan, config: RulesConfig): Plan => {
  const checked = normalizePlan(game, PLAYER_ID, draft, config).plan;
  const saved = [draft.allocation.product, draft.allocation.growth, draft.allocation.recruiting];
  const available = checked.allocation.product + checked.allocation.growth + checked.allocation.recruiting;
  const fits = saved.every((people) => Number.isInteger(people) && people >= 0) && saved[0] + saved[1] + saved[2] <= available;
  return fits ? { ...checked, allocation: draft.allocation } : checked;
};

export const parseSave = (raw: string | null, config: RulesConfig = CONFIG): SavedGame | null => {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== SAVE_VERSION) return null;
    if (!Number.isInteger(data.seed)) return null;
    const { game, draft } = data;
    if (!isGame(game, config) || !isPlan(draft)) return null;
    // A report that cannot be shown is dropped; the game itself is still good.
    const lastLog = isTurnLog(data.lastLog, game.companies.length) ? data.lastLog : null;
    return {
      seed: data.seed as number,
      game,
      draft: loadedDraft(game, draft, config),
      lastLog,
      reportOpen: data.reportOpen === true && lastLog !== null,
    };
  } catch {
    return null;
  }
};
