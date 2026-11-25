import { describe, expect, it } from "vitest";
import { sceneEvents } from "./sceneEvents";
import type { OfficeScene } from "./types";

const scene = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "r",
  seed: 7,
  year: 1990,
  office: 0,
  capacity: 4,
  era: "dial-up",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});

describe("what changed between two scenes", () => {
  it("the first scene has no events", () => {
    expect(sceneEvents(null, scene([3, 0, 0]))).toEqual([]);
  });

  it("a changed plan within the year is no event", () => {
    expect(sceneEvents(scene([3, 0, 0]), scene([2, 1, 0]))).toEqual([]);
  });

  it("a year, a move and an ending come in that order", () => {
    expect(sceneEvents(scene([3, 0, 0]), scene([5, 0, 0], { year: 1991, office: 1, capacity: 9, ending: "lost" }))).toEqual([
      { kind: "year-advanced", from: 1990, to: 1991 },
      { kind: "office-changed", from: 0, to: 1 },
      { kind: "ended", ending: "lost" },
    ]);
  });

  it("another run, or an earlier year, is a reset and nothing else", () => {
    expect(sceneEvents(scene([3, 0, 0]), scene([3, 0, 0], { runId: "other", office: 2 }))).toEqual([{ kind: "run-reset" }]);
    expect(sceneEvents(scene([3, 0, 0], { year: 1995 }), scene([3, 0, 0], { year: 1990 }))).toEqual([{ kind: "run-reset" }]);
  });

  it("an ending is reported once", () => {
    expect(sceneEvents(scene([3, 0, 0], { ending: "won" }), scene([3, 0, 0], { ending: "won" }))).toEqual([]);
  });

  it("each change is reported by itself, a move down included", () => {
    expect(sceneEvents(scene([3, 0, 0]), scene([3, 0, 0], { year: 1993 }))).toEqual([{ kind: "year-advanced", from: 1990, to: 1993 }]);
    expect(sceneEvents(scene([3, 0, 0], { office: 3 }), scene([3, 0, 0], { office: 2 }))).toEqual([{ kind: "office-changed", from: 3, to: 2 }]);
    expect(sceneEvents(scene([3, 0, 0]), scene([3, 0, 0], { ending: "won" }))).toEqual([{ kind: "ended", ending: "won" }]);
  });

  it("a reset says nothing of the ending the new run already has", () => {
    expect(sceneEvents(scene([3, 0, 0]), scene([3, 0, 0], { runId: "other", ending: "lost" }))).toEqual([{ kind: "run-reset" }]);
  });
});
