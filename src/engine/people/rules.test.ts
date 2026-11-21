import { describe, expect, it } from "vitest";
import type { Asset, AssetId, GameState } from "../../types/game";
import { makeEmployee, makeState } from "../testHelpers";
import { craftScore } from "../tycoon/roster";
import { talentPull } from "./candidates";
import {
  crunchDrain, departFallout, energyRecovery, energyWordOf, fireFallout, noticeWeeks, offerChance, retainBonus, retainSalary, severanceOf,
} from "./rules";
import { zeroTeam } from "./testKit";

// Every people formula of TYCOON-SPEC §5.3 with the spec's numbers, including worked example C.

const at = (week: number, extra: Partial<GameState> = {}): GameState =>
  makeState({ week, cofounder: { name: "C", archetype: "builder", trust: 70, ego: 30, ambition: 50 }, ...extra });
const engaged = (overrides = {}) => makeEmployee({ engaged: true, hiredWeek: 1, ...overrides });

describe("offerChance", () => {
  it("is 0 for anyone the player never worked with, anyone holding notice, believers, the first month and 12 weeks after a retain", () => {
    const s = at(20);
    expect(offerChance(s, makeEmployee({ engaged: false, pace: 5, craft: 5 }))).toBe(0);
    expect(offerChance(s, engaged({ offerDueWeek: 22, offerKind: "recruiter" }))).toBe(0);
    expect(offerChance(s, engaged({ quirk: "believer", pace: 5, craft: 5 }))).toBe(0);
    expect(offerChance(s, engaged({ hiredWeek: 17 }))).toBe(0); // tenure 3 < 4
    expect(offerChance(s, engaged({ hiredWeek: 16 }))).toBeCloseTo(0.002, 10); // tenure 4
    expect(offerChance(s, engaged({ retainedWeek: 8 }))).toBe(0); // 12 weeks ago: still immune
    expect(offerChance(s, engaged({ retainedWeek: 7 }))).toBeCloseTo(0.002, 10); // 13 weeks ago
  });

  it("adds the per-skill term only above 6, the led bonus inside 6 weeks, and the tired bonus under 50", () => {
    const s = at(20);
    expect(offerChance(s, engaged({ pace: 1, craft: 4 }))).toBeCloseTo(0.002, 10);
    expect(offerChance(s, engaged({ pace: 5, craft: 5 }))).toBeCloseTo(0.002 + 0.006 * 4, 10); // 2.6%
    expect(offerChance(s, engaged({ ledWeek: 14 }))).toBeCloseTo(0.082, 10);
    expect(offerChance(s, engaged({ ledWeek: 13 }))).toBeCloseTo(0.002, 10);
    expect(offerChance(s, engaged({ energy: 49 }))).toBeCloseTo(0.042, 10);
    expect(offerChance(s, engaged({ energy: 50 }))).toBeCloseTo(0.002, 10);
  });

  it("doubles for mercenaries and scales by HR (0.6) and an operator cofounder (0.8)", () => {
    const base = engaged({ pace: 5, craft: 5 });
    const p = 0.026;
    expect(offerChance(at(20), { ...base, quirk: "mercenary" })).toBeCloseTo(p * 2, 10);
    expect(offerChance(at(20, { team: zeroTeam({ engineering: 1, hr: 1 }) }), base)).toBeCloseTo(p * 0.6, 10);
    expect(offerChance(at(20, { team: zeroTeam({ engineering: 1, hr: 0.5 }) }), base)).toBeCloseTo(p, 10); // half an HR person is not HR
    expect(offerChance(makeState({ week: 20 }), base)).toBeCloseTo(p * 0.8, 10); // makeState's cofounder is an operator
  });

  it("worked example C: Nadia (pace 1, craft 4) after leading Plan B in week 26 → 8.2% a week at week 29", () => {
    const nadia = engaged({ pace: 1, craft: 4, shipped: 2, salary: 3800, hiredWeek: 7, ledWeek: 26 });
    expect(craftScore(nadia)).toBe(76);
    expect(offerChance(at(29), nadia)).toBeCloseTo(0.082, 10);
    expect(offerChance(at(32), nadia)).toBeCloseTo(0.082, 10);
    expect(offerChance(at(33), nadia)).toBeCloseTo(0.002, 10);
  });
});

describe("prices", () => {
  it("retain: two weeks' pay, then max(+50, round50(x1.1)) — worked example C: $7,600 and $4,200", () => {
    expect(retainBonus({ salary: 3800 })).toBe(7600);
    expect(retainSalary({ salary: 3800 })).toBe(4200);
    expect(retainSalary({ salary: 300 })).toBe(350); // round50(330) = 350
    expect(retainSalary({ salary: 200 })).toBe(250); // round50(220) = 200 → the +$50 floor
    expect(retainSalary({ salary: 3500 })).toBe(3850);
  });

  it("severance is two weeks of pay", () => {
    expect(severanceOf(2400)).toBe(4800);
  });

  it("notice is two weeks, three with a whole HR head", () => {
    expect(noticeWeeks(makeState())).toBe(2);
    expect(noticeWeeks(makeState({ team: zeroTeam({ hr: 1 }) }))).toBe(3);
    expect(noticeWeeks(makeState({ team: zeroTeam({ hr: 0.5 }) }))).toBe(2);
  });
});

describe("fallout", () => {
  it("fire: morale 3 / cohesion 2 for one, +2 each per extra person, capped 12 / 10, HR halves (min 1)", () => {
    expect(fireFallout(1, false)).toEqual({ morale: 3, cohesion: 2 });
    expect(fireFallout(3, false)).toEqual({ morale: 7, cohesion: 6 });
    expect(fireFallout(10, false)).toEqual({ morale: 12, cohesion: 10 });
    expect(fireFallout(1, true)).toEqual({ morale: 2, cohesion: 1 }); // round(1.5) = 2, round(1) = 1
    expect(fireFallout(3, true)).toEqual({ morale: 4, cohesion: 3 }); // round(3.5) = 4
    expect(fireFallout(10, true)).toEqual({ morale: 6, cohesion: 5 });
  });

  it("a resignation: morale -2, cohesion -1, glue -3", () => {
    expect(departFallout({ quirk: null })).toEqual({ morale: 2, cohesion: 1 });
    expect(departFallout({ quirk: "glue" })).toEqual({ morale: 2, cohesion: 3 });
  });
});

describe("energy", () => {
  it("crunch drains 15, firefighters 8, believers 20", () => {
    expect(crunchDrain({ quirk: null })).toBe(15);
    expect(crunchDrain({ quirk: "cowboy" })).toBe(15);
    expect(crunchDrain({ quirk: "firefighter" })).toBe(8);
    expect(crunchDrain({ quirk: "believer" })).toBe(20);
  });

  it("recovery is 5, +2 with HR, + round(0.5 x Σ moraleBoost) capped at 3", () => {
    expect(energyRecovery(makeState())).toBe(5);
    expect(energyRecovery(makeState({ team: zeroTeam({ hr: 1 }) }))).toBe(7);
    const asset = (id: AssetId): Asset => ({ id, name: id, purchaseWeek: 1 });
    expect(energyRecovery(makeState({ assets: [asset("office-upgrade")] }))).toBe(6);
    expect(energyRecovery(makeState({ assets: [asset("lounge")] }))).toBe(7);
    expect(energyRecovery(makeState({ assets: [asset("yacht")] }))).toBe(8);
    expect(energyRecovery(makeState({ assets: [asset("lounge"), asset("yacht")], team: zeroTeam({ hr: 2 }) }))).toBe(10);
    expect(energyRecovery(makeState({ assets: [asset("jet")] }))).toBe(5); // no moraleBoost
  });

  it("words: 85+ fresh, 60-84 fine, 45-59 tired, 30-44 running on fumes, under 30 burnt out", () => {
    expect([100, 85, 84, 60, 59, 45, 44, 30, 29, 0].map(energyWordOf)).toEqual([
      "fresh", "fresh", "fine", "fine", "tired", "tired", "running on fumes", "running on fumes", "burnt out", "burnt out",
    ]);
  });
});

describe("talentPull", () => {
  it("0.6 x reputation/100 + 0.15 per whole HR head (max 2) + visionary 0.1 + rainmaker 0.1, clamped to 0..1", () => {
    expect(talentPull(makeState({ reputation: 50 }))).toBeCloseTo(0.3, 10);
    expect(talentPull(makeState({ reputation: 50, team: zeroTeam({ hr: 3.5 }) }))).toBeCloseTo(0.6, 10);
    expect(talentPull(makeState({ reputation: 50, team: zeroTeam({ hr: 1.9 }) }))).toBeCloseTo(0.45, 10);
    const both = makeState({
      reputation: 100, team: zeroTeam({ hr: 2 }),
      founder: { name: "F", archetype: "visionary" }, cofounder: { name: "C", archetype: "rainmaker", trust: 70, ego: 30, ambition: 50 },
    });
    expect(talentPull(both)).toBe(1);
    expect(talentPull(makeState({ reputation: -50 }))).toBe(0);
  });
});
