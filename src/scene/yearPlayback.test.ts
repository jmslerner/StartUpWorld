import { describe, expect, it } from "vitest";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { resolveTurn } from "../engine/index";
import type { CompanyId, CompanyReport, GameState } from "../engine/index";
import type { OfficeScene } from "../world/types/scene";
import { officeSceneFor } from "./officeScene";
import type { OfficeSceneInput } from "./officeScene";
import { NO_PLAYBACK, beatScenes, playedOut, yearPlayback } from "./yearPlayback";

const sceneOf = (game: GameState, companyId: CompanyId, extra: Partial<OfficeSceneInput> = {}) =>
  officeSceneFor({ game, companyId, config: CAREER_TEST, seed: 7, ...extra });

const reportOf = (patch: { headcount?: Partial<CompanyReport["headcount"]>; office?: { from: number; to: number; bill: number } | null }): CompanyReport => {
  const game = newCareer();
  const base = resolveTurn(game, game.companies.map(() => null), 11, CAREER_TEST).log.companies[0]!;
  return {
    ...base,
    headcount: { ...base.headcount, laidOff: 0, poachedOut: 0, lostToEvent: 0, hired: 0, poachedIn: 0, ...patch.headcount },
    career: { ...base.career!, office: patch.office ?? null },
  };
};

const at = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene =>
  ({ ...sceneOf(newCareer(), 0), teams: { product: teams[0], growth: teams[1], recruiting: teams[2] }, ...patch });

describe("a year playing out", () => {
  it("a quiet year is one short beat", () => {
    expect(yearPlayback(reportOf({}), false)).toEqual({ beats: [{ kind: "year", seconds: 1.2, count: 0, office: null }], seconds: 1.2 });
  });

  it("people leave, then hires walk in", () => {
    expect(yearPlayback(reportOf({ headcount: { laidOff: 1, poachedOut: 1, hired: 2, poachedIn: 1 } }), false)).toEqual({
      beats: [{ kind: "leave", seconds: 1.5, count: 2, office: null }, { kind: "arrive", seconds: 2.5, count: 3, office: null }],
      seconds: 4,
    });
  });

  it("a move comes between, and the whole is held to six seconds", () => {
    const play = yearPlayback(reportOf({ headcount: { lostToEvent: 1, hired: 4 }, office: { from: 0, to: 1, bill: 1 } }), false);
    expect(play.beats.map((b) => [b.kind, b.count, b.office])).toEqual([["leave", 1, null], ["move", 0, 1], ["arrive", 4, null]]);
    expect(play.seconds).toBe(6);
  });

  it("nothing plays under reduced motion, or for a company with no report", () => {
    expect(yearPlayback(reportOf({ headcount: { hired: 3 } }), true)).toEqual(NO_PLAYBACK);
    expect(yearPlayback(null, false)).toEqual(NO_PLAYBACK);
  });

  it("the played-out scene keeps everything but the hires expected next", () => {
    const scene = sceneOf(newCareer(), 0, { expectedHires: 2 });
    expect(playedOut(scene)).toEqual({ ...scene, arriving: 0 });
    expect(scene.arriving).toBe(2);
  });

  it("people leave while the year's hires wait at the door, the company moves, then the hires walk in (design 10.4)", () => {
    const before = at([3, 0, 0], { year: 1994, office: 0, capacity: 4 });
    const after = at([3, 2, 1], { year: 1995, office: 1, capacity: 9, arriving: 2, era: "gold-rush" });
    const play = yearPlayback(reportOf({ headcount: { laidOff: 1, hired: 3 }, office: { from: 0, to: 1, bill: 1 } }), false);
    const [leave, move, arrive] = beatScenes(before, after, play);
    expect([leave.office, leave.capacity, leave.teams, leave.arriving, leave.year, leave.era]).toEqual([
      0, 4, { product: 1, growth: 1, recruiting: 1 }, 3, 1995, "gold-rush",
    ]);
    expect(move).toEqual({ ...leave, office: 1, capacity: 9 });
    expect(arrive).toEqual({ ...after, arriving: 0 });
    expect(beatScenes(before, after, play)).toHaveLength(play.beats.length);
  });

  it("a quiet year shows the new year played out; no playback shows nothing", () => {
    const before = at([2, 1, 0]);
    const after = at([2, 1, 0], { year: 1991, arriving: 1 });
    expect(beatScenes(before, after, yearPlayback(reportOf({}), false))).toEqual([{ ...after, arriving: 0 }]);
    expect(beatScenes(before, after, NO_PLAYBACK)).toEqual([]);
  });

  it("without a move, people leave in the office they are in, and hires never take a team below none", () => {
    const before = at([1, 0, 0]);
    const after = at([1, 0, 1], { year: 1991 });
    const [leave] = beatScenes(before, after, yearPlayback(reportOf({ headcount: { poachedOut: 1, hired: 3 } }), false));
    expect([leave.office, leave.teams, leave.arriving]).toEqual([after.office, { product: 0, growth: 0, recruiting: 0 }, 3]);
  });
});
