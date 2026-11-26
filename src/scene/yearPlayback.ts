/**
 * A year playing out in the office, as beats read off the year's report (design 10.4): the people who left walk
 * out, the company moves to a bigger office, the hires walk in. Each beat has its length and the scene it shows.
 *
 * Pure, like the scene builder: the screen keeps the clock, and the world only draws the scenes it is given.
 */

import type { CompanyReport } from "../engine/index";
import type { OfficeIndex, OfficeScene, Team } from "../world/types/scene";

export type BeatKind = "leave" | "move" | "arrive" | "year" | "market";

export interface PlaybackBeat {
  readonly kind: BeatKind;
  readonly seconds: number;
  /** People leaving or arriving in this beat; 0 for a move or a quiet year. */
  readonly count: number;
  /** The office moved to, in a move; null otherwise. */
  readonly office: number | null;
}

export interface YearPlayback {
  readonly beats: readonly PlaybackBeat[];
  /** How long the whole year plays, at most `MAX_PLAYBACK_SECONDS`. */
  readonly seconds: number;
}

export const BEAT_SECONDS: Readonly<Record<BeatKind, number>> = {
  leave: 1.5,
  move: 2.5,
  arrive: 2.5,
  year: 1.2,
  market: 2,
};
export const MAX_PLAYBACK_SECONDS = 6;
export const NO_PLAYBACK: YearPlayback = { beats: [], seconds: 0 };
export const MARKET_BEAT_SECONDS = BEAT_SECONDS.market;

const beat = (kind: BeatKind, count: number, office: number | null = null): PlaybackBeat => ({
  kind,
  seconds: BEAT_SECONDS[kind],
  count,
  office,
});

/** The beats of the year a report tells, in order. Nothing plays under reduced motion or without a report. */
export const yearPlayback = (report: CompanyReport | null, reducedMotion: boolean): YearPlayback => {
  if (reducedMotion || report === null) return NO_PLAYBACK;
  const { laidOff, poachedOut, lostToEvent, hired, poachedIn } = report.headcount;
  const left = laidOff + poachedOut + lostToEvent;
  const came = hired + poachedIn;
  const moved = report.career?.office ?? null;

  const beats: PlaybackBeat[] = [];
  if (left > 0) beats.push(beat("leave", left));
  if (moved !== null && moved.to > moved.from) beats.push(beat("move", 0, moved.to));
  if (came > 0) beats.push(beat("arrive", came));
  if (beats.length === 0) beats.push(beat("year", 0));

  const seconds = Math.min(MAX_PLAYBACK_SECONDS, beats.reduce((sum, b) => sum + b.seconds, 0));
  return { beats, seconds };
};

/** The office's beats scaled into what MARKET_BEAT_SECONDS leaves of MAX_PLAYBACK_SECONDS, then the market's.
 *  No playback stays none. */
export const withMarket = (playback: YearPlayback): YearPlayback => {
  if (playback.beats.length === 0) return playback;
  const office = playback.beats.reduce((sum, b) => sum + b.seconds, 0);
  const k = office > 0 ? Math.min(1, (MAX_PLAYBACK_SECONDS - MARKET_BEAT_SECONDS) / office) : 1;
  const beats: PlaybackBeat[] = [...playback.beats.map((b) => ({ ...b, seconds: b.seconds * k })), beat("market", 0)];
  return { beats, seconds: Math.min(MAX_PLAYBACK_SECONDS, beats.reduce((sum, b) => sum + b.seconds, 0)) };
};

/** The same scene once the year has played out: next year's expected hires are not at the door yet. */
export const playedOut = (scene: OfficeScene): OfficeScene => ({ ...scene, arriving: 0 });

/** Ties go in this order. */
const TEAM_ORDER: readonly Team[] = ["product", "growth", "recruiting"];

/** The teams less `hires` people, taken one at a time from the largest team, never below none. */
const lessHires = (teams: OfficeScene["teams"], hires: number): OfficeScene["teams"] => {
  const left: Record<Team, number> = { ...teams };
  for (let i = 0; i < hires; i++) {
    let largest: Team = TEAM_ORDER[0];
    for (const team of TEAM_ORDER) if (left[team] > left[largest]) largest = team;
    if (left[largest] <= 0) break;
    left[largest] -= 1;
  }
  return left;
};

/** One scene per beat of `playback`, from the scene shown before the year ended to the new year's. */
export const beatScenes = (before: OfficeScene, after: OfficeScene, playback: YearPlayback): readonly OfficeScene[] => {
  if (playback.beats.length === 0) return [];
  const hires = playback.beats.find((b) => b.kind === "arrive")?.count ?? 0;
  const moves = playback.beats.some((b) => b.kind === "move");
  const waiting: OfficeScene = { ...after, away: 0, leaving: 0, arriving: hires, teams: lessHires(after.teams, hires) };
  const inOffice = (office: OfficeIndex, capacity: number): OfficeScene => ({ ...waiting, office, capacity });

  return playback.beats.map((b): OfficeScene => {
    switch (b.kind) {
      case "leave":
        return moves ? inOffice(before.office, before.capacity) : inOffice(after.office, after.capacity);
      case "move":
        return inOffice(after.office, after.capacity);
      case "arrive":
      case "year":
        return playedOut(after);
      case "market":
        // The office behind the market has played its year out.
        return playedOut(after);
    }
  });
};
