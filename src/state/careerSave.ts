// The career in progress, kept in the browser beside the race's save and never in its place.
//
// Its own localStorage key and version, so a race save and a career save do not disturb each other. It
// holds what the race's save holds plus the career's record of milestones. A save this build cannot use
// is refused (null), as the race's is.

import { CAREER } from "../config";
import type { RulesConfig } from "../engine/types";
import { isCareerRecord, type CareerRecord } from "./careerRecord";
import { loadedDraft, type SavedGame } from "./save";
import { isGame, isPlan, isRecord, isTurnLog } from "./shape";

export const CAREER_SAVE_KEY = "startupworld:career:save";

/** Bump whenever the career's save changes shape, so an older save is refused instead of breaking this build. */
export const CAREER_SAVE_VERSION = 1;

export interface SavedCareer extends SavedGame {
  /** The career's milestones by year. */
  readonly record: CareerRecord;
}

export const serializeCareerSave = (save: SavedCareer): string => JSON.stringify({ version: CAREER_SAVE_VERSION, ...save });

export const parseCareerSave = (raw: string | null, config: RulesConfig = CAREER): SavedCareer | null => {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== CAREER_SAVE_VERSION) return null;
    if (!Number.isInteger(data.seed)) return null;
    const { game, draft, record } = data;
    if (!isGame(game, config) || !isPlan(draft)) return null;
    if (!isCareerRecord(record, game.companies.length)) return null;
    // A report that cannot be shown is dropped; the game itself is still good.
    const lastLog = isTurnLog(data.lastLog, game.companies.length) ? data.lastLog : null;
    return {
      seed: data.seed as number,
      game,
      draft: loadedDraft(game, draft, config),
      lastLog,
      reportOpen: data.reportOpen === true && lastLog !== null,
      record,
    };
  } catch {
    return null;
  }
};
