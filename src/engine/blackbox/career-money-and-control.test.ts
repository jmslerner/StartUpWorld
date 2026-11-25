// Black-box tests of the career's rules on money and control, written from the documents alone (the engine's code
// and its own tests were not read):
//   C5  going public is a decision          (rulings 18 to 21, step 1, step 3, step 10, closing the books)
//   C6  a public company no longer raises    (ruling 22)
//   C7  one rescue                           (rulings 24 to 30, step 12)
//   C11 marketing is paid from cash in hand  (ruling 23)
//
// Every test runs on CAREER_TEST: the race's design numbers played as a career. The numbers that matter here:
//   salary $40K a person a year, price $3 a user (Standard), valuation $150 a user × (1 + hype/100) × climate,
//   marketing step $25K and at most $5M, raise needs 1,000 users and no raise in the previous 2 turns,
//   hype decays 20% (× 0.8), +5 when users grow 25%+, +10 when a raise closes,
//   board votes (30%) while investors outnumber founders, after a bad year (users fell or runway under 2),
//   startup: $500K, 3 people, hype 10, equity 1, seats 2 founder / 0 investor;
//   incumbent: 8 people, hype 20, equity 0.6, seats 2 / 1;
//   listing 20% / premium 1.25 / hype 20 / 1 investor seat; rescue keeps 0.5 / 2 seats / hype −10 / 1 year of salary.
//
// How scenarios are kept exact:
//  - `alone(id, turn)` leaves only that company in the game; the others went out that same turn, so no newcomer
//    takes a seat before turn + 2. A lone launched company takes the whole pool, churned users included, so it ends
//    on its users + the year's new users (+ carried-in users, none here).
//  - One flat era from 1990, so new users in turn t are 20,000 × 1.1^(t−1): turn 1 20,000, turn 5 29,282,
//    turn 6 32,210, turn 7 35,431, turn 10 47,159.
//  - Plans put everyone on Product with "hire at most 0" unless a test says otherwise: costs are salaries alone.
//  - Events are off (chance 0, no dated cards).

import { describe, expect, it } from "vitest";
import type { Company, CompanyId, CompanyReport, GameState, Plan } from "../index";
import { CAREER_TEST, atTurn, careerOf, newCareer, outSince, qualify, withCareer, withCareerOf, withEras } from "../careerKit";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, reportFor, resolve, withCompany } from "../testKit";

// ── Fixtures ──

const SEATS: readonly CompanyId[] = [HUMAN, BLITZ, BOOT, INCUMBENT];
type Config = typeof CAREER_TEST;
type Era = Parameters<typeof withEras>[number];

const era = (id: string, firstYear: number, values: Era["values"]): Era => ({ id, name: id, firstYear, invented: false, values });

/** Only `id` is left in the game, at `turn`; the others went out this turn, so nobody new arrives before turn + 2. */
const alone = (id: CompanyId, turn: number, config: Config = CAREER_TEST): GameState => {
  let state = atTurn(newCareer(config), turn);
  for (const other of SEATS) if (other !== id) state = outSince(state, other, turn);
  return state;
};

/** A lone launched company with `users` now and at last close. */
const going = (id: CompanyId, turn: number, patch: Partial<Company> = {}, config: Config = CAREER_TEST): GameState =>
  launchedCompany(alone(id, turn, config), id, { users: 1_000, ...patch });

/** A lone company that has qualified to go public (users at the turn's bar, last year profitable). */
const qualified = (id: CompanyId, turn: number, patch: Partial<Company> = {}, config: Config = CAREER_TEST): GameState =>
  withCompany(qualify(alone(id, turn, config), id, config), id, patch);

/** Everyone on Product, no hires; anything else patched. */
const all = (state: GameState, id: CompanyId, patch: Partial<Plan> = {}): Partial<Plan> => {
  const raising = (patch.raisePercent ?? 0) > 0 ? 1 : 0;
  return { allocation: { product: state.companies[id].headcount - raising, growth: 0, recruiting: 0 }, hireLimit: 0, marketing: 0, ...patch };
};

const play = (state: GameState, id: CompanyId, patch: Partial<Plan> = {}, config: Config = CAREER_TEST, seed = 1) => {
  const result = resolve(state, { [id]: all(state, id, patch) }, seed, config);
  return { result, report: reportFor(result, id), company: result.state.companies[id] };
};

const listingOfReport = (report: CompanyReport) => report.career?.listing ?? null;
const marketingNotes = (report: CompanyReport) => report.notes.filter((note) => /marketing/i.test(note));
const totalPeople = (plan: Plan) => plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting;

/** The first seed from 1 to 300 for which the predicate holds, or 0. */
const firstSeed = (predicate: (seed: number) => boolean): number => {
  for (let seed = 1; seed <= 300; seed++) if (predicate(seed)) return seed;
  return 0;
};

const withMaxMarketing = (maxMarketing: number, base: Config = CAREER_TEST): Config => ({ ...base, pull: { ...base.pull, maxMarketing } });
const withBar = (users: number, base: Config = CAREER_TEST): Config => ({ ...base, ipo: { users } });

// The standard listing scenario: the player alone in turn 5, qualified, 250,000 users, hype 10, $500K.
//   Opening valuation = 250,000 × 150 × 1.10 = 41,250,000; listing = 20% = 8,250,000.
//   Users end 250,000 + 29,282 = 279,282 (+11.7%: no growth hype). Hype 10 × 0.8 + 20 = 28.
//   Revenue 279,282 × 3 = 837,846; costs 3 × 40,000 = 120,000.
const OPENING = 41_250_000;
const LISTING = 8_250_000;
const listingYear = (patch: Partial<Plan> = {}, config: Config = CAREER_TEST) => play(qualified(HUMAN, 5, {}, config), HUMAN, { goPublic: true, ...patch }, config);

// The standard rescue scenario: the player alone in turn 5, 1,000 users, 3 people, $10K.
//   Users end 1,000 + 29,282 = 30,282 (growth hype +5); revenue 90,846; costs 120,000;
//   cash 10,000 + 90,846 − 120,000 = −19,154: below $0, the first failure.
//   Hype 10 × 0.8 + 5 = 13, then the rescue's −10 = 3.
const broke = (patch: Partial<Company> = {}, turn = 5) => going(HUMAN, turn, { cash: 10_000, ...patch });

// ── C5: going public ──

describe("C5: going public is a decision", () => {
  it("a listing sells 20% of the company at the year's opening valuation", () => {
    const { report } = listingYear();
    expect(listingOfReport(report)).toEqual({ valuation: OPENING, amount: LISTING });
  });

  it("the founder's equity shrinks to 80% of what it was", () => {
    expect(listingYear().company.founderEquity).toBeCloseTo(0.8, 10);
  });

  it("investors gain one board seat and the founders keep theirs", () => {
    const { company } = listingYear();
    expect(company.investorSeats).toBe(1);
    expect(company.founderSeats).toBe(2);
  });

  it("the listing's cash arrives in the year: cash = opening + listing + revenue − costs", () => {
    const { report, company } = listingYear();
    expect(report.revenue).toBe(837_846);
    expect(report.costs.total).toBe(120_000);
    expect(company.cash).toBe(500_000 + LISTING + 837_846 - 120_000); // 9,467,846
  });

  it("in the year it lists the company gains 20 hype, added to the year's other hype", () => {
    const { report } = listingYear();
    expect(report.career?.hype.listing).toBe(20);
    expect(report.hype.end).toBeCloseTo(28, 4); // 10 × 0.8 + 20
  });

  it("the year closes at a valuation 25% above a private company's", () => {
    // 279,282 × 150 × 1.28 × 1.25 = 67,027,680
    expect(listingYear().report.valuation).toBe(67_027_680);
  });

  it("a qualified company that does not list closes at the plain valuation", () => {
    const { report } = play(qualified(HUMAN, 5), HUMAN);
    // 279,282 × 150 × 1.08 = 45,243,684 (hype 10 × 0.8)
    expect(report.valuation).toBe(45_243_684);
    expect(listingOfReport(report)).toBeNull();
    expect(careerOf(play(qualified(HUMAN, 5), HUMAN).result.state, HUMAN).listed).toBeNull();
  });

  it("closing the books records the listing: its turn, the valuation it sold at and the cash", () => {
    const { result } = listingYear();
    expect(careerOf(result.state, HUMAN).listed).toEqual({ turn: 5, valuation: OPENING, amount: LISTING });
  });

  it("the resolved plan says the company goes public", () => {
    expect(listingYear().report.plan.goPublic).toBe(true);
  });

  it("a career plan that does not ask to list resolves with goPublic false and no listing", () => {
    const { report } = play(going(HUMAN, 5), HUMAN);
    expect(report.plan.goPublic).toBe(false);
    expect(listingOfReport(report)).toBeNull();
    expect(report.career?.hype.listing).toBe(0);
  });

  it("going public takes nobody off work", () => {
    const { report } = listingYear();
    expect(totalPeople(report.plan)).toBe(3);
    expect(report.work.effective).toBeCloseTo(Math.pow(3, 0.9), 5);
    expect(report.work.product).toBeCloseTo(Math.pow(3, 0.9), 5);
  });

  it("going public is not a raise: no raise in the report and no raise cooldown starts", () => {
    const { report, company } = listingYear();
    expect(report.raise).toBeNull();
    expect(company.lastRaise).toBeNull();
  });

  it("a company still in a raise's cooldown may go public", () => {
    const state = qualified(HUMAN, 5, { lastRaise: { turn: 4, percent: 10, amount: 100_000 }, founderEquity: 0.9, investorSeats: 1 });
    const { report, company } = play(state, HUMAN, { goPublic: true });
    expect(listingOfReport(report)?.amount).toBe(LISTING);
    expect(company.founderEquity).toBeCloseTo(0.72, 10); // 0.9 × 0.8
    expect(company.lastRaise).toEqual({ turn: 4, percent: 10, amount: 100_000 });
  });

  it("the listing is priced with the funding climate in force", () => {
    const state = { ...qualified(HUMAN, 5), climate: { multiplier: 0.5, turnsLeft: 2 } };
    const { report } = play(state, HUMAN, { goPublic: true });
    // 250,000 × 150 × 1.1 × 0.5 = 20,625,000; 20% = 4,125,000
    expect(listingOfReport(report)).toEqual({ valuation: 20_625_000, amount: 4_125_000 });
  });

  it("the listing is priced at the value of a user in the year it happens", () => {
    const config = withEras(era("one", 1990, {}), era("two", 1994, { valuation: { perUser: 200 } }));
    const { report } = play(qualified(HUMAN, 5, {}, config), HUMAN, { goPublic: true }, config);
    // turn 5 is 1994: 250,000 × 200 × 1.1 = 55,000,000; 20% = 11,000,000
    expect(listingOfReport(report)).toEqual({ valuation: 55_000_000, amount: 11_000_000 });
  });

  it("the Incumbent lists on the same terms", () => {
    const state = qualified(INCUMBENT, 5);
    const { report, company } = play(state, INCUMBENT, { goPublic: true });
    // 250,000 × 150 × 1.2 = 45,000,000; 20% = 9,000,000; equity 0.6 × 0.8; seats 1 + 1
    expect(listingOfReport(report)).toEqual({ valuation: 45_000_000, amount: 9_000_000 });
    expect(company.founderEquity).toBeCloseTo(0.48, 10);
    expect(company.investorSeats).toBe(2);
  });

  it("a company that raised before lists from the equity it has left", () => {
    const state = qualified(HUMAN, 5, { founderEquity: 0.7, investorSeats: 1, lastRaise: { turn: 2, percent: 30, amount: 100_000 } });
    const { company } = play(state, HUMAN, { goPublic: true });
    expect(company.founderEquity).toBeCloseTo(0.56, 10); // 0.7 × 0.8
    expect(company.investorSeats).toBe(2);
  });

  it("a computer startup lists on the same terms", () => {
    const { report, company } = play(qualified(BOOT, 5), BOOT, { goPublic: true });
    expect(listingOfReport(report)).toEqual({ valuation: OPENING, amount: LISTING });
    expect(company.founderEquity).toBeCloseTo(0.8, 10);
  });

  it("a company that has not qualified and is short of users cannot list, and is told it needs users", () => {
    const { report, company } = play(going(HUMAN, 5, { users: 100_000 }), HUMAN, { goPublic: true });
    expect(report.plan.goPublic).toBe(false);
    expect(listingOfReport(report)).toBeNull();
    expect(company.founderEquity).toBe(1);
    expect(report.notes.some((note) => /user/i.test(note))).toBe(true);
  });

  it("a company with the users but no qualifying year cannot list, and is told it needs a profitable year", () => {
    const { report, company } = play(going(HUMAN, 5, { users: 300_000 }), HUMAN, { goPublic: true });
    expect(report.plan.goPublic).toBe(false);
    expect(company.investorSeats).toBe(0);
    expect(report.notes.some((note) => /profit/i.test(note))).toBe(true);
  });

  it("what an unqualified company still needs is measured against the bar of the year being planned", () => {
    // 300,000 users clears the base bar of 250,000 but not 1994's bar of 500,000.
    const config = withEras(era("one", 1990, {}), era("two", 1994, { ipo: { users: 500_000 } }));
    const { report } = play(going(HUMAN, 5, { users: 300_000 }, config), HUMAN, { goPublic: true }, config);
    expect(report.plan.goPublic).toBe(false);
    expect(report.notes.some((note) => /user/i.test(note))).toBe(true);
  });

  it("a public company cannot list a second time", () => {
    const first = listingYear();
    const { report, company } = play(first.result.state, HUMAN, { goPublic: true });
    expect(report.plan.goPublic).toBe(false);
    expect(listingOfReport(report)).toBeNull();
    expect(report.notes.length).toBeGreaterThan(0);
    expect(company.founderEquity).toBeCloseTo(0.8, 10);
    expect(company.investorSeats).toBe(1);
    expect(careerOf(play(first.result.state, HUMAN, { goPublic: true }).result.state, HUMAN).listed?.turn).toBe(5);
  });

  it("a public company keeps the premium in later years, without the listing's hype", () => {
    const { report } = play(listingYear().result.state, HUMAN);
    // Turn 6: users 279,282 + 32,210 = 311,492; hype 28 × 0.8 = 22.4.
    // 311,492 × 150 × 1.224 × 1.25 = 71,487,414
    expect(report.career?.hype.listing).toBe(0);
    expect(report.hype.end).toBeCloseTo(22.4, 4);
    expect(report.valuation).toBe(71_487_414);
  });

  it("a year that closes exactly at the bar with revenue exactly covering costs qualifies the company", () => {
    // Turn 1: 20,000 users + 20,000 new = 40,000; revenue 120,000 = salaries 3 × 40,000.
    const config = withBar(40_000);
    const { report, result } = play(going(HUMAN, 1, { users: 20_000 }, config), HUMAN, {}, config);
    expect(report.users.end).toBe(40_000);
    expect(report.revenue).toBe(120_000);
    expect(report.costs.total).toBe(120_000);
    expect(careerOf(result.state, HUMAN).qualified).toBe(true);
  });

  it("a year that closes one user short of the bar does not qualify the company", () => {
    const config = withBar(40_001);
    const { result } = play(going(HUMAN, 1, { users: 20_000 }, config), HUMAN, {}, config);
    expect(careerOf(result.state, HUMAN).qualified).toBe(false);
  });

  it("a year at the bar whose revenue falls $3 short of its costs does not qualify the company", () => {
    // 19,999 + 20,000 = 39,999 users; revenue 119,997 < 120,000.
    const config = withBar(39_999);
    const { report, result } = play(going(HUMAN, 1, { users: 19_999 }, config), HUMAN, {}, config);
    expect(report.revenue).toBe(119_997);
    expect(careerOf(result.state, HUMAN).qualified).toBe(false);
  });

  it("marketing counts in the costs a qualifying year must cover", () => {
    const config = withBar(40_000);
    const { result } = play(going(HUMAN, 1, { users: 20_000 }, config), HUMAN, { marketing: 25_000 }, config);
    expect(careerOf(result.state, HUMAN).qualified).toBe(false); // 120,000 < 145,000
  });

  it("once qualified a company stays qualified after a losing year", () => {
    const state = withCareerOf(going(HUMAN, 5, { cash: 1_000_000 }), HUMAN, { qualified: true });
    const { report, result } = play(state, HUMAN, { marketing: 500_000 });
    expect(report.profitable).toBe(false);
    expect(careerOf(result.state, HUMAN).qualified).toBe(true);
  });

  it("a company that qualified under 1990's bar lists in 1991 at 1991's opening valuation, though 1991's bar is higher", () => {
    const config = withEras(era("one", 1990, { ipo: { users: 40_000 } }), era("two", 1991, { ipo: { users: 1_000_000 } }));
    const first = play(going(HUMAN, 1, { users: 20_000 }, config), HUMAN, {}, config);
    expect(careerOf(first.result.state, HUMAN).qualified).toBe(true);
    const { report, company } = play(first.result.state, HUMAN, { goPublic: true }, config);
    // Opening 1991: 40,000 users, hype 10 × 0.8 + 5 (users doubled) = 13. 40,000 × 150 × 1.13 = 6,780,000.
    expect(listingOfReport(report)).toEqual({ valuation: 6_780_000, amount: 1_356_000 });
    expect(company.founderEquity).toBeCloseTo(0.8, 10);
  });

  it("a qualified company may list in the last year, 2038", () => {
    const { report, company } = play(qualified(HUMAN, 49), HUMAN, { goPublic: true });
    expect(listingOfReport(report)).toEqual({ valuation: OPENING, amount: LISTING });
    expect(company.founderEquity).toBeCloseTo(0.8, 10);
  });

  it("the listing's hype is added before the cap at 100", () => {
    const state = qualified(HUMAN, 5, { hype: 100, usersAtLastClose: 200_000 });
    const { report } = play(state, HUMAN, { goPublic: true });
    // 100 × 0.8 + 5 (279,282 is 40% above 200,000) + 20 = 105, capped to 100.
    expect(report.hype.end).toBe(100);
    // Opening valuation reads start-of-year hype: 250,000 × 150 × 2 = 75,000,000.
    expect(listingOfReport(report)).toEqual({ valuation: 75_000_000, amount: 15_000_000 });
  });

  it("the listing's percent, premium, hype and seats are read from the config", () => {
    const config = withCareer({ listing: { percent: 10, premium: 1.5, hype: 30, investorSeats: 2 } });
    const { report, company } = play(qualified(HUMAN, 5, {}, config), HUMAN, { goPublic: true }, config);
    expect(listingOfReport(report)).toEqual({ valuation: OPENING, amount: 4_125_000 });
    expect(company.founderEquity).toBeCloseTo(0.9, 10);
    expect(company.investorSeats).toBe(2);
    expect(report.hype.end).toBeCloseTo(38, 4); // 8 + 30
    expect(report.valuation).toBe(86_717_061); // 279,282 × 150 × 1.38 × 1.5
  });

  it("a race plan that asks to go public is played as if it did not", () => {
    const state = launchedCompany(onlyActive(newGame(), [HUMAN]), HUMAN, { users: 10_000 });
    const result = resolve(state, { [HUMAN]: all(state, HUMAN, { goPublic: true }) });
    const report = reportFor(result, HUMAN);
    expect(report.plan.goPublic).toBeUndefined();
    expect(report.career).toBeUndefined();
    expect(result.state.companies[HUMAN].founderEquity).toBe(1);
    expect(result.state.companies[HUMAN].investorSeats).toBe(0);
  });
});

// ── C6: no private raise once public ──

describe("C6: a public company no longer raises privately", () => {
  const publicCo = (turn = 5, patch: Partial<Company> = {}) =>
    withCareerOf(going(HUMAN, turn, { users: 10_000, cash: 100_000, ...patch }), HUMAN, { listed: { turn: 3, valuation: 1_000_000, amount: 200_000 }, qualified: true });

  it("a public company's raise is dropped with a note, and nothing is sold", () => {
    const { report, company } = play(publicCo(), HUMAN, { raisePercent: 20 });
    expect(report.raise).toBeNull();
    expect(report.plan.raisePercent).toBe(0);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(company.founderEquity).toBe(1);
    expect(company.investorSeats).toBe(0);
    expect(company.lastRaise).toBeNull();
  });

  it("a public company's dropped raise brings in no cash", () => {
    const { report, company } = play(publicCo(), HUMAN, { raisePercent: 30 });
    expect(company.cash).toBe(100_000 + report.revenue - report.costs.total);
  });

  it("the person a dropped raise would have taken goes back to work", () => {
    const { report } = play(publicCo(), HUMAN, { raisePercent: 20 }); // planned 2 on Product + the fundraiser
    expect(totalPeople(report.plan)).toBe(3);
  });

  it("a public company still cannot raise many years after it listed", () => {
    const { report, company } = play(publicCo(40), HUMAN, { raisePercent: 10 });
    expect(report.raise).toBeNull();
    expect(company.founderEquity).toBe(1);
  });

  it("a plan that both raises and goes public loses the raise and keeps the listing", () => {
    const { report, company } = play(qualified(HUMAN, 5, { cash: 100_000 }), HUMAN, { raisePercent: 20, goPublic: true });
    expect(report.raise).toBeNull();
    expect(report.plan.raisePercent).toBe(0);
    expect(report.plan.goPublic).toBe(true);
    expect(listingOfReport(report)?.amount).toBe(LISTING);
    expect(company.founderEquity).toBeCloseTo(0.8, 10); // not 0.8 × 0.8
    expect(company.investorSeats).toBe(1);
    expect(company.cash).toBe(100_000 + LISTING + report.revenue - report.costs.total);
  });

  it("a qualified company that has not listed still raises privately", () => {
    const state = withCareerOf(going(HUMAN, 5, { users: 10_000 }), HUMAN, { qualified: true });
    const { report, company } = play(state, HUMAN, { raisePercent: 20 });
    // 10,000 × 150 × 1.1 = 1,650,000; 20% = 330,000
    expect(report.raise).toEqual({ percent: 20, valuation: 1_650_000, amount: 330_000 });
    expect(company.founderEquity).toBeCloseTo(0.8, 10);
  });
});

// ── C11: marketing from cash in hand ──

describe("C11: marketing is paid from cash in hand", () => {
  it("a budget above the opening cash is cut to it, with a note", () => {
    const { report } = play(going(HUMAN, 5, { cash: 500_000 }), HUMAN, { marketing: 600_000 });
    expect(report.plan.marketing).toBe(500_000);
    expect(report.costs.marketing).toBe(500_000);
    expect(marketingNotes(report)).toHaveLength(1);
  });

  it("a budget exactly equal to the opening cash is kept, with no note", () => {
    const { report } = play(going(HUMAN, 5, { cash: 500_000 }), HUMAN, { marketing: 500_000 });
    expect(report.plan.marketing).toBe(500_000);
    expect(marketingNotes(report)).toHaveLength(0);
  });

  it("the room is rounded down to the marketing step", () => {
    expect(play(going(HUMAN, 5, { cash: 499_999 }), HUMAN, { marketing: 500_000 }).report.plan.marketing).toBe(475_000);
    expect(play(going(HUMAN, 5, { cash: 510_000 }), HUMAN, { marketing: 600_000 }).report.plan.marketing).toBe(500_000);
  });

  it("the room is rounded to the marketing step of the year", () => {
    const config = withEras(era("one", 1990, { pull: { marketingStep: 100_000 } }));
    const { report } = play(going(HUMAN, 5, { cash: 550_000 }, config), HUMAN, { marketing: 1_000_000 }, config);
    expect(report.plan.marketing).toBe(500_000);
  });

  it("a raise in the same year adds its amount to the room", () => {
    const { report } = play(going(HUMAN, 5, { users: 10_000, cash: 100_000 }), HUMAN, { raisePercent: 20, marketing: 1_000_000 });
    // 100,000 + 330,000 = 430,000, down to 425,000
    expect(report.raise?.amount).toBe(330_000);
    expect(report.plan.marketing).toBe(425_000);
  });

  it("opening cash below $0 counts as $0", () => {
    const { report } = play(going(HUMAN, 5, { users: 10_000, cash: -100_000 }), HUMAN, { raisePercent: 20, marketing: 400_000 });
    // 0 + 330,000, down to 325,000 (counting −100,000 would give 225,000)
    expect(report.plan.marketing).toBe(325_000);
  });

  it("opening cash below $0 with nothing coming in leaves no room at all", () => {
    const { report } = play(going(HUMAN, 5, { cash: -100_000 }), HUMAN, { marketing: 100_000 });
    expect(report.plan.marketing).toBe(0);
  });

  it("a raise dropped for its cooldown brings no room", () => {
    const state = going(HUMAN, 5, { users: 10_000, cash: 100_000, lastRaise: { turn: 4, percent: 10, amount: 100_000 }, investorSeats: 1, founderEquity: 0.9 });
    const { report } = play(state, HUMAN, { raisePercent: 20, marketing: 1_000_000 });
    expect(report.raise).toBeNull();
    expect(report.plan.marketing).toBe(100_000);
  });

  it("a raise dropped for too few users brings no room", () => {
    const { report } = play(going(HUMAN, 5, { users: 500, cash: 100_000 }), HUMAN, { raisePercent: 20, marketing: 1_000_000 });
    expect(report.raise).toBeNull();
    expect(report.plan.marketing).toBe(100_000);
  });

  it("a public company's dropped raise brings no room", () => {
    const state = withCareerOf(going(HUMAN, 5, { users: 10_000, cash: 100_000 }), HUMAN, { listed: { turn: 3, valuation: 1, amount: 1 }, qualified: true });
    const { report } = play(state, HUMAN, { raisePercent: 20, marketing: 1_000_000 });
    expect(report.plan.marketing).toBe(100_000);
  });

  it("a listing in the same year adds its amount to the room", () => {
    const config = withMaxMarketing(20_000_000);
    const { report } = listingYear({ marketing: 10_000_000 }, config);
    expect(report.plan.marketing).toBe(500_000 + LISTING); // 8,750,000
  });

  it("a listing that is dropped brings no room", () => {
    const { report } = play(going(HUMAN, 5, { cash: 500_000 }), HUMAN, { goPublic: true, marketing: 1_000_000 });
    expect(report.plan.marketing).toBe(500_000);
  });

  it("a raise lost to a listing brings no room; the listing does", () => {
    const config = withMaxMarketing(50_000_000);
    const state = qualified(HUMAN, 5, { cash: 100_000 }, config);
    const { report } = play(state, HUMAN, { raisePercent: 30, goPublic: true, marketing: 20_000_000 }, config);
    expect(report.plan.marketing).toBe(100_000 + LISTING); // 8,350,000
  });

  it("when the cash cut applies its note is the only marketing note", () => {
    // 6,000,000 is over both the $5M limit and the $500K in hand.
    const { report } = play(going(HUMAN, 5, { cash: 500_000 }), HUMAN, { marketing: 6_000_000 });
    expect(report.plan.marketing).toBe(500_000);
    expect(marketingNotes(report)).toHaveLength(1);
  });

  it("the Incumbent's budget is cut to its cash too", () => {
    const { report } = play(going(INCUMBENT, 5, { cash: 3_000_000 }), INCUMBENT, { marketing: 4_000_000 });
    expect(report.plan.marketing).toBe(3_000_000);
  });

  it("a computer startup's budget is cut to its cash too", () => {
    const { report } = play(going(BLITZ, 5, { cash: 200_000 }), BLITZ, { marketing: 300_000 });
    expect(report.plan.marketing).toBe(200_000);
  });

  it("the race has no such limit", () => {
    const state = launchedCompany(onlyActive(atTurn(newGame(), 5), [HUMAN]), HUMAN, { users: 1_000, cash: 500_000 });
    const report = reportFor(resolve(state, { [HUMAN]: all(state, HUMAN, { marketing: 1_000_000 }) }), HUMAN);
    expect(report.plan.marketing).toBe(1_000_000);
  });

  it("the room ignores the year's other costs: spending all the cash on marketing can still end below $0", () => {
    const { report, company } = play(going(HUMAN, 5, { cash: 500_000 }), HUMAN, { marketing: 500_000 });
    // 500,000 + 90,846 − 120,000 − 500,000 = −29,154: rescued, cash reset to 3 × 40,000.
    expect(report.plan.marketing).toBe(500_000);
    expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore: -29_154, equityBefore: 1 });
    expect(company.cash).toBe(120_000);
  });
});

// ── C7: one rescue ──

describe("C7: one rescue", () => {
  it("a company's first fall below $0 is a rescue, not the end", () => {
    const { report, company, result } = play(broke(), HUMAN);
    expect(report.out).toBeNull();
    expect(company.out).toBeNull();
    expect(company.users).toBe(30_282);
    expect(careerOf(result.state, HUMAN).rescue).toEqual({ turn: 5, reason: "bankrupt" });
  });

  it("the rescue's report gives what it was from, the cash below $0 and the equity before", () => {
    expect(play(broke(), HUMAN).report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore: -19_154, equityBefore: 1 });
  });

  it("the founder keeps half their equity", () => {
    expect(play(broke({ founderEquity: 0.7, investorSeats: 1 }), HUMAN).company.founderEquity).toBeCloseTo(0.35, 10);
  });

  it("investors with no seats end with one more than the founders: 3", () => {
    expect(play(broke(), HUMAN).company.investorSeats).toBe(3); // max(0 + 2, 2 + 1)
  });

  it("investors with two seats gain two: 4", () => {
    expect(play(broke({ investorSeats: 2 }), HUMAN).company.investorSeats).toBe(4); // max(2 + 2, 3)
  });

  it("investors already in control still gain two seats", () => {
    expect(play(broke({ investorSeats: 3 }), HUMAN).company.investorSeats).toBe(5);
  });

  it("the founders keep their seats", () => {
    expect(play(broke(), HUMAN).company.founderSeats).toBe(2);
  });

  it("hype drops by 10 after the year's hype is worked out", () => {
    const { report } = play(broke(), HUMAN);
    expect(report.career?.hype.rescue).toBe(-10);
    expect(report.hype.end).toBeCloseTo(3, 4); // 10 × 0.8 + 5 − 10
  });

  it("hype never goes below 0, and the report gives the change actually made", () => {
    const { report } = play(broke({ hype: 0 }), HUMAN);
    expect(report.hype.end).toBe(0); // 0 + 5 − 10, held at 0
    expect(report.career?.hype.rescue).toBeCloseTo(-5, 4);
  });

  it("cash below $0 is reset to a year of salaries for the team", () => {
    const { company, report } = play(broke(), HUMAN);
    expect(company.cash).toBe(120_000); // 3 × 40,000
    expect(report.cash.end).toBe(120_000);
  });

  it("the valuation and the runway are worked out again from what the rescue leaves", () => {
    const { report } = play(broke(), HUMAN);
    expect(report.valuation).toBe(4_678_569); // 30,282 × 150 × 1.03
    expect(report.runway).toBeCloseTo(120_000 / 29_154, 2); // burn 120,000 − 90,846
  });

  it("people hired as the year ends are not counted in the reset", () => {
    const state = broke();
    const { report, company } = play(state, HUMAN, { allocation: { product: 2, growth: 0, recruiting: 1 }, hireLimit: null });
    expect(report.headcount.hired).toBeGreaterThan(0);
    expect(report.career?.rescue).not.toBeNull();
    expect(company.cash).toBe(120_000); // the 3 who were there, not the new hires
  });

  it("people laid off in the year are not counted in the reset", () => {
    const state = broke({ cash: 0 });
    const { report, company } = play(state, HUMAN, { layoffs: 1, allocation: { product: 2, growth: 0, recruiting: 0 } });
    // 0 + 90,846 − (2 × 40,000 + 20,000 severance) = −9,154
    expect(report.career?.rescue?.cashBefore).toBe(-9_154);
    expect(company.cash).toBe(80_000); // 2 × 40,000
  });

  it("the reset is at the salary of the year that closes", () => {
    const config = withEras(era("one", 1990, {}), era("two", 1994, { salary: 60_000 }));
    const { report, company } = play(broke({}, 5), HUMAN, {}, config);
    // 1994 is era two's first year, so its curve starts again (ruling 4): 20,000 new users, 21,000 in all.
    // 10,000 + 63,000 − 3 × 60,000 = −107,000; reset to 3 × 60,000
    expect(report.cash.start).toBe(10_000);
    expect(report.career?.rescue?.cashBefore).toBe(-107_000);
    expect(company.cash).toBe(180_000);
  });

  it("the reset in an era's last year is at that year's salary, not the next era's", () => {
    // Added in Task 16, Step 4: 1994 closes era one at $40K a head; era two's $60K starts only in 1995.
    const config = withEras(era("one", 1990, {}), era("two", 1995, { salary: 60_000 }));
    const { report, company } = play(broke({}, 5), HUMAN, {}, config);
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(report.career?.rescue?.cashBefore).toBeLessThan(0);
    expect(company.cash).toBe(120_000); // 1 year × 3 × 40,000
  });

  it("the rescue's terms are read from the config", () => {
    const config = withCareer({ rescue: { equityKept: 0.25, investorSeats: 3, hype: -20, salaryYears: 2 } });
    const { report, company } = play(broke({ founderEquity: 0.8, investorSeats: 1 }, 5), HUMAN, {}, config);
    expect(company.founderEquity).toBeCloseTo(0.2, 10); // 0.8 × 0.25
    expect(company.investorSeats).toBe(4); // max(1 + 3, 3)
    expect(report.hype.end).toBe(0); // 13 − 20, held at 0
    expect(company.cash).toBe(240_000); // 2 years × 3 × 40,000
  });

  it("a board's firing is rescued too: equity halved, seats, hype, and cash not reset", () => {
    // 4 people, $100K: cash 100,000 + 90,846 − 160,000 = 30,846, runway 0.45: a bad year under an investor board.
    const state = going(HUMAN, 5, { cash: 100_000, headcount: 4, headcountAtLastClose: 4, investorSeats: 3 });
    const seed = firstSeed((s) => play(state, HUMAN, {}, CAREER_TEST, s).report.board?.fired === true);
    expect(seed).toBeGreaterThan(0);
    const { report, company, result } = play(state, HUMAN, {}, CAREER_TEST, seed);
    expect(company.out).toBeNull();
    expect(report.out).toBeNull();
    expect(report.career?.rescue).toEqual({ reason: "fired", cashBefore: 30_846, equityBefore: 1 });
    expect(careerOf(result.state, HUMAN).rescue).toEqual({ turn: 5, reason: "fired" });
    expect(company.founderEquity).toBeCloseTo(0.5, 10);
    expect(company.investorSeats).toBe(5); // max(3 + 2, 3)
    expect(report.hype.end).toBeCloseTo(3, 4);
    expect(company.cash).toBe(30_846);
  });

  it("bankruptcy is checked first: a company rescued from it is never voted on that year", () => {
    const state = going(HUMAN, 5, { cash: 10_000, headcount: 4, headcountAtLastClose: 4, investorSeats: 3 });
    for (let seed = 1; seed <= 20; seed++) {
      const { report, company } = play(state, HUMAN, {}, CAREER_TEST, seed);
      expect(report.career?.rescue?.reason).toBe("bankrupt");
      expect(report.board?.fired ?? false).toBe(false);
      expect(company.out).toBeNull();
      expect(company.cash).toBe(160_000);
    }
  });

  it("in the year after a rescue the board does not vote, though its report says what it saw", () => {
    // Turn 6: 100,000 + 99,630 − 160,000 = 39,630, runway 0.66: a bad year.
    const state = withCareerOf(going(HUMAN, 6, { cash: 100_000, headcount: 4, headcountAtLastClose: 4, investorSeats: 5, founderEquity: 0.5 }), HUMAN, {
      rescue: { turn: 5, reason: "bankrupt" },
    });
    for (let seed = 1; seed <= 40; seed++) {
      const { report, company } = play(state, HUMAN, {}, CAREER_TEST, seed);
      expect(report.board).not.toBeNull();
      expect(report.board?.lowRunway).toBe(true);
      expect(report.board?.fired).toBe(false);
      expect(company.out).toBeNull();
    }
  });

  it("in the year after a rescue bankruptcy still applies, and is final", () => {
    const state = withCareerOf(going(HUMAN, 6, { cash: 10_000, investorSeats: 3, founderEquity: 0.5 }), HUMAN, { rescue: { turn: 5, reason: "bankrupt" } });
    const { report, company } = play(state, HUMAN);
    expect(report.out).toBe("bankrupt");
    expect(company.out?.reason).toBe("bankrupt");
    expect(report.career?.rescue ?? null).toBeNull();
  });

  it("two years after a rescue the board votes again, and its firing is final", () => {
    // Turn 7: 100,000 + 109,293 − 160,000 = 49,293, runway 0.97: a bad year.
    const state = withCareerOf(going(HUMAN, 7, { cash: 100_000, headcount: 4, headcountAtLastClose: 4, investorSeats: 5, founderEquity: 0.5 }), HUMAN, {
      rescue: { turn: 5, reason: "bankrupt" },
    });
    const seed = firstSeed((s) => play(state, HUMAN, {}, CAREER_TEST, s).report.board?.fired === true);
    expect(seed).toBeGreaterThan(0);
    const { report, company } = play(state, HUMAN, {}, CAREER_TEST, seed);
    expect(report.out).toBe("fired");
    expect(company.out?.reason).toBe("fired");
  });

  it("a second failure years later is final, and releases the company's users and staff", () => {
    // Turn 10: 4 people, $0: 0 + 48,159 × 3 − 160,000 = −15,523.
    const state = withCareerOf(going(HUMAN, 10, { cash: 0, headcount: 4, headcountAtLastClose: 4, investorSeats: 3, founderEquity: 0.5 }), HUMAN, {
      rescue: { turn: 2, reason: "fired" },
    });
    const { report, company, result } = play(state, HUMAN);
    expect(report.out).toBe("bankrupt");
    expect(company.out).toEqual({ turn: 10, reason: "bankrupt", users: 48_159, headcount: 4 });
    expect(company.users).toBe(0);
    expect(result.state.carryOverUsers).toBe(48_159);
    expect(result.state.freedPeople).toBe(4);
    expect(company.founderEquity).toBeCloseTo(0.5, 10);
  });

  it("the Incumbent has one rescue too", () => {
    // 8 people: 10,000 + 90,846 − 320,000 = −219,154. Hype 20 × 0.8 + 5 − 10 = 11.
    const state = going(INCUMBENT, 5, { cash: 10_000 });
    const { report, company } = play(state, INCUMBENT);
    expect(company.out).toBeNull();
    expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore: -219_154, equityBefore: 0.6 });
    expect(company.founderEquity).toBeCloseTo(0.3, 10);
    expect(company.investorSeats).toBe(3); // max(1 + 2, 2 + 1)
    expect(report.hype.end).toBeCloseTo(11, 4);
    expect(company.cash).toBe(320_000);
  });

  it("a computer startup has one rescue too", () => {
    const { report, company } = play(going(BLITZ, 5, { cash: 10_000 }), BLITZ);
    expect(company.out).toBeNull();
    expect(report.career?.rescue?.reason).toBe("bankrupt");
    expect(company.cash).toBe(120_000);
  });

  it("a company that lists and is rescued in the same year keeps its listing, and both changes apply", () => {
    // 30 people. Listing 8,250,000; marketing 8,750,000 (all the room); revenue 837,846; salaries 1,200,000.
    // Cash 500,000 + 8,250,000 + 837,846 − 9,950,000 = −362,154.
    const config = withMaxMarketing(20_000_000);
    // Already on the full floor (40 people), so no moving bill (C9) enters the year's costs.
    const state = withCareerOf(qualified(HUMAN, 5, { headcount: 30, headcountAtLastClose: 30 }, config), HUMAN, { office: 3 });
    const { report, company, result } = play(state, HUMAN, { goPublic: true, marketing: 8_750_000 }, config);
    expect(listingOfReport(report)).toEqual({ valuation: OPENING, amount: LISTING });
    expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore: -362_154, equityBefore: 0.8 });
    const career = careerOf(result.state, HUMAN);
    expect(career.listed?.turn).toBe(5);
    expect(career.rescue?.turn).toBe(5);
    expect(company.founderEquity).toBeCloseTo(0.4, 10); // 1 × 0.8 × 0.5
    expect(company.investorSeats).toBe(3); // 0 + 1, then max(1 + 2, 2 + 1)
    expect(report.hype.end).toBeCloseTo(18, 4); // 8 + 20 − 10
    expect(company.cash).toBe(1_200_000); // 30 × 40,000
    // 279,282 × 150 × 1.18 × 1.25 = 61,791,142.5, rounded either way
    expect(Math.abs(report.valuation - 61_791_142.5)).toBeLessThanOrEqual(0.5);
  });

  it("the race has no rescue: a company below $0 is out", () => {
    const state = launchedCompany(onlyActive(atTurn(newGame(), 5), [HUMAN]), HUMAN, { users: 1_000, cash: 10_000 });
    const report = reportFor(resolve(state, { [HUMAN]: all(state, HUMAN) }), HUMAN);
    expect(report.out).toBe("bankrupt");
    expect(report.career).toBeUndefined();
  });

  it("a company that ends the year at exactly $0 is not rescued", () => {
    // 29,154 + 90,846 − 120,000 = 0
    const { report, company, result } = play(broke({ cash: 29_154 }), HUMAN);
    expect(report.cash.end).toBe(0);
    expect(report.career?.rescue ?? null).toBeNull();
    expect(careerOf(result.state, HUMAN).rescue).toBeNull();
    expect(company.founderEquity).toBe(1);
  });

  it("a company $1 below $0 is rescued", () => {
    const { report } = play(broke({ cash: 29_153 }), HUMAN);
    expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore: -1, equityBefore: 1 });
  });
});
