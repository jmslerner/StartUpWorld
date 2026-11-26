/**
 * The world's one input: an office scene. Plain data, built outside the 3D code (src/scene) from the game's state.
 * This file imports nothing, so anything may read it. Re-exported by ../types.
 */

/** The engine's Department, spelt the same. The world keeps its own copy so that it imports nothing from the rules. */
export type Team = "product" | "growth" | "recruiting";
export const TEAMS: readonly Team[] = ["product", "growth", "recruiting"];

/** Which of the five offices: 0 is the garage, 4 the campus. */
export type OfficeIndex = 0 | 1 | 2 | 3 | 4;

/**
 * How an office is dressed: one look per era of the career (its palette, its resting light, its signature props),
 * named as the era is, and the classic look for any era the world does not know.
 */
export type LookId = "classic" | "dial-up" | "gold-rush" | "bust" | "phones" | "cheap-money" | "winter-ai" | "agents" | "ambient";

/**
 * The furniture a look stands on: the desks, the computer on them, floors, walls and shells. Eight looks share the
 * decades' three sets; the classic set is what the classic look keeps.
 */
export type FurnitureSet = "classic" | "nineties" | "noughties" | "twenties" | "future";

export interface OfficeScene {
  /** Changes when another company or another game is shown: everything is rebuilt. */
  readonly runId: string;
  /** Seeds every face. The same seed and the same history give the same faces. */
  readonly seed: number;
  readonly year: number;
  readonly office: OfficeIndex;
  /** How many people this office holds: 4, 9, 22, 40 or 150 at the starting numbers. */
  readonly capacity: number;
  /** The era's id. `lookFor(era)` turns it into a look. */
  readonly era: string;
  /** People at work this year, by team. */
  readonly teams: Readonly<Record<Team, number>>;
  /** People away raising money this year (0 or 1). They keep their desk. */
  readonly away: number;
  /** People let go this year. They stand at the door until the year has played out. */
  readonly leaving: number;
  /** Hires expected this year. They wait at the door. */
  readonly arriving: number;
  readonly ending: "won" | "lost" | null;
}
