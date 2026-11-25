import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { listingOf } from "./career";
import { CAREER_RULES, CAREER_TEST, atTurn, newCareer, qualify, withCareer } from "./careerKit";
import { raiseAmount, valuationOf } from "./formulas";
import { projectTurn } from "./project";
import { HUMAN, newGame, planOf, reportFor, resolve, withCompany, withState } from "./testKit";
import type { CompanyReport, GameState, Plan } from "./types";
import { viewFor } from "./view";

const step = DESIGN.pull.marketingStep;
const dollars = (n: number): string => `$${n.toLocaleString("en-US")}`;
const cashNote = (marketing: number): string => `Marketing set to ${dollars(marketing)}: it cannot exceed the cash in hand.`;
const marketingNotes = (report: CompanyReport): string[] => report.notes.filter((note) => note.startsWith("Marketing set"));

/** Seat 0 in 1990 with this much cash and 10,001 users: enough to raise, and a raise of 20% brings $300,030 at climate 1. */
const withCash = (cash: number, state: GameState = newCareer()): GameState => withCompany(state, HUMAN, { cash, users: 10_001, usersAtLastClose: 10_001 });

const play = (state: GameState, patch: Partial<Plan>, config = CAREER_TEST): CompanyReport =>
  reportFor(resolve(state, { [HUMAN]: patch }, 1, config), HUMAN);

describe("marketing is paid from the cash in hand", () => {
  it("marketing cannot exceed the cash the year starts with (Review Focus 1)", () => {
    const report = play(withCash(310_000), { marketing: 500_000 });
    expect(report.plan.marketing).toBe(Math.floor(310_000 / step) * step);
    expect(report.notes).toContain(`Marketing set to $${(Math.floor(310_000 / step) * step).toLocaleString("en-US")}: it cannot exceed the cash in hand.`);
  });

  it("when the step and the cash both cut a budget, only the cash note is written", () => {
    const report = play(withCash(310_000), { marketing: 510_000 });
    expect(marketingNotes(report)).toEqual([cashNote(300_000)]);
  });

  it("a raise this year counts", () => {
    const state = withCash(100_000);
    const company = state.companies[HUMAN];
    const raised = raiseAmount(valuationOf(company.users, company.hype, 1, CAREER_TEST), 20);
    const report = play(state, { raisePercent: 20, marketing: 1_000_000 });
    expect(report.raise?.amount).toBe(raised);
    expect(report.plan.marketing).toBe(Math.floor((100_000 + raised) / step) * step);
    expect(report.plan.marketing).toBeLessThan(1_000_000);
    expect(report.notes).toContain(cashNote(report.plan.marketing));
  });

  it("a listing this year counts", () => {
    // A listing of 4%, so that what it brings stays under the era's largest budget.
    const config = withCareer({ listing: { ...CAREER_RULES.listing, percent: 4 } });
    const state = withCompany(qualify(atTurn(newCareer(config), 2), HUMAN, config), HUMAN, { cash: 100_000 });
    const listed = listingOf(state.companies[HUMAN], 1, config).amount;
    const report = play(state, { goPublic: true, marketing: DESIGN.pull.maxMarketing }, config);
    expect(report.career?.listing?.amount).toBe(listed);
    expect(Math.floor((100_000 + listed) / step) * step).toBeLessThan(DESIGN.pull.maxMarketing);
    expect(report.plan.marketing).toBe(Math.floor((100_000 + listed) / step) * step);
  });

  it("the opening valuation follows the funding climate, in the turn and in the projection alike", () => {
    // climate { multiplier: 0.5, turnsLeft: 2 }: the raise is half as large, and so is the room for marketing
    const state = withState(withCash(100_000), { climate: { multiplier: 0.5, turnsLeft: 2 } });
    const company = state.companies[HUMAN];
    const raised = raiseAmount(valuationOf(company.users, company.hype, 1, CAREER_TEST), 20);
    const plan = planOf(state, HUMAN, { raisePercent: 20, marketing: 1_000_000 });
    const report = reportFor(resolve(state, { [HUMAN]: plan }, 1, CAREER_TEST), HUMAN);
    expect(report.plan.marketing).toBe(Math.floor((100_000 + Math.round(raised / 2)) / step) * step);
    expect(projectTurn(viewFor(state, 0), plan, CAREER_TEST).plan.marketing).toBe(report.plan.marketing);
  });

  it("a raise the rules drop brings nothing: the limit is the cash alone, and each fix-up has its note", () => {
    // seat 0 raised last year, has $100,000, and asks for a 20% raise and $500,000 of marketing
    const state = withCompany(withCash(100_000, atTurn(newCareer(), 2)), HUMAN, { lastRaise: { turn: 1, percent: 10, amount: 150_000 } });
    const report = play(state, { raisePercent: 20, marketing: 500_000 });
    expect(report.raise).toBeNull();
    expect(report.plan.marketing).toBe(Math.floor(100_000 / step) * step);
    expect(report.notes.filter((note) => note.startsWith("Raise dropped") || note.startsWith("Marketing set"))).toHaveLength(2);
    expect(report.notes).toContain("Raise dropped: the last raise was too recent.");
    expect(report.notes).toContain(cashNote(100_000));
  });

  it("a company with no cash can spend nothing", () => {
    // Cash below $0 counts as none.
    const report = play(withCash(-50_000), { marketing: 500_000 });
    expect(report.plan.marketing).toBe(0);
    expect(report.notes).toContain(cashNote(0));
  });

  it("a budget within the cash in hand is left alone, with no note", () => {
    const report = play(withCash(310_000), { marketing: 300_000 });
    expect(report.plan.marketing).toBe(300_000);
    expect(marketingNotes(report)).toEqual([]);
    // A step fix-up within the cash keeps today's note.
    expect(marketingNotes(play(withCash(310_000), { marketing: 60_000 }))).toEqual(["Marketing set to $50,000."]);
  });

  it("when the era's largest budget is the lower limit, today's note is written", () => {
    const report = play(withCash(10_000_000), { marketing: 9_000_000 });
    expect(report.plan.marketing).toBe(DESIGN.pull.maxMarketing);
    expect(marketingNotes(report)).toEqual([`Marketing set to ${dollars(DESIGN.pull.maxMarketing)}.`]);
  });

  it("the race has no such limit", () => {
    // DESIGN: $100,000 in hand, $500,000 of marketing
    const poor = withCompany(newGame(), HUMAN, { cash: 100_000 });
    expect(reportFor(resolve(poor, { 0: { marketing: 500_000 } }, 1, DESIGN), 0).plan.marketing).toBe(500_000);
  });
});
