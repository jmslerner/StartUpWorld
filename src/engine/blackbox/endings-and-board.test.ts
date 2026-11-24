// Black-box tests for the endings and the board.
//
// Written from docs/turn-based-design.md alone (the "Game design" section, "Order of a turn" and
// rulings 1, 7, 8, 9, 13, 14, 15, 19, 20), without reading the engine or its tests. Every expected
// number is worked out by hand in the comment above its assertion.
//
// The numbers are the design's starting values (src/config.design.ts, today identical to
// src/config.ts): salary $40,000 a head, Standard price $3 (Premium $5), hire fee $10,000,
// IPO at 250,000 users, valuation $150 a user, board 30% on a bad quarter, runway limit 2 turns,
// 20 turns, 20,000 new users in turn 1 growing 10% a turn, hype decays 20% a turn.

import { describe, expect, it } from "vitest";
import { DESIGN } from "../../config.design";
import { resolveTurn } from "../index";
import { firstFloat, STREAM } from "../rng";
import {
  BLITZ,
  BOOT,
  HUMAN,
  INCUMBENT,
  launchedCompany,
  newGame,
  onlyActive,
  plansOf,
  reportFor,
  resolve,
  seedWhere,
  usersInSystem,
  withCompany,
  withState,
} from "../testKit";
import type { Company, CompanyId, CompanyReport, GameState, Outcome, Plan, RulesConfig, TurnLog } from "../types";

// ── Lab conditions ──

const ALL: readonly CompanyId[] = [HUMAN, BLITZ, BOOT, INCUMBENT];

/** No random events. Needed from turn 2 on: the event for turn 3 is drawn when turn 2 is resolved. */
const NO_EVENTS: RulesConfig = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };

/**
 * No events and nobody new arriving. A lone launched company then wins back exactly the users it
 * churned (it is the only one with pull, so the whole pool is its own churn): its users stand still.
 */
const NO_NEW_USERS: RulesConfig = { ...NO_EVENTS, market: { newUsersTurn1: 0, growthPerTurn: 0 } };

/** As NO_NEW_USERS with no churn either: every company's users stand still whatever the pulls are. */
const FROZEN: RulesConfig = {
  ...NO_NEW_USERS,
  churn: { base: 0, perQualityPoint: 0, min: 0 },
  priceTiers: {
    budget: { ...DESIGN.priceTiers.budget, churnDelta: 0 },
    standard: { ...DESIGN.priceTiers.standard, churnDelta: 0 },
    premium: { ...DESIGN.priceTiers.premium, churnDelta: 0 },
  },
};

type Patches = Readonly<Record<number, Partial<Plan>>>;

/** A complete plan: everyone on Product, Standard price, no marketing, nothing optional, no hiring. */
const plan = (headcount = 3, patch: Partial<Plan> = {}): Plan => ({
  allocation: { product: headcount, growth: 0, recruiting: 0 },
  marketing: 0,
  price: "standard",
  raisePercent: 0,
  poachTarget: null,
  layoffs: 0,
  hireLimit: 0,
  ...patch,
});

/**
 * Everyone on Growth. An unlaunched company then stays unlaunched (quality stays 0), has no users
 * and no revenue, and its only cost is salaries: $40,000 × headcount.
 */
const idle = (headcount = 3, patch: Partial<Plan> = {}): Plan =>
  plan(headcount, { allocation: { product: 0, growth: headcount, recruiting: 0 }, ...patch });

/** The three startups only: the Incumbent is taken out as if it had gone bankrupt earlier. Nobody is launched. */
const startupsOnly = (): GameState => onlyActive(newGame(), [HUMAN, BLITZ, BOOT]);
const IDLE_RIVALS: Patches = { [BLITZ]: idle(), [BOOT]: idle() };

/** Investor seats outnumber founder seats (a startup after its third raise). */
const INVESTOR_BOARD = { founderSeats: 2, investorSeats: 3 } as const;

/** The board's roll for one company in one turn (ruling 20: keyed by seed, turn, purpose, company). */
const boardRoll = (seed: number, turn: number, id: CompanyId): number => firstFloat(seed, turn, STREAM.board, id);
/** A seed whose board roll fires the founder (roll < 0.3) ... */
const firingSeed = (turn: number, id: CompanyId): number => seedWhere((seed) => boardRoll(seed, turn, id) < 0.3);
/** ... and one whose roll spares them. */
const sparingSeed = (turn: number, id: CompanyId): number => seedWhere((seed) => boardRoll(seed, turn, id) >= 0.3);

const atTurn = (state: GameState, turn: number): GameState => withState(state, { turn });

const survivors = (state: GameState): CompanyId[] => state.companies.filter((c) => c.out === null).map((c) => c.id);

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("starting seats", () => {
  it("startups hold 2 founder seats and no investor seat; the Incumbent 2 founder seats and 1 investor seat", () => {
    const state = newGame();
    for (const id of [HUMAN, BLITZ, BOOT]) {
      expect(state.companies[id].founderSeats).toBe(2);
      expect(state.companies[id].investorSeats).toBe(0);
    }
    expect(state.companies[INCUMBENT].founderSeats).toBe(2);
    expect(state.companies[INCUMBENT].investorSeats).toBe(1);
    expect(survivors(state)).toEqual([HUMAN, BLITZ, BOOT, INCUMBENT]);
    expect(state.outcome).toBeNull();
    expect(state.turn).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("bankruptcy: a company that ends a turn below $0 is out", () => {
  // Design: "A company that ends a turn below $0 is bankrupt and out."  Ruling 14: "cash strictly below $0".
  // The subject is an unlaunched startup with everyone on Growth: no revenue, costs 3 × $40,000 = $120,000.
  it.each([
    { cash: 120_000, end: 0, out: null }, //     120,000 − 120,000 =  0: exactly $0 is not below $0
    { cash: 119_999, end: -1, out: "bankrupt" }, // 119,999 − 120,000 = −1
    { cash: 120_001, end: 1, out: null }, //     120,001 − 120,000 = +1
  ] as const)("opening cash $cash, costs 120000 → closing cash $end, out: $out", ({ cash, end, out }) => {
    const start = withCompany(newGame(), HUMAN, { cash });
    const result = resolve(start, { [HUMAN]: idle() });
    const report = reportFor(result, HUMAN);
    const company = result.state.companies[HUMAN];

    expect(report.revenue).toBe(0);
    // 3 × $40,000
    expect(report.costs.total).toBe(120_000);
    expect(report.cash.start).toBe(cash);
    expect(report.cash.end).toBe(end);
    expect(report.out).toBe(out);
    if (out === null) {
      expect(company.out).toBeNull();
      expect(company.cash).toBe(end);
      expect(company.headcount).toBe(3);
    } else {
      // "What the company had when it went out": no users, 3 people. Afterwards it holds nothing.
      expect(company.out).toEqual({ turn: 1, reason: "bankrupt", users: 0, headcount: 3 });
      expect(company.users).toBe(0);
      expect(company.headcount).toBe(0);
    }
    // Three rivals are still in: the game goes on either way (ruling 19: the engine has no special player).
    expect(result.state.outcome).toBeNull();
    expect(result.log.outcome).toBeNull();
    expect(result.state.turn).toBe(2);
  });

  it("the quarter's revenue arrives before the test: $0 in the bank and a profitable quarter is not bankrupt", () => {
    // The only launched company, no new users: its users stand still at 50,000.
    // Revenue 50,000 × $3 = $150,000; costs 3 × $40,000 = $120,000; cash 0 + 150,000 − 120,000 = $30,000.
    const start = launchedCompany(startupsOnly(), HUMAN, { users: 50_000, cash: 0 });
    const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
    const report = reportFor(result, HUMAN);
    expect(report.users.end).toBe(50_000);
    expect(report.revenue).toBe(150_000);
    expect(report.costs.total).toBe(120_000);
    expect(report.cash.end).toBe(30_000);
    expect(report.out).toBeNull();
    expect(result.state.companies[HUMAN].out).toBeNull();
  });

  it.each([
    { cash: 30_000, end: 0, out: null }, //        30,000 + 90,000 − 120,000 =  0
    { cash: 29_999, end: -1, out: "bankrupt" }, // 29,999 + 90,000 − 120,000 = −1
  ] as const)("revenue short of costs: opening cash $cash → closing cash $end, out: $out", ({ cash, end, out }) => {
    // The only launched company, no new users: users stand still at 30,000.
    // Revenue 30,000 × $3 = $90,000; costs $120,000.
    const start = launchedCompany(startupsOnly(), HUMAN, { users: 30_000, cash });
    const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
    const report = reportFor(result, HUMAN);
    expect(report.revenue).toBe(90_000);
    expect(report.cash.end).toBe(end);
    expect(report.out).toBe(out);
    // What it had when it went out: its 30,000 users and 3 people.
    expect(result.state.companies[HUMAN].out).toEqual(
      out === null ? null : { turn: 1, reason: "bankrupt", users: 30_000, headcount: 3 },
    );
  });

  it("a raise's cash arrives the same turn and can keep a company above $0", () => {
    // Ruling 7: "Cash arrives the same turn", priced on start-of-turn users, hype and climate.
    // 2,000 users, hype 0, normal climate: valuation 2,000 × $150 × (1 + 0/100) × 1 = $300,000; 10% = $30,000.
    // Users stand still at 2,000: revenue 2,000 × $3 = $6,000; costs 3 × $40,000 = $120,000 (the fundraiser is on payroll).
    const start = launchedCompany(startupsOnly(), HUMAN, { users: 2_000, hype: 0, cash: 100_000 });

    // No raise: 100,000 + 6,000 − 120,000 = −$14,000 → bankrupt.
    const without = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
    expect(reportFor(without, HUMAN).cash.end).toBe(-14_000);
    expect(reportFor(without, HUMAN).out).toBe("bankrupt");

    // Raise 10%: 100,000 + 30,000 + 6,000 − 120,000 = $16,000 → still in.
    const raising = plan(3, { raisePercent: 10, allocation: { product: 2, growth: 0, recruiting: 0 } });
    const withRaise = resolve(start, { [HUMAN]: raising, ...IDLE_RIVALS }, 1, NO_NEW_USERS);
    const report = reportFor(withRaise, HUMAN);
    expect(report.raise).toEqual({ percent: 10, valuation: 300_000, amount: 30_000 });
    expect(report.cash.end).toBe(16_000);
    expect(report.out).toBeNull();
    expect(withRaise.state.companies[HUMAN].out).toBeNull();
  });

  it("bankruptcy comes before the board vote: a bankrupt company is not also fired", () => {
    // Order of a turn, step 12: "Bankruptcy, then the board vote."
    // $100,000 − $120,000 = −$20,000 → bankrupt. Investors hold the board, the quarter is bad
    // (runway is gone) and the board's roll is under 0.3: without the bankruptcy the founder would be fired.
    const seed = firingSeed(1, HUMAN);
    const start = withCompany(newGame(), HUMAN, { cash: 100_000, ...INVESTOR_BOARD });
    const result = resolve(start, { [HUMAN]: idle() }, seed);
    expect(reportFor(result, HUMAN).cash.end).toBe(-20_000);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.state.companies[HUMAN].out).toEqual({ turn: 1, reason: "bankrupt", users: 0, headcount: 3 });
  });

  it("the report of a bankrupt company does not also say its founder was fired", () => {
    // Same quarter as above. The board never gets to vote on a company that is already out.
    const seed = firingSeed(1, HUMAN);
    const start = withCompany(newGame(), HUMAN, { cash: 100_000, ...INVESTOR_BOARD });
    const report = reportFor(resolve(start, { [HUMAN]: idle() }, seed), HUMAN);
    expect(report.board?.fired ?? false).toBe(false);
  });

  it("a company that is out takes no further part: no report, and nothing changes about it", () => {
    // Turn 1: BLITZ opens with $100,000 and pays $120,000 → −$20,000 → bankrupt.
    const start = withCompany(newGame(), BLITZ, { cash: 100_000 });
    const first = resolve(start, { [BLITZ]: idle() }, 1, NO_EVENTS);
    expect(first.state.companies[BLITZ].out).toEqual({ turn: 1, reason: "bankrupt", users: 0, headcount: 3 });
    expect(first.log.companies[BLITZ]).not.toBeNull();

    // Turn 2: its plan is ignored and it has no report ("null for a company that was already out").
    const second = resolve(first.state, { [BLITZ]: plan(3, { marketing: 100_000, raisePercent: 30 }) }, 1, NO_EVENTS);
    expect(second.log.companies[BLITZ]).toBeNull();
    expect(second.state.companies[BLITZ]).toEqual(first.state.companies[BLITZ]);
    expect(second.state.outcome).toBeNull();
  });

  it("a poach aimed at a company that is out is dropped at no cost", () => {
    // Ruling 10: a target must have at least 2 people; "an attempt on a smaller team is dropped at no cost".
    // A company that is out has no people: its staff became candidates (ruling 15).
    const start = withCompany(newGame(), BLITZ, { cash: 100_000 });
    const first = resolve(start, { [BLITZ]: idle(), [HUMAN]: idle() }, 1, NO_EVENTS);
    expect(first.state.companies[BLITZ].out?.reason).toBe("bankrupt");

    const second = resolve(first.state, { [HUMAN]: idle(3, { poachTarget: BLITZ }) }, 1, NO_EVENTS);
    const report = reportFor(second, HUMAN);
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    // Two idle quarters: 500,000 − 120,000 − 120,000 = $260,000 (no $50,000 poach charge).
    expect(report.cash.end).toBe(260_000);
    expect(second.state.companies[HUMAN].headcount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("going out: users join the next pool, staff the next candidates", () => {
  // Owner decision: "A fired founder's company shuts down like a bankrupt one: its users return to the pool
  // next turn and its staff become candidates."  Ruling 15: "A bankrupt or fired company's users join next
  // turn's pool, and its staff (including people it hired or poached that turn) join next turn's candidates."
  //
  // FROZEN market (no new users, no churn): the only users that move are the ones the dead company releases.
  const twoLaunched = (blitz: Partial<Company>): GameState => {
    let state = startupsOnly();
    state = launchedCompany(state, HUMAN, { users: 10_000, headcount: 6, cash: 2_000_000 });
    state = launchedCompany(state, BLITZ, { users: 7_000, ...blitz });
    return state;
  };

  const checkRelease = (first: ReturnType<typeof resolve>, reason: "bankrupt" | "fired", seed: number): void => {
    const blitz = first.state.companies[BLITZ];
    expect(reportFor(first, BLITZ).out).toBe(reason);
    // It had 7,000 users (frozen market) and 3 people when it went out; now it holds nothing.
    expect(blitz.out).toEqual({ turn: 1, reason, users: 7_000, headcount: 3 });
    expect(blitz.users).toBe(0);
    expect(blitz.headcount).toBe(0);
    // The users did not join this turn's pool (0 new + 0 churned + 0 carried in) ...
    expect(first.log.market.pool).toBe(0);
    expect(reportFor(first, HUMAN).users.end).toBe(10_000);
    // ... they wait for the next one, and the 3 people wait to be candidates.
    expect(first.state.carryOverUsers).toBe(7_000);
    expect(first.state.freedPeople).toBe(3);
    // Users are conserved (ruling 1): 10,000 + 7,000.
    expect(usersInSystem(first.state)).toBe(17_000);
    // HUMAN and BOOT are both still in.
    expect(first.state.outcome).toBeNull();
    expect(first.state.turn).toBe(2);

    // Turn 2. HUMAN puts all 6 people on Recruiting with no hire limit.
    const recruiting = plan(6, { allocation: { product: 0, growth: 0, recruiting: 6 }, hireLimit: null });
    const second = resolve(first.state, { [HUMAN]: recruiting, [BOOT]: idle() }, seed, FROZEN);
    expect(second.log.companies[BLITZ]).toBeNull();
    // Pool = 0 new + 0 churned + 7,000 released; HUMAN is the only launched company and takes all of it.
    expect(second.log.market.carriedIn).toBe(7_000);
    expect(second.log.market.pool).toBe(7_000);
    expect(reportFor(second, HUMAN).users.won).toBe(7_000);
    // 10,000 + 7,000
    expect(reportFor(second, HUMAN).users.end).toBe(17_000);
    // Candidates = 6 + the 3 people freed last turn (ruling 9).
    expect(second.log.hiring.candidates).toBe(9);
    // HUMAN's capacity = round(2 × 6^0.9) = round(2 × 5.016) = round(10.03) = 10 ≥ 9, and nobody else hires:
    // it takes all 9, so the freed people really are hireable. Fee 9 × $10,000 = $90,000.
    expect(reportFor(second, HUMAN).hiring).toEqual({ capacity: 10, wanted: 10, hired: 9 });
    expect(reportFor(second, HUMAN).costs.hiring).toBe(90_000);
    // Hires start next turn: 6 + 9.
    expect(second.state.companies[HUMAN].headcount).toBe(15);
    // Nothing is left over: the users were handed out and unhired candidates leave.
    expect(second.state.carryOverUsers).toBe(0);
    expect(second.state.freedPeople).toBe(0);
    expect(usersInSystem(second.state)).toBe(17_000);
    expect(second.state.companies[BLITZ]).toEqual(blitz);
  };

  it("a bankrupt company's users are split next turn and its staff can be hired next turn", () => {
    // BLITZ: revenue 7,000 × $3 = $21,000; costs $120,000; cash 50,000 + 21,000 − 120,000 = −$49,000 → bankrupt.
    const start = twoLaunched({ cash: 50_000 });
    const first = resolve(start, { [HUMAN]: plan(6), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    expect(reportFor(first, BLITZ).cash.end).toBe(-49_000);
    checkRelease(first, "bankrupt", 1);
  });

  it("a fired founder's company shuts down the same way", () => {
    // BLITZ: investors hold the board; it closed last quarter on 7,001 users and ends this one on 7,000: users fell.
    // Cash 500,000 + 21,000 − 120,000 = $401,000 (burn $99,000, runway 4.05 turns): not bankrupt.
    // The board's roll is under 0.3 → fired.
    const seed = firingSeed(1, BLITZ);
    const start = twoLaunched({ usersAtLastClose: 7_001, ...INVESTOR_BOARD });
    const first = resolve(start, { [HUMAN]: plan(6), [BLITZ]: plan(), [BOOT]: idle() }, seed, FROZEN);
    expect(reportFor(first, BLITZ).cash.end).toBe(401_000);
    expect(reportFor(first, BLITZ).board).toEqual({ usersFell: true, lowRunway: false, fired: true });
    checkRelease(first, "fired", seed);
  });

  it("people it hired in its last turn are freed too", () => {
    // BLITZ (unlaunched) puts all 3 on Recruiting and hires at most 2.
    // Capacity = round(2 × 3^0.9) = round(2 × 2.688) = round(5.38) = 5; wanted = min(5, 2) = 2; 6 candidates → 2 hired.
    // Costs = 3 × $40,000 + 2 × $10,000 = $140,000; cash 100,000 − 140,000 = −$40,000 → bankrupt.
    const start = withCompany(startupsOnly(), BLITZ, { cash: 100_000 });
    const recruiting = plan(3, { allocation: { product: 0, growth: 0, recruiting: 3 }, hireLimit: 2 });
    const first = resolve(start, { [HUMAN]: idle(), [BLITZ]: recruiting, [BOOT]: idle() });
    const report = reportFor(first, BLITZ);
    expect(first.log.hiring.candidates).toBe(6);
    expect(report.hiring).toEqual({ capacity: 5, wanted: 2, hired: 2 });
    expect(report.costs.total).toBe(140_000);
    expect(report.cash.end).toBe(-40_000);
    expect(report.out).toBe("bankrupt");
    // Its staff: the 3 it had plus the 2 it just hired.
    expect(first.state.freedPeople).toBe(5);

    // Next turn's candidates = 6 + 5.
    const second = resolve(first.state, { [HUMAN]: idle(), [BOOT]: idle() });
    expect(second.log.hiring.candidates).toBe(11);
    expect(second.state.freedPeople).toBe(0);
  });

  it("people it laid off in its last turn were already candidates that turn and are not freed twice", () => {
    // BLITZ lays off 1 of 3. Ruling 9: "everyone laid off this turn" joins this turn's candidates: 6 + 1 = 7.
    // Costs = 2 × $40,000 salaries + $20,000 severance = $100,000; cash 50,000 − 100,000 = −$50,000 → bankrupt.
    // Its staff when it goes out: the 2 who were left.
    const start = withCompany(startupsOnly(), BLITZ, { cash: 50_000 });
    const first = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(2, { layoffs: 1 }), [BOOT]: idle() });
    const report = reportFor(first, BLITZ);
    expect(report.headcount.laidOff).toBe(1);
    expect(first.log.hiring.candidates).toBe(7);
    expect(report.costs.total).toBe(100_000);
    expect(report.cash.end).toBe(-50_000);
    expect(report.out).toBe("bankrupt");
    expect(first.state.freedPeople).toBe(2);
    // Next turn's candidates = 6 + 2.
    const second = resolve(first.state, { [HUMAN]: idle(), [BOOT]: idle() });
    expect(second.log.hiring.candidates).toBe(8);
  });

  it("someone it poached in its last turn is freed with the rest; the rival still loses that person", () => {
    // BLITZ poaches from HUMAN and goes bankrupt in the same turn.
    // Costs = 3 × $40,000 + $50,000 for the attempt = $170,000; cash 150,000 − 170,000 = −$20,000 → bankrupt
    // whether or not the poach works.
    const start = withCompany(startupsOnly(), BLITZ, { cash: 150_000 });
    const patches: Patches = { [HUMAN]: idle(), [BLITZ]: idle(3, { poachTarget: HUMAN }), [BOOT]: idle() };
    const poachWorked = (seed: number): boolean => reportFor(resolve(start, patches, seed), BLITZ).poach?.success === true;

    const hit = resolve(start, patches, seedWhere(poachWorked));
    expect(reportFor(hit, BLITZ).costs.total).toBe(170_000);
    expect(reportFor(hit, BLITZ).out).toBe("bankrupt");
    // 3 + the person poached = 4 freed; HUMAN is down to 2.
    expect(hit.state.freedPeople).toBe(4);
    expect(hit.state.companies[HUMAN].headcount).toBe(2);

    const miss = resolve(start, patches, seedWhere((seed) => !poachWorked(seed)));
    expect(reportFor(miss, BLITZ).poach?.success).toBe(false);
    expect(reportFor(miss, BLITZ).out).toBe("bankrupt");
    expect(miss.state.freedPeople).toBe(3);
    expect(miss.state.companies[HUMAN].headcount).toBe(3);
  });

  it("a person poached away from it in its last turn joins the poacher, not the candidates", () => {
    // HUMAN poaches from BLITZ; BLITZ (cash 100,000 − 120,000 = −$20,000) goes bankrupt that turn.
    const start = withCompany(startupsOnly(), BLITZ, { cash: 100_000 });
    const patches: Patches = { [HUMAN]: idle(3, { poachTarget: BLITZ }), [BLITZ]: idle(), [BOOT]: idle() };
    const poachWorked = (seed: number): boolean => reportFor(resolve(start, patches, seed), HUMAN).poach?.success === true;

    const hit = resolve(start, patches, seedWhere(poachWorked));
    expect(reportFor(hit, BLITZ).out).toBe("bankrupt");
    // The poached person changes company; the other 2 are freed. 4 + 2 = the 6 people there were.
    expect(hit.state.companies[HUMAN].headcount).toBe(4);
    expect(hit.state.freedPeople).toBe(2);

    const miss = resolve(start, patches, seedWhere((seed) => !poachWorked(seed)));
    expect(miss.state.companies[HUMAN].headcount).toBe(3);
    expect(miss.state.freedPeople).toBe(3);
  });

  it("with the real market, users are conserved through an exit and next turn's pool includes them", () => {
    // Full four-company game, design numbers. BLITZ is launched with 7,000 users and no cash:
    // whatever it wins this turn, revenue (a few thousand users × $3) is far below its $120,000 costs → bankrupt.
    const start = launchedCompany(newGame(), BLITZ, { users: 7_000, cash: 0 });
    // Before: the Incumbent's 10,000 + BLITZ's 7,000.
    expect(usersInSystem(start)).toBe(17_000);

    const first = resolve(start, { [BLITZ]: plan() }, 1, NO_EVENTS);
    const exit = first.state.companies[BLITZ].out;
    expect(exit?.reason).toBe("bankrupt");
    expect(exit?.users).toBe(reportFor(first, BLITZ).users.end);
    // Turn 1 brings 20,000 new users: 17,000 + 20,000.
    expect(first.log.market.newUsers).toBe(20_000);
    expect(usersInSystem(first.state)).toBe(37_000);
    // The pool was handed out in full, so the only users waiting are the ones BLITZ released.
    expect(first.state.carryOverUsers).toBe(exit?.users);

    const second = resolve(first.state, {}, 1, NO_EVENTS);
    // Turn 2 brings 20,000 × 1.1 = 22,000: 37,000 + 22,000.
    expect(second.log.market.newUsers).toBe(22_000);
    expect(second.log.market.carriedIn).toBe(exit?.users);
    // pool = new users + everyone's churned users + users of bankrupt companies
    expect(second.log.market.pool).toBe(22_000 + second.log.market.churned + (exit?.users ?? 0));
    expect(second.state.carryOverUsers).toBe(0);
    expect(usersInSystem(second.state)).toBe(59_000);
  });

  it("released users wait in the pool while nobody is launched, and go to the first company that launches", () => {
    // Ruling 1: "If no launched company has any pull, the pool waits for the next turn."
    // BLITZ is the only launched company (7,000 users, $0): 0 + 21,000 − 120,000 = −$99,000 → bankrupt on turn 1.
    const start = launchedCompany(startupsOnly(), BLITZ, { users: 7_000, cash: 0 });
    const first = resolve(start, { [HUMAN]: idle(), [BLITZ]: plan(), [BOOT]: idle() }, 1, NO_NEW_USERS);
    expect(reportFor(first, BLITZ).cash.end).toBe(-99_000);
    expect(first.state.carryOverUsers).toBe(7_000);

    // Turn 2: nobody is launched, so the 7,000 keep waiting.
    const second = resolve(first.state, { [HUMAN]: idle(), [BOOT]: idle() }, 1, NO_NEW_USERS);
    expect(second.state.carryOverUsers).toBe(7_000);
    expect(usersInSystem(second.state)).toBe(7_000);

    // Turn 3: HUMAN moves its 3 people to Product. Quality 0 + 5 × 3^0.9 × (1 − 0) − 2 = 13.44 − 2 = 11.44 ≥ 10:
    // it launches, competes in this turn's market as the only launched company, and takes all 7,000.
    const third = resolve(second.state, { [HUMAN]: plan(), [BOOT]: idle() }, 1, NO_NEW_USERS);
    expect(reportFor(third, HUMAN).quality.launchedNow).toBe(true);
    expect(reportFor(third, HUMAN).users.end).toBe(7_000);
    expect(third.state.carryOverUsers).toBe(0);
    expect(usersInSystem(third.state)).toBe(7_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("the board", () => {
  // Design: "once investor seats outnumber founder seats, a bad quarter (users fell, or runway under 2 turns)
  // carries a 30% chance the founder is fired and out."

  describe("who can be fired", () => {
    // The subject's quarter is always bad: unlaunched, opens with $200,000, pays $120,000, closes with $80,000.
    // Burn $120,000 → runway 80,000 ÷ 120,000 = 0.67 turns, under 2. The board's roll is under 0.3.
    const badQuarter = (seats: { founderSeats: number; investorSeats: number }) => {
      const seed = firingSeed(1, HUMAN);
      const start = withCompany(newGame(), HUMAN, { cash: 200_000, ...seats });
      return resolve(start, { [HUMAN]: idle() }, seed);
    };

    it.each([
      { founderSeats: 2, investorSeats: 0 }, // a startup's starting seats
      { founderSeats: 2, investorSeats: 1 },
      { founderSeats: 2, investorSeats: 2 }, // level is not "outnumber"
    ])("founders with $founderSeats seats against $investorSeats cannot be fired", (seats) => {
      const result = badQuarter(seats);
      const report = reportFor(result, HUMAN);
      // 80,000 ÷ 120,000
      expect(report.runway).toBeCloseTo(2 / 3, 10);
      expect(report.out).toBeNull();
      expect(result.state.companies[HUMAN].out).toBeNull();
      // "null while founders control the board"
      expect(report.board).toBeNull();
    });

    it.each([
      { founderSeats: 2, investorSeats: 3 }, // one more: investors outnumber founders
      { founderSeats: 2, investorSeats: 4 },
    ])("founders with $founderSeats seats against $investorSeats are fired on a bad quarter when the roll is under 0.3", (seats) => {
      const result = badQuarter(seats);
      const report = reportFor(result, HUMAN);
      expect(report.board).toEqual({ usersFell: false, lowRunway: true, fired: true });
      expect(report.out).toBe("fired");
      // Not bankrupt: it still had $80,000. It had no users and 3 people.
      expect(report.cash.end).toBe(80_000);
      expect(result.state.companies[HUMAN].out).toEqual({ turn: 1, reason: "fired", users: 0, headcount: 3 });
      expect(result.state.companies[HUMAN].headcount).toBe(0);
      // Its 3 people become next turn's candidates.
      expect(result.state.freedPeople).toBe(3);
      // The other three companies play on.
      expect(result.state.outcome).toBeNull();
    });

    it("the same bad quarter with a roll of 0.3 or more leaves the founder in place", () => {
      const seed = sparingSeed(1, HUMAN);
      const start = withCompany(newGame(), HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: idle() }, seed);
      expect(reportFor(result, HUMAN).board).toEqual({ usersFell: false, lowRunway: true, fired: false });
      expect(reportFor(result, HUMAN).out).toBeNull();
      expect(result.state.companies[HUMAN].out).toBeNull();
      expect(result.state.companies[HUMAN].cash).toBe(80_000);
    });

    it("the Incumbent's starting board (2 founder seats, 1 investor seat) cannot fire its founder", () => {
      // The Incumbent opens with $600,000. Costs: 8 × $40,000 = $320,000 (no hires). Its revenue is at most
      // (10,000 + 20,000 + its own churn back) × $3 < $100,000, so it burns over $220,000 and closes under
      // $380,000: runway under 380 ÷ 220 = 1.73 turns. A bad quarter, and the roll is under 0.3.
      const seed = firingSeed(1, INCUMBENT);
      const start = withCompany(newGame(), INCUMBENT, { cash: 600_000 });
      const result = resolve(start, { [INCUMBENT]: { hireLimit: 0 } }, seed);
      const report = reportFor(result, INCUMBENT);
      expect(report.costs.total).toBe(320_000);
      expect(report.runway).not.toBeNull();
      expect(report.runway as number).toBeLessThan(2);
      expect(report.board).toBeNull();
      expect(report.out).toBeNull();
      expect(result.state.companies[INCUMBENT].out).toBeNull();
    });
  });

  describe("bad quarter: runway under 2 turns", () => {
    // Ruling 8: "Runway = cash ÷ (costs − revenue) for the latest quarter"; "a quarter that burns more than a
    // third of its opening cash plus money raised ends with under 2 turns of runway."
    // Unlaunched startup, investors hold the board, burn 3 × $40,000 = $120,000, roll under 0.3 throughout.
    it.each([
      { cash: 360_000, end: 240_000, runway: 2, low: false }, //             240,000 ÷ 120,000 = 2 exactly: not under 2
      { cash: 359_999, end: 239_999, runway: 239_999 / 120_000, low: true }, // 1.99999...
      { cash: 360_001, end: 240_001, runway: 240_001 / 120_000, low: false }, // 2.00001...
      { cash: 120_000, end: 0, runway: 0, low: true }, //                    $0 left: no runway, but not bankrupt
    ])("opening cash $cash → closing cash $end, low runway: $low", ({ cash, end, runway, low }) => {
      const seed = firingSeed(1, HUMAN);
      const start = withCompany(newGame(), HUMAN, { cash, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: idle() }, seed);
      const report = reportFor(result, HUMAN);
      expect(report.cash.end).toBe(end);
      expect(report.profitable).toBe(false);
      expect(report.runway).toBeCloseTo(runway, 9);
      // No users before or after: users did not fall. Only the runway can make this quarter bad.
      expect(report.board).toEqual({ usersFell: false, lowRunway: low, fired: low });
      expect(report.out).toBe(low ? "fired" : null);
      expect(result.state.companies[HUMAN].out?.reason ?? null).toBe(low ? "fired" : null);
    });

    it("a profitable quarter has no runway limit, even with nothing in the bank", () => {
      // "... with no limit when that quarter was profitable."
      // The only launched company, no new users: users stand still at 50,000 (and so did not fall).
      // Revenue 50,000 × $3 = $150,000 ≥ costs $120,000; cash 0 + 150,000 − 120,000 = $30,000.
      const seed = firingSeed(1, HUMAN);
      const start = launchedCompany(startupsOnly(), HUMAN, { users: 50_000, cash: 0, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.profitable).toBe(true);
      expect(report.runway).toBeNull();
      expect(report.cash.end).toBe(30_000);
      expect(report.board).toEqual({ usersFell: false, lowRunway: false, fired: false });
      expect(report.out).toBeNull();
    });

    it("breaking even exactly (revenue = costs) is profitable: no vote, and $0 is not bankrupt", () => {
      // 40,000 users × $3 = $120,000 = 3 × $40,000. Cash stays at $0.
      const seed = firingSeed(1, HUMAN);
      const start = launchedCompany(startupsOnly(), HUMAN, { users: 40_000, cash: 0, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.revenue).toBe(120_000);
      expect(report.costs.total).toBe(120_000);
      expect(report.profitable).toBe(true);
      expect(report.runway).toBeNull();
      expect(report.cash.end).toBe(0);
      expect(report.board).toEqual({ usersFell: false, lowRunway: false, fired: false });
      expect(report.out).toBeNull();
      expect(result.state.companies[HUMAN].out).toBeNull();
    });

    it.each([
      { cash: 9, end: 6, runway: 2, low: false }, // 6 ÷ 3 = 2 exactly
      { cash: 8, end: 5, runway: 5 / 3, low: true }, // 1.67
      { cash: 3, end: 0, runway: 0, low: true }, // $0: no runway, not bankrupt
    ])("a $3 burn: opening cash $cash → runway $runway, low runway: $low", ({ cash, end, runway, low }) => {
      // 39,999 users × $3 = $119,997; costs $120,000; burn $3 a quarter. The size of the burn does not matter,
      // only how many quarters of it the cash covers.
      const seed = firingSeed(1, HUMAN);
      const start = launchedCompany(startupsOnly(), HUMAN, { users: 39_999, cash, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.revenue).toBe(119_997);
      expect(report.cash.end).toBe(end);
      expect(report.runway).toBeCloseTo(runway, 9);
      expect(report.board).toEqual({ usersFell: false, lowRunway: low, fired: low });
      expect(report.out).toBe(low ? "fired" : null);
    });

    it("money raised this turn counts toward the runway, and is not revenue", () => {
      // Ruling 7: cash arrives the same turn; "Raise proceeds are not revenue."
      // 2,000 users, hype 0: valuation $300,000, 10% raised = $30,000. Users stand still:
      // revenue 2,000 × $3 = $6,000; costs $120,000; burn $114,000.
      // Opening $312,000: 312,000 + 30,000 + 6,000 − 120,000 = $228,000 = exactly 2 × $114,000 → runway 2: not low.
      // (Burn 114,000 is exactly a third of opening cash plus money raised: 342,000 ÷ 3.)
      const seed = firingSeed(1, HUMAN);
      const raising = plan(3, { raisePercent: 10, allocation: { product: 2, growth: 0, recruiting: 0 } });
      const run = (cash: number) => {
        const start = launchedCompany(startupsOnly(), HUMAN, { users: 2_000, hype: 0, cash, ...INVESTOR_BOARD });
        return reportFor(resolve(start, { [HUMAN]: raising, ...IDLE_RIVALS }, seed, NO_NEW_USERS), HUMAN);
      };
      const atLimit = run(312_000);
      expect(atLimit.raise?.amount).toBe(30_000);
      expect(atLimit.revenue).toBe(6_000);
      expect(atLimit.cash.end).toBe(228_000);
      expect(atLimit.profitable).toBe(false);
      expect(atLimit.runway).toBe(2);
      expect(atLimit.board).toEqual({ usersFell: false, lowRunway: false, fired: false });
      expect(atLimit.out).toBeNull();

      // One dollar less: 227,999 ÷ 114,000 = 1.99999 → low → fired (roll under 0.3).
      const below = run(311_999);
      expect(below.cash.end).toBe(227_999);
      expect(below.runway).toBeCloseTo(227_999 / 114_000, 9);
      expect(below.board).toEqual({ usersFell: false, lowRunway: true, fired: true });
      expect(below.out).toBe("fired");
    });
  });

  describe("bad quarter: users fell", () => {
    // Ruling 13: "'Users fell' compares end-of-turn users with last quarter's close."
    // The only launched company, no new users: it ends the turn on the 10,000 users it started with.
    // Cash 500,000 + 30,000 − 120,000 = $410,000, burn $90,000, runway 4.56 turns: the runway is fine.
    it.each([
      { lastClose: 10_000, fell: false }, // level: users did not fall
      { lastClose: 10_001, fell: true }, //  one fewer than at the last close
      { lastClose: 9_999, fell: false }, //  one more
    ])("last close $lastClose, this close 10000 → users fell: $fell", ({ lastClose, fell }) => {
      const seed = firingSeed(1, HUMAN);
      const start = launchedCompany(startupsOnly(), HUMAN, { users: 10_000, usersAtLastClose: lastClose, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.users.open).toBe(lastClose);
      expect(report.users.end).toBe(10_000);
      expect(report.cash.end).toBe(410_000);
      expect(report.runway).toBeCloseTo(410_000 / 90_000, 9);
      expect(report.board).toEqual({ usersFell: fell, lowRunway: false, fired: fell });
      expect(report.out).toBe(fell ? "fired" : null);
      // What it had when it went out: its 10,000 users, which now wait for the next pool.
      expect(result.state.companies[HUMAN].out).toEqual(
        fell ? { turn: 1, reason: "fired", users: 10_000, headcount: 3 } : null,
      );
      expect(result.state.carryOverUsers).toBe(fell ? 10_000 : 0);
    });

    it("a breach counts: users are compared with last quarter's close, not with the start of the turn", () => {
      // The state a turn starts from after a breach revealed for it: HUMAN closed last quarter on 10,000 users,
      // the breach took 10% (1,000), which wait for this turn's market split (ruling 1).
      // HUMAN and BLITZ are otherwise identical (quality, hype, price, team), so their pulls are equal and each
      // wins half the pool. With churn rate r, the pool is 1,000 + 9,000r + 10,000r and HUMAN ends on
      // 9,000 − 9,000r + (1,000 + 19,000r) ÷ 2 = 9,500 + 500r: more than the 9,000 it started the turn with,
      // fewer than the 10,000 it closed last quarter on, for any r below 1. (r = 12% − 0.08 × 48 = 8.16% → about 9,541.)
      const seed = firingSeed(1, HUMAN);
      let start = startupsOnly();
      start = launchedCompany(start, HUMAN, { users: 9_000, usersAtLastClose: 10_000, ...INVESTOR_BOARD });
      start = launchedCompany(start, BLITZ, { users: 10_000 });
      start = withState(start, { carryOverUsers: 1_000 });
      const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() }, seed, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.users.open).toBe(10_000);
      expect(report.users.end).toBeGreaterThan(9_000);
      expect(report.users.end).toBeLessThan(10_000);
      expect(Math.abs(report.users.end - 9_541)).toBeLessThanOrEqual(1);
      expect(report.board).toEqual({ usersFell: true, lowRunway: false, fired: true });
      expect(report.out).toBe("fired");
      // The rival that was not breached grew (10,500 − 500r), so its users did not fall.
      expect(reportFor(result, BLITZ).users.end).toBeGreaterThan(10_000);
      // Conserved: 9,000 + 10,000 + 1,000 waiting.
      expect(usersInSystem(result.state)).toBe(20_000);
    });

    it("a breach counts, end to end: the event is revealed for turn 3 and the board votes on turn 3's close", () => {
      // A deck with only the security breach, drawn every turn from turn 3.
      const breach = DESIGN.events.deck.find((card) => card.id === "security-breach");
      if (!breach) throw new Error("no breach card in the deck");
      const breachOnly: RulesConfig = { ...NO_NEW_USERS, events: { firstTurn: 3, chance: 1, deck: [breach] } };

      // Turn 2. HUMAN and BLITZ are identical launched companies (10,000 users, quality 30, hype 20, everyone on
      // Growth). Equal pulls, no new users: each wins back half of the churn, which is its own. Both stay on 10,000.
      let start = atTurn(startupsOnly(), 2);
      start = launchedCompany(start, HUMAN, { users: 10_000, quality: 30, hype: 20, ...INVESTOR_BOARD });
      start = launchedCompany(start, BLITZ, { users: 10_000, quality: 30, hype: 20 });
      const patches: Patches = { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() };

      // Both are eligible (launched, quality under 50, have users): take seeds where the breach hits HUMAN.
      const hitsHuman = (seed: number): boolean => resolve(start, patches, seed, breachOnly).state.event?.targetId === HUMAN;
      const firing = seedWhere((seed) => hitsHuman(seed) && boardRoll(seed, 3, HUMAN) < 0.3);
      const sparing = seedWhere((seed) => hitsHuman(seed) && boardRoll(seed, 3, HUMAN) >= 0.3);

      for (const seed of [firing, sparing]) {
        const second = resolve(start, patches, seed, breachOnly);
        expect(reportFor(second, HUMAN).users.end).toBe(10_000);
        expect(second.state.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
        const breached = second.state.companies[HUMAN];
        // 10% of 10,000 leave at once and wait for the next split; the close stays on record.
        expect(breached.users).toBe(9_000);
        expect(breached.usersAtLastClose).toBe(10_000);
        expect(second.state.carryOverUsers).toBe(1_000);
        // Hype: 20 × 0.8 = 16 at the close, −10 for the breach.
        expect(breached.hype).toBeCloseTo(6, 9);

        // Turn 3. HUMAN (hype 6) pulls less than BLITZ (hype 16), so it wins back under half of the pool
        // (1,000 + both churns): it ends above 9,000 but well below 10,000.
        const third = resolve(second.state, patches, seed, breachOnly);
        const report = reportFor(third, HUMAN);
        expect(report.users.open).toBe(10_000);
        expect(report.users.lostToEvent).toBe(1_000);
        expect(report.users.end).toBeGreaterThan(9_000);
        expect(report.users.end).toBeLessThan(10_000);
        // Cash is fine (over $300,000 against a burn under $100,000): only the users can make this quarter bad.
        expect(report.board).toEqual({ usersFell: true, lowRunway: false, fired: seed === firing });
        expect(report.out).toBe(seed === firing ? "fired" : null);
      }

      // Without the breach the same two quarters are flat: no fall, no vote, whatever the roll.
      const calmSecond = resolve(start, patches, firing, NO_NEW_USERS);
      const calmThird = resolve(calmSecond.state, patches, firing, NO_NEW_USERS);
      expect(reportFor(calmThird, HUMAN).users.end).toBe(10_000);
      expect(reportFor(calmThird, HUMAN).board).toEqual({ usersFell: false, lowRunway: false, fired: false });
    });
  });

  describe("the vote", () => {
    it("a good quarter is never put to a vote, whatever the roll", () => {
      // Investors hold the board, but users are level (10,000) and the runway is 4.56 turns.
      const start = launchedCompany(startupsOnly(), HUMAN, { users: 10_000, ...INVESTOR_BOARD });
      for (let seed = 1; seed <= 200; seed++) {
        const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
        expect(reportFor(result, HUMAN).board, `seed ${seed}`).toEqual({ usersFell: false, lowRunway: false, fired: false });
        expect(result.state.companies[HUMAN].out, `seed ${seed}`).toBeNull();
      }
    });

    it("over 400 seeds about 30% of bad quarters end in a firing, exactly when the roll is under 0.3", () => {
      // Unlaunched, investors hold the board, closes on $80,000 with a $120,000 burn (runway 0.67): bad every time.
      const start = withCompany(newGame(), HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
      let fired = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const result = resolve(start, { [HUMAN]: idle() }, seed);
        const reason = result.state.companies[HUMAN].out?.reason ?? null;
        expect(reason, `seed ${seed}`).toBe(boardRoll(seed, 1, HUMAN) < 0.3 ? "fired" : null);
        if (reason === "fired") fired++;
      }
      // 400 votes at 30%: mean 120, standard deviation √(400 × 0.3 × 0.7) = 9.2. 88–152 is 3.5 deviations either way.
      expect(fired).toBeGreaterThanOrEqual(88);
      expect(fired).toBeLessThanOrEqual(152);
    });

    it("the roll is keyed by turn and company: another seat, turn 7, another 400 seeds", () => {
      // BOOT, unlaunched, on turn 7, same bad quarter.
      const start = withCompany(atTurn(newGame(), 7), BOOT, { cash: 200_000, ...INVESTOR_BOARD });
      let fired = 0;
      for (let seed = 1001; seed <= 1400; seed++) {
        const result = resolve(start, { [BOOT]: idle() }, seed, NO_EVENTS);
        const reason = result.state.companies[BOOT].out?.reason ?? null;
        expect(reason, `seed ${seed}`).toBe(boardRoll(seed, 7, BOOT) < 0.3 ? "fired" : null);
        if (reason === "fired") fired++;
      }
      expect(fired).toBeGreaterThanOrEqual(88);
      expect(fired).toBeLessThanOrEqual(152);
    });

    it("the threshold is 0.3: the nearest roll below fires, the nearest roll above does not", () => {
      let under = { seed: 0, roll: 0 };
      let over = { seed: 0, roll: 1 };
      for (let seed = 1; seed <= 20_000; seed++) {
        const roll = boardRoll(seed, 1, HUMAN);
        if (roll < 0.3 && roll > under.roll) under = { seed, roll };
        if (roll >= 0.3 && roll < over.roll) over = { seed, roll };
      }
      // 20,000 uniform rolls: the nearest on each side lie within a few 1/20,000ths of 0.3.
      expect(under.roll).toBeGreaterThan(0.299);
      expect(over.roll).toBeLessThan(0.301);
      const start = withCompany(newGame(), HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
      expect(resolve(start, { [HUMAN]: idle() }, under.seed).state.companies[HUMAN].out?.reason).toBe("fired");
      expect(resolve(start, { [HUMAN]: idle() }, over.seed).state.companies[HUMAN].out).toBeNull();
    });

    it("one vote per bad quarter, even when users fell and the runway is short", () => {
      // Ruling 13: "The board votes once per bad quarter."
      // The only launched company: closes on 10,000 users against 12,000 last quarter (fell), and
      // cash 150,000 + 30,000 − 120,000 = $60,000 against a $90,000 burn (runway 0.67).
      // Two votes at 30% would fire 51% of the time; one vote fires exactly the seeds whose roll is under 0.3.
      const start = launchedCompany(startupsOnly(), HUMAN, {
        users: 10_000,
        usersAtLastClose: 12_000,
        cash: 150_000,
        ...INVESTOR_BOARD,
      });
      let fired = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
        const report = reportFor(result, HUMAN);
        const expected = boardRoll(seed, 1, HUMAN) < 0.3;
        expect(report.board, `seed ${seed}`).toEqual({ usersFell: true, lowRunway: true, fired: expected });
        if (report.out === "fired") fired++;
      }
      expect(fired).toBeGreaterThanOrEqual(88);
      expect(fired).toBeLessThanOrEqual(152);
    });

    it("each company's vote is its own: two bad quarters in one turn, all four combinations", () => {
      // HUMAN and BLITZ both have investor boards and close on $80,000 with a $120,000 burn. BOOT is healthy.
      let start = startupsOnly();
      start = withCompany(start, HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
      start = withCompany(start, BLITZ, { cash: 200_000, ...INVESTOR_BOARD });
      const patches: Patches = { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() };
      const seedFor = (human: boolean, blitz: boolean): number =>
        seedWhere((seed) => boardRoll(seed, 1, HUMAN) < 0.3 === human && boardRoll(seed, 1, BLITZ) < 0.3 === blitz);

      for (const [human, blitz] of [[true, true], [true, false], [false, true], [false, false]] as const) {
        const result = resolve(start, patches, seedFor(human, blitz));
        expect(result.state.companies[HUMAN].out?.reason ?? null).toBe(human ? "fired" : null);
        expect(result.state.companies[BLITZ].out?.reason ?? null).toBe(blitz ? "fired" : null);
        expect(result.state.companies[BOOT].out).toBeNull();
        // Both fired: BOOT is the last company standing. Otherwise at least two remain and the game goes on.
        expect(result.state.outcome).toEqual(human && blitz ? { kind: "lastStanding", turn: 1, winnerId: BOOT } : null);
        expect(result.state.freedPeople).toBe((human ? 3 : 0) + (blitz ? 3 : 0));
      }
    });

    it("a founder who survives one bad quarter faces a fresh vote the next", () => {
      // Opens with $300,000, burns $120,000 a turn. Turn 1 closes on $180,000 (runway 1.5), turn 2 on $60,000 (0.5).
      const start = withCompany(newGame(), HUMAN, { cash: 300_000, ...INVESTOR_BOARD });

      // Spared on turn 1, fired on turn 2.
      const seed = seedWhere((s) => boardRoll(s, 1, HUMAN) >= 0.3 && boardRoll(s, 2, HUMAN) < 0.3);
      const first = resolve(start, { [HUMAN]: idle() }, seed, NO_EVENTS);
      expect(reportFor(first, HUMAN).board).toEqual({ usersFell: false, lowRunway: true, fired: false });
      expect(first.state.companies[HUMAN].out).toBeNull();
      const second = resolve(first.state, { [HUMAN]: idle() }, seed, NO_EVENTS);
      expect(reportFor(second, HUMAN).cash.end).toBe(60_000);
      expect(reportFor(second, HUMAN).board).toEqual({ usersFell: false, lowRunway: true, fired: true });
      expect(second.state.companies[HUMAN].out).toEqual({ turn: 2, reason: "fired", users: 0, headcount: 3 });

      // Spared twice, then out of money on turn 3: 60,000 − 120,000 = −$60,000 → bankrupt, whatever the roll.
      const lucky = seedWhere((s) => boardRoll(s, 1, HUMAN) >= 0.3 && boardRoll(s, 2, HUMAN) >= 0.3 && boardRoll(s, 3, HUMAN) < 0.3);
      let state = start;
      for (let turn = 1; turn <= 2; turn++) {
        const result = resolve(state, { [HUMAN]: idle() }, lucky, NO_EVENTS);
        expect(result.state.companies[HUMAN].out).toBeNull();
        state = result.state;
      }
      const third = resolve(state, { [HUMAN]: idle() }, lucky, NO_EVENTS);
      expect(reportFor(third, HUMAN).cash.end).toBe(-60_000);
      expect(third.state.companies[HUMAN].out).toEqual({ turn: 3, reason: "bankrupt", users: 0, headcount: 3 });
    });

    it("a seat added by this turn's raise counts", () => {
      // Ruling 13: "only while investor seats outnumber founder seats (a seat added by this turn's raise counts)".
      // HUMAN has 2 founder and 2 investor seats, 2,000 users, hype 0, and opens with $311,999.
      const seed = firingSeed(1, HUMAN);
      const start = launchedCompany(startupsOnly(), HUMAN, {
        users: 2_000,
        hype: 0,
        cash: 311_999,
        founderSeats: 2,
        investorSeats: 2,
      });

      // No raise: seats stay level, so no vote, although the quarter is bad:
      // 311,999 + 6,000 − 120,000 = $197,999 against a $114,000 burn → runway 1.74.
      const quiet = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      expect(reportFor(quiet, HUMAN).runway).toBeCloseTo(197_999 / 114_000, 9);
      expect(reportFor(quiet, HUMAN).board).toBeNull();
      expect(quiet.state.companies[HUMAN].out).toBeNull();

      // Raising 10% ($30,000) adds the third investor seat this turn:
      // 311,999 + 30,000 + 6,000 − 120,000 = $227,999 → runway 1.99999, still under 2 → vote → fired.
      const raising = plan(3, { raisePercent: 10, allocation: { product: 2, growth: 0, recruiting: 0 } });
      const raised = resolve(start, { [HUMAN]: raising, ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      expect(raised.state.companies[HUMAN].investorSeats).toBe(3);
      expect(reportFor(raised, HUMAN).board).toEqual({ usersFell: false, lowRunway: true, fired: true });
      expect(raised.state.companies[HUMAN].out).toEqual({ turn: 1, reason: "fired", users: 2_000, headcount: 3 });
    });
  });

  describe("when the board can first vote, with the starting seats (ruling 13)", () => {
    it("the Incumbent's from its second raise (turn 4), a startup's from its third (turn 8)", () => {
      // Ruling 7: a raise needs 1,000+ users at the start of the turn and no raise in the previous two turns.
      // The Incumbent (1 investor seat, 10K users) asks for a raise every turn: it gets one on turn 1 and on
      // turn 4 → investor seats 2, 2, 2, 3 against 2 founder seats.
      // A startup (0 investor seats, 0 users) asks every turn too: none on turn 1 (no users), then turns 2, 5
      // and 8 → investor seats 0, 1, 1, 1, 2, 2, 2, 3.
      // Everyone has $100M, so nobody goes bankrupt; the whole market holds under 250K users before turn 9
      // (10,000 + 20,000 × (1.1^8 − 1) ÷ 0.1 = 238,718), so nobody can IPO either.
      let state = newGame(NO_EVENTS);
      for (const id of ALL) state = withCompany(state, id, { cash: 100_000_000 });
      const patches: Patches = {
        [HUMAN]: { raisePercent: 10, allocation: { product: 2, growth: 0, recruiting: 0 } },
        [INCUMBENT]: { raisePercent: 10, allocation: { product: 4, growth: 2, recruiting: 1 } },
      };
      const humanSeats: number[] = [];
      const humanVotes: boolean[] = [];
      const humanUsersAtStart: number[] = [];
      const incumbentSeats: number[] = [];
      const incumbentVotes: boolean[] = [];
      for (let turn = 1; turn <= 8; turn++) {
        humanUsersAtStart.push(state.companies[HUMAN].users);
        const result = resolve(state, patches, 1, NO_EVENTS);
        humanSeats.push(result.state.companies[HUMAN].investorSeats);
        humanVotes.push(reportFor(result, HUMAN).board !== null);
        if (turn <= 4) {
          incumbentSeats.push(result.state.companies[INCUMBENT].investorSeats);
          incumbentVotes.push(reportFor(result, INCUMBENT).board !== null);
        }
        state = result.state;
      }
      // The premise of the startup's timeline: it has 1,000+ users whenever its cooldown is over.
      expect(humanUsersAtStart[1]).toBeGreaterThanOrEqual(1_000);
      expect(humanUsersAtStart[4]).toBeGreaterThanOrEqual(1_000);
      expect(humanUsersAtStart[7]).toBeGreaterThanOrEqual(1_000);

      expect(incumbentSeats).toEqual([2, 2, 2, 3]);
      expect(incumbentVotes).toEqual([false, false, false, true]);
      expect(humanSeats).toEqual([0, 1, 1, 1, 2, 2, 2, 3]);
      expect(humanVotes).toEqual([false, false, false, false, false, false, false, true]);
    });
  });

  describe("the board's numbers come from config", () => {
    // Unlaunched, investors hold the board, burn $120,000 a turn.
    it("fire chance 0 never fires, fire chance 1 always does", () => {
      const start = withCompany(newGame(), HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
      const never: RulesConfig = { ...DESIGN, board: { ...DESIGN.board, fireChance: 0 } };
      const always: RulesConfig = { ...DESIGN, board: { ...DESIGN.board, fireChance: 1 } };
      for (let seed = 1; seed <= 100; seed++) {
        expect(resolve(start, { [HUMAN]: idle() }, seed, never).state.companies[HUMAN].out, `seed ${seed}`).toBeNull();
        expect(resolve(start, { [HUMAN]: idle() }, seed, always).state.companies[HUMAN].out?.reason, `seed ${seed}`).toBe("fired");
      }
    });

    it.each([
      { cash: 720_000, runway: 5, low: false }, // 600,000 ÷ 120,000 = 5 exactly
      { cash: 600_000, runway: 4, low: true }, //  480,000 ÷ 120,000 = 4, under 5 (and fine under the design's 2)
    ])("a runway limit of 5 turns: opening cash $cash → runway $runway, low: $low", ({ cash, runway, low }) => {
      const seed = firingSeed(1, HUMAN);
      const strict: RulesConfig = { ...DESIGN, board: { ...DESIGN.board, runwayTurns: 5 } };
      const start = withCompany(newGame(), HUMAN, { cash, ...INVESTOR_BOARD });
      const report = reportFor(resolve(start, { [HUMAN]: idle() }, seed, strict), HUMAN);
      expect(report.runway).toBe(runway);
      expect(report.board).toEqual({ usersFell: false, lowRunway: low, fired: low });
      // Under the design's limit of 2 the same quarter is fine.
      const designReport = reportFor(resolve(start, { [HUMAN]: idle() }, seed), HUMAN);
      expect(designReport.board).toEqual({ usersFell: false, lowRunway: false, fired: false });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("IPO", () => {
  // Design: "the first company with 250K+ users and a profitable quarter (revenue ≥ costs) wins immediately.
  // Ties go to the higher valuation."

  /** HUMAN launched with the given users as the only launched company; BLITZ and BOOT idle and unlaunched. */
  const lone = (users: number, patch: Partial<Company> = {}): GameState =>
    launchedCompany(startupsOnly(), HUMAN, { users, ...patch });

  describe("the 250K users", () => {
    it.each([
      { users: 250_000, ipo: true }, //  exactly 250K is "250K+"
      { users: 249_999, ipo: false }, // one short
      { users: 250_001, ipo: true },
    ])("$users users and a profit → IPO: $ipo", ({ users, ipo }) => {
      // No new users: the lone launched company's users stand still.
      // Revenue users × $3 (≈ $750,000) ≥ costs 3 × $40,000 = $120,000: profitable in every case.
      const result = resolve(lone(users), { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.users.end).toBe(users);
      expect(report.revenue).toBe(users * 3);
      expect(report.profitable).toBe(true);
      if (ipo) {
        expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
        expect(result.log.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
        // "Stays on the final turn once the game is over."
        expect(result.state.turn).toBe(1);
      } else {
        expect(result.state.outcome).toBeNull();
        expect(result.state.turn).toBe(2);
      }
      expect(survivors(result.state)).toEqual([HUMAN, BLITZ, BOOT]);
    });

    it.each([
      { users: 230_000, end: 250_000, ipo: true }, //  230,000 + 20,000
      { users: 229_999, end: 249_999, ipo: false }, // 229,999 + 20,000
    ])("it is the users at the end of the turn that count: $users + 20000 new → IPO: $ipo", ({ users, end, ipo }) => {
      // Design market, turn 1: 20,000 new users arrive and the only launched company takes them all,
      // along with its own churned users.
      const result = resolve(lone(users), { [HUMAN]: plan(), ...IDLE_RIVALS });
      expect(result.log.market.newUsers).toBe(20_000);
      expect(reportFor(result, HUMAN).users.end).toBe(end);
      expect(result.state.outcome).toEqual(ipo ? { kind: "ipo", turn: 1, winnerId: HUMAN } : null);
    });

    it("starting the turn on 250K is not enough if the turn ends below it", () => {
      // HUMAN's product has decayed to quality 0 and nobody works on it: pull = 0 × ... = 0, so it wins nobody
      // back (the pool waits). Churn = 12% − 0.08 × 0 = 12%: 250,000 − 30,000 = 220,000 at the close.
      // Revenue 220,000 × $3 = $660,000 ≥ $120,000: profitable, but under 250K.
      const result = resolve(lone(250_000, { quality: 0 }), { [HUMAN]: idle(), ...IDLE_RIVALS });
      const report = reportFor(result, HUMAN);
      expect(Math.abs(report.users.end - 220_000)).toBeLessThanOrEqual(1);
      expect(report.profitable).toBe(true);
      expect(result.state.outcome).toBeNull();
      // Nobody could take the pool: the churned users and the 20,000 new ones wait. 250,000 + 20,000 in all.
      expect(usersInSystem(result.state)).toBe(270_000);
    });

    it("the IPO threshold comes from config", () => {
      // 40,000 users × $3 = $120,000 = costs: profitable. An IPO at 40,000 users, none at the design's 250,000.
      const low: RulesConfig = { ...NO_NEW_USERS, ipo: { users: 40_000 } };
      const patches: Patches = { [HUMAN]: plan(), ...IDLE_RIVALS };
      expect(resolve(lone(40_000), patches, 1, low).state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
      expect(resolve(lone(40_000), patches, 1, NO_NEW_USERS).state.outcome).toBeNull();
    });
  });

  describe("the profitable quarter (revenue ≥ costs)", () => {
    it.each([
      { users: 280_000, headcount: 21, profitable: true }, //  840,000 = 21 × 40,000: break-even counts
      { users: 280_000, headcount: 22, profitable: false }, // 840,000 < 22 × 40,000 = 880,000
      { users: 279_999, headcount: 21, profitable: false }, // 839,997 < 840,000: $3 short
      { users: 280_000, headcount: 20, profitable: true }, //  840,000 > 800,000
    ])("$users users at $3 against $headcount salaries → profitable and IPO: $profitable", ({ users, headcount, profitable }) => {
      // No new users: the lone launched company's users stand still, all of them above 250K.
      const start = lone(users, { headcount });
      const result = resolve(start, { [HUMAN]: plan(headcount), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.users.end).toBe(users);
      expect(report.revenue).toBe(users * 3);
      expect(report.costs.total).toBe(headcount * 40_000);
      expect(report.profitable).toBe(profitable);
      expect(result.state.outcome).toEqual(profitable ? { kind: "ipo", turn: 1, winnerId: HUMAN } : null);
    });

    it.each([
      { marketing: 50_000, costs: 1_250_000, ipo: true }, //  30 × 40,000 + 50,000 = revenue exactly
      { marketing: 75_000, costs: 1_275_000, ipo: false }, // one marketing step more: a $25,000 loss
    ])("every cost counts: Premium revenue $1.25M against salaries plus $marketing marketing → IPO: $ipo", ({ marketing, costs, ipo }) => {
      // 250,000 users on Premium: revenue 250,000 × $5 = $1,250,000. 30 people: $1,200,000 in salaries.
      const start = lone(250_000, { headcount: 30 });
      const result = resolve(start, { [HUMAN]: plan(30, { price: "premium", marketing }), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.users.end).toBe(250_000);
      expect(report.revenue).toBe(1_250_000);
      expect(report.costs.total).toBe(costs);
      expect(report.profitable).toBe(ipo);
      expect(result.state.outcome).toEqual(ipo ? { kind: "ipo", turn: 1, winnerId: HUMAN } : null);
    });

    it("money from a raise is not revenue: a loss-making quarter does not IPO however much was raised", () => {
      // 250,000 users, hype 0: revenue $750,000 against 19 salaries = $760,000: a $10,000 loss.
      // Selling 10% at a valuation of 250,000 × $150 = $37,500,000 brings in $3,750,000 that turn.
      // Cash 500,000 + 3,750,000 + 750,000 − 760,000 = $4,240,000, but the quarter is not profitable.
      const start = lone(250_000, { headcount: 19, hype: 0 });
      const raising = plan(19, { raisePercent: 10, allocation: { product: 18, growth: 0, recruiting: 0 } });
      const result = resolve(start, { [HUMAN]: raising, ...IDLE_RIVALS }, 1, NO_NEW_USERS);
      const report = reportFor(result, HUMAN);
      expect(report.raise).toEqual({ percent: 10, valuation: 37_500_000, amount: 3_750_000 });
      expect(report.revenue).toBe(750_000);
      expect(report.costs.total).toBe(760_000);
      expect(report.cash.end).toBe(4_240_000);
      expect(report.profitable).toBe(false);
      expect(result.state.outcome).toBeNull();
    });

    it("the profit must come in the same quarter as the 250K users", () => {
      // Design market, no events. HUMAN is the only launched company and takes every new user.
      let state = lone(220_000);

      // Turn 1: 220,000 + 20,000 = 240,000. Revenue $720,000 ≥ $120,000: profitable, but under 250K.
      let result = resolve(state, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_EVENTS);
      expect(reportFor(result, HUMAN).users.end).toBe(240_000);
      expect(reportFor(result, HUMAN).profitable).toBe(true);
      expect(result.state.outcome).toBeNull();
      state = result.state;

      // Turn 2: 20,000 × 1.1 = 22,000 new → 262,000 users. Revenue 262,000 × $3 = $786,000;
      // costs $120,000 + $700,000 marketing = $820,000: over 250K, but a loss. Last quarter's profit does not count.
      result = resolve(state, { [HUMAN]: plan(3, { marketing: 700_000 }), ...IDLE_RIVALS }, 1, NO_EVENTS);
      expect(result.log.market.newUsers).toBe(22_000);
      expect(reportFor(result, HUMAN).users.end).toBe(262_000);
      expect(reportFor(result, HUMAN).revenue).toBe(786_000);
      expect(reportFor(result, HUMAN).costs.total).toBe(820_000);
      expect(reportFor(result, HUMAN).profitable).toBe(false);
      expect(result.state.outcome).toBeNull();
      state = result.state;

      // Turn 3: 20,000 × 1.1² = 24,200 new → 286,200 users. Revenue $858,600 ≥ $120,000: IPO on turn 3.
      result = resolve(state, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_EVENTS);
      expect(result.log.market.newUsers).toBe(24_200);
      expect(reportFor(result, HUMAN).users.end).toBe(286_200);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 3, winnerId: HUMAN });
      expect(result.state.turn).toBe(3);
    });

    it("a bigger rival without a profit does not stop a smaller profitable company's IPO", () => {
      // FROZEN market. BLITZ: 400,000 users, 31 people: revenue $1,200,000 < costs $1,240,000 → no IPO for it.
      // HUMAN: 250,000 users, 3 people: revenue $750,000 ≥ $120,000 → IPO.
      let start = startupsOnly();
      start = launchedCompany(start, HUMAN, { users: 250_000 });
      start = launchedCompany(start, BLITZ, { users: 400_000, headcount: 31 });
      const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(31), [BOOT]: idle() }, 1, FROZEN);
      expect(reportFor(result, BLITZ).profitable).toBe(false);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
    });
  });

  describe("two IPOs in the same turn", () => {
    // FROZEN market: both companies keep their users. Both are profitable (≥ $750,000 against $120,000).
    // Valuation = users × $150 × (1 + hype/100); hype decays 20% over the turn (50 → 40, 0 → 0).
    const race = (human: Partial<Company>, blitz: Partial<Company>) => {
      let start = startupsOnly();
      start = launchedCompany(start, HUMAN, human);
      start = launchedCompany(start, BLITZ, blitz);
      return resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    };
    const quiet = { users: 300_000, hype: 0, founderEquity: 1 }; //  300,000 × $150 × 1.0 = $45,000,000; stake $45.0M
    const hyped = { users: 250_000, hype: 50, founderEquity: 0.2 }; // 250,000 × $150 × 1.4 = $52,500,000; stake $10.5M

    it("ties go to the higher valuation, not to more users, the bigger founder stake or the lower seat", () => {
      const result = race(quiet, hyped);
      expect(reportFor(result, HUMAN).valuation).toBe(45_000_000);
      expect(reportFor(result, BLITZ).valuation).toBeCloseTo(52_500_000, 2);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: BLITZ });
    });

    it("the same race with the seats swapped", () => {
      const result = race(hyped, quiet);
      expect(reportFor(result, HUMAN).valuation).toBeCloseTo(52_500_000, 2);
      expect(reportFor(result, BLITZ).valuation).toBe(45_000_000);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
    });

    // Ruling 14: "ties go to the higher valuation, then the higher founder stake".
    // Both: 250,000 users, hype 0 → valuation $37,500,000. Stakes: 0.5 × 37.5M = $18.75M and 0.8 × 37.5M = $30M.
    it.each([
      { human: 0.5, blitz: 0.8, winner: BLITZ },
      { human: 0.8, blitz: 0.5, winner: HUMAN },
    ])("equal valuations: founder equity $human against $blitz → winner seat $winner", ({ human, blitz, winner }) => {
      const result = race(
        { users: 250_000, hype: 0, founderEquity: human },
        { users: 250_000, hype: 0, founderEquity: blitz },
      );
      expect(reportFor(result, HUMAN).valuation).toBe(37_500_000);
      expect(reportFor(result, BLITZ).valuation).toBe(37_500_000);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: winner });
    });
  });

  describe("an IPO ends the game at once (order of a turn, step 11)", () => {
    it("the IPO comes before the board vote: a founder who would have been fired wins instead", () => {
      // Investors hold HUMAN's board and its users fell (300,000 at the last close, 260,000 now): a bad quarter,
      // and the roll is under 0.3. But 260,000 users and revenue $780,000 ≥ costs $120,000 is an IPO, checked first.
      const seed = firingSeed(1, HUMAN);
      const start = lone(260_000, { usersAtLastClose: 300_000, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
      expect(result.state.companies[HUMAN].out).toBeNull();
      expect(reportFor(result, HUMAN).out).toBeNull();
      expect(result.state.companies[HUMAN].users).toBe(260_000);
    });

    it("the control: the same quarter just under 250K is put to the vote and the founder is fired", () => {
      // 249,999 users now against 300,000 at the last close: no IPO, users fell, roll under 0.3 → fired.
      const seed = firingSeed(1, HUMAN);
      const start = lone(249_999, { usersAtLastClose: 300_000, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      expect(result.state.companies[HUMAN].out).toEqual({ turn: 1, reason: "fired", users: 249_999, headcount: 3 });
      // BLITZ and BOOT are still in: no winner yet.
      expect(result.state.outcome).toBeNull();
    });

    it("the IPO comes before last company standing: a rival's collapse in the same turn does not change the ending", () => {
      // Two companies. HUMAN: 250,000 users, profitable → IPO. BLITZ: 100,000 − 120,000 = −$20,000.
      let start = onlyActive(newGame(), [HUMAN, BLITZ]);
      start = launchedCompany(start, HUMAN, { users: 250_000 });
      start = withCompany(start, BLITZ, { cash: 100_000 });
      const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: idle() }, 1, NO_NEW_USERS);
      expect(reportFor(result, BLITZ).cash.end).toBe(-20_000);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
    });

    it("no bankruptcy is processed after an IPO: the rival with negative cash is not marked out", () => {
      // "11. IPO check. An IPO ends the game at once.  12. Bankruptcy, then the board vote."
      let start = onlyActive(newGame(), [HUMAN, BLITZ]);
      start = launchedCompany(start, HUMAN, { users: 250_000 });
      start = withCompany(start, BLITZ, { cash: 100_000 });
      const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: idle() }, 1, NO_NEW_USERS);
      expect(result.state.outcome?.kind).toBe("ipo");
      expect(reportFor(result, BLITZ).out).toBeNull();
      expect(result.state.companies[BLITZ].out).toBeNull();
      expect(result.state.companies[BLITZ].headcount).toBe(3);
      expect(result.state.freedPeople).toBe(0);
    });

    it("no board vote is held after an IPO: a rival's founder is not fired in the IPO turn", () => {
      // BLITZ: investors hold the board, closes on $80,000 with a $120,000 burn, roll under 0.3.
      const seed = firingSeed(1, BLITZ);
      let start = lone(250_000);
      start = withCompany(start, BLITZ, { cash: 200_000, ...INVESTOR_BOARD });
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, seed, NO_NEW_USERS);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
      expect(reportFor(result, BLITZ).out).toBeNull();
      expect(result.state.companies[BLITZ].out).toBeNull();
    });

    it("on turn 20 the IPO beats the founder-stake ranking", () => {
      // FROZEN market, turn 20. HUMAN: 250,000 users, founders own 10% → IPO; stake 0.1 × $37.5M = $3.75M.
      // BLITZ: 200,000 users (no IPO), founders own 100%: stake 200,000 × $150 = $30M, eight times HUMAN's.
      let start = atTurn(startupsOnly(), 20);
      start = launchedCompany(start, HUMAN, { users: 250_000, hype: 0, founderEquity: 0.1 });
      start = launchedCompany(start, BLITZ, { users: 200_000, hype: 0, founderEquity: 1 });
      const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 20, winnerId: HUMAN });
    });

    it("no event is drawn for a turn that will never be played", () => {
      // Step 14 ("next turn's event is drawn") comes after the endings. Events at 100% from turn 3; IPO on turn 5.
      const always: RulesConfig = { ...NO_NEW_USERS, events: { ...DESIGN.events, chance: 1 } };
      const start = atTurn(lone(250_000), 5);
      const result = resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, always);
      expect(result.state.outcome).toEqual({ kind: "ipo", turn: 5, winnerId: HUMAN });
      expect(result.log.nextEvent).toBeNull();
      expect(result.state.event).toEqual(start.event);
      expect(result.state.turn).toBe(5);
      // The control: one user short, the game goes on and turn 6 gets its event.
      const control = resolve(atTurn(lone(249_999), 5), { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, always);
      expect(control.state.outcome).toBeNull();
      expect(control.log.nextEvent).not.toBeNull();
      expect(control.state.event).toEqual(control.log.nextEvent);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("last company standing, and nobody standing", () => {
  // Design: "The player loses on bankruptcy or getting fired, and wins if every CPU is out."
  // Ruling 14: "last company standing wins"; "If every remaining company goes out in the same turn, nobody wins."
  // A company opening with $100,000 and idling pays $120,000 and closes on −$20,000: bankrupt.
  const BROKE = { cash: 100_000 };

  it("two companies, one goes bankrupt: the other wins", () => {
    const start = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), HUMAN, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() });
    expect(result.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: BLITZ });
    expect(result.log.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: BLITZ });
    expect(result.state.turn).toBe(1);
  });

  it("two companies, one founder is fired: the other wins", () => {
    // HUMAN: investors hold the board, closes on $80,000 with a $120,000 burn, roll under 0.3.
    const seed = firingSeed(1, HUMAN);
    const start = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), HUMAN, { cash: 200_000, ...INVESTOR_BOARD });
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() }, seed);
    expect(result.state.companies[HUMAN].out?.reason).toBe("fired");
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: BLITZ });
  });

  it("the player wins when every CPU goes out, all three in the same turn", () => {
    // BLITZ and BOOT: 100,000 − 120,000 < 0. The Incumbent: $100,000 against 8 × $40,000 = $320,000 in salaries
    // and under $100,000 of revenue: bankrupt too. HUMAN idles on $500,000.
    let start = newGame();
    for (const id of [BLITZ, BOOT, INCUMBENT]) start = withCompany(start, id, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle(), [INCUMBENT]: { hireLimit: 0 } });
    for (const id of [BLITZ, BOOT, INCUMBENT]) expect(result.state.companies[id].out?.reason).toBe("bankrupt");
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: HUMAN });
  });

  it("a CPU wins the same way: the engine has no special player (ruling 19)", () => {
    let start = newGame();
    for (const id of [HUMAN, BLITZ, BOOT]) start = withCompany(start, id, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() });
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: INCUMBENT });
  });

  it("the game goes on without the player while two CPUs remain", () => {
    // "The app ends the session when the human's company is out; the simulator plays on until there is a winner."
    const result = resolve(withCompany(newGame(), HUMAN, BROKE), { [HUMAN]: idle() });
    expect(result.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    expect(survivors(result.state)).toEqual([BLITZ, BOOT, INCUMBENT]);
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(2);
  });

  it("one company goes out per turn until one is left", () => {
    // Idle startups burn $120,000 a turn: HUMAN ($100,000) is out on turn 1, BLITZ ($200,000) on turn 2
    // (80,000 − 120,000), BOOT ($300,000) on turn 3 (60,000 − 120,000). The Incumbent ($3M) outlasts them.
    let state = newGame();
    state = withCompany(state, HUMAN, { cash: 100_000 });
    state = withCompany(state, BLITZ, { cash: 200_000 });
    state = withCompany(state, BOOT, { cash: 300_000 });
    const patches: Patches = { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() };
    const outcomes: (Outcome | null)[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      const result = resolve(state, patches, 1, NO_EVENTS);
      outcomes.push(result.state.outcome);
      state = result.state;
    }
    expect(outcomes).toEqual([null, null, { kind: "lastStanding", turn: 3, winnerId: INCUMBENT }]);
    expect(state.companies[HUMAN].out).toEqual({ turn: 1, reason: "bankrupt", users: 0, headcount: 3 });
    expect(state.companies[BLITZ].out).toEqual({ turn: 2, reason: "bankrupt", users: 0, headcount: 3 });
    expect(state.companies[BOOT].out).toEqual({ turn: 3, reason: "bankrupt", users: 0, headcount: 3 });
    expect(state.turn).toBe(3);
  });

  it("both remaining companies go bankrupt in the same turn: nobody wins", () => {
    let start = onlyActive(newGame(), [HUMAN, BLITZ]);
    start = withCompany(withCompany(start, HUMAN, BROKE), BLITZ, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() });
    expect(survivors(result.state)).toEqual([]);
    expect(result.state.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });
    expect(result.log.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });
    expect(result.state.turn).toBe(1);
  });

  it("all four go bankrupt in the same turn: nobody wins", () => {
    let start = newGame();
    for (const id of ALL) start = withCompany(start, id, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle(), [INCUMBENT]: { hireLimit: 0 } });
    expect(survivors(result.state)).toEqual([]);
    expect(result.state.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });
  });

  it("the winner is decided after both the bankruptcies and the board votes", () => {
    // HUMAN goes bankrupt. BLITZ has an investor board and a bad quarter ($80,000 left, $120,000 burn).
    let start = onlyActive(newGame(), [HUMAN, BLITZ]);
    start = withCompany(start, HUMAN, BROKE);
    start = withCompany(start, BLITZ, { cash: 200_000, ...INVESTOR_BOARD });
    const patches: Patches = { [HUMAN]: idle(), [BLITZ]: idle() };

    // Roll under 0.3: BLITZ's founder is fired in the turn its last rival died. Nobody is left: nobody wins.
    const fired = resolve(start, patches, firingSeed(1, BLITZ));
    expect(fired.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    expect(fired.state.companies[BLITZ].out?.reason).toBe("fired");
    expect(fired.state.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });

    // Roll of 0.3 or more: BLITZ survives its bad quarter and is the last company standing.
    const spared = resolve(start, patches, sparingSeed(1, BLITZ));
    expect(spared.state.companies[BLITZ].out).toBeNull();
    expect(spared.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: BLITZ });
  });

  it("a lone remaining company that goes out leaves nobody: no winner", () => {
    const start = withCompany(onlyActive(newGame(), [HUMAN]), HUMAN, BROKE);
    const result = resolve(start, { [HUMAN]: idle() });
    expect(result.state.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });
  });

  it("a lone remaining company that survives the turn is the last company standing", () => {
    const result = resolve(onlyActive(newGame(), [HUMAN]), { [HUMAN]: idle() });
    expect(result.state.companies[HUMAN].out).toBeNull();
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: HUMAN });
  });

  it("on turn 20, last company standing is decided before the founder-stake ranking", () => {
    // Step 13: "Last company standing, then the turn-20 ranking."
    const start = withCompany(atTurn(onlyActive(newGame(), [HUMAN, BLITZ]), 20), HUMAN, BROKE);
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() });
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 20, winnerId: BLITZ });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("the turn-20 result", () => {
  // Design: "If nobody IPOs by the end of turn 20, the highest founder stake (founder equity × valuation) wins."
  // FROZEN market: every company keeps its users. Valuation = users × $150 × (1 + hype/100).

  const threeWay = (): GameState => {
    let state = startupsOnly();
    state = launchedCompany(state, HUMAN, { users: 10_000, hype: 0, founderEquity: 1 });
    state = launchedCompany(state, BLITZ, { users: 30_000, hype: 0, founderEquity: 0.3 });
    state = launchedCompany(state, BOOT, { users: 20_000, hype: 0, founderEquity: 0.9 });
    return state;
  };
  const ALL_WORK: Patches = { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: plan() };

  it("the highest founder stake wins: not the most equity, not the highest valuation", () => {
    // HUMAN: 10,000 × $150 = $1,500,000 × 1.0 = $1,500,000 (most equity)
    // BLITZ: 30,000 × $150 = $4,500,000 × 0.3 = $1,350,000 (highest valuation, most users)
    // BOOT:  20,000 × $150 = $3,000,000 × 0.9 = $2,700,000 (highest stake)
    const result = resolve(atTurn(threeWay(), 20), ALL_WORK, 1, FROZEN);
    expect(reportFor(result, HUMAN).valuation).toBe(1_500_000);
    expect(reportFor(result, BLITZ).valuation).toBe(4_500_000);
    expect(reportFor(result, BOOT).valuation).toBe(3_000_000);
    expect(reportFor(result, HUMAN).equity).toBe(1);
    expect(reportFor(result, BLITZ).equity).toBe(0.3);
    expect(reportFor(result, BOOT).equity).toBe(0.9);
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BOOT });
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BOOT });
    // "Stays on the final turn once the game is over."
    expect(result.state.turn).toBe(20);
    expect(survivors(result.state)).toEqual([HUMAN, BLITZ, BOOT]);
  });

  it("no ranking before turn 20: the same position on turn 19 plays on", () => {
    const result = resolve(atTurn(threeWay(), 19), ALL_WORK, 1, FROZEN);
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(20);
  });

  it("the game length comes from config", () => {
    const short: RulesConfig = { ...FROZEN, game: { maxTurns: 5 } };
    expect(resolve(atTurn(threeWay(), 5), ALL_WORK, 1, short).state.outcome).toEqual({ kind: "turnLimit", turn: 5, winnerId: BOOT });
    expect(resolve(atTurn(threeWay(), 4), ALL_WORK, 1, short).state.outcome).toBeNull();
  });

  it("the valuation in the ranking is the end-of-turn one: hype has already decayed", () => {
    // Step 10 (hype) comes before step 13 (ranking). Founders own 100% of both.
    // HUMAN: 10,000 users, hype 50 → 40 at the close: 10,000 × $150 × 1.4 = $2,100,000.
    // BLITZ: 14,500 users, hype 0: 14,500 × $150 = $2,175,000 → BLITZ, by $75,000.
    // (On start-of-turn hype HUMAN would be worth $2,250,000 and win.)
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 10_000, hype: 50 });
    start = launchedCompany(start, BLITZ, { users: 14_500, hype: 0 });
    const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    expect(reportFor(result, HUMAN).hype.end).toBeCloseTo(40, 9);
    expect(reportFor(result, HUMAN).valuation).toBeCloseTo(2_100_000, 3);
    expect(reportFor(result, BLITZ).valuation).toBe(2_175_000);
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BLITZ });
  });

  it("the funding climate scales every valuation alike and does not change the ranking", () => {
    // A funding winter (×0.6) in its last turn on turn 20: step 14 (the climate ticks down) comes after the ranking.
    // HUMAN $900,000 × 1.0 = $900,000; BLITZ $2,700,000 × 0.3 = $810,000; BOOT $1,800,000 × 0.9 = $1,620,000.
    const start = withState(atTurn(threeWay(), 20), { climate: { multiplier: 0.6, turnsLeft: 1 } });
    const result = resolve(start, ALL_WORK, 1, FROZEN);
    expect(result.log.climateMultiplier).toBe(0.6);
    expect(reportFor(result, HUMAN).valuation).toBeCloseTo(900_000, 3);
    expect(reportFor(result, BLITZ).valuation).toBeCloseTo(2_700_000, 3);
    expect(reportFor(result, BOOT).valuation).toBeCloseTo(1_800_000, 3);
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BOOT });
  });

  it("the Incumbent's founders own 60% from the start, and that counts", () => {
    // Incumbent: 10,000 users, hype 20 → 16 at the close: 10,000 × $150 × 1.16 = $1,740,000 × 0.6 = $1,044,000.
    // HUMAN: 7,300 users, hype 0, 100% founder-owned: 7,300 × $150 = $1,095,000 → HUMAN, with fewer users and
    // the lower valuation. (Even on start-of-turn hype the Incumbent's stake would be 0.6 × $1.8M = $1,080,000.)
    let start = atTurn(onlyActive(newGame(), [HUMAN, INCUMBENT]), 20);
    start = launchedCompany(start, HUMAN, { users: 7_300, hype: 0 });
    const result = resolve(start, { [HUMAN]: plan(), [INCUMBENT]: { hireLimit: 0 } }, 1, FROZEN);
    expect(reportFor(result, INCUMBENT).users.end).toBe(10_000);
    expect(reportFor(result, INCUMBENT).equity).toBe(0.6);
    expect(reportFor(result, INCUMBENT).valuation).toBeCloseTo(1_740_000, 3);
    expect(reportFor(result, HUMAN).valuation).toBe(1_095_000);
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: HUMAN });
  });

  it("a raise on turn 20 shrinks the founder stake that is ranked", () => {
    // HUMAN: 10,000 users, hype 0. BLITZ: 9,000 users, hype 0: stake 9,000 × $150 = $1,350,000. BOOT has no users.
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 10_000, hype: 0 });
    start = launchedCompany(start, BLITZ, { users: 9_000, hype: 0 });

    // No raise: HUMAN's stake is 1.0 × 10,000 × $150 = $1,500,000 → HUMAN.
    const kept = resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    expect(kept.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: HUMAN });

    // HUMAN sells 30% at a $1,500,000 valuation ($450,000): equity 0.7. Hype 0 × 0.8 + 10 for the raise = 10,
    // so its closing valuation is 10,000 × $150 × 1.1 = $1,650,000 and its stake 0.7 × 1.65M = $1,155,000 → BLITZ.
    const raising = plan(3, { raisePercent: 30, allocation: { product: 2, growth: 0, recruiting: 0 } });
    const sold = resolve(start, { [HUMAN]: raising, [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    const report = reportFor(sold, HUMAN);
    expect(report.raise).toEqual({ percent: 30, valuation: 1_500_000, amount: 450_000 });
    expect(report.equity).toBeCloseTo(0.7, 12);
    expect(report.valuation).toBeCloseTo(1_650_000, 3);
    expect(sold.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BLITZ });
  });

  it("a company that goes bankrupt on turn 20 is not ranked, however big its stake", () => {
    // Ruling 14: "... among surviving companies".
    // HUMAN: 100,000 users, 10 people, $0: revenue $300,000 − costs $400,000 = −$100,000 → bankrupt.
    //        Its stake would have been 100,000 × $150 = $15,000,000.
    // BLITZ: 10,000 × $150 × 0.5 = $750,000.  BOOT: 20,000 × $150 × 0.2 = $600,000 → BLITZ.
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 100_000, hype: 0, headcount: 10, cash: 0 });
    start = launchedCompany(start, BLITZ, { users: 10_000, hype: 0, founderEquity: 0.5 });
    start = launchedCompany(start, BOOT, { users: 20_000, hype: 0, founderEquity: 0.2 });
    const result = resolve(start, { [HUMAN]: plan(10), [BLITZ]: plan(), [BOOT]: plan() }, 1, FROZEN);
    expect(reportFor(result, HUMAN).cash.end).toBe(-100_000);
    expect(result.state.companies[HUMAN].out).toEqual({ turn: 20, reason: "bankrupt", users: 100_000, headcount: 10 });
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BLITZ });
  });

  it("a founder fired on turn 20 is not ranked either", () => {
    // HUMAN: 100,000 users (100,001 at the last close: users fell), investors hold the board.
    // Its stake is $15,000,000 against BLITZ's $750,000 and BOOT's $600,000.
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 100_000, usersAtLastClose: 100_001, hype: 0, ...INVESTOR_BOARD });
    start = launchedCompany(start, BLITZ, { users: 10_000, hype: 0, founderEquity: 0.5 });
    start = launchedCompany(start, BOOT, { users: 20_000, hype: 0, founderEquity: 0.2 });

    const fired = resolve(start, ALL_WORK, firingSeed(20, HUMAN), FROZEN);
    expect(fired.state.companies[HUMAN].out).toEqual({ turn: 20, reason: "fired", users: 100_000, headcount: 3 });
    expect(fired.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: BLITZ });

    const spared = resolve(start, ALL_WORK, sparingSeed(20, HUMAN), FROZEN);
    expect(spared.state.companies[HUMAN].out).toBeNull();
    expect(spared.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: HUMAN });
  });

  it("everyone going out on turn 20 leaves no winner", () => {
    let start = atTurn(startupsOnly(), 20);
    for (const id of [HUMAN, BLITZ, BOOT]) start = withCompany(start, id, { cash: 100_000 });
    const result = resolve(start, { [HUMAN]: idle(), [BLITZ]: idle(), [BOOT]: idle() });
    expect(result.state.outcome).toEqual({ kind: "wipeout", turn: 20, winnerId: null });
  });

  it("an equal founder stake still names one surviving company the winner (the design does not say which)", () => {
    // HUMAN: 10,000 × $150 × 0.5 = $750,000.  BLITZ: 5,000 × $150 × 1.0 = $750,000.  BOOT: no users, $0.
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 10_000, hype: 0, founderEquity: 0.5 });
    start = launchedCompany(start, BLITZ, { users: 5_000, hype: 0, founderEquity: 1 });
    const result = resolve(start, { [HUMAN]: plan(), [BLITZ]: plan(), [BOOT]: idle() }, 1, FROZEN);
    expect(result.state.outcome?.kind).toBe("turnLimit");
    expect([HUMAN, BLITZ]).toContain(result.state.outcome?.winnerId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("a game that is over does not change", () => {
  const ipo = () => {
    const start = launchedCompany(startupsOnly(), HUMAN, { users: 250_000 });
    return resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, NO_NEW_USERS);
  };
  const lastStanding = () => {
    const start = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), HUMAN, { cash: 100_000 });
    return resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() });
  };
  const turnLimit = () => {
    let start = atTurn(startupsOnly(), 20);
    start = launchedCompany(start, HUMAN, { users: 10_000 });
    return resolve(start, { [HUMAN]: plan(), ...IDLE_RIVALS }, 1, FROZEN);
  };
  const wipeout = () => {
    let start = onlyActive(newGame(), [HUMAN, BLITZ]);
    start = withCompany(withCompany(start, HUMAN, { cash: 100_000 }), BLITZ, { cash: 100_000 });
    return resolve(start, { [HUMAN]: idle(), [BLITZ]: idle() });
  };

  it.each([
    { kind: "ipo", play: ipo },
    { kind: "lastStanding", play: lastStanding },
    { kind: "turnLimit", play: turnLimit },
    { kind: "wipeout", play: wipeout },
  ] as const)("after $kind: resolving again returns the same state, whatever the plans and the seed", ({ kind, play }) => {
    const final = play();
    expect(final.state.outcome?.kind).toBe(kind);
    const snapshot = JSON.parse(JSON.stringify(final.state)) as GameState;

    // Busy plans for everyone, another seed, and events at 100%: nothing may move.
    const busy = plan(3, { marketing: 100_000, raisePercent: 30, layoffs: 1, poachTarget: BLITZ, price: "premium", hireLimit: null });
    const always: RulesConfig = { ...DESIGN, events: { ...DESIGN.events, chance: 1 } };
    let state = final.state;
    for (const seed of [1, 2, 99]) {
      const again = resolveTurn(state, plansOf(state, { [HUMAN]: busy, [BLITZ]: busy, [BOOT]: busy, [INCUMBENT]: busy }), seed, always);
      expect(again.state).toEqual(snapshot);
      expect(again.state.outcome).toEqual(final.state.outcome);
      expect(again.state.turn).toBe(final.state.turn);
      state = again.state;
    }
    // The input was not mutated either.
    expect(final.state).toEqual(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("the end-of-turn checks, replayed from the reports over whole random games", () => {
  // An oracle written from the design: after every turn of many random games, the endings and the board are
  // worked out again from that turn's reports and compared with what the engine decided.
  //   11. IPO: any company closing on 250K+ users with revenue ≥ costs → the highest valuation among them wins.
  //   12. Bankruptcy (closing cash < 0), then the board vote (investor seats > founder seats, a bad quarter,
  //       roll < 0.3). Companies that go out release their users and staff.
  //   13. Nobody left → nobody wins; one left → it wins; after turn 20 → the highest equity × valuation wins.

  /** A small deterministic generator for the random plans (mulberry32). */
  const random = (seed: number) => {
    let a = seed >>> 0;
    return (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** A plausible but careless plan. Illegal parts are fixed up or dropped by the engine at no cost (step 1). */
  const randomPlan = (company: Company, rand: () => number): Plan => {
    const raisePercent = rand() < 0.3 ? [10, 20, 30][Math.floor(rand() * 3)] : 0;
    const layoffs = rand() < 0.06 && company.headcount > 2 ? 1 : 0;
    const available = Math.max(0, company.headcount - layoffs - (raisePercent > 0 ? 1 : 0));
    const allocation = { product: 0, growth: 0, recruiting: 0 };
    for (let i = 0; i < available; i++) {
      const roll = rand();
      if (roll < 0.5) allocation.product++;
      else if (roll < 0.85) allocation.growth++;
      else allocation.recruiting++;
    }
    const others = ALL.filter((id) => id !== company.id);
    return {
      allocation,
      marketing: 25_000 * Math.floor(rand() * 4),
      price: (["budget", "standard", "premium"] as const)[Math.floor(rand() * 3)],
      raisePercent,
      poachTarget: rand() < 0.1 ? others[Math.floor(rand() * others.length)] : null,
      layoffs,
      hireLimit: rand() < 0.5 ? null : Math.floor(rand() * 3),
    };
  };

  /** Where a random game starts: the plain new game, or a position that brings the endings closer. */
  const opening = (variant: number, rand: () => number): GameState => {
    let state = newGame();
    if (variant === 1) {
      // Investors hold every board from turn 1.
      for (const id of ALL) state = withCompany(state, id, { investorSeats: 3 });
    } else if (variant === 2) {
      // Everyone launched, big and rich, close to an IPO; investors hold the boards.
      for (const id of ALL) {
        const users = 150_000 + Math.floor(rand() * 110_000);
        state = launchedCompany(state, id, { users, quality: 60, cash: 2_000_000, investorSeats: 3 });
      }
    } else if (variant === 3) {
      // Three turns from the end, everyone launched; investors hold the boards.
      for (const id of ALL) {
        const users = 5_000 + Math.floor(rand() * 60_000);
        state = launchedCompany(state, id, { users, cash: 1_500_000, investorSeats: 3 });
      }
      state = atTurn(state, 18);
    }
    return state;
  };

  const stake = (report: CompanyReport): number => report.equity * report.valuation;

  /** Re-derive this turn's endings from its reports and compare with the engine. */
  const checkTurn = (before: GameState, after: GameState, log: TurnLog, seed: number, label: string): void => {
    const turn = before.turn;
    expect(log.turn, label).toBe(turn);
    const reports: CompanyReport[] = [];
    for (const company of before.companies) {
      const report = log.companies[company.id];
      // A report for every company that was in the game, none for one that was already out.
      expect(report === null, `${label}: report of company ${company.id}`).toBe(company.out !== null);
      if (report) reports.push(report);
      // Out is for good.
      if (company.out) expect(after.companies[company.id], label).toEqual(company);
    }

    // Users are conserved (ruling 1): companies' users plus the waiting pool grow by exactly the new arrivals.
    expect(usersInSystem(after), `${label}: users conserved`).toBe(usersInSystem(before) + log.market.newUsers);
    // Candidates = 6 + event bonus + staff freed last turn + everyone laid off this turn (ruling 9).
    const laidOff = reports.reduce((sum, report) => sum + report.headcount.laidOff, 0);
    expect(log.hiring.candidates, `${label}: candidates`).toBe(6 + before.modifiers.extraCandidates + before.freedPeople + laidOff);

    // 11. IPO.
    const listed = reports.filter((report) => report.users.end >= 250_000 && report.revenue >= report.costs.total);
    if (listed.length > 0) {
      const best = Math.max(...listed.map((report) => report.valuation));
      const top = listed.filter((report) => report.valuation === best);
      expect(after.outcome?.kind, `${label}: IPO`).toBe("ipo");
      expect(after.outcome?.turn, label).toBe(turn);
      if (top.length === 1) expect(after.outcome?.winnerId, `${label}: IPO winner`).toBe(top[0].companyId);
      expect(after.turn, label).toBe(turn);
      return;
    }

    // 12. Bankruptcy, then the board vote.
    let freed = 0;
    for (const report of reports) {
      const id = report.companyId;
      const company = after.companies[id];
      const bankrupt = report.cash.end < 0;
      const burn = report.costs.total - report.revenue;
      expect(report.profitable, `${label}: profitable ${id}`).toBe(burn <= 0);
      let fired = false;
      if (!bankrupt) {
        // Runway = cash ÷ (costs − revenue), no limit when the quarter was profitable (ruling 8).
        if (burn <= 0) expect(report.runway, `${label}: runway ${id}`).toBeNull();
        else expect(report.runway, `${label}: runway ${id}`).toBeCloseTo(report.cash.end / burn, 6);
        if (company.investorSeats > company.founderSeats) {
          const usersFell = report.users.end < report.users.open;
          const lowRunway = burn > 0 && report.cash.end / burn < 2;
          fired = (usersFell || lowRunway) && boardRoll(seed, turn, id) < 0.3;
          expect(report.board, `${label}: board ${id}`).toEqual({ usersFell, lowRunway, fired });
        } else {
          expect(report.board, `${label}: board ${id}`).toBeNull();
        }
      }
      const reason = bankrupt ? "bankrupt" : fired ? "fired" : null;
      expect(report.out, `${label}: out ${id}`).toBe(reason);
      if (reason) {
        expect(company.out, `${label}: exit ${id}`).toMatchObject({ turn, reason, users: report.users.end });
        expect(company.users, label).toBe(0);
        expect(company.headcount, label).toBe(0);
        // Its staff: who it started with, less layoffs and people poached away, plus hires and people poached in.
        const h = report.headcount;
        freed += h.start - h.laidOff - h.poachedOut + h.hired + h.poachedIn;
      } else {
        expect(company.out, `${label}: still in ${id}`).toBeNull();
      }
    }
    expect(after.freedPeople, `${label}: freed staff`).toBe(freed);

    // 13. Last company standing, then the turn-20 ranking.
    const left = survivors(after);
    if (left.length === 0) {
      expect(after.outcome, label).toEqual({ kind: "wipeout", turn, winnerId: null });
    } else if (left.length === 1) {
      expect(after.outcome, label).toEqual({ kind: "lastStanding", turn, winnerId: left[0] });
    } else if (turn === 20) {
      const ranked = reports.filter((report) => left.includes(report.companyId));
      const best = Math.max(...ranked.map(stake));
      const top = ranked.filter((report) => stake(report) === best);
      expect(after.outcome?.kind, label).toBe("turnLimit");
      expect(after.outcome?.turn, label).toBe(20);
      if (top.length === 1) expect(after.outcome?.winnerId, `${label}: turn-20 winner`).toBe(top[0].companyId);
    } else {
      expect(after.outcome, label).toBeNull();
    }
    expect(log.outcome, label).toEqual(after.outcome);
    expect(after.turn, label).toBe(after.outcome ? turn : turn + 1);
    if (after.outcome) expect(log.nextEvent, label).toBeNull();
  };

  it("300 random games: every turn's endings, firings, exits and releases follow the design", () => {
    const endings: Record<string, number> = { ipo: 0, lastStanding: 0, turnLimit: 0, wipeout: 0 };
    let firings = 0;
    let bankruptcies = 0;
    for (let game = 0; game < 300; game++) {
      const seed = 5_000 + game;
      const rand = random(seed);
      let state = opening(game % 4, rand);
      let turns = 0;
      while (state.outcome === null) {
        const label = `game ${game} (seed ${seed}) turn ${state.turn}`;
        const plans = state.companies.map((company) => randomPlan(company, rand));
        const { state: next, log } = resolveTurn(state, plans, seed, DESIGN);
        checkTurn(state, next, log, seed, label);
        for (const report of log.companies) {
          if (report?.out === "fired") firings++;
          if (report?.out === "bankrupt") bankruptcies++;
        }
        state = next;
        turns++;
        // "A game lasts up to 20 turns."
        expect(turns, label).toBeLessThanOrEqual(20);
      }
      expect(state.turn).toBeLessThanOrEqual(20);
      expect(state.outcome.turn).toBe(state.turn);
      endings[state.outcome.kind]++;
    }
    // The random games must actually reach the endings they are meant to check.
    expect(endings.ipo).toBeGreaterThan(0);
    expect(endings.lastStanding).toBeGreaterThan(0);
    expect(endings.turnLimit).toBeGreaterThan(0);
    expect(firings).toBeGreaterThan(0);
    expect(bankruptcies).toBeGreaterThan(0);
  });
});
