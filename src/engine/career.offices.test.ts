import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { movingBill, peopleCap } from "./career";
import { CAREER_RULES, CAREER_TEST, atTurn, careerOf, newCareer, withCareerOf, withEras } from "./careerKit";
import { projectTurn } from "./project";
import { BLITZ, HUMAN, newGame, reportFor, resolve, withCompany, withState } from "./testKit";
import type { GameConfig } from "../config";
import type { GameState, Plan } from "./types";
import { publicReport, viewFor } from "./view";

const RICH = 10_000_000;

/** What half a year of salary costs for this many people at the design's salary. */
const bill = (people: number): number => 0.5 * people * DESIGN.salary;

/** Seat 0 with `people` people in office `office` and plenty of cash, in 1990 unless another turn is given. */
const teamOf = (people: number, office = 0, state: GameState = newCareer(), cash = RICH): GameState =>
  withCareerOf(withCompany(state, HUMAN, { headcount: people, headcountAtLastClose: people, cash }), HUMAN, { office });

/** One person recruiting, the rest on Growth, nothing spent on marketing, and at most `hireLimit` hires. */
const recruitOne = (people: number, hireLimit: number | null = 1): Partial<Plan> => ({
  allocation: { product: 0, growth: people - 1, recruiting: 1 },
  marketing: 0,
  hireLimit,
});

/** Four people recruiting out of a team of 149 or 150: hiring capacity for 5. */
const recruitFour = (people: number): Partial<Plan> => ({
  allocation: { product: 0, growth: people - 4, recruiting: 4 },
  marketing: 0,
  hireLimit: null,
});

const playYear = (state: GameState, plan: Partial<Plan>, config: GameConfig = CAREER_TEST, seed = 1) => {
  const result = resolve(state, { [HUMAN]: plan }, seed, config);
  return { result, report: reportFor(result, HUMAN), after: result.state.companies[HUMAN] };
};

describe("the office rules", () => {
  it("the last office's size is the cap on people", () => {
    expect(peopleCap(CAREER_RULES)).toBe(150);
  });

  it("the bill is moving.salaryYears of the year's salary for everyone who moves", () => {
    expect(movingBill(5, CAREER_TEST)).toBe(bill(5));
  });
});

describe("outgrowing the office", () => {
  it("ending a year with more people than the office holds means a move and a bill", () => {
    // seat 0: 4 people in the garage, one of them recruiting, with a hire limit of 1
    const { result, report } = playYear(teamOf(4), recruitOne(4));
    const after = result.state.companies[HUMAN];
    expect(report.headcount.end).toBe(5);
    expect(report.career?.office).toEqual({ from: 0, to: 1, bill: 0.5 * 5 * DESIGN.salary });
    expect(report.costs.moving).toBe(0.5 * 5 * DESIGN.salary);
    const { salaries, marketing, hiring, poaching, severance, moving, total } = report.costs;
    expect(total).toBe(salaries + marketing + hiring + poaching + severance + (moving ?? 0));
    expect(report.cash.end).toBe(report.cash.start + report.revenue - total);
    expect(after.career?.office).toBe(1);
    expect(publicReport(report).career?.movedTo).toBe(1);
  });

  it("a year that ends exactly full is not a move", () => {
    // 3 people in the garage, one of them recruiting, with a hire limit of 1: the year ends with 4
    const { report, after } = playYear(teamOf(3), recruitOne(3));
    expect(report.headcount.end).toBe(4);
    expect(report.career?.office).toBeNull();
    expect(report.costs.moving).toBe(0);
    expect(after.career?.office).toBe(0);
    expect(publicReport(report).career?.movedTo).toBeNull();
  });

  it("a big jump skips sizes for one bill", () => {
    // 23 people still recorded in the garage
    const { report, after } = playYear(teamOf(23), recruitOne(23, 0));
    expect(report.headcount.end).toBe(23);
    expect(report.career?.office).toEqual({ from: 0, to: 3, bill: 0.5 * 23 * DESIGN.salary });
    expect(after.career?.office).toBe(3);
  });

  it("offices are never given up", () => {
    // 3 people in office 2: no move, no bill, office stays 2
    const { report, after } = playYear(teamOf(3, 2), recruitOne(3, 0));
    expect(report.headcount.end).toBe(3);
    expect(report.career?.office).toBeNull();
    expect(report.costs.moving).toBe(0);
    expect(after.career?.office).toBe(2);
  });

  it("the bill is one of the year's costs: it counts against profit and can bankrupt", () => {
    // 4 people in the garage hire a fifth. 60,000 users at the standard price bring $180,000: more than the
    // salaries and the hiring fee ($170,000), less than those and the bill ($270,000). $50,000 in the bank pays
    // everything but the bill.
    const state = withCompany(teamOf(4, 0, newCareer(), 50_000), HUMAN, { users: 60_000, usersAtLastClose: 60_000 });
    const { report, after } = playYear(state, recruitOne(4));
    const moving = report.costs.moving ?? 0;
    expect(moving).toBe(bill(5));
    expect(report.revenue).toBe(180_000);
    expect(report.profitable).toBe(report.revenue >= report.costs.total);
    expect(report.profitable).toBe(false);
    expect(report.revenue).toBeGreaterThanOrEqual(report.costs.total - moving);
    // a company that could pay everything but the bill ends below $0 and is rescued
    const cashBefore = report.cash.start + report.revenue - report.costs.total;
    expect(cashBefore).toBe(-40_000);
    expect(cashBefore + moving).toBeGreaterThanOrEqual(0);
    expect(report.career?.rescue).toMatchObject({ reason: "bankrupt", cashBefore });
    expect(report.out).toBeNull();
    expect(after.career?.office).toBe(1);
  });

  it("the bill uses the year's salary", () => {
    // two eras, the second with twice the salary: twice the bill
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1992, invented: false, values: { salary: 2 * DESIGN.salary } },
    );
    const first = playYear(teamOf(4, 0, atTurn(newCareer(config), 2)), recruitOne(4), config).report;
    const second = playYear(teamOf(4, 0, atTurn(newCareer(config), 3)), recruitOne(4), config).report;
    expect(first.career?.office?.bill).toBe(bill(5));
    expect(second.career?.office?.bill).toBe(2 * bill(5));
    expect(second.costs.moving).toBe(2 * bill(5));
  });
});

describe("the last office is the largest a company grows", () => {
  const with149 = teamOf(149, 4);
  const with150 = teamOf(150, 4);
  const poaching = (people: number): Partial<Plan> => ({ ...recruitFour(people), poachTarget: BLITZ });

  it("recruiting stops at the last office's size (Review Focus 1)", () => {
    const reportAt149 = playYear(with149, recruitFour(149)).report;
    expect(reportAt149.hiring).toMatchObject({ capacity: 5, wanted: 1, hired: 1 }); // capacity for 5, room for 1
    expect(reportAt149.headcount.end).toBe(150);
    expect(reportAt149.career?.office).toBeNull();
    const reportAt150 = playYear(with150, recruitFour(150)).report;
    expect(reportAt150.hiring).toMatchObject({ capacity: 5, wanted: 0, hired: 0 });
    expect(reportAt150.headcount.end).toBe(150);
    // The projection caps the hires it wants the same way.
    expect(projectTurn(viewFor(with149, HUMAN), { ...with149.companies[HUMAN].lastPlan, ...recruitFour(149) }, CAREER_TEST).hiresWanted).toBe(1);
    expect(projectTurn(viewFor(with150, HUMAN), { ...with150.companies[HUMAN].lastPlan, ...recruitFour(150) }, CAREER_TEST).hiresWanted).toBe(0);
  });

  it("a poach cannot overfill it (Review Focus 1)", () => {
    const report = playYear(with150, poaching(150)).report;
    expect(report.notes).toContain("Poach dropped: the campus is full.");
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    expect(report.plan.poachTarget).toBeNull();
  });

  it("with room for one, a poach that works takes the room a hire would have", () => {
    const succeeded = [];
    for (let seed = 1; seed <= 20; seed++) {
      const report = playYear(with149, poaching(149), CAREER_TEST, seed).report;
      expect(report.poach).not.toBeNull();
      expect(report.headcount.end).toBe(150);
      expect(report.hiring.wanted).toBe(report.poach?.success === true ? 0 : 1);
      if (report.poach?.success === true) succeeded.push(seed);
    }
    expect(succeeded.length).toBeGreaterThan(0);
    // The projection counts the planned poach: no room is left for a hire.
    expect(projectTurn(viewFor(with149, HUMAN), { ...with149.companies[HUMAN].lastPlan, ...poaching(149) }, CAREER_TEST).hiresWanted).toBe(0);
  });
});

describe("the projection", () => {
  it("the projection shows the bill before the year is ended", () => {
    const state = teamOf(4);
    const projection = projectTurn(viewFor(state, HUMAN), { ...state.companies[HUMAN].lastPlan, ...recruitOne(4) }, CAREER_TEST);
    expect(projection.career?.office).toEqual({ from: 0, to: 1, bill: 0.5 * 5 * DESIGN.salary });
    expect(projection.costs.moving).toBe(0.5 * 5 * DESIGN.salary);
    const { salaries, marketing, hiring, poaching, severance, moving, total } = projection.costs;
    expect(total).toBe(salaries + marketing + hiring + poaching + severance + (moving ?? 0));
  });

  it("the projection shows no bill for a team that still fits", () => {
    const state = teamOf(3);
    const projection = projectTurn(viewFor(state, HUMAN), { ...state.companies[HUMAN].lastPlan, ...recruitOne(3) }, CAREER_TEST);
    expect(projection.career?.office).toBeNull();
    expect(projection.costs.moving).toBe(0);
  });

  it("the projection counts every hire it wants and the poach it plans, so its cash errs low", () => {
    // 4 people in the garage want one hire but no candidate is left: the projection shows a bill, the report none
    const base = teamOf(4);
    const state = withState(base, { modifiers: { ...base.modifiers, extraCandidates: -DESIGN.hiring.candidatesPerTurn } });
    const plan = recruitOne(4);
    const projection = projectTurn(viewFor(state, HUMAN), { ...state.companies[HUMAN].lastPlan, ...plan }, CAREER_TEST);
    const { report } = playYear(state, plan);
    expect(report.hiring).toMatchObject({ wanted: 1, hired: 0 });
    expect(projection.costs.moving).toBeGreaterThan(0);
    expect(report.costs.moving).toBe(0);
    expect(projection.cash).toBeLessThan(report.cash.end);
    expect(careerOf(state, HUMAN).office).toBe(0);
  });
});

describe("the race", () => {
  it("a race report has no moving line", () => {
    expect("moving" in reportFor(resolve(newGame(), {}, 1, DESIGN), 0).costs).toBe(false);
  });
});
