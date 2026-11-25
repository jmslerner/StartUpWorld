import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { changedNumbers, formatChanges } from "./changes";
import { applyOverrides } from "./overrides";

/** A copy of the design's numbers that a test may edit in place. */
const editable = <T>(): T => structuredClone(DESIGN) as unknown as T;

describe("changedNumbers", () => {
  it("finds nothing between a config and itself", () => {
    expect(changedNumbers(DESIGN, structuredClone(DESIGN))).toEqual([]);
  });

  it("names each changed number by its path, with the value before and after", () => {
    const tuned = applyOverrides(DESIGN, { salary: 30_000, "archetypes.startup.cash": 1_000_000, "cpu.personalities.incumbent.weights.quality": 2 });
    expect(changedNumbers(DESIGN, tuned)).toEqual([
      { path: "archetypes.startup.cash", start: 500_000, now: 1_000_000 },
      { path: "salary", start: 40_000, now: 30_000 },
      { path: "cpu.personalities.incumbent.weights.quality", start: 2.5, now: 2 },
    ]);
  });

  it("reports a changed text setting the same way", () => {
    const tuned = applyOverrides(DESIGN, { "baseline.price": "budget" });
    expect(changedNumbers(DESIGN, tuned)).toEqual([{ path: "baseline.price", start: "standard", now: "budget" }]);
  });

  it("reports a list of numbers as one change, even when its length changes", () => {
    const tuned = editable<{ cpu: { personalities: { blitzscaler: { marketingShares: number[] } } }; raise: { options: number[] } }>();
    tuned.cpu.personalities.blitzscaler.marketingShares = [0, 0.05, 0.1];
    tuned.raise.options[1] = 25;
    expect(changedNumbers(DESIGN, tuned)).toEqual([
      { path: "raise.options", start: [10, 20, 30], now: [10, 25, 30] },
      { path: "cpu.personalities.blitzscaler.marketingShares", start: [0, 0.1, 0.2, 0.35, 0.5], now: [0, 0.05, 0.1] },
    ]);
  });

  it("matches event cards by id, so a changed card is named and the rest stay quiet", () => {
    const tuned = editable<{ events: { deck: { id: string; weight: number }[] } }>();
    tuned.events.deck.reverse();
    tuned.events.deck.find((card) => card.id === "viral-moment")!.weight = 3;
    expect(changedNumbers(DESIGN, tuned)).toEqual([{ path: "events.deck.viral-moment.weight", start: 1, now: 3 }]);
  });

  it("reports a card that was added or removed", () => {
    const tuned = editable<{ events: { deck: { id: string }[] } }>();
    const removed = tuned.events.deck.shift()!;
    tuned.events.deck.push({ ...removed, id: "brand-new" });
    const changes = changedNumbers(DESIGN, tuned);
    expect(changes.map((change) => change.path)).toEqual([`events.deck.${removed.id}`, "events.deck.brand-new"]);
    expect(changes[0].now).toBeUndefined();
    expect(changes[1].start).toBeUndefined();
  });

  it("reports a number that exists on one side only", () => {
    expect(changedNumbers({ a: 1, b: { c: 2 } }, { a: 1, b: {}, d: 4 })).toEqual([
      { path: "b.c", start: 2, now: undefined },
      { path: "d", start: undefined, now: 4 },
    ]);
  });
});

describe("formatChanges", () => {
  it("says so when nothing changed", () => {
    expect(formatChanges([])).toBe("Numbers changed from the design's starting values: none.");
  });

  it("prints one aligned line per number, start then now", () => {
    const text = formatChanges([
      { path: "archetypes.startup.cash", start: 500_000, now: 1_000_000 },
      { path: "churn.base", start: 0.12, now: 0.1 },
      { path: "raise.options", start: [10, 20, 30], now: [10, 25, 30] },
      { path: "events.deck.brand-new", start: undefined, now: { id: "brand-new" } },
    ]);
    expect(text.split("\n")).toEqual([
      "Numbers changed from the design's starting values: 4",
      "  archetypes.startup.cash  500,000 -> 1,000,000",
      "  churn.base               0.12 -> 0.1",
      "  raise.options            10, 20, 30 -> 10, 25, 30",
      "  events.deck.brand-new    (not there) -> added",
    ]);
  });

  it("prints a setting that is switched off as 'off', not as something added or removed", () => {
    // poachRunway: null means that rival never poaches.
    const text = formatChanges([
      { path: "cpu.personalities.blitzscaler.poachRunway", start: null, now: 2 },
      { path: "cpu.personalities.incumbent.poachRunway", start: 3, now: null },
      { path: "events.deck.old-card", start: { id: "old-card" }, now: undefined },
    ]);
    expect(text.split("\n").slice(1)).toEqual([
      "  cpu.personalities.blitzscaler.poachRunway  off -> 2",
      "  cpu.personalities.incumbent.poachRunway    3 -> off",
      "  events.deck.old-card                       (was there) -> (not there)",
    ]);
  });
});

describe("applyOverrides", () => {
  it("gives a number to a setting that is switched off", () => {
    expect(DESIGN.cpu.personalities.blitzscaler.poachRunway).toBeNull();
    const poaching = applyOverrides(DESIGN, { "cpu.personalities.blitzscaler.poachRunway": 3 });
    expect(poaching.cpu.personalities.blitzscaler.poachRunway).toBe(3);
    expect(changedNumbers(DESIGN, poaching)).toEqual([{ path: "cpu.personalities.blitzscaler.poachRunway", start: null, now: 3 }]);
  });

  it("still refuses a value of the wrong kind, a missing number and a whole section", () => {
    expect(() => applyOverrides(DESIGN, { salary: "lots" })).toThrow(/salary is a number/);
    expect(() => applyOverrides(DESIGN, { "cpu.personalities.blitzscaler.poachRunway": "soon" })).toThrow(/poachRunway takes a number/);
    expect(() => applyOverrides(DESIGN, { "ipo.user": 1 })).toThrow(/No such config number: ipo\.user/);
    expect(() => applyOverrides(DESIGN, { "cpu.personalities.incumbent": 1 })).toThrow(/not a single value/);
  });
});
