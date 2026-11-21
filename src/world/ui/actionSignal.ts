/**
 * Turns "the player ran this command and the engine answered that" into the
 * ActionSignal the world layer listens to.
 *
 * Kept free of React, three.js and the stores so the game store can import it
 * from the entry chunk and so it can be tested against real engine results.
 */
import type { ActionResult } from "../../types/game";
import type { ActionSignal } from "../types";

/**
 * The engine refused the command outright (unknown command, no AP, a pending
 * event in the way, …).
 *
 * This is exactly the definition documented on `ActionSignal.rejected`, and
 * deriveWorldEvents relies on it: a refusal carries no sound hint and logs at
 * least one error line. Both halves matter — a backfired `board blackmail` logs
 * an error line but is a real outcome (sound "fail"), and an out-of-range
 * `choose 9` only logs an event-kind line.
 */
export const isRejected = (result: Pick<ActionResult, "logs" | "sound">): boolean =>
  result.sound === undefined && result.logs.some((entry) => entry.kind === "error");

/** Lower-cased tokens of a command line; the first one is the command. */
const tokenize = (input: string): string[] => input.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Signal for a command that went through `executeCommand`. */
export const toActionSignal = (
  seq: number,
  input: string,
  result: Pick<ActionResult, "logs" | "sound">
): ActionSignal => {
  const [command = "", ...args] = tokenize(input);
  return { seq, command, args, sound: result.sound ?? null, rejected: isRejected(result) };
};

/**
 * Signal for a new run. The engine is not involved (the store swaps in a fresh
 * state), so there is no result to read; the world reacts to the changed run id
 * and only needs to know that something happened.
 */
export const restartSignal = (seq: number): ActionSignal => ({
  seq,
  command: "restart",
  args: [],
  sound: null,
  rejected: false,
});
