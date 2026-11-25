import { describe, expect, it } from "vitest";
import type { GameConfig, PlayConfig } from "../config";
import { DESIGN } from "../config.design";
import { listingBlocker } from "../engine/career";
import { CAREER_TEST, atTurn, newCareer, outSince, qualify, withCareer, withCareerOf, withEras } from "../engine/careerKit";
import { normalizePlanFor } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, withCompany, withState } from "../engine/testKit";
import type { Company, CompanyView, CpuKind, GameState, Plan } from "../engine/types";
import { viewFor } from "../engine/view";
import { baselinePlan } from "./baselineBot";
import { choosePlans } from "./choosePlans";
import { candidatePlans, chooseCpuPlan } from "./cpu";
import { newGameSetup } from "./names";
import type { CpuPersonality } from "./types";

// The computer players and the baseline bot in a career. Like the career's rule tests, these run on the race's frozen
// design numbers with the career switched on (CAREER_TEST) and on configs built from it, never on the numbers the
// career ships with. Seat 0 is the player's, seat 1 the Blitzscaler's, seat 2 the Bootstrapper's, seat 3 the
// Incumbent's.

const KINDS = ["blitzscaler", "bootstrapper", "incumbent"] as const;
const SEEDS_1_TO_20 = Array.from({ length: 20 }, (_, i) => i + 1);

/** CAREER_TEST, or another config, with some of one computer style's numbers replaced. */
const withStyle = (kind: CpuKind, patch: Partial<CpuPersonality>, base: GameConfig = CAREER_TEST): GameConfig => ({
  ...base,
  cpu: { ...base.cpu, personalities: { ...base.cpu.personalities, [kind]: { ...base.cpu.personalities[kind], ...patch } } },
});

/** A config that also has its computer players weigh a tenth and a fifth of their people as recruiters. */
const withShares = (base: GameConfig): GameConfig => ({ ...base, cpu: { ...base.cpu, recruiters: { ...base.cpu.recruiters, shares: [0.1, 0.2] } } });

/** What the plan check would change in a plan, in words: nothing for a plan that is legal as it stands. */
const notesOn = (view: CompanyView, plan: Plan | null, config: PlayConfig = CAREER_TEST): readonly string[] =>
  normalizePlanFor(view.self, view.turn, view.rivals, plan, config, view.climate.multiplier).notes;

/** The people a plan puts to work. */
const people = (plan: Plan): number => plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting;
const distinct = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/**
 * 1991, with seats 0 and 1 qualified to list: launched, at the bar's 250,000 users. Seat 0 lost $250,000 last year and
 * has $100,000 left, far under three years of cash. Seat 1 closed last year in profit and has $100,000 in hand.
 */
const qualified: GameState = withCompany(
  withCompany(qualify(qualify(atTurn(newCareer(), 2), HUMAN), BLITZ), HUMAN, { cash: 100_000, lastRevenue: 750_000, lastCosts: 1_000_000 }),
  BLITZ,
  { cash: 100_000 },
);
/** The same year for the same two companies, neither of them qualified. Nothing else differs. */
const notYetQualified: GameState = withCareerOf(withCareerOf(qualified, HUMAN, { qualified: false }), BLITZ, { qualified: false });

/** 1993, seat 1 with $2M and 40,000 users, far under the bar: it has not qualified to list. */
const privateBlitz: GameState = launchedCompany(atTurn(newCareer(), 4), BLITZ, { users: 40_000, cash: 2_000_000 });
/** 1993, seat 1 with $2M and 300,000 users, over the bar, after a year that lost $300,000: not qualified. */
const atBarLosing: GameState = launchedCompany(atTurn(newCareer(), 4), BLITZ, { users: 300_000, cash: 2_000_000, lastRevenue: 600_000, lastCosts: 900_000 });
/** The same company once it is public: it listed in 1992. */
const publicBlitz: GameState = withCareerOf(atBarLosing, BLITZ, { qualified: true, listed: { turn: 3, valuation: 49_500_000, amount: 9_900_000 } });

/** A Blitzscaler with 40 people and $50M that raised the year before, so nobody is set aside to raise, in seat 1 of a state. */
const bigTeam = (state: GameState): GameState =>
  launchedCompany(state, BLITZ, {
    users: 40_000,
    headcount: 40,
    headcountAtLastClose: 40,
    cash: 50_000_000,
    lastRaise: { turn: state.turn - 1, percent: 30, amount: 1_980_000 },
  });

/**
 * True of a state in which seat 1's Blitzscaler weighs plans that spend on marketing and plans that do not, every one
 * of the first kind closes the turn at a loss on the planner's own projection, and every one of the second closes it
 * at the bar with a profit.
 */
const profitsOnlyBySpendingNothing = (state: GameState, config: PlayConfig = CAREER_TEST): boolean => {
  const view = viewFor(state, BLITZ);
  const closes = candidatePlans(view, "blitzscaler", config).map((plan) => ({ plan, turn: projectTurn(view, plan, config) }));
  const spending = closes.filter(({ plan }) => plan.marketing > 0);
  const saving = closes.filter(({ plan }) => plan.marketing === 0);
  return (
    spending.length > 0 &&
    spending.every(({ turn }) => !turn.profitable) &&
    saving.length > 0 &&
    saving.every(({ turn }) => turn.profitable && turn.users >= config.ipo.users)
  );
};

describe("going public", () => {
  it.each(KINDS)("a %s goes public in the first year it qualifies, and not before", (kind) => {
    expect(chooseCpuPlan(viewFor(qualified, 1), kind, 1, CAREER_TEST).goPublic).toBe(true);
    expect(chooseCpuPlan(viewFor(notYetQualified, 1), kind, 1, CAREER_TEST).goPublic).toBe(false);
  });

  it("the baseline bot does the same, and asks for no raise in the year it lists", () => {
    // seat 0 of `qualified` opens the year with under three years of cash, so the bot would otherwise raise
    expect(baselinePlan(viewFor(qualified, 0), CAREER_TEST)).toMatchObject({ goPublic: true, raisePercent: 0 });
    expect(baselinePlan(viewFor(notYetQualified, 0), CAREER_TEST).goPublic).toBe(false);
    // Not yet qualified, it does raise, and one of its three people is set aside for that; listing, all three work.
    expect(baselinePlan(viewFor(notYetQualified, 0), CAREER_TEST)).toMatchObject({ raisePercent: 20, allocation: { product: 1, growth: 1, recruiting: 0 } });
    expect(baselinePlan(viewFor(qualified, 0), CAREER_TEST).allocation).toEqual({ product: 1, growth: 1, recruiting: 1 });
    expect(notesOn(viewFor(qualified, 0), baselinePlan(viewFor(qualified, 0), CAREER_TEST))).toEqual([]);
  });

  it("in the year it lists a computer player plans no raise, and sizes its marketing on what the listing brings", () => {
    // seat 1 of `qualified`: a private Blitzscaler with $100,000 in hand and a listing worth millions
    const view = viewFor(qualified, 1);
    const plans = candidatePlans(view, "blitzscaler", CAREER_TEST);
    expect(plans.every((plan) => plan.goPublic === true && plan.raisePercent === 0)).toBe(true);
    expect(Math.max(...plans.map((plan) => plan.marketing))).toBeGreaterThan(view.self.cash);
    for (const plan of plans) {
      expect(normalizePlanFor(view.self, view.turn, view.rivals, plan, CAREER_TEST, view.climate.multiplier).notes).toEqual([]);
    }
    // Nobody is set aside for a raise that will not happen: all three people work.
    expect(distinct(plans.map(people))).toEqual([3]);
    // And it does spend what the listing brings: having qualified, it has no profit left to protect this year.
    expect(chooseCpuPlan(view, "blitzscaler", 1, CAREER_TEST).marketing).toBeGreaterThan(view.self.cash);
  });

  it("in the race no plan mentions going public", () => {
    expect("goPublic" in chooseCpuPlan(viewFor(newGame(), 1), "blitzscaler", 1, DESIGN)).toBe(false);
    expect("goPublic" in baselinePlan(viewFor(newGame(), 0), DESIGN)).toBe(false);
    for (const kind of KINDS) expect(candidatePlans(viewFor(newGame(), 1), kind, DESIGN).some((plan) => "goPublic" in plan), kind).toBe(false);
  });

  it("a Blitzscaler raises 30% whenever it may, until it is public", () => {
    // privateBlitz has not qualified to list
    expect(chooseCpuPlan(viewFor(privateBlitz, 1), "blitzscaler", 1, CAREER_TEST).raisePercent).toBe(30);
    expect(chooseCpuPlan(viewFor(publicBlitz, 1), "blitzscaler", 1, CAREER_TEST).raisePercent).toBe(0);
  });

  it("cuts costs to list only until it has had a profitable year at the bar", () => {
    // at the bar, last year at a loss: no candidate spends on marketing or hires
    expect(candidatePlans(viewFor(atBarLosing, 1), "blitzscaler", CAREER_TEST).every((plan) => plan.marketing === 0 && plan.hireLimit === 0)).toBe(true);
    // once public, with cash: marketing is back among the candidates
    expect(candidatePlans(viewFor(publicBlitz, 1), "blitzscaler", CAREER_TEST).some((plan) => plan.marketing > 0)).toBe(true);
  });

  it("gives up a year's growth for the profit that qualifies it, and for no profit after that", () => {
    // 1993, seat 1 with 249,000 users and $20M: whatever it spends on marketing is more than the year brings in, so
    // only a plan that spends nothing closes with a profit, and such a plan closes at the bar.
    const underTheBar = launchedCompany(atTurn(newCareer(), 4), BLITZ, { users: 249_000, cash: 20_000_000 });
    const onceListed = withCareerOf(underTheBar, BLITZ, { qualified: true, listed: { turn: 3, valuation: 49_500_000, amount: 9_900_000 } });
    expect(profitsOnlyBySpendingNothing(underTheBar)).toBe(true);
    expect(profitsOnlyBySpendingNothing(onceListed)).toBe(true);
    expect(chooseCpuPlan(viewFor(underTheBar, 1), "blitzscaler", 1, CAREER_TEST).marketing).toBe(0);
    expect(chooseCpuPlan(viewFor(onceListed, 1), "blitzscaler", 1, CAREER_TEST).marketing).toBeGreaterThan(0);
  });

  it("in the final year it plays for its stake alone", () => {
    // turn 49: a private, launched Blitzscaler at the bar, with cash, that would close with a profit only by spending nothing
    const lastYearAtBar = launchedCompany(atTurn(newCareer(), 49), BLITZ, { users: 250_000, cash: 20_000_000 });
    expect(candidatePlans(viewFor(lastYearAtBar, 1), "blitzscaler", CAREER_TEST).some((plan) => plan.marketing > 0)).toBe(true); // not cutting costs to list
    expect(chooseCpuPlan(viewFor(lastYearAtBar, 1), "blitzscaler", 1, CAREER_TEST).marketing).toBeGreaterThan(0); // no prize for qualifying too late
    expect(profitsOnlyBySpendingNothing(lastYearAtBar)).toBe(true);
  });
});

describe("each year on its era's numbers", () => {
  it("plays on its era's numbers (Review Focus 2)", () => {
    // two eras; the first sets the Blitzscaler's teamCap to 12 and the second to 30; a Blitzscaler with 12 people and
    // $50M in cash, so that nothing but its era's cap decides whether it recruits
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: { cpu: { personalities: { blitzscaler: { teamCap: 12 } } } } },
      { id: "b", name: "B", firstYear: 1995, invented: false, values: { cpu: { personalities: { blitzscaler: { teamCap: 30 } } } } },
    );
    const twelvePeople = (turn: number): GameState => withCompany(atTurn(newCareer(config), turn), BLITZ, { headcount: 12, headcountAtLastClose: 12, cash: 50_000_000 });
    const inFirstEra = twelvePeople(5); // 1994
    const inSecondEra = twelvePeople(6); // 1995
    expect(candidatePlans(viewFor(inFirstEra, 1), "blitzscaler", config).every((plan) => plan.hireLimit === 0)).toBe(true);
    expect(candidatePlans(viewFor(inSecondEra, 1), "blitzscaler", config).some((plan) => (plan.hireLimit ?? 0) > 0)).toBe(true);
  });

  it("keeps the habits its era gives it: an era in which the Incumbent does not poach", () => {
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1995, invented: false, values: { cpu: { personalities: { incumbent: { poachRunway: null } } } } },
    );
    expect(chooseCpuPlan(viewFor(atTurn(newCareer(config), 5), 3), "incumbent", 1, config).poachTarget).not.toBeNull();
    expect(chooseCpuPlan(viewFor(atTurn(newCareer(config), 6), 3), "incumbent", 1, config).poachTarget).toBeNull();
  });

  it("the baseline bot counts its runway in the year's salaries", () => {
    // Seat 0 with $1M, three people and 2,000 users, before its first year's books. At $40,000 a head it has over
    // eight years of cash and can afford four hires; at the second era's $400,000 it has ten months, and raises.
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1995, invented: false, values: { salary: 400_000 } },
    );
    const state = (turn: number): GameState => launchedCompany(atTurn(newCareer(config), turn), HUMAN, { users: 2_000, cash: 1_000_000 });
    expect(baselinePlan(viewFor(state(5), 0), config)).toMatchObject({ raisePercent: 0, hireLimit: 4 });
    expect(baselinePlan(viewFor(state(6), 0), config)).toMatchObject({ raisePercent: 20, hireLimit: 0 });
  });
});

describe("recruiting, raising and layoffs", () => {
  it("weighs recruiters by share of its people once the config says so", () => {
    // `config` is CAREER_TEST with cpu.recruiters.shares [0.1, 0.2] and a Blitzscaler team cap of 60; `withoutShares` has
    // the cap alone. `big` has a Blitzscaler with 40 people, $50M in cash, fewer users than the bar and a raise last
    // year, so nobody is set aside to raise.
    const withoutShares = withStyle("blitzscaler", { teamCap: 60 });
    const config = withShares(withoutShares);
    const big = bigTeam(atTurn(newCareer(), 5));
    const recruiters = (plans: readonly Plan[]): number[] => [...new Set(plans.map((plan) => plan.allocation.recruiting))].sort((a, b) => a - b);
    expect(recruiters(candidatePlans(viewFor(big, 1), "blitzscaler", config))).toEqual([0, 1, 2, 4, 8]);
    expect(recruiters(candidatePlans(viewFor(big, 1), "blitzscaler", withoutShares))).toEqual([0, 1, 2]);
  });

  it("a one-person company does not send its one person to raise", () => {
    // a private Blitzscaler with one person, users above the raise's minimum and no cooldown running
    const onePerson = launchedCompany(atTurn(newCareer(), 4), BLITZ, { users: 5_000, headcount: 1, headcountAtLastClose: 1 });
    const plans = candidatePlans(viewFor(onePerson, 1), "blitzscaler", CAREER_TEST);
    expect(plans.every((plan) => plan.raisePercent === 0)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    expect(distinct(plans.map(people))).toEqual([1]); // and that one person works
    expect(chooseCpuPlan(viewFor(onePerson, 1), "blitzscaler", 1, CAREER_TEST)).toMatchObject({ raisePercent: 0, layoffs: 0 });
  });

  it("nor lays off down to one person and sends that one to raise", () => {
    // atBarLosing has three people and weighs laying off none, one or two of them to turn a profit at the bar.
    const plans = candidatePlans(viewFor(atBarLosing, 1), "blitzscaler", CAREER_TEST);
    expect(distinct(plans.map((plan) => plan.layoffs))).toEqual([0, 1, 2]);
    for (const plan of plans) {
      // Two laid off leaves one person, who works; otherwise it raises as ever, with one person set aside for it.
      expect(plan.raisePercent, `${plan.layoffs} laid off`).toBe(plan.layoffs === 2 ? 0 : 30);
      expect(people(plan), `${plan.layoffs} laid off`).toBe(plan.layoffs === 2 ? 1 : 2 - plan.layoffs);
      expect(notesOn(viewFor(atBarLosing, 1), plan), `${plan.layoffs} laid off`).toEqual([]);
    }
  });

  it("lays nobody off below a team of two", () => {
    // a Blitzscaler with five people and under a year of cash
    const shortOfCash = withCompany(atTurn(newCareer(), 4), BLITZ, { headcount: 5, headcountAtLastClose: 5, cash: 150_000 });
    const plans = candidatePlans(viewFor(shortOfCash, 1), "blitzscaler", CAREER_TEST);
    expect(plans.some((plan) => plan.layoffs > 0)).toBe(true);
    expect(plans.every((plan) => 5 - plan.layoffs >= 2)).toBe(true);
    // None, one or two, and three in place of every share of the five that would leave fewer than two.
    expect(distinct(plans.map((plan) => plan.layoffs))).toEqual([0, 1, 2, 3]);
    // A team of two short of cash lays nobody off.
    const twoPeople = withCompany(shortOfCash, BLITZ, { headcount: 2, headcountAtLastClose: 2, cash: 50_000 });
    expect(distinct(candidatePlans(viewFor(twoPeople, 1), "blitzscaler", CAREER_TEST).map((plan) => plan.layoffs))).toEqual([0]);
  });

  it("never plans more marketing than the cash in hand allows", () => {
    // 1992, in a funding winter. Seat 1 has 100,000 users and $100,000, 16 months of cash at last year's loss: short
    // enough for every style to raise, so its marketing may count on the raise.
    const winter = withState(atTurn(newCareer(), 3), { climate: { multiplier: 0.6, turnsLeft: 2 } });
    const seat1 = (patch: Partial<Company>, state: GameState = winter): GameState =>
      launchedCompany(state, BLITZ, { users: 100_000, cash: 100_000, lastRevenue: 425_000, lastCosts: 500_000, ...patch });
    const raising = seat1({});
    const cases: readonly (readonly [string, GameState])[] = [
      ["raising", raising],
      ["raising in the final year, when it may spend nearly all it has", seat1({}, atTurn(winter, 49))],
      ["with $1M and a raise last year, so none this year", seat1({ cash: 1_000_000, lastRaise: { turn: 2, percent: 30, amount: 2_970_000 } })],
      ["with one person, so the raise is off", seat1({ headcount: 1, headcountAtLastClose: 1 })],
      ["listing", qualified],
    ];
    for (const kind of KINDS) {
      for (const [name, state] of cases) {
        const view = viewFor(state, 1);
        const plans = candidatePlans(view, kind, CAREER_TEST);
        expect(plans.length, `${kind}, ${name}`).toBeGreaterThan(0);
        for (const plan of plans) expect(notesOn(view, plan).filter((note) => note.startsWith("Marketing set")), `${kind}, ${name}`).toEqual([]);
      }
      // The set-up: each style does raise from `raising`, and weighs spending more than the $100,000 it has in hand.
      const plans = candidatePlans(viewFor(raising, 1), kind, CAREER_TEST);
      expect(plans.every((plan) => plan.raisePercent > 0), kind).toBe(true);
      expect(Math.max(...plans.map((plan) => plan.marketing)), kind).toBeGreaterThan(100_000);
    }
  });
});

describe("reading the timeline", () => {
  // 1992. The Incumbent at quality 80 has a full team of 16, so it weighs no recruiters, with 100,000 users and $3M.
  // Its three rivals are launched at quality 50, so its share of the year's users turns on how many of the 16 are on
  // Growth. Every config here gives product quality a weight of 6 where the Incumbent's own is 2.5.
  const noShift = withStyle("incumbent", { weights: { ...CAREER_TEST.cpu.personalities.incumbent.weights, quality: 6 } });
  /** `noShift` with a shift dated to that year, cutting every product down to the ceiling. */
  const shiftIn = (year: number, ceiling: number): GameConfig =>
    withCareer({ dated: [{ year, id: "shift", name: "Shift", text: "…", effects: [{ kind: "qualityCeiling", ceiling, turns: 1 }] }] }, noShift);
  let state = atTurn(newCareer(), 3);
  for (const rival of [HUMAN, BLITZ, BOOT]) state = launchedCompany(state, rival, { quality: 50 });
  state = launchedCompany(state, INCUMBENT, { quality: 80, users: 100_000, headcount: 16, headcountAtLastClose: 16, cash: 3_000_000 });

  const productShare = (cfg: PlayConfig, seed: number): number => {
    const { allocation } = chooseCpuPlan(viewFor(state, 3), "incumbent", seed, cfg);
    return allocation.product / (allocation.product + allocation.growth);
  };
  const mean = (cfg: PlayConfig): number => SEEDS_1_TO_20.reduce((sum, seed) => sum + productShare(cfg, seed), 0) / 20;

  it("stops polishing a product that a shift is about to cut down", () => {
    // an Incumbent at quality 80 with cash to spare; `config` dates a shift to 30 for next year, `noShift` dates none.
    // Shape the state so that the habit shows: the test's configs may raise the Incumbent's weights.quality.
    const config = shiftIn(1993, 30);
    expect(mean(config)).toBeLessThan(mean(noShift));
    // Clear of the planner's noise: on average more than three of the 16 people move from Product to Growth.
    expect(mean(noShift) - mean(config)).toBeGreaterThan(0.2);
  });

  it("and holds back less while the shift is still two years off", () => {
    const nextYear = mean(shiftIn(1993, 30));
    const inTwoYears = mean(shiftIn(1994, 30));
    expect(inTwoYears).toBeGreaterThan(nextYear);
    expect(inTwoYears).toBeLessThan(mean(noShift));
    // It values what it builds for as many years as the shift is away. With a full team, that horizon is all that
    // tells its plans apart: with a shift in one year or two it plans as it would with no shift and a horizon of one
    // year or two in place of its own five.
    const view = viewFor(state, 3);
    for (const seed of SEEDS_1_TO_20) {
      expect(chooseCpuPlan(view, "incumbent", seed, shiftIn(1993, 30)), `seed ${seed}`).toEqual(chooseCpuPlan(view, "incumbent", seed, withStyle("incumbent", { horizon: 1 }, noShift)));
      expect(chooseCpuPlan(view, "incumbent", seed, shiftIn(1994, 30)), `seed ${seed}`).toEqual(chooseCpuPlan(view, "incumbent", seed, withStyle("incumbent", { horizon: 2 }, noShift)));
    }
  });

  it("judges by where the year would leave its product, not where it starts", () => {
    // A ceiling of 82 is above the 80 it starts the year at and below the 83 to 86 its plans end at.
    const config = shiftIn(1993, 82);
    const view = viewFor(state, 3);
    for (const plan of candidatePlans(view, "incumbent", config)) expect(projectTurn(view, plan, config).quality).toBeGreaterThan(82);
    expect(mean(noShift) - mean(config)).toBeGreaterThan(0.2);
  });

  it("builds on as before when the shift will leave its product alone", () => {
    // A ceiling of 95: the year's work takes the product to 86 at most, which that shift would not touch.
    const config = shiftIn(1993, 95);
    const view = viewFor(state, 3);
    for (const seed of SEEDS_1_TO_20) {
      const plan = chooseCpuPlan(view, "incumbent", seed, config);
      expect(projectTurn(view, plan, config).quality, `seed ${seed}`).toBeLessThan(95);
      expect(plan, `seed ${seed}`).toEqual(chooseCpuPlan(view, "incumbent", seed, noShift));
    }
  });

  it("and goes on recruiting: the people it hires are not lost to a shift", () => {
    // The same Incumbent with 8 of the 16 people its style allows, and $10M: it has room to hire, and the means.
    const hiring = launchedCompany(state, INCUMBENT, { quality: 80, users: 100_000, headcount: 8, headcountAtLastClose: 8, cash: 10_000_000 });
    const recruiters = (cfg: PlayConfig): number =>
      SEEDS_1_TO_20.reduce((sum, seed) => sum + chooseCpuPlan(viewFor(hiring, 3), "incumbent", seed, cfg).allocation.recruiting, 0);
    expect(recruiters(noShift)).toBeGreaterThan(0);
    expect(recruiters(shiftIn(1993, 30))).toBeGreaterThanOrEqual(recruiters(noShift));
  });
});

describe("the race plays none of this", () => {
  it("a one-person company still sends its one person to raise", () => {
    const alone = launchedCompany(withState(newGame(), { turn: 4 }), BLITZ, { users: 5_000, headcount: 1, headcountAtLastClose: 1 });
    const plans = candidatePlans(viewFor(alone, 1), "blitzscaler", DESIGN);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.raisePercent === 30 && people(plan) === 0)).toBe(true);
  });

  it("recruiters by share are a career's: a race config that names shares is played without them", () => {
    const cap60 = withStyle("blitzscaler", { teamCap: 60 }, DESIGN);
    const big = viewFor(bigTeam(withState(newGame(), { turn: 5 })), 1);
    expect(candidatePlans(big, "blitzscaler", withShares(cap60))).toEqual(candidatePlans(big, "blitzscaler", cap60));
    expect(distinct(candidatePlans(big, "blitzscaler", cap60).map((plan) => plan.allocation.recruiting))).toEqual([0, 1, 2]);
  });

  it("on its last turn a quarter at the bar with a profit still wins", () => {
    // A company that gets there only by spending nothing spends nothing, where a career's final year has it spend
    // for its stake.
    const lastQuarter = launchedCompany(withState(newGame(), { turn: DESIGN.game.maxTurns }), BLITZ, { users: 249_000, cash: 20_000_000 });
    expect(profitsOnlyBySpendingNothing(lastQuarter, DESIGN)).toBe(true);
    expect(chooseCpuPlan(viewFor(lastQuarter, 1), "blitzscaler", 1, DESIGN).marketing).toBe(0);
  });

  it("still lists its candidates raise by raise, and within a raise by layoffs", () => {
    // The order decides which plan gets which nudge of noise. A Bootstrapper with ten people, 5,000 users and under
    // a quarter's cash weighs three sizes of raise and seven of layoffs, down to one person.
    const state = launchedCompany(newGame(), BOOT, { users: 5_000, headcount: 10, headcountAtLastClose: 10, cash: 250_000, lastCosts: 400_000, lastRevenue: 0 });
    const pairs = [...new Set(candidatePlans(viewFor(state, 2), "bootstrapper", DESIGN).map((plan) => `${plan.raisePercent}% ${plan.layoffs}`))];
    expect(pairs).toEqual([10, 20, 30].flatMap((percent) => [0, 1, 2, 3, 5, 7, 9].map((layoffs) => `${percent}% ${layoffs}`)));
  });
});

describe("a whole career", () => {
  it("plans for a newcomer in its first year", () => {
    // Seat 2's company went out in 1993, so a new startup takes the seat as 1994 closes and plans from 1995.
    const before = outSince(atTurn(newCareer(), 5), BOOT, 4);
    const played = resolveTurn(before, choosePlans(before, 1, CAREER_TEST), 1, CAREER_TEST);
    expect(played.log.entrants).toEqual([BOOT]);
    const after = played.state;
    const newcomer = after.companies[BOOT];
    expect(newcomer.career?.founded).toBe(after.turn);
    expect(KINDS).toContain(newcomer.controller);

    const plan = choosePlans(after, 1, CAREER_TEST)[BOOT];
    if (plan === null) throw new Error("the newcomer got no plan");
    // A startup's first plan in its style: its style's price, all three at work, nothing to list or raise on yet.
    expect(plan).toMatchObject({ price: CAREER_TEST.cpu.personalities[newcomer.controller as CpuKind].price, goPublic: false, raisePercent: 0, layoffs: 0 });
    expect(people(plan)).toBe(3);
    expect(notesOn(viewFor(after, BOOT), plan)).toEqual([]);
  });

  it("chooses a plan for every seat through a whole career", () => {
    // 49 turns on CAREER_TEST for seeds 1 to 3, no throw. The config is typed as all it takes to play: `sim` is not read.
    const config: PlayConfig = CAREER_TEST;
    let listings = 0;
    for (const seed of [1, 2, 3]) {
      let state = createGame(newGameSetup(seed, "Acme", "baseline"), config);
      const played: number[] = [];
      while (state.outcome === null) {
        const turn = state.turn;
        const plans = choosePlans(state, seed, config);
        for (const company of state.companies) {
          const plan = plans[company.id];
          if (company.out !== null) {
            expect(plan, `seed ${seed}, turn ${turn}, seat ${company.id}`).toBeNull();
            continue;
          }
          if (plan === null) throw new Error(`seed ${seed}, turn ${turn}: seat ${company.id} got no plan`);
          // Every plan says whether the company goes public, lists in the first year it may, and is legal as it stands.
          expect(plan.goPublic, `seed ${seed}, turn ${turn}, seat ${company.id}`).toBe(listingBlocker(company, turn, config) === null);
          expect(notesOn(viewFor(state, company.id), plan, config), `seed ${seed}, turn ${turn}, seat ${company.id}`).toEqual([]);
        }
        const result = resolveTurn(state, plans, seed, config);
        listings += result.log.companies.filter((report) => (report?.career?.listing ?? null) !== null).length;
        played.push(turn);
        state = result.state;
      }
      expect(played).toEqual(Array.from({ length: 49 }, (_, i) => i + 1));
      expect(state.outcome.turn).toBe(49);
    }
    expect(listings).toBeGreaterThan(0);
  });
});
