import type { GameState, LogEntry } from "../types/game";
import { migrateState, SAVE_VERSION } from "../engine";

// The save format, kept free of `window` so it can be tested in node. The store owns
// reading and writing localStorage; this module only turns a stored string into a
// playable save (or null) and back.
//
// Versions: 1 had no `assets`; 2 is the pre-tycoon game (head counts only); 3 adds the
// `people` and `product` slices. Every step lives in the engine's `migrateState`, which is
// idempotent and leaves a valid live state unchanged, so a save an interim build stamped
// "2" while it already held slices loads correctly too.

export const SAVE_KEY = "startupworld:save";

export { SAVE_VERSION };

export interface SaveData {
  version: number;
  state: GameState;
  log: LogEntry[];
  commandHistory: string[];
}

/** A parsed save, plus the version it was stored as (the store writes a migrated save back once). */
export interface LoadedSave extends SaveData {
  fromVersion: number;
}

const isLogEntry = (x: unknown): x is LogEntry =>
  typeof x === "object" && x !== null && typeof (x as LogEntry).text === "string" && typeof (x as LogEntry).kind === "string";

/** The stored string for a save (always the current version). */
export const serializeSave = (state: GameState, log: LogEntry[], commandHistory: string[]): string =>
  JSON.stringify({ version: SAVE_VERSION, state, log, commandHistory } satisfies SaveData);

/**
 * A stored save, migrated to the current version, or null when there is nothing usable:
 * no save, unreadable JSON, no week/seed, or a version this build does not know (a save
 * from a newer build starts a fresh run rather than being misread).
 */
export const parseSave = (raw: string | null): LoadedSave | null => {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<SaveData> | null;
    if (!data || typeof data !== "object") return null;
    const state = data.state;
    if (typeof state?.week !== "number" || typeof state?.seed !== "number") return null;
    const version = data.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > SAVE_VERSION) return null;
    return {
      version: SAVE_VERSION,
      fromVersion: version,
      state: migrateState(state, version),
      log: Array.isArray(data.log) ? data.log.filter(isLogEntry) : [],
      commandHistory: Array.isArray(data.commandHistory)
        ? data.commandHistory.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return null;
  }
};
