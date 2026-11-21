import { describe, expect, it } from "vitest";
import type { Employee, GameState, TeamRoster } from "../../types/game";
import { calcBurn } from "../economy";
import { executeCommand } from "../commands";
import { createInitialState } from "../actions";
import { refreshDerivedNoLog } from "../derived";
import { eventPool } from "../events/pool";
import { toPendingEvent } from "../events/types";
import { computeContext } from "../context";
import { makeBuild, makeEmployee, makeState, makeTycoonState } from "../testHelpers";
import { JOB_AD_TEMPERAMENTS, PEOPLE_SALT, PRODUCT_SALT, QUIRKS, ROSTER_CAP } from "./constants";
import {
  addEmployee, assignEmployee, canAddEmployee, countByRole, craftScore, effTeam, effectiveness, emptyPeople, emptyProduct, ensureSlices,
  findEmployee, leadOf, marketSalary, mintJobAdHire, payrollDelta, peopleRng, productRng, reconcileRoster, removeEmployee, removeEmployees,
  removeHeads, rosterInvariantHolds, rosterOf, shortName, streamSeed, unlistedOf, withSlices,
} from "./roster";
import { chance, pickWeightedIndex } from "../rng";

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0,
  ...counts,
});

const withRoster = (s: GameState, roster: Employee[], extra: Partial<GameState> = {}): GameState => {
  const base = withSlices({ ...s, ...extra });
  const maxSerial = roster.reduce((m, e) => Math.max(m, Number(e.id.slice(1))), 0);
  return { ...base, people: { ...(base.people ?? emptyPeople()), roster, nextId: maxSerial + 1 } };
};

/** Worked example A (TYCOON-SPEC §5.8). */
const exampleA = (): GameState => {
  const s = makeState({ team: team({ engineering: 4, marketing: 2 }) });
  const b1 = makeBuild();
  return withRoster(s, [
    makeEmployee({ id: "e1", name: "Ann One" }),
    makeEmployee({ id: "e2", name: "Bo Two", pace: 4, craft: 2, buildId: "b1", joinedWeek: 1, engaged: true }),
    makeEmployee({ id: "e3", name: "Cy Three", pace: 4, craft: 5, salary: 4550, engaged: true }),
    makeEmployee({ id: "e4", name: "Di Four", pace: 2, craft: 2, salary: 2800, energy: 40, engaged: true }),
    makeEmployee({ id: "e5", name: "Ed Five", role: "marketing", salary: 2600 }),
    makeEmployee({ id: "e6", name: "Flo Six", role: "marketing", pace: 2, craft: 4, salary: 2600 }),
  ], { product: { ...emptyProduct(), active: [b1], nextId: 2 } });
};

describe("effTeam / payrollDelta (G3)", () => {
  it("returns state.team itself and 0 without a slice", () => {
    const s = makeState({ team: team({ engineering: 4, marketing: 2 }) });
    expect(effTeam(s)).toBe(s.team);
    expect(effTeam(s, true)).toBe(s.team);
    expect(payrollDelta(s)).toBe(0);
  });

  it("returns state.team itself and 0 for a roster of unstaffed job-ad hires of every temperament", () => {
    const s = makeState({ team: team({ engineering: 5 }) });
    const roster = JOB_AD_TEMPERAMENTS.map(([pace, craft], i) => makeEmployee({ id: `e${i + 1}`, name: `P ${i}`, pace, craft, quirk: QUIRKS[i] }));
    const t = withRoster(s, roster);
    expect(effTeam(t)).toBe(t.team);
    expect(effTeam(t, true)).toBe(t.team);
    expect(payrollDelta(t)).toBe(0);
    expect(calcBurn(t)).toBe(calcBurn(s));
  });

  it("keeps fractional heads: 6.5 engineers with 6 records stay 6.5", () => {
    const s = makeTycoonState({ team: team({ engineering: 6.5 }) });
    expect(rosterOf(s)).toHaveLength(6);
    expect(effTeam(s).engineering).toBe(6.5);
    const boosted = { ...s, people: { ...s.people!, roster: s.people!.roster.map((e, i) => (i === 0 ? { ...e, pace: 5, craft: 5 } : e)) } };
    expect(effTeam(boosted).engineering).toBeCloseTo(6.9, 10);
  });

  it("reproduces worked example A to the digit", () => {
    const s = exampleA();
    const [, , e3, e4] = rosterOf(s);
    expect(effectiveness(e3)).toBeCloseTo(1.3, 10);
    expect(effectiveness(e4)).toBeCloseTo(0.6933, 4);
    expect(effTeam(s).engineering).toBeCloseTo(3.993, 3);
    expect(effTeam(s).marketing).toBe(2);
    expect(effTeam(s, true).engineering).toBeCloseTo(3.693, 3);
    expect(payrollDelta(s)).toBe(350);
    expect(calcBurn(s)).toBe(21_790);
    const bare = makeState({ team: team({ engineering: 4, marketing: 2 }) });
    expect(calcBurn(bare)).toBe(21_410);
    expect(payrollDelta(s, ["marketing", "sales"])).toBe(0);
    expect(payrollDelta(s, ["engineering"])).toBe(350);
  });

  it("counts a staffed person at 70% only in the weekly view", () => {
    const s = withRoster(makeState({ team: team({ engineering: 1 }) }), [makeEmployee({ buildId: "b1", joinedWeek: 1, engaged: true })], {
      product: { ...emptyProduct(), active: [makeBuild()], nextId: 2 },
    });
    expect(effTeam(s)).toBe(s.team);
    expect(effTeam(s, true).engineering).toBeCloseTo(0.7, 10);
  });

  it("leaves HR, design and the org ratios to bodies", () => {
    const s = withRoster(makeState({ team: team({ engineering: 1, design: 1, hr: 1 }) }), [
      makeEmployee({ id: "e1", pace: 5, craft: 5 }),
      makeEmployee({ id: "e2", role: "design", pace: 5, craft: 5, salary: 2800 }),
      makeEmployee({ id: "e3", role: "hr", pace: 5, craft: 5, salary: 2600 }),
    ]);
    const eff = effTeam(s);
    // effTeam reports every role, but the hooked formulas read only the output roles from it (§5.1).
    expect(eff.engineering).toBeCloseTo(1.4, 10);
    expect(eff.hr).toBeCloseTo(1.4, 10);
    expect(s.team.hr).toBe(1);
  });

  it("never counts more records than whole heads", () => {
    const s = withRoster(makeState({ team: team({ engineering: 1 }) }), [
      makeEmployee({ id: "e1" }),
      makeEmployee({ id: "e2", pace: 5, craft: 5, salary: 9000 }),
    ]);
    expect(effTeam(s)).toBe(s.team);
    expect(payrollDelta(s)).toBe(0);
  });
});

describe("one person", () => {
  it("prices and scores stats as the spec says", () => {
    expect(marketSalary("engineering", 3, 3)).toBe(3500);
    expect(marketSalary("engineering", 1, 4)).toBe(3150);
    expect(craftScore({ craft: 3, quirk: null, shipped: 0 })).toBe(55);
    expect(craftScore({ craft: 5, quirk: null, shipped: 0 })).toBe(85);
    expect(craftScore({ craft: 5, quirk: "craftsperson", shipped: 0 })).toBe(100);
    expect(craftScore({ craft: 3, quirk: "cowboy", shipped: 0 })).toBe(40);
    expect(craftScore({ craft: 4, quirk: null, shipped: 2 })).toBe(76);
    expect(craftScore({ craft: 3, quirk: null, shipped: 9 })).toBe(70);
    expect(effectiveness(makeEmployee({ energy: 30 }))).toBeCloseTo(0.8, 10);
    expect(effectiveness(makeEmployee({ energy: 0 }))).toBeCloseTo(0.6, 10);
    expect(effectiveness(makeEmployee({ pace: 1, craft: 1 }))).toBeCloseTo(0.6, 10);
  });

  it("picks the lead by craft score, then pace, then serial, ignoring zero-fit roles", () => {
    const b = makeBuild();
    const s = withRoster(makeState({ team: team({ engineering: 3, hr: 1 }) }), [
      makeEmployee({ id: "e1", pace: 2, craft: 4, buildId: "b1", joinedWeek: 1, engaged: true }),
      makeEmployee({ id: "e2", pace: 3, craft: 4, buildId: "b1", joinedWeek: 1, engaged: true }),
      makeEmployee({ id: "e3", pace: 3, craft: 4, buildId: "b1", joinedWeek: 1, engaged: true }),
      makeEmployee({ id: "e4", role: "hr", pace: 5, craft: 5, salary: 2600, buildId: "b1", joinedWeek: 1, engaged: true }),
    ], { product: { ...emptyProduct(), active: [b], nextId: 2 } });
    expect(leadOf(s, b)?.id).toBe("e2");
  });
});

describe("reconcileRoster", () => {
  it("is a no-op (same reference) without slices and before setup", () => {
    const legacy = makeState({ team: team({ engineering: 3 }) });
    expect(reconcileRoster(legacy)).toBe(legacy);
    const fresh = createInitialState();
    expect(fresh.people).toBeDefined();
    expect(reconcileRoster(fresh)).toBe(fresh);
  });

  it("builds floor(team[r]) records per role and is idempotent", () => {
    const s = makeTycoonState({ team: team({ engineering: 3, design: 2, hr: 1.5, sales: 0.5 }) });
    expect(countByRole(rosterOf(s))).toMatchObject({ engineering: 3, design: 2, hr: 1, sales: 0 });
    expect(reconcileRoster(s)).toBe(s);
    expect(rosterInvariantHolds(s)).toBe(true);
    expect(unlistedOf(s, "hr")).toBe(0);
  });

  it("treats NaN, negative and infinite counts as zero records", () => {
    const s = makeTycoonState({ team: team({ engineering: Number.NaN, design: -3, data: Number.POSITIVE_INFINITY }) });
    expect(rosterOf(s)).toHaveLength(0);
  });

  it("trims surplus records: never-engaged first, then unstaffed, then lower pace + craft, then newer", () => {
    const b = makeBuild();
    const roster = [
      makeEmployee({ id: "e1", name: "A A", engaged: true, pace: 1, craft: 1 }),
      makeEmployee({ id: "e2", name: "B B", buildId: "b1", joinedWeek: 1 }),
      makeEmployee({ id: "e3", name: "C C", pace: 2, craft: 2 }),
      makeEmployee({ id: "e4", name: "D D" }),
      makeEmployee({ id: "e5", name: "E E" }),
    ];
    const base = withRoster(makeState({ team: team({ engineering: 5 }) }), roster, { product: { ...emptyProduct(), active: [b], nextId: 2 } });
    const order: string[] = [];
    let s = base;
    for (let heads = 4; heads >= 0; heads--) {
      const before = new Set(rosterOf(s).map((e) => e.id));
      s = reconcileRoster({ ...s, team: team({ engineering: heads }) });
      for (const id of before) if (!rosterOf(s).some((e) => e.id === id)) order.push(id);
    }
    expect(order).toEqual(["e3", "e5", "e4", "e2", "e1"]);
    expect(s.people!.departures).toBe(5);
    expect(s.rng).toBe(base.rng);
    expect(s.people!.rng).toBe(base.people!.rng);
  });

  it("spreads a capped roster round-robin and keeps per-role counts under the heads", () => {
    const s = makeTycoonState({ team: team({ engineering: 200, design: 50 }) });
    expect(rosterOf(s)).toHaveLength(ROSTER_CAP);
    expect(countByRole(rosterOf(s))).toMatchObject({ engineering: 70, design: 50 });
    expect(rosterInvariantHolds(s)).toBe(true);
    expect(unlistedOf(s, "engineering")).toBe(130);
  });

  it("`hire eng 5000` caps the roster at 120 and keeps the roster-less burn", () => {
    const cash = 100_000_000;
    const named = executeCommand(makeTycoonState({ cash }), "hire eng 5000").state;
    const legacy = executeCommand(makeState({ cash }), "hire eng 5000").state;
    expect(rosterOf(named)).toHaveLength(ROSTER_CAP);
    expect(named.team.engineering).toBe(5001);
    expect(named.burn).toBe(legacy.burn);
    expect(rosterInvariantHolds(named)).toBe(true);
  });

  it("`hire ux 1.5` lists one designer and keeps the half head", () => {
    const s = executeCommand(makeTycoonState({ team: team({ engineering: 1 }) }), "hire ux 1.5").state;
    expect(s.team.design).toBe(1.5);
    expect(countByRole(rosterOf(s)).design).toBe(1);
    expect(rosterInvariantHolds(s)).toBe(true);
  });

  it("clears dangling build ids", () => {
    const s = withRoster(makeState(), [makeEmployee({ buildId: "b9", joinedWeek: 1, engaged: true })]);
    const r = reconcileRoster(s);
    expect(rosterOf(r)[0]).toMatchObject({ buildId: null, joinedWeek: 0, engaged: true });
  });

  it("follows an event that writes team.hr + 1 directly: one HR record after `choose`", () => {
    const base = makeTycoonState({ team: team({ engineering: 6 }), stress: 60, culture: { cohesion: 40, morale: 50 } });
    const def = eventPool.find((e) => e.id === "bro-culture-incident")!;
    const pending = { ...base, pendingEvent: toPendingEvent(def, base, computeContext(base)) };
    const after = executeCommand(pending, "choose 3").state;
    expect(after.team.hr).toBe(1);
    expect(countByRole(rosterOf(after)).hr).toBe(1);
    expect(rosterInvariantHolds(after)).toBe(true);
  });

  it("touches nothing outside people", () => {
    const s = withSlices(makeState({ team: team({ engineering: 3, sales: 2 }) }));
    const r = reconcileRoster(s);
    const { people: _a, ...restA } = s;
    const { people: _b, ...restB } = r;
    void _a; void _b;
    expect(restB).toEqual(restA);
    expect(r.team).toBe(s.team);
    expect(r.culture).toBe(s.culture);
  });
});

describe("job-ad hires", () => {
  it("are always worth one standard head: 10,000 mints from a fixed seed", () => {
    let rng = streamSeed(4242, PEOPLE_SALT);
    const temperaments = new Map<string, number>();
    let quirks = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const made = mintJobAdHire(emptyPeople(), rng, "engineering", 7);
      rng = made.rng;
      const e = made.people.roster[0];
      expect(e.pace + e.craft).toBe(6);
      expect(e.salary).toBe(3500);
      expect(e.energy).toBe(100);
      expect(e.engaged).toBe(false);
      expect(e.leadOnNotice).toBeNull();
      expect(effectiveness(e)).toBe(1);
      temperaments.set(`${e.pace}/${e.craft}`, (temperaments.get(`${e.pace}/${e.craft}`) ?? 0) + 1);
      if (e.quirk) quirks += 1;
    }
    for (const [pace, craft, weight] of JOB_AD_TEMPERAMENTS) {
      expect(Math.abs((temperaments.get(`${pace}/${craft}`) ?? 0) / N - weight / 100)).toBeLessThan(0.02);
    }
    expect(Math.abs(quirks / N - 0.25)).toBeLessThan(0.02);
  });
});

describe("primitives", () => {
  it("addEmployee raises team[role] together with the record", () => {
    const s = makeTycoonState({ team: team({ engineering: 1 }) });
    const added = addEmployee(s, { name: "New Person", role: "sales", pace: 4, craft: 4, quirk: null, salary: 3600, energy: 100, engaged: true });
    expect(added).not.toBeNull();
    expect(added!.state.team.sales).toBe(1);
    expect(rosterOf(added!.state).find((e) => e.id === added!.id)).toMatchObject({ role: "sales", engaged: true, hiredWeek: s.week, leadOnNotice: null });
    expect(rosterInvariantHolds(added!.state)).toBe(true);
  });

  it("addEmployee at the cap displaces the newest never-engaged unstaffed nameplate, and refuses when none can go", () => {
    const s = makeTycoonState({ team: team({ engineering: 130 }) });
    const added = addEmployee(s, { name: "Star Hire", role: "engineering", pace: 5, craft: 5, quirk: null, salary: 4900, energy: 100, engaged: true })!;
    expect(rosterOf(added.state)).toHaveLength(ROSTER_CAP);
    expect(added.state.team.engineering).toBe(131);
    expect(rosterOf(added.state).some((e) => e.id === "e120")).toBe(false);
    const allEngaged = { ...s, people: { ...s.people!, roster: s.people!.roster.map((e) => ({ ...e, engaged: true })) } };
    expect(canAddEmployee(allEngaged)).toBe(false);
    expect(addEmployee(allEngaged, { name: "X Y", role: "engineering", pace: 3, craft: 3, quirk: null, salary: 3500, energy: 100, engaged: true })).toBeNull();
  });

  it("removeEmployee lowers team and lastWeek.teamSize (floored at 0) and counts a departure", () => {
    const s = makeTycoonState({ team: team({ engineering: 2 }), lastWeek: { users: 90, mrr: 900, cash: 104_000, teamSize: 0 } });
    const r = removeEmployee(s, "e1");
    expect(r.employee?.id).toBe("e1");
    expect(r.ledBuild).toBeNull();
    expect(r.state.team.engineering).toBe(1);
    expect(r.state.lastWeek.teamSize).toBe(0);
    expect(r.state.people!.departures).toBe(1);
    expect(rosterInvariantHolds(r.state)).toBe(true);
    expect(removeEmployee(s, "e99").state).toBe(s);
  });

  const leadState = (lead: Partial<Employee>, build = makeBuild({ progress: 12, scope: 12, qSum: 12 * 60, qPts: 12, polish: 4, readyWeek: 3 })) =>
    withRoster(makeState({ team: team({ engineering: 2 }), week: 5 }), [
      makeEmployee({ id: "e1", name: "Lead Person", craft: 5, pace: 1, buildId: "b1", joinedWeek: 2, engaged: true, ...lead }),
      makeEmployee({ id: "e2", name: "Other Person", buildId: "b1", joinedWeek: 2, engaged: true }),
    ], { product: { ...emptyProduct(), active: [build, makeBuild({ id: "b2", slug: "kale", name: "Kale" })], nextId: 3 } });

  it("removeEmployee applies the lead rule to progress, qSum and qPts and clears built status", () => {
    const r = removeEmployee(leadState({}), "e1");
    expect(r.ledBuild).toMatchObject({ id: "b1", progress: 9, qSum: 540, qPts: 9, polish: 4, readyWeek: 0 });
    expect(r.state.product!.active[0]).toEqual(r.ledBuild);
    expect(r.ledBuild!.qSum / r.ledBuild!.qPts).toBe(60);
    const nonLead = removeEmployee(leadState({}), "e2");
    expect(nonLead.ledBuild).toBeNull();
    expect(nonLead.state.product!.active[0].progress).toBe(12);
  });

  it("the lead rule follows leadOnNotice even after the person was moved off or out-crafted", () => {
    const moved = leadState({ buildId: null, joinedWeek: 0, offerDueWeek: 7, offerKind: "recruiter", leadOnNotice: "b1" });
    expect(removeEmployee(moved, "e1").ledBuild?.id).toBe("b1");
    const outCrafted = leadState({ craft: 1, offerDueWeek: 7, offerKind: "recruiter", leadOnNotice: "b1" });
    expect(leadOf(outCrafted, outCrafted.product!.active[0])?.id).toBe("e2");
    expect(removeEmployee(outCrafted, "e1").ledBuild?.id).toBe("b1");
    const gone = { ...moved, product: { ...moved.product!, active: moved.product!.active.filter((b) => b.id !== "b1") } };
    const r = removeEmployee(gone, "e1");
    expect(r.ledBuild).toBeNull();
    expect(r.state.product).toEqual(gone.product);
  });

  it("removeEmployees: the lead rule is read before anyone in the batch goes, one quarter per build (ERRATA 65)", () => {
    // e1 leads b1; e2 inherits the lead once e1 is gone. Removing both in one batch charges b1 once (sequential removals charged it twice).
    const s = leadState({});
    const twice = removeEmployee(removeEmployee(s, "e1").state, "e2");
    expect(twice.state.product!.active[0].progress).toBeCloseTo(6.75, 10); // the old, compounding path: 12 x 0.75 x 0.75
    const batch = removeEmployees(s, ["e1", "e2"]);
    expect(batch.state.product!.active[0]).toMatchObject({ progress: 9, qSum: 540, qPts: 9, polish: 4, readyWeek: 0 });
    expect(batch.lost.map((l) => [l.build.id, l.byId])).toEqual([["b1", "e1"]]);
    expect(batch.removed.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(batch.state.team.engineering).toBe(0);
    expect(batch.state.people!.departures).toBe(2);
    expect(rosterInvariantHolds(batch.state)).toBe(true);
    // Unknown and repeated ids are skipped; an empty batch is the same reference.
    expect(removeEmployees(s, ["e9"]).state).toBe(s);
    expect(removeEmployees(s, ["e2", "e2"]).removed).toHaveLength(1);
  });

  it("removeEmployees: two leads of two different builds each cost their own build a quarter", () => {
    const s = withRoster(makeState({ team: team({ engineering: 2 }), week: 5 }), [
      makeEmployee({ id: "e1", name: "Lead One", craft: 5, buildId: "b1", joinedWeek: 2, engaged: true }),
      makeEmployee({ id: "e2", name: "Lead Two", craft: 5, buildId: "b2", joinedWeek: 2, engaged: true }),
    ], { product: { ...emptyProduct(), active: [makeBuild({ progress: 8 }), makeBuild({ id: "b2", slug: "kale", name: "Kale", progress: 4 })], nextId: 3 } });
    const r = removeEmployees(s, ["e1", "e2"]);
    expect(r.state.product!.active.map((b) => b.progress)).toEqual([6, 3]);
    expect(r.lost.map((l) => l.byId)).toEqual(["e1", "e2"]);
  });

  it("removeHeads lowers fractional counts and floors lastWeek.teamSize", () => {
    const s = removeHeads(makeState({ team: team({ design: 1.5 }) }), "design", 1);
    expect(s.team.design).toBe(0.5);
    expect(removeHeads(makeState(), "engineering", 3).team.engineering).toBe(0);
    expect(removeHeads(makeState(), "engineering", 3).lastWeek.teamSize).toBe(0);
  });

  it("assignEmployee sets joinedWeek and engaged, and is a no-op when nothing changes", () => {
    const s = withRoster(makeState({ week: 9 }), [makeEmployee()], { product: { ...emptyProduct(), active: [makeBuild()], nextId: 2 } });
    const on = assignEmployee(s, "e1", "b1");
    expect(rosterOf(on)[0]).toMatchObject({ buildId: "b1", joinedWeek: 9, engaged: true });
    expect(assignEmployee(on, "e1", "b1")).toBe(on);
    const off = assignEmployee(on, "e1", null);
    expect(rosterOf(off)[0]).toMatchObject({ buildId: null, joinedWeek: 0, engaged: true });
    expect(assignEmployee(s, "e42", "b1")).toBe(s);
  });

  it("findEmployee resolves ids, #n, full names and unique prefixes, and explains failures", () => {
    const s = withRoster(makeState({ team: team({ engineering: 5 }) }), [
      makeEmployee({ id: "e1", name: "Mei Kowalski" }),
      makeEmployee({ id: "e4", name: "Mei Tanaka" }),
      makeEmployee({ id: "e9", name: "Nadia Nkosi" }),
      makeEmployee({ id: "e12", name: "Nadia Nwosu" }),
      makeEmployee({ id: "e13", name: "Nadia Novak" }),
    ]);
    const id = (q: string) => {
      const r = findEmployee(s, q);
      return r.ok ? r.employee.id : r.error;
    };
    expect(id("e12")).toBe("e12");
    expect(id("#12")).toBe("e12");
    expect(id("mei kowalski")).toBe("e1");
    expect(id("tanaka")).toBe("e4");
    expect(id("Nkos")).toBe("e9");
    expect(id("")).toBe("Who? Use a name or an id from `team`.");
    expect(id("zed")).toBe('Nobody called "zed" works here. `team` lists who does.');
    expect(id("mei")).toBe('"mei" matches 2 people: Mei Kowalski (e1), Mei Tanaka (e4). Use the id.');
    const crowd = withRoster(s, [...rosterOf(s), makeEmployee({ id: "e14", name: "Nadia Nair" }), makeEmployee({ id: "e15", name: "Nadia Ito" })]);
    const many = findEmployee(crowd, "nadia");
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error).toBe('"nadia" matches 5 people: Nadia Nkosi (e9), Nadia Nwosu (e12), Nadia Novak (e13), Nadia Nair (e14), .... Use the id.');
  });
});

describe("shortName", () => {
  it("is the first name when typing it finds exactly that person, else the name plus the id", () => {
    const s = withRoster(makeState({ team: team({ engineering: 3 }) }), [
      makeEmployee({ id: "e1", name: "Arjun Conti" }), makeEmployee({ id: "e2", name: "Arjun Demir" }), makeEmployee({ id: "e3", name: "Petra Sato" }),
    ]);
    expect(rosterOf(s).map((e) => shortName(s, e))).toEqual(["Arjun (e1)", "Arjun (e2)", "Petra"]);
  });
});

describe("RNG streams (G4)", () => {
  it("never seeds xorshift with 0", () => {
    expect(streamSeed(0, PEOPLE_SALT)).not.toBe(0);
    expect(streamSeed(PEOPLE_SALT, PEOPLE_SALT)).toBe(1);
    expect(streamSeed(PRODUCT_SALT, PRODUCT_SALT)).toBe(1);
  });

  it("small typed seeds still draw varied first people and first codenames (review: seeds 1..100 all drew a 3/3, ERRATA 64)", () => {
    let standard = 0;
    let firstHits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const t = pickWeightedIndex(streamSeed(seed, PEOPLE_SALT), JOB_AD_TEMPERAMENTS.map((row) => row[2]));
      if (t.value === 0) standard += 1;
      if (chance(streamSeed(seed, PRODUCT_SALT), 0.16).value) firstHits += 1;
    }
    expect(standard).toBeGreaterThan(70); // fair: ~100 of 200 (it was 200 of 200 before the mix)
    expect(standard).toBeLessThan(130);
    expect(firstHits).toBeGreaterThan(15); // fair: ~32 of 200 (it was 0 of 200)
    expect(firstHits).toBeLessThan(55);
  });

  it("seeds lazily from the current seed", () => {
    const s = withSlices(makeState({ seed: 99 }));
    expect(s.people!.rng).toBe(0);
    expect(peopleRng(s)).toBe(streamSeed(99, PEOPLE_SALT));
    expect(productRng(s)).toBe(streamSeed(99, PRODUCT_SALT));
    const r = ensureSlices(s);
    expect(r.people!.rng).not.toBe(0);
    expect(r.rng).toBe(s.rng);
  });

  const setup = (seedCmd: string | null): GameState => {
    let s = refreshDerivedNoLog({ ...createInitialState(), seed: 1, rng: 1 });
    for (const cmd of [...(seedCmd ? [seedCmd] : []), "name Ada", "company Lovelace", "founder hacker", "cofounder operator"]) {
      s = executeCommand(s, cmd).state;
    }
    return s;
  };

  it("mints the starting engineer when setup completes, named by the seed typed before it", () => {
    const a = setup("seed alpha");
    const b = setup("seed beta");
    expect(rosterOf(a)).toHaveLength(1);
    expect(rosterOf(a)[0]).toMatchObject({ id: "e1", role: "engineering", hiredWeek: 1 });
    expect(rosterOf(a)[0].name).not.toBe(rosterOf(b)[0].name);
    expect(setup("seed alpha")).toEqual(a);
  });

  it("writes the stream back only when it draws", () => {
    const s = makeTycoonState({ team: team({ engineering: 2 }) });
    const viewed = executeCommand(s, "status").state;
    expect(viewed.people).toBe(s.people);
    const hired = executeCommand(s, "hire eng 1").state;
    expect(hired.people!.rng).not.toBe(s.people!.rng);
    expect(hired.rng).toBe(s.rng);
  });
});
