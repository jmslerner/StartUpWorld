import { describe, expect, it } from "vitest";
import type { Build, GameState } from "../../types/game";
import { makeState } from "../testHelpers";
import { buildsOf, productRng, removeEmployee, setProduct } from "../tycoon/roster";
import { build, person, shop, staffed } from "./testkit";
import { adjustChurn, runProjectsWeek, surpriseChance } from "./weekly";
import { forecastText, qualityOf } from "./work";

const onboarding = build({ id: "b1", name: "onboarding", slug: "onboarding", size: "s", units: 1, baseScope: 5, scope: 5, dueWeek: 5 });
/** Worked example B at the start of the tick that closes week `worked` (state.week is already worked + 1). */
const exampleB = (b: Build, worked: number, cohesion: number): GameState =>
  shop({
    roster: staffed([person(1, { quirk: "cowboy" }), person(2)], "b1", 1),
    builds: [b],
    culture: { cohesion, morale: 70 },
    pricingModel: "prosumer",
    week: worked + 1,
  });
const only = (s: GameState): Build => buildsOf(s)[0];

describe("runProjectsWeek: idle weeks change nothing", () => {
  it("returns the same reference and an empty render for a legacy state, an empty slice, and a moat that rounds to itself", () => {
    const legacy = makeState();
    expect(runProjectsWeek(legacy).state).toBe(legacy);
    const empty = shop();
    const r = runProjectsWeek(empty);
    expect(r.state).toBe(empty);
    expect(r.render(empty)).toEqual([]);
    const stuck = setProduct(shop(), { moat: 1 }); // round1(1 x 0.97) = 1
    expect(runProjectsWeek(stuck).state).toBe(stuck);
  });

  it("decays the moat 3% a tick with nothing in flight, without drawing or printing", () => {
    const s = setProduct(shop(), { moat: 10, cruft: 7 });
    const r = runProjectsWeek(s);
    expect(r.state.product?.moat).toBe(9.7);
    expect(r.state.product?.cruft).toBe(7);
    expect(r.state.product?.rng).toBe(0);
    expect(r.render(r.state)).toEqual([]);
  });
});

describe("runProjectsWeek: worked example B, week by week", () => {
  it("week 1: 0% → 49% (+2.5 pts), quality accrues weighted by real work", () => {
    const r = runProjectsWeek(exampleB(onboarding, 1, 78));
    const b = only(r.state);
    expect(b.progress).toBeCloseTo(2.466, 3);
    expect(b.qPts).toBeCloseTo(2.466, 3);
    expect(b.qSum / b.qPts).toBeCloseTo(52.94, 2);
    expect(b.surprises).toBe(0);
    const line = r.render(r.state)[0];
    expect(line.startsWith("onboarding: 0% → 49% built (+2.5 pts). ETA ~1w · due week 5")).toBe(true);
  });

  it("week 2: finishes the scope, the overflow becomes polish 3 → quality 56; crunch off, readyWeek set", () => {
    const afterWeek1 = only(runProjectsWeek(exampleB(onboarding, 1, 78)).state);
    const s = exampleB({ ...afterWeek1, crunch: false }, 2, 76);
    const r = runProjectsWeek(s);
    const b = only(r.state);
    expect(b.progress).toBe(5);
    expect(b.readyWeek).toBe(3);
    expect(b.polish).toBe(3);
    expect(b.qSum / b.qPts).toBeCloseTo(52.59, 2);
    expect(qualityOf(r.state, b)).toBe(56);
    expect(r.render(r.state)[0]).toBe(`onboarding: 100% built. \`ship onboarding\` — or keep polishing. ${forecastText(r.state, b)}.`);
  });

  it("week 3: all points are spare → polish 6 → quality 59; the built line", () => {
    const w1 = only(runProjectsWeek(exampleB(onboarding, 1, 78)).state);
    const w2 = only(runProjectsWeek(exampleB(w1, 2, 76)).state);
    const r = runProjectsWeek(exampleB(w2, 3, 76));
    const b = only(r.state);
    expect(b.polish).toBe(6);
    expect(qualityOf(r.state, b)).toBe(59);
    expect(b.readyWeek).toBe(3);
    expect(r.render(r.state)[0]).toBe(`onboarding: built, polish 6/9. ${forecastText(r.state, b)}. \`ship onboarding\`.`);
  });

  it("polish: at most 3 a week and never past 9", () => {
    const built = { ...onboarding, progress: 5, qPts: 5, qSum: 275, polish: 7.5, readyWeek: 2 };
    const r = runProjectsWeek(exampleB(built, 5, 76));
    expect(only(r.state).polish).toBe(9);
    const small = { ...built, polish: 0, scope: 60, baseScope: 60, progress: 60, qPts: 60, qSum: 3300 };
    const r2 = runProjectsWeek(exampleB(small, 5, 76));
    expect(only(r2.state).polish).toBeLessThanOrEqual(3);
  });
});

describe("runProjectsWeek: crunch bookkeeping", () => {
  it("a worked crunch week stamps crunchedWeek, counts the week and adds 1 cruft", () => {
    const b = build({ crunch: true });
    const s = shop({ roster: staffed([person(1), person(2)], "b1"), builds: [b], week: 3 });
    const r = runProjectsWeek(s);
    const after = only(r.state);
    expect(after.crunchedWeek).toBe(3);
    expect(after.crunchWeeks).toBe(1);
    expect(r.state.product?.cruft).toBe(1);
    // ERRATA 67: the crew's lowest energy sits on the line that reports what crunch bought.
    expect(r.render(r.state)[0]).toContain("pts, crunching, lowest energy 100)");
    const tired = runProjectsWeek(shop({ roster: staffed([person(1, { energy: 40 }), person(2)], "b1"), builds: [b], week: 3 }));
    expect(tired.render(tired.state)[0]).toContain("pts, crunching, lowest energy 40 — interviews start under 30)");
  });

  it("a crunch flag over an empty crew does nothing: no crunchedWeek, no week counted, no cruft", () => {
    const b = build({ crunch: true });
    const s = shop({ roster: [person(1)], builds: [b], week: 3, team: { ...shop().team, engineering: 20 } });
    const after = only(runProjectsWeek(s).state);
    expect(after.crunchedWeek).toBe(0);
    expect(after.crunchWeeks).toBe(0);
    expect(runProjectsWeek(s).state.product?.cruft).toBe(0);
  });

  it("the founders' hands alone are never crunched: same points, same quality, no cruft (review exploit, ERRATA 68)", () => {
    const calm = shop({ roster: [person(1)], builds: [build()], week: 3 });
    const pushed = shop({ roster: [person(1)], builds: [build({ crunch: true })], week: 3 });
    const a = only(runProjectsWeek(calm).state);
    const z = only(runProjectsWeek(pushed).state);
    expect(a.progress).toBeGreaterThan(0); // the hands did work
    expect(z.progress).toBe(a.progress);
    expect(z.qSum).toBe(a.qSum);
    expect([z.crunchedWeek, z.crunchWeeks]).toEqual([0, 0]);
    expect(runProjectsWeek(pushed).state.product?.cruft).toBe(0);
    const line = runProjectsWeek(pushed).render(runProjectsWeek(pushed).state)[0];
    expect(line).not.toContain("crunching");
  });

  it("crunch switches itself off in the tick that completes the build", () => {
    const b = build({ crunch: true, progress: 11.5 });
    const after = only(runProjectsWeek(shop({ roster: staffed([person(1)], "b1"), builds: [b], week: 3 })).state);
    expect(after.progress).toBe(12);
    expect(after.crunch).toBe(false);
    expect(after.readyWeek).toBe(3);
  });
});

describe("runProjectsWeek: surprises", () => {
  it("chance by size, halved by a product person on the build, x0.8 with an operator", () => {
    const xl = build({ size: "xl", scope: 64, baseScope: 64 });
    const builder = { ...shop().cofounder, archetype: "builder" as const };
    expect(surpriseChance(shop({ builds: [xl], cofounder: builder }), xl)).toBeCloseTo(0.2, 10);
    expect(surpriseChance(shop({ builds: [xl], cofounder: builder, roster: staffed([person(1, { role: "product" })], "b1") }), xl)).toBeCloseTo(0.1, 10);
    expect(surpriseChance(shop({ builds: [xl] }), xl)).toBeCloseTo(0.16, 10); // makeState's cofounder is an operator
    expect(surpriseChance(shop({ builds: [build({ size: "s" })], cofounder: builder }), build({ size: "s" }))).toBeCloseTo(0.08, 10);
  });

  it("a hit adds 15% of the base scope and a line after that build's progress line; never more than 3", () => {
    const xl = build({ size: "xl", scope: 64, baseScope: 64, name: "Phoenix", slug: "phoenix", dueWeek: 30 });
    let hits = 0;
    for (let seed = 1; seed <= 200 && hits < 3; seed++) {
      const s = setProduct(shop({ roster: staffed([person(1)], "b1"), builds: [xl], week: 3 }), { rng: ((seed * 2654435761) >>> 0) || 1 });
      const r = runProjectsWeek(s);
      const b = only(r.state);
      if (b.surprises === 1) {
        hits += 1;
        expect(b.scope).toBe(73.6);
        const lines = r.render(r.state);
        expect(lines).toHaveLength(2);
        expect(lines[0].startsWith("Phoenix: 0% →")).toBe(true);
        expect(lines[1]).toMatch(/^Phoenix: surprise — .+\. Scope \+9\.6 pts\.$/);
      }
    }
    expect(hits).toBe(3);
    const capped = { ...xl, surprises: 3 };
    const s = shop({ roster: staffed([person(1)], "b1"), builds: [capped], week: 3 });
    const r = runProjectsWeek(s);
    expect(only(r.state).surprises).toBe(3);
    expect(r.state.product?.rng).toBe(0); // no roll at the cap: the stream is not even seeded
  });

  it("draws only from product.rng: state.rng and the people slice are untouched, and the stream is written back", () => {
    const s = shop({ roster: staffed([person(1), person(2)], "b1"), builds: [build()], week: 3 });
    const r = runProjectsWeek(s);
    expect(r.state.rng).toBe(s.rng);
    expect(r.state.people).toBe(s.people);
    expect(r.state.product?.rng).not.toBe(0);
    expect(r.state.product?.rng).not.toBe(productRng(s));
  });
});

describe("render(final): lines come from the finished tick", () => {
  it("a lead who leaves in the same tick shows as a smaller gain", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 4, qPts: 4, qSum: 220 });
    const s = shop({ roster: staffed([person(1), person(2, { craft: 5 })], "b1"), builds: [b], week: 3, team: { ...shop().team, engineering: 20 } });
    const work = runProjectsWeek(s);
    const worked = only(work.state);
    const departed = removeEmployee(work.state, "e2"); // the lead (craft 5)
    const final = departed.state;
    const line = work.render(final)[0];
    expect(departed.ledBuild?.progress).toBeCloseTo(worked.progress * 0.75, 10);
    expect(line.startsWith(`Phoenix: 33% → ${Math.floor((worked.progress * 0.75 / 12) * 100 + 1e-6)}% built (+`)).toBe(true);
    expect(line.endsWith(`${forecastText(final, only(final))}.`)).toBe(true);
  });

  it("one line per build in board order", () => {
    const a = build({ id: "b1", name: "Alpha", slug: "alpha" });
    const z = build({ id: "b2", name: "Zulu", slug: "zulu", type: "growth" });
    const s = shop({ roster: [...staffed([person(1)], "b1"), ...staffed([person(2, { role: "marketing" })], "b2")], builds: [a, z], week: 3 });
    const r = runProjectsWeek(s);
    const out = r.render(r.state).filter((l) => !l.includes("surprise"));
    expect(out.map((l) => l.split(":")[0])).toEqual(["Alpha", "Zulu"]);
  });
});

describe("adjustChurn (§5.6)", () => {
  it("returns its argument itself with no slice or with cruft and moat both 0", () => {
    expect(Object.is(adjustChurn(makeState(), 0.0337), 0.0337)).toBe(true);
    expect(Object.is(adjustChurn(shop(), 0.0337), 0.0337)).toBe(true);
  });

  it("adds 0.0002 per point of cruft, then removes 0.5% per point of moat, capped at 25%", () => {
    expect(adjustChurn(setProduct(shop(), { cruft: 50 }), 0.03)).toBeCloseTo(0.04, 12);
    expect(adjustChurn(setProduct(shop(), { moat: 20 }), 0.04)).toBeCloseTo(0.036, 12);
    expect(adjustChurn(setProduct(shop(), { moat: 100 }), 0.04)).toBeCloseTo(0.03, 12);
    expect(adjustChurn(setProduct(shop(), { cruft: 50, moat: 50 }), 0.03)).toBeCloseTo(0.03, 12);
  });
});
