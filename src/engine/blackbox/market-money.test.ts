// Black-box tests for the market and money rules, written from docs/turn-based-design.md alone (the
// implementation was not read). Expected numbers are worked out by hand in the comment beside each
// assertion or in the name of the table row.
//
// The design's starting numbers are pinned in DESIGN below (they were the numbers of src/config.ts when
// this was written), so these tests check the rules themselves and stay valid while the numbers are
// tuned; the "tuning" block checks that the engine reads each number from the config it is given.
//
// How scenarios are kept exact:
//  - One person on Recruiting with "hire at most 0" does no Product or Growth work (effective work
//    1^0.9 = 1): quality only decays (start − 2) and the quarter costs one $40K salary.
//  - Quality 52 decays to 50, so churn = 12% − 0.08 × 50 = 8%.
//  - Only the companies named in onlyActive(...) are in the game; a lone launched company takes the
//    whole pool, so it ends on its starting users + new users + users carried in.
//  - Events are off (chance 0) unless a test is about one.

import { describe, expect, it } from "vitest";
import { raiseBlocker } from "../index";
import { firstFloat, STREAM } from "../rng";
import {
  BLITZ,
  BOOT,
  HUMAN,
  INCUMBENT,
  launchedCompany,
  newGame,
  onlyActive,
  reportFor,
  resolve,
  seedWhere,
  usersInSystem,
  withCompany,
  withState,
} from "../testKit";
import type {
  Company,
  CompanyReport,
  CostBreakdown,
  EventCard,
  EventEffect,
  GameState,
  Plan,
  PriceTier,
  RulesConfig,
  TargetRule,
} from "../types";

// ── The design's numbers ──

const card = (id: string, effects: EventEffect[], target?: TargetRule): EventCard => ({
  id,
  name: id,
  text: id,
  weight: 1,
  effects,
  ...(target ? { target } : {}),
});

/** The design's starting deck. */
const DECK: readonly EventCard[] = [
  card("funding-winter", [{ kind: "fundingClimate", multiplier: 0.6, turns: 3 }]),
  card("hot-market", [{ kind: "fundingClimate", multiplier: 1.4, turns: 2 }]),
  card("viral-moment", [{ kind: "targetHype", delta: 20 }], { pick: "random" }),
  card("burnout", [{ kind: "targetHeadcount", delta: -1 }], { pick: "random", minHeadcount: 2 }),
  card("press-feature", [{ kind: "targetHype", delta: 15 }], { pick: "highestQuality", launched: true }),
  card(
    "security-breach",
    [
      { kind: "targetUsers", fraction: 0.1 },
      { kind: "targetHype", delta: -10 },
    ],
    { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
  ),
  card("talent-glut", [{ kind: "candidates", extra: 4 }]),
  card("market-boom", [{ kind: "newUsers", multiplier: 1.5 }]),
  card("ad-prices-spike", [{ kind: "marketingEffect", multiplier: 0.5 }]),
];

/** The design's starting numbers, with events switched off (chance 0). */
const DESIGN: RulesConfig = {
  game: { maxTurns: 20 },
  ipo: { users: 250_000 },
  archetypes: {
    startup: {
      cash: 500_000,
      headcount: 3,
      users: 0,
      quality: 0,
      hype: 10,
      founderEquity: 1,
      founderSeats: 2,
      investorSeats: 0,
      workExponent: 0.9,
      catchUpMultiplier: 1,
      allocation: { product: 3, growth: 0, recruiting: 0 },
    },
    incumbent: {
      cash: 3_000_000,
      headcount: 8,
      users: 10_000,
      quality: 30,
      hype: 20,
      founderEquity: 0.6,
      founderSeats: 2,
      investorSeats: 1,
      workExponent: 0.8,
      catchUpMultiplier: 1.5,
      allocation: { product: 5, growth: 2, recruiting: 1 },
    },
  },
  salary: 40_000,
  hiring: { candidatesPerTurn: 6, capacityPerWork: 2, fee: 10_000 },
  poach: { cost: 50_000, baseChance: 0.5, chancePerHypePoint: 0.005, minChance: 0.1, maxChance: 0.9, minTargetHeadcount: 2 },
  layoff: { severance: 20_000, hype: -10 },
  quality: { gainPerWork: 5, decay: 2, launchAt: 10 },
  market: { newUsersTurn1: 20_000, growthPerTurn: 0.1 },
  pull: { growthCoefficient: 0.3, marketingCoefficient: 0.5, marketingStep: 25_000, maxMarketing: 5_000_000 },
  priceTiers: {
    budget: { price: 2, pullFactor: 1.25, churnDelta: -0.02 },
    standard: { price: 3, pullFactor: 1, churnDelta: 0 },
    premium: { price: 5, pullFactor: 0.75, churnDelta: 0.04 },
  },
  churn: { base: 0.12, perQualityPoint: 0.0008, min: 0.02 },
  raise: { minUsers: 1_000, cooldownTurns: 2, options: [10, 20, 30] },
  valuation: { perUser: 150 },
  board: { fireChance: 0.3, runwayTurns: 2 },
  hype: { decay: 0.2, launch: 15, raise: 10, growth: 5, growthThreshold: 0.25 },
  // Not a rule: what the planning panel's projection assumes about rivals. Resolving a turn never reads it.
  projection: { rivalPullGuess: 1.6, rivalHireGuess: 1 },
  events: { firstTurn: 3, chance: 0, deck: DECK },
};

/** The design's numbers with events on: from turn 3, each turn has this chance of a card from this deck. */
const eventsOn = (deck: readonly EventCard[], chance = 1): RulesConfig => ({ ...DESIGN, events: { firstTurn: 3, chance, deck } });

/** A deck holding only this card of the design's deck, so that it is the one drawn. */
const only = (id: string): readonly EventCard[] => DECK.filter((each) => each.id === id);

/** The design's numbers with a different number of new users on turn 1. */
const marketOf = (newUsersTurn1: number): RulesConfig => ({ ...DESIGN, market: { ...DESIGN.market, newUsersTurn1 } });

// ── Fixtures ──

/** A team of n whose last close also had n people, so nobody looks lost to an event. */
const team = (n: number): Partial<Company> => ({ headcount: n, headcountAtLastClose: n });

/** A complete plan: people per department, everything else off unless patched. */
const on = (product: number, growth: number, recruiting: number, patch: Partial<Plan> = {}): Plan => ({
  allocation: { product, growth, recruiting },
  marketing: 0,
  price: "standard",
  raisePercent: 0,
  poachTarget: null,
  layoffs: 0,
  hireLimit: 0,
  ...patch,
});

/** No Product or Growth work: everyone on Recruiting, hiring nobody. */
const idle = (people: number, patch: Partial<Plan> = {}): Plan => on(0, 0, people, patch);

/** HUMAN alone in the game: launched, quality 52 (50 after the decay), 10,000 users, hype 20, one person, $500K. */
const solo = (patch: Partial<Company> = {}, config: RulesConfig = DESIGN): GameState =>
  onlyActive(launchedCompany(newGame(config), HUMAN, { quality: 52, hype: 20, ...team(1), ...patch }), [HUMAN]);

/** HUMAN as in solo() plus BLITZ, a rich bystander that never launches (plan: BYSTANDER), so the game goes on. */
const withBystander = (patch: Partial<Company> = {}, config: RulesConfig = DESIGN): GameState => {
  const state = launchedCompany(newGame(config), HUMAN, { quality: 52, hype: 20, ...team(1), ...patch });
  return onlyActive(withCompany(state, BLITZ, { cash: 100_000_000 }), [HUMAN, BLITZ]);
};
const BYSTANDER = idle(3);

/** HUMAN and BLITZ launched side by side, nobody else. Defaults: quality 52, hype 0, no users, one person each. */
const pair = (human: Partial<Company> = {}, blitz: Partial<Company> = {}): GameState => {
  const base = { quality: 52, hype: 0, users: 0, ...team(1) };
  const state = launchedCompany(newGame(DESIGN), HUMAN, { ...base, ...human });
  return onlyActive(launchedCompany(state, BLITZ, { ...base, ...blitz }), [HUMAN, BLITZ]);
};

/** The three startups launched side by side (hype 0, no users, one person each) with these starting qualities. */
const trio = (qualities: readonly number[]): GameState => {
  let state = newGame(DESIGN);
  [HUMAN, BLITZ, BOOT].forEach((id, index) => {
    state = launchedCompany(state, id, { quality: qualities[index], hype: 0, users: 0, ...team(1) });
  });
  return onlyActive(state, [HUMAN, BLITZ, BOOT]);
};
const TRIO_IDLE = { [HUMAN]: idle(1), [BLITZ]: idle(1), [BOOT]: idle(1) };

type Plans = Readonly<Record<number, Partial<Plan>>>;
type Turn = ReturnType<typeof resolve>;

/** Resolve one turn with the design's numbers; events off and seed 1 unless given. */
const play = (state: GameState, plans: Plans, config: RulesConfig = DESIGN, seed = 1): Turn => resolve(state, plans, seed, config);

/** HUMAN's report for one turn in which only HUMAN plans. */
const quarter = (state: GameState, plan: Partial<Plan>, config: RulesConfig = DESIGN): CompanyReport =>
  reportFor(play(state, { [HUMAN]: plan }, config), HUMAN);

const wonBy = (turn: Turn, ids: readonly number[]): number[] => ids.map((id) => reportFor(turn, id).users.won);

/** The five cost lines and their total. */
const costs = (salaries: number, other: Partial<CostBreakdown> = {}): CostBreakdown => {
  const lines = { salaries, marketing: 0, hiring: 0, poaching: 0, severance: 0, ...other };
  return { ...lines, total: lines.salaries + lines.marketing + lines.hiring + lines.poaching + lines.severance };
};

// ── The market: new users ──

describe("market: new users", () => {
  it("20,000 on turn 1 and a tenth more each turn", () => {
    // 20,000 → 22,000 → 24,200 → 26,620 → 29,282 (each ×1.1).
    let state = newGame(DESIGN);
    for (const expected of [20_000, 22_000, 24_200, 26_620, 29_282]) {
      const turn = play(state, {});
      expect(turn.log.market.newUsers).toBe(expected);
      state = turn.state;
    }
  });

  it("stay whole and within one user of 20,000 × 1.1^(turn − 1) through turn 20", () => {
    // Not whole from turn 6 (32,210.2); the design does not say how to round, so either neighbour passes.
    for (let turn = 6; turn <= 20; turn++) {
      const { newUsers } = play(withState(newGame(DESIGN), { turn }), {}).log.market;
      expect(Number.isInteger(newUsers)).toBe(true);
      expect(Math.abs(newUsers - 20_000 * 1.1 ** (turn - 1))).toBeLessThan(1);
    }
  });

  it("a market boom makes them ×1.5 for that turn only", () => {
    // Turn 1: 20,000 × 1.5 = 30,000. Turn 2: 22,000 again.
    const boom = withState(newGame(DESIGN), {
      event: { cardId: "market-boom", targetId: null },
      modifiers: { newUsers: 1.5, marketing: 1, extraCandidates: 0 },
    });
    const first = play(boom, {});
    expect(first.log.market.newUsers).toBe(30_000);
    expect(play(first.state, {}).log.market.newUsers).toBe(22_000);
  });
});

// ── The market: the pool and its split ──

describe("market: the pool and how it is split", () => {
  it("a lone launched company takes the whole pool, its own churned users included: the quarter by hand", () => {
    const turn = play(solo(), { [HUMAN]: idle(1) });
    const report = reportFor(turn, HUMAN);
    expect(report.notes).toEqual([]);
    // Quality 52 + 0 − 2 = 50. Churn = 12% − 0.08 × 50 = 8% of 10,000 = 800.
    expect(report.quality.end).toBe(50);
    // Pool = 20,000 new + 800 churned = 20,800, all of it won: 10,000 − 800 + 20,800 = 30,000.
    expect(turn.log.market).toEqual({ newUsers: 20_000, carriedIn: 0, churned: 800, pool: 20_800, carriedOut: 0 });
    expect(report.users).toMatchObject({ open: 10_000, lostToEvent: 0, churned: 800, won: 20_800, end: 30_000 });
    // Pull = 50 × 1 × 1 × (1 + 20/100) = 60.
    expect(report.users.pull).toBeCloseTo(60, 6);
    expect(report.users.share).toBeCloseTo(1, 9);
    // Revenue = 30,000 × $3 = $90,000. Costs = one $40K salary. Cash = 500,000 + 90,000 − 40,000 = 550,000.
    expect(report.revenue).toBe(90_000);
    expect(report.costs).toEqual(costs(40_000));
    expect(report.cash).toEqual({ start: 500_000, end: 550_000 });
    expect(report.profitable).toBe(true);
    expect(report.runway).toBeNull();
    // Hype = 20 × 0.8 + 5 (users +200%) = 21. Valuation = 30,000 × $150 × 1.21 = $5,445,000.
    expect(report.hype.end).toBeCloseTo(21, 6);
    expect(report.valuation).toBeCloseTo(5_445_000, 0);
    // The company's record carries the quarter forward.
    const company = turn.state.companies[HUMAN];
    expect(company).toMatchObject({ users: 30_000, usersAtLastClose: 30_000, cash: 550_000, lastRevenue: 90_000, lastCosts: 40_000 });
    expect(company.lastQuarter).toMatchObject({ usersAtOpen: 10_000, usersLostToEvent: 0, usersChurned: 800, usersWon: 20_800, joined: 0, left: 0 });
    expect(usersInSystem(turn.state)).toBe(30_000);
  });

  it("two launched companies split the pool in proportion to pull", () => {
    // HUMAN: quality 50, hype 0, Standard: pull 50; churn 8% of 10,000 = 800.
    // BLITZ: quality 27 → 25: pull 25; churn = 12% − 0.08 × 25 = 10% of 5,000 = 500.
    const turn = play(pair({ users: 10_000 }, { quality: 27, users: 5_000 }), { [HUMAN]: idle(1), [BLITZ]: idle(1) });
    const human = reportFor(turn, HUMAN);
    const blitz = reportFor(turn, BLITZ);
    expect(human.users.pull).toBeCloseTo(50, 6);
    expect(blitz.users.pull).toBeCloseTo(25, 6);
    // Pool = 20,000 + 800 + 500 = 21,300: 50/75 of it = 14,200 and 25/75 = 7,100.
    expect(turn.log.market).toEqual({ newUsers: 20_000, carriedIn: 0, churned: 1_300, pool: 21_300, carriedOut: 0 });
    // HUMAN: 10,000 − 800 + 14,200 = 23,400. BLITZ: 5,000 − 500 + 7,100 = 11,600.
    expect(human.users).toMatchObject({ churned: 800, won: 14_200, end: 23_400 });
    expect(blitz.users).toMatchObject({ churned: 500, won: 7_100, end: 11_600 });
    expect(human.users.share).toBeCloseTo(2 / 3, 6);
    expect(usersInSystem(turn.state)).toBe(35_000); // 15,000 before + 20,000 new
  });

  it.each([
    [13, [6, 4, 3]], //  shares 6.5, 3.9, 2.6: whole parts 6 + 3 + 2, the 2 left go to the .9 and the .6
    [7, [4, 2, 1]], //   shares 3.5, 2.1, 1.4: whole parts 3 + 2 + 1, the 1 left goes to the .5
  ])("largest remainder: %i users over pulls 50 : 30 : 20 come out as %j", (pool, expected) => {
    // Qualities 52/32/22 decay to 50/30/20. (Rounding each share of 13 would hand out 7 + 4 + 3 = 14.)
    const turn = play(trio([52, 32, 22]), TRIO_IDLE, marketOf(pool));
    expect(wonBy(turn, [HUMAN, BLITZ, BOOT])).toEqual(expected);
    expect(turn.state.carryOverUsers).toBe(0);
  });

  it.each<[string, Plan, Plan, Partial<Company>, number[]]>([
    ["quality 50 against 25 (13,333.33 and 6,666.67, the last user to the .67)", idle(1), idle(1), { quality: 27 }, [13_333, 6_667]],
    ["Budget against Premium, 62.5 : 37.5", idle(1, { price: "budget" }), idle(1, { price: "premium" }), {}, [12_500, 7_500]],
    ["$225K of marketing against none, 125 : 50 (14,285.71 and 5,714.29)", idle(1, { marketing: 225_000 }), idle(1), {}, [14_286, 5_714]],
    ["one person on Growth against none, 65 : 50 (11,304.35 and 8,695.65)", on(0, 1, 0), idle(1), {}, [11_304, 8_696]],
  ])("two rivals split 20,000 new users by pull: %s", (_label, human, blitz, blitzCompany, expected) => {
    expect(wonBy(play(pair({}, blitzCompany), { [HUMAN]: human, [BLITZ]: blitz }), [HUMAN, BLITZ])).toEqual(expected);
  });

  it.each([
    [20_000, [6_666, 6_667, 6_667]], //  6,666.67 each: two companies get the two users left (which two is not defined)
    [2, [0, 1, 1]],
    [1, [0, 0, 1]],
    [0, [0, 0, 0]],
  ])("three equal pulls share a pool of %i as %j in some order: nobody is created or lost", (pool, expected) => {
    const turn = play(trio([52, 52, 52]), TRIO_IDLE, marketOf(pool));
    expect(wonBy(turn, [HUMAN, BLITZ, BOOT]).sort((a, b) => a - b)).toEqual(expected);
    expect(usersInSystem(turn.state)).toBe(pool);
    for (const id of [HUMAN, BLITZ, BOOT]) expect(Number.isFinite(reportFor(turn, id).users.share)).toBe(true);
  });

  it("a company launching this turn takes part in this turn's split; an unlaunched one gets nobody", () => {
    // HUMAN: launched, quality 50, hype 0: pull 50.
    // BLITZ: not launched, quality 8, one person on Product: 8 + 5 × 1 × (1 − 8/100) − 2 = 10.6, launched.
    //        Pull = 10.6 × (1 + 10/100) = 11.66, on start-of-turn hype (not 10.6 × 1.23 after the launch's +15).
    // BOOT:  not launched, quality 8, no Product work: 8 − 2 = 6.
    let state = launchedCompany(newGame(DESIGN), HUMAN, { quality: 52, hype: 0, users: 0, ...team(1) });
    state = withCompany(withCompany(state, BLITZ, { quality: 8, ...team(1) }), BOOT, { quality: 8, ...team(1) });
    const turn = play(onlyActive(state, [HUMAN, BLITZ, BOOT]), { [HUMAN]: idle(1), [BLITZ]: on(1, 0, 0), [BOOT]: idle(1) });
    const blitz = reportFor(turn, BLITZ);
    expect(blitz.quality.end).toBeCloseTo(10.6, 3);
    expect(blitz.quality.launchedNow).toBe(true);
    expect(blitz.users.pull).toBeCloseTo(11.66, 3);
    expect(reportFor(turn, BOOT).quality.launchedNow).toBe(false);
    // 20,000 over 50 : 11.66 = 16,217.97 and 3,782.03: whole parts 19,999, the last user to the .97.
    expect(wonBy(turn, [HUMAN, BLITZ, BOOT])).toEqual([16_218, 3_782, 0]);
    // BLITZ's hype = 10 × 0.8 + 15 (launch) = 23: no growth bonus without users at the last close.
    expect(blitz.hype).toMatchObject({ launch: 15, growth: 0 });
    expect(blitz.hype.end).toBeCloseTo(23, 6);
  });

  it.each([
    [12, true, 20_000, 0], //    12 − 2 = 10: "at 10 or above", launched; pull 10 × 1.1 = 11 takes the pool
    [11.9, false, 0, 20_000], // 9.9: not launched, no users before launch, the pool waits
  ])("a lone product at quality %d before the decay: launched %s, wins %i, %i wait", (quality, launched, won, waiting) => {
    const turn = play(onlyActive(withCompany(newGame(DESIGN), HUMAN, { quality, ...team(1) }), [HUMAN]), { [HUMAN]: idle(1) });
    expect(reportFor(turn, HUMAN).quality.launchedNow).toBe(launched);
    expect(reportFor(turn, HUMAN).users.won).toBe(won);
    expect(reportFor(turn, HUMAN).revenue).toBe(won * 3);
    expect(turn.state.carryOverUsers).toBe(waiting);
  });

  it("with nobody launched the pool waits, and joins the next turn's pool", () => {
    const state = onlyActive(withCompany(newGame(DESIGN), HUMAN, { quality: 9.5, ...team(1) }), [HUMAN, BLITZ]);
    // Turn 1, no Product work: 9.5 − 2 = 7.5. Nobody is launched; the 20,000 new users wait.
    const first = play(state, { [HUMAN]: idle(1), [BLITZ]: BYSTANDER });
    expect(first.state.companies[HUMAN].launched).toBe(false);
    expect(first.log.market).toEqual({ newUsers: 20_000, carriedIn: 0, churned: 0, pool: 20_000, carriedOut: 20_000 });
    expect(first.state.carryOverUsers).toBe(20_000);
    // Turn 2, one person on Product: 7.5 + 5 × 1 × (1 − 7.5/100) − 2 = 10.125: launched, in this turn's market.
    // Pool = 22,000 new + 20,000 that waited = 42,000.
    const second = play(first.state, { [HUMAN]: on(1, 0, 0), [BLITZ]: BYSTANDER });
    expect(reportFor(second, HUMAN).quality.end).toBeCloseTo(10.125, 3);
    expect(second.log.market).toEqual({ newUsers: 22_000, carriedIn: 20_000, churned: 0, pool: 42_000, carriedOut: 0 });
    expect(second.state.companies[HUMAN].users).toBe(42_000);
    expect(second.state.carryOverUsers).toBe(0);
  });

  it("a launched company whose quality has decayed to 0 has no pull: the pool waits", () => {
    // Quality 2 − 2 = 0: pull 0. Churn = 12% of 1,000 = 120, so 880 stay and 20,000 + 120 wait.
    const turn = play(solo({ quality: 2, users: 1_000 }), { [HUMAN]: idle(1) });
    const report = reportFor(turn, HUMAN);
    expect(report.users).toMatchObject({ churned: 120, won: 0, end: 880, pull: 0 });
    expect(Number.isFinite(report.users.share)).toBe(true);
    expect(turn.log.market).toEqual({ newUsers: 20_000, carriedIn: 0, churned: 120, pool: 20_120, carriedOut: 20_120 });
    expect(turn.state.carryOverUsers).toBe(20_120);
    expect(turn.state.companies[HUMAN].launched).toBe(true); // it stays launched
    expect(usersInSystem(turn.state)).toBe(21_000); // 1,000 before + 20,000 new
  });

  it("a busy quarter for two rivals on different price tiers, by hand", () => {
    // HUMAN: quality 50 → 48, 25,000 users, hype 5, Premium, $100K marketing.
    // BLITZ: quality 25 → 23, 12,500 users, hype 5, Budget.
    const turn = play(pair({ quality: 50, users: 25_000, hype: 5 }, { quality: 25, users: 12_500, hype: 5 }), {
      [HUMAN]: idle(1, { price: "premium", marketing: 100_000 }),
      [BLITZ]: idle(1, { price: "budget" }),
    });
    const human = reportFor(turn, HUMAN);
    const blitz = reportFor(turn, BLITZ);
    // Churn. HUMAN: 12% − 0.08 × 48 + 4 = 12.16% of 25,000 = 3,040. BLITZ: 12% − 0.08 × 23 − 2 = 8.16% of 12,500 = 1,020.
    // Pull. HUMAN: 48 × (1 + 0.5 × √4) × 0.75 × 1.05 = 75.6. BLITZ: 23 × 1.25 × 1.05 = 30.1875.
    expect(human.users.pull).toBeCloseTo(75.6, 6);
    expect(blitz.users.pull).toBeCloseTo(30.1875, 6);
    // Pool = 20,000 + 3,040 + 1,020 = 24,060. 75.6 : 30.1875 = 288 : 115, so 24,060 × 288/403 = 17,194.24
    // and 24,060 × 115/403 = 6,865.76: whole parts 24,059, the last user to the .76.
    expect(turn.log.market.pool).toBe(24_060);
    // HUMAN: 25,000 − 3,040 + 17,194 = 39,154. BLITZ: 12,500 − 1,020 + 6,866 = 18,346.
    expect(human.users).toMatchObject({ churned: 3_040, won: 17_194, end: 39_154 });
    expect(blitz.users).toMatchObject({ churned: 1_020, won: 6_866, end: 18_346 });
    // HUMAN: revenue 39,154 × $5 = $195,770 against 40,000 + 100,000: profitable. Cash 500,000 + 55,770.
    expect(human).toMatchObject({ revenue: 195_770, profitable: true, runway: null, cash: { start: 500_000, end: 555_770 } });
    // BLITZ: revenue 18,346 × $2 = $36,692 against 40,000: a $3,308 loss. Cash 496,692; runway 496,692 ÷ 3,308.
    expect(blitz).toMatchObject({ revenue: 36_692, profitable: false, cash: { start: 500_000, end: 496_692 } });
    expect(blitz.runway).toBeCloseTo(496_692 / 3_308, 4);
    // Hype, both: 5 × 0.8 + 5 (HUMAN +56.6%, BLITZ +46.8%) = 9.
    expect(human.hype.end).toBeCloseTo(9, 6);
    expect(blitz.hype.end).toBeCloseTo(9, 6);
    // Valuation. HUMAN: 39,154 × $150 × 1.09 = $6,401,679. BLITZ: 18,346 × $150 × 1.09 = $2,999,571.
    expect(human.valuation).toBeCloseTo(6_401_679, 0);
    expect(blitz.valuation).toBeCloseTo(2_999_571, 0);
    expect(usersInSystem(turn.state)).toBe(57_500); // 37,500 before + 20,000 new
  });

  it("turn 1 of a new game with everyone's default plan, by hand", () => {
    const turn = play(newGame(DESIGN), {});
    // Startups: 3 people on Product, effective work 3^0.9 = 2.687875.
    //   Quality = 0 + 5 × 2.687875 − 2 = 11.439377: launched. Pull = 11.439377 × (1 + 10/100) = 12.583315.
    // Incumbent: 8 people as 5/2/1, effective work 8^0.8 = 5.278032: Product 3.298770, Growth 1.319508,
    //   Recruiting 0.659754. No rival is launched at the start of the turn, so no catch-up bonus.
    //   Quality = 30 + 5 × 3.298770 × (1 − 30/100) − 2 = 39.545694.
    //   Churn = 12% − 0.08 × 39.545694 = 8.836344% of 10,000 = 883.63: 884 whole users.
    //   Pull = 39.545694 × (1 + 0.3 × 1.319508) × (1 + 20/100) = 66.239941.
    // Pool = 20,000 + 884 = 20,884 over 3 × 12.583315 + 66.239941 = 103.989885:
    //   Incumbent 13,302.78, each startup 2,527.07: whole parts 20,883, the last user to the .78.
    for (const id of [HUMAN, BLITZ, BOOT]) {
      const report = reportFor(turn, id);
      expect(report.quality.end).toBeCloseTo(11.439377, 3);
      expect(report.users.pull).toBeCloseTo(12.583315, 3);
      // Revenue 2,527 × $3 = $7,581; costs 3 × $40K; cash 500,000 + 7,581 − 120,000 = 387,581.
      expect(report).toMatchObject({ users: { won: 2_527, end: 2_527 }, revenue: 7_581, cash: { end: 387_581 }, profitable: false });
      expect(report.costs).toEqual(costs(120_000));
      // Runway = 387,581 ÷ (120,000 − 7,581) = 3.4476. Hype = 10 × 0.8 + 15 = 23.
      expect(report.runway).toBeCloseTo(3.4476, 3);
      expect(report.hype.end).toBeCloseTo(23, 6);
      // Valuation = 2,527 × $150 × 1.23 = 466,231.5.
      expect(Math.abs(report.valuation - 466_231.5)).toBeLessThanOrEqual(1);
    }
    const incumbent = reportFor(turn, INCUMBENT);
    expect(incumbent.quality.end).toBeCloseTo(39.545694, 3);
    expect(incumbent.users.pull).toBeCloseTo(66.239941, 3);
    // 10,000 − 884 + 13,303 = 22,419 users; revenue 22,419 × $3 = $67,257.
    expect(incumbent).toMatchObject({ users: { churned: 884, won: 13_303, end: 22_419 }, revenue: 67_257 });
    // Hiring capacity = 2 × 0.659754, rounded = 1 hire. Costs = 8 × $40K + $10K. Cash = 3,000,000 + 67,257 − 330,000.
    expect(incumbent.costs).toEqual(costs(320_000, { hiring: 10_000 }));
    expect(incumbent.cash.end).toBe(2_737_257);
    // Hype = 20 × 0.8 + 5 (users +124%) = 21.
    expect(incumbent.hype.end).toBeCloseTo(21, 6);
    expect(usersInSystem(turn.state)).toBe(30_000);
  });
});

// ── Users are conserved (ruling 1) ──

describe("market: users are conserved when companies go out or are breached", () => {
  /** HUMAN (10,000 users, pull 50) and BLITZ (5,000 users, pull 25, $5,000) as in the 2 : 1 split; BOOT idles. */
  const rivals = (human: Partial<Company> = {}): GameState => {
    let state = launchedCompany(newGame(DESIGN), HUMAN, { quality: 52, hype: 0, users: 10_000, ...team(1), ...human });
    state = launchedCompany(state, BLITZ, { quality: 27, hype: 0, users: 5_000, cash: 5_000, ...team(1) });
    return onlyActive(state, [HUMAN, BLITZ, BOOT]);
  };

  it("a bankrupt company's users wait for the next turn's pool", () => {
    // HUMAN ends on 23,400, BLITZ on 11,600. BLITZ: 5,000 + 11,600 × $3 − 40,000 = −$200: bankrupt.
    const plans = { [HUMAN]: idle(1), [BLITZ]: idle(1), [BOOT]: BYSTANDER };
    const first = play(rivals(), plans);
    expect(reportFor(first, BLITZ)).toMatchObject({ revenue: 34_800, cash: { end: -200 }, out: "bankrupt" });
    // Its users leave it and wait; they are not handed out in the turn it went out.
    expect(first.state.companies[BLITZ]).toMatchObject({ users: 0, out: { turn: 1, reason: "bankrupt", users: 11_600, headcount: 1 } });
    // (Finding MM-4, since fixed: the log's carried-out figure includes them, so it matches the next carried-in.)
    expect(first.log.market.carriedOut).toBe(11_600);
    expect(first.state.carryOverUsers).toBe(11_600);
    expect(usersInSystem(first.state)).toBe(35_000); // 23,400 + 11,600
    // Turn 2: pool = 22,000 new + 11,600 carried in + HUMAN's churn, all to HUMAN: 23,400 + 22,000 + 11,600 = 57,000.
    const second = play(first.state, plans);
    expect(second.log.companies[BLITZ]).toBeNull();
    // HUMAN's quality is 48: churn = 8.16% of 23,400 = 1,909.44 (1,909 or 1,910 whole).
    const churned = reportFor(second, HUMAN).users.churned;
    expect(Math.abs(churned - 1_909.44)).toBeLessThan(1);
    expect(second.log.market).toMatchObject({ newUsers: 22_000, carriedIn: 11_600, pool: 33_600 + churned });
    expect(reportFor(second, HUMAN).users.end).toBe(57_000);
    expect(usersInSystem(second.state)).toBe(57_000);
  });

  it("two companies going bankrupt in the same turn both release their users", () => {
    // HUMAN with three people and $40K: 40,000 + 23,400 × $3 − 120,000 = −$9,800. BLITZ ends on −$200 as above.
    const turn = play(rivals({ cash: 40_000, ...team(3) }), { [HUMAN]: idle(3), [BLITZ]: idle(1), [BOOT]: BYSTANDER });
    expect(reportFor(turn, HUMAN)).toMatchObject({ cash: { end: -9_800 }, out: "bankrupt" });
    expect(reportFor(turn, BLITZ).out).toBe("bankrupt");
    expect(turn.state.carryOverUsers).toBe(35_000); // 23,400 + 11,600
    expect(usersInSystem(turn.state)).toBe(35_000);
  });

  it("an unclaimed pool and a bankrupt company's users wait together", () => {
    // HUMAN: quality 2 → 0, no pull; 1,000 users lose 120, 880 stay. 0 + 880 × $3 − 40,000 = −$37,360: bankrupt.
    // Waiting: the pool of 20,120 that nobody could take + its 880 users = 21,000.
    const state = onlyActive(launchedCompany(newGame(DESIGN), HUMAN, { quality: 2, users: 1_000, cash: 0, ...team(1) }), [HUMAN, BLITZ, BOOT]);
    const plans = { [HUMAN]: idle(1), [BLITZ]: BYSTANDER, [BOOT]: BYSTANDER };
    const first = play(state, plans);
    expect(reportFor(first, HUMAN)).toMatchObject({ cash: { end: -37_360 }, out: "bankrupt" });
    expect(first.state.carryOverUsers).toBe(21_000);
    // Turn 2: still nobody launched. 22,000 new + 21,000 waiting = 43,000 wait on.
    const second = play(first.state, plans);
    expect(second.log.market).toEqual({ newUsers: 22_000, carriedIn: 21_000, churned: 0, pool: 43_000, carriedOut: 43_000 });
    expect(second.state.carryOverUsers).toBe(43_000);
  });

  it("a fired founder's company releases its users like a bankrupt one", () => {
    // HUMAN: investors hold 3 seats to 2. Quality 2 → 0: it wins nobody and loses 12% of 10,000, so users fell
    // and the board votes (30%). BLITZ: pull 50, takes the pool of 20,000 + 1,200.
    let state = launchedCompany(newGame(DESIGN), HUMAN, { quality: 2, hype: 0, investorSeats: 3, cash: 10_000_000, ...team(1) });
    state = onlyActive(launchedCompany(state, BLITZ, { quality: 52, hype: 0, users: 0, ...team(1) }), [HUMAN, BLITZ, BOOT]);
    const plans = { [HUMAN]: idle(1), [BLITZ]: idle(1), [BOOT]: BYSTANDER };
    const seed = seedWhere((s) => firstFloat(s, 1, STREAM.board, HUMAN) < 0.3);
    const fired = play(state, plans, DESIGN, seed);
    expect(reportFor(fired, HUMAN)).toMatchObject({ board: { usersFell: true, lowRunway: false, fired: true }, out: "fired" });
    expect(fired.state.companies[HUMAN]).toMatchObject({ users: 0, out: { turn: 1, reason: "fired", users: 8_800, headcount: 1 } });
    expect(fired.state.carryOverUsers).toBe(8_800);
    expect(usersInSystem(fired.state)).toBe(30_000); // 21,200 + 8,800
    // Next turn they are in the pool: BLITZ ends on 21,200 + 22,000 + 8,800 = 52,000.
    const next = play(fired.state, plans, DESIGN, seed);
    expect(next.log.market.carriedIn).toBe(8_800);
    expect(reportFor(next, BLITZ).users.end).toBe(52_000);
    // With a roll of 0.3 or more the founder stays and nothing is released.
    const kept = play(state, plans, DESIGN, seedWhere((s) => firstFloat(s, 1, STREAM.board, HUMAN) >= 0.3));
    expect(reportFor(kept, HUMAN).board?.fired).toBe(false);
    expect(kept.state.companies[HUMAN].users).toBe(8_800);
    expect(kept.state.carryOverUsers).toBe(0);
  });

  it("users lost to a security breach join the next market split", () => {
    // Turn 2. HUMAN: quality 42 → 40 (under 50, so a breach can hit it), alone in the market: it ends on
    // 10,000 + 22,000 = 32,000 users with hype 20 × 0.8 + 5 = 21. A breach is certain to be revealed for turn 3.
    const plans = { [HUMAN]: idle(1), [BLITZ]: BYSTANDER };
    const second = play(withState(withBystander({ quality: 42 }), { turn: 2 }), plans, eventsOn(only("security-breach")));
    // It takes 10% of 32,000 = 3,200 users and 10 hype. The users wait; they are not gone.
    expect(second.state.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
    expect(second.state.companies[HUMAN]).toMatchObject({ users: 28_800, usersAtLastClose: 32_000 });
    expect(second.state.companies[HUMAN].hype).toBeCloseTo(11, 6);
    expect(second.state.carryOverUsers).toBe(3_200);
    expect(usersInSystem(second.state)).toBe(32_000);
    // Turn 3: 24,200 new + 3,200 from the breach + HUMAN's churn, all to HUMAN: 28,800 + 24,200 + 3,200 = 56,200.
    const third = play(second.state, plans);
    expect(third.log.market).toMatchObject({ newUsers: 24_200, carriedIn: 3_200 });
    expect(reportFor(third, HUMAN).users).toMatchObject({ open: 32_000, lostToEvent: 3_200, end: 56_200 });
  });
});

// ── Pull ──

describe("pull = quality × (1 + 0.3 × Growth work + 0.5 × √(marketing ÷ $25K)) × price factor × (1 + hype/100)", () => {
  // A lone company at quality 50 after the decay, hype 0 unless the row says otherwise.
  it.each<[string, Partial<Company>, Plan, number]>([
    ["nothing but quality: 50 × 1 × 1 × 1", {}, idle(1), 50],
    ["one person on Growth (1^0.9 = 1 unit of work): 50 × (1 + 0.3 × 1)", {}, on(0, 1, 0), 65],
    ["$25K of marketing, √1 = 1: 50 × (1 + 0.5 × 1)", {}, idle(1, { marketing: 25_000 }), 75],
    ["$50K of marketing, √2 = 1.4142: 50 × 1.7071", {}, idle(1, { marketing: 50_000 }), 85.3553],
    ["$100K of marketing, √4 = 2: 50 × 2", {}, idle(1, { marketing: 100_000 }), 100],
    ["$225K of marketing, √9 = 3: 50 × 2.5", {}, idle(1, { marketing: 225_000 }), 125],
    ["Budget: 50 × 1.25", {}, idle(1, { price: "budget" }), 62.5],
    ["Premium: 50 × 0.75", {}, idle(1, { price: "premium" }), 37.5],
    ["hype 20: 50 × 1.2", { hype: 20 }, idle(1), 60],
    ["hype 100: 50 × 2", { hype: 100 }, idle(1), 100],
    ["all four terms: 50 × (1 + 0.3 + 1) × 0.75 × 1.2", { hype: 20 }, on(0, 1, 0, { marketing: 100_000, price: "premium" }), 103.5],
    ["the quality after this turn's work (ruling 6): 40 + 5 × 1 × (1 − 40/100) − 2 = 41", { quality: 40 }, on(1, 0, 0), 41],
  ])("%s", (_label, company, plan, expected) => {
    expect(quarter(solo({ hype: 0, ...company }), plan).users.pull).toBeCloseTo(expected, 3);
  });

  it("uses start-of-turn hype: a raise closing this turn (+10) does not lift this turn's pull", () => {
    // Hype 20, one of two people raising: pull = 50 × 1.2 = 60, though hype ends on 20 × 0.8 + 10 + 5 = 31.
    const report = quarter(solo(team(2)), idle(1, { raisePercent: 20 }));
    expect(report.raise).not.toBeNull();
    expect(report.users.pull).toBeCloseTo(60, 6);
    expect(report.hype.end).toBeCloseTo(31, 6);
  });

  it("'ad prices spike' halves the marketing term (ruling 16)", () => {
    // $100K normally adds 0.5 × √4 = 1; halved it adds 0.5: 50 × 1.5 = 75.
    const spike = withState(solo({ hype: 0 }), {
      event: { cardId: "ad-prices-spike", targetId: null },
      modifiers: { newUsers: 1, marketing: 0.5, extraCandidates: 0 },
    });
    expect(quarter(spike, idle(1, { marketing: 100_000 })).users.pull).toBeCloseTo(75, 6);
  });
});

// ── Churn ──

describe("churn = 12% − 0.08 × quality, +4 points on Premium, −2 on Budget, minimum 2%", () => {
  // The quality in each row is the one after this turn's decay; the company starts 2 points higher.
  it.each<[string, number, PriceTier, number]>([
    ["quality 0: 12%", 2, "standard", 1_200],
    ["quality 10: 12 − 0.8 = 11.2%", 12, "standard", 1_120],
    ["quality 25: 12 − 2 = 10%", 27, "standard", 1_000],
    ["quality 50: 12 − 4 = 8%", 52, "standard", 800],
    ["quality 75: 12 − 6 = 6%", 77, "standard", 600],
    ["quality 98: 12 − 7.84 = 4.16%", 100, "standard", 416],
    ["quality 50 on Premium: 8 + 4 = 12%", 52, "premium", 1_200],
    ["quality 50 on Budget: 8 − 2 = 6%", 52, "budget", 600],
    ["quality 98 on Premium: 4.16 + 4 = 8.16%", 100, "premium", 816],
    ["quality 98 on Budget: 4.16 − 2 = 2.16%, the lowest the design's numbers reach", 100, "budget", 216],
  ])("%s of 10,000 users", (_label, quality, price, expected) => {
    expect(quarter(solo({ quality }), idle(1, { price })).users.churned).toBe(expected);
  });

  it("uses the quality after this turn's work, this turn's price and the users the turn starts with (ruling 6)", () => {
    // Quality 40, one person on Product: 40 + 3 − 2 = 41: 12% − 3.28 = 8.72% of 10,000 = 872 (not 8.8% = 880).
    expect(quarter(solo({ quality: 40 }), on(1, 0, 0)).users.churned).toBe(872);
    // Was on Premium (and its last plan said so), plans Standard: 8% of 10,000.
    const base = solo();
    const wasPremium = withCompany(base, HUMAN, { price: "premium", lastPlan: { ...base.companies[HUMAN].lastPlan, price: "premium" } });
    expect(quarter(wasPremium, idle(1)).users.churned).toBe(800);
    // 10,000 at the last close, 9,000 left after a breach: 8% of 9,000 = 720.
    const breached = withState(solo({ users: 9_000, usersAtLastClose: 10_000 }), { carryOverUsers: 1_000 });
    expect(quarter(breached, idle(1)).users.churned).toBe(720);
  });

  it.each<[string, number, PriceTier, number]>([
    ["7% − 4 = 3%, above the floor", 0.07, "standard", 300],
    ["6% − 4 = 2%, exactly the floor", 0.06, "standard", 200],
    ["5% − 4 = 1%, lifted to 2%", 0.05, "standard", 200],
    ["Budget at 7% − 4 − 2 = 1%, lifted to 2%: the floor comes after the tier", 0.07, "budget", 200],
    ["Premium at 5% − 4 + 4 = 5%, not lifted twice", 0.05, "premium", 500],
  ])("the 2%% minimum, seen with the base rate tuned down: %s", (_label, base, price, expected) => {
    const config = { ...DESIGN, churn: { ...DESIGN.churn, base } };
    expect(quarter(solo({}, config), idle(1, { price }), config).users.churned).toBe(expected);
  });

  it("a fraction of a churned user is settled in whole users", () => {
    // 8% of 9,999 = 799.92. The design does not say how to round; either neighbour passes.
    const { churned } = quarter(solo({ users: 9_999 }), idle(1)).users;
    expect(Number.isInteger(churned)).toBe(true);
    expect(Math.abs(churned - 799.92)).toBeLessThan(1);
  });
});

// ── Revenue and costs ──

describe("money: revenue and the cost lines (ruling 8)", () => {
  it.each<[PriceTier, number]>([
    ["budget", 60_000], //    30,000 × $2
    ["standard", 90_000], //  30,000 × $3
    ["premium", 150_000], //  30,000 × $5
  ])("revenue = end-of-turn users × price: 30,000 users on %s bring $%i", (price, expected) => {
    const report = quarter(solo(), idle(1, { price }));
    expect(report.users.end).toBe(30_000); // 10,000 + 20,000, whatever the churn
    expect(report.revenue).toBe(expected);
  });

  it("salaries are $40K a head and marketing is a cost of the turn it is set in, launched or not", () => {
    // Three people and $100K: 120,000 + 100,000. Cash = 500,000 + 90,000 − 220,000 = 370,000.
    const report = quarter(solo(team(3)), idle(3, { marketing: 100_000 }));
    expect(report.costs).toEqual(costs(120_000, { marketing: 100_000 }));
    expect(report.cash.end).toBe(370_000);
    // Not launched (quality 0, nobody on Product): no users, no revenue, but 3 × $40K + $50K all the same.
    const unlaunched = quarter(onlyActive(newGame(DESIGN), [HUMAN]), idle(3, { marketing: 50_000 }));
    expect(unlaunched).toMatchObject({ users: { won: 0 }, revenue: 0, cash: { end: 330_000 } });
    expect(unlaunched.costs).toEqual(costs(120_000, { marketing: 50_000 }));
  });

  it("each hire made costs a $10K fee now and a salary only from next turn", () => {
    // One person on Recruiting: capacity 2 × 1 = 2 hires out of 6 candidates.
    const first = play(withBystander(), { [HUMAN]: idle(1, { hireLimit: null }), [BLITZ]: BYSTANDER });
    expect(reportFor(first, HUMAN).hiring).toEqual({ capacity: 2, wanted: 2, hired: 2 });
    expect(reportFor(first, HUMAN).costs).toEqual(costs(40_000, { hiring: 20_000 }));
    // Next turn all three are on payroll.
    expect(reportFor(play(first.state, { [HUMAN]: idle(3), [BLITZ]: BYSTANDER }), HUMAN).costs).toEqual(costs(120_000));
    // The fee is per hire made: capped at 1 hire it is $10K.
    expect(quarter(solo(), idle(1, { hireLimit: 1 })).costs).toEqual(costs(40_000, { hiring: 10_000 }));
  });

  it("a poach attempt costs $50K whether or not it works; the person is paid by the old company this turn", () => {
    // HUMAN (one person, hype 10) tries BLITZ (three people, hype 10).
    const state = withBystander({ hype: 10 });
    const plans = { [HUMAN]: idle(1, { poachTarget: BLITZ }), [BLITZ]: BYSTANDER };
    const worked = (seed: number): boolean => reportFor(play(state, plans, DESIGN, seed), HUMAN).poach?.success === true;
    const win = play(state, plans, DESIGN, seedWhere(worked));
    expect(reportFor(win, HUMAN).costs).toEqual(costs(40_000, { poaching: 50_000 }));
    expect(reportFor(win, BLITZ).costs).toEqual(costs(120_000));
    // From next turn the person is on HUMAN's payroll: two people each.
    const after = play(win.state, { [HUMAN]: idle(2), [BLITZ]: idle(2) });
    expect(reportFor(after, HUMAN).costs).toEqual(costs(80_000));
    expect(reportFor(after, BLITZ).costs).toEqual(costs(80_000));
    const loss = play(state, plans, DESIGN, seedWhere((seed) => !worked(seed)));
    expect(reportFor(loss, HUMAN).costs).toEqual(costs(40_000, { poaching: 50_000 }));
    expect(reportFor(loss, HUMAN).headcount.end).toBe(1);
  });

  it.each([
    ["a team of one", 1, 0],
    ["a team of two that lays one off this turn (layoffs come before poaching)", 2, 1],
  ])("an attempt on %s is dropped at no cost", (_label, people, layoffs) => {
    const state = onlyActive(withCompany(withBystander({ hype: 10 }), BLITZ, team(people)), [HUMAN, BLITZ]);
    const turn = play(state, { [HUMAN]: idle(1, { poachTarget: BLITZ }), [BLITZ]: idle(people - layoffs, { layoffs }) });
    expect(reportFor(turn, HUMAN)).toMatchObject({ poach: null, costs: costs(40_000), headcount: { end: 1 } });
    expect(reportFor(turn, HUMAN).notes.length).toBeGreaterThan(0);
  });

  it("laid-off people get $20K severance instead of a salary", () => {
    // Five people, two laid off: 3 salaries + 2 × $20K. Cash = 500,000 + 90,000 − 160,000 = 430,000.
    const report = quarter(solo(team(5)), idle(3, { layoffs: 2 }));
    expect(report.notes).toEqual([]);
    expect(report.costs).toEqual(costs(120_000, { severance: 40_000 }));
    expect(report).toMatchObject({ cash: { end: 430_000 }, headcount: { laidOff: 2, end: 3 } });
  });

  it("everything in one turn: layoff, raise, hire, poach, marketing, a price change and a market", () => {
    // HUMAN: launched, quality 52, 10,000 users, hype 20, five people, $1M. BLITZ: three idle people, hype 10.
    // Plan: lay off 1, raise 10%, the other 3 on Recruiting, hire at most 1, $100K marketing, Premium, poach from BLITZ.
    const state = onlyActive(launchedCompany(newGame(DESIGN), HUMAN, { quality: 52, hype: 20, cash: 1_000_000, ...team(5) }), [HUMAN, BLITZ]);
    const plan = idle(3, { layoffs: 1, raisePercent: 10, hireLimit: 1, marketing: 100_000, price: "premium", poachTarget: BLITZ });
    const turn = play(state, { [HUMAN]: plan, [BLITZ]: BYSTANDER });
    const report = reportFor(turn, HUMAN);
    expect(report.notes).toEqual([]);
    // Raise, priced on the start of the turn: 10,000 × $150 × 1.2 = $1,800,000; 10% = $180,000.
    expect(report.raise?.valuation).toBeCloseTo(1_800_000, 2);
    expect(report.raise?.amount).toBeCloseTo(180_000, 2);
    // Available = 5 − 1 laid off − 1 raising = 3. Payroll 4: effective work 4^0.9 = 3.482202;
    // Recruiting has 3 of the 4 = 2.611652 (the fundraiser's share is lost).
    expect(report.work.recruiting).toBeCloseTo(2.611652, 4);
    // Hiring capacity = 2 × 2.611652 = 5.22, rounded 5; it wants min(5, 1) = 1 and gets it.
    expect(report.hiring).toEqual({ capacity: 5, wanted: 1, hired: 1 });
    // Premium churn = 8% + 4 = 12% of 10,000 = 1,200. Pull = 50 × (1 + 0.5 × √4) × 0.75 × 1.2 = 90.
    // Alone in the market: 10,000 − 1,200 + (20,000 + 1,200) = 30,000 users.
    expect(report.users).toMatchObject({ churned: 1_200, end: 30_000 });
    expect(report.users.pull).toBeCloseTo(90, 6);
    // Revenue = 30,000 × $5. Costs: 4 salaries + marketing + 1 hire + poach + 1 severance = 340,000.
    expect(report.revenue).toBe(150_000);
    expect(report.costs).toEqual(costs(160_000, { marketing: 100_000, hiring: 10_000, poaching: 50_000, severance: 20_000 }));
    expect(report.costs.total).toBe(340_000);
    // Cash = 1,000,000 + 180,000 + 150,000 − 340,000 = 990,000. Raise money is not revenue: unprofitable.
    expect(report.cash.end).toBeCloseTo(990_000, 2);
    expect(report.profitable).toBe(false);
    // Runway = 990,000 ÷ (340,000 − 150,000) = 5.2105 turns.
    expect(report.runway).toBeCloseTo(990_000 / 190_000, 4);
    // Hype = 20 × 0.8 + 10 (raise) + 5 (users +200%) − 10 (layoffs) = 21. Valuation = 30,000 × $150 × 1.21.
    expect(report.hype.end).toBeCloseTo(21, 6);
    expect(report.valuation).toBeCloseTo(5_445_000, 0);
    // Equity 100% × (1 − 10%); one investor seat. Headcount 5 − 1 + 1, + 1 if the poach worked.
    expect(report.equity).toBeCloseTo(0.9, 9);
    expect(turn.state.companies[HUMAN].investorSeats).toBe(1);
    expect(report.headcount.end).toBe(report.poach?.success ? 6 : 5);
  });
});

// ── Profit, runway and bankruptcy ──

describe("money: profitable quarters, runway and bankruptcy (rulings 8 and 14)", () => {
  it.each([
    [10_000, 90_000, true, 500_000], //   30,000 users × $3 = costs: profitable, no runway limit
    [9_999, 89_997, false, 499_997], //   one user short: a $3 loss; runway 499,997 ÷ 3
    [10_001, 90_003, true, 500_003], //   one user over
  ])("costs of $90,000 against the revenue of %i + 20,000 users ($%i): profitable %s", (users, revenue, profitable, cash) => {
    // One $40K salary and $50K of marketing.
    const report = quarter(solo({ users }), idle(1, { marketing: 50_000 }));
    expect(report).toMatchObject({ revenue, profitable, cash: { end: cash } });
    expect(report.costs.total).toBe(90_000);
    if (profitable) expect(report.runway).toBeNull();
    else expect(report.runway).toBeCloseTo(cash / (90_000 - revenue), 2);
  });

  it("runway = end-of-quarter cash ÷ (costs − revenue)", () => {
    // Unlaunched, three idle people: 500,000 − 120,000 = 380,000 left; 380,000 ÷ 120,000 = 3.1667 (not 500,000 ÷ 120,000).
    const turn = play(onlyActive(newGame(DESIGN), [HUMAN]), { [HUMAN]: idle(3) });
    expect(reportFor(turn, HUMAN).runway).toBeCloseTo(380_000 / 120_000, 6);
    expect(turn.state.companies[HUMAN]).toMatchObject({ cash: 380_000, lastRevenue: 0, lastCosts: 120_000 });
    // With revenue: three idle people and 30,000 users burn 120,000 − 90,000; 470,000 ÷ 30,000 = 15.667.
    expect(quarter(solo(team(3)), idle(3)).runway).toBeCloseTo(470_000 / 30_000, 6);
  });

  // HUMAN alone in the market with investors holding 3 seats to 2. Users only grow, so runway is the board's only trigger.
  it.each([
    [90_000, 3, 2, false], //             burn 120,000 − 90,000: 60,000 left ÷ 30,000 = exactly 2: not under 2
    [89_999, 3, 59_999 / 30_000, true], // a dollar less: 1.99997
    [0, 1, null, false], //               one person: revenue 90,000 ≥ 40,000, profitable, no limit
  ])("the board's 'runway under 2 turns' reads the same number: cash $%i, %i people: runway %s, low %s", (cash, people, runway, lowRunway) => {
    const state = launchedCompany(newGame(DESIGN), HUMAN, { quality: 52, hype: 20, cash, investorSeats: 3, ...team(people) });
    const report = reportFor(play(onlyActive(state, [HUMAN, BLITZ]), { [HUMAN]: idle(people), [BLITZ]: BYSTANDER }), HUMAN);
    if (runway === null) expect(report.runway).toBeNull();
    else expect(report.runway).toBeCloseTo(runway, 9);
    expect(report.board).toMatchObject({ usersFell: false, lowRunway });
  });

  // One person, nothing launched: the quarter costs one $40K salary. BLITZ idles so the game is not over.
  it.each([
    [40_000, 0, null], //         exactly $0 is not below $0
    [39_999, -1, "bankrupt"],
    [40_001, 1, null],
  ])("bankruptcy is ending a turn below $0: starting on $%i ends on $%i, out %s", (cash, end, out) => {
    const state = onlyActive(withCompany(newGame(DESIGN), HUMAN, { cash, ...team(1) }), [HUMAN, BLITZ]);
    const turn = play(state, { [HUMAN]: idle(1), [BLITZ]: BYSTANDER });
    expect(reportFor(turn, HUMAN)).toMatchObject({ cash: { end }, out });
    if (out) expect(turn.state.companies[HUMAN]).toMatchObject({ users: 0, headcount: 0, out: { turn: 1, reason: "bankrupt", users: 0, headcount: 1 } });
    else expect(turn.state.companies[HUMAN]).toMatchObject({ headcount: 1, out: null });
    if (end === 0) expect(reportFor(turn, HUMAN).runway).toBe(0);
  });

  it("only the end of the turn counts: starting on $0 with a profitable quarter is fine", () => {
    // Revenue $90,000, costs $40,000.
    expect(quarter(solo({ cash: 0 }), idle(1))).toMatchObject({ cash: { start: 0, end: 50_000 }, out: null });
  });

  it("a raise closing the same turn can keep a company above $0", () => {
    // 2,000 users, hype 0, two people, $10,000. Alone, it ends on 22,000 users: revenue $66,000, costs $80,000.
    const company = { users: 2_000, hype: 0, cash: 10_000, ...team(2) };
    // Without a raise: 10,000 + 66,000 − 80,000 = −$4,000.
    expect(quarter(solo(company), idle(2))).toMatchObject({ cash: { end: -4_000 }, out: "bankrupt" });
    // Selling 10% of 2,000 × $150 × 1 = $300,000 brings $30,000 this turn: 10,000 + 30,000 + 66,000 − 80,000 = $26,000.
    const saved = quarter(solo(company), idle(1, { raisePercent: 10 }));
    expect(saved.raise?.amount).toBeCloseTo(30_000, 2);
    expect(saved.cash.end).toBeCloseTo(26_000, 2);
    expect(saved.out).toBeNull();
  });
});

// ── Raises ──

describe("raise (ruling 7)", () => {
  /** HUMAN alone: launched, 10,000 users, hype 20, two people (one to raise, one idle), $500K. */
  const raiser = (patch: Partial<Company> = {}): GameState => solo({ ...team(2), ...patch });
  const raising = (percent: number): Plan => idle(1, { raisePercent: percent });
  const after5: Partial<Company> = { lastRaise: { turn: 5, percent: 10, amount: 100_000 }, founderEquity: 0.9, investorSeats: 1 };

  it("a 20% raise, start to finish", () => {
    const turn = play(raiser({ users: 2_000 }), { [HUMAN]: raising(20) });
    const report = reportFor(turn, HUMAN);
    expect(report.notes).toEqual([]);
    // Priced on the start of the turn: 2,000 users × $150 × (1 + 20/100) × 1 = $360,000; 20% of it = $72,000.
    expect(report.raise?.percent).toBe(20);
    expect(report.raise?.valuation).toBeCloseTo(360_000, 2);
    expect(report.raise?.amount).toBeCloseTo(72_000, 2);
    // Two on payroll, one raising: effective work 2^0.9 = 1.866066; the idle person's half = 0.933033, the other half is lost.
    expect(report.work).toMatchObject({ product: 0, growth: 0 });
    expect(report.work.effective).toBeCloseTo(1.866066, 4);
    expect(report.work.recruiting).toBeCloseTo(0.933033, 4);
    // Churn 8% of 2,000 = 160; alone, it ends on 2,000 + 20,000. Revenue = 22,000 × $3; both salaries are paid.
    expect(report).toMatchObject({ users: { churned: 160, end: 22_000 }, revenue: 66_000, costs: costs(80_000) });
    // Cash arrives the same turn: 500,000 + 72,000 + 66,000 − 80,000 = 558,000.
    expect(report.cash.end).toBeCloseTo(558_000, 2);
    // Raise proceeds are not revenue: 66,000 < 80,000 is unprofitable. Runway = 558,000 ÷ 14,000.
    expect(report.profitable).toBe(false);
    expect(report.runway).toBeCloseTo(558_000 / 14_000, 4);
    // Hype = 20 × 0.8 + 10 (raise) + 5 (users ×11) = 31. Valuation at the close = 22,000 × $150 × 1.31 = $4,323,000.
    expect(report.hype.raise).toBe(10);
    expect(report.hype.end).toBeCloseTo(31, 6);
    expect(report.valuation).toBeCloseTo(4_323_000, 0);
    // Founder equity 100% × (1 − 20%); one investor seat added.
    const company = turn.state.companies[HUMAN];
    expect(report.equity).toBeCloseTo(0.8, 9);
    expect(company.founderEquity).toBeCloseTo(0.8, 9);
    expect(company).toMatchObject({ founderSeats: 2, investorSeats: 1, lastRaise: { turn: 1, percent: 20 } });
    expect(company.lastRaise?.amount).toBeCloseTo(72_000, 2);
  });

  it.each([
    [999, null, 482_997], //      no raise: 500,000 + 20,999 × 3 − 80,000
    [1_000, 36_000, 519_000], //  1,000 × $150 × 1.2 = $180,000, 20% = $36,000; + 21,000 × 3 − 80,000
    [1_001, 36_036, 519_039], //  1,001 × $150 × 1.2 = $180,180, 20% = $36,036; + 21,001 × 3 − 80,000
  ])("needs 1,000+ users at the start of the turn: with %i it raises $%s and ends on $%i", (users, amount, cash) => {
    const state = raiser({ users });
    const turn = play(state, { [HUMAN]: raising(20) });
    const report = reportFor(turn, HUMAN);
    expect(report.cash.end).toBeCloseTo(cash, 2);
    // The public check on whether a company may raise says the same.
    expect(raiseBlocker(state.companies[HUMAN], 1, DESIGN) === null).toBe(amount !== null);
    if (amount === null) {
      // Dropped at no cost and the report says so: nobody is taken off work, no hype, no seat, no equity sold.
      // (It ends the turn on 20,999 users, but that is too late for this turn's raise.)
      expect(report.raise).toBeNull();
      expect(report.notes.length).toBeGreaterThan(0);
      expect(report).toMatchObject({ plan: { raisePercent: 0, allocation: { recruiting: 2 } }, hype: { raise: 0 } });
      expect(turn.state.companies[HUMAN]).toMatchObject({ founderEquity: 1, investorSeats: 0, lastRaise: null });
    } else {
      expect(report.notes).toEqual([]);
      expect(report.raise?.amount).toBeCloseTo(amount, 2);
      expect(turn.state.companies[HUMAN].investorSeats).toBe(1);
    }
  });

  it("counts and prices the users and hype left after this turn's event, not last quarter's close", () => {
    // 1,050 at the close, 945 after a breach took 10%: under 1,000, no raise.
    const under = withState(raiser({ users: 945, usersAtLastClose: 1_050, hype: 10 }), { carryOverUsers: 105 });
    expect(quarter(under, raising(20)).raise).toBeNull();
    // 1,200 users and hype 20 at the close; a breach leaves 1,080 and hype 10: 1,080 × $150 × 1.1 = $178,200; 20% = $35,640.
    const over = withState(raiser({ users: 1_080, usersAtLastClose: 1_200, hype: 10 }), { carryOverUsers: 120 });
    expect(quarter(over, raising(20)).raise?.valuation).toBeCloseTo(178_200, 2);
    expect(quarter(over, raising(20)).raise?.amount).toBeCloseTo(35_640, 2);
  });

  it.each([
    [6, false],
    [7, false],
    [8, true], //  "a raise on turn 5 allows the next on turn 8"
    [9, true],
  ])("needs no raise in the previous 2 turns: after one on turn 5, turn %i is allowed: %s", (turn, allowed) => {
    const state = withState(raiser(after5), { turn });
    const result = play(state, { [HUMAN]: raising(10) });
    const report = reportFor(result, HUMAN);
    const company = result.state.companies[HUMAN];
    expect(raiseBlocker(state.companies[HUMAN], turn, DESIGN) === null).toBe(allowed);
    if (allowed) {
      // 10,000 × $150 × 1.2 = $1,800,000; 10% = $180,000. Equity 90% × 0.9 = 81%; a second seat.
      expect(report.raise?.amount).toBeCloseTo(180_000, 2);
      expect(company.founderEquity).toBeCloseTo(0.81, 9);
      expect(company).toMatchObject({ investorSeats: 2, lastRaise: { turn } });
    } else {
      expect(report.raise).toBeNull();
      expect(report.notes.length).toBeGreaterThan(0);
      expect(company).toMatchObject({ founderEquity: 0.9, investorSeats: 1, lastRaise: after5.lastRaise });
    }
  });

  it("played through: asking for 30% every turn closes on turns 1, 4 and 7, each priced on that turn's start", () => {
    // Alone in the market next to a bystander, two people. A dropped raise takes nobody off work and does not restart the wait.
    let state = withBystander(team(2));
    const closed: number[] = [];
    for (let turn = 1; turn <= 7; turn++) {
      const start = state.companies[HUMAN];
      const result = play(state, { [HUMAN]: raising(30), [BLITZ]: BYSTANDER });
      const report = reportFor(result, HUMAN);
      if (report.raise) {
        closed.push(turn);
        // Valuation = start-of-turn users × $150 × (1 + start-of-turn hype/100); cash raised = 30% of it.
        const valuation = start.users * 150 * (1 + start.hype / 100);
        expect(Math.abs(report.raise.valuation - valuation)).toBeLessThanOrEqual(1);
        expect(Math.abs(report.raise.amount - valuation * 0.3)).toBeLessThanOrEqual(1);
        expect(Math.abs(report.cash.end - (start.cash + valuation * 0.3 + report.revenue - 80_000))).toBeLessThanOrEqual(2);
      } else {
        expect(report.plan.allocation.recruiting).toBe(2);
        expect(report.cash.end).toBe(start.cash + report.revenue - 80_000);
      }
      state = result.state;
    }
    expect(closed).toEqual([1, 4, 7]);
    // Users only grew and every quarter was profitable, so the board never had a bad quarter to vote on.
    // 100% × 0.7 × 0.7 × 0.7 = 34.3%; three investor seats.
    expect(state.companies[HUMAN].founderEquity).toBeCloseTo(0.343, 9);
    expect(state.companies[HUMAN]).toMatchObject({ out: null, investorSeats: 3, founderSeats: 2, lastRaise: { turn: 7 } });
  });

  it.each([
    [10, 180_000, 0.9],
    [20, 360_000, 0.8],
    [30, 540_000, 0.7],
  ])("selling %i%% of a $1.8M company raises $%i and leaves the founders %d of what they had", (percent, amount, equity) => {
    // Valuation = 10,000 users × $150 × (1 + 20/100) = $1,800,000. Cash = 500,000 + amount + 30,000 × 3 − 80,000.
    const turn = play(raiser(), { [HUMAN]: raising(percent) });
    const report = reportFor(turn, HUMAN);
    expect(report.notes).toEqual([]);
    expect(report.raise?.percent).toBe(percent);
    expect(report.raise?.valuation).toBeCloseTo(1_800_000, 2);
    expect(report.raise?.amount).toBeCloseTo(amount, 2);
    expect(report.cash.end).toBeCloseTo(510_000 + amount, 2);
    expect(turn.state.companies[HUMAN].founderEquity).toBeCloseTo(equity, 9);
    expect(turn.state.companies[HUMAN].investorSeats).toBe(1);
  });

  it.each([15, 25, 40, 50, 100, 5, -10, 10.5, 0.2, Number.NaN, Number.POSITIVE_INFINITY])(
    "%d%% is not on offer: nothing but 0, 10, 20 or 30 is ever sold, and the report says what happened",
    (percent) => {
      const turn = play(raiser(), { [HUMAN]: raising(percent) });
      const report = reportFor(turn, HUMAN);
      const sold = report.plan.raisePercent;
      expect([0, 10, 20, 30]).toContain(sold);
      expect(report.notes.length).toBeGreaterThan(0);
      expect(report.raise?.percent ?? 0).toBe(sold);
      expect(turn.state.companies[HUMAN].founderEquity).toBeCloseTo(1 - sold / 100, 9);
      expect(turn.state.companies[HUMAN].investorSeats).toBe(sold === 0 ? 0 : 1);
      expect(report.cash.end).toBeCloseTo(510_000 + 18_000 * sold, 2);
    },
  );

  it.each([
    [0.6, 3, 30, 324_000], //  winter: $1.8M × 0.6 = $1,080,000; 30% = $324,000
    [0.6, 1, 30, 324_000], //  the last turn of a winter still counts
    [1.4, 2, 10, 252_000], //  hot market: $1.8M × 1.4 = $2,520,000; 10% = $252,000
  ])("is priced with the funding climate: ×%d with %i turn(s) left, selling %i%%, raises $%i", (multiplier, turnsLeft, percent, amount) => {
    const turn = play(withState(raiser(), { climate: { multiplier, turnsLeft } }), { [HUMAN]: raising(percent) });
    expect(turn.log.climateMultiplier).toBe(multiplier);
    expect(reportFor(turn, HUMAN).raise?.valuation).toBeCloseTo(1_800_000 * multiplier, 2);
    expect(reportFor(turn, HUMAN).raise?.amount).toBeCloseTo(amount, 2);
  });

  it("the Incumbent can raise on turn 1: 60% founder equity becomes 54%, with a second investor seat", () => {
    // 10,000 users × $150 × (1 + 20/100) = $1,800,000; 10% = $180,000. Seven of its eight people work.
    const turn = play(newGame(DESIGN), { [INCUMBENT]: { allocation: { product: 5, growth: 1, recruiting: 1 }, raisePercent: 10 } });
    const report = reportFor(turn, INCUMBENT);
    expect(report.notes).toEqual([]);
    expect(report.raise?.amount).toBeCloseTo(180_000, 2);
    expect(report.costs.salaries).toBe(320_000);
    expect(report.cash.end).toBeCloseTo(3_000_000 + 180_000 + report.revenue - report.costs.total, 2);
    expect(turn.state.companies[INCUMBENT].founderEquity).toBeCloseTo(0.54, 9);
    expect(turn.state.companies[INCUMBENT]).toMatchObject({ investorSeats: 2, founderSeats: 2 });
  });

  it("a founder working alone can raise: nobody is left to do other work that turn", () => {
    // The design's only conditions are 1,000+ users and no recent raise. Available = 1 − 1 = 0; the salary is still paid.
    const report = quarter(solo(), on(0, 0, 0, { raisePercent: 20 }));
    expect(report.notes).toEqual([]);
    expect(report.raise?.amount).toBeCloseTo(360_000, 2);
    expect(report).toMatchObject({ work: { product: 0, growth: 0, recruiting: 0 }, costs: costs(40_000) });
  });
});

// ── Valuation ──

describe("valuation = users × $150 × (1 + hype/100) × funding climate", () => {
  it.each([
    [1, 0, 5_445_000], //    30,000 users, hype 20 × 0.8 + 5 = 21: 30,000 × $150 × 1.21
    [0.6, 3, 3_267_000], //  × 0.6
    [1.4, 2, 7_623_000], //  × 1.4
  ])("at the end of a turn, with climate ×%d (%i turns left): $%i", (multiplier, turnsLeft, expected) => {
    const turn = play(withState(solo(), { climate: { multiplier, turnsLeft } }), { [HUMAN]: idle(1) });
    expect(turn.log.climateMultiplier).toBe(multiplier);
    expect(reportFor(turn, HUMAN).valuation).toBeCloseTo(expected, 0);
  });

  it("is $0 for a company with no users", () => {
    expect(quarter(onlyActive(newGame(DESIGN), [HUMAN]), idle(3)).valuation).toBe(0);
  });

  // Turn 2: HUMAN (one idle person) alone in the market next to a bystander, with the card certain to be
  // revealed for turn 3. It ends turn 2 on 32,000 users with hype 21. With no climate its end-of-turn
  // valuations would then be:
  //   turn 3: 56,200 users, hype 21 × 0.8 + 5 = 21.8:          56,200 × 150 × 1.218    = 10,267,740
  //   turn 4: 82,820 users, hype 21.8 × 0.8 + 5 = 22.44:       82,820 × 150 × 1.2244   = 15,210,721.2
  //   turn 5: 112,102 users, hype 22.44 × 0.8 + 5 = 22.952:    112,102 × 150 × 1.22952 = 20,674,747.66
  //   turn 6: 144,312 users, hype 22.952 × 0.8 + 5 = 23.3616:  144,312 × 150 × 1.233616 = 26,703,838.83
  it.each([
    ["funding-winter", 0.6, 3], //  "valuations ×0.6 for 3 turns": turns 3, 4 and 5
    ["hot-market", 1.4, 2], //      "×1.4 for 2 turns": turns 3 and 4
  ])("%s drawn from the deck: valuations ×%d for %i turns, counting the turn it is revealed in, then back to normal", (cardId, multiplier, turns) => {
    const plans = { [HUMAN]: idle(1), [BLITZ]: BYSTANDER };
    const second = play(withState(withBystander(), { turn: 2 }), plans, eventsOn(only(cardId)));
    // Turn 2 itself is still normal: 32,000 × $150 × 1.21 = $5,808,000.
    expect(second.log.climateMultiplier).toBe(1);
    expect(reportFor(second, HUMAN).valuation).toBeCloseTo(5_808_000, 0);
    expect(second.state.event).toEqual({ cardId, targetId: null });
    expect(second.state.climate).toEqual({ multiplier, turnsLeft: turns });
    let state = second.state;
    [10_267_740, 15_210_721.2, 20_674_747.66, 26_703_838.83].forEach((normal, index) => {
      const result = play(state, plans);
      const expected = index < turns ? multiplier : 1;
      expect(result.log.climateMultiplier).toBe(expected);
      expect(Math.abs(reportFor(result, HUMAN).valuation - normal * expected)).toBeLessThanOrEqual(1);
      state = result.state;
    });
    expect(state.climate).toEqual({ multiplier: 1, turnsLeft: 0 });
  });
});

// ── Hype ──

describe("hype (ruling 12)", () => {
  it("decays 20% a turn: 10 → 8 → 6.4 → 5.12", () => {
    let state = onlyActive(newGame(DESIGN), [HUMAN, BLITZ]);
    const seen: number[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      const result = play(state, { [HUMAN]: idle(3), [BLITZ]: BYSTANDER });
      seen.push(reportFor(result, HUMAN).hype.end);
      expect(result.state.companies[HUMAN].hype).toBe(reportFor(result, HUMAN).hype.end);
      state = result.state;
    }
    [8, 6.4, 5.12].forEach((expected, index) => expect(seen[index]).toBeCloseTo(expected, 6));
  });

  it.each([
    [10_000, 2_500, 5], //    12,500: exactly +25%
    [10_000, 2_499, 0], //    12,499: one user short
    [10_000, 2_501, 5],
    [100_000, 24_999, 0], //  +24.999%
    [100_000, 25_000, 5],
    [4, 1, 5], //             4 → 5 is +25%
    [5, 1, 0], //             5 → 6 is +20%
    [0, 20_000, 0], //        a launched company with no users at the last close: no bonus
  ])("+5 for growing 25%% or more over the last close: %i users + %i new earns +%i", (users, newUsers, bonus) => {
    // A lone company ends on its starting users + the new users. Hype = 20 × 0.8 = 16, plus the bonus.
    const config = marketOf(newUsers);
    const report = quarter(solo({ users }, config), idle(1), config);
    expect(report.users.end).toBe(users + newUsers);
    expect(report.hype.growth).toBe(bonus);
    expect(report.hype.end).toBeCloseTo(16 + bonus, 6);
  });

  it.each([
    [1_500, 11_500, 0], //  +15% over the close of 10,000 (but +27.8% over the 9,000 the breach left)
    [2_500, 12_500, 5], //  +25% over the close
  ])("growth is measured from last quarter's close, not from what an event left: %i new users, ending on %i, earn +%i", (newUsers, end, bonus) => {
    // 10,000 at the close; a breach leaves 9,000 and 1,000 waiting. Alone, it gets them back with the new users.
    const config = marketOf(newUsers);
    const breached = withState(solo({ users: 9_000, usersAtLastClose: 10_000 }, config), { carryOverUsers: 1_000 });
    const report = quarter(breached, idle(1), config);
    expect(report.users).toMatchObject({ open: 10_000, lostToEvent: 1_000, end });
    expect(report.hype.growth).toBe(bonus);
  });

  // No new users below, so users stay put and no growth bonus is in the way.
  it("+10 when a raise closes, added after the decay rather than decayed with it", () => {
    // Hype 20: 20 × 0.8 + 10 = 26. Hype 50: 50 × 0.8 + 10 = 50 (not (50 + 10) × 0.8 = 48).
    const config = marketOf(0);
    const report = quarter(solo(team(2), config), idle(1, { raisePercent: 10 }), config);
    expect(report).toMatchObject({ users: { end: 10_000 }, hype: { raise: 10, growth: 0 } });
    expect(report.hype.end).toBeCloseTo(26, 6);
    expect(quarter(solo({ hype: 50, ...team(2) }, config), idle(1, { raisePercent: 10 }), config).hype.end).toBeCloseTo(50, 6);
  });

  it.each([
    [50, 1, 30], //  50 × 0.8 − 10
    [50, 2, 30], //  once per turn, however many people go
    [5, 1, 0], //    5 × 0.8 − 10 = −6, clamped to 0
  ])("−10 in a turn with layoffs: hype %i and %i laid off ends on %i", (hype, layoffs, expected) => {
    const config = marketOf(0);
    expect(quarter(solo({ hype, ...team(3) }, config), idle(3 - layoffs, { layoffs }), config).hype.end).toBeCloseTo(expected, 6);
  });
});

// ── Price and marketing (ruling 17) ──

describe("price and marketing (ruling 17)", () => {
  it("a price change is free and takes effect at once, each time it changes", () => {
    // Turn 1 on Standard: ends on 30,000 users, cash 550,000, hype 21, quality 50.
    const first = play(withBystander(), { [HUMAN]: idle(1), [BLITZ]: BYSTANDER });
    // Turn 2 on Premium. Quality 48: churn = 12% − 3.84 + 4 = 12.16% of 30,000 = 3,648.
    const second = play(first.state, { [HUMAN]: idle(1, { price: "premium" }), [BLITZ]: BYSTANDER });
    let report = reportFor(second, HUMAN);
    expect(report.notes).toEqual([]);
    // Pull = 48 × 0.75 × (1 + 21/100) = 43.56. Ends on 30,000 + 22,000; revenue = 52,000 × $5.
    expect(report.users.pull).toBeCloseTo(43.56, 3);
    expect(report).toMatchObject({ users: { churned: 3_648, end: 52_000 }, revenue: 260_000 });
    // The change itself costs nothing: 550,000 + 260,000 − 40,000 = 770,000.
    expect(report.costs).toEqual(costs(40_000));
    expect(report.cash.end).toBe(770_000);
    expect(second.state.companies[HUMAN].price).toBe("premium");
    // Turn 3 on Budget. Quality 46, hype 21 × 0.8 + 5 = 21.8: pull = 46 × 1.25 × 1.218 = 70.035.
    const third = play(second.state, { [HUMAN]: idle(1, { price: "budget" }), [BLITZ]: BYSTANDER });
    report = reportFor(third, HUMAN);
    expect(report.users.pull).toBeCloseTo(70.035, 3);
    // Churn = 12% − 3.68 − 2 = 6.32% of 52,000 = 3,286.4. Revenue = (52,000 + 24,200) × $2; cash 770,000 + 152,400 − 40,000.
    expect(Math.abs(report.users.churned - 3_286.4)).toBeLessThan(1);
    expect(report).toMatchObject({ revenue: 152_400, costs: costs(40_000), cash: { end: 882_400 } });
  });

  it("marketing is paid in the turn it is set and lifts pull in that turn only", () => {
    // Turn 1 with $100K: pull = 50 × (1 + 0.5 × √4) × 1.2 = 120. Cash = 500,000 + 90,000 − 140,000.
    const first = play(withBystander(), { [HUMAN]: idle(1, { marketing: 100_000 }), [BLITZ]: BYSTANDER });
    expect(reportFor(first, HUMAN).users.pull).toBeCloseTo(120, 6);
    expect(reportFor(first, HUMAN)).toMatchObject({ costs: costs(40_000, { marketing: 100_000 }), cash: { end: 450_000 } });
    // Turn 2 with none: pull = 48 × 1.21 = 58.08; nothing lingers, nothing is charged. Cash = 450,000 + 52,000 × 3 − 40,000.
    const second = play(first.state, { [HUMAN]: idle(1), [BLITZ]: BYSTANDER });
    expect(reportFor(second, HUMAN).users.pull).toBeCloseTo(58.08, 3);
    expect(reportFor(second, HUMAN)).toMatchObject({ costs: costs(40_000), cash: { end: 566_000 } });
  });

  it.each([0, 25_000, 50_000, 5_000_000])("$%i is a whole number of $25K steps and is taken as it is", (marketing) => {
    const report = quarter(solo({ cash: 10_000_000 }), idle(1, { marketing }));
    expect(report.notes).toEqual([]);
    expect(report).toMatchObject({ plan: { marketing }, costs: { marketing } });
  });

  it.each([30_000, 40_000, 12_500, 1, -25_000, 5_025_000, Number.NaN, Number.POSITIVE_INFINITY])(
    "a marketing budget of $%d is not legal: it is fixed up to one that is, and the report says so",
    (marketing) => {
      // Legal = a whole number of $25K steps from $0 to the planner's $5M ceiling (rulings, "Numbers the design does not name").
      const report = quarter(solo({ cash: 10_000_000 }), idle(1, { marketing }));
      const spent = report.plan.marketing;
      expect(report.notes.length).toBeGreaterThan(0);
      expect(spent % 25_000).toBe(0);
      expect(spent).toBeGreaterThanOrEqual(0);
      expect(spent).toBeLessThanOrEqual(5_000_000);
      if (Number.isFinite(marketing)) expect(Math.abs(spent - Math.min(5_000_000, Math.max(0, marketing)))).toBeLessThan(25_000);
      // What is charged, and what pulls, is the fixed-up amount: 50 × (1 + 0.5 × √(spent ÷ 25K)) × 1.2.
      expect(report.costs.marketing).toBe(spent);
      expect(report.users.pull).toBeCloseTo(50 * (1 + 0.5 * Math.sqrt(spent / 25_000)) * 1.2, 3);
      expect(report.cash.end).toBe(10_000_000 + 90_000 - 40_000 - spent);
    },
  );
});

// ── Tuning ──

describe("tuning: these rules read their numbers from the config they are given", () => {
  /** The design's numbers with one group changed. */
  const tune = <K extends keyof RulesConfig>(key: K, patch: Partial<RulesConfig[K]>, base: RulesConfig = DESIGN): RulesConfig =>
    ({ ...base, [key]: { ...(base[key] as object), ...patch } }) as RulesConfig;
  const premium = tune("priceTiers", { premium: { price: 10, pullFactor: 0.5, churnDelta: 0.1 } });
  const raise10 = idle(1, { raisePercent: 10 });
  const noNewUsers = marketOf(0); // users stay put, so no growth bonus gets in the way of a hype check

  // The usual lone company (quality 50 after the decay, 10,000 users, hype 20, one idle person) unless the row says otherwise.
  it.each<[string, RulesConfig, Partial<Company>, Plan, (report: CompanyReport) => number | undefined, number]>([
    ["pull.growthCoefficient 1: 50 × (1 + 1 × 1)", tune("pull", { growthCoefficient: 1 }), { hype: 0 }, on(0, 1, 0), (r) => r.users.pull, 100],
    ["pull.marketingCoefficient 1: 50 × (1 + 1 × √4)", tune("pull", { marketingCoefficient: 1 }), { hype: 0 }, idle(1, { marketing: 100_000 }), (r) => r.users.pull, 150],
    ["pull.marketingStep $100K: 50 × (1 + 0.5 × √(400K ÷ 100K))", tune("pull", { marketingStep: 100_000 }), { hype: 0 }, idle(1, { marketing: 400_000 }), (r) => r.users.pull, 100],
    ["pull.maxMarketing $100K caps a $125K plan", tune("pull", { maxMarketing: 100_000 }), {}, idle(1, { marketing: 125_000 }), (r) => r.costs.marketing, 100_000],
    ["priceTiers.premium.price $10: 30,000 × $10", premium, {}, idle(1, { price: "premium" }), (r) => r.revenue, 300_000],
    ["priceTiers.premium.pullFactor 0.5: 50 × 0.5", premium, { hype: 0 }, idle(1, { price: "premium" }), (r) => r.users.pull, 25],
    ["priceTiers.premium.churnDelta +10 points: 18% of 10,000", premium, {}, idle(1, { price: "premium" }), (r) => r.users.churned, 1_800],
    ["churn.perQualityPoint 0.1 points: 12% − 5 = 7% of 10,000", tune("churn", { perQualityPoint: 0.001 }), {}, idle(1), (r) => r.users.churned, 700],
    ["churn.min 10% lifts the 8% of quality 50", tune("churn", { min: 0.1 }), {}, idle(1), (r) => r.users.churned, 1_000],
    ["raise.minUsers 500: 500 × $150 × 1.2 × 10%", tune("raise", { minUsers: 500 }), { users: 500, ...team(2) }, raise10, (r) => r.raise?.amount, 9_000],
    ["raise.options [5, 50]: half of $1.8M", tune("raise", { options: [5, 50] }), team(2), idle(1, { raisePercent: 50 }), (r) => r.raise?.amount, 900_000],
    ["valuation.perUser $300: a raise of 10,000 × $300 × 1.2 × 10%", tune("valuation", { perUser: 300 }), team(2), raise10, (r) => r.raise?.amount, 360_000],
    ["valuation.perUser $300: at the close 30,000 × $300 × 1.21", tune("valuation", { perUser: 300 }), {}, idle(1), (r) => r.valuation, 10_890_000],
    ["hype.decay 50%: 20 × 0.5", tune("hype", { decay: 0.5 }, noNewUsers), {}, idle(1), (r) => r.hype.end, 10],
    ["hype.raise +20: 20 × 0.8 + 20", tune("hype", { raise: 20 }, noNewUsers), team(2), raise10, (r) => r.hype.end, 36],
    ["hype.growth +7: 20 × 0.8 + 7", tune("hype", { growth: 7 }), {}, idle(1), (r) => r.hype.end, 23],
    ["hype.growthThreshold 50%: growing 25% earns nothing, 16", tune("hype", { growthThreshold: 0.5 }, marketOf(2_500)), {}, idle(1), (r) => r.hype.end, 16],
    ["hype.growthThreshold 50%: growing 50% earns it, 16 + 5", tune("hype", { growthThreshold: 0.5 }, marketOf(5_000)), {}, idle(1), (r) => r.hype.end, 21],
    ["salary $50K", { ...DESIGN, salary: 50_000 }, {}, idle(1), (r) => r.costs.salaries, 50_000],
    ["hiring.fee $15K: two hires", tune("hiring", { fee: 15_000 }), {}, idle(1, { hireLimit: null }), (r) => r.costs.hiring, 30_000],
    ["layoff.severance $25K: two layoffs", tune("layoff", { severance: 25_000 }), team(3), idle(1, { layoffs: 2 }), (r) => r.costs.severance, 50_000],
    ["layoff.hype −20: 50 × 0.8 − 20", tune("layoff", { hype: -20 }, noNewUsers), { hype: 50, ...team(3) }, idle(1, { layoffs: 2 }), (r) => r.hype.end, 20],
  ])("%s = %d", (_label, config, company, plan, read, expected) => {
    expect(read(quarter(solo(company, config), plan, config))).toBeCloseTo(expected, 3);
  });

  it("market.growthPerTurn, hype.launch and poach.cost", () => {
    // New users at 50% a turn: 20,000 → 30,000 → 45,000.
    const growth = tune("market", { growthPerTurn: 0.5 });
    let state = newGame(growth);
    for (const expected of [20_000, 30_000, 45_000]) {
      const turn = play(state, {}, growth);
      expect(turn.log.market.newUsers).toBe(expected);
      state = turn.state;
    }
    // Launch at +30: quality 8 → 10.6, hype 10 × 0.8 + 30 = 38.
    const launch = tune("hype", { launch: 30 });
    const unlaunched = onlyActive(withCompany(newGame(launch), HUMAN, { quality: 8, ...team(1) }), [HUMAN]);
    expect(quarter(unlaunched, on(1, 0, 0), launch).hype.end).toBeCloseTo(38, 6);
    // A poach attempt at $60K.
    const poach = tune("poach", { cost: 60_000 });
    const turn = play(withBystander({ hype: 10 }, poach), { [HUMAN]: idle(1, { poachTarget: BLITZ }), [BLITZ]: BYSTANDER }, poach);
    expect(reportFor(turn, HUMAN).costs).toEqual(costs(40_000, { poaching: 60_000 }));
  });

  it.each([
    [0, 6, true], //   no gap needed: the very next turn
    [1, 6, false], //  one clear turn needed
    [1, 7, true],
    [3, 8, false], //  three clear turns needed: 6, 7 and 8
    [3, 9, true],
  ])("raise.cooldownTurns %i: after a raise on turn 5, raising on turn %i is allowed: %s", (cooldownTurns, turn, allowed) => {
    const config = tune("raise", { cooldownTurns });
    const company = { ...team(2), lastRaise: { turn: 5, percent: 10, amount: 100_000 }, founderEquity: 0.9, investorSeats: 1 };
    expect(quarter(withState(solo(company, config), { turn }), raise10, config).raise !== null).toBe(allowed);
  });
});

// ── Whole games ──

describe("whole games with events on: every turn's market and books are checked against the rules", () => {
  const EVENTS_ON = eventsOn(DECK, 0.5);
  const PRICES: readonly PriceTier[] = ["standard", "premium", "budget"];
  const seen = { raises: 0, refusedRaises: 0, bankruptcies: 0, breaches: 0, climates: 0, booms: 0, spikes: 0, waitingPools: 0 };

  /** Every fourth game is played by the three startups alone, and they sit out the first two turns. */
  const startupsOnly = (variant: number): boolean => variant % 4 === 0;

  /** Legal plans that keep this area busy: changing prices, marketing in steps, raises of every size, layoffs, hiring, poaching. */
  const scriptedPlans = (state: GameState, variant: number): Record<number, Plan> => {
    const plans: Record<number, Plan> = {};
    for (const company of state.companies) {
      if (company.out) continue;
      const { id, headcount } = company;
      if (startupsOnly(variant) && state.turn <= 2) {
        plans[id] = idle(headcount); // nobody builds, nobody launches, the pool has to wait
        continue;
      }
      const beat = state.turn + variant;
      // Ruling 7: 1,000+ users at the start of the turn and no raise in the previous two turns.
      const eligible = company.users >= 1_000 && (company.lastRaise === null || state.turn - company.lastRaise.turn > 2);
      const asksToRaise = id === BLITZ || (id === HUMAN && beat % 4 === 0) || (id === INCUMBENT && variant % 2 === 1);
      const layoffs = (id === INCUMBENT || (id === BOOT && variant % 3 === 0)) && beat % 4 === 0 && headcount > 3 ? 1 : 0;
      // Ruling 2: available = headcount − layoffs − 1 if raising.
      const available = headcount - layoffs - (asksToRaise && eligible ? 1 : 0);
      const growth = available >= 2 ? 1 + (available >= 5 && id === BLITZ ? 1 : 0) : 0;
      const recruiting = available - growth >= 2 && id !== HUMAN ? 1 : 0;
      plans[id] = {
        allocation: { product: available - growth - recruiting, growth, recruiting },
        marketing: company.launched && company.cash > 400_000 ? (id === BLITZ ? 100_000 : 25_000 * (beat % 3)) : 0,
        price: id === BLITZ ? "budget" : id === BOOT ? "premium" : PRICES[beat % 3],
        raisePercent: asksToRaise ? [10, 20, 30][(id + beat) % 3] : 0, // asked for even when not allowed
        poachTarget: id === INCUMBENT && beat % 3 === 0 ? (variant % 2 === 0 ? HUMAN : BLITZ) : null,
        layoffs,
        hireLimit: company.cash > 300_000 ? null : 0,
      };
    }
    return plans;
  };

  /** One resolved turn against the design's formulas. */
  const audit = (state: GameState, plans: Record<number, Plan>, turn: Turn): void => {
    const { log } = turn;
    const { market } = log;
    const climate = state.climate.turnsLeft > 0 ? state.climate.multiplier : 1;
    expect(log.climateMultiplier).toBe(climate);
    if (climate !== 1) seen.climates++;
    if (state.modifiers.newUsers !== 1) seen.booms++;
    if (state.modifiers.marketing !== 1) seen.spikes++;

    // New users: 20,000 × 1.1^(turn − 1), × 1.5 in a market boom, in whole users.
    expect(Number.isInteger(market.newUsers)).toBe(true);
    expect(Math.abs(market.newUsers - 20_000 * 1.1 ** (state.turn - 1) * state.modifiers.newUsers)).toBeLessThan(1);
    expect(market.carriedIn).toBe(state.carryOverUsers);

    let churned = 0;
    let won = 0;
    let totalPull = 0;
    let exits = 0;
    const launched: CompanyReport[] = [];
    for (const company of state.companies) {
      const report = log.companies[company.id];
      if (company.out || !report) {
        expect(report).toBeNull();
        continue;
      }
      const after = turn.state.companies[company.id];
      const tier = DESIGN.priceTiers[report.plan.price];
      const { users, costs: lines, raise } = report;

      // Users: churn = max(2%, 12% − 0.08 × quality after work + tier points) of start-of-turn users, in whole users.
      expect(users.open).toBe(company.usersAtLastClose);
      expect(users.open - users.lostToEvent).toBe(company.users);
      const rate = Math.max(0.02, 0.12 - 0.0008 * report.quality.end + tier.churnDelta);
      expect(Number.isInteger(users.churned) && Number.isInteger(users.won) && users.won >= 0).toBe(true);
      expect(Math.abs(users.churned - company.users * rate)).toBeLessThan(1);
      expect(users.end).toBe(company.users - users.churned + users.won);
      churned += users.churned;
      won += users.won;

      // Pull = quality × (1 + 0.3 × Growth work + 0.5 × √(marketing ÷ $25K)) × price factor × (1 + start hype/100);
      // 'ad prices spike' halves the marketing term. No users before launch.
      if (company.launched || report.quality.launchedNow) {
        const marketingTerm = 0.5 * state.modifiers.marketing * Math.sqrt(report.plan.marketing / 25_000);
        const pull = report.quality.end * (1 + 0.3 * report.work.growth + marketingTerm) * tier.pullFactor * (1 + company.hype / 100);
        expect(Math.abs(users.pull - pull)).toBeLessThanOrEqual(1e-4 * Math.max(1, pull));
        totalPull += users.pull;
        launched.push(report);
      } else {
        expect(users.won).toBe(0);
      }

      // Money: revenue = end users × price; the five cost lines; cash = start + raise + revenue − costs.
      expect(report.revenue).toBe(users.end * tier.price);
      expect(lines).toEqual(
        costs((company.headcount - report.headcount.laidOff) * 40_000, {
          marketing: report.plan.marketing,
          hiring: report.headcount.hired * 10_000,
          poaching: report.poach ? 50_000 : 0,
          severance: report.headcount.laidOff * 20_000,
        }),
      );
      expect(report.cash.start).toBe(company.cash);
      expect(Math.abs(report.cash.end - (company.cash + (raise?.amount ?? 0) + report.revenue - lines.total))).toBeLessThan(1e-6);
      expect(report.profitable).toBe(report.revenue >= lines.total);
      if (report.profitable) expect(report.runway).toBeNull();
      else if (report.cash.end >= 0) expect(report.runway).toBeCloseTo(report.cash.end / (lines.total - report.revenue), 6);

      // Raise: closes exactly when asked for and allowed; priced on the start of the turn.
      const eligible = company.users >= 1_000 && (company.lastRaise === null || state.turn - company.lastRaise.turn > 2);
      const asked = plans[company.id].raisePercent;
      expect(raise !== null).toBe(asked > 0 && eligible);
      if (asked > 0 && !eligible) seen.refusedRaises++;
      if (raise) {
        seen.raises++;
        const valuation = company.users * 150 * (1 + company.hype / 100) * climate;
        expect(raise.percent).toBe(asked);
        expect(Math.abs(raise.valuation - valuation)).toBeLessThanOrEqual(1);
        expect(Math.abs(raise.amount - (valuation * asked) / 100)).toBeLessThanOrEqual(1);
        expect(after.lastRaise?.turn).toBe(state.turn);
      }
      expect(report.equity).toBeCloseTo(company.founderEquity * (1 - (raise?.percent ?? 0) / 100), 9);
      expect(after.founderEquity).toBe(report.equity);
      expect(after.investorSeats).toBe(company.investorSeats + (raise ? 1 : 0));
      expect(after.founderSeats).toBe(company.founderSeats);

      // Hype = hype × 0.8, +15 launch, +10 raise, +5 for growing 25%+ over the last close, −10 layoffs; 0–100.
      const grew = users.open > 0 && users.end >= 1.25 * users.open;
      const bonuses = (report.quality.launchedNow ? 15 : 0) + (raise ? 10 : 0) + (grew ? 5 : 0) - (report.headcount.laidOff > 0 ? 10 : 0);
      expect(report.hype.start).toBe(company.hype);
      expect(Math.abs(report.hype.end - Math.min(100, Math.max(0, company.hype * 0.8 + bonuses)))).toBeLessThan(1e-3);

      // Valuation = end users × $150 × (1 + end hype/100) × this turn's climate.
      expect(Math.abs(report.valuation - users.end * 150 * (1 + report.hype.end / 100) * climate)).toBeLessThanOrEqual(1);

      // Bankruptcy = ending the turn below $0 (an IPO ends the game before anyone goes out).
      if (log.outcome?.kind !== "ipo") expect(report.out === "bankrupt").toBe(report.cash.end < 0);
      if (report.out) {
        if (report.out === "bankrupt") seen.bankruptcies++;
        exits += users.end;
        expect(after).toMatchObject({ users: 0, out: { turn: state.turn, users: users.end } });
      } else {
        // The company's record carries the quarter forward.
        expect(after).toMatchObject({
          out: null,
          usersAtLastClose: users.end,
          cash: report.cash.end,
          price: report.plan.price,
          lastRevenue: report.revenue,
          lastCosts: lines.total,
          lastQuarter: { usersAtOpen: users.open, usersLostToEvent: users.lostToEvent, usersChurned: users.churned, usersWon: users.won },
        });
      }
    }

    // The pool and its split by largest remainder: everyone gets their exact share rounded down or up.
    expect(market.churned).toBe(churned);
    expect(market.pool).toBe(market.newUsers + market.carriedIn + churned);
    if (totalPull > 0) {
      expect(won).toBe(market.pool);
      expect(market.carriedOut).toBe(exits); // nothing unclaimed; only what exits released (finding MM-4)
      for (const { users } of launched) {
        expect(Math.abs(users.won - (market.pool * users.pull) / totalPull)).toBeLessThan(1 + 1e-6);
        if (market.pool > 0) expect(users.share).toBeCloseTo(users.won / market.pool, 9);
      }
    } else {
      seen.waitingPools++; // nobody has any pull: the whole pool waits
      expect(won).toBe(0);
      expect(market.carriedOut).toBe(market.pool + exits);
    }

    // Ruling 1: users are conserved. What waits for the next split is the unclaimed pool, the users of
    // companies that went out, and whatever the next turn's breach took.
    expect(usersInSystem(turn.state)).toBe(usersInSystem(state) + market.newUsers);
    let breach = 0;
    for (const company of turn.state.companies) {
      expect(Number.isInteger(company.users) && company.users >= 0).toBe(true);
      if (!company.out) breach += company.usersAtLastClose - company.users;
    }
    if (breach > 0) seen.breaches++;
    expect(turn.state.carryOverUsers).toBe(market.pool - won + exits + breach);
  };

  it.each(Array.from({ length: 40 }, (_, index) => index + 1))("game with seed %i", (seed) => {
    let state = startupsOnly(seed) ? onlyActive(newGame(EVENTS_ON), [HUMAN, BLITZ, BOOT]) : newGame(EVENTS_ON);
    for (let turns = 0; state.outcome === null && turns < 20; turns++) {
      const plans = scriptedPlans(state, seed);
      const turn = play(state, plans, EVENTS_ON, seed);
      audit(state, plans, turn);
      state = turn.state;
    }
    expect(state.outcome).not.toBeNull(); // a game lasts up to 20 turns
  });

  it("the games above exercised what they claim to check", () => {
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(0);
  });
});
