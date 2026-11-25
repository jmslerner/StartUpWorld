import { describe, expect, it } from "vitest";
import { MAX_STAFF_DRAWN } from "../cast";
import { DESKS, getOfficeLayout } from "../office/layouts";
import type { OfficeIndex, OfficeScene } from "../types";
import { SceneFrames } from "./sceneFrames";

const scene = (teams: readonly [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "run",
  seed: 7,
  year: 1990,
  office: 1,
  capacity: 9,
  era: "any",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});

describe("SceneFrames: from a scene to the one frame every system is handed", () => {
  it("the first scene: the people, no events, nothing before it, the office's own plan, everyone seated", () => {
    const frames = new SceneFrames();
    expect(frames.last).toBeNull();
    expect(frames.layout).toBe(getOfficeLayout(0));
    const first = scene([3, 2, 1]);
    const staged = frames.stage(first);
    expect(staged.prev).toBeNull();
    expect(staged.newRun).toBe(false);
    expect(staged.next.scene).toBe(first);
    expect(staged.next.events).toEqual([]);
    expect(staged.next.cast.people.map((person) => person.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(staged.layout).toBe(getOfficeLayout(1));
    expect(frames.layout).toBe(staged.layout);
    expect(frames.last).toBe(staged.next);
    // The seating is already that of this frame when the frame is handed over.
    expect(frames.seating.currentLayout()).toBe(staged.layout);
    for (const person of staged.next.cast.people) expect(frames.seating.seatOf(person.id), person.id).not.toBeNull();
    expect(frames.seating.freeDeskSlots()).toHaveLength(DESKS[1] - 6);
  });

  it("a later scene: the frame before it, what changed, and the same people under the same ids", () => {
    const frames = new SceneFrames();
    const first = frames.stage(scene([3, 2, 1])).next;
    const staged = frames.stage(scene([4, 2, 1], { year: 1991, office: 2, capacity: 22 }));
    expect(staged.prev).toBe(first);
    expect(staged.newRun).toBe(false);
    expect(staged.next.events).toEqual([
      { kind: "year-advanced", from: 1990, to: 1991 },
      { kind: "office-changed", from: 1, to: 2 },
    ]);
    expect(staged.next.cast.people.map((person) => person.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(staged.next.cast.arrived).toEqual(["p6"]);
    expect(staged.layout).toBe(getOfficeLayout(2));
    expect(frames.seating.currentLayout()).toBe(getOfficeLayout(2));
    expect(frames.seating.seatOf("p6")).not.toBeNull();
  });

  it("the same scene again changes nothing and reports nothing", () => {
    const frames = new SceneFrames();
    const same = scene([3, 2, 1], { arriving: 2 });
    const first = frames.stage(same);
    const again = frames.stage({ ...same });
    expect(again.prev).toBe(first.next);
    expect(again.next.events).toEqual([]);
    expect([again.next.cast.arrived, again.next.cast.left]).toEqual([[], []]);
    expect(again.next.cast.people).toEqual(first.next.cast.people);
    expect(again.layout).toBe(first.layout);
    expect(frames.seating.lastChanges()).toEqual([]);
  });

  it("an office index out of range shows the garage, and throws nothing", () => {
    for (const office of [5, 9, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined]) {
      const frames = new SceneFrames();
      const staged = frames.stage(scene([1, 1, 0], { office: office as OfficeIndex }));
      expect(staged.layout, String(office)).toBe(getOfficeLayout(0));
      expect(frames.seating.currentLayout(), String(office)).toBe(getOfficeLayout(0));
      expect(frames.seating.seatOf("p0"), String(office)).not.toBeNull();
    }
    // And each of the five gives its own.
    for (const office of [0, 1, 2, 3, 4] as const) {
      expect(new SceneFrames().stage(scene([1, 0, 0], { office })).layout.deskSeats).toHaveLength(DESKS[office]);
    }
  });

  it("another run is a first scene again: nothing before it, no events, ids from the start, the seating forgotten", () => {
    const frames = new SceneFrames();
    frames.stage(scene([3, 2, 1]));
    frames.stage(scene([5, 2, 1], { year: 1991 }));
    const staged = frames.stage(scene([2, 0, 0], { runId: "another", year: 1995 }));
    expect(staged.newRun).toBe(true);
    expect(staged.prev).toBeNull();
    expect(staged.next.events).toEqual([]);
    expect(staged.next.cast.people.map((person) => person.id)).toEqual(["p0", "p1"]);
    expect(frames.seating.lastChanges().every((change) => change.from === null)).toBe(true);
    expect(frames.seating.lastChanges().map((change) => change.personId)).toEqual(["p0", "p1"]);
    // The scene after it follows on from it as usual.
    const after = frames.stage(scene([3, 0, 0], { runId: "another", year: 1996 }));
    expect(after.newRun).toBe(false);
    expect(after.prev).toBe(staged.next);
    expect(after.next.events).toEqual([{ kind: "year-advanced", from: 1995, to: 1996 }]);
  });

  it("says so before another run replaces the old one: the old plan and the old seats are still there to take down", () => {
    const frames = new SceneFrames();
    frames.stage(scene([3, 2, 1], { office: 2, capacity: 22 }), () => {
      throw new Error("a first scene is not another run");
    });
    frames.stage(scene([4, 2, 1], { office: 2, capacity: 22, year: 1991 }), () => {
      throw new Error("a later year is not another run");
    });
    const seen: unknown[] = [];
    const staged = frames.stage(scene([1, 0, 0], { runId: "another" }), () => {
      seen.push(frames.layout, frames.seating.currentLayout(), frames.seating.seatOf("p6") !== null);
    });
    expect(seen).toEqual([getOfficeLayout(2), getOfficeLayout(2), true]);
    expect(staged.layout).toBe(getOfficeLayout(1));
    expect(frames.seating.seatOf("p6")).toBeNull();

    // A take-down that throws is reported, and the new run is staged all the same.
    const faults: string[] = [];
    const faulty = new SceneFrames((label) => faults.push(label));
    faulty.stage(scene([1, 0, 0]));
    const next = faulty.stage(scene([2, 0, 0], { runId: "another" }), () => {
      throw new Error("could not take it down");
    });
    expect(faults).toEqual(["newRun"]);
    expect([next.newRun, next.prev, next.next.cast.people.length]).toEqual([true, null, 2]);
  });

  it("an earlier year is another run too", () => {
    const frames = new SceneFrames();
    frames.stage(scene([3, 2, 1], { year: 1995 }));
    const staged = frames.stage(scene([3, 2, 1], { year: 1994 }));
    expect([staged.newRun, staged.prev, staged.next.events]).toEqual([true, null, []]);
  });

  it("150 people: 50 in the cast, 100 on the sign, and the seating says so before any system is told", () => {
    const frames = new SceneFrames();
    const staged = frames.stage(scene([75, 60, 15], { office: 4, capacity: 150 }));
    expect(staged.next.cast.people).toHaveLength(MAX_STAFF_DRAWN);
    expect(staged.next.cast.hidden).toBe(100);
    expect(frames.seating.hiddenCount()).toBe(100);
    expect(frames.seating.freeDeskSlots()).toEqual([]);
  });

  it("a fault in the seating is reported and the frame is still made", () => {
    const faults: string[] = [];
    const frames = new SceneFrames((label) => faults.push(label));
    frames.seating.reconcile = () => {
      throw new Error("no seats today");
    };
    const staged = frames.stage(scene([3, 2, 1]));
    expect(faults).toEqual(["seating.reconcile"]);
    expect(staged.next.cast.people).toHaveLength(6);
    expect(staged.layout).toBe(getOfficeLayout(1));
  });

  it("cleared, it starts from nothing", () => {
    const frames = new SceneFrames();
    frames.stage(scene([3, 2, 1], { office: 2, capacity: 22 }));
    frames.clear();
    expect(frames.last).toBeNull();
    expect(frames.seating.currentLayout()).toBeNull();
    expect(frames.seating.hiddenCount()).toBe(0);
    const staged = frames.stage(scene([1, 0, 0]));
    expect([staged.prev, staged.newRun]).toEqual([null, false]);
  });
});
