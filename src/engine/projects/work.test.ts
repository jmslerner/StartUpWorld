import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { setProduct } from "../tycoon/roster";
import { SIZES } from "./constants";
import { scoreRelease } from "./release";
import { build, person, shop, staffed } from "./testkit";
import {
  completeness, etaWeeks, fitOf, forecastOf, forecastText, founderHands, kickoffEta, kickoffEtaWith, luckAmplitude, payMultiplier, pct, personPoints, qualityOf,
  receptionBase, scopeFor, stressPenalty, teamQualityNow, tierOf, weekOutput, windowWeeks,
} from "./work";

// Worked example B (§5.8): Lotte (3/3 cowboy → craftLevel 2 → craftScore 40) and Mei (3/3 → 55), hacker + operator, garage.
const onboarding = build({ id: "b1", name: "onboarding", slug: "onboarding", size: "s", units: 1, baseScope: 5, scope: 5, dueWeek: 5 });
const exampleB = (overrides: Partial<GameState> = {}): GameState =>
  shop({
    roster: staffed([person(1, { quirk: "cowboy" }), person(2)], "b1", 1),
    builds: [onboarding],
    culture: { cohesion: 78, morale: 70 },
    pricingModel: "prosumer",
    ...overrides,
  });

describe("one week of work (§5.4, worked example B)", () => {
  it("week 1, both ramping: 2.466 points at quality 52.94", () => {
    const out = weekOutput(exampleB(), onboarding, 1);
    expect(out.hands).toBeCloseTo(1.15, 10);
    expect(out.points).toBeCloseTo(2.275 * (0.85 + 0.3 * 0.78), 10);
    expect(out.points).toBeCloseTo(2.466, 3);
    expect(out.quality).toBeCloseTo(52.94, 2);
    expect(out.lead?.id).toBe("e2");
  });

  it("week 2 (cohesion 76, nobody ramping): 3.665 points at quality 52.24", () => {
    const s = exampleB({ culture: { cohesion: 76, morale: 70 } });
    const out = weekOutput(s, onboarding, 2);
    expect(out.points).toBeCloseTo(3.4 * 1.078, 10);
    expect(out.points).toBeCloseTo(3.665, 3);
    expect(out.quality).toBeCloseTo(52.24, 2);
    expect(teamQualityNow(s, onboarding)).toBeCloseTo(52.24, 2);
  });

  it("kickoff estimate: ETA 2 (first week 2.47, steady 3.69) → due week 5", () => {
    const s = exampleB({ culture: { cohesion: 78, morale: 70 } });
    expect(weekOutput(s, onboarding, s.week).points).toBeCloseTo(2.466, 2);
    expect(weekOutput(s, onboarding, -1).points).toBeCloseTo(3.4 * 1.084, 10);
    expect(etaWeeks(s, onboarding)).toBe(2);
    expect(s.week + windowWeeks(s, onboarding)).toBe(5);
  });

  it("ramp-up: a person counts half in the week they joined, never otherwise", () => {
    const e = { ...person(1), buildId: "b1", joinedWeek: 4 };
    expect(personPoints(e, onboarding, 4)).toBe(0.5);
    expect(personPoints(e, onboarding, 5)).toBe(1);
    expect(personPoints(e, onboarding, -1)).toBe(1);
  });

  it("pace, fit, energy and quirk speeds multiply", () => {
    const b = build({ type: "feature" });
    expect(personPoints(person(1, { pace: 5 }), b, -1)).toBeCloseTo(1.4, 10);
    expect(personPoints(person(1, { pace: 1 }), b, -1)).toBeCloseTo(0.6, 10);
    expect(personPoints(person(1, { role: "data" }), b, -1)).toBeCloseTo(0.5, 10);
    expect(personPoints(person(1, { role: "hr" }), b, -1)).toBe(0);
    expect(personPoints(person(1, { energy: 30 }), b, -1)).toBeCloseTo(0.8, 10);
    expect(personPoints(person(1, { quirk: "cowboy" }), b, -1)).toBeCloseTo(1.25, 10);
    expect(personPoints(person(1, { quirk: "craftsperson" }), b, -1)).toBeCloseTo(0.9, 10);
  });

  it("glue lifts a build by 10% once, however many glue people are on it", () => {
    const b = build();
    const base = { builds: [b], team: { ...shop().team, engineering: 20 } }; // > 10 heads: no founders' hands
    const plain = shop({ ...base, roster: staffed([person(1), person(2)], "b1") });
    const oneGlue = shop({ ...base, roster: staffed([person(1, { quirk: "glue" }), person(2)], "b1") });
    const twoGlue = shop({ ...base, roster: staffed([person(1, { quirk: "glue" }), person(2, { quirk: "glue" })], "b1") });
    const p = weekOutput(plain, b, -1).points;
    expect(weekOutput(oneGlue, b, -1).points).toBeCloseTo(p * 1.1, 10);
    expect(weekOutput(twoGlue, b, -1).points).toBeCloseTo(p * 1.1, 10);
  });

  it("teamwork runs from 0.85x at cohesion 0 to 1.15x at 100", () => {
    const b = build();
    const make = (cohesion: number) =>
      shop({ roster: staffed([person(1)], "b1"), builds: [b], team: { ...shop().team, engineering: 20 }, culture: { cohesion, morale: 60 } });
    expect(weekOutput(make(0), b, -1).points).toBeCloseTo(0.85, 10);
    expect(weekOutput(make(100), b, -1).points).toBeCloseTo(1.15, 10);
  });

  it("founders' hands: only on the oldest build and only at <= 10 heads (11 heads → 0)", () => {
    const a = build({ id: "b1", slug: "a" });
    const z = build({ id: "b2", slug: "z", name: "Zed" });
    const small = shop({ roster: [person(1)], builds: [a, z] });
    expect(founderHands(small, a)).toBeCloseTo(0.75 + 0.4, 10); // hacker + operator
    expect(founderHands(small, z)).toBe(0);
    const ten = shop({ roster: [person(1)], builds: [a], team: { ...shop().team, engineering: 10 } });
    expect(founderHands(ten, a)).toBeCloseTo(1.15, 10);
    const eleven = shop({ roster: [person(1)], builds: [a], team: { ...shop().team, engineering: 11 } });
    expect(founderHands(eleven, a)).toBe(0);
    const builder = shop({ roster: [person(1)], builds: [a], founder: { name: "F", archetype: "visionary" }, cofounder: { ...shop().cofounder, archetype: "builder" } });
    expect(founderHands(builder, a)).toBeCloseTo(0.4 + 0.75, 10);
    expect(weekOutput(builder, a, -1).quality).toBeCloseTo(65, 10); // builder hands at craft 65, no staff: lead = hands
  });

  it("crunch: output x1.5 and that week's quality x0.9", () => {
    const b = build();
    const s = shop({ roster: staffed([person(1), person(2, { craft: 5 })], "b1"), builds: [b] });
    const calm = weekOutput(s, b, -1);
    const pushed = weekOutput(s, { ...b, crunch: true }, -1);
    expect(pushed.points).toBeCloseTo(calm.points * 1.5, 10);
    expect(pushed.quality).toBeCloseTo(calm.quality * 0.9, 10);
  });

  it("nobody fitting and no hands: zero points, quality = the lead score (hands craft without a lead)", () => {
    const b = build();
    const s = shop({ roster: [person(1)], builds: [b], team: { ...shop().team, engineering: 20 } });
    const out = weekOutput(s, b, -1);
    expect(out.points).toBe(0);
    expect(out.quality).toBe(55);
    expect(etaWeeks(s, b)).toBeNull();
  });
});

describe("ETA and the due window", () => {
  it("is 0 when built, 1 when the first week covers the rest, null when nobody produces", () => {
    const s = exampleB();
    expect(etaWeeks(s, { ...onboarding, progress: 5 })).toBe(0);
    expect(etaWeeks(s, { ...onboarding, progress: 4 })).toBe(1);
  });

  it("due = week + clamp(ceil(1.25 x eta) + 1, windowMin, windowMax); eta null → windowMax", () => {
    const xl = build({ size: "xl", scope: 64, baseScope: 64, units: 10 });
    const lonely = shop({ roster: [person(1)], builds: [xl], team: { ...shop().team, engineering: 20 } });
    expect(windowWeeks(lonely, xl)).toBe(SIZES.xl.windowMax);
    const quick = { ...onboarding, progress: 4 };
    expect(windowWeeks(exampleB(), quick)).toBe(SIZES.s.windowMin); // eta 1 → ceil(1.25) + 1 = 3 = the S minimum
  });

  it("without the late-staff fallback the kickoff ETA is the staffed team's ETA", () => {
    const s = exampleB();
    expect(kickoffEta(s, onboarding)).toBe(etaWeeks(s, onboarding));
  });

  it("the prepared late-staff fallback: min(staffed ETA, ETA with a standard head in every empty seat); full seats change nothing", () => {
    const xl = build({ size: "xl", scope: 64, baseScope: 64, units: 10, startedWeek: 1 });
    const big = { ...shop().team, engineering: 20 }; // no founders' hands
    const empty = shop({ roster: [person(1)], builds: [xl], team: big });
    expect(kickoffEtaWith(empty, xl, false)).toBeNull();
    const padded = kickoffEtaWith(empty, xl, true);
    expect(padded).toBe(etaWeeks(shop({ roster: staffed(Array.from({ length: 7 }, (_, i) => person(i + 1)), "b1", 1), builds: [xl], team: big }), xl));
    const s = exampleB();
    expect(kickoffEtaWith(s, onboarding, true)).toBe(etaWeeks(s, onboarding)); // both S seats are taken
  });
});

describe("scope at kickoff", () => {
  it("inflates 15% per earlier release of the type, counted up to 6", () => {
    const with_ = (n: number) => setProduct(shop(), { shippedByType: { feature: n, growth: 0, premium: 0, plumbing: 0, moonshot: 0 } });
    expect(scopeFor(with_(0), "feature", "m")).toBe(12);
    expect(scopeFor(with_(1), "feature", "m")).toBe(13.8);
    expect(scopeFor(with_(6), "feature", "m")).toBe(22.8);
    expect(scopeFor(with_(9), "feature", "m")).toBe(22.8);
    expect(scopeFor(with_(1), "growth", "m")).toBe(12);
    expect(scopeFor(shop(), "moonshot", "xl")).toBe(96);
  });
});

describe("reception (§5.5)", () => {
  it("tiers: 39 flop, 40 shrug, 59 shrug, 60 solid, 84 solid, 85 breakout", () => {
    expect([39, 40, 59, 60, 84, 85, 0, 100].map(tierOf)).toEqual(["flop", "shrug", "shrug", "solid", "solid", "breakout", "flop", "breakout"]);
  });

  it("payoff multiplier: 0 under 40, 0.2 at 40, 0.5 at 55, 1.0 at 80, 1.4 at 100", () => {
    expect(payMultiplier(39)).toBe(0);
    expect(payMultiplier(40)).toBeCloseTo(0.2, 10);
    expect(payMultiplier(55)).toBeCloseTo(0.5, 10);
    expect(payMultiplier(80)).toBeCloseTo(1.0, 10);
    expect(payMultiplier(100)).toBeCloseTo(1.4, 10);
  });

  it("fit: pricing + type bonus + founder + stage perk (worked example D: 11)", () => {
    const d = shop({ pricingModel: "enterprise", founder: { name: "F", archetype: "sales-animal" }, stage: "seed" });
    expect(fitOf(d, "premium")).toBe(4 + 0 + 4 + 3);
    const b = shop({ pricingModel: "prosumer" }); // hacker, garage
    expect(fitOf(b, "feature")).toBe(6);
    expect(fitOf(b, "growth")).toBe(1 + 3);
    const philosopher = shop({ pricingModel: "consumer", founder: { name: "F", archetype: "philosopher" } });
    expect(fitOf(philosopher, "premium")).toBe(-6 + 1);
  });

  it("stress costs round(15 x successPenaltyFromStress): 44 → 3, 30 → 2", () => {
    expect(stressPenalty(shop({ stress: 44 }))).toBe(3);
    expect(stressPenalty(shop({ stress: 30 }))).toBe(2);
  });

  it("luck amplitude: 8 + 12 x volatility, x type luck, x1.5 with a powderkeg", () => {
    expect(luckAmplitude(shop({ volatility: 0 }), "feature")).toBe(8);
    expect(luckAmplitude(shop({ volatility: 100 }), "feature")).toBe(20);
    expect(luckAmplitude(shop({ volatility: 0 }), "moonshot")).toBe(16);
    expect(luckAmplitude(shop({ volatility: 0, cofounder: { ...shop().cofounder, archetype: "powderkeg" } }), "plumbing")).toBe(6);
  });

  it("quality = work quality + polish − 0.15 x cruft, rounded and clamped", () => {
    const b = build({ progress: 6, qPts: 6, qSum: 6 * 60, polish: 4 });
    expect(qualityOf(shop(), b)).toBe(64);
    expect(qualityOf(setProduct(shop(), { cruft: 40 }), b)).toBe(58);
    expect(qualityOf(shop(), { ...b, qSum: 6 * 99, polish: 9 })).toBe(100);
  });
});

describe("the forecast", () => {
  const halfBuilt = (overrides: Partial<GameState> = {}) => {
    const b = build({ progress: 8, qPts: 8, qSum: 8 * 60, dueWeek: 10 });
    const s = shop({ roster: staffed([person(1), person(2)], "b1"), builds: [b], week: 4, pricingModel: "prosumer", stress: 30, ...overrides });
    return { s, b };
  };

  it("`now` is the luck-free reception if shipped this week (= the release score with zero luck)", () => {
    const { s, b } = halfBuilt();
    const f = forecastOf(s, b);
    expect(f.now).toBe(Math.max(0, Math.min(100, Math.round(receptionBase(s, b, s.week)))));
    expect(f.now).toBe(scoreRelease(s, b, 0).reception);
    expect(f.shippable).toBe(true);
    expect(f.tierNow).toBe(tierOf(f.now));
  });

  it("`finished` does the rest at the team's quality, C = 1, and the lateness of the ETA's arrival week", () => {
    const { s, b } = halfBuilt();
    const eta = etaWeeks(s, b);
    expect(eta).not.toBeNull();
    const tq = teamQualityNow(s, b);
    const q = Math.round((8 * 60 + 4 * tq) / 12);
    const late = Math.max(0, s.week + (eta ?? 0) - b.dueWeek);
    expect(forecastOf(s, b).finished).toBe(q + fitOf(s, "feature") - 3 * late - stressPenalty(s));
    const lateBuild = { ...b, dueWeek: 3 };
    const lateEta = etaWeeks(s, lateBuild) ?? 0;
    expect(forecastOf(s, lateBuild).finished).toBe(q + fitOf(s, "feature") - 3 * (s.week + lateEta - 3) - stressPenalty(s));
  });

  it("spread is half the luck amplitude, rounded; the forecast never draws", () => {
    const { s, b } = halfBuilt({ volatility: 50 });
    expect(forecastOf(s, b).spread).toBe(Math.round(luckAmplitude(s, "feature") / 2));
    const before = JSON.stringify(s);
    forecastOf(s, b);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("with nobody on it: eta null, `finished` as if it landed this week, and the text says so", () => {
    const b = build({ progress: 2, qPts: 2, qSum: 110 });
    const s = shop({ roster: [person(1)], builds: [b], team: { ...shop().team, engineering: 20 } });
    const f = forecastOf(s, b);
    expect(f.eta).toBeNull();
    expect(forecastText(s, b)).toContain("finished ≈ ? (nobody on it)");
    expect(forecastText(s, b)).toContain("not shippable until 60%");
  });

  it("forecast text: unfinished, late and built forms", () => {
    const { s, b } = halfBuilt();
    const f = forecastOf(s, b);
    // ERRATA 69: shipping early prints what rushing costs (8 x units x (1 − C) = 8 x 2.5 x (1 − 8/12) = 6.7).
    expect(f.rushCruft).toBe(6.7);
    expect(forecastText(s, b)).toBe(`ETA ~${f.eta}w · due week 10 · ship now ≈ ${f.now} ±${f.spread} (+6.7 cruft for rushing) · finished ≈ ${f.finished}`);
    expect(forecastText({ ...s, week: 12 }, b)).toContain("2w late");
    const done = { ...b, progress: 12, qPts: 12, qSum: 720 };
    const g = forecastOf(s, done);
    expect(g.rushCruft).toBe(0);
    expect(forecastText(s, done)).toBe(`due week 10 · ship now ≈ ${g.now} ±${g.spread}`);
    // Plumbing pays cruft down instead, so it never shows a rush price.
    expect(forecastOf(s, { ...b, type: "plumbing" }).rushCruft).toBe(0);
  });

  it("completeness and percent: floored, capped at 100", () => {
    expect(pct(build({ progress: 5.6, scope: 12 }))).toBe(46);
    expect(completeness(build({ progress: 12, scope: 12 }))).toBe(1);
    expect(pct(build({ progress: 12, scope: 12 }))).toBe(100);
  });
});
