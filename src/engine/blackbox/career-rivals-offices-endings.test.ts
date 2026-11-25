// Black-box tests for the career's rules C8 (who you play against, and how rivals come and go), C9 (offices) and
// C10 (the end), with the rulings of docs/career-rules.md that belong to them (6, 7, 31 to 39, 41).
//
// Written from docs/superpowers/specs/2026-11-25-career-3d-design.md (sections 5 and 6), docs/career-rules.md and
// docs/turn-based-design.md alone, without reading the engine or its tests. Every expected number is worked out by
// hand in the comment beside it.
//
// The numbers are CAREER_TEST's: the race's design numbers (salary $40K, hiring fee $10K, 6 candidates, hiring
// capacity 2 × Recruiting work, poach $50K, poach floor 2, valuation $150 a user, startup cash $500K, Incumbent $3M
// / 8 people / 10K users) with the career's own rules (offices 4 / 9 / 22 / 40 / 150, moving bill half a year of
// salary, a newcomer two years after a rival goes out, any of the three styles). Events are off unless a test
// dates a card.
//
// How scenarios are kept exact:
//  - The startups' default plan is 3 on Product, 0 on Recruiting: they hire nobody. The Incumbent's default plan is
//    5 / 2 / 1, so its hiring capacity is round(2 × 8^0.8 × 1/8) = round(1.32) = 1, and with hype 20 it picks first.
//  - Three people on Recruiting give a capacity of round(2 × 3^0.9) = round(5.38) = 5; four give round(6.96) = 7.
//  - For the final ranking an era with no new users and no churn keeps every company's users where they were, and
//    hype 0 stays 0 (0 × 0.6 decay), so each valuation is exactly users × $150.

import { describe, expect, it } from "vitest";
import { CAREER_DESIGN } from "../../config.design";
import {
  createGame,
  hiresWithinCap,
  normalizePlan,
  officeFor,
  officeMove,
  peopleCap,
  projectTurn,
  resolveTurn,
  turnOf,
  viewFor,
  yearOf,
} from "../index";
import type { TurnResult } from "../index";
import { CAREER_RULES, CAREER_TEST, atTurn, careerOf, newCareer, outSince, withCareer, withCareerOf, withEras } from "../careerKit";
import { BLITZ, BOOT, FOUR_SEATS, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, planOf, plansOf, reportFor, withCompany } from "../testKit";
import type { CompanyId, DatedCard, GameState, Plan } from "../types";
import type { GameConfig } from "../../config";

// ── Helpers ──

const play = (
  state: GameState,
  patches: Readonly<Record<number, Partial<Plan>>> = {},
  seed = 1,
  config: GameConfig = CAREER_TEST,
): TurnResult => resolveTurn(state, plansOf(state, patches), seed, config);

const RECRUIT_3 = { allocation: { product: 0, growth: 0, recruiting: 3 } };

/** A career config with one era whose market is frozen: no new users, no churn. */
const FROZEN: GameConfig = withEras({
  id: "frozen",
  name: "Frozen",
  firstYear: 1990,
  invented: false,
  values: { market: { newUsersTurn1: 0 }, churn: { base: 0, perQualityPoint: 0, min: 0 } },
});

/**
 * The final year with every company launched at quality 50 and hype 0, holding these users and founder equity.
 * Valuation as the year closes = users × $150; founder stake = equity × valuation.
 */
const finalYear = (
  stakes: Readonly<Record<number, { users: number; equity: number }>>,
  base: GameState = newCareer(FROZEN),
): GameState => {
  let state = atTurn(base, 49);
  for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) {
    const stake = stakes[id];
    if (stake === undefined) continue;
    state = launchedCompany(state, id, { users: stake.users, hype: 0, founderEquity: stake.equity });
  }
  return state;
};

/** A company whose one rescue is already spent, so its next failure is final. */
const rescueSpent = (state: GameState, id: CompanyId): GameState => withCareerOf(state, id, { rescue: { turn: 1, reason: "bankrupt" } });

// ── C8: who you play against ──

describe("C8: the four companies of 1990", () => {
  it("opens with four companies, all founded in the first turn", () => {
    const state = newCareer();
    expect(state.companies).toHaveLength(4);
    expect(state.companies.map((company) => careerOf(state, company.id).founded)).toEqual([1, 1, 1, 1]);
  });

  it("gives the player, the Blitzscaler and the Bootstrapper the startup's numbers", () => {
    const state = newCareer();
    for (const id of [HUMAN, BLITZ, BOOT]) {
      const company = state.companies[id];
      expect(company.archetype).toBe("startup");
      expect(company).toMatchObject({ cash: 500_000, headcount: 3, users: 0, quality: 0, hype: 10, founderEquity: 1, founderSeats: 2, investorSeats: 0 });
    }
  });

  it("gives the Incumbent its own head start", () => {
    const company = newCareer().companies[INCUMBENT];
    expect(company.archetype).toBe("incumbent");
    expect(company).toMatchObject({ cash: 3_000_000, headcount: 8, users: 10_000, quality: 30, hype: 20, founderEquity: 0.6, founderSeats: 2, investorSeats: 1 });
  });

  it("reads the startup's cash from the first year's era", () => {
    const config = withEras({ id: "a", name: "A", firstYear: 1990, invented: false, values: { archetypes: { startup: { cash: 400_000 } } } });
    expect(newCareer(config).companies[HUMAN].cash).toBe(400_000);
  });

  it("starts every company unlisted, unrescued and not yet qualified", () => {
    const state = newCareer();
    for (const company of state.companies) {
      expect(careerOf(state, company.id)).toMatchObject({ listed: null, rescue: null, qualified: false });
    }
  });

  it("gives a race game no career facts at all", () => {
    const state = newGame();
    expect(state.companies.every((company) => company.career === undefined)).toBe(true);
    expect(state.wave).toBeUndefined();
  });
});

describe("C8: a newcomer takes a rival's seat two years after it goes out", () => {
  it("does not refill a seat in the year its company goes out", () => {
    // The Blitzscaler has $0 and a payroll of 3 × $40K: it ends the year at −$120K with its rescue spent.
    const state = rescueSpent(withCompany(atTurn(newCareer(), 5), BLITZ, { cash: 0 }), BLITZ);
    const result = play(state);
    expect(reportFor(result, BLITZ).out).toBe("bankrupt");
    expect(result.log.entrants).toEqual([]);
    expect(result.state.companies[BLITZ].out).not.toBeNull();
  });

  it("refills it in the next year's closing, so the newcomer plans from year Y + 2", () => {
    const state = rescueSpent(withCompany(atTurn(newCareer(), 5), BLITZ, { cash: 0 }), BLITZ);
    const wentOut = play(state).state; // out in turn 5, now turn 6
    const next = play(wentOut, {}, 2);
    expect(next.log.entrants).toEqual([BLITZ]);
    expect(next.state.turn).toBe(7);
    expect(next.state.companies[BLITZ].out).toBeNull();
    expect(careerOf(next.state, BLITZ).founded).toBe(7); // 5 + 2
  });

  it("refills a seat out since turn 3 at the close of turn 4", () => {
    // The coming year is 5, and 5 − 3 = 2 years: enough.
    const result = play(outSince(atTurn(newCareer(), 4), BOOT, 3));
    expect(result.log.entrants).toEqual([BOOT]);
    expect(careerOf(result.state, BOOT).founded).toBe(5);
  });

  it("waits as many years as replacement.afterYears says", () => {
    const config = withCareer({ replacement: { afterYears: 3, styles: ["blitzscaler", "bootstrapper", "incumbent"] } });
    // Out in turn 3: the coming year must be at least 6.
    const tooEarly = play(outSince(atTurn(newCareer(config), 4), BOOT, 3), {}, 1, config);
    expect(tooEarly.log.entrants).toEqual([]);
    const onTime = play(outSince(atTurn(newCareer(config), 5), BOOT, 3), {}, 1, config);
    expect(onTime.log.entrants).toEqual([BOOT]);
    expect(careerOf(onTime.state, BOOT).founded).toBe(6);
  });

  it("never refills the player's seat", () => {
    const result = play(outSince(atTurn(newCareer(), 10), HUMAN, 1));
    expect(result.log.entrants).toEqual([]);
    expect(result.state.companies[HUMAN].out).not.toBeNull();
  });

  it("never refills a seat played by the simulator's baseline bot", () => {
    const setup = { seats: [{ ...FOUR_SEATS.seats[0], controller: "baseline" as const }, ...FOUR_SEATS.seats.slice(1)] };
    const state = outSince(atTurn(createGame(setup, CAREER_TEST), 10), HUMAN, 1);
    const result = play(state);
    expect(result.log.entrants).toEqual([]);
    expect(result.state.companies[HUMAN].out).not.toBeNull();
  });

  it("lists an empty set of entrants in a career year when nobody enters", () => {
    expect(play(newCareer()).log.entrants).toEqual([]);
  });

  it("has no entrants key in a race log", () => {
    const race = newGame();
    const result = resolveTurn(race, plansOf(race), 1);
    expect(result.log.entrants).toBeUndefined();
  });

  it("refills several seats in the same year, in seat order", () => {
    let state = atTurn(newCareer(), 4);
    state = outSince(outSince(outSince(state, INCUMBENT, 1), BOOT, 2), BLITZ, 1);
    const result = play(state);
    expect(result.log.entrants).toEqual([BLITZ, BOOT, INCUMBENT]);
    expect(result.state.companies).toHaveLength(4);
    expect(result.state.companies.every((company) => company.out === null)).toBe(true);
  });

  it("refills a seat again when its newcomer goes out in turn", () => {
    let state = atTurn(newCareer(), 8);
    state = withCareerOf(state, BLITZ, { founded: 5 });
    state = outSince(state, BLITZ, 7);
    const result = play(state);
    expect(result.log.entrants).toEqual([BLITZ]);
    expect(careerOf(result.state, BLITZ).founded).toBe(9);
  });

  it("never seats more than four companies", () => {
    let state = atTurn(newCareer(), 3);
    state = outSince(state, BLITZ, 1);
    for (let year = 0; year < 4; year++) state = play(state, {}, year + 1).state;
    expect(state.companies).toHaveLength(4);
  });
});

describe("C8: a newcomer is an ordinary startup", () => {
  const refilled = (seed = 1, config: GameConfig = CAREER_TEST): GameState =>
    play(outSince(atTurn(newCareer(config), 3), INCUMBENT, 1), {}, seed, config).state;

  it("takes the Incumbent's seat with the startup's numbers, not the Incumbent's", () => {
    const company = refilled().companies[INCUMBENT];
    expect(company.archetype).toBe("startup");
    expect(company).toMatchObject({
      cash: 500_000,
      headcount: 3,
      users: 0,
      quality: 0,
      hype: 10,
      launched: false,
      founderEquity: 1,
      founderSeats: 2,
      investorSeats: 0,
      out: null,
    });
  });

  it("starts with a career of its own: founded the year it enters, in the garage, with its own rescue", () => {
    const state = refilled();
    expect(careerOf(state, INCUMBENT)).toMatchObject({ founded: 4, office: 0, listed: null, rescue: null, qualified: false });
  });

  it("plays one of the three computer styles", () => {
    for (let seed = 1; seed <= 12; seed++) {
      expect(["blitzscaler", "bootstrapper", "incumbent"]).toContain(refilled(seed).companies[INCUMBENT].controller);
    }
  });

  it("plays a style from replacement.styles only", () => {
    const config = withCareer({ replacement: { afterYears: 2, styles: ["incumbent"] } });
    for (let seed = 1; seed <= 6; seed++) {
      const company = refilled(seed, config).companies[INCUMBENT];
      expect(company.controller).toBe("incumbent");
      expect(company.archetype).toBe("startup"); // the style, none of the Incumbent's numbers
    }
  });

  it("gets a new name, shared with no other company, and a pitch", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = play(outSince(outSince(atTurn(newCareer(), 3), BLITZ, 1), BOOT, 1), {}, seed).state;
      const names = state.companies.map((company) => company.name);
      expect(new Set(names).size).toBe(4);
      expect(state.companies[BLITZ].name).not.toBe("Zipp");
      expect(state.companies[BOOT].name).not.toBe("Oakline");
      expect(state.companies[BLITZ].pitch.length).toBeGreaterThan(0);
    }
  });

  it("is drawn from the seed: the same year played twice seats the same newcomer", () => {
    const state = outSince(atTurn(newCareer(), 3), BOOT, 1);
    const once = play(state, {}, 77).state.companies[BOOT];
    const twice = play(state, {}, 77).state.companies[BOOT];
    expect(twice).toEqual(once);
  });

  it("gets the startup numbers of the year it enters", () => {
    // A second era from 1993 (turn 4) gives startups $900K and five people.
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1993, invented: false, values: { archetypes: { startup: { cash: 900_000, headcount: 5 } } } },
    );
    const entersIn1993 = play(outSince(atTurn(newCareer(config), 3), BLITZ, 1), {}, 1, config).state;
    expect(entersIn1993.companies[BLITZ]).toMatchObject({ cash: 900_000, headcount: 5 });
    // Five people do not fit the garage (4): the newcomer starts in the shared office.
    expect(careerOf(entersIn1993, BLITZ).office).toBe(1);
  });

  it("gets the old era's numbers when it enters in that era's last year", () => {
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1993, invented: false, values: { archetypes: { startup: { cash: 900_000 } } } },
    );
    // Out in turn 1, refilled at the close of turn 2: it enters in turn 3, 1992, still era A.
    const entersIn1992 = play(outSince(atTurn(newCareer(config), 2), BLITZ, 1), {}, 1, config).state;
    expect(entersIn1992.companies[BLITZ].cash).toBe(500_000);
    expect(careerOf(entersIn1992, BLITZ).founded).toBe(3);
  });

  it("enters before the coming year's card is drawn, so that card can hit it", () => {
    // The newcomer enters in turn 4, 1993. The card dated 1993 hits a random company with quality below 1: only the
    // newcomer (quality 0); everyone else is launched at about 50.
    const card: DatedCard = {
      id: "newcomer-hit",
      name: "Newcomer hit",
      text: "One company is everywhere: +20 hype.",
      year: 1993,
      target: { pick: "random", qualityBelow: 1 },
      effects: [{ kind: "targetHype", delta: 20 }],
    };
    const config = withCareer({ dated: [card] });
    let state = atTurn(newCareer(config), 3);
    state = launchedCompany(launchedCompany(state, HUMAN), BOOT);
    state = outSince(state, BLITZ, 1);
    const next = play(state, {}, 1, config).state;
    expect(next.event).toEqual({ cardId: "newcomer-hit", targetId: BLITZ });
    expect(next.companies[BLITZ].hype).toBe(30); // 10 + 20
  });
});

// ── C9: offices ──

describe("C9: the offices and the first office", () => {
  it("puts each head count in the smallest office that holds it", () => {
    const career = CAREER_RULES;
    expect([1, 4, 5, 9, 10, 22, 23, 40, 41, 150].map((people) => officeFor(people, career))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("caps a company's people at the campus, the last office", () => {
    expect(peopleCap(CAREER_RULES)).toBe(150);
  });

  it("starts the three startups in the garage and the Incumbent, with 8 people, in the shared office", () => {
    const state = newCareer();
    expect(state.companies.map((company) => careerOf(state, company.id).office)).toEqual([0, 0, 0, 1]);
  });

  it("starts a larger founding team in a larger office", () => {
    const config = { ...CAREER_TEST, archetypes: { ...CAREER_TEST.archetypes, incumbent: { ...CAREER_TEST.archetypes.incumbent, headcount: 10 } } };
    expect(careerOf(newCareer(config), INCUMBENT).office).toBe(2);
  });

  it("works out a move and its bill on the head count that ends the year", () => {
    // Half a year at $40K for everyone on the team.
    expect(officeMove(0, 5, CAREER_TEST)).toEqual({ from: 0, to: 1, bill: 100_000 }); // 0.5 × 40K × 5
    expect(officeMove(0, 10, CAREER_TEST)).toEqual({ from: 0, to: 2, bill: 200_000 }); // 0.5 × 40K × 10
    expect(officeMove(3, 41, CAREER_TEST)).toEqual({ from: 3, to: 4, bill: 820_000 }); // 0.5 × 40K × 41
  });

  it("works out no move for a team at its office's capacity, or one that shrank", () => {
    expect(officeMove(0, 4, CAREER_TEST)).toBeNull();
    expect(officeMove(2, 3, CAREER_TEST)).toBeNull();
    expect(officeMove(4, 150, CAREER_TEST)).toBeNull();
  });

  it("caps the hires a company wants at the room left in the campus, never below none", () => {
    expect(hiresWithinCap(5, 148, CAREER_TEST)).toBe(2);
    expect(hiresWithinCap(5, 150, CAREER_TEST)).toBe(0);
    expect(hiresWithinCap(5, 151, CAREER_TEST)).toBe(0);
    expect(hiresWithinCap(3, 100, CAREER_TEST)).toBe(3);
  });
});

describe("C9: moving up", () => {
  it("moves a team that ends the year over its office's capacity, and bills the whole team once", () => {
    // 3 people on Recruiting hire 2 of the 5 candidates the Incumbent leaves: 5 people do not fit the garage.
    const result = play(newCareer(), { [HUMAN]: { ...RECRUIT_3, hireLimit: 2 } });
    const report = reportFor(result, HUMAN);
    expect(report.headcount.end).toBe(5);
    expect(report.costs.moving).toBe(100_000); // 0.5 × 40K × 5
    expect(report.career?.office).toEqual({ from: 0, to: 1, bill: 100_000 });
    expect(careerOf(result.state, HUMAN).office).toBe(1);
  });

  it("counts the moving bill in the year's costs and cash", () => {
    const report = reportFor(play(newCareer(), { [HUMAN]: { ...RECRUIT_3, hireLimit: 2 } }), HUMAN);
    // Salaries 3 × 40K = 120K, fees 2 × 10K = 20K, moving 100K.
    expect(report.costs.total).toBe(240_000);
    expect(report.cash.end).toBe(260_000); // 500K − 240K, no revenue before launch
  });

  it("does not move a team that ends the year exactly at its office's capacity", () => {
    const result = play(newCareer(), { [HUMAN]: { ...RECRUIT_3, hireLimit: 1 } });
    const report = reportFor(result, HUMAN);
    expect(report.headcount.end).toBe(4);
    expect(report.costs.moving).toBe(0);
    expect(report.career?.office).toBeNull();
    expect(report.costs.total).toBe(130_000); // 120K + 10K
    expect(careerOf(result.state, HUMAN).office).toBe(0);
  });

  it("skips sizes in one move, with one bill for the office it lands in", () => {
    // Four people in the garage hire 6 (capacity 7; the Incumbent hires nobody): 10 people skip the shared office (9).
    const state = withCompany(newCareer(), HUMAN, { headcount: 4, headcountAtLastClose: 4 });
    const result = play(state, { [HUMAN]: { allocation: { product: 0, growth: 0, recruiting: 4 }, hireLimit: 6 }, [INCUMBENT]: { hireLimit: 0 } });
    const report = reportFor(result, HUMAN);
    expect(report.headcount.end).toBe(10);
    expect(report.career?.office).toEqual({ from: 0, to: 2, bill: 200_000 }); // 0.5 × 40K × 10
    expect(report.costs.total).toBe(420_000); // salaries 160K + fees 60K + moving 200K
    expect(careerOf(result.state, HUMAN).office).toBe(2);
  });

  it("bills the Incumbent too when it outgrows the shared office", () => {
    // 8 people, the default plan's 1 hire plus nothing: 9 fit. With 2 on Recruiting it can hire 2 and reach 10.
    const result = play(newCareer(), { [INCUMBENT]: { allocation: { product: 4, growth: 2, recruiting: 2 }, hireLimit: 2 } });
    const report = reportFor(result, INCUMBENT);
    // Capacity round(2 × 8^0.8 × 2/8) = round(2.64) = 3, limited to 2.
    expect(report.headcount.end).toBe(10);
    expect(report.career?.office).toEqual({ from: 1, to: 2, bill: 200_000 }); // 0.5 × 40K × 10
  });

  it("reads the salary of the year the move is made", () => {
    // From 1991 (turn 2) a year's salary is $60K.
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1991, invented: false, values: { salary: 60_000 } },
    );
    const state = atTurn(newCareer(config), 2);
    const report = reportFor(play(state, { [HUMAN]: { ...RECRUIT_3, hireLimit: 2 } }, 1, config), HUMAN);
    expect(report.costs.moving).toBe(150_000); // 0.5 × 60K × 5
    expect(report.costs.salaries).toBe(180_000); // 3 × 60K
  });

  it("can bankrupt a company: with the bill, $200K is not enough", () => {
    // 200K − (120K + 20K + 100K) = −40K: the first failure, so a rescue. The move still stands.
    const state = withCompany(newCareer(), HUMAN, { cash: 200_000 });
    const result = play(state, { [HUMAN]: { ...RECRUIT_3, hireLimit: 2 } });
    const report = reportFor(result, HUMAN);
    expect(report.out).toBeNull();
    expect(report.career?.rescue).toMatchObject({ reason: "bankrupt", cashBefore: -40_000 });
    // Reset to a year of salaries for the 3 who were on the payroll; the 2 hires are not counted.
    expect(report.cash.end).toBe(120_000);
    expect(careerOf(result.state, HUMAN).office).toBe(1);
  });

  it("leaves the moving bill out of the costs carried into next year", () => {
    const result = play(newCareer(), { [HUMAN]: { ...RECRUIT_3, hireLimit: 2 } });
    expect(result.state.companies[HUMAN].lastCosts).toBe(140_000); // 240K less the 100K bill
  });

  it("keeps the office when the team shrinks: offices are never given up", () => {
    let state = withCompany(newCareer(), HUMAN, { headcount: 10, headcountAtLastClose: 10 });
    state = withCareerOf(state, HUMAN, { office: 2 });
    const result = play(state, { [HUMAN]: { allocation: { product: 3, growth: 0, recruiting: 0 }, layoffs: 7 } });
    const report = reportFor(result, HUMAN);
    expect(report.headcount.end).toBe(3);
    expect(report.costs.moving).toBe(0);
    expect(report.career?.office).toBeNull();
    expect(careerOf(result.state, HUMAN).office).toBe(2);
  });

  it("has no moving cost and no career report in a race", () => {
    const race = newGame();
    const report = reportFor(resolveTurn(race, plansOf(race), 1), HUMAN);
    expect(report.costs.moving).toBeUndefined();
    expect(report.career).toBeUndefined();
  });
});

describe("C9: the campus cannot be outgrown", () => {
  const atCampus = (headcount: number): GameState => {
    const state = withCompany(newCareer(), HUMAN, { headcount, headcountAtLastClose: headcount, cash: 100_000_000 });
    return withCareerOf(state, HUMAN, { office: 4 });
  };
  const allRecruit = (people: number): Partial<Plan> => ({ allocation: { product: 0, growth: 0, recruiting: people } });

  it("stops hiring at 150 people", () => {
    // 148 people, a huge capacity, 5 candidates left after the Incumbent: room for 2.
    const report = reportFor(play(atCampus(148), { [HUMAN]: allRecruit(148) }), HUMAN);
    expect(report.hiring.wanted).toBe(2);
    expect(report.hiring.hired).toBe(2);
    expect(report.headcount.end).toBe(150);
    expect(report.career?.office).toBeNull();
  });

  it("hires nobody at 150 people", () => {
    const report = reportFor(play(atCampus(150), { [HUMAN]: allRecruit(150) }), HUMAN);
    expect(report.hiring.wanted).toBe(0);
    expect(report.hiring.hired).toBe(0);
    expect(report.headcount.end).toBe(150);
  });

  it("counts the payroll after layoffs: laying off 2 of 150 leaves room for 2 hires", () => {
    const report = reportFor(play(atCampus(150), { [HUMAN]: { ...allRecruit(148), layoffs: 2 } }), HUMAN);
    expect(report.hiring.hired).toBe(2);
    expect(report.headcount.end).toBe(150);
  });

  it("drops a poach by a company that already fills the campus, at no cost, with a note", () => {
    const result = play(atCampus(150), { [HUMAN]: { ...allRecruit(150), poachTarget: BOOT } });
    const report = reportFor(result, HUMAN);
    expect(report.plan.poachTarget).toBeNull();
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    expect(report.notes).toContain("Poach dropped: the campus is full.");
    expect(report.headcount.end).toBe(150);
  });

  it("drops that poach when the plan is checked, before the year is played", () => {
    const state = atCampus(150);
    const checked = normalizePlan(state, HUMAN, planOf(state, HUMAN, { ...allRecruit(150), poachTarget: BOOT }), CAREER_TEST);
    expect(checked.plan.poachTarget).toBeNull();
    expect(checked.notes).toContain("Poach dropped: the campus is full.");
  });

  it("keeps a poach when layoffs bring the payroll under the campus", () => {
    const report = reportFor(play(atCampus(150), { [HUMAN]: { ...allRecruit(149), layoffs: 1, poachTarget: BOOT } }), HUMAN);
    expect(report.plan.poachTarget).toBe(BOOT);
    expect(report.costs.poaching).toBe(50_000);
    expect(report.headcount.end).toBeLessThanOrEqual(150);
  });

  it("never lets a poach that worked and the year's hires take a team of 149 past 150", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const report = reportFor(play(atCampus(149), { [HUMAN]: { ...allRecruit(149), poachTarget: BOOT } }, seed), HUMAN);
      expect(report.plan.poachTarget).toBe(BOOT);
      expect(report.headcount.poachedIn + report.hiring.hired).toBeLessThanOrEqual(1);
      expect(report.headcount.end).toBeLessThanOrEqual(150);
    }
  });
});

describe("C9: what the projection shows of a move", () => {
  const project = (state: GameState, patch: Partial<Plan>, config: GameConfig = CAREER_TEST) =>
    projectTurn(viewFor(state, HUMAN), planOf(state, HUMAN, patch), config);

  it("shows the move and its bill before the year is ended", () => {
    const projection = project(newCareer(), { ...RECRUIT_3, hireLimit: 2 });
    expect(projection.career?.office).toEqual({ from: 0, to: 1, bill: 100_000 }); // 0.5 × 40K × 5
    expect(projection.costs.moving).toBe(100_000);
  });

  it("works the move out on the planned poach too, whether it works or not", () => {
    // 3 + 2 hires + 1 poached = 6.
    const projection = project(newCareer(), { ...RECRUIT_3, hireLimit: 2, poachTarget: BOOT });
    expect(projection.career?.office).toEqual({ from: 0, to: 1, bill: 120_000 }); // 0.5 × 40K × 6
  });

  it("shows a move that only the planned poach would cause", () => {
    // 3 + 1 hire = 4 fits the garage; 3 + 1 + 1 poached = 5 does not.
    expect(project(newCareer(), { ...RECRUIT_3, hireLimit: 1 }).career?.office).toBeNull();
    expect(project(newCareer(), { ...RECRUIT_3, hireLimit: 1, poachTarget: BOOT }).career?.office).toEqual({ from: 0, to: 1, bill: 100_000 });
  });

  it("shows no moving cost when the team stays within its office", () => {
    const projection = project(newCareer(), { ...RECRUIT_3, hireLimit: 1 });
    expect(projection.costs.moving ?? 0).toBe(0);
  });

  it("shows a move that skips to the campus, billed on the largest team the year can end with", () => {
    // 40 people on the full floor with hype 50 (first to hire) and "hire at most 5": 45 people move to the campus.
    let state = withCompany(newCareer(), HUMAN, { headcount: 40, headcountAtLastClose: 40, hype: 50, cash: 10_000_000 });
    state = withCareerOf(state, HUMAN, { office: 3 });
    const projection = project(state, { allocation: { product: 0, growth: 0, recruiting: 40 }, hireLimit: 5 });
    expect(projection.career?.office).toEqual({ from: 3, to: 4, bill: 900_000 }); // 0.5 × 40K × 45
  });

  it("reads the salary of the year being planned", () => {
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1991, invented: false, values: { salary: 60_000 } },
    );
    const projection = project(atTurn(newCareer(config), 2), { ...RECRUIT_3, hireLimit: 2 }, config);
    expect(projection.career?.office).toEqual({ from: 0, to: 1, bill: 150_000 }); // 0.5 × 60K × 5
  });

  it("at the campus, costs a hire for each rival in the game that could poach one person away", () => {
    // 148 people, hype 50, "hire at most 10": room for 2, plus 1 for each of the 3 rivals = 5 hires at $10K.
    let state = withCompany(newCareer(), HUMAN, { headcount: 148, headcountAtLastClose: 148, hype: 50, cash: 100_000_000 });
    state = withCareerOf(state, HUMAN, { office: 4 });
    const projection = project(state, { allocation: { product: 0, growth: 0, recruiting: 148 }, hireLimit: 10 });
    expect(projection.costs.hiring).toBe(50_000);
    expect(projection.career?.office).toBeNull();
  });

  it("at the campus, counts only the rivals still in the game", () => {
    // The Incumbent is out: 2 + 2 = 4 hires.
    let state = withCompany(newCareer(), HUMAN, { headcount: 148, headcountAtLastClose: 148, hype: 50, cash: 100_000_000 });
    state = withCareerOf(onlyActive(state, [HUMAN, BLITZ, BOOT]), HUMAN, { office: 4 });
    const projection = project(state, { allocation: { product: 0, growth: 0, recruiting: 148 }, hireLimit: 10 });
    expect(projection.costs.hiring).toBe(40_000);
  });

  it("below the campus, costs only the hires the plan wants", () => {
    // 30 people on the full floor, hype 50, "hire at most 5": 35 fit, 5 hires at $10K, no move.
    let state = withCompany(newCareer(), HUMAN, { headcount: 30, headcountAtLastClose: 30, hype: 50, cash: 10_000_000 });
    state = withCareerOf(state, HUMAN, { office: 3 });
    const projection = project(state, { allocation: { product: 0, growth: 0, recruiting: 30 }, hireLimit: 5 });
    expect(projection.costs.hiring).toBe(50_000);
    expect(projection.career?.office).toBeNull();
  });
});

// ── C10: the end ──

describe("C10: nothing ends a career before its last year", () => {
  it("numbers the years 1990 to 2038 as turns 1 to 49", () => {
    expect(yearOf(1, CAREER_RULES)).toBe(1990);
    expect(yearOf(49, CAREER_RULES)).toBe(2038);
    expect(turnOf(1990, CAREER_RULES)).toBe(1);
    expect(turnOf(2038, CAREER_RULES)).toBe(49);
  });

  it("ships the career's design numbers for offices, moving and newcomers as the spec gives them", () => {
    const career = CAREER_DESIGN.career;
    expect(career.firstYear + CAREER_DESIGN.game.maxTurns - 1).toBe(2038);
    expect(career.offices.map((office) => office.capacity)).toEqual([4, 9, 22, 40, 150]);
    expect(career.moving.salaryYears).toBe(0.5);
    expect(career.replacement.afterYears).toBe(2);
  });

  it("goes on after turn 48, the second-to-last year", () => {
    const result = play(atTurn(newCareer(), 48));
    expect(result.log.outcome).toBeNull();
    expect(result.state.turn).toBe(49);
  });

  it("goes on with one company left", () => {
    const result = play(onlyActive(atTurn(newCareer(), 10), [HUMAN]));
    expect(result.log.outcome).toBeNull();
    expect(result.state.turn).toBe(11);
  });

  it("goes on with nobody left before the last year, and newcomers take the rivals' seats", () => {
    const result = play(onlyActive(atTurn(newCareer(), 10), []));
    expect(result.log.outcome).toBeNull();
    expect(result.log.entrants).toEqual([BLITZ, BOOT, INCUMBENT]);
  });

  it("goes on when the player's company is out", () => {
    const state = rescueSpent(withCompany(atTurn(newCareer(), 10), HUMAN, { cash: 0 }), HUMAN);
    const result = play(state);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.log.outcome).toBeNull();
    expect(result.state.turn).toBe(11);
  });

  it("does not end when a company reaches the bar for going public with a profit", () => {
    // 300K users ≥ the 250K bar; revenue 300K × $3 = $900K against $120K of salaries.
    const state = launchedCompany(atTurn(newCareer(), 10), HUMAN, { users: 300_000 });
    const result = play(state);
    expect(reportFor(result, HUMAN).profitable).toBe(true);
    expect(result.log.outcome).toBeNull();
  });

  it("still ends a race with the last company standing", () => {
    const race = onlyActive(newGame(), [HUMAN]);
    const result = resolveTurn(race, plansOf(race), 1);
    expect(result.log.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: HUMAN });
  });
});

describe("C10: the final ranking after 2038", () => {
  it("gives the career to the largest founder's stake, not the most users or the highest valuation", () => {
    // Stakes: Acme 10K × 150 × 1 = 1.5M; Zipp 30K × 150 × 0.5 = 2.25M; Oakline 20K × 150 × 1 = 3M;
    // Nimbus 50K × 150 = 7.5M valuation but × 0.3 = 2.25M.
    const state = finalYear({
      [HUMAN]: { users: 10_000, equity: 1 },
      [BLITZ]: { users: 30_000, equity: 0.5 },
      [BOOT]: { users: 20_000, equity: 1 },
      [INCUMBENT]: { users: 50_000, equity: 0.3 },
    });
    const result = play(state, {}, 1, FROZEN);
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BOOT });
  });

  it("keeps the users and valuations the ranking is drawn from where the scenario put them", () => {
    const state = finalYear({ [BOOT]: { users: 20_000, equity: 1 } });
    const report = reportFor(play(state, {}, 1, FROZEN), BOOT);
    expect(report.users.end).toBe(20_000);
    expect(report.valuation).toBe(3_000_000); // 20K × 150 × (1 + 0/100)
  });

  it("breaks a tie in stake by the higher valuation", () => {
    // Zipp: 20K users, valuation 3M, stake 1.5M. Oakline: 10K users, valuation 1.5M, stake 1.5M.
    const state = finalYear({
      [HUMAN]: { users: 4_000, equity: 1 },
      [BLITZ]: { users: 20_000, equity: 0.5 },
      [BOOT]: { users: 10_000, equity: 1 },
      [INCUMBENT]: { users: 5_000, equity: 0.6 },
    });
    expect(play(state, {}, 1, FROZEN).log.outcome?.winnerId).toBe(BLITZ);
  });

  it("breaks a tie in stake and valuation by the lower seat", () => {
    const state = finalYear({
      [HUMAN]: { users: 4_000, equity: 1 },
      [BLITZ]: { users: 10_000, equity: 1 },
      [BOOT]: { users: 10_000, equity: 1 },
      [INCUMBENT]: { users: 5_000, equity: 0.6 },
    });
    expect(play(state, {}, 1, FROZEN).log.outcome?.winnerId).toBe(BLITZ);
  });

  it("gives the player's seat a full tie, since it is the lowest", () => {
    const state = finalYear({
      [HUMAN]: { users: 10_000, equity: 1 },
      [BLITZ]: { users: 4_000, equity: 1 },
      [BOOT]: { users: 10_000, equity: 1 },
      [INCUMBENT]: { users: 5_000, equity: 0.6 },
    });
    expect(play(state, {}, 1, FROZEN).log.outcome?.winnerId).toBe(HUMAN);
  });

  it("counts the listing premium in a public company's stake, and its higher valuation breaks the tie", () => {
    // Oakline, public: 10K × 150 × 1.25 = 1.875M, × 0.8 = 1.5M. Zipp, private: 10K × 150 = 1.5M, × 1 = 1.5M.
    // Equal stakes; Oakline's valuation is higher. Without the premium Oakline would have 1.2M and lose.
    let state = finalYear({
      [HUMAN]: { users: 4_000, equity: 1 },
      [BLITZ]: { users: 10_000, equity: 1 },
      [BOOT]: { users: 10_000, equity: 0.8 },
      [INCUMBENT]: { users: 5_000, equity: 0.6 },
    });
    state = withCareerOf(state, BOOT, { listed: { turn: 20, valuation: 1_000_000, amount: 200_000 } });
    const result = play(state, {}, 1, FROZEN);
    expect(reportFor(result, BOOT).valuation).toBe(1_875_000);
    expect(result.log.outcome?.winnerId).toBe(BOOT);
  });

  it("ranks only the companies still in the game: one that goes out in 2038 cannot win", () => {
    // Acme holds 100K users (a 15M stake) but starts at −$1M with its rescue spent: −1M + 300K − 120K < 0.
    let state = finalYear({
      [HUMAN]: { users: 100_000, equity: 1 },
      [BLITZ]: { users: 30_000, equity: 0.5 },
      [BOOT]: { users: 20_000, equity: 1 },
      [INCUMBENT]: { users: 50_000, equity: 0.3 },
    });
    state = rescueSpent(withCompany(state, HUMAN, { cash: -1_000_000 }), HUMAN);
    const result = play(state, {}, 1, FROZEN);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BOOT });
  });

  it("ranks a company rescued in 2038, on the half of its stake it keeps", () => {
    // Acme is rescued instead: equity 1 → 0.5, valuation 100K × 150 = 15M, stake 7.5M, still the largest.
    let state = finalYear({
      [HUMAN]: { users: 100_000, equity: 1 },
      [BLITZ]: { users: 30_000, equity: 0.5 },
      [BOOT]: { users: 20_000, equity: 1 },
      [INCUMBENT]: { users: 50_000, equity: 0.3 },
    });
    state = withCompany(state, HUMAN, { cash: -1_000_000 });
    const result = play(state, {}, 1, FROZEN);
    expect(reportFor(result, HUMAN).out).toBeNull();
    expect(reportFor(result, HUMAN).equity).toBe(0.5);
    expect(result.log.outcome?.winnerId).toBe(HUMAN);
  });

  it("gives the career to the only company left, as a final ranking", () => {
    const state = onlyActive(finalYear({ [BOOT]: { users: 1_000, equity: 1 } }), [BOOT]);
    expect(play(state, {}, 1, FROZEN).log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BOOT });
  });

  it("ranks by stake even when a company ends 2038 at the bar for going public with a profit", () => {
    // Acme: 300K users ≥ 250K, revenue $900K > $120K costs, but equity 0.01: stake 300K × 150 × 0.01 = 450K.
    const state = finalYear({
      [HUMAN]: { users: 300_000, equity: 0.01 },
      [BLITZ]: { users: 10_000, equity: 1 },
      [BOOT]: { users: 4_000, equity: 1 },
      [INCUMBENT]: { users: 5_000, equity: 0.6 },
    });
    const result = play(state, {}, 1, FROZEN);
    expect(reportFor(result, HUMAN).profitable).toBe(true);
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BLITZ }); // 1.5M
  });

  it("ends in a wipeout when nobody is left after 2038", () => {
    let state = atTurn(newCareer(FROZEN), 49);
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) state = outSince(state, id, 47);
    expect(play(state, {}, 1, FROZEN).log.outcome).toEqual({ kind: "wipeout", turn: 49, winnerId: null });
  });

  it("ends in a wipeout when the last company goes out in 2038 itself", () => {
    let state = onlyActive(finalYear({ [HUMAN]: { users: 1_000, equity: 1 } }), [HUMAN]);
    state = rescueSpent(withCompany(state, HUMAN, { cash: -1_000_000 }), HUMAN);
    expect(play(state, {}, 1, FROZEN).log.outcome).toEqual({ kind: "wipeout", turn: 49, winnerId: null });
  });

  it("stays on turn 49 once the career is over", () => {
    const state = finalYear({ [BOOT]: { users: 20_000, equity: 1 } });
    const result = play(state, {}, 1, FROZEN);
    expect(result.state.turn).toBe(49);
    expect(result.state.outcome).toEqual(result.log.outcome);
  });
});
