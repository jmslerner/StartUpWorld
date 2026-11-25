import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { boardPaused } from "./career";
import { CAREER_RULES, CAREER_TEST, atTurn, newCareer, qualify, withCareer, withCareerOf, withEras } from "./careerKit";
import { clamp, round4, round6, runwayOf, valuationOf } from "./formulas";
import { projectTurn } from "./project";
import { BLITZ, HUMAN, INCUMBENT, launchedCompany, newGame, reportFor, resolve, seedWhere, withCompany } from "./testKit";
import type { CompanyReport, GameState, Plan } from "./types";
import { publicReport, viewFor } from "./view";

const RICH = 10_000_000;

/** The year's hype as the race works it out, before any rescue. */
const yearHype = (report: CompanyReport): number =>
  round4(clamp(report.hype.start * (1 - DESIGN.hype.decay) + report.hype.launch + report.hype.raise + report.hype.growth + report.hype.layoffs, 0, 100));

/**
 * Seat 0 opens 1994 with 5 people, all on Product, $0, 2 founder seats, `investorSeats` investor seats, equity 0.8,
 * hype 40 and 10,000 users, whose revenue is far below its salaries: the year ends below $0.
 */
const brokeYear = (investorSeats = 0): GameState =>
  launchedCompany(atTurn(newCareer(), 5), HUMAN, {
    headcount: 5,
    headcountAtLastClose: 5,
    cash: 0,
    founderSeats: 2,
    investorSeats,
    founderEquity: 0.8,
    hype: 40,
    users: 10_000,
    lastPlan: { ...newCareer().companies[HUMAN].lastPlan, allocation: { product: 5, growth: 0, recruiting: 0 } },
  });

const rescueYear = (investorSeats = 0) => {
  const state = brokeYear(investorSeats);
  const result = resolve(state, {}, 1, CAREER_TEST);
  return { state, result, report: reportFor(result, HUMAN), after: result.state.companies[HUMAN] };
};

/** Investors control seat 0, which has the cash for years, and its users fall far below the last close. */
const usersFall = (state: GameState): GameState =>
  launchedCompany(state, HUMAN, { cash: RICH, users: 10_000, usersAtLastClose: 100_000, founderSeats: 2, investorSeats: 3 });

/** The state after seat 0's rescue from bankruptcy in turn 5, dated to `turn`, with its users falling. */
const afterRescue = (turn: number): GameState => atTurn(usersFall(rescueYear().result.state), turn);

describe("the first failure is a rescue", () => {
  it("a first bankruptcy is a rescue, not the end", () => {
    const { state, report, after } = rescueYear();
    const cashBefore = report.cash.start + report.revenue - report.costs.total;
    expect(cashBefore).toBeLessThan(0);
    expect(report.out).toBeNull();
    expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore, equityBefore: 0.8 });
    expect(report.equity).toBe(0.4);
    expect(after.investorSeats).toBe(3);
    expect(report.career?.hype.rescue).toBe(-10);
    expect(report.hype.end).toBe(round4(Math.max(0, yearHype(report) - 10)));
    expect(report.cash.end).toBe((report.headcount.start - report.headcount.laidOff - report.headcount.poachedOut) * DESIGN.salary);
    expect(report.runway).toBe(runwayOf(report.cash.end, report.revenue, report.costs.total));
    expect(report.valuation).toBe(valuationOf(report.users.end, report.hype.end, 1, CAREER_TEST));
    expect(report.valuation).toBeGreaterThan(0);
    expect(after.career?.rescue).toEqual({ turn: state.turn, reason: "bankrupt" });
    expect(after.out).toBeNull();
    expect(after.cash).toBe(report.cash.end);
    expect(after.hype).toBe(report.hype.end);
    expect(after.founderEquity).toBe(0.4);
    expect(report.board).toBeNull(); // rescued from bankruptcy: not also voted on that year
  });

  it.each([
    [0, 3],
    [1, 3],
    [2, 4],
    [5, 7],
  ])("from %i investor seats to %i: always more than the founders' two", (before, expected) => {
    const { report, after } = rescueYear(before);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.board).toBeNull();
    expect(after.investorSeats).toBe(expected);
  });

  it("the hype it takes off stops at 0", () => {
    // Hype 5 and users that do not grow: 4 left after the year's decay, so the rescue can take off only 4.
    const state = withCompany(brokeYear(), HUMAN, { hype: 5, usersAtLastClose: 100_000 });
    const report = reportFor(resolve(state, {}, 1, CAREER_TEST), HUMAN);
    expect(yearHype(report)).toBe(4);
    expect(report.career?.hype.rescue).toBe(-4);
    expect(report.hype.end).toBe(0);
  });

  it("a first firing by the board is a rescue too", () => {
    const state = usersFall(atTurn(newCareer(), 5));
    const company = state.companies[HUMAN];
    const seed = seedWhere((s) => reportFor(resolve(state, {}, s, CAREER_TEST), HUMAN).board?.fired === true);
    const result = resolve(state, {}, seed, CAREER_TEST);
    const report = reportFor(result, HUMAN);
    expect(report.board).toEqual({ usersFell: true, lowRunway: false, fired: true });
    expect(report.out).toBeNull();
    expect(report.career?.rescue?.reason).toBe("fired");
    expect(report.equity).toBe(round6(company.founderEquity * 0.5));
    expect(report.cash.end).toBe(report.cash.start + report.revenue - report.costs.total); // cash is only reset from below $0
    expect(result.state.companies[HUMAN].investorSeats).toBe(5);
    expect(result.state.companies[HUMAN].career?.rescue).toEqual({ turn: 5, reason: "fired" });
  });

  it("the board does not vote in the year after a rescue (Review Focus 4)", () => {
    const year6 = afterRescue(6);
    for (let seed = 1; seed <= 200; seed++) {
      expect(reportFor(resolve(year6, {}, seed, CAREER_TEST), HUMAN).board).toEqual({ usersFell: true, lowRunway: false, fired: false });
    }
    expect(boardPaused(year6.companies[HUMAN], 6)).toBe(true);
    expect(projectTurn(viewFor(year6, HUMAN), null, CAREER_TEST).boardRisk).toBe(0);
  });

  it("and votes again the year after that: a second firing is final", () => {
    const year7 = afterRescue(7);
    expect(boardPaused(year7.companies[HUMAN], 7)).toBe(false);
    expect(projectTurn(viewFor(year7, HUMAN), null, CAREER_TEST).boardRisk).toBe(DESIGN.board.fireChance);
    const firingSeed = seedWhere((s) => reportFor(resolve(year7, {}, s, CAREER_TEST), HUMAN).board?.fired === true);
    const report = reportFor(resolve(year7, {}, firingSeed, CAREER_TEST), HUMAN);
    expect(report.out).toBe("fired");
    expect(report.career?.rescue).toBeNull();
  });

  it("a second bankruptcy is final, the year after a rescue included (Review Focus 4)", () => {
    const year6 = withCompany(afterRescue(6), HUMAN, { cash: -RICH });
    const result6 = resolve(year6, {}, 1, CAREER_TEST);
    const report6 = reportFor(result6, HUMAN);
    expect(report6.out).toBe("bankrupt");
    expect(report6.career?.rescue).toBeNull();
    expect(report6.career?.hype.rescue).toBe(0);
    expect(result6.state.companies[HUMAN].out).toEqual({ turn: 6, reason: "bankrupt", users: report6.users.end, headcount: report6.headcount.end });
    expect(result6.state.companies[HUMAN].career?.rescue).toEqual({ turn: 5, reason: "bankrupt" });
    expect(result6.state.freedPeople).toBe(report6.headcount.end);
  });
});

describe("what a rescue resets the cash to", () => {
  it("the reset is a year of salaries at the closing year's salary, also when the next year opens an era", () => {
    // Two eras, the second from 1992 (turn 3) with salary 100,000; the rescue falls in 1991, the first era's last year.
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1992, invented: false, values: { salary: 100_000 } },
    );
    const state = atTurn(brokeYear(), 2);
    const result = resolve(state, {}, 1, config);
    const report = reportFor(result, HUMAN);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.cash.end).toBe((report.headcount.start - report.headcount.laidOff - report.headcount.poachedOut) * DESIGN.salary);
    expect(report.cash.end).toBe(5 * 40_000);
  });

  it("people who join as the bankrupt year ends are not counted in the reset", () => {
    // Seat 0: 5 people, two of them recruiting, and the year ends below $0 with 3 hires made.
    const state = brokeYear();
    const result = resolve(state, { [HUMAN]: { allocation: { product: 3, growth: 0, recruiting: 2 } } }, 1, CAREER_TEST);
    const report = reportFor(result, HUMAN);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.headcount).toMatchObject({ start: 5, hired: 3, end: 8 });
    expect(report.cash.end).toBe(5 * DESIGN.salary);
  });

  it("a rescue's cash is not for someone poached away, and not for a new hire in their place (ruling 28)", () => {
    // Seat 1, with hype 100, poaches one of seat 0's five in the bankrupt year.
    const state = withCompany(brokeYear(), BLITZ, { hype: 100, cash: RICH });
    const year = (allocation: Plan["allocation"], seed: number) =>
      reportFor(resolve(state, { [HUMAN]: { allocation }, [BLITZ]: { poachTarget: HUMAN } }, seed, CAREER_TEST), HUMAN);
    const seed = seedWhere((s) => year({ product: 5, growth: 0, recruiting: 0 }, s).headcount.poachedOut === 1);
    const kept = year({ product: 5, growth: 0, recruiting: 0 }, seed);
    expect(kept.career?.rescue?.reason).toBe("bankrupt");
    expect(kept.headcount).toMatchObject({ start: 5, hired: 0, poachedOut: 1, end: 4 });
    expect(kept.cash.end).toBe(4 * DESIGN.salary);
    const hiring = year({ product: 3, growth: 0, recruiting: 2 }, seed);
    expect(hiring.career?.rescue?.reason).toBe("bankrupt");
    expect(hiring.headcount).toMatchObject({ start: 5, hired: 3, poachedOut: 1, end: 7 });
    expect(hiring.cash.end).toBe(4 * DESIGN.salary); // it was 5
  });

  it("the reset is a whole number of dollars", () => {
    const config = withCareer({ rescue: { ...CAREER_RULES.rescue, salaryYears: 1 / 3 } });
    const report = reportFor(resolve(brokeYear(), {}, 1, config), HUMAN);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(Number.isInteger(report.cash.end)).toBe(true);
    expect(report.cash.end).toBe(Math.round((5 * DESIGN.salary) / 3));
  });

  it("people laid off in the bankrupt year are not counted either", () => {
    const result = resolve(brokeYear(), { [HUMAN]: { layoffs: 2, allocation: { product: 3, growth: 0, recruiting: 0 } } }, 1, CAREER_TEST);
    const report = reportFor(result, HUMAN);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.headcount).toMatchObject({ start: 5, laidOff: 2, end: 3 });
    expect(report.cash.end).toBe(3 * DESIGN.salary);
  });
});

describe("a rescue beside the career's other rules", () => {
  it("a company that goes public and is rescued in the same year keeps its listing", () => {
    // Qualified, lists, and still ends the year below $0: it opened $20,000,000 in debt.
    const state = withCompany(qualify(atTurn(newCareer(), 2), HUMAN), HUMAN, { cash: -20_000_000 });
    const company = state.companies[HUMAN];
    const result = resolve(state, { [HUMAN]: { goPublic: true } }, 1, CAREER_TEST);
    const report = reportFor(result, HUMAN);
    const after = result.state.companies[HUMAN];
    expect(report.career?.listing).not.toBeNull();
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.career?.rescue?.cashBefore).toBe(report.cash.start + (report.career?.listing?.amount ?? 0) + report.revenue - report.costs.total);
    expect(report.career?.hype).toEqual({ listing: 20, rescue: -10 });
    expect(report.equity).toBe(round6(round6(company.founderEquity * 0.8) * 0.5));
    expect(after.investorSeats).toBe(Math.max(company.investorSeats + 1 + 2, company.founderSeats + 1));
    expect(report.valuation).toBe(Math.round(valuationOf(report.users.end, report.hype.end, 1, CAREER_TEST) * 1.25));
    expect(after.career?.listed?.turn).toBe(state.turn);
    expect(after.career?.rescue).toEqual({ turn: state.turn, reason: "bankrupt" });
  });

  it("everyone can see a rescue", () => {
    const { report } = rescueYear();
    expect(publicReport(report).career?.rescued).toBe("bankrupt");
  });

  it("the Incumbent is rescued like anyone else", () => {
    const state = withCompany(atTurn(newCareer(), 5), INCUMBENT, { cash: -RICH });
    const company = state.companies[INCUMBENT];
    const result = resolve(state, {}, 1, CAREER_TEST);
    const report = reportFor(result, INCUMBENT);
    expect(report.out).toBeNull();
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.equity).toBe(round6(company.founderEquity * 0.5));
    expect(result.state.companies[INCUMBENT].investorSeats).toBe(Math.max(company.investorSeats + 2, company.founderSeats + 1));
    expect(report.cash.end).toBe(company.headcount * DESIGN.salary);
  });

  it("a company with its rescue spent is not rescued again", () => {
    const spent = withCareerOf(brokeYear(), HUMAN, { rescue: { turn: 2, reason: "fired" } });
    const report = reportFor(resolve(spent, {}, 1, CAREER_TEST), HUMAN);
    expect(report.out).toBe("bankrupt");
    expect(report.career?.rescue).toBeNull();
  });

  it("the race still has no rescue", () => {
    const brokeRaceGame = withCompany(newGame(), HUMAN, { cash: -RICH });
    expect(reportFor(resolve(brokeRaceGame, {}, 1, DESIGN), HUMAN).out).toBe("bankrupt");
  });
});
