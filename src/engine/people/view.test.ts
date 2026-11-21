import { describe, expect, it } from "vitest";
import { makeBuild, makeState, makeTycoonState } from "../testHelpers";
import { rosterOf } from "../tycoon/roster";
import {
  describeEmployee, listCandidates, listRoster, offerChance, peopleCommand, peopleHints, peopleStatusLine, PEOPLE_COMMANDS, QUIRK_BLURB,
  rosterForWorld, runPeopleWeek,
} from "./index";
import { person, run, stateWith, zeroTeam } from "./testKit";

// The §9.1 selectors and the other index exports.

describe("describeEmployee", () => {
  it("returns every PersonFacts field, with the build at risk for a lead holding notice", () => {
    const nadia = person("e3", {
      name: "Nadia Nkosi", pace: 1, craft: 4, salary: 3800, engaged: true, hiredWeek: 7, shipped: 2, quirk: "glue",
      buildId: "b1", joinedWeek: 20, offerDueWeek: 31, offerKind: "recruiter", leadOnNotice: "b1",
    });
    const builds = [
      makeBuild({ name: "Phoenix", slug: "phoenix" }),
      makeBuild({ id: "b2", slug: "loop", name: "Loop", type: "growth" }),
      makeBuild({ id: "b3", slug: "tier", name: "Tier", type: "premium" }),
    ];
    const s = stateWith([nadia], { builds, overrides: { week: 29 } });
    expect(describeEmployee(s, "nadia")).toEqual({
      id: "e3", name: "Nadia Nkosi", role: "engineering", pace: 1, craft: 4, craftScore: 76, effectiveness: 0.9,
      energy: 100, energyWord: "fresh", quirk: "glue", quirkBlurb: QUIRK_BLURB.glue, salary: 3800, marketSalary: 3150,
      hiredWeek: 7, shipped: 2, engaged: true, buildId: "b1", buildSlug: "phoenix", isLead: true,
      fitBuildIds: ["b1", "b2", "b3"], offer: { kind: "recruiter", weeksLeft: 2, buildAtRisk: "phoenix" },
      retainQuote: { bonus: 7600, newSalary: 4200 }, severance: 7600,
    });
  });

  it("fitBuildIds skip builds the role cannot work on; offer is null without notice; weeksLeft is at least 1", () => {
    const hr = person("e1", { role: "hr", name: "Uma Shah" });
    const ops = person("e2", { role: "ops", name: "Oz Pike", offerDueWeek: 5, offerKind: "burnout", engaged: true });
    const builds = [makeBuild(), makeBuild({ id: "b2", slug: "pipes", type: "plumbing" })];
    const s = stateWith([hr, ops], { builds, overrides: { week: 5 } });
    expect(describeEmployee(s, "uma")).toMatchObject({ fitBuildIds: [], offer: null, buildId: null, buildSlug: null, isLead: false });
    expect(describeEmployee(s, "e2")).toMatchObject({ fitBuildIds: ["b2"], offer: { kind: "burnout", weeksLeft: 1, buildAtRisk: null } });
    expect(describeEmployee(s, "nobody")).toBeNull();
  });
});

describe("listRoster", () => {
  it("is the `team` order, filterable by role", () => {
    const roster = [person("e1"), person("e2", { engaged: true }), person("e3", { role: "design", name: "Dee Zine", offerDueWeek: 3, offerKind: "recruiter", engaged: true })];
    const s = stateWith(roster);
    expect(listRoster(s).map((p) => p.id)).toEqual(["e3", "e2", "e1"]);
    expect(listRoster(s, { role: "engineering" }).map((p) => p.id)).toEqual(["e2", "e1"]);
  });
});

describe("rosterForWorld", () => {
  it("puts engaged people first (by serial), then the rest; reports unlisted whole heads and the hidden count", () => {
    const s = makeTycoonState({ team: zeroTeam({ engineering: 100, design: 30.5 }) });
    const engagedIds = ["e90", "e5"];
    const marked = { ...s, people: { ...s.people!, roster: rosterOf(s).map((e) => (engagedIds.includes(e.id) ? { ...e, engaged: true } : e)) } };
    const w = rosterForWorld(marked);
    expect(w.people).toHaveLength(64);
    expect(w.people.slice(0, 3).map((p) => p.id)).toEqual(["e5", "e90", "e1"]);
    expect(w.hidden).toBe(120 - 64);
    // Round-robin minting backs all 30 whole designers (the half head is never "unlisted"); the rest of the cap goes to engineering.
    expect(rosterOf(s).filter((e) => e.role === "design")).toHaveLength(30);
    expect(w.unlisted).toEqual({ engineering: 10 });
    expect(rosterForWorld(marked, 2).people.map((p) => p.id)).toEqual(["e5", "e90"]);
    expect(rosterForWorld(marked, 0)).toMatchObject({ people: [], hidden: 120 });
  });

  it("accepts a legacy state: no people, its heads unlisted (the world names them itself)", () => {
    expect(rosterForWorld(makeState())).toEqual({ people: [], unlisted: { engineering: 1 }, hidden: 0 });
    expect(listRoster(makeState())).toEqual([]);
    expect(describeEmployee(makeState(), "e1")).toBeNull();
    expect(listCandidates(makeState(), "engineering")).toBeNull();
  });
});

describe("listCandidates", () => {
  it("is null before a look, then hides claimed-vs-true and the quirk unless vetted", () => {
    const s = makeTycoonState();
    expect(listCandidates(s, "engineering")).toBeNull();
    const looked = run(s, "recruit eng").state;
    const pool = looked.people!.candidates.engineering!;
    const facts = listCandidates(looked, "engineering")!;
    expect(facts).toHaveLength(3);
    facts.forEach((f, i) => {
      expect(f).toEqual({
        index: i + 1, id: pool[i].id, name: pool[i].name, role: "engineering", shownPace: pool[i].claimedPace, shownCraft: pool[i].claimedCraft,
        vetted: false, quirk: "hidden", ask: pool[i].ask, signing: 3000, askVsStandard: pool[i].ask / 3500 - 1,
      });
    });
    expect(listCandidates(looked, "design")).toBeNull();
    expect(listCandidates({ ...looked, week: looked.week + 1 }, "engineering")).toBeNull();
    const vetted = run(makeTycoonState({ team: zeroTeam({ engineering: 1, hr: 1 }) }), "recruit eng").state;
    const v = listCandidates(vetted, "engineering")!;
    const truth = vetted.people!.candidates.engineering!;
    v.forEach((f, i) => expect([f.shownPace, f.shownCraft, f.quirk, f.vetted]).toEqual([truth[i].pace, truth[i].craft, truth[i].quirk, true]));
  });
});

describe("index exports", () => {
  it("keeps the command list and dispatches each command", () => {
    expect(PEOPLE_COMMANDS).toEqual(["team", "recruit", "fire", "retain"]);
    expect(peopleCommand(makeTycoonState(), "unknown", []).logs[0].text).toBe("Unknown command: unknown.");
    expect(peopleCommand(makeTycoonState(), "fire", []).logs[0].kind).toBe("error");
    expect(typeof runPeopleWeek).toBe("function");
    expect(offerChance(makeTycoonState(), person("e1"))).toBe(0);
  });

  it("status line: null with no roster; counts on builds, offers and tired only when non-zero", () => {
    expect(peopleStatusLine(makeState())).toBeNull();
    expect(peopleStatusLine(stateWith([]))).toBeNull();
    expect(peopleStatusLine(makeTycoonState({ team: zeroTeam({ engineering: 3 }) }))).toBe("People: 3 named | 0 on builds");
    const roster = [
      person("e1", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 59 }),
      person("e2", { engaged: true, offerDueWeek: 4, offerKind: "recruiter" }),
      person("e3", { energy: 60 }),
    ];
    expect(peopleStatusLine(stateWith(roster, { builds: [makeBuild()] }))).toBe("People: 3 named | 1 on builds | 1 holding an offer | 1 tired");
  });

  it("status shows the People line inside the single entry", () => {
    const r = run(makeTycoonState(), "status");
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0].text).toContain("\nPeople: 1 named | 0 on builds");
  });

  it("hints: only the priority-8 'running on fumes' tip, for people on a crunching build at energy 30-44", () => {
    expect(peopleHints(makeTycoonState())).toEqual([]);
    const roster = [
      person("e1", { name: "Leila Demir", engaged: true, buildId: "b1", joinedWeek: 1, energy: 38 }),
      person("e2", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 45 }),
      person("e3", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 29 }),
      person("e4", { engaged: true, buildId: "b2", joinedWeek: 1, energy: 30 }),
      person("e5", { engaged: true, offerDueWeek: 3, offerKind: "recruiter" }),
    ];
    const builds = [makeBuild({ name: "Phoenix", slug: "phoenix", crunch: true }), makeBuild({ id: "b2", slug: "kale" })];
    expect(peopleHints(stateWith(roster, { builds }))).toEqual([
      { text: "Tip: Leila Demir is running on fumes (energy 38). `build crunch phoenix off` before they start interviewing.", priority: 8 },
    ]);
  });

  it("hints: a whole crew going under together is counted in ONE tip, not hidden behind one name (review: 14 burnt out)", () => {
    const roster = [1, 2, 3, 4].map((n) => person(`e${n}`, { engaged: true, buildId: "b1", joinedWeek: 1, energy: n === 2 ? 31 : 40 }));
    const builds = [makeBuild({ name: "Big Push", slug: "big-push", crunch: true })];
    expect(peopleHints(stateWith([...roster, person("e5", { engaged: true, buildId: "b1", joinedWeek: 1, energy: 70 })], { builds }))).toEqual([
      {
        text: "Tip: 4 of 5 people on Big Push are running on fumes (lowest energy 31). `build crunch big-push off` before they all start interviewing at once.",
        priority: 8,
      },
    ]);
  });
});
