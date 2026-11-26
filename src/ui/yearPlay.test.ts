import { describe, expect, it } from "vitest";
import { NO_PLAYBACK, type PlaybackBeat, type YearPlayback } from "../scene/yearPlayback";
import { beatIndexNow, beatNow, endRefused, finishYearPlay, IDLE, startYearPlay, yearEnded, yearPlayAfterLoss, yearPlayDone } from "./yearPlay";

const playback = (seconds: number, beats: PlaybackBeat[]): YearPlayback => ({ beats, seconds });
const leave = { kind: "leave", seconds: 1.5, count: 2, office: null } as const;
const arrive = { kind: "arrive", seconds: 2.5, count: 3, office: null } as const;

describe("a year playing out", () => {
  it("plays a year from now for its length", () => {
    const p = playback(4, [leave, arrive]);
    expect(startYearPlay(IDLE, p, 1994, 1000)).toEqual({ phase: "playing", year: 1994, playback: p, startedMs: 1000, endsMs: 5000 });
  });
  it("names the beat on screen at each moment, and its index", () => {
    const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
    expect([beatNow(play, 1000), beatNow(play, 2499), beatNow(play, 2500), beatNow(play, 4999), beatNow(play, 5000)]).toEqual([leave, leave, arrive, arrive, null]);
    expect([beatIndexNow(play, 1000), beatIndexNow(play, 2500), beatIndexNow(play, 5000), beatIndexNow(IDLE, 0)]).toEqual([0, 1, null, null]);
    expect([yearPlayDone(play, 4999), yearPlayDone(play, 5000), yearPlayDone(IDLE, 0)]).toEqual([false, true, true]);
  });
  it("a year with nothing to play does not start", () => {
    expect(startYearPlay(IDLE, NO_PLAYBACK, 1994, 0)).toBe(IDLE);
  });
  it("a second start while a year plays changes nothing (Review Focus 1)", () => {
    const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
    expect(startYearPlay(play, playback(1.2, [{ kind: "year", seconds: 1.2, count: 0, office: null }]), 1995, 2000)).toBe(play);
  });
  it("End is refused while a year plays out or a report is open, before the year is ended (Review Focus 1)", () => {
    const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
    expect([endRefused(IDLE, false), endRefused(play, false), endRefused(IDLE, true), endRefused(play, true)]).toEqual([false, true, true, true]);
  });
  it("plays a year only when it really ended: one turn on, and no failure (Review Focus 1)", () => {
    expect(yearEnded(5, { turn: 6, failure: null })).toBe(true);
    expect(yearEnded(5, { turn: 5, failure: null })).toBe(false); // over, or nothing happened: last year must not replay
    expect(yearEnded(5, { turn: 5, failure: new Error("x") })).toBe(false);
    expect(yearEnded(5, { turn: 7, failure: null })).toBe(false);
    expect(yearEnded(5, { turn: null, failure: null })).toBe(false);
  });
  it("a beat list held to six seconds ends at six seconds, whatever its beats add up to", () => {
    const play = startYearPlay(IDLE, playback(6, [leave, { kind: "move", seconds: 2.5, count: 0, office: 1 }, arrive]), 2001, 0);
    expect([beatNow(play, 5999)?.kind, beatIndexNow(play, 5999), yearPlayDone(play, 6000)]).toEqual(["arrive", 2, true]);
  });
  it("an office that stops drawing ends the year at once (Review Focus 2)", () => {
    const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
    expect((["running", "context-lost", "failed", "unsupported", "unknown"] as const).map((a) => yearPlayAfterLoss(play, a) === IDLE)).toEqual([false, true, true, true, true]);
  });
});

describe("finishing a year that plays out", () => {
  it("shows the new year first, then tells the world to finish at once, so nothing walks on after Skip", () => {
    const calls: string[] = [];
    const p = playback(4, [leave, arrive]);
    const play = startYearPlay(IDLE, p, 1994, 1000);
    const source = { showBeat: (shown: YearPlayback, index: number | null) => calls.push(`show ${shown === p ? "playback" : "other"} ${index}`) };
    const world = { settle: () => calls.push("settle") };
    expect(finishYearPlay(play, source, world)).toBe(IDLE);
    expect(calls).toEqual(["show playback null", "settle"]);
  });
  it("does nothing when no year plays out, and needs no world", () => {
    const calls: string[] = [];
    const source = { showBeat: () => calls.push("show") };
    expect(finishYearPlay(IDLE, source, { settle: () => calls.push("settle") })).toBe(IDLE);
    expect(calls).toEqual([]);
    const play = startYearPlay(IDLE, playback(4, [leave]), 1994, 0);
    expect(finishYearPlay(play, source, null)).toBe(IDLE);
    expect(calls).toEqual(["show"]);
  });
});
