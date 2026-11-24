// Black-box tests for the "team and product" rules: coordination drag, the fundraiser, salaries,
// product quality and launch, the Incumbent's catch-up, hiring, layoffs and poaching.
//
// Written from docs/turn-based-design.md alone (the design first, then the rulings); the author
// did not read the engine or its own tests. Every expected number is worked out by hand in the
// comment above it. A test marked "// FINDING <id>" fails on purpose: it shows a place where the
// engine and the document part ways.
//
// Powers used below, x^e = exp(e × ln x):
//   2^0.9 = 1.866066   3^0.9 = 2.687875   4^0.9 = 3.482202   5^0.9 = 4.256700   8^0.9 = 6.498019
//   10^0.9 = 7.943282  40^0.9 = 27.660116  3^0.8 = 2.408225   4^0.8 = 3.031433   8^0.8 = 5.278032

import { describe, expect, it } from "vitest";
import { DESIGN as FROZEN } from "../../config.design";
import { resolveTurn } from "../index";
import { firstFloat, STREAM } from "../rng";
import {
  BLITZ,
  BOOT,
  HUMAN,
  INCUMBENT,
  launchedCompany,
  newGame as newGameWith,
  onlyActive,
  planOf,
  reportFor,
  resolve as resolveWith,
  seedWhere,
  withCompany,
  withState,
} from "../testKit";
import type { Allocation, Company, CompanyId, CompanyReport, GameState, Plan, RulesConfig } from "../types";

// ── The numbers and the helpers ──

/**
 * The design's starting numbers, written out from docs/turn-based-design.md on top of the frozen copy in
 * src/config.design.ts (which supplies the event deck and any field added later). The tests below run on
 * these, so they go on checking the rules after src/config.ts has been tuned.
 */
const DESIGN: RulesConfig = {
  ...FROZEN,
  game: { ...FROZEN.game, maxTurns: 20 },
  ipo: { ...FROZEN.ipo, users: 250_000 },
  archetypes: {
    startup: {
      ...FROZEN.archetypes.startup,
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
      ...FROZEN.archetypes.incumbent,
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
  hiring: { ...FROZEN.hiring, candidatesPerTurn: 6, capacityPerWork: 2, fee: 10_000 },
  poach: {
    ...FROZEN.poach,
    cost: 50_000,
    baseChance: 0.5,
    chancePerHypePoint: 0.005,
    minChance: 0.1,
    maxChance: 0.9,
    minTargetHeadcount: 2,
  },
  layoff: { ...FROZEN.layoff, severance: 20_000, hype: -10 },
  quality: { ...FROZEN.quality, gainPerWork: 5, decay: 2, launchAt: 10 },
  market: { ...FROZEN.market, newUsersTurn1: 20_000, growthPerTurn: 0.1 },
  pull: { ...FROZEN.pull, growthCoefficient: 0.3, marketingCoefficient: 0.5, marketingStep: 25_000 },
  priceTiers: {
    budget: { ...FROZEN.priceTiers.budget, price: 2, pullFactor: 1.25, churnDelta: -0.02 },
    standard: { ...FROZEN.priceTiers.standard, price: 3, pullFactor: 1, churnDelta: 0 },
    premium: { ...FROZEN.priceTiers.premium, price: 5, pullFactor: 0.75, churnDelta: 0.04 },
  },
  churn: { ...FROZEN.churn, base: 0.12, perQualityPoint: 0.0008, min: 0.02 },
  raise: { ...FROZEN.raise, minUsers: 1_000, cooldownTurns: 2, options: [10, 20, 30] },
  valuation: { ...FROZEN.valuation, perUser: 150 },
  board: { ...FROZEN.board, fireChance: 0.3, runwayTurns: 2 },
  hype: { ...FROZEN.hype, decay: 0.2, launch: 15, raise: 10, growth: 5, growthThreshold: 0.25 },
  events: { ...FROZEN.events, firstTurn: 3, chance: 0.5 },
};

/** The same rules with no event ever drawn, so games of several turns stay predictable. */
const NO_EVENTS: RulesConfig = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };

type Patches = Readonly<Record<number, Partial<Plan>>>;

const newGame = (config: RulesConfig = DESIGN): GameState => newGameWith(config);

/** One turn with everyone's default plan plus the given changes. */
const resolve = (state: GameState, patches: Patches = {}, seed = 1, config: RulesConfig = DESIGN) =>
  resolveWith(state, patches, seed, config);

/** HUMAN's report for a turn in which only HUMAN's plan departs from the defaults. */
const human = (state: GameState, plan: Partial<Plan> = {}, seed = 1, config: RulesConfig = DESIGN): CompanyReport =>
  reportFor(resolve(state, { [HUMAN]: plan }, seed, config), HUMAN);

const split = (product: number, growth: number, recruiting: number): Allocation => ({ product, growth, recruiting });

/** A team of `size`, with last quarter's closing headcount in step so nobody looks lost to an event. */
const staffed = (state: GameState, id: CompanyId, size: number, patch: Partial<Company> = {}): GameState =>
  withCompany(state, id, { headcount: size, headcountAtLastClose: size, ...patch });

/** One company alone in the game (the game ends that turn, but the turn is resolved in full). */
const solo = (id: CompanyId = HUMAN): GameState => onlyActive(newGame(), [id]);

/** Two fresh startups, HUMAN and BOOT: 3 people, hype 10, quality 0, $500K each. */
const pair = (): GameState => onlyActive(newGame(), [HUMAN, BOOT]);

/** HUMAN and BOOT with chosen start-of-turn hype. */
const hypePair = (humanHype: number, bootHype: number): GameState =>
  withCompany(withCompany(pair(), HUMAN, { hype: humanHype }), BOOT, { hype: bootHype });

/** Three companies, so the game goes on when one of them goes out. */
const trio = (): GameState => onlyActive(newGame(), [HUMAN, BOOT, INCUMBENT]);
/** The Incumbent with nobody recruiting, so that it does not hire. */
const QUIET = { [INCUMBENT]: { allocation: split(6, 2, 0) } };

/** Nobody on Product: a startup of 3 with this plan never launches, so it has no revenue. */
const IDLE = { allocation: split(0, 3, 0) };
/** HUMAN and BOOT with all three people recruiting: capacity round(2 × 2.687875) = round(5.375751) = 5 each. */
const BOTH_RECRUIT = { [HUMAN]: { allocation: split(0, 0, 3) }, [BOOT]: { allocation: split(0, 0, 3) } };
const NO_PLANS = [null, null, null, null];

/** The roll the engine draws for `poacher`'s attempt (rulings 10 and 20). Success = roll < chance. */
const poachRoll = (seed: number, poacher: CompanyId, turn = 1): number => firstFloat(seed, turn, STREAM.poach, poacher);

/** A seed whose turn-1 poach roll for `poacher` lands in [low, high). */
const seedWithPoachRoll = (poacher: CompanyId, low: number, high: number): number =>
  seedWhere((seed) => poachRoll(seed, poacher) >= low && poachRoll(seed, poacher) < high);

/** HUMAN's roll is under every possible chance (the floor is 10%) / over every possible chance (the ceiling is 90%). */
const POACH_WINS = seedWithPoachRoll(HUMAN, 0, 0.05);
const POACH_FAILS = seedWithPoachRoll(HUMAN, 0.95, 1);

// ── Coordination drag ──

describe("coordination drag: effective work = headcount^0.9 (Incumbent ^0.8), split by people", () => {
  it("a startup of 3 with everyone on Product does 3^0.9 = 2.687875", () => {
    const { work } = human(solo());
    // 3^0.9 = exp(0.9 × ln 3) = exp(0.9 × 1.098612) = exp(0.988751) = 2.687875
    expect(work.effective).toBeCloseTo(2.687875, 4);
    expect(work.product).toBeCloseTo(2.687875, 4);
    expect(work.growth).toBe(0);
    expect(work.recruiting).toBe(0);
  });

  it("the work is split across departments in proportion to the people in each", () => {
    // 2 on Product, 1 on Growth: 2.687875 × 2/3 = 1.791917 and 2.687875 × 1/3 = 0.895958
    const twoOne = human(solo(), { allocation: split(2, 1, 0) }).work;
    expect(twoOne.product).toBeCloseTo(1.791917, 4);
    expect(twoOne.growth).toBeCloseTo(0.895958, 4);
    expect(twoOne.recruiting).toBe(0);
    // One each: 2.687875 / 3 = 0.895958 per department
    const even = human(solo(), { allocation: split(1, 1, 1) }).work;
    for (const share of [even.product, even.growth, even.recruiting]) expect(share).toBeCloseTo(0.895958, 4);
  });

  it("the Incumbent's 8 people do 8^0.8 = 5.278032, split 5/2/1", () => {
    const { work } = reportFor(resolve(solo(INCUMBENT)), INCUMBENT);
    // 8^0.8 = 2^2.4 = 5.278032; 5/8 of it = 3.298770, 2/8 = 1.319508, 1/8 = 0.659754
    expect(work.effective).toBeCloseTo(5.278032, 4);
    expect(work.product).toBeCloseTo(3.29877, 4);
    expect(work.growth).toBeCloseTo(1.319508, 4);
    expect(work.recruiting).toBeCloseTo(0.659754, 4);
  });

  it("the exponent belongs to the kind of company, not the size of the team", () => {
    // A startup grown to 8 still uses ^0.9: 8^0.9 = 6.498019 (8^0.8 would be 5.278032).
    expect(human(staffed(solo(), HUMAN, 8), { allocation: split(8, 0, 0) }).work.effective).toBeCloseTo(6.498019, 4);
    // An Incumbent cut to 3 still uses ^0.8: 3^0.8 = 2.408225 (3^0.9 would be 2.687875).
    const small = resolve(staffed(solo(INCUMBENT), INCUMBENT, 3), { [INCUMBENT]: { allocation: split(3, 0, 0) } });
    expect(reportFor(small, INCUMBENT).work.effective).toBeCloseTo(2.408225, 4);
  });

  it("one person does exactly 1; ten do 10^0.9 = 7.943282", () => {
    expect(human(staffed(solo(), HUMAN, 1), { allocation: split(1, 0, 0) }).work.product).toBeCloseTo(1, 6);
    const ten = human(staffed(solo(), HUMAN, 10, { cash: 2_000_000 }), { allocation: split(5, 3, 2) }).work;
    // 10^0.9 = exp(0.9 × 2.302585) = 7.943282; 5/10 → 3.971641, 3/10 → 2.382985, 2/10 → 1.588656
    expect(ten.effective).toBeCloseTo(7.943282, 4);
    expect(ten.product).toBeCloseTo(3.971641, 4);
    expect(ten.growth).toBeCloseTo(2.382985, 4);
    expect(ten.recruiting).toBeCloseTo(1.588656, 4);
  });

  it("a split that does not add up is refitted in proportion, and the report says so (ruling 2)", () => {
    // 15 placed as 5/5/5 on a team of 3 → 1/1/1; 2 placed as 1/1/0 on a team of 4 → 2/2/0.
    const over = human(solo(), { allocation: split(5, 5, 5) });
    expect(over.plan.allocation).toEqual(split(1, 1, 1));
    expect(over.notes.length).toBeGreaterThan(0);
    const under = human(staffed(solo(), HUMAN, 4), { allocation: split(1, 1, 0) });
    expect(under.plan.allocation).toEqual(split(2, 2, 0));
    expect(under.notes.length).toBeGreaterThan(0);
    // A plan that places nobody still ends up with all 3 people placed somewhere.
    const { product, growth, recruiting } = human(solo(), { allocation: split(0, 0, 0) }).plan.allocation;
    expect(product + growth + recruiting).toBe(3);
  });

  it("the default assignment is last turn's split, refitted in proportion if the team has changed", () => {
    // Turn 1: one each, hiring switched off. Turn 2, with no plan handed in: one each again.
    const same = resolve(pair(), { [HUMAN]: { allocation: split(1, 1, 1), hireLimit: 0 } }, 1, NO_EVENTS);
    expect(planOf(same.state, HUMAN).allocation).toEqual(split(1, 1, 1));
    expect(reportFor(resolveTurn(same.state, NO_PLANS, 1, NO_EVENTS), HUMAN).plan.allocation).toEqual(split(1, 1, 1));
    // 2 people split 1/0/1: recruiting work 2^0.9 × 1/2 = 0.933033, capacity round(1.866066) = 2.
    // Two hires arrive, so turn 2 has 4 people and the same proportions give 2/0/2.
    const grown = resolve(staffed(pair(), HUMAN, 2), { [HUMAN]: { allocation: split(1, 0, 1) } }, 1, NO_EVENTS);
    expect(reportFor(grown, HUMAN).headcount.hired).toBe(2);
    expect(reportFor(resolveTurn(grown.state, NO_PLANS, 1, NO_EVENTS), HUMAN).plan.allocation).toEqual(split(2, 0, 2));
  });
});

// ── The fundraiser ──

describe("the fundraiser: a raise takes 1 person off other work that turn (ruling 3)", () => {
  /** HUMAN with 5 people, launched, with enough users (10,000 unless patched) to raise. */
  const raiser = (patch: Partial<Company> = {}): GameState => launchedCompany(staffed(pair(), HUMAN, 5), HUMAN, patch);

  it("the fundraiser is on payroll, and their share of the work is simply lost", () => {
    const report = human(raiser(), { raisePercent: 10, allocation: split(2, 1, 1) });
    expect(report.raise?.percent).toBe(10);
    // Payroll 5: the team does 5^0.9 = 4.256700 and each person carries a fifth of it, 0.851340.
    // Product 2/5 = 1.702680, Growth and Recruiting 1/5 = 0.851340 each; the fundraiser's fifth is lost.
    // (Were the four workers a team of 4, Product would get 4^0.9 × 2/4 = 1.741101.)
    expect(report.work.effective).toBeCloseTo(4.2567, 4);
    expect(report.work.product).toBeCloseTo(1.70268, 4);
    expect(report.work.growth).toBeCloseTo(0.85134, 4);
    expect(report.work.recruiting).toBeCloseTo(0.85134, 4);
    // The fundraiser is paid like everyone else: 5 × $40,000.
    expect(report.costs.salaries).toBe(200_000);
  });

  it("a raising plan that still places all five is refitted to the four available (ruling 2)", () => {
    const report = human(raiser(), { raisePercent: 10, allocation: split(5, 0, 0) });
    expect(report.plan.allocation).toEqual(split(4, 0, 0));
    expect(report.notes.length).toBeGreaterThan(0);
    // 5^0.9 × 4/5 = 3.405360
    expect(report.work.product).toBeCloseTo(3.40536, 4);
  });

  it("with exactly 1,000 users the raise goes ahead; with 999 it is dropped and nobody comes off work", () => {
    const plan = { raisePercent: 10, allocation: split(4, 0, 0) };
    const allowed = human(raiser({ users: 1_000 }), plan);
    expect(allowed.raise?.percent).toBe(10);
    // 5^0.9 × 4/5 = 3.405360
    expect(allowed.work.product).toBeCloseTo(3.40536, 4);
    const dropped = human(raiser({ users: 999 }), plan);
    expect(dropped.raise).toBeNull();
    expect(dropped.plan.raisePercent).toBe(0);
    expect(dropped.notes.length).toBeGreaterThan(0);
    // All five are available again: 4/0/0 is refitted to 5/0/0 and Product gets the whole 4.256700.
    expect(dropped.plan.allocation).toEqual(split(5, 0, 0));
    expect(dropped.work.product).toBeCloseTo(4.2567, 4);
  });

  it("a solo founder who raises does no other work that turn", () => {
    const state = launchedCompany(staffed(pair(), HUMAN, 1), HUMAN);
    const report = human(state, { raisePercent: 10, allocation: split(1, 0, 0) });
    expect(report.raise?.percent).toBe(10);
    // Available = headcount − layoffs − 1 if raising = 1 − 0 − 1 = 0.
    expect(report.plan.allocation).toEqual(split(0, 0, 0));
    expect(report.work.product + report.work.growth + report.work.recruiting).toBe(0);
    // No Product work, so quality only decays: 50 + 0 − 2 = 48. The founder is still paid $40,000.
    expect(report.quality.end).toBe(48);
    expect(report.costs.salaries).toBe(40_000);
  });

  it("layoffs and a raise in the same turn: payroll 4, three people working", () => {
    const report = human(raiser(), { layoffs: 1, raisePercent: 10, allocation: split(3, 0, 0) });
    // Available = 5 − 1 laid off − 1 fundraiser = 3, so the split stands; payroll = 5 − 1 = 4.
    expect(report.plan.allocation).toEqual(split(3, 0, 0));
    // 4^0.9 = 3.482202; Product gets 3/4 of it = 2.611652.
    expect(report.work.product).toBeCloseTo(2.611652, 4);
    // Salaries 4 × $40,000; severance 1 × $20,000.
    expect(report.costs.salaries).toBe(160_000);
    expect(report.costs.severance).toBe(20_000);
  });

  it("the fundraiser comes off recruiting too", () => {
    // Raising, the other four recruiting: 4.256700 × 4/5 = 3.405360; capacity = round(6.810719) = 7.
    expect(human(raiser(), { raisePercent: 10, allocation: split(0, 0, 4) }).hiring.capacity).toBe(7);
    // Not raising, all five recruiting: capacity = round(2 × 4.256700) = round(8.513399) = 9.
    expect(human(raiser(), { allocation: split(0, 0, 5) }).hiring.capacity).toBe(9);
  });
});

// ── Salaries ──

describe("salaries: $40K per person per quarter", () => {
  it("$120K for a startup of 3, $320K for the Incumbent's 8", () => {
    expect(newGame().companies.map((company) => company.headcount)).toEqual([3, 3, 3, 8]);
    const result = resolve(newGame());
    // 3 × $40,000 = $120,000 and 8 × $40,000 = $320,000
    expect([HUMAN, BLITZ, BOOT, INCUMBENT].map((id) => reportFor(result, id).costs.salaries)).toEqual([
      120_000, 120_000, 120_000, 320_000,
    ]);
  });

  it("depends only on headcount, not on what people do", () => {
    // 1 × $40,000 and 10 × $40,000
    expect(human(staffed(solo(), HUMAN, 1), { allocation: split(0, 1, 0) }).costs.salaries).toBe(40_000);
    const ten = staffed(solo(), HUMAN, 10, { cash: 2_000_000 });
    expect(human(ten, { allocation: split(4, 3, 3) }).costs.salaries).toBe(400_000);
  });

  it("laid-off people get severance instead of a salary (ruling 8)", () => {
    // Nobody on Product, so HUMAN stays unlaunched and has no revenue to muddy the cash.
    const report = human(staffed(pair(), HUMAN, 5), { layoffs: 2, allocation: split(0, 3, 0) });
    // Salaries (5 − 2) × $40,000 = $120,000; severance 2 × $20,000 = $40,000; cash $500,000 − $160,000.
    expect(report.costs).toMatchObject({ salaries: 120_000, severance: 40_000, total: 160_000 });
    expect(report.revenue).toBe(0);
    expect(report.cash.end).toBe(340_000);
  });

  it("new hires start next turn: no salary and no work in the turn they are hired", () => {
    // All 3 on Recruiting: capacity 5, and BOOT is not hiring.
    const start = withCompany(pair(), HUMAN, { cash: 1_000_000 });
    const first = resolve(start, { [HUMAN]: { allocation: split(0, 0, 3) } }, 1, NO_EVENTS);
    const hiringTurn = reportFor(first, HUMAN);
    expect(hiringTurn.headcount.hired).toBe(5);
    // This turn: still 3 salaries and 3 people's work (3^0.9), plus 5 × $10,000 in fees.
    expect(hiringTurn.costs).toMatchObject({ salaries: 120_000, hiring: 50_000 });
    expect(hiringTurn.work.effective).toBeCloseTo(2.687875, 4);
    expect(first.state.companies[HUMAN].headcount).toBe(8);
    // Next turn: 8 × $40,000 = $320,000 and 8^0.9 = 6.498019.
    const next = reportFor(resolve(first.state, { [HUMAN]: { allocation: split(8, 0, 0) } }, 1, NO_EVENTS), HUMAN);
    expect(next.headcount.start).toBe(8);
    expect(next.costs.salaries).toBe(320_000);
    expect(next.work.effective).toBeCloseTo(6.498019, 4);
  });

  it("someone lost to burnout before the turn is off the payroll, and not there to lay off", () => {
    // Burnout took one of HUMAN's 3 when the event was revealed, so the turn starts with 2.
    const state = withState(withCompany(pair(), HUMAN, { headcount: 2 }), { event: { cardId: "burnout", targetId: HUMAN } });
    const report = human(state, { layoffs: 2, allocation: split(1, 0, 0) });
    // At most headcount − 1 = 1 can go: one salary ($40,000), one severance ($20,000), 1^0.9 = 1 of work.
    expect(report.headcount).toMatchObject({ start: 2, lostToEvent: 1, laidOff: 1, end: 1 });
    expect(report.costs).toMatchObject({ salaries: 40_000, severance: 20_000 });
    expect(report.work.effective).toBeCloseTo(1, 6);
  });

  it("the total is the sum of its parts, and cash moves by revenue minus costs", () => {
    const result = resolve(newGame());
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) {
      const { costs, cash, revenue } = reportFor(result, id);
      expect(costs.total).toBe(costs.salaries + costs.marketing + costs.hiring + costs.poaching + costs.severance);
      expect(cash.end).toBe(cash.start + revenue - costs.total);
    }
  });

  it("cash that exactly covers the salaries ends at $0 and the company stays in; $1 short is bankrupt", () => {
    // Unlaunched, so no revenue; costs are 3 × $40,000 = $120,000.
    const exact = human(withCompany(pair(), HUMAN, { cash: 120_000 }), IDLE);
    expect(exact.cash.end).toBe(0);
    expect(exact.out).toBeNull();
    const short = human(withCompany(pair(), HUMAN, { cash: 119_999 }), IDLE);
    expect(short.cash.end).toBe(-1);
    expect(short.out).toBe("bankrupt");
  });
});

// ── Product quality and launch ──

describe("product quality: +5 × Product work × (1 − quality/100), then −2 decay (ruling 4)", () => {
  it("turn 1, three people on Product: 0 → 11.44; the product launches and competes that same turn", () => {
    const result = resolve(solo());
    const report = reportFor(result, HUMAN);
    // gain = 5 × 2.687875 × (1 − 0/100) = 13.439377; 0 + 13.439377 − 2 = 11.439377, over 10.
    expect(report.quality.gain).toBeCloseTo(13.439377, 4);
    expect(report.quality.decay).toBe(2);
    expect(report.quality.end).toBeCloseTo(11.439377, 3);
    expect(report.quality.launchedNow).toBe(true);
    expect(result.state.companies[HUMAN]).toMatchObject({ launched: true, quality: report.quality.end });
    // Alone in the market it takes all 20,000 new users: revenue 20,000 × $3 = $60,000.
    expect(report.users).toMatchObject({ won: 20_000, end: 20_000 });
    expect(report.revenue).toBe(60_000);
    // Launching is worth +15 hype: 10 × 0.8 + 15 = 23.
    expect(report.hype.launch).toBe(15);
    expect(report.hype.end).toBeCloseTo(23, 6);
  });

  it.each([
    // gain = 13.439377 × (1 − 50/100) = 6.719688; 50 + 6.719688 − 2 = 54.719688
    // (decay first would give 48 + 13.439377 × 0.52 = 54.988476: the gain uses the starting quality)
    { start: 50, gain: 6.719688, end: 54.719688 },
    // gain = 13.439377 × (1 − 90/100) = 1.343938; 90 + 1.343938 − 2 = 89.343938 (the decay now wins)
    { start: 90, gain: 1.343938, end: 89.343938 },
    // gain = 13.439377 × (1 − 100/100) = 0; 100 + 0 − 2 = 98
    { start: 100, gain: 0, end: 98 },
  ])("returns diminish: from quality $start the gain is $gain and the turn ends at $end", ({ start, gain, end }) => {
    const { quality } = human(launchedCompany(solo(), HUMAN, { quality: start }));
    expect(quality.gain).toBeCloseTo(gain, 4);
    expect(quality.end).toBeCloseTo(end, 3);
  });

  it.each([
    // 40 − 2 = 38;  2 − 2 = 0;  1 − 2 = −1 → 0;  0 − 2 = −2 → 0
    { start: 40, end: 38 },
    { start: 2, end: 0 },
    { start: 1, end: 0 },
    { start: 0, end: 0 },
  ])("with nobody on Product quality just decays, never below 0: $start → $end", ({ start, end }) => {
    const result = resolve(withCompany(solo(), HUMAN, { quality: start, launched: start >= 10 }), { [HUMAN]: IDLE });
    expect(reportFor(result, HUMAN).quality).toMatchObject({ gain: 0, end });
    expect(result.state.companies[HUMAN].quality).toBe(end);
  });

  it("never above 100: gain, then decay, then clamp", () => {
    // 40 people on Product: gain = 5 × 27.660116 × (1 − 0/100) = 138.300578.
    // 0 + 138.300578 − 2 = 136.300578 → clamped to 100. (Clamping before the decay would give 98.)
    const report = human(staffed(solo(), HUMAN, 40, { cash: 10_000_000 }), { allocation: split(40, 0, 0) });
    expect(report.quality.end).toBe(100);
  });
});

describe("launch: at quality 10 or above after the decay; no users before launch (ruling 4)", () => {
  it("exactly 10 after the decay launches; 9.99 does not", () => {
    // Unlaunched at 12 with nobody on Product: 12 + 0 − 2 = 10. It competes at once: all 20,000 new users.
    const onTheLine = resolve(withCompany(solo(), HUMAN, { quality: 12 }), { [HUMAN]: IDLE });
    expect(reportFor(onTheLine, HUMAN).quality).toMatchObject({ end: 10, launchedNow: true });
    expect(onTheLine.state.companies[HUMAN].launched).toBe(true);
    expect(reportFor(onTheLine, HUMAN).users.won).toBe(20_000);
    // Unlaunched at 11.99: 11.99 + 0 − 2 = 9.99.
    const justUnder = resolve(withCompany(solo(), HUMAN, { quality: 11.99 }), { [HUMAN]: IDLE });
    expect(reportFor(justUnder, HUMAN).quality.end).toBeCloseTo(9.99, 6);
    expect(reportFor(justUnder, HUMAN).quality.launchedNow).toBe(false);
    expect(justUnder.state.companies[HUMAN].launched).toBe(false);
    expect(reportFor(justUnder, HUMAN).users.won).toBe(0);
  });

  it("a gain that lands exactly on 10 launches; a hair less does not (numbers chosen to be exact)", () => {
    // With a work exponent of 1, three people on Product do exactly 3.
    const archetypes = { ...DESIGN.archetypes, startup: { ...DESIGN.archetypes.startup, workExponent: 1 } };
    const gainPerWork = (value: number): RulesConfig => ({
      ...DESIGN,
      archetypes,
      quality: { ...DESIGN.quality, gainPerWork: value },
    });
    // gain = 4 × 3 × (1 − 0/100) = 12; 0 + 12 − 2 = 10 → launches.
    expect(human(solo(), {}, 1, gainPerWork(4)).quality.launchedNow).toBe(true);
    // gain = 3.99 × 3 = 11.97; 0 + 11.97 − 2 = 9.97 → does not.
    const short = human(solo(), {}, 1, gainPerWork(3.99)).quality;
    expect(short.end).toBeCloseTo(9.97, 3);
    expect(short.launchedNow).toBe(false);
  });

  // Finding TP-1, settled by ruling 24: quality is kept to four decimals and thresholds read the stored figure.
  it("9.99997 after the decay is stored as 10.0000, and that is what the launch test reads (ruling 24)", () => {
    // Unlaunched at 3.3396, two of three people on Product (work 2.687875 × 2/3 = 1.791917):
    // gain = 5 × 1.791917 × (1 − 3.3396/100) = 8.959585 × 0.966604 = 8.660370
    // 3.3396 + 8.660370 − 2 = 9.999970, kept as 10.0000.
    const result = resolve(withCompany(solo(), HUMAN, { quality: 3.3396 }), { [HUMAN]: { allocation: split(2, 1, 0) } });
    expect(reportFor(result, HUMAN).quality.end).toBe(10);
    expect(reportFor(result, HUMAN).quality.launchedNow).toBe(true);
    expect(result.state.companies[HUMAN].launched).toBe(true);
  });

  it("the test is made after the decay, not before it; and decay applies before launch too", () => {
    // Unlaunched at 3, two of three on Product: gain = 5 × 1.791917 × (1 − 3/100) = 8.690797.
    // Before the decay that is 11.690797 (over 10); after it 9.690797 (under 10) → no launch.
    const report = human(withCompany(solo(), HUMAN, { quality: 3 }), { allocation: split(2, 1, 0) });
    expect(report.quality.end).toBeCloseTo(9.690797, 3);
    expect(report.quality.launchedNow).toBe(false);
    // Unlaunched at 5 with nobody on Product: 5 − 2 = 3.
    expect(human(withCompany(solo(), HUMAN, { quality: 5 }), IDLE).quality.end).toBe(3);
  });

  it("no users before launch, however much growth work and marketing there is", () => {
    // Everyone on Growth plus $100K of marketing, but quality stays 0 and the product is not out.
    const alone = resolve(solo(), { [HUMAN]: { ...IDLE, marketing: 100_000 } });
    const report = reportFor(alone, HUMAN);
    expect(report.users).toMatchObject({ won: 0, end: 0 });
    expect(report.revenue).toBe(0);
    expect(report.costs.marketing).toBe(100_000);
    // Nobody is launched, so the 20,000 new users wait for next turn (ruling 1).
    expect(alone.log.market.carriedOut).toBe(20_000);
    expect(alone.state.carryOverUsers).toBe(20_000);
    // With a rival that launches this turn (BOOT, 0 → 11.44), the rival takes them all.
    const rivalry = resolve(pair(), { [HUMAN]: { ...IDLE, marketing: 100_000 } });
    expect(reportFor(rivalry, HUMAN).users.end).toBe(0);
    expect(reportFor(rivalry, BOOT).users.won).toBe(20_000);
  });

  it("two of three people on Product: no launch on turn 1 (6.96), launch on turn 2 (13.30)", () => {
    const plan = { [HUMAN]: { allocation: split(2, 1, 0) } };
    const first = resolve(pair(), plan, 1, NO_EVENTS);
    // gain = 5 × 1.791917 × (1 − 0/100) = 8.959585; 0 + 8.959585 − 2 = 6.959585
    expect(reportFor(first, HUMAN).quality.end).toBeCloseTo(6.959585, 3);
    expect(reportFor(first, HUMAN).quality.launchedNow).toBe(false);
    expect(reportFor(first, HUMAN).users.end).toBe(0);
    const second = reportFor(resolve(first.state, plan, 1, NO_EVENTS), HUMAN);
    // gain = 8.959585 × (1 − 6.959585/100) = 8.959585 × 0.930404 = 8.336035; 6.959585 + 8.336035 − 2 = 13.295619
    expect(second.quality.end).toBeCloseTo(13.295619, 3);
    expect(second.quality.launchedNow).toBe(true);
    expect(second.users.won).toBeGreaterThan(0);
  });

  it("a launched product stays launched under 10, and climbing back over 10 is not a second launch", () => {
    // Launched at 10.5, nobody on Product: 10.5 − 2 = 8.5. Still launched; alone, it still takes the 20,000 new users.
    const dipped = resolve(withCompany(solo(), HUMAN, { launched: true, quality: 10.5 }), { [HUMAN]: IDLE });
    expect(reportFor(dipped, HUMAN).quality.end).toBeCloseTo(8.5, 6);
    expect(reportFor(dipped, HUMAN).quality.launchedNow).toBe(false);
    expect(dipped.state.companies[HUMAN].launched).toBe(true);
    expect(reportFor(dipped, HUMAN).users.won).toBe(20_000);
    // Launched, dipped to 9, back on Product: gain = 13.439377 × (1 − 9/100) = 12.229833; 9 + 12.229833 − 2 = 19.229833.
    const back = human(withCompany(solo(), HUMAN, { launched: true, quality: 9 }));
    expect(back.quality.end).toBeCloseTo(19.229833, 3);
    expect(back.quality.launchedNow).toBe(false);
    // No second +15: hype just decays, 10 × 0.8 = 8.
    expect(back.hype.launch).toBe(0);
    expect(back.hype.end).toBeCloseTo(8, 6);
  });

  it("the Incumbent starts the game launched; the startups do not", () => {
    expect(newGame().companies.map((company) => company.launched)).toEqual([false, false, false, true]);
  });
});

// ── The Incumbent's catch-up ──

describe("catch-up: the Incumbent gets +50% product output while it trails the quality leader (ruling 5)", () => {
  /** BLITZ is a launched rival at the given quality; only it and the Incumbent are in the game. */
  const versus = (rivalQuality: number): GameState =>
    onlyActive(launchedCompany(newGame(), BLITZ, { quality: rivalQuality }), [BLITZ, INCUMBENT]);

  // The Incumbent's Product work is 8^0.8 × 5/8 = 3.298770, so from quality 30:
  //   no bonus: gain = 5 × 3.298770 × (1 − 30/100) = 11.545694;  30 + 11.545694 − 2 = 39.545694
  //   catch-up: gain = 11.545694 × 1.5 = 17.318541;              30 + 17.318541 − 2 = 45.318541
  const PLAIN = 39.545694;
  const BOOSTED = 45.318541;

  it.each([
    { label: "it leads (new game, startups at 0)", state: () => newGame(), catchUp: false, end: PLAIN },
    { label: "it trails a launched rival at 50", state: () => versus(50), catchUp: true, end: BOOSTED },
    { label: "it is level with the leader at 30", state: () => versus(30), catchUp: false, end: PLAIN },
    { label: "the leader is a hair ahead at 30.01", state: () => versus(30.01), catchUp: true, end: BOOSTED },
    { label: "the best rival is a hair behind at 29.99", state: () => versus(29.99), catchUp: false, end: PLAIN },
    {
      label: "the better rival (80) is already out of the game",
      state: () => onlyActive(launchedCompany(newGame(), BLITZ, { quality: 80 }), [HUMAN, INCUMBENT]),
      catchUp: false,
      end: PLAIN,
    },
    {
      label: "launched rivals stand at 25 and 40 (the best one counts)",
      state: () => launchedCompany(launchedCompany(newGame(), HUMAN, { quality: 25 }), BLITZ, { quality: 40 }),
      catchUp: true,
      end: BOOSTED,
    },
  ])("when $label: catch-up $catchUp, quality ends at $end", ({ state, catchUp, end }) => {
    const { quality } = reportFor(resolve(state()), INCUMBENT);
    expect(quality.catchUp).toBe(catchUp);
    // end = 30 + gain − 2, so gain = end − 28
    expect(quality.gain).toBeCloseTo(end - 28, 4);
    expect(quality.end).toBeCloseTo(end, 3);
  });

  it("a better product that has not launched yet is nothing to copy", () => {
    // The Incumbent has slid to 5; HUMAN is at 8 but unlaunched.
    const slid = withCompany(withCompany(newGame(), INCUMBENT, { quality: 5 }), HUMAN, { quality: 8 });
    const { quality } = reportFor(resolve(onlyActive(slid, [HUMAN, INCUMBENT])), INCUMBENT);
    expect(quality.catchUp).toBe(false);
    // gain = 5 × 3.298770 × (1 − 5/100) = 15.669156; 5 + 15.669156 − 2 = 18.669156 (26.503735 with the bonus)
    expect(quality.end).toBeCloseTo(18.669156, 3);
  });

  it("it is decided on the qualities the turn starts with", () => {
    // BLITZ starts just behind (29.5) with 10 people on Product: gain = 5 × 7.943282 × (1 − 29.5/100) = 28.000070,
    // ending at 29.5 + 28.000070 − 2 = 55.500070. The Incumbent started ahead: no bonus this turn, bonus the next.
    const rich = staffed(launchedCompany(newGame(), BLITZ, { quality: 29.5 }), BLITZ, 10, { cash: 5_000_000 });
    const plan = { [BLITZ]: { allocation: split(10, 0, 0) } };
    const overtaken = resolve(onlyActive(rich, [BLITZ, INCUMBENT]), plan, 1, NO_EVENTS);
    expect(reportFor(overtaken, BLITZ).quality.end).toBeCloseTo(55.50007, 3);
    expect(reportFor(overtaken, INCUMBENT).quality.catchUp).toBe(false);
    expect(reportFor(overtaken, INCUMBENT).quality.end).toBeCloseTo(PLAIN, 3);
    expect(reportFor(resolve(overtaken.state, plan, 1, NO_EVENTS), INCUMBENT).quality.catchUp).toBe(true);
    // BLITZ starts just ahead (31) with 3 on Product: gain = 13.439377 × (1 − 31/100) = 9.273170 → 38.273170.
    // The Incumbent started behind: bonus all turn (→ 45.318541, now ahead), no bonus the next.
    const overtaking = resolve(versus(31), {}, 1, NO_EVENTS);
    expect(reportFor(overtaking, BLITZ).quality.end).toBeCloseTo(38.27317, 3);
    expect(reportFor(overtaking, INCUMBENT).quality.catchUp).toBe(true);
    expect(reportFor(overtaking, INCUMBENT).quality.end).toBeCloseTo(BOOSTED, 3);
    expect(reportFor(resolve(overtaking.state, {}, 1, NO_EVENTS), INCUMBENT).quality.catchUp).toBe(false);
  });

  it("startups never get it, and half as much again of no Product work is still nothing", () => {
    // HUMAN (launched, 20) trails BLITZ (launched, 50): gain = 13.439377 × (1 − 20/100) = 10.751502;
    // 20 + 10.751502 − 2 = 28.751502 (34.127252 with a bonus).
    const both = launchedCompany(launchedCompany(newGame(), BLITZ, { quality: 50 }), HUMAN, { quality: 20 });
    const { quality } = human(onlyActive(both, [HUMAN, BLITZ]));
    expect(quality.catchUp).toBe(false);
    expect(quality.end).toBeCloseTo(28.751502, 3);
    // The Incumbent trailing with nobody on Product: 30 + 0 − 2 = 28.
    const idle = reportFor(resolve(versus(50), { [INCUMBENT]: { allocation: split(0, 8, 0) } }), INCUMBENT);
    expect(idle.quality).toMatchObject({ gain: 0, end: 28 });
  });
});

// ── Hiring ──

describe("hiring capacity = 2 × Recruiting effective work, rounded", () => {
  it.each([
    { kind: "startup", who: HUMAN, size: 3, team: split(3, 0, 0), capacity: 0 },
    // 2 × 2.687875 × 1/3 = 1.791917 → 2 (rounded up, not floored)
    { kind: "startup", who: HUMAN, size: 3, team: split(2, 0, 1), capacity: 2 },
    // 2 × 2.687875 × 2/3 = 3.583834 → 4
    { kind: "startup", who: HUMAN, size: 3, team: split(1, 0, 2), capacity: 4 },
    // 2 × 2.687875 = 5.375751 → 5 (rounded down, not up)
    { kind: "startup", who: HUMAN, size: 3, team: split(0, 0, 3), capacity: 5 },
    // 2 × 1^0.9 = 2 exactly
    { kind: "startup", who: HUMAN, size: 1, team: split(0, 0, 1), capacity: 2 },
    // 2 × 6^0.9 × 3/6 = 2 × 5.015753 × 0.5 = 5.015753 → 5
    { kind: "startup", who: HUMAN, size: 6, team: split(3, 0, 3), capacity: 5 },
    // 2 × 6.498019 × 4/8 = 6.498019 → 6 (just under the half)
    { kind: "startup", who: HUMAN, size: 8, team: split(4, 0, 4), capacity: 6 },
    // 2 × 5.278032 × 1/8 = 1.319508 → 1
    { kind: "Incumbent", who: INCUMBENT, size: 8, team: split(5, 2, 1), capacity: 1 },
    // 2 × 5.278032 × 2/8 = 2.639016 → 3
    { kind: "Incumbent", who: INCUMBENT, size: 8, team: split(6, 0, 2), capacity: 3 },
    // 2 × 5.278032 = 10.556063 → 11
    { kind: "Incumbent", who: INCUMBENT, size: 8, team: split(0, 0, 8), capacity: 11 },
    // 2 × 3.031433 × 3/4 = 4.547150 → 5 (just over the half)
    { kind: "Incumbent", who: INCUMBENT, size: 4, team: split(1, 0, 3), capacity: 5 },
  ])("$kind of $size with $team.recruiting recruiting → capacity $capacity", ({ who, size, team, capacity }) => {
    const state = staffed(solo(who), who, size, { cash: 10_000_000 });
    const report = reportFor(resolve(state, { [who]: { allocation: team } }), who);
    // With no "hire at most" limit a company wants its whole capacity, and there are 6 candidates.
    expect(report.hiring).toEqual({ capacity, wanted: capacity, hired: Math.min(capacity, 6) });
  });

  it("an exact half rounds up (numbers chosen to be exact)", () => {
    // Work exponent 1: 3 people do 3 and one recruiter carries exactly 1. At 2.5 per unit of work: 2.5 → 3.
    const config: RulesConfig = {
      ...DESIGN,
      archetypes: { ...DESIGN.archetypes, startup: { ...DESIGN.archetypes.startup, workExponent: 1 } },
      hiring: { ...DESIGN.hiring, capacityPerWork: 2.5 },
    };
    expect(human(solo(), { allocation: split(2, 0, 1) }, 1, config).hiring.capacity).toBe(3);
  });
});

describe("hiring: 6 candidates a turn, $10K a hire, and the 'hire at most' limit (ruling 9)", () => {
  it("each hire costs $10K and joins the headcount", () => {
    const result = resolve(solo(), { [HUMAN]: { allocation: split(2, 0, 1) } });
    const report = reportFor(result, HUMAN);
    // Capacity 2: two of the six candidates are hired for 2 × $10,000, and the team becomes 3 + 2 = 5.
    expect(result.log.hiring).toEqual({ candidates: 6, picks: [HUMAN, HUMAN] });
    expect(report.costs.hiring).toBe(20_000);
    expect(report.headcount).toMatchObject({ hired: 2, end: 5 });
    expect(result.state.companies[HUMAN].headcount).toBe(5);
  });

  it("a company cannot hire more people than there are candidates, and pays only for hires made", () => {
    // The Incumbent with all 8 recruiting could take 11, but only 6 people are looking: 6 × $10,000; 8 + 6 = 14.
    const result = resolve(solo(INCUMBENT), { [INCUMBENT]: { allocation: split(0, 0, 8) } });
    const report = reportFor(result, INCUMBENT);
    expect(report.hiring).toEqual({ capacity: 11, wanted: 11, hired: 6 });
    expect(report.costs.hiring).toBe(60_000);
    expect(report.headcount.end).toBe(14);
    expect(result.log.hiring.picks).toEqual([INCUMBENT, INCUMBENT, INCUMBENT, INCUMBENT, INCUMBENT, INCUMBENT]);
  });

  it.each([
    { hireLimit: 0, wanted: 0 },
    { hireLimit: 1, wanted: 1 },
    { hireLimit: 5, wanted: 5 },
    { hireLimit: 9, wanted: 5 },
    { hireLimit: null, wanted: 5 },
  ])("'hire at most' $hireLimit with capacity 5 → wants and hires $wanted", ({ hireLimit, wanted }) => {
    // All 3 on Recruiting: capacity 5. Wanted = min(capacity, the limit); null means no limit.
    const report = human(solo(), { allocation: split(0, 0, 3), hireLimit });
    expect(report.hiring).toEqual({ capacity: 5, wanted, hired: wanted });
    expect(report.costs.hiring).toBe(wanted * 10_000);
    expect(report.headcount.end).toBe(3 + wanted);
  });

  it("unhired candidates leave: the next turn starts from 6 again", () => {
    const first = resolve(pair(), {}, 1, NO_EVENTS);
    expect(first.log.hiring).toEqual({ candidates: 6, picks: [] });
    expect(resolve(first.state, {}, 1, NO_EVENTS).log.hiring.candidates).toBe(6);
  });

  it("with no candidates nobody is hired; a single candidate goes to the company with the most hype", () => {
    const candidates = (candidatesPerTurn: number): RulesConfig => ({
      ...DESIGN,
      hiring: { ...DESIGN.hiring, candidatesPerTurn },
    });
    const none = resolve(solo(), { [HUMAN]: { allocation: split(0, 0, 3) } }, 1, candidates(0));
    expect(none.log.hiring).toEqual({ candidates: 0, picks: [] });
    expect(reportFor(none, HUMAN).costs.hiring).toBe(0);
    expect(reportFor(none, HUMAN).headcount.end).toBe(3);
    expect(resolve(hypePair(30, 20), BOTH_RECRUIT, 1, candidates(1)).log.hiring.picks).toEqual([HUMAN]);
    expect(resolve(hypePair(20, 30), BOTH_RECRUIT, 1, candidates(1)).log.hiring.picks).toEqual([BOOT]);
  });
});

describe("hiring: who is in the candidate pool (rulings 9 and 15)", () => {
  /** HUMAN and the Incumbent; in these tests the Incumbent's 8 people all recruit (capacity 11). */
  const duo = (patch: Partial<GameState> = {}): GameState => withState(onlyActive(newGame(), [HUMAN, INCUMBENT]), patch);
  const hungry = { [INCUMBENT]: { allocation: split(0, 0, 8) } };
  const twoLaidOff = { [HUMAN]: { layoffs: 2, allocation: split(1, 0, 0) } };
  const glut: Partial<GameState> = {
    event: { cardId: "talent-glut", targetId: null },
    modifiers: { newUsers: 1, marketing: 1, extraCandidates: 4 },
  };

  it.each([
    // 6 + 2 laid off this turn = 8
    { label: "everyone laid off this turn joins", state: () => duo(), plans: { ...hungry, ...twoLaidOff }, pool: 8 },
    // 6 + 4 freed last turn = 10
    { label: "people freed last turn join", state: () => duo({ freedPeople: 4 }), plans: hungry, pool: 10 },
    // 6 + 4 from the event = 10
    { label: "an event's extra candidates join", state: () => duo(glut), plans: hungry, pool: 10 },
    // 6 + 4 (event) + 3 (freed) + 2 (laid off) = 15
    {
      label: "all of them at once",
      state: () => duo({ ...glut, freedPeople: 3 }),
      plans: { ...hungry, ...twoLaidOff },
      pool: 15,
    },
  ])("$label: $pool candidates", ({ state, plans, pool }) => {
    const result = resolve(state(), plans);
    expect(result.log.hiring.candidates).toBe(pool);
    // The Incumbent takes as many as its capacity of 11 allows, at $10,000 each.
    const hired = Math.min(pool, 11);
    expect(reportFor(result, INCUMBENT).hiring.hired).toBe(hired);
    expect(reportFor(result, INCUMBENT).costs.hiring).toBe(hired * 10_000);
    expect(result.log.hiring.picks).toHaveLength(hired);
  });

  it("layoffs at two companies in the same turn all join the pool", () => {
    // HUMAN lays off 1 and BOOT lays off 2: 6 + 1 + 2 = 9 candidates.
    const plans = { [HUMAN]: { layoffs: 1, allocation: split(2, 0, 0) }, [BOOT]: { layoffs: 2, allocation: split(1, 0, 0) } };
    expect(resolve(pair(), plans).log.hiring.candidates).toBe(9);
  });

  it("a company can rehire in the turn it lays off: its own cast-offs are candidates like any others", () => {
    // 3 people, 1 laid off, the other 2 recruiting: 2^0.9 = 1.866066; capacity = round(3.732132) = 4.
    const result = resolve(solo(), { [HUMAN]: { layoffs: 1, allocation: split(0, 0, 2) } });
    const report = reportFor(result, HUMAN);
    // 6 + 1 = 7 candidates; 3 − 1 + 4 = 6 people next turn.
    expect(result.log.hiring.candidates).toBe(7);
    expect(report.hiring).toEqual({ capacity: 4, wanted: 4, hired: 4 });
    expect(report.headcount.end).toBe(6);
    // Salaries 2 × $40,000 + severance $20,000 + fees 4 × $10,000 = $140,000
    expect(report.costs.total).toBe(140_000);
  });

  it("a bankrupt company's staff, that turn's hires included, are next turn's candidates, for one turn only", () => {
    // HUMAN has $100K, puts all 3 on Recruiting and hires 5 (nobody else is hiring): $120K salaries + $50K fees
    // = $170K with no revenue (unlaunched) → −$70K → bankrupt, with 3 + 5 = 8 people.
    const state = withCompany(trio(), HUMAN, { cash: 100_000 });
    const first = resolve(state, { ...QUIET, [HUMAN]: { allocation: split(0, 0, 3) } }, 1, NO_EVENTS);
    expect(reportFor(first, HUMAN).headcount.hired).toBe(5);
    expect(reportFor(first, HUMAN).cash.end).toBe(-70_000);
    expect(reportFor(first, HUMAN).out).toBe("bankrupt");
    expect(first.state.freedPeople).toBe(8);
    // Turn 2: 6 + 8 = 14 candidates. Nobody hires them, so they leave: turn 3 is back to 6.
    const second = resolve(first.state, QUIET, 1, NO_EVENTS);
    expect(second.log.hiring.candidates).toBe(14);
    expect(second.state.freedPeople).toBe(0);
    expect(resolve(second.state, QUIET, 1, NO_EVENTS).log.hiring.candidates).toBe(6);
  });

  it("people laid off in the turn a company goes bankrupt were that turn's candidates; only the rest are freed", () => {
    // HUMAN: 5 people, $100K, lays off 2. Costs = 3 × $40,000 + 2 × $20,000 = $160,000 → −$60,000 → bankrupt.
    const state = staffed(trio(), HUMAN, 5, { cash: 100_000 });
    const result = resolve(state, { ...QUIET, [HUMAN]: { layoffs: 2, allocation: split(0, 3, 0) } }, 1, NO_EVENTS);
    // This turn: 6 + 2 laid off = 8 candidates. Next turn: the 3 still on staff, not all 5.
    expect(result.log.hiring.candidates).toBe(8);
    expect(reportFor(result, HUMAN).cash.end).toBe(-60_000);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.state.freedPeople).toBe(3);
  });

  it("a fired founder's staff become next turn's candidates too (owner decision)", () => {
    // No new users, and HUMAN is the only launched company, so its churned users all come back: users stay 10,000.
    // Revenue 10,000 × $3 = $30,000 against $120,000 of salaries: a $90,000 loss. Cash $150,000 → $60,000,
    // runway 60,000 / 90,000 = 0.67 turns: under 2, a bad quarter. Investors hold 3 seats to the founders' 2.
    const config: RulesConfig = { ...NO_EVENTS, market: { ...DESIGN.market, newUsersTurn1: 0 } };
    const state = launchedCompany(onlyActive(newGame(config), [HUMAN, BLITZ, BOOT]), HUMAN, { cash: 150_000, investorSeats: 3 });
    const idle = { [BLITZ]: IDLE, [BOOT]: IDLE };
    const seed = seedWhere((s) => firstFloat(s, 1, STREAM.board, HUMAN) < 0.05);
    const first = resolve(state, idle, seed, config);
    const report = reportFor(first, HUMAN);
    expect(report.users.end).toBe(10_000);
    expect(report.cash.end).toBe(60_000);
    expect(report.board).toEqual({ usersFell: false, lowRunway: true, fired: true });
    expect(report.out).toBe("fired");
    // Its 3 people are freed: 6 + 3 = 9 candidates on turn 2.
    expect(first.state.freedPeople).toBe(3);
    expect(resolve(first.state, idle, seed, config).log.hiring.candidates).toBe(9);
  });
});

describe("hiring: one candidate at a time in hype order (ruling 9)", () => {
  it("two companies wanting 5 each take turns, highest hype first, until the 6 candidates are gone", () => {
    const result = resolve(hypePair(30, 20), BOTH_RECRUIT);
    expect(result.log.hiring.picks).toEqual([HUMAN, BOOT, HUMAN, BOOT, HUMAN, BOOT]);
    for (const id of [HUMAN, BOOT]) {
      // Wanted 5, got 3: the fee is per hire made, 3 × $10,000.
      expect(reportFor(result, id).hiring).toEqual({ capacity: 5, wanted: 5, hired: 3 });
      expect(reportFor(result, id).costs.hiring).toBe(30_000);
    }
    // The order follows hype, not seat order.
    expect(resolve(hypePair(20, 30), BOTH_RECRUIT).log.hiring.picks).toEqual([BOOT, HUMAN, BOOT, HUMAN, BOOT, HUMAN]);
  });

  it("an odd candidate goes to the company with more hype", () => {
    // One person freed last turn: 7 candidates. HUMAN (hype 30) picks 1st, 3rd, 5th and 7th.
    const result = resolve(withState(hypePair(30, 20), { freedPeople: 1 }), BOTH_RECRUIT);
    expect(result.log.hiring.picks).toEqual([HUMAN, BOOT, HUMAN, BOOT, HUMAN, BOOT, HUMAN]);
    expect(reportFor(result, HUMAN).hiring.hired).toBe(4);
    expect(reportFor(result, BOOT).hiring.hired).toBe(3);
  });

  it("a company that has what it wanted drops out and the rest keep picking", () => {
    // HUMAN (hype 30) wants only 1; BOOT wants 5 and gets them all.
    const plans = { ...BOTH_RECRUIT, [HUMAN]: { allocation: split(0, 0, 3), hireLimit: 1 } };
    expect(resolve(hypePair(30, 20), plans).log.hiring.picks).toEqual([HUMAN, BOOT, BOOT, BOOT, BOOT, BOOT]);
  });

  it("three companies rotate in hype order", () => {
    // HUMAN 30, BOOT 20, Incumbent 10; capacities 5, 5 and 11; 6 candidates → two each.
    const state = withCompany(withCompany(onlyActive(newGame(), [HUMAN, BOOT, INCUMBENT]), HUMAN, { hype: 30 }), BOOT, { hype: 20 });
    const result = resolve(withCompany(state, INCUMBENT, { hype: 10 }), { ...BOTH_RECRUIT, [INCUMBENT]: { allocation: split(0, 0, 8) } });
    expect(result.log.hiring.picks).toEqual([HUMAN, BOOT, INCUMBENT, HUMAN, BOOT, INCUMBENT]);
  });

  it("it is start-of-turn hype that counts: this turn's layoffs do not cost a place in the queue", () => {
    // HUMAN starts at hype 30 with 4 people and lays one off; BOOT starts at 25. 6 + 1 = 7 candidates.
    // HUMAN ends the turn at 30 × 0.8 − 10 = 14, below BOOT's 25 × 0.8 = 20, but still picked first.
    const plans = { ...BOTH_RECRUIT, [HUMAN]: { layoffs: 1, allocation: split(0, 0, 3) } };
    const result = resolve(staffed(hypePair(30, 25), HUMAN, 4), plans);
    expect(result.log.hiring).toEqual({ candidates: 7, picks: [HUMAN, BOOT, HUMAN, BOOT, HUMAN, BOOT, HUMAN] });
    expect(reportFor(result, HUMAN).hype.end).toBeCloseTo(14, 6);
    expect(reportFor(result, BOOT).hype.end).toBeCloseTo(20, 6);
  });

  it("equal hype is ordered by the seeded RNG: both orders turn up, and a seed always gives the same one", () => {
    // Both startups have hype 10 and want 5; with 7 candidates whoever goes first gets the odd one.
    const state = withState(pair(), { freedPeople: 1 });
    const firstPickers = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const picks = resolve(state, BOTH_RECRUIT, seed).log.hiring.picks;
      const first = picks[0];
      const second = first === HUMAN ? BOOT : HUMAN;
      expect([HUMAN, BOOT]).toContain(first);
      // The order holds for the whole turn, and the same seed gives the same order again.
      expect(picks).toEqual([first, second, first, second, first, second, first]);
      expect(resolve(state, BOTH_RECRUIT, seed).log.hiring.picks).toEqual(picks);
      firstPickers.add(first);
    }
    expect([...firstPickers].sort()).toEqual([HUMAN, BOOT]);
  });

  it("one company's choice to recruit never changes the order of the others (ruling 20)", () => {
    // Three startups tied at hype 10 and 9 candidates. Whether or not HUMAN recruits, BLITZ and BOOT keep their order.
    const state = withState(onlyActive(newGame(), [HUMAN, BLITZ, BOOT]), { freedPeople: 3 });
    const others = { [BLITZ]: { allocation: split(0, 0, 3) }, [BOOT]: { allocation: split(0, 0, 3) } };
    for (let seed = 1; seed <= 40; seed++) {
      const withHuman = resolve(state, { ...others, [HUMAN]: { allocation: split(0, 0, 3) } }, seed).log.hiring.picks;
      const withoutHuman = resolve(state, others, seed).log.hiring.picks;
      expect(withHuman).toHaveLength(9);
      expect(withHuman.filter((id) => id !== HUMAN).slice(0, 2)).toEqual(withoutHuman.slice(0, 2));
    }
  });
});

// ── Layoffs ──

describe("layoffs: $20K severance each, −10 hype (ruling 11)", () => {
  /** HUMAN with a chosen team and hype. Nobody is on Product in most of these, so it never launches. */
  const team = (size: number, hype: number): GameState => staffed(pair(), HUMAN, size, { hype });

  it("one layoff: $20K severance, two salaries, one person fewer, 10 hype", () => {
    const result = resolve(team(3, 50), { [HUMAN]: { layoffs: 1, allocation: split(0, 2, 0) } });
    const report = reportFor(result, HUMAN);
    // 1 × $20,000 severance + 2 × $40,000 salaries = $100,000; 3 − 1 = 2 people.
    expect(report.costs).toMatchObject({ severance: 20_000, salaries: 80_000, total: 100_000 });
    expect(report.headcount).toMatchObject({ laidOff: 1, end: 2 });
    expect(result.state.companies[HUMAN].headcount).toBe(2);
    // 50 × 0.8 − 10 = 30
    expect(report.hype.layoffs).toBe(-10);
    expect(report.hype.end).toBeCloseTo(30, 6);
  });

  it("the hype cost is once per turn, not per person", () => {
    const report = human(team(5, 50), { layoffs: 3, allocation: split(0, 2, 0) });
    // 3 × $20,000 severance, but 50 × 0.8 − 10 = 30 (not 50 × 0.8 − 30 = 10).
    expect(report.headcount.laidOff).toBe(3);
    expect(report.costs.severance).toBe(60_000);
    expect(report.hype.layoffs).toBe(-10);
    expect(report.hype.end).toBeCloseTo(30, 6);
  });

  it("no layoffs, no hype cost; and hype cannot go below 0", () => {
    // 50 × 0.8 = 40
    const none = human(team(3, 50), IDLE);
    expect(none.hype.layoffs).toBe(0);
    expect(none.hype.end).toBeCloseTo(40, 6);
    // 10 × 0.8 − 10 = −2 → clamped to 0
    expect(human(team(3, 10), { layoffs: 1, allocation: split(0, 2, 0) }).hype.end).toBe(0);
  });

  it.each([{ asked: 3 }, { asked: 99 }])(
    "at most headcount − 1: asking to lay off $asked of 3 lays off 2, and the report says so",
    ({ asked }) => {
      const result = resolve(team(3, 10), { [HUMAN]: { layoffs: asked, allocation: split(0, 1, 0) } });
      const report = reportFor(result, HUMAN);
      expect(report.plan.layoffs).toBe(2);
      expect(report.notes.length).toBeGreaterThan(0);
      // 2 × $20,000 severance; the one person left is paid $40,000.
      expect(report.headcount).toMatchObject({ laidOff: 2, end: 1 });
      expect(report.costs).toMatchObject({ severance: 40_000, salaries: 40_000 });
      expect(result.state.companies[HUMAN].headcount).toBe(1);
    },
  );

  it("a solo founder cannot lay anyone off: no severance and no hype cost", () => {
    const report = human(team(1, 50), { layoffs: 1, allocation: split(0, 1, 0) });
    expect(report.plan.layoffs).toBe(0);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.headcount).toMatchObject({ laidOff: 0, end: 1 });
    expect(report.costs).toMatchObject({ severance: 0, salaries: 40_000 });
    // 50 × 0.8 = 40
    expect(report.hype.layoffs).toBe(0);
    expect(report.hype.end).toBeCloseTo(40, 6);
  });

  it("laid-off people do no work that turn, and the split is refitted to those who are left", () => {
    // 5 people, 2 laid off: the remaining 3 do 3^0.9 = 2.687875 (not 5^0.9 = 4.256700).
    expect(human(team(5, 10), { layoffs: 2, allocation: split(3, 0, 0) }).work.effective).toBeCloseTo(2.687875, 4);
    // A startup's default 3/0/0 with one layoff becomes 2/0/0.
    expect(human(pair(), { layoffs: 1 }).plan.allocation).toEqual(split(2, 0, 0));
    // The Incumbent's 4/2/2 with four layoffs keeps its proportions, 2/1/1, and does 4^0.8 = 3.031433:
    // Product 2/4 = 1.515717, Growth and Recruiting 1/4 = 0.757858 each.
    const cut = reportFor(resolve(solo(INCUMBENT), { [INCUMBENT]: { layoffs: 4, allocation: split(4, 2, 2) } }), INCUMBENT);
    expect(cut.plan.allocation).toEqual(split(2, 1, 1));
    expect(cut.work.effective).toBeCloseTo(3.031433, 4);
    expect(cut.work.product).toBeCloseTo(1.515717, 4);
    expect(cut.work.growth).toBeCloseTo(0.757858, 4);
    expect(cut.work.recruiting).toBeCloseTo(0.757858, 4);
    // Salaries 4 × $40,000 = $160,000; severance 4 × $20,000 = $80,000.
    expect(cut.costs).toMatchObject({ salaries: 160_000, severance: 80_000 });
  });

  it("a launch and a layoff in the same turn: +15 and −10", () => {
    // 4 people, 1 laid off, 3 on Product: quality 0 → 11.44, so it launches. Hype 10 × 0.8 + 15 − 10 = 13.
    const report = human(team(4, 10), { layoffs: 1, allocation: split(3, 0, 0) });
    expect(report.quality.launchedNow).toBe(true);
    expect(report.hype.end).toBeCloseTo(13, 6);
  });

  it("the default plan does not repeat last turn's layoffs", () => {
    const first = resolve(team(5, 10), { [HUMAN]: { layoffs: 2, allocation: split(0, 3, 0) } }, 1, NO_EVENTS);
    expect(planOf(first.state, HUMAN).layoffs).toBe(0);
    const second = reportFor(resolveTurn(first.state, NO_PLANS, 1, NO_EVENTS), HUMAN);
    expect(second.headcount).toMatchObject({ start: 3, laidOff: 0, end: 3 });
  });
});

// ── Poaching ──

describe("poach chance = 50% + (your hype − their hype) ÷ 2, clamped to 10–90% (ruling 10)", () => {
  it.each([
    // 50 + (10 − 20) / 2 = 45;  50 + (20 − 10) / 2 = 55;  50 + 0 = 50;  50 + (15 − 10) / 2 = 52.5
    { mine: 10, theirs: 20, chance: 0.45 },
    { mine: 20, theirs: 10, chance: 0.55 },
    { mine: 10, theirs: 10, chance: 0.5 },
    { mine: 15, theirs: 10, chance: 0.525 },
    // Hype is fractional after a turn of decay: 50 + (18.4 − 20) / 2 = 49.2;  50 + (23 − 18.4) / 2 = 52.3
    { mine: 18.4, theirs: 20, chance: 0.492 },
    { mine: 23, theirs: 18.4, chance: 0.523 },
    // Around the ceiling: 50 + 79 / 2 = 89.5;  50 + 80 / 2 = 90;  50 + 81 / 2 = 90.5 → 90;  50 + 100 / 2 = 100 → 90
    { mine: 89, theirs: 10, chance: 0.895 },
    { mine: 90, theirs: 10, chance: 0.9 },
    { mine: 91, theirs: 10, chance: 0.9 },
    { mine: 100, theirs: 0, chance: 0.9 },
    // Around the floor: 50 − 79 / 2 = 10.5;  50 − 80 / 2 = 10;  50 − 81 / 2 = 9.5 → 10;  50 − 100 / 2 = 0 → 10
    { mine: 11, theirs: 90, chance: 0.105 },
    { mine: 10, theirs: 90, chance: 0.1 },
    { mine: 9, theirs: 90, chance: 0.1 },
    { mine: 0, theirs: 100, chance: 0.1 },
  ])("hype $mine against hype $theirs → $chance", ({ mine, theirs, chance }) => {
    const report = human(hypePair(mine, theirs), { poachTarget: BOOT });
    expect(report.poach?.targetId).toBe(BOOT);
    expect(report.poach?.chance).toBeCloseTo(chance, 9);
  });

  it.each([
    // 10 against 20 is 45%: a roll in [40%, 45%) succeeds, one in [45%, 50%) fails.
    { mine: 10, theirs: 20, low: 0.4, high: 0.45, success: true },
    { mine: 10, theirs: 20, low: 0.45, high: 0.5, success: false },
    // 20 against 10 is 55%.
    { mine: 20, theirs: 10, low: 0.5, high: 0.55, success: true },
    { mine: 20, theirs: 10, low: 0.55, high: 0.6, success: false },
    // 100 against 0 would be 100%, but the ceiling is 90%: one roll in ten still fails.
    { mine: 100, theirs: 0, low: 0.85, high: 0.9, success: true },
    { mine: 100, theirs: 0, low: 0.9, high: 0.95, success: false },
    // 0 against 100 would be 0%, but the floor is 10%: one roll in ten still succeeds.
    { mine: 0, theirs: 100, low: 0.05, high: 0.1, success: true },
    { mine: 0, theirs: 100, low: 0.1, high: 0.15, success: false },
  ])("hype $mine against $theirs, roll in [$low, $high) → success $success", ({ mine, theirs, low, high, success }) => {
    const seed = seedWithPoachRoll(HUMAN, low, high);
    expect(human(hypePair(mine, theirs), { poachTarget: BOOT }, seed).poach?.success).toBe(success);
  });

  it("the chance uses start-of-turn hype: a layoff this turn does not lower it", () => {
    // HUMAN (hype 50, 4 people) lays one off and poaches BOOT (hype 50): 50 + 0 = 50%, not 50 + (40 − 50) / 2 = 45%.
    const state = staffed(hypePair(50, 50), HUMAN, 4);
    expect(human(state, { layoffs: 1, poachTarget: BOOT, allocation: split(0, 3, 0) }).poach?.chance).toBeCloseTo(0.5, 9);
  });
});

describe("poaching: $50K an attempt, and the person moves from next turn (ruling 10)", () => {
  it("costs $50K when it works", () => {
    const report = human(pair(), { poachTarget: BOOT }, POACH_WINS);
    expect(report.poach).toEqual({ targetId: BOOT, chance: 0.5, success: true });
    // Salaries $120,000 + poach $50,000
    expect(report.costs).toMatchObject({ poaching: 50_000, total: 170_000 });
  });

  it("costs $50K when it fails, and nobody moves", () => {
    const result = resolve(pair(), { [HUMAN]: { poachTarget: BOOT } }, POACH_FAILS);
    const report = reportFor(result, HUMAN);
    expect(report.poach).toEqual({ targetId: BOOT, chance: 0.5, success: false });
    expect(report.costs).toMatchObject({ poaching: 50_000, total: 170_000 });
    expect(report.headcount).toMatchObject({ poachedIn: 0, end: 3 });
    expect(reportFor(result, BOOT).headcount).toMatchObject({ poachedOut: 0, end: 3 });
    expect(result.state.companies.map((company) => company.headcount)).toEqual([3, 0, 3, 0]);
  });

  it("a poached person works and is paid at the old company this turn, and at the new one from next turn", () => {
    const first = resolve(pair(), { [HUMAN]: { poachTarget: BOOT } }, POACH_WINS, NO_EVENTS);
    const poacher = reportFor(first, HUMAN);
    const target = reportFor(first, BOOT);
    // This turn both still field 3 people: 3^0.9 = 2.687875 of work and 3 × $40,000 of salaries each.
    for (const report of [poacher, target]) {
      expect(report.work.effective).toBeCloseTo(2.687875, 4);
      expect(report.costs.salaries).toBe(120_000);
    }
    // Next turn: 3 + 1 = 4 and 3 − 1 = 2. A poached person is not a candidate: the hiring pool is still 6.
    expect(poacher.headcount).toMatchObject({ poachedIn: 1, end: 4 });
    expect(target.headcount).toMatchObject({ poachedOut: 1, end: 2 });
    expect(first.state.companies.map((company) => company.headcount)).toEqual([4, 0, 2, 0]);
    expect(first.log.hiring.candidates).toBe(6);
    // The default plan does not repeat the poach. 4^0.9 = 3.482202 and 4 × $40,000; 2^0.9 = 1.866066 and 2 × $40,000.
    expect(planOf(first.state, HUMAN).poachTarget).toBeNull();
    const second = resolveTurn(first.state, NO_PLANS, POACH_WINS, NO_EVENTS);
    expect(reportFor(second, HUMAN).poach).toBeNull();
    expect(reportFor(second, HUMAN).work.effective).toBeCloseTo(3.482202, 4);
    expect(reportFor(second, HUMAN).costs).toMatchObject({ salaries: 160_000, poaching: 0 });
    expect(reportFor(second, BOOT).work.effective).toBeCloseTo(1.866066, 4);
    expect(reportFor(second, BOOT).costs.salaries).toBe(80_000);
  });

  it("two companies can poach each other in the same turn", () => {
    // Both at hype 10 → 50% each; a seed where both rolls come in under 5%.
    const seed = seedWhere((s) => poachRoll(s, HUMAN) < 0.05 && poachRoll(s, BOOT) < 0.05);
    const result = resolve(pair(), { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { poachTarget: HUMAN } }, seed);
    for (const id of [HUMAN, BOOT]) {
      // 3 + 1 − 1 = 3, and $50,000 each.
      expect(reportFor(result, id).poach?.success).toBe(true);
      expect(reportFor(result, id).costs.poaching).toBe(50_000);
      expect(reportFor(result, id).headcount).toMatchObject({ poachedIn: 1, poachedOut: 1, end: 3 });
    }
  });

  it("a layoff, a raise, a poach and hires in one turn all land where they should", () => {
    // HUMAN: 5 people, launched with 10,000 users. It lays off 1, raises (1 fundraiser), poaches from BOOT and
    // puts 1 on Product and 2 on Recruiting. Payroll 4: 4^0.9 = 3.482202; Product 1/4 → 0.870551;
    // Recruiting 2/4 → 1.741101; capacity = round(3.482202) = 3. Candidates 6 + 1 laid off = 7, so all 3 are hired.
    const state = launchedCompany(staffed(pair(), HUMAN, 5), HUMAN);
    const plan = { layoffs: 1, raisePercent: 10, poachTarget: BOOT, allocation: split(1, 0, 2) };
    const result = resolve(state, { [HUMAN]: plan }, POACH_WINS);
    const report = reportFor(result, HUMAN);
    expect(report.raise?.percent).toBe(10);
    expect(report.plan.allocation).toEqual(split(1, 0, 2));
    expect(report.work.product).toBeCloseTo(0.870551, 4);
    expect(report.work.recruiting).toBeCloseTo(1.741101, 4);
    expect(result.log.hiring.candidates).toBe(7);
    expect(report.hiring.capacity).toBe(3);
    // 5 − 1 laid off + 3 hired + 1 poached = 8
    expect(report.headcount).toEqual({ start: 5, lostToEvent: 0, laidOff: 1, hired: 3, poachedIn: 1, poachedOut: 0, end: 8 });
    // Salaries 4 × $40,000 + severance $20,000 + fees 3 × $10,000 + poach $50,000 = $260,000
    const costs = { salaries: 160_000, marketing: 0, hiring: 30_000, poaching: 50_000, severance: 20_000, total: 260_000 };
    expect(report.costs).toEqual(costs);
    expect(result.state.companies[HUMAN]).toMatchObject({ headcount: 8, headcountAtLastClose: 8 });
  });

  it("the public quarter stats count poached people as joined and left", () => {
    // HUMAN hires 2 (one recruiter, capacity 2) and poaches 1; BOOT lays off 1 and loses 1 to the poach.
    const plans = {
      [HUMAN]: { poachTarget: BOOT, allocation: split(2, 0, 1) },
      [BOOT]: { layoffs: 1, allocation: split(2, 0, 0) },
    };
    const { state } = resolve(pair(), plans, POACH_WINS);
    // joined = 2 hires + 1 poach = 3; left = 1 layoff + 1 poached away = 2; BOOT is down to 3 − 1 − 1 = 1.
    expect(state.companies[HUMAN].lastQuarter).toMatchObject({ joined: 3, left: 0 });
    expect(state.companies[BOOT].lastQuarter).toMatchObject({ joined: 0, left: 2 });
    expect(state.companies[HUMAN].headcount).toBe(6);
    expect(state.companies[BOOT].headcount).toBe(1);
  });
});

describe("poaching: a target needs at least 2 people at that moment (rulings 10 and 11)", () => {
  it("an attempt on a one-person team is dropped at no cost, and the report says so; a team of two can lose one", () => {
    const one = resolve(staffed(pair(), BOOT, 1), { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { allocation: split(1, 0, 0) } }, POACH_WINS);
    expect(reportFor(one, HUMAN).poach).toBeNull();
    expect(reportFor(one, HUMAN).costs.poaching).toBe(0);
    expect(reportFor(one, HUMAN).notes.length).toBeGreaterThan(0);
    expect(reportFor(one, HUMAN).headcount.poachedIn).toBe(0);
    expect(reportFor(one, BOOT).headcount.end).toBe(1);
    const two = resolve(staffed(pair(), BOOT, 2), { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { allocation: split(2, 0, 0) } }, POACH_WINS);
    expect(reportFor(two, HUMAN).poach?.success).toBe(true);
    expect(reportFor(two, HUMAN).headcount.end).toBe(4);
    expect(reportFor(two, BOOT).headcount).toMatchObject({ poachedOut: 1, end: 1 });
  });

  it("layoffs come first: a team that lays itself off down to 1 cannot be poached from, one down to 2 can", () => {
    // BOOT starts with 3 and lays off 2, so it has 1 when the attempt comes up: dropped, no $50K.
    const toOne = resolve(pair(), { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { layoffs: 2, allocation: split(1, 0, 0) } }, POACH_WINS);
    expect(reportFor(toOne, HUMAN).costs.poaching).toBe(0);
    expect(reportFor(toOne, HUMAN).headcount).toMatchObject({ poachedIn: 0, end: 3 });
    expect(reportFor(toOne, BOOT).headcount).toMatchObject({ poachedOut: 0, end: 1 });
    // BOOT lays off 1, so it has 2: the attempt goes ahead and BOOT ends with 3 − 1 − 1 = 1.
    const toTwo = resolve(pair(), { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { layoffs: 1, allocation: split(2, 0, 0) } }, POACH_WINS);
    expect(reportFor(toTwo, HUMAN).poach?.success).toBe(true);
    expect(reportFor(toTwo, HUMAN).costs.poaching).toBe(50_000);
    expect(reportFor(toTwo, BOOT).headcount.end).toBe(1);
  });

  it.each([
    { label: "itself", target: HUMAN },
    { label: "a company that is out of the game", target: BLITZ },
    { label: "a company that does not exist", target: 7 },
  ])("a company cannot poach from $label: dropped at no cost, and the report says so", ({ target }) => {
    const report = human(pair(), { poachTarget: target }, POACH_WINS);
    expect(report.plan.poachTarget).toBeNull();
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.headcount.end).toBe(3);
  });
});

describe("poaching: attempts resolve in hype order (ruling 10)", () => {
  /** HUMAN and BLITZ both go after BOOT, a two-person team at hype 10. */
  const raid = (humanHype: number, blitzHype: number): GameState => {
    const state = withCompany(onlyActive(newGame(), [HUMAN, BLITZ, BOOT]), HUMAN, { hype: humanHype });
    return staffed(withCompany(state, BLITZ, { hype: blitzHype }), BOOT, 2);
  };
  const plans = { [HUMAN]: { poachTarget: BOOT }, [BLITZ]: { poachTarget: BOOT }, [BOOT]: { allocation: split(2, 0, 0) } };
  /** Both rolls are under every possible chance. */
  const bothWin = seedWhere((s) => poachRoll(s, HUMAN) < 0.05 && poachRoll(s, BLITZ) < 0.05);

  it("the higher-hype poacher goes first; once the target is down to 1 the other attempt is dropped at no cost", () => {
    // HUMAN 60 against BOOT 10: 50 + 25 = 75%. BLITZ 40 against 10: 50 + 15 = 65%. Both rolls would succeed.
    const result = resolve(raid(60, 40), plans, bothWin);
    expect(reportFor(result, HUMAN).poach).toEqual({ targetId: BOOT, chance: 0.75, success: true });
    expect(reportFor(result, HUMAN).costs.poaching).toBe(50_000);
    expect(reportFor(result, HUMAN).headcount.poachedIn).toBe(1);
    // BOOT has 1 person left when BLITZ's turn comes: no attempt, no $50K, and the report says so.
    const blitz = reportFor(result, BLITZ);
    expect(blitz.poach).toBeNull();
    expect(blitz.costs.poaching).toBe(0);
    expect(blitz.headcount).toMatchObject({ poachedIn: 0, end: 3 });
    expect(blitz.notes.length).toBeGreaterThan(0);
    expect(reportFor(result, BOOT).headcount).toMatchObject({ poachedOut: 1, end: 1 });
    // Swap the hype and the other poacher gets the person.
    const swapped = resolve(raid(40, 60), plans, bothWin);
    expect(reportFor(swapped, BLITZ).poach).toEqual({ targetId: BOOT, chance: 0.75, success: true });
    expect(reportFor(swapped, HUMAN).costs.poaching).toBe(0);
    expect(reportFor(swapped, HUMAN).headcount.poachedIn).toBe(0);
    expect(reportFor(swapped, BOOT).headcount.end).toBe(1);
  });

  it("if the first attempt fails the target still has 2, so the second goes ahead", () => {
    // HUMAN's roll is over 95% (fails at 75%); BLITZ's is under 5% (succeeds at 65%). Both pay $50K.
    const seed = seedWhere((s) => poachRoll(s, HUMAN) >= 0.95 && poachRoll(s, BLITZ) < 0.05);
    const result = resolve(raid(60, 40), plans, seed);
    expect(reportFor(result, HUMAN).poach).toEqual({ targetId: BOOT, chance: 0.75, success: false });
    expect(reportFor(result, BLITZ).poach).toEqual({ targetId: BOOT, chance: 0.65, success: true });
    for (const id of [HUMAN, BLITZ]) expect(reportFor(result, id).costs.poaching).toBe(50_000);
    expect(reportFor(result, BLITZ).headcount.poachedIn).toBe(1);
    expect(reportFor(result, BOOT).headcount.end).toBe(1);
  });

  it("two poachers with the same hype: one gets the last spare person, the other is dropped at no cost", () => {
    // The rulings do not say how equal hype is ordered for poaching (they do for hiring), so this checks
    // only what every reading agrees on. Both at hype 50 → 50 + (50 − 10) / 2 = 70%; both rolls would succeed.
    const result = resolve(raid(50, 50), plans, bothWin);
    const winners = [HUMAN, BLITZ].filter((id) => reportFor(result, id).headcount.poachedIn === 1);
    expect(winners).toHaveLength(1);
    expect(reportFor(result, winners[0]).costs.poaching).toBe(50_000);
    expect(reportFor(result, winners[0] === HUMAN ? BLITZ : HUMAN).costs.poaching).toBe(0);
    expect(reportFor(result, BOOT).headcount.end).toBe(1);
  });

  it("the order uses start-of-turn hype: laying people off this turn does not cost the first move", () => {
    // HUMAN starts at 45 with 4 people and lays one off (it will end the turn at 45 × 0.8 − 10 = 26);
    // BLITZ starts at 40. HUMAN still goes first, at 50 + (45 − 10) / 2 = 67.5%.
    const human4 = { poachTarget: BOOT, layoffs: 1, allocation: split(0, 3, 0) };
    const result = resolve(staffed(raid(45, 40), HUMAN, 4), { ...plans, [HUMAN]: human4 }, bothWin);
    expect(reportFor(result, HUMAN).poach).toEqual({ targetId: BOOT, chance: 0.675, success: true });
    expect(reportFor(result, BLITZ).costs.poaching).toBe(0);
    expect(reportFor(result, BLITZ).headcount.poachedIn).toBe(0);
  });

  it("three poachers on a three-person team: two succeed, the third finds nobody left to take", () => {
    // HUMAN 60 (75%), BLITZ 40 (65%), the Incumbent 20 (50 + (20 − 10) / 2 = 55%), all against BOOT (hype 10, 3 people).
    const state = withCompany(withCompany(newGame(), HUMAN, { hype: 60 }), BLITZ, { hype: 40 });
    const seed = seedWhere((s) => [HUMAN, BLITZ, INCUMBENT].every((id) => poachRoll(s, id) < 0.05));
    const raiders = { [HUMAN]: { poachTarget: BOOT }, [BLITZ]: { poachTarget: BOOT }, [INCUMBENT]: { poachTarget: BOOT } };
    const result = resolve(state, raiders, seed);
    expect([HUMAN, BLITZ, INCUMBENT].map((id) => reportFor(result, id).headcount.poachedIn)).toEqual([1, 1, 0]);
    expect(reportFor(result, INCUMBENT).costs.poaching).toBe(0);
    // Nobody falls below 1 person through poaching: 3 − 2 = 1.
    expect(reportFor(result, BOOT).headcount).toMatchObject({ poachedOut: 2, end: 1 });
  });
});

describe("going out: where the people go (ruling 15)", () => {
  it("a poacher that goes bankrupt the same turn frees the person it just poached as well", () => {
    // HUMAN has $100K: $120K salaries + $50K poach = $170K, no revenue (unlaunched) → −$70K → bankrupt.
    // It had 3 people and had just poached 1: 4 people become next turn's candidates. BOOT keeps 2.
    const state = withCompany(trio(), HUMAN, { cash: 100_000 });
    const result = resolve(state, { ...QUIET, [HUMAN]: { ...IDLE, poachTarget: BOOT } }, POACH_WINS, NO_EVENTS);
    expect(reportFor(result, HUMAN).poach?.success).toBe(true);
    expect(reportFor(result, HUMAN).cash.end).toBe(-70_000);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.state.freedPeople).toBe(4);
    expect(result.state.companies[BOOT].headcount).toBe(2);
  });

  it("a person poached from a company that goes bankrupt the same turn moves; only the rest are freed", () => {
    // BOOT has $100K and no revenue (nobody on Product): $120K salaries → −$20K → bankrupt.
    // HUMAN poached one of its 3 people this turn: that person joins HUMAN, the other 2 become candidates.
    const state = withCompany(trio(), BOOT, { cash: 100_000 });
    const result = resolve(state, { ...QUIET, [HUMAN]: { poachTarget: BOOT }, [BOOT]: IDLE }, POACH_WINS, NO_EVENTS);
    expect(reportFor(result, HUMAN).poach?.success).toBe(true);
    expect(reportFor(result, BOOT).out).toBe("bankrupt");
    // 3 + 1 = 4 at HUMAN and 3 − 1 = 2 freed: six people before, six after.
    expect(result.state.companies[HUMAN].headcount).toBe(4);
    expect(result.state.freedPeople).toBe(2);
  });
});

// ── Tunable numbers ──

describe("every number of this area is read from the config, so it can be tuned", () => {
  const tuned = (patch: Partial<RulesConfig>): RulesConfig => ({ ...DESIGN, ...patch });
  const { startup, incumbent } = DESIGN.archetypes;

  it("src/config.design.ts, which the tests run on, carries the numbers of the design document", () => {
    // DESIGN is that file with every rule number of the design written over it, so nothing may have changed.
    expect(DESIGN).toEqual(FROZEN);
  });

  it("starting headcount and the salary", () => {
    const bigger = tuned({ archetypes: { startup: { ...startup, headcount: 4, allocation: split(4, 0, 0) }, incumbent } });
    const report = reportFor(resolve(onlyActive(newGame(bigger), [HUMAN]), {}, 1, bigger), HUMAN);
    // 4 people: 4 × $40,000 = $160,000 and 4^0.9 = 3.482202
    expect(report.headcount.start).toBe(4);
    expect(report.costs.salaries).toBe(160_000);
    expect(report.work.effective).toBeCloseTo(3.482202, 4);
    // 3 × $50,000
    expect(human(solo(), {}, 1, tuned({ salary: 50_000 })).costs.salaries).toBe(150_000);
  });

  it("the work exponents", () => {
    const config = tuned({
      archetypes: { startup: { ...startup, workExponent: 0.5 }, incumbent: { ...incumbent, workExponent: 1 } },
    });
    // A startup of 4 at exponent 0.5 does √4 = 2; split 2/1/1 → 1, 0.5 and 0.5.
    const small = human(staffed(solo(), HUMAN, 4), { allocation: split(2, 1, 1) }, 1, config);
    expect(small.work.effective).toBeCloseTo(2, 6);
    expect(small.work.product).toBeCloseTo(1, 6);
    expect(small.work.growth).toBeCloseTo(0.5, 6);
    expect(small.work.recruiting).toBeCloseTo(0.5, 6);
    // capacity = round(2 × 0.5) = 1; gain = 5 × 1 × (1 − 0/100) = 5; 0 + 5 − 2 = 3
    expect(small.hiring.capacity).toBe(1);
    expect(small.quality.end).toBeCloseTo(3, 3);
    // The Incumbent at exponent 1 does 8; split 5/2/1 → 5, 2 and 1.
    const big = reportFor(resolve(solo(INCUMBENT), {}, 1, config), INCUMBENT);
    expect(big.work.effective).toBeCloseTo(8, 6);
    expect(big.work.product).toBeCloseTo(5, 6);
    // capacity = round(2 × 1) = 2; gain = 5 × 5 × (1 − 30/100) = 17.5; 30 + 17.5 − 2 = 45.5
    expect(big.hiring.capacity).toBe(2);
    expect(big.quality.end).toBeCloseTo(45.5, 3);
  });

  it("the quality numbers: gain per unit of work, decay and the launch threshold", () => {
    const { quality } = human(solo(), {}, 1, tuned({ quality: { gainPerWork: 6, decay: 3, launchAt: 12 } }));
    // gain = 6 × 2.687875 × (1 − 0/100) = 16.127252; 0 + 16.127252 − 3 = 13.127252, over the bar of 12
    expect(quality.gain).toBeCloseTo(16.127252, 4);
    expect(quality.decay).toBe(3);
    expect(quality.end).toBeCloseTo(13.127252, 3);
    expect(quality.launchedNow).toBe(true);
    // With the bar at 14 the same 13.13 is not enough; and the standard 11.44 does not clear a bar of 12.
    const higherBar = tuned({ quality: { gainPerWork: 6, decay: 3, launchAt: 14 } });
    expect(human(solo(), {}, 1, higherBar).quality.launchedNow).toBe(false);
    expect(human(solo(), {}, 1, tuned({ quality: { ...DESIGN.quality, launchAt: 12 } })).quality.launchedNow).toBe(false);
  });

  it("the catch-up multiplier", () => {
    const state = onlyActive(launchedCompany(newGame(), BLITZ, { quality: 50 }), [BLITZ, INCUMBENT]);
    const withMultiplier = (catchUpMultiplier: number): RulesConfig =>
      tuned({ archetypes: { startup, incumbent: { ...incumbent, catchUpMultiplier } } });
    // ×2 instead of ×1.5: gain = 11.545694 × 2 = 23.091388; 30 + 23.091388 − 2 = 51.091388
    expect(reportFor(resolve(state, {}, 1, withMultiplier(2)), INCUMBENT).quality.end).toBeCloseTo(51.091388, 3);
    // ×1 is no bonus at all: 30 + 11.545694 − 2 = 39.545694
    expect(reportFor(resolve(state, {}, 1, withMultiplier(1)), INCUMBENT).quality.end).toBeCloseTo(39.545694, 3);
  });

  it("the hiring numbers: candidates per turn, capacity per unit of work and the fee", () => {
    const config = tuned({ hiring: { candidatesPerTurn: 4, capacityPerWork: 3, fee: 15_000 } });
    // One recruiter: capacity = round(3 × 2.687875 × 1/3) = round(2.687875) = 3 of the 4 candidates, 3 × $15,000.
    const one = resolve(solo(), { [HUMAN]: { allocation: split(2, 0, 1) } }, 1, config);
    expect(one.log.hiring.candidates).toBe(4);
    expect(reportFor(one, HUMAN).hiring).toEqual({ capacity: 3, wanted: 3, hired: 3 });
    expect(reportFor(one, HUMAN).costs.hiring).toBe(45_000);
    // All recruiting: capacity = round(3 × 2.687875) = round(8.063626) = 8, but only 4 candidates: 4 × $15,000.
    const all = human(solo(), { allocation: split(0, 0, 3) }, 1, config);
    expect(all.hiring).toEqual({ capacity: 8, wanted: 8, hired: 4 });
    expect(all.costs.hiring).toBe(60_000);
  });

  it("the layoff numbers: severance and the hype cost", () => {
    const config = tuned({ layoff: { severance: 30_000, hype: -7 } });
    const report = human(staffed(pair(), HUMAN, 3, { hype: 50 }), { layoffs: 2, allocation: split(0, 1, 0) }, 1, config);
    // 2 × $30,000; 50 × 0.8 − 7 = 33
    expect(report.costs.severance).toBe(60_000);
    expect(report.hype.end).toBeCloseTo(33, 6);
  });

  it("the poach numbers: cost, base chance, chance per hype point, floor, ceiling and the smallest target", () => {
    const config = tuned({
      poach: { cost: 70_000, baseChance: 0.4, chancePerHypePoint: 0.01, minChance: 0.2, maxChance: 0.8, minTargetHeadcount: 3 },
    });
    const attempt = (mine: number, theirs: number, seed = 1): CompanyReport =>
      human(hypePair(mine, theirs), { poachTarget: BOOT }, seed, config);
    // 40% + (10 − 20) × 1 point = 30%, and it costs $70,000
    expect(attempt(10, 20).poach?.chance).toBeCloseTo(0.3, 9);
    expect(attempt(10, 20).costs.poaching).toBe(70_000);
    // 40% + 100 points = 140% → ceiling 80%; 40% − 100 points = −60% → floor 20%
    expect(attempt(100, 0).poach?.chance).toBeCloseTo(0.8, 9);
    expect(attempt(0, 100).poach?.chance).toBeCloseTo(0.2, 9);
    // A roll between 30% and 45% succeeds with the standard numbers (45%) but fails with these (30%).
    const seed = seedWithPoachRoll(HUMAN, 0.3, 0.45);
    expect(human(hypePair(10, 20), { poachTarget: BOOT }, seed).poach?.success).toBe(true);
    expect(attempt(10, 20, seed).poach?.success).toBe(false);
    // Smallest target 3: a two-person team is now off limits, a three-person team is not.
    const plans = { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { allocation: split(2, 0, 0) } };
    const dropped = reportFor(resolve(staffed(pair(), BOOT, 2), plans, 1, config), HUMAN);
    expect(dropped.poach).toBeNull();
    expect(dropped.costs.poaching).toBe(0);
    expect(attempt(10, 10).poach).not.toBeNull();
  });
});

// ── Plan check ──

describe("plan check: anything illegal is fixed up at no cost, and the report says so (order of a turn, step 1)", () => {
  const cases: readonly { readonly label: string; readonly plan: Partial<Plan> }[] = [
    { label: "a negative number of layoffs", plan: { layoffs: -1 } },
    { label: "half a person laid off", plan: { layoffs: 1.5, allocation: split(2, 0, 0) } },
    { label: "a negative hire limit", plan: { hireLimit: -3, allocation: split(0, 0, 3) } },
  ];

  // FINDING TP-2
  it.each(cases)("$label is fixed up, and the report says so", ({ plan }) => {
    const report = human(pair(), plan);
    // Fixed up: the plan as resolved carries whole, non-negative numbers of people...
    expect(Number.isInteger(report.plan.layoffs)).toBe(true);
    expect(report.plan.layoffs).toBeGreaterThanOrEqual(0);
    expect(report.plan.hireLimit === null || (Number.isInteger(report.plan.hireLimit) && report.plan.hireLimit >= 0)).toBe(true);
    // ...at no cost beyond the severance of the people really laid off...
    expect(report.costs.severance).toBe(report.headcount.laidOff * 20_000);
    // ...and the report says so.
    expect(report.notes.length).toBeGreaterThan(0);
  });
});

// ── Whole games ──

describe("whole games with random plans: the team and product rules hold on every turn", () => {
  /** A small deterministic generator (mulberry32) for the random plans; nothing to do with the engine's own rolls. */
  const generator = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** How often a random plan lays people off and tries a poach. */
  interface Style {
    readonly layoffs: number;
    readonly poach: number;
  }
  const ORDINARY: Style = { layoffs: 0.12, poach: 0.3 };
  const RAIDERS: Style = { layoffs: 0.3, poach: 0.9 };

  /** A plan a careless player might hand in: usually legal, sometimes not (too many layoffs, a bad split, a silly poach). */
  const randomPlan = (random: () => number, company: Company, style: Style): Plan => {
    const layoffs = random() < style.layoffs ? 1 + Math.floor(random() * 2) : 0;
    const raisePercent = random() < 0.2 ? [10, 20, 30][Math.floor(random() * 3)] : 0;
    const people = Math.max(0, company.headcount - layoffs - (raisePercent > 0 ? 1 : 0));
    const placed = random() < 0.1 ? people + 2 : people;
    const product = Math.floor(random() * (placed + 1));
    const growth = Math.floor(random() * (placed - product + 1));
    return {
      allocation: { product, growth, recruiting: placed - product - growth },
      marketing: random() < 0.25 ? 25_000 * (1 + Math.floor(random() * 3)) : 0,
      price: (["budget", "standard", "premium"] as const)[Math.floor(random() * 3)],
      raisePercent,
      poachTarget: random() < style.poach ? Math.floor(random() * 4) : null,
      layoffs,
      hireLimit: random() < 0.5 ? null : Math.floor(random() * 4),
    };
  };

  const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

  /** Poach attempts passed over because earlier poachers had drained the target, across all games played. */
  let drained = 0;

  /** Every rule of this area, restated from the document, checked against one resolved turn. */
  const checkTurn = (
    state: GameState,
    submitted: readonly Plan[],
    result: ReturnType<typeof resolveTurn>,
    seed: number,
    game: string,
  ): void => {
    const { log } = result;
    const where = `${game}, turn ${state.turn}`;
    const poachedFrom = state.companies.map(() => 0);
    let laidOffTotal = 0;
    let freed = 0;

    for (const before of state.companies) {
      const at = `${where}, company ${before.id}`;
      const report = log.companies[before.id];
      if (before.out) {
        expect(report, at).toBeNull();
        continue;
      }
      if (!report) throw new Error(`${at}: no report for a company that is still in the game`);
      const { headcount, plan, work, costs, hiring, quality, hype } = report;

      // People are whole; layoffs stop at headcount − 1; nobody falls below 1 (ruling 11).
      for (const count of Object.values(headcount)) expect(Number.isInteger(count), at).toBe(true);
      expect(headcount.start, at).toBe(before.headcount);
      expect(headcount.laidOff, at).toBe(plan.layoffs);
      expect(headcount.laidOff, at).toBeLessThanOrEqual(headcount.start - 1);
      const end = headcount.start - headcount.laidOff + headcount.hired + headcount.poachedIn - headcount.poachedOut;
      expect(headcount.end, at).toBe(end);
      expect(headcount.end, at).toBeGreaterThanOrEqual(1);
      laidOffTotal += headcount.laidOff;
      if (report.out) freed += headcount.end;

      // Coordination drag and the split (design; rulings 2 and 3).
      const payroll = headcount.start - headcount.laidOff;
      const effective = payroll ** (before.archetype === "incumbent" ? 0.8 : 0.9);
      const { product, growth, recruiting } = plan.allocation;
      for (const people of [product, growth, recruiting]) {
        expect(Number.isInteger(people) && people >= 0, at).toBe(true);
      }
      expect(product + growth + recruiting, at).toBe(payroll - (report.raise ? 1 : 0));
      expect(work.effective, at).toBeCloseTo(effective, 4);
      expect(work.product, at).toBeCloseTo((effective * product) / payroll, 4);
      expect(work.growth, at).toBeCloseTo((effective * growth) / payroll, 4);
      expect(work.recruiting, at).toBeCloseTo((effective * recruiting) / payroll, 4);

      // Costs: $40K a head on payroll, $20K severance, $10K a hire, $50K a poach attempt (ruling 8).
      expect(costs.salaries, at).toBe(payroll * 40_000);
      expect(costs.severance, at).toBe(headcount.laidOff * 20_000);
      expect(costs.hiring, at).toBe(headcount.hired * 10_000);
      expect(costs.poaching, at).toBe(report.poach ? 50_000 : 0);
      expect(costs.total, at).toBe(costs.salaries + costs.marketing + costs.hiring + costs.poaching + costs.severance);

      // Quality: gain, decay, clamp; catch-up for the Incumbent only; launch at 10 (rulings 4 and 5).
      const trailing =
        before.archetype === "incumbent" &&
        state.companies.some((rival) => rival.id !== before.id && !rival.out && rival.launched && rival.quality > before.quality);
      expect(quality.catchUp, at).toBe(trailing);
      const gain = 5 * ((effective * product) / payroll) * (trailing ? 1.5 : 1) * (1 - before.quality / 100);
      expect(quality.start, at).toBe(before.quality);
      expect(quality.gain, at).toBeCloseTo(gain, 3);
      expect(quality.end, at).toBeCloseTo(clamp(before.quality + gain - 2, 0, 100), 3);
      expect(quality.launchedNow, at).toBe(!before.launched && quality.end >= 10);
      if (!before.launched && !quality.launchedNow) {
        // No users before launch.
        expect(report.users.won, at).toBe(0);
        expect(report.users.end, at).toBe(0);
        expect(report.revenue, at).toBe(0);
      }

      // Hiring: capacity, the "hire at most" limit, and the picks (ruling 9).
      const rawCapacity = (2 * effective * recruiting) / payroll;
      if (Math.abs(rawCapacity - Math.floor(rawCapacity) - 0.5) > 1e-4) {
        expect(hiring.capacity, at).toBe(Math.round(rawCapacity));
      }
      expect(hiring.wanted, at).toBe(plan.hireLimit === null ? hiring.capacity : Math.min(hiring.capacity, plan.hireLimit));
      expect(hiring.hired, at).toBeLessThanOrEqual(hiring.wanted);
      expect(headcount.hired, at).toBe(hiring.hired);
      expect(log.hiring.picks.filter((id) => id === before.id), at).toHaveLength(hiring.hired);

      // Poaching: the chance, the roll, and the floor of 2 on the target (ruling 10).
      const named = submitted[before.id].poachTarget;
      if (report.poach) {
        expect(report.poach.targetId, at).toBe(named);
        const target = state.companies[report.poach.targetId];
        const targetReport = log.companies[target.id];
        expect(target.id, at).not.toBe(before.id);
        expect(target.out, at).toBeNull();
        const chance = clamp(0.5 + (before.hype - target.hype) / 200, 0.1, 0.9);
        expect(report.poach.chance, at).toBeCloseTo(chance, 6);
        expect(report.poach.success, at).toBe(firstFloat(seed, state.turn, STREAM.poach, before.id) < chance);
        expect(headcount.poachedIn, at).toBe(report.poach.success ? 1 : 0);
        if (report.poach.success) poachedFrom[target.id] += 1;
        if (!targetReport) throw new Error(`${at}: poached from a company with no report`);
        expect(targetReport.headcount.start - targetReport.headcount.laidOff, at).toBeGreaterThanOrEqual(2);
      } else {
        expect(headcount.poachedIn, at).toBe(0);
        // A rival that still had 2+ people after its layoffs is only passed over when earlier poachers
        // had already taken it down to 1 by the time this attempt came up.
        const rival = named !== null && named !== before.id ? log.companies[named] : null;
        if (rival && rival.headcount.start - rival.headcount.laidOff >= 2) {
          expect(rival.headcount.start - rival.headcount.laidOff - rival.headcount.poachedOut, at).toBe(1);
          drained += 1;
        }
      }

      // Hype: ×0.8, +15 on launch, −10 once for any layoffs (ruling 12).
      expect(hype.start, at).toBe(before.hype);
      expect(hype.launch, at).toBe(quality.launchedNow ? 15 : 0);
      expect(hype.layoffs, at).toBe(headcount.laidOff > 0 ? -10 : 0);
      const hypeEnd = clamp(before.hype * 0.8 + hype.launch + hype.raise + hype.growth + hype.layoffs, 0, 100);
      expect(hype.end, at).toBeCloseTo(hypeEnd, 3);
    }

    // Everyone poached away is counted at the company they left.
    for (const before of state.companies) {
      const report = log.companies[before.id];
      if (report) expect(report.headcount.poachedOut, `${where}, company ${before.id}`).toBe(poachedFrom[before.id]);
    }

    // The candidate pool: 6 + event bonus + people freed last turn + everyone laid off this turn (ruling 9).
    expect(log.hiring.candidates, where).toBe(6 + state.modifiers.extraCandidates + state.freedPeople + laidOffTotal);

    // One candidate at a time in start-of-turn hype order (ties in whatever order the engine's RNG chose).
    const firstPick = (id: CompanyId): number => (log.hiring.picks.includes(id) ? log.hiring.picks.indexOf(id) : Infinity);
    const queue = state.companies
      .filter((company) => (log.companies[company.id]?.hiring.wanted ?? 0) > 0)
      .sort((a, b) => b.hype - a.hype || firstPick(a.id) - firstPick(b.id));
    const got = state.companies.map(() => 0);
    const expectedPicks: CompanyId[] = [];
    for (let left = log.hiring.candidates, progress = true; left > 0 && progress; ) {
      progress = false;
      for (const company of queue) {
        const wanted = log.companies[company.id]?.hiring.wanted ?? 0;
        if (left > 0 && got[company.id] < wanted) {
          got[company.id] += 1;
          left -= 1;
          progress = true;
          expectedPicks.push(company.id);
        }
      }
    }
    expect(log.hiring.picks, where).toEqual(expectedPicks);

    // What the next turn starts from (rulings 4, 9 and 15).
    if (!result.state.outcome) {
      expect(result.state.freedPeople, where).toBe(freed);
      for (const before of state.companies) {
        const report = log.companies[before.id];
        if (!report) continue;
        const after = result.state.companies[before.id];
        const at = `${where}, company ${before.id}`;
        if (report.out) {
          expect(after.out?.reason, at).toBe(report.out);
          expect(after.headcount, at).toBe(0);
        } else {
          expect(after.headcountAtLastClose, at).toBe(report.headcount.end);
          expect(after.quality, at).toBe(report.quality.end);
          expect(after.launched, at).toBe(before.launched || report.quality.launchedNow);
          // The plan as resolved is the default for next turn.
          expect(after.lastPlan, at).toEqual(report.plan);
        }
      }
    }
  };

  const play = (start: GameState, seed: number, game: string, style: Style = ORDINARY): number => {
    const random = generator(seed);
    let state = start;
    let turns = 0;
    while (!state.outcome && turns < 25) {
      const plans = state.companies.map((company) => randomPlan(random, company, style));
      const result = resolveTurn(state, plans, seed, DESIGN);
      checkTurn(state, plans, result, seed, game);
      state = result.state;
      turns += 1;
    }
    return turns;
  };

  const everyoneWith = (patch: Partial<Company>): GameState =>
    [HUMAN, BLITZ, BOOT, INCUMBENT].reduce((state, id) => withCompany(state, id, patch), newGame());

  it("30 games from the standard start", () => {
    let turns = 0;
    for (let seed = 1; seed <= 30; seed++) turns += play(newGame(), seed, `standard game ${seed}`);
    expect(turns).toBeGreaterThan(30);
  });

  it("30 games where everyone starts with $20M, so teams grow and the games run long", () => {
    let turns = 0;
    for (let seed = 1; seed <= 30; seed++) {
      turns += play(everyoneWith({ cash: 20_000_000 }), 1000 + seed, `rich game ${seed}`);
    }
    expect(turns).toBeGreaterThan(300);
  });

  it("30 games of small teams that lay off and raid each other almost every turn", () => {
    const before = drained;
    let turns = 0;
    for (let seed = 1; seed <= 30; seed++) {
      turns += play(everyoneWith({ cash: 20_000_000 }), 2000 + seed, `raider game ${seed}`, RAIDERS);
    }
    expect(turns).toBeGreaterThan(300);
    // These games do reach the case the floor exists for: a poacher finding its target already down to 1.
    expect(drained - before).toBeGreaterThan(0);
  });
});
