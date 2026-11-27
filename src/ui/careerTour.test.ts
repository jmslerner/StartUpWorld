import { describe, expect, it } from "vitest";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import {
  dockFor, nextStep, observeTour, readTourSeen, shouldStartTour, startTour, tabFor, TOUR_KEY, tourSteps, writeTourSeen,
  type TourState, type TourStepId, type TourWatch,
} from "./careerTour";

const watch = (patch: Partial<TourWatch> = {}): TourWatch => ({ turn: 1, allocation: { product: 3, growth: 0, recruiting: 0 }, marketing: 0, price: "standard", ...patch });
const steps = tourSteps(CAREER, { office: false });
const ids = steps.map((step) => step.id);
const at = (id: TourStepId): TourState => ({ index: ids.indexOf(id), since: watch() });

describe("the start tour's steps", () => {
  it("has seven steps in order, each but the last pointing at a control", () => {
    expect(ids).toEqual(["goal", "team", "money", "cash", "end", "report", "done"]);
    expect(steps.map((step) => step.target)).toEqual(["status", "team", "money", "cash", "end", "report", null]);
  });

  it("says the goal, how to hire, and takes its numbers from the config", () => {
    expect(steps[0].text).toMatch(/users/);
    expect(steps[0].text).toMatch(/go public/);
    expect(steps[0].text).toContain("2038");
    expect(steps[1].text).toContain("press + on Recruiting");
    expect(steps[1].text).toContain("$20K");
    expect(steps[1].text).toContain("next year");
    expect(steps[1].text).not.toContain("click a person");
    expect(tourSteps(CAREER, { office: true })[1].text).toContain("click a person, then another team");
    expect(steps[6].text).toContain("How to play");
  });

  it("speaks in years and plain words, and does not exist in a race", () => {
    const all = [...steps, ...tourSteps(CAREER, { office: true })].map((step) => `${step.title} ${step.text}`).join(" ");
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    expect(tourSteps(DESIGN, { office: false })).toEqual([]);
  });
});

describe("moving through the tour", () => {
  it("starts at the first step and moves on with Next, then finishes", () => {
    const later = watch({ marketing: 50_000 });
    expect(startTour(watch())).toEqual({ index: 0, since: watch() });
    expect(nextStep(at("goal"), later, steps)).toEqual({ index: 1, since: later });
    expect(nextStep(at("done"), later, steps)).toBe("finished");
  });

  it("moves on when the player does what the step asks", () => {
    const moved = watch({ allocation: { product: 2, growth: 0, recruiting: 1 } });
    expect(observeTour(at("team"), moved, steps)).toEqual({ index: ids.indexOf("money"), since: moved });
    const pricier = watch({ price: "premium" });
    expect(observeTour(at("money"), pricier, steps)).toEqual({ index: ids.indexOf("cash"), since: pricier });
    expect(observeTour(at("money"), watch({ marketing: 50_000 }), steps)).toMatchObject({ index: ids.indexOf("cash") });
    const played = watch({ turn: 2 });
    expect(observeTour(at("end"), played, steps)).toEqual({ index: ids.indexOf("report"), since: played });
  });

  it("waits on a step that asks only for Next", () => {
    for (const id of ["goal", "cash", "report", "done"] as const) {
      const state = at(id);
      expect(observeTour(state, watch({ marketing: 50_000, price: "budget" }), steps)).toBe(state);
    }
    const state = at("team");
    expect(observeTour(state, watch({ marketing: 50_000 }), steps)).toBe(state);
  });

  it("jumps to the report step when a year is played before the end step", () => {
    for (const id of ["goal", "team", "money", "cash"] as const) {
      expect(observeTour(at(id), watch({ turn: 2 }), steps)).toMatchObject({ index: ids.indexOf("report") });
    }
    const report = at("report");
    expect(observeTour({ ...report, since: watch({ turn: 2 }) }, watch({ turn: 3 }), steps)).toMatchObject({ index: ids.indexOf("report") });
  });

  it("starts by itself only in a first career's first year, before any report", () => {
    const first = { career: true, turn: 1, hasReport: false, seen: false };
    expect(shouldStartTour(first)).toBe(true);
    expect(shouldStartTour({ ...first, career: false })).toBe(false);
    expect(shouldStartTour({ ...first, turn: 2 })).toBe(false);
    expect(shouldStartTour({ ...first, hasReport: true })).toBe(false);
    expect(shouldStartTour({ ...first, seen: true })).toBe(false);
  });

  it("shows the plan tab for the plan's controls only", () => {
    expect(["status", "team", "money", "cash", "end", "report", null].map((t) => tabFor(t as never))).toEqual([null, "plan", "plan", null, null, null, null]);
  });
});

describe("where the card docks", () => {
  const phone = { viewport: 664, bar: 100, card: 160, fixed: false };
  it("docks on the side with more room and needs no scroll when it fits", () => {
    expect(dockFor({ ...phone, top: 100, bottom: 200 })).toEqual({ dock: "bottom", scroll: 0 });
    expect(dockFor({ ...phone, top: 400, bottom: 540 })).toEqual({ dock: "top", scroll: 0 });
  });

  it("scrolls the page so the card does not cover the target", () => {
    expect(dockFor({ ...phone, top: 150, bottom: 450 })).toEqual({ dock: "top", scroll: -30 });
    expect(dockFor({ ...phone, top: 100, bottom: 420 })).toEqual({ dock: "bottom", scroll: 36 });
  });

  it("never scrolls for a fixed target, such as the End bar", () => {
    expect(dockFor({ ...phone, top: 600, bottom: 650, fixed: true })).toEqual({ dock: "top", scroll: 0 });
  });
});

describe("remembering the tour", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  };
  it("is unseen in fresh storage, and seen once finished or skipped, under its own key only", () => {
    const storage = memory();
    expect(readTourSeen(storage)).toBe(false);
    writeTourSeen(storage, "skipped");
    expect([...storage.items.entries()]).toEqual([[TOUR_KEY, "skipped"]]);
    expect(readTourSeen(storage)).toBe(true);
    writeTourSeen(storage, "done");
    expect(storage.getItem(TOUR_KEY)).toBe("done");
  });

  it("reads missing or blocked storage as seen, and never throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readTourSeen(null)).toBe(true);
    expect(readTourSeen(blocked)).toBe(true);
    expect(() => writeTourSeen(blocked, "done")).not.toThrow();
    expect(() => writeTourSeen(null, "done")).not.toThrow();
  });
});
