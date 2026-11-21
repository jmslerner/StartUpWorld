import type { ActionResult, GameState, LogEntry, SoundHint } from "../../types/game";
import { appendLog } from "../logging";
import { toLog } from "../utils";
import { refreshDerivedNoLog } from "../derived";
import { isCofounderChosen, isFounderChosen } from "../founders";

// The action kit: what every command handler needs. withLogLines, err, ensurePlayable, canSpendAp and spendAp
// moved here from actions.ts unchanged (actions.ts imports them and keeps exporting canSpendAp / spendAp), so
// that people/ and projects/ can build ActionResults without importing actions.ts (which imports the tick).
// Line, NO_AP, reply and money are new.

export type Line = { text: string; kind?: LogEntry["kind"] };

export const NO_AP = "No AP left. End the week to refresh.";

export const withLogLines = (state: GameState, lines: Line[], sound?: SoundHint): ActionResult => {
  const logs: LogEntry[] = [];
  let s = state;
  for (const line of lines) {
    s = appendLog(s, logs, line.text, line.kind ?? "system");
  }
  return { state: refreshDerivedNoLog(s), logs, sound };
};

/** A refusal: one error line, no sound, nothing spent. (The 3D layer reads "error line + no sound" as "rejected".) */
export const err = (state: GameState, message: string): ActionResult => withLogLines(state, [{ text: message, kind: "error" }]);

export const ensurePlayable = (state: GameState): ActionResult | null => {
  if (state.gameOver) {
    return err(state, "Game over. Click 'Play Again' or refresh to start a new run.");
  }
  if (state.pendingEvent) {
    return err(state, "Resolve the pending event first with `choose <n>`.");
  }
  if (!isFounderChosen(state)) {
    return err(state, "Choose your founder first: `founder visionary|hacker|sales-animal|philosopher`.");
  }
  if (!isCofounderChosen(state)) {
    return err(state, "Choose your cofounder first: `cofounder operator|builder|rainmaker|powderkeg`.");
  }
  return null;
};

/** A reply that changes nothing at all, not even the log counter (what `help` and the easter eggs do today). */
export const reply = (state: GameState, lines: Line[]): ActionResult => ({ state, logs: lines.map((l) => toLog(l.text, l.kind ?? "system")) });

export const canSpendAp = (state: GameState, cost = 1): boolean => state.ap >= cost;

export const spendAp = (state: GameState, cost = 1): GameState => ({
  ...state,
  ap: Math.max(0, state.ap - cost),
  seedLocked: true,
});

/** "$7,600"; a negative amount reads "-$5,000", not "$-5,000" (ERRATA 73). */
export const money = (n: number): string => {
  const r = Math.round(n);
  return r < 0 ? `-$${(-r).toLocaleString()}` : `$${r.toLocaleString()}`;
};
