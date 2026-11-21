import { describe, expect, it } from "vitest";
import type { Employee, GameState } from "../../types/game";
import { makeBuild, makeTycoonState } from "../testHelpers";
import { endWeekTick } from "../tick";
import { peopleRng, rosterInvariantHolds, rosterOf } from "../tycoon/roster";
import { runPeopleWeek } from "./weekly";
import { offerChance } from "./rules";
import { find, person, run, stateWith, texts, zeroTeam } from "./testKit";

// Tick step N2 (TYCOON-SPEC §5.3, §6). `state.week` is already the new week when runPeopleWeek runs.

const W = 10;
const at = (roster: Employee[], opts: Parameters<typeof stateWith>[1] = {}): GameState =>
  stateWith(roster, { ...opts, overrides: { week: W, ...opts.overrides } });

describe("runPeopleWeek: idle", () => {
  it("returns the same reference and no lines when nobody is engaged (every legacy run)", () => {
    const s = makeTycoonState({ team: zeroTeam({ engineering: 30, design: 5 }), week: 40 });
    const r = runPeopleWeek(s);
    expect(r.state).toBe(s);
    expect(r.logs).toEqual([]);
  });

  it("returns the same reference without a slice or with an empty roster", () => {
    const legacy = { ...makeTycoonState(), people: undefined };
    expect(runPeopleWeek(legacy).state).toBe(legacy);
    const empty = stateWith([]);
    expect(runPeopleWeek(empty).state).toBe(empty);
  });

  it("never rolls or drains people the player never worked with, even at a high would-be chance", () => {
    const star = person("e1", { pace: 5, craft: 5, quirk: "mercenary", hiredWeek: 1, ledWeek: W - 1, energy: 20 });
    const s = at([star]);
    const r = runPeopleWeek(s);
    expect(find(r.state, "e1")?.offerDueWeek).toBe(0);
    expect(r.state.people?.rng).toBe(s.people?.rng); // nothing drawn
    expect(find(r.state, "e1")?.energy).toBe(25); // recovery only
  });
});

describe("runPeopleWeek: energy", () => {
  it("drains people on a build that crunched this tick (15 / firefighter 8 / believer 20); everyone else recovers", () => {
    const roster = [
      person("e1", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 100 }),
      person("e2", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 100, quirk: "firefighter" }),
      person("e3", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 100, quirk: "believer" }),
      person("e4", { engaged: true, energy: 70 }),
      person("e5", { engaged: true, buildId: "b2", joinedWeek: 1, energy: 98 }),
      person("e6", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 10 }),
    ];
    const builds = [makeBuild({ crunch: true, crunchedWeek: W }), makeBuild({ id: "b2", slug: "kale", name: "Kale", crunch: true, crunchedWeek: W - 1 })];
    const r = runPeopleWeek(at(roster, { builds }));
    expect(rosterOf(r.state).map((e) => e.energy)).toEqual([85, 92, 80, 75, 100, 0]);
  });

  it("recovers 5 + 2 with HR + the asset bonus (capped at 3)", () => {
    const tired = person("e1", { engaged: true, energy: 50 });
    const hr = person("e2", { role: "hr", name: "Uma Shah" });
    expect(find(runPeopleWeek(at([tired])).state, "e1")?.energy).toBe(55);
    expect(find(runPeopleWeek(at([tired, hr])).state, "e1")?.energy).toBe(57);
    const lounge = { id: "lounge" as const, name: "Lounge", purchaseWeek: 1 };
    expect(find(runPeopleWeek(at([tired, hr], { overrides: { assets: [lounge] } })).state, "e1")?.energy).toBe(59);
  });
});

describe("runPeopleWeek: notices", () => {
  it("burnout below 30 is certain, with two weeks' notice (three with HR) and the price in the line", () => {
    const leila = person("e1", { name: "Leila Demir", engaged: true, energy: 10, salary: 3400 });
    const r = runPeopleWeek(at([leila]));
    expect(find(r.state, "e1")).toMatchObject({ offerDueWeek: W + 2, offerKind: "burnout", leadOnNotice: null });
    expect(r.logs).toEqual([
      "Leila Demir is running on fumes (energy 15) and has started interviewing. Gone in 2 weeks unless you `retain leila` (1 AP, $6,800 bonus, pay → $3,750/wk).",
    ]);
    const withHr = runPeopleWeek(at([leila, person("e2", { role: "hr", name: "Uma Shah" })]));
    expect(find(withHr.state, "e1")?.offerDueWeek).toBe(W + 3);
  });

  it("recruiter rolls happen on people.rng only, one chance per eligible engaged person, and both outcomes occur", () => {
    let hits = 0;
    let misses = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const petra = person("e1", { name: "Petra Sato", role: "marketing", pace: 4, craft: 5, salary: 3450, engaged: true, hiredWeek: 1, ledWeek: W - 2 });
      // Spread the seeds: the first xorshift32 draw of neighbouring seeds is correlated (in play the stream is already advanced).
      const s = at([petra], { overrides: { seed: Math.imul(seed, 2654435761) >>> 0 } });
      expect(offerChance(s, petra)).toBeCloseTo((0.002 + 0.018 + 0.08) * 0.8, 10);
      const r = runPeopleWeek(s);
      expect(r.state.rng).toBe(s.rng);
      expect(r.state.product?.rng).toBe(s.product?.rng);
      expect(r.state.people?.rng).not.toBe(peopleRng(s)); // one draw, written back
      if (find(r.state, "e1")?.offerDueWeek) {
        hits += 1;
        expect(r.logs).toEqual([
          "Petra Sato (marketing, pace 4 craft 5) has an outside offer. Gone in 2 weeks unless you `retain petra` (1 AP, $6,900 bonus, pay → $3,800/wk).",
        ]);
        expect(find(r.state, "e1")?.offerKind).toBe("recruiter");
      } else {
        misses += 1;
        expect(r.logs).toEqual([]);
      }
    }
    expect(hits).toBeGreaterThan(5);
    expect(misses).toBeGreaterThan(200);
  });

  it("caps new notices at 1 + floor(roster / 12): burnout first, then pace + craft, then serial", () => {
    const roster = Array.from({ length: 13 }, (_, i) =>
      person(`e${i + 1}`, { name: `Worker ${i + 1}`, engaged: true, energy: 10, pace: i === 7 ? 5 : 3, craft: 3 }));
    const r = runPeopleWeek(at(roster));
    const noticed = rosterOf(r.state).filter((e) => e.offerDueWeek > 0).map((e) => e.id);
    expect(noticed).toEqual(["e1", "e8"]); // cap 2: e8 (pace 5) first, then the lowest serial
    expect(r.logs).toHaveLength(2);
  });

  it("stamps leadOnNotice with the build the person leads at that moment; a non-lead gets null", () => {
    const lead = person("e1", { name: "Nadia Nkosi", craft: 4, engaged: true, energy: 10, buildId: "b1", joinedWeek: 2 });
    const helper = person("e2", { name: "Hiro Ito", engaged: true, buildId: "b1", joinedWeek: 2 });
    const build = makeBuild({ name: "Phoenix", slug: "phoenix" });
    const r = runPeopleWeek(at([lead, helper], { builds: [build] }));
    expect(find(r.state, "e1")).toMatchObject({ offerKind: "burnout", leadOnNotice: "b1" });
    expect(r.logs[0]).toMatch(/^Nadia Nkosi is running on fumes .* Phoenix loses a quarter if they go\.$/);
    const r2 = runPeopleWeek(at([{ ...lead, energy: 100 }, { ...helper, energy: 10 }], { builds: [build] }));
    expect(find(r2.state, "e2")).toMatchObject({ offerKind: "burnout", leadOnNotice: null });
    expect(r2.logs[0]).not.toMatch(/loses a quarter/);
  });
});

describe("runPeopleWeek: departures", () => {
  const build = makeBuild({ name: "Phoenix", slug: "phoenix", progress: 8, qSum: 480, qPts: 8, scope: 17.4 });

  it("leave exactly when week >= offerDueWeek: removed with their head, morale -2, cohesion -1, departures + 1, one line", () => {
    const leaving = person("e1", { name: "Nadia Nkosi", salary: 3800, engaged: true, offerDueWeek: W, offerKind: "recruiter" });
    const stays = person("e2", { name: "Hiro Ito", engaged: true, offerDueWeek: W + 1, offerKind: "recruiter" });
    const s = at([leaving, stays]);
    const r = runPeopleWeek(s);
    expect(find(r.state, "e1")).toBeUndefined();
    expect(find(r.state, "e2")).toBeDefined();
    expect(r.state.team.engineering).toBe(1);
    expect(r.state.people?.departures).toBe(1);
    expect(r.state.culture).toEqual({ cohesion: 59, morale: 58 });
    expect(r.logs[0]).toBe(
      "Nadia Nkosi cleared out their desk. They signed with the company that has a cafeteria. engineering -1. Payroll -$3,800/wk. Morale -2. Cohesion -1.",
    );
    expect(r.logs[1]).toBe("Hiro Ito walks next week. `retain hiro` (1 AP, $7,000 bonus, pay → $3,850/wk) or start drafting the farewell Slack.");
    expect(rosterInvariantHolds(r.state)).toBe(true);
  });

  it("a build loses its quarter ONCE when its lead and the next in line walk out in the same tick (review: 90% → 31%)", () => {
    // Before ERRATA 65 the second leaver had become the lead by the time they were removed and took another quarter.
    const lead = person("e1", { name: "Lotte Okoro", craft: 5, engaged: true, buildId: "b1", joinedWeek: 2, offerDueWeek: W, offerKind: "burnout", leadOnNotice: "b1" });
    const next = person("e2", { name: "Zanele Kowalski", craft: 4, engaged: true, buildId: "b1", joinedWeek: 2, offerDueWeek: W, offerKind: "burnout" });
    const crew = person("e3", { name: "Leila Demir", craft: 2, engaged: true, buildId: "b1", joinedWeek: 2 });
    const r = runPeopleWeek(at([lead, next, crew], { builds: [build] }));
    expect(r.state.product?.active[0]).toMatchObject({ progress: 6, qSum: 360, qPts: 6 });
    expect(r.logs[0]).toMatch(/^Lotte Okoro cleared out .* Phoenix lost its lead and 25% of its progress\.$/);
    expect(r.logs[1]).toMatch(/^Zanele Kowalski cleared out /);
    expect(r.logs[1]).not.toMatch(/lost its lead/);
    expect(rosterInvariantHolds(r.state)).toBe(true);
  });

  it("burnout leavers leave a calm note; glue costs cohesion 3", () => {
    const glue = person("e1", { name: "Bea Lund", quirk: "glue", engaged: true, offerDueWeek: W, offerKind: "burnout" });
    const r = runPeopleWeek(at([glue]));
    expect(r.logs[0]).toContain("They left a laptop and a very calm note.");
    expect(r.logs[0]).toContain("Cohesion -3.");
    expect(r.state.culture.cohesion).toBe(57);
  });

  it("the lead rule follows leadOnNotice: un-staffing them or out-crafting them during the notice does not dodge the quarter", () => {
    // Taken off the build after the notice landed:
    const off = person("e1", { name: "Nadia Nkosi", craft: 4, engaged: true, offerDueWeek: W, offerKind: "recruiter", leadOnNotice: "b1" });
    const crew = person("e2", { name: "Leila Demir", engaged: true, buildId: "b1", joinedWeek: 2 });
    const r1 = runPeopleWeek(at([off, crew], { builds: [build] }));
    expect(r1.state.product?.active[0].progress).toBe(6);
    expect(r1.logs[0]).toMatch(/Phoenix lost its lead and 25% of its progress\.$/);
    // Out-crafted by a newcomer while still on it:
    const on = { ...off, buildId: "b1", joinedWeek: 2 };
    const star = person("e3", { name: "Star Hire", craft: 5, engaged: true, buildId: "b1", joinedWeek: W - 1 });
    const r2 = runPeopleWeek(at([on, crew, star], { builds: [build] }));
    expect(r2.state.product?.active[0]).toMatchObject({ progress: 6, qSum: 360, qPts: 6 });
  });

  it("a notice on a non-lead costs no progress; retain clears the stamp and nobody leaves", () => {
    const helper = person("e2", { name: "Leila Demir", engaged: true, buildId: "b1", joinedWeek: 2, offerDueWeek: W, offerKind: "recruiter" });
    const lead = person("e1", { name: "Nadia Nkosi", craft: 5, engaged: true, buildId: "b1", joinedWeek: 2 });
    const r = runPeopleWeek(at([lead, helper], { builds: [build] }));
    expect(r.state.product?.active[0].progress).toBe(8);

    const noticed = person("e1", { name: "Nadia Nkosi", craft: 4, engaged: true, buildId: "b1", joinedWeek: 2, offerDueWeek: W + 1, offerKind: "recruiter", leadOnNotice: "b1" });
    const s = at([noticed], { builds: [build], overrides: { week: W - 1, cash: 50_000 } });
    const kept = run(s, "retain nadia").state;
    expect(find(kept, "e1")).toMatchObject({ offerDueWeek: 0, leadOnNotice: null });
    const later = runPeopleWeek({ ...kept, week: W + 1 });
    expect(find(later.state, "e1")).toBeDefined();
  });

  it("departures always print; plain news fills the rest of three lines; the overflow names who `team` still lists", () => {
    const roster = [
      person("e1", { name: "New Notice", engaged: true, energy: 5 }),
      person("e2", { name: "Last Call", engaged: true, offerDueWeek: W + 1, offerKind: "recruiter" }),
      person("e3", { name: "Gone One", engaged: true, offerDueWeek: W, offerKind: "recruiter" }),
      person("e4", { name: "Gone Two", engaged: true, offerDueWeek: W - 1, offerKind: "burnout" }),
    ];
    const r = runPeopleWeek(at(roster));
    expect(r.logs).toHaveLength(4);
    expect(r.logs[0]).toMatch(/^Gone One cleared out/);
    expect(r.logs[1]).toMatch(/^Gone Two cleared out/);
    expect(r.logs[2]).toMatch(/^Last Call walks next week/);
    // ERRATA 66: the folded line names people who are still here (the departed are never folded).
    expect(r.logs[3]).toBe("(Also on notice: New Notice. `team` has the details.)");
  });

  it("never folds a departure, even past three lines (review: a lead left with no line at all)", () => {
    const roster = [1, 2, 3, 4, 5].map((n) => person(`e${n}`, { name: `Leaver ${n}`, engaged: true, offerDueWeek: W, offerKind: "burnout" }));
    const r = runPeopleWeek(at(roster));
    expect(r.logs).toHaveLength(5);
    expect(r.logs.every((l) => / cleared out their desk\./.test(l))).toBe(true);
    expect(rosterOf(r.state)).toHaveLength(0);
  });

  it("never folds a notice or last call that puts a build at risk, and puts the risk on the last call too", () => {
    const roster = [
      person("e1", { name: "Gone One", engaged: true, offerDueWeek: W, offerKind: "recruiter" }),
      person("e2", { name: "Gone Two", engaged: true, offerDueWeek: W, offerKind: "recruiter" }),
      person("e3", { name: "Gone Three", engaged: true, offerDueWeek: W, offerKind: "recruiter" }),
      person("e4", { name: "Nadia Nkosi", craft: 5, engaged: true, buildId: "b1", joinedWeek: 2, offerDueWeek: W + 1, offerKind: "recruiter", leadOnNotice: "b1" }),
      person("e5", { name: "Plain Call", engaged: true, offerDueWeek: W + 1, offerKind: "recruiter" }),
    ];
    const r = runPeopleWeek(at(roster, { builds: [build] }));
    expect(r.logs.slice(0, 3).every((l) => / cleared out their desk\./.test(l))).toBe(true);
    expect(r.logs[3]).toMatch(/^Nadia Nkosi walks next week\..* Phoenix loses a quarter if they go\.$/);
    expect(r.logs[4]).toBe("(Also on notice: Plain Call. `team` has the details.)");
  });

  it("is deterministic and plain JSON", () => {
    const roster = [person("e1", { engaged: true, pace: 5, craft: 5, ledWeek: W - 1, quirk: "mercenary", hiredWeek: 1 }), person("e2", { engaged: true, energy: 10 })];
    const s = at(roster);
    const a = runPeopleWeek(s);
    const b = runPeopleWeek(s);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});

describe("through `end`", () => {
  it("a burnout notice gives two ends of warning, each printed, then the person leaves in the tick that reaches the due week", () => {
    const tired = person("e1", { name: "Leila Demir", engaged: true, energy: 20 });
    let s = stateWith([tired, person("e2", { name: "Hiro Ito" })], { overrides: { cash: 500_000 } });
    const first = run(s, "end");
    expect(find(first.state, "e1")).toMatchObject({ offerDueWeek: 4, offerKind: "burnout", energy: 25 });
    expect(texts(first).some((t) => t.startsWith("Leila Demir is running on fumes (energy 25)"))).toBe(true);
    s = first.state;
    const second = run(s, "end");
    expect(find(second.state, "e1")).toBeDefined();
    expect(texts(second).some((t) => t.startsWith("Leila Demir walks next week."))).toBe(true);
    const third = run(second.state, "end");
    expect(third.state.week).toBe(4);
    expect(find(third.state, "e1")).toBeUndefined();
    expect(third.state.team.engineering).toBe(1);
    expect(texts(third).some((t) => t.startsWith("Leila Demir cleared out their desk."))).toBe(true);
    expect(rosterInvariantHolds(third.state)).toBe(true);
    expect(third.state.burn).toBeLessThan(second.state.burn);
  });

  it("an untouched job-ad roster leaves endWeekTick exactly as it would be without people news", () => {
    const s = makeTycoonState({ team: zeroTeam({ engineering: 4, marketing: 2 }) });
    const r = endWeekTick(s);
    expect(r.logs.some((l) => /cleared out|outside offer|running on fumes|walks next week/.test(l))).toBe(false);
    expect(rosterOf(r.state).map((e) => e.energy)).toEqual(rosterOf(s).map((e) => e.energy));
  });
});
