import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { listingBlocker } from "./career";
import { CAREER_RULES, CAREER_TEST, atTurn, newCareer, qualify, withCareerOf, withEras } from "./careerKit";
import { round4, round6, valuationOf } from "./formulas";
import { raiseBlocker } from "./plan";
import { projectTurn } from "./project";
import { BLITZ, BOOT, HUMAN, launchedCompany, newGame, planOf, reportFor, resolve, withCompany } from "./testKit";
import type { Company, GameState, Plan } from "./types";
import { publicCompany, publicReport, viewFor } from "./view";

const RICH = 10_000_000;

/** Everyone on Growth and nothing spent on marketing: a company that has not launched keeps its users as they are. */
const allOnGrowth = (company: Company): Partial<Plan> => ({
  allocation: { product: 0, growth: company.headcount, recruiting: 0 },
  marketing: 0,
});

/** A team of 30, whose salaries ($1,200,000) are above the revenue of 300,000 users at the standard price ($900,000). */
const BIG_TEAM: Partial<Company> = { headcount: 30, headcountAtLastClose: 30, cash: RICH };

/** Two eras: the second, from 1992 (turn 3), raises the bar to 400,000 users. */
const HIGHER_BAR = withEras(
  { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
  { id: "b", name: "B", firstYear: 1992, invented: false, values: { ipo: { users: 400_000 } } },
);
const LAST_TURN_OF_FIRST_ERA = 2;

/** Seat 0 qualified and asking to go public in 1991, every other seat on its default plan. */
const listingYear = () => {
  const state = qualify(atTurn(newCareer(), 2), HUMAN);
  const company = state.companies[HUMAN];
  const plan = planOf(state, HUMAN, { goPublic: true });
  const result = resolve(state, { [HUMAN]: plan }, 1, CAREER_TEST);
  const report = reportFor(result, HUMAN);
  const after = result.state.companies[HUMAN];
  return { state, company, plan, result, report, after };
};

describe("qualifying to go public", () => {
  it("a company qualifies by closing a year at that year's bar with a profit", () => {
    // 1991. Three companies that have not launched and keep everyone on Growth, so their users stay as they are:
    // seat 0 has 250,000 users, seat 1 has 249,999, seat 2 has 250,000 and a team of 30, whose salaries are above its
    // revenue. Nobody spends on marketing.
    let state = withCompany(atTurn(newCareer(), 2), HUMAN, { users: 250_000, usersAtLastClose: 250_000 });
    state = withCompany(state, BLITZ, { users: 249_999, usersAtLastClose: 249_999 });
    state = withCompany(state, BOOT, { users: 250_000, usersAtLastClose: 250_000, ...BIG_TEAM });
    const patches = Object.fromEntries(state.companies.slice(0, 3).map((company) => [company.id, allOnGrowth(company)]));
    const result = resolve(state, patches, 1, CAREER_TEST);
    expect([HUMAN, BLITZ, BOOT].map((id) => reportFor(result, id).users.end)).toEqual([250_000, 249_999, 250_000]);
    expect(reportFor(result, BOOT).profitable).toBe(false);
    const after = result.state;
    expect(after.companies.slice(0, 3).map((company) => company.career?.qualified)).toEqual([true, false, false]);
    expect(after.companies.slice(0, 3).map((company) => listingBlocker(company, after.turn, CAREER_TEST))).toEqual([null, "users", "profit"]);
  });

  it("and stays qualified: a bad year or a higher bar later does not take it back", () => {
    // Qualified in 1991, the first era's last year, with 300,000 users; then a year at a loss in the second era,
    // whose bar of 400,000 it does not reach.
    const state = withCompany(atTurn(newCareer(HIGHER_BAR), LAST_TURN_OF_FIRST_ERA), HUMAN, { users: 300_000, usersAtLastClose: 300_000 });
    const first = resolve(state, { [HUMAN]: allOnGrowth(state.companies[HUMAN]) }, 1, HIGHER_BAR).state;
    expect(first.companies[HUMAN].career?.qualified).toBe(true);
    const losing = withCompany(first, HUMAN, BIG_TEAM);
    const played = resolve(losing, { [HUMAN]: allOnGrowth(losing.companies[HUMAN]) }, 1, HIGHER_BAR);
    expect(reportFor(played, HUMAN).profitable).toBe(false);
    const later = played.state;
    expect(later.companies[HUMAN].career?.qualified).toBe(true);
    expect(listingBlocker(later.companies[HUMAN], later.turn, HIGHER_BAR)).toBeNull();
  });

  it("until then it is told what it still needs, against the bar of the year being planned", () => {
    // Seat 0 closed the first era's last year with 300,000 users at a loss.
    let state = atTurn(newCareer(HIGHER_BAR), LAST_TURN_OF_FIRST_ERA);
    state = withCompany(state, HUMAN, { users: 300_000, usersAtLastClose: 300_000, ...BIG_TEAM });
    const played = resolve(state, { [HUMAN]: allOnGrowth(state.companies[HUMAN]) }, 1, HIGHER_BAR);
    expect(reportFor(played, HUMAN).profitable).toBe(false);
    const company = played.state.companies[HUMAN];
    expect(company.users).toBe(300_000);
    expect(company.career?.qualified).toBe(false);
    expect(listingBlocker(company, LAST_TURN_OF_FIRST_ERA, HIGHER_BAR)).toBe("profit");
    expect(listingBlocker(company, LAST_TURN_OF_FIRST_ERA + 1, HIGHER_BAR)).toBe("users"); // the new bar is out of reach this year
  });

  it("who else may not", () => {
    expect(listingBlocker(qualify(newCareer(), HUMAN).companies[HUMAN], 2, CAREER_TEST)).toBeNull();
    expect(listingBlocker(newCareer().companies[3], 1, CAREER_TEST)).toBe("users"); // 10,000 users, under the bar
    const listed = withCareerOf(qualify(newCareer(), HUMAN), HUMAN, { listed: { turn: 3, valuation: 50_000_000, amount: 10_000_000 } });
    expect(listingBlocker(listed.companies[HUMAN], 5, CAREER_TEST)).toBe("listed");
    expect(listingBlocker(newGame().companies[HUMAN], 2, DESIGN)).toBe("unavailable");
  });
});

describe("going public", () => {
  it("sells 20% at the year's opening valuation", () => {
    const { state, company, report, after } = listingYear();
    const opening = valuationOf(company.users, company.hype, 1, CAREER_TEST);
    expect(report.career?.listing).toEqual({ valuation: opening, amount: Math.round(opening * 0.2) });
    expect(report.cash.end).toBe(report.cash.start + Math.round(opening * 0.2) + report.revenue - report.costs.total);
    expect(report.equity).toBe(round6(company.founderEquity * 0.8));
    expect(after.investorSeats).toBe(company.investorSeats + 1);
    expect(report.plan.allocation.product + report.plan.allocation.growth + report.plan.allocation.recruiting).toBe(company.headcount);
    expect(after.lastRaise).toEqual(company.lastRaise); // no cooldown started
    expect(report.raise).toBeNull();
    expect(after.career?.listed).toEqual({ turn: state.turn, valuation: opening, amount: Math.round(opening * 0.2) });
    expect(report.plan.goPublic).toBe(true);
  });

  it("gains 20 hype in the year it lists, capped at 100", () => {
    const { company, report } = listingYear();
    expect(report.career?.hype.listing).toBe(20);
    expect(report.hype.end).toBe(round4(Math.min(100, company.hype * (1 - DESIGN.hype.decay) + report.hype.growth + 20)));

    // At 100 hype, in a year it grows: 80 left after decay, 5 for growth and 20 for the listing end at 100, not 105.
    const hyped = withCompany(qualify(atTurn(newCareer(), 2), HUMAN), HUMAN, { hype: 100, usersAtLastClose: 100_000 });
    const capped = reportFor(resolve(hyped, { [HUMAN]: { goPublic: true } }, 1, CAREER_TEST), HUMAN);
    expect(capped.hype.growth).toBe(5);
    expect(capped.career?.hype.listing).toBe(20);
    expect(capped.hype.end).toBe(100);
  });

  it("is worth 25% more from the end of that year on", () => {
    const { result, report } = listingYear();
    expect(report.valuation).toBe(Math.round(valuationOf(report.users.end, report.hype.end, 1, CAREER_TEST) * 1.25));
    const nextReport = reportFor(resolve(result.state, {}, 1, CAREER_TEST), HUMAN);
    expect(nextReport.career?.listing).toBeNull();
    expect(nextReport.valuation).toBe(Math.round(valuationOf(nextReport.users.end, nextReport.hype.end, 1, CAREER_TEST) * 1.25));
  });

  it("so the founder's stake does not shrink", () => {
    expect(CAREER_RULES.listing.premium * (1 - CAREER_RULES.listing.percent / 100)).toBeGreaterThanOrEqual(1);
  });

  it("the game goes on", () => {
    const { result } = listingYear();
    expect(result.log.outcome).toBeNull();
  });

  it("a public company cannot raise privately", () => {
    const { state, result, after } = listingYear();
    expect(raiseBlocker(after, state.turn + 1, CAREER_TEST)).toBe("public");
    const next = resolve(result.state, { [HUMAN]: { raisePercent: 10 } }, 1, CAREER_TEST);
    expect(reportFor(next, HUMAN).notes).toContain("Raise dropped: a public company cannot raise privately.");
    expect(reportFor(next, HUMAN).raise).toBeNull();
  });
});

describe("plans that ask for the impossible (Review Focus 1)", () => {
  const notQualified = (): GameState => launchedCompany(atTurn(newCareer(), 2), HUMAN, { users: 300_000 });
  const alreadyListed = (): GameState =>
    withCareerOf(qualify(atTurn(newCareer(), 4), HUMAN), HUMAN, { listed: { turn: 3, valuation: 50_000_000, amount: 10_000_000 } });

  it.each([
    ["with fewer users than the bar", () => atTurn(newCareer(), 2), "Going public dropped: it takes a year that closes with 250,000 users and a profit."],
    ["with the users, before a year has closed with a profit", notQualified, "Going public dropped: no year has yet closed at the bar with a profit."],
    ["a second time", alreadyListed, "Going public dropped: the company is already public."],
  ])("asking to go public %s is dropped with the reason", (_case, stateOf, note) => {
    const report = reportFor(resolve(stateOf(), { [HUMAN]: { goPublic: true } }, 1, CAREER_TEST), HUMAN);
    expect(report.notes).toContain(note);
    expect(report.career?.listing).toBeNull();
    expect(report.plan.goPublic).toBe(false);
  });

  it("the users note names the bar of the year being planned", () => {
    const state = atTurn(newCareer(HIGHER_BAR), LAST_TURN_OF_FIRST_ERA + 1);
    const report = reportFor(resolve(state, { [HUMAN]: { goPublic: true } }, 1, HIGHER_BAR), HUMAN);
    expect(report.notes).toContain("Going public dropped: it takes a year that closes with 400,000 users and a profit.");
  });

  it("going public and raising in one year keeps the listing and drops the raise", () => {
    const state = qualify(atTurn(newCareer(), 2), HUMAN);
    const report = reportFor(resolve(state, { [HUMAN]: { goPublic: true, raisePercent: 10 } }, 1, CAREER_TEST), HUMAN);
    expect(report.notes).toContain("Raise dropped: a company cannot raise privately in the year it goes public.");
    expect(report.raise).toBeNull();
    expect(report.career?.listing).not.toBeNull();
    expect(report.plan.raisePercent).toBe(0);
  });

  it("a career plan always says whether it goes public, as its last key", () => {
    const report = reportFor(resolve(newCareer(), {}, 1, CAREER_TEST), HUMAN);
    expect(Object.keys(report.plan).at(-1)).toBe("goPublic");
    expect(report.plan.goPublic).toBe(false);
  });

  it("a race plan that says goPublic is played as if it did not", () => {
    expect(resolve(newGame(), { 0: { goPublic: true } }, 1, DESIGN).log).toEqual(resolve(newGame(), {}, 1, DESIGN).log);
    expect(JSON.stringify(resolve(newGame(), { 0: { goPublic: true } }, 1, DESIGN))).toBe(JSON.stringify(resolve(newGame(), {}, 1, DESIGN)));
  });
});

describe("what the planner and the rivals see", () => {
  it("the projection shows the exact amount before the year is ended", () => {
    const { state, plan, report, after } = listingYear();
    const projection = projectTurn(viewFor(state, HUMAN), plan, CAREER_TEST);
    expect(projection.career?.listing).toEqual(report.career?.listing);
    expect([projection.equity, projection.investorSeats]).toEqual([report.equity, after.investorSeats]);
    expect(projection.plan).toEqual(report.plan);
    // The same cash, hype and premium as the turn, against the same plan without the listing.
    const without = projectTurn(viewFor(state, HUMAN), { ...plan, goPublic: false }, CAREER_TEST);
    expect(without.career?.listing).toBeNull();
    expect(projection.users).toBe(without.users);
    expect(projection.cash).toBe(without.cash + (report.career?.listing?.amount ?? 0));
    expect(projection.hype).toBeCloseTo(without.hype + 20, 4);
    expect(without.valuation).toBe(valuationOf(without.users, without.hype, 1, CAREER_TEST));
    expect(projection.valuation).toBe(Math.round(valuationOf(projection.users, projection.hype, 1, CAREER_TEST) * 1.25));
  });

  it("a race projection has no career", () => {
    const projection = projectTurn(viewFor(newGame(), HUMAN), null, DESIGN);
    expect("career" in projection).toBe(false);
    expect("goPublic" in projection.plan).toBe(false);
  });

  it("everyone can see that a rival went public", () => {
    const { state, report, after } = listingYear();
    expect(publicReport(report).career?.listed).toBe(true);
    expect(publicCompany(after).career?.listed?.turn).toBe(state.turn);
    expect(publicReport(reportFor(resolve(newCareer(), {}, 1, CAREER_TEST), HUMAN)).career).toEqual({ listed: false, rescued: null, movedTo: null });
    expect("career" in publicReport(reportFor(resolve(newGame(), {}, 1, DESIGN), HUMAN))).toBe(false);
  });
});
