import type { ActionResult, GameState } from "../../types/game";
import type { Hint } from "../hints";

// The shapes every hook point in the shared engine files calls (TYCOON-SPEC §11.2).
// people/index.ts and projects/index.ts implement them; commands.ts, tick.ts, actions.ts and hints.ts call them.

/** A top-level command handler. `command` is the lower-cased first token, `rest` the remaining raw tokens. */
export type CommandHandler = (state: GameState, command: string, rest: string[]) => ActionResult;

/** A tick step that returns its input (same reference) and [] when idle. */
export type WeekStep = (state: GameState) => { state: GameState; logs: string[] };

/** Tick step N1: the work week. Lines are rendered later, from the finished tick (§6 step 10). */
export type ProjectsWeekStep = (state: GameState) => {
  state: GameState;
  render: (final: GameState) => string[]; // build lines; () => [] when idle
};

/** One extra line for `status`, or null. */
export type StatusLine = (state: GameState) => string | null;

/** Hints appended to generateHints before its sort. [] unless the player has engaged. */
export type HintSource = (state: GameState) => Hint[];

/** Today's patch: `shipFeature`. */
export type PatchFn = (state: GameState, name: string) => ActionResult;

/** `ship <name>`: release a build, refuse a near-miss, or fall through to the patch (§4.8). */
export type ShipRouter = (state: GameState, name: string, patch: PatchFn) => ActionResult;

/** Cruft and moat on weekly churn. Must return `churn` itself when cruft = moat = 0 or without a product slice. */
export type ChurnAdjuster = (state: GameState, churn: number) => number;
