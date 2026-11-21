import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { computeContext } from "../context";
import { generateHints } from "../hints";
import { makeState } from "../testHelpers";
import { setProduct } from "../tycoon/roster";
import { describeBuild, forecastOf, listBuilds, projectHints, productSummary, projectsStatusLine, startOptions } from "./index";
import { build, person, run, shop, staffed, texts } from "./testkit";
import { qualityOf } from "./work";

describe("view selectors (§9.1)", () => {
  it("accept a legacy state: empty lists, a tidy puddle, one slot", () => {
    const s = makeState();
    expect(listBuilds(s)).toEqual([]);
    expect(describeBuild(s, "atlas")).toBeNull();
    expect(productSummary(s)).toEqual({ cruft: 0, cruftWord: "tidy", moat: 0, moatWord: "a puddle", slots: 1, slotsUsed: 0, shippedCount: 0, recent: [] });
    expect(startOptions(s).slotsFree).toBe(1);
  });

  it("listBuilds / describeBuild: every fact the board shows, by id, slug or unique prefix", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 5.5, qPts: 5.5, qSum: 5.5 * 69, crunch: true, crunchWeeks: 2, startedWeek: 3, dueWeek: 6, surprises: 1, polish: 0 });
    const s = shop({ roster: staffed([person(1), person(2, { craft: 5 })], "b1"), builds: [b], week: 8 });
    const facts = listBuilds(s)[0];
    expect(facts).toEqual({
      id: "b1", name: "Phoenix", slug: "phoenix", type: "feature", typeLabel: "Feature", size: "m", sizeLabel: "M",
      pct: 45, progress: 5.5, scope: 12, surprises: 1, polish: 0, quality: qualityOf(s, b), crunch: true, crunchWeeks: 2, startedWeek: 3,
      dueWeek: 6, weeksLate: 2, built: false, seats: 3, staffIds: ["e1", "e2"], leadId: "e2", forecast: forecastOf(s, b),
    });
    expect(describeBuild(s, "b1")).toEqual(facts);
    expect(describeBuild(s, "phoenix")).toEqual(facts);
    expect(describeBuild(s, "ph")).toEqual(facts);
    expect(describeBuild(s, "p")).toBeNull();
    expect(describeBuild(s, "atlas")).toBeNull();
  });

  it("productSummary: words by band, slots by phase, the release log", () => {
    const release = { id: "b1", name: "Plan B", type: "feature" as const, size: "m" as const, week: 26, reception: 76, tier: "solid" as const, quality: 70, leadName: null };
    const s = setProduct(shop({ companyPhase: "office", builds: [build()] }), { cruft: 36, moat: 25, shipped: [release], shippedCount: 4 });
    expect(productSummary(s)).toEqual({
      cruft: 36, cruftWord: "held together with tape", moat: 25, moatWord: "an actual moat", slots: 2, slotsUsed: 1, shippedCount: 4, recent: [release],
    });
    expect(productSummary(setProduct(shop(), { cruft: 60, moat: 50 }))).toMatchObject({ cruftWord: "structural tape", moatWord: "a moat with alligators" });
    expect(productSummary(setProduct(shop(), { cruft: 15, moat: 10 }))).toMatchObject({ cruftWord: "lived-in", moatWord: "a respectable ditch" });
  });

  it("startOptions: 20 options, locked reasons naming the phase that unlocks it, inflated scopes, free slots", () => {
    const s = setProduct(shop(), { shippedByType: { feature: 2, growth: 0, premium: 0, plumbing: 0, moonshot: 0 } });
    const { slotsFree, options } = startOptions(s);
    expect(slotsFree).toBe(1);
    expect(options).toHaveLength(20);
    const find = (type: string, size: string) => options.find((o) => o.type === type && o.size === size);
    expect(find("feature", "m")).toEqual({ type: "feature", size: "m", unlocked: true, lockedReason: null, scope: 15.6, kickoff: 2000, seats: 3 });
    expect(find("premium", "s")).toMatchObject({ unlocked: false, lockedReason: "needs the coworking phase" });
    expect(find("moonshot", "l")).toMatchObject({ unlocked: false, lockedReason: "needs the office phase" });
    expect(find("feature", "xl")).toMatchObject({ unlocked: false, lockedReason: "needs the office phase", kickoff: 30000, seats: 7 });
    expect(startOptions(shop({ builds: [build()] })).slotsFree).toBe(0);
  });
});

describe("status line (§4.9)", () => {
  it("is null until anything was ever built", () => {
    expect(projectsStatusLine(makeState())).toBeNull();
    expect(projectsStatusLine(shop())).toBeNull();
  });

  it("names what is building, then what was shipped, cruft and moat", () => {
    const s = setProduct(shop({ builds: [build({ name: "Phoenix", progress: 5.6 })] }), { shippedCount: 4, cruft: 8.7, moat: 9.8 });
    expect(projectsStatusLine(s)).toBe("Product: building Phoenix 46% | Shipped 4 | Cruft 8.7/100 | Moat 9.8/100");
    expect(projectsStatusLine(setProduct(shop(), { moat: 1.2 }))).toBe("Product: nothing in the works | Shipped 0 | Cruft 0/100 | Moat 1.2/100");
    const out = texts(run(s, "status"))[0];
    expect(out).toContain("\nProduct: building Phoenix 46% | Shipped 4");
  });
});

describe("hints (§7.1)", () => {
  const hintsOf = (s: GameState) => projectHints(s).map((h) => [h.priority, h.text]);

  it("are empty for a legacy state and an unengaged one", () => {
    expect(projectHints(makeState())).toEqual([]);
    expect(projectHints(shop({ roster: [person(1)] }))).toEqual([]);
  });

  it("built (4), past due (7), cruft >= 40 (6), free seats with idle people (5), nobody on it (5)", () => {
    // ERRATA 70: the built tip repeats the build line, so it ranks below every legacy warning of priority 5+ (morale, reputation…).
    expect(hintsOf(shop({ builds: [build({ progress: 12 })] }))).toEqual([[4, "Tip: Atlas is built. `ship atlas` — or keep polishing until week 6."]]);
    expect(hintsOf(shop({ builds: [build()], week: 7, roster: staffed([person(1)], "b1") })))
      .toEqual([[7, "Tip: Atlas is past its date (-3 reception a week). Crunch it, ship it early, or cancel it."]]);
    expect(hintsOf(setProduct(shop(), { cruft: 46 })))
      .toEqual([[6, "Warning: Cruft is 46/100. Users leak and releases land softer. `build plumbing` pays it down properly."]]);
    expect(hintsOf(shop({ builds: [build()], roster: [...staffed([person(1)], "b1"), person(2)] })))
      .toEqual([[5, "Tip: Atlas has 2 empty seat(s) of 3 and people who could fill them. `staff atlas auto`."]]);
    expect(hintsOf(shop({ builds: [build()], roster: [person(1, { role: "hr" })] })))
      .toEqual([[5, "Tip: nobody is on Atlas. It is currently a slide. `staff atlas <name>`."]]);
  });

  it("a built build no longer hides a legacy morale warning (review: s7-hints)", () => {
    const s = shop({ builds: [build({ progress: 12 })], culture: { cohesion: 60, morale: 25 } });
    expect(generateHints(s, computeContext(s))[0].text).toBe("Tip: Morale is crashing. High stress and rapid hiring can erode culture.");
  });

  it("reach generateHints", () => {
    const s = shop({ builds: [build({ progress: 12 })] });
    expect(generateHints(s, computeContext(s)).some((h) => h.text.startsWith("Tip: Atlas is built."))).toBe(true);
  });
});
