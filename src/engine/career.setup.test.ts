import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { officeFor } from "./career";
import { CAREER_RULES, CAREER_TEST, atTurn, careerOf, newCareer, withCareer, withCareerOf, withEras } from "./careerKit";
import { INCUMBENT, newGame, resolve } from "./testKit";
import type { EraConfig } from "./types";
import { publicCompany } from "./view";

describe("a career's opening state", () => {
  it("a race game has no career facts at all", () => {
    for (const company of newGame().companies) expect("career" in company).toBe(false);
  });

  it("a career opens with every company's career facts", () => {
    expect(newCareer().companies.map((company) => company.career)).toEqual([
      { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
      { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
      { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
      // 8 people: the shared office.
      { founded: 1, office: 1, listed: null, rescue: null, qualityAtLastClose: 30, qualified: false },
    ]);
  });

  it("a career keeps track of a wave of new users, at rest to begin with; a race has none", () => {
    expect(newCareer().wave).toEqual({ multiplier: 1, turnsLeft: 0 });
    expect("wave" in newGame()).toBe(false);
  });

  it("the smallest office that holds the team, and the last one beyond that", () => {
    expect([1, 4, 5, 9, 10, 22, 23, 40, 41, 150, 151].map((n) => officeFor(n, CAREER_RULES))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
  });

  it("what rivals see of a career leaves out the bookkeeping", () => {
    expect(publicCompany(newCareer().companies[3]).career).toEqual({ founded: 1, office: 1, listed: null, rescue: null });
    expect("career" in publicCompany(newGame().companies[3])).toBe(false);
  });

  it("a year keeps every company's career facts, and the wave", () => {
    const next = resolve(newCareer(), {}, 1, CAREER_TEST).state;
    expect(next.companies.map((company) => company.career?.founded)).toEqual([1, 1, 1, 1]);
    expect(next.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
    expect("wave" in resolve(newGame(), {}, 1, DESIGN).state).toBe(false);
  });
});

// The later rule tests are built on these helpers, so what each one does is pinned here.
describe("the career's test kit", () => {
  it("changes some of the career's rules and leaves the rest of the config alone", () => {
    const patched = withCareer({ shiftNoticeYears: 3 });
    expect(patched.career).toEqual({ ...CAREER_RULES, shiftNoticeYears: 3 });
    expect({ ...patched, career: CAREER_RULES }).toEqual(CAREER_TEST);
  });

  it("changes them on another config when it is handed one", () => {
    const dearer = { ...CAREER_TEST, salary: 2 * DESIGN.salary };
    expect(withCareer({ shiftNoticeYears: 3 }, dearer)).toEqual({ ...dearer, career: { ...CAREER_RULES, shiftNoticeYears: 3 } });
    // A config with no career gets the kit's rules, then the change.
    expect(withCareer({ shiftNoticeYears: 3 }, DESIGN)).toEqual({ ...DESIGN, career: { ...CAREER_RULES, shiftNoticeYears: 3 } });
  });

  it("swaps the eras for the ones it is given", () => {
    const early: EraConfig = { id: "a", name: "A", firstYear: 1990, invented: false, values: {} };
    const late: EraConfig = { id: "b", name: "B", firstYear: 1993, invented: true, values: { salary: 2 * DESIGN.salary } };
    expect(withEras(early, late)).toEqual({ ...CAREER_TEST, career: { ...CAREER_RULES, eras: [early, late] } });
  });

  it("dates a state to another turn and changes nothing else", () => {
    const game = newCareer();
    expect(atTurn(game, 7)).toEqual({ ...game, turn: 7 });
    expect(game.turn).toBe(1);
  });

  it("reads one company's career facts, and refuses a company that has none", () => {
    const game = newCareer();
    expect(careerOf(game, INCUMBENT)).toBe(game.companies[INCUMBENT].career);
    expect(() => careerOf(newGame(), INCUMBENT)).toThrow();
  });

  it("replaces some of one company's career facts", () => {
    const game = newCareer();
    const moved = withCareerOf(game, INCUMBENT, { office: 2 });
    expect(moved.companies.map((company) => company.career?.office)).toEqual([0, 0, 0, 2]);
    expect(careerOf(moved, INCUMBENT)).toEqual({ ...careerOf(game, INCUMBENT), office: 2 });
    expect(careerOf(game, INCUMBENT).office).toBe(1);
  });
});
