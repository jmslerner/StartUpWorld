/**
 * A year playing out in the office after "End year": which beat is on screen at each moment, when it is over, and
 * when End is refused or a year must not play at all. Pure: the screen keeps the clock and passes the time in.
 */

import type { PlaybackBeat, YearPlayback } from "../scene/yearPlayback";
import type { WorldHandle } from "../world/types/handle";
import type { OfficeAvailability } from "./officeView";
import type { OfficeSource } from "./officeSource";

export type YearPlay =
  | { readonly phase: "idle" }
  | {
      readonly phase: "playing";
      readonly year: number;
      readonly playback: YearPlayback;
      readonly startedMs: number;
      readonly endsMs: number;
    };

export const IDLE: YearPlay = { phase: "idle" };

/** Starts `year` playing at `nowMs` for the playback's length. A playback with no beats, or a year already playing,
 *  changes nothing. */
export const startYearPlay = (play: YearPlay, playback: YearPlayback, year: number, nowMs: number): YearPlay => {
  if (play.phase === "playing" || playback.beats.length === 0) return play;
  return { phase: "playing", year, playback, startedMs: nowMs, endsMs: nowMs + playback.seconds * 1000 };
};

/** The index of the beat on screen at `nowMs`; null when idle or done. The last beat runs to the end. */
export const beatIndexNow = (play: YearPlay, nowMs: number): number | null => {
  if (play.phase !== "playing" || nowMs >= play.endsMs) return null;
  const { beats } = play.playback;
  const elapsed = nowMs - play.startedMs;
  let ends = 0;
  for (let i = 0; i < beats.length - 1; i++) {
    ends += beats[i].seconds * 1000;
    if (elapsed < ends) return i;
  }
  return beats.length - 1;
};

/** The beat on screen at `nowMs`; null when idle or done. */
export const beatNow = (play: YearPlay, nowMs: number): PlaybackBeat | null => {
  const index = beatIndexNow(play, nowMs);
  return index === null || play.phase !== "playing" ? null : (play.playback.beats[index] ?? null);
};

/** Nothing is playing at `nowMs`. */
export const yearPlayDone = (play: YearPlay, nowMs: number): boolean => play.phase !== "playing" || nowMs >= play.endsMs;

export type YearPlayStep = { readonly kind: "none" } | { readonly kind: "beat"; readonly index: number } | { readonly kind: "finish" };

/**
 * What the office does for the moment the caption shows (`nowMs`, the moment the caption was drawn for), given the
 * beat it shows (`shown`): nothing, show the caption's beat, or finish the year once its time is up. The screen
 * shows a beat as it puts that beat's caption on the page, never ahead of it on its own clock, and finishes the year
 * in the same commit that takes the caption away, so the scene and the caption change together: the office never
 * shows the next beat (the hires walking in, the new office) under the last one's caption.
 */
export const yearPlayStep = (play: YearPlay, shown: number | null, nowMs: number): YearPlayStep => {
  if (play.phase !== "playing") return { kind: "none" };
  if (yearPlayDone(play, nowMs)) return { kind: "finish" };
  const index = beatIndexNow(play, nowMs);
  return index === null || index === shown ? { kind: "none" } : { kind: "beat", index };
};

/** The office stopped drawing (or is not known to draw): the year ends at once. */
export const yearPlayAfterLoss = (play: YearPlay, availability: OfficeAvailability): YearPlay =>
  availability === "running" ? play : IDLE;

/** End is refused while a year plays out or a report is open: checked before endQuarter runs. */
export const endRefused = (play: YearPlay, reportOpen: boolean): boolean => play.phase === "playing" || reportOpen;

/**
 * The year that End just closed plays out: a new report came in and the store reports no failure. The career's last
 * year plays out too (the turn does not move on after it, but its report is new). A year in which the player's
 * company went out does not: its people do not leave one by one, so the summary opens at once.
 */
export const yearPlaysOut = (
  before: { readonly log: object | null },
  after: { readonly log: object | null; readonly failure: Error | null; readonly playerOut: boolean },
): boolean => after.failure === null && after.log !== null && after.log !== before.log && !after.playerOut;

/**
 * Ends a year that plays out (its time is up, Skip, or the office went away): the new year is shown first, then the
 * world finishes at once whatever moves, the walks that new scene starts included, so nothing walks on after Skip.
 * Returns the play from then on: idle.
 */
export const finishYearPlay = (
  play: YearPlay,
  source: Pick<OfficeSource, "showBeat">,
  world: Pick<WorldHandle, "settle"> | null,
): YearPlay => {
  if (play.phase !== "playing") return play;
  source.showBeat(play.playback, null);
  world?.settle();
  return IDLE;
};
