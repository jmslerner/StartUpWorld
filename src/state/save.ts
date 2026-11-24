// The game in progress, kept in the browser so a refresh does not lose it.
//
// One localStorage key, with a version. A save this build cannot use (older or newer version,
// damaged, or not shaped like a game) is ignored and the player starts a new game: it never crashes.
// The old weekly game's keys ("startupworld:save" and friends) are left alone.

import { CONFIG } from "../config";
import { normalizePlan } from "../engine/plan";
import type { GameState, Plan, RulesConfig, TurnLog } from "../engine/types";

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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const COMPANY_NUMBERS = ["cash", "headcount", "users", "quality", "hype", "founderEquity", "founderSeats", "investorSeats"];

const looksLikeGame = (value: unknown): value is GameState => {
  if (!isRecord(value) || !Number.isInteger(value.turn) || (value.turn as number) < 1) return false;
  if (!isRecord(value.climate) || !isRecord(value.modifiers)) return false;
  const companies = value.companies;
  if (!Array.isArray(companies) || companies.length < 2) return false;
  for (const company of companies) {
    if (!isRecord(company) || typeof company.name !== "string" || !looksLikePlan(company.lastPlan)) return false;
    if (!COMPANY_NUMBERS.every((key) => isNumber(company[key]))) return false;
  }
  return companies[0].controller === "human";
};

const looksLikePlan = (value: unknown): value is Plan => {
  if (!isRecord(value) || !isRecord(value.allocation)) return false;
  const allocation = value.allocation;
  return (
    ["product", "growth", "recruiting"].every((key) => isNumber(allocation[key])) &&
    isNumber(value.marketing) &&
    typeof value.price === "string" &&
    isNumber(value.raisePercent) &&
    isNumber(value.layoffs)
  );
};

export const parseSave = (raw: string | null, config: RulesConfig = CONFIG): SavedGame | null => {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== SAVE_VERSION) return null;
    if (!Number.isInteger(data.seed)) return null;
    if (!looksLikeGame(data.game) || !looksLikePlan(data.draft)) return null;
    const lastLog = isRecord(data.lastLog) && Array.isArray(data.lastLog.companies) ? (data.lastLog as unknown as TurnLog) : null;
    return {
      seed: data.seed as number,
      game: data.game,
      // Whatever was stored, the plan handed back is one the engine accepts.
      draft: normalizePlan(data.game, 0, data.draft, config).plan,
      lastLog,
      reportOpen: data.reportOpen === true && lastLog !== null,
    };
  } catch {
    return null;
  }
};
