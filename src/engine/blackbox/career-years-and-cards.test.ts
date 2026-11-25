// Black-box tests for the career's rules C1 (time), C2 (eras), C3 (dated events) and C4 (platform shifts), written
// from docs/superpowers/specs/2026-11-25-career-3d-design.md (sections 5 and 6), docs/career-rules.md and
// docs/turn-based-design.md alone. The engine's code and its own tests were not read.
//
// Every rule test runs on CAREER_TEST (the race's frozen design numbers played as a career, events off) or on a
// variant of it. Its numbers, which the arithmetic below uses:
//   salary $40K · new users 20,000 in turn 1, +10% a turn · 6 candidates · capacity 2 × Recruiting work · fee $10K
//   quality +5 × Product work × (1 − q/100), then −2 · launch at 10 · valuation $150 a user · events from turn 3.
//   Three people on Product: effective work 3^0.9 = 2.687869.
//
// A year is 1989 + turn: 1990 is turn 1, 1995 turn 6, 2000 turn 11, 2038 turn 49. A card dated to year Y is drawn as
// turn Y − 1 closes (step 14), so the tests resolve turn Y − 1990 to see it arrive.
//
// "Idle" companies put everyone on Recruiting with "hire at most 0": no Product work, so quality only decays by 2.

import { describe, expect, it } from "vitest";
import { CAREER_DESIGN, DESIGN } from "../../config.design";
import {
  createGame,
  datedCardFor,
  datedHeldCeiling,
  eraIndexOf,
  projectTurn,
  resolveTurn,
  rulesForTurn,
  turnOf,
  upcomingShift,
  viewFor,
  yearOf,
} from "../index";
import type { CompanyReport, DatedCard, EventCard, EventEffect, GameState, Plan, TargetRule, TurnResult } from "../index";
import { atTurn, CAREER_RULES, CAREER_TEST, careerOf, newCareer, withCareer, withCareerOf, withEras } from "../careerKit";
import { BLITZ, BOOT, FOUR_SEATS, HUMAN, INCUMBENT, launchedCompany, onlyActive, plansOf, withCompany } from "../testKit";

type Config = typeof CAREER_TEST;
type Era = Parameters<typeof withEras>[number];

// ── Helpers ──

const play = (state: GameState, config: Config, patches: Readonly<Record<number, Partial<Plan>>> = {}, seed = 1): TurnResult =>
  resolveTurn(state, plansOf(state, patches), seed, config);

const reportOf = (result: TurnResult, id: number): CompanyReport => {
  const report = result.log.companies[id];
  if (!report) throw new Error(`company ${id} has no report`);
  return report;
};

const dated = (id: string, year: number, effects: EventEffect[], target?: TargetRule): DatedCard => ({
  id,
  year,
  name: id,
  text: id,
  effects,
  ...(target ? { target } : {}),
});

const deckCard = (id: string, effects: EventEffect[]): EventCard => ({ id, name: id, text: id, weight: 1, effects });

/** A platform shift as the career writes it: the ceiling, then the wave of 1.3 for 3 years. */
const shift = (year: number, ceiling = 30, turns = 1): DatedCard =>
  dated(`shift-${year}`, year, [
    { kind: "qualityCeiling", ceiling, turns },
    { kind: "userWave", multiplier: 1.3, turns: 3 },
  ]);

const era = (id: string, firstYear: number, values: Era["values"] = {}): Era => ({ id, name: id, firstYear, invented: false, values });

const turnFor = (year: number): number => year - 1989;

/** Everyone on Recruiting, nobody hired: no Product work. */
const idle = (headcount: number): Partial<Plan> => ({
  allocation: { product: 0, growth: 0, recruiting: headcount },
  hireLimit: 0,
  marketing: 0,
});

const PRODUCT_3: Partial<Plan> = { allocation: { product: 3, growth: 0, recruiting: 0 }, hireLimit: 0, marketing: 0 };

/** Users the design's curve brings in a turn: 20,000 × 1.1^(turn − 1). */
const baseNewUsers = (turn: number): number => 20_000 * 1.1 ** (turn - 1);

/** Within one user or one dollar: the documents do not say whether a product is rounded before or after a multiplier. */
const expectNear = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
};

// ── C1. Time ──

describe("C1: a career is 49 turns of one year, 1990 to 2038", () => {
  it("starts on turn 1, the year 1990", () => {
    expect(newCareer().turn).toBe(1);
    expect(yearOf(1, CAREER_RULES)).toBe(1990);
  });

  it("dates turn 49 to 2038, and 2038 to turn 49", () => {
    expect(yearOf(49, CAREER_RULES)).toBe(2038);
    expect(turnOf(2038, CAREER_RULES)).toBe(49);
    expect(turnOf(1995, CAREER_RULES)).toBe(6);
  });

  it("counts a year as firstYear + turn − 1 for any first year", () => {
    const career = { ...CAREER_RULES, firstYear: 2000 };
    expect(yearOf(1, career)).toBe(2000);
    expect(yearOf(5, career)).toBe(2004);
    expect(turnOf(2004, career)).toBe(5);
  });

  it("brings a card dated 1994 in turn 5, and not in turn 4", () => {
    const config = withCareer({ dated: [dated("c1994", 1994, [{ kind: "candidates", extra: 1 }])] });
    expect(play(atTurn(newCareer(config), 3), config).log.nextEvent).toBeNull();
    const result = play(atTurn(newCareer(config), 4), config);
    expect(result.log.nextEvent?.cardId).toBe("c1994");
    expect(result.state.turn).toBe(5);
    expect(result.state.event?.cardId).toBe("c1994");
  });

  it("brings a card dated 2004 in turn 5 of a career that starts in 2000", () => {
    const config = withCareer({ firstYear: 2000, eras: [era("flat", 2000)], dated: [dated("c2004", 2004, [{ kind: "candidates", extra: 1 }])] });
    expect(play(atTurn(newCareer(config), 4), config).log.nextEvent?.cardId).toBe("c2004");
  });

  it("goes on after turn 48 (2037) with no outcome", () => {
    const result = play(atTurn(newCareer(), 48), CAREER_TEST);
    expect(result.log.outcome).toBeNull();
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(49);
  });

  it("ends after turn 49 (2038) on the largest founder's stake", () => {
    const result = play(atTurn(newCareer(), 49), CAREER_TEST);
    expect(result.state.outcome).toMatchObject({ kind: "turnLimit", turn: 49 });
    expect(result.state.turn).toBe(49);
    // The winner is the company still in the game with the largest founder equity × valuation; ties go to the
    // higher valuation, then the lower seat (ruling 6).
    const standing = result.log.companies
      .filter((report): report is CompanyReport => report !== null && report.out === null)
      .map((report) => ({ id: report.companyId, stake: report.equity * report.valuation, valuation: report.valuation }))
      .sort((a, b) => b.stake - a.stake || b.valuation - a.valuation || a.id - b.id);
    expect(result.state.outcome?.winnerId).toBe(standing[0].id);
  });

  it("ends in a wipeout when nobody is left after the last year", () => {
    // Only the player is in the game, its rescue spent, with no cash and three salaries to pay: it goes out in 2038.
    let state = onlyActive(atTurn(newCareer(), 49), [HUMAN]);
    state = withCompany(state, HUMAN, { cash: 0 });
    state = withCareerOf(state, HUMAN, { rescue: { turn: 10, reason: "bankrupt" } });
    const result = play(state, CAREER_TEST, { [HUMAN]: idle(3) });
    expect(result.state.companies[HUMAN].out).not.toBeNull();
    expect(result.state.outcome).toMatchObject({ kind: "wipeout", turn: 49, winnerId: null });
  });

  it("does not end when one company is left before the last year", () => {
    const result = play(onlyActive(atTurn(newCareer(), 10), [HUMAN]), CAREER_TEST);
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(11);
  });

  it("keeps a wave at rest in a career, and none at all in a race", () => {
    expect(newCareer().wave).toEqual({ multiplier: 1, turnsLeft: 0 });
    expect(createGame(FOUR_SEATS, DESIGN).wave).toBeUndefined();
  });
});

// ── C2. Eras ──

describe("C2: an era's values hold for its years", () => {
  // Three eras: the base numbers to 1994; from 1995 a bigger, faster market, dearer staff, more candidates; from 2000
  // the base numbers again, since that era sets nothing.
  const ERAS = withEras(
    era("one", 1990),
    era("two", 1995, { market: { newUsersTurn1: 100_000, growthPerTurn: 0.4 }, salary: 100_000, hiring: { candidatesPerTurn: 9 } }),
    era("three", 2000),
  );
  const yearPlayed = (year: number, config: Config = ERAS, patches: Readonly<Record<number, Partial<Plan>>> = {}): TurnResult =>
    play(atTurn(newCareer(config), turnFor(year)), config, patches);

  it("brings the first era's 20,000 new users in 1990", () => {
    expect(play(newCareer(ERAS), ERAS).log.market.newUsers).toBe(20_000);
  });

  it("follows the first era's curve to its last year: 20,000 × 1.1^4 = 29,282 in 1994", () => {
    expect(yearPlayed(1994).log.market.newUsers).toBe(29_282);
  });

  it("starts the next era's curve again in its first year: 100,000 in 1995", () => {
    expect(yearPlayed(1995).log.market.newUsers).toBe(100_000);
  });

  it("grows the era's curve from its own first year: 140,000 in 1996 and 100,000 × 1.4^4 = 384,160 in 1999", () => {
    expect(yearPlayed(1996).log.market.newUsers).toBe(140_000);
    expect(yearPlayed(1999).log.market.newUsers).toBe(384_160);
  });

  it("goes back to the base curve in an era that sets none, counted from that era's first year", () => {
    expect(yearPlayed(2000).log.market.newUsers).toBe(20_000);
    expect(yearPlayed(2001).log.market.newUsers).toBe(22_000);
  });

  it("starts a curve again from the base first-year users when the era sets only the growth", () => {
    const config = withEras(era("one", 1990), era("fast", 1995, { market: { growthPerTurn: 0.5 } }));
    expect(yearPlayed(1995, config).log.market.newUsers).toBe(20_000);
    expect(yearPlayed(1996, config).log.market.newUsers).toBe(30_000);
  });

  it("pays each year's salary: 3 × $40K in 1994, 3 × $100K in 1995, 3 × $40K again in 2000", () => {
    expect(reportOf(yearPlayed(1994), HUMAN).costs.salaries).toBe(120_000);
    expect(reportOf(yearPlayed(1995), HUMAN).costs.salaries).toBe(300_000);
    expect(reportOf(yearPlayed(2000), HUMAN).costs.salaries).toBe(120_000);
  });

  it("offers each year's candidates: 6 in 1994, 9 in 1995", () => {
    expect(yearPlayed(1994).log.hiring.candidates).toBe(6);
    expect(yearPlayed(1995).log.hiring.candidates).toBe(9);
  });

  it("keeps the base hiring numbers the era does not set: capacity 2 × work and a $10K fee in 1995", () => {
    // Alone in the game, three recruiters: capacity round(2 × 2.687869) = 5 of 9 candidates, 5 × $10K in fees.
    const config = ERAS;
    const state = onlyActive(atTurn(newCareer(config), turnFor(1995)), [HUMAN]);
    const report = reportOf(play(state, config, { [HUMAN]: { allocation: { product: 0, growth: 0, recruiting: 3 }, hireLimit: null } }), HUMAN);
    expect(report.hiring.capacity).toBe(5);
    expect(report.hiring.hired).toBe(5);
    expect(report.costs.hiring).toBe(50_000);
  });

  it("builds product at the era's pace: gain 11 × 2.687869 = 29.5666 in its years, 13.4393 the year before", () => {
    const config = withEras(era("one", 1990), era("fast", 1995, { quality: { gainPerWork: 11 } }));
    const before = reportOf(play(atTurn(newCareer(config), turnFor(1994)), config, { [HUMAN]: PRODUCT_3 }), HUMAN);
    const during = reportOf(play(atTurn(newCareer(config), turnFor(1995)), config, { [HUMAN]: PRODUCT_3 }), HUMAN);
    expect(before.quality.gain).toBeCloseTo(13.4393, 3);
    expect(during.quality.gain).toBeCloseTo(29.5666, 3);
    expect(during.quality.end).toBeCloseTo(27.5666, 3); // the base decay of 2 still applies
  });

  it("values users at the era's price", () => {
    // Alone and launched with 10,000 users: valuation = users × $600 × (1 + hype/100), climate 1.
    const config = withEras(era("one", 1990), era("rich", 1995, { valuation: { perUser: 600 } }));
    const state = onlyActive(launchedCompany(atTurn(newCareer(config), turnFor(1995)), HUMAN), [HUMAN]);
    const report = reportOf(play(state, config, { [HUMAN]: PRODUCT_3 }), HUMAN);
    expectNear(report.valuation, report.users.end * 600 * (1 + report.hype.end / 100));
  });

  it("replaces the deck whole with the era's: every draw in its first year is its one card", () => {
    const config = withEras(era("one", 1990), era("cards", 1995, { events: { chance: 1, deck: [deckCard("only", [{ kind: "candidates", extra: 2 }])] } }), era("three", 2000));
    for (let seed = 1; seed <= 6; seed++) {
      expect(play(atTurn(newCareer(config), turnFor(1994)), config, {}, seed).log.nextEvent?.cardId).toBe("only");
    }
  });

  it("draws from the era's deck only from its first year, and from the base deck again after it", () => {
    const config = withEras(era("one", 1990), era("cards", 1995, { events: { chance: 1, deck: [deckCard("only", [{ kind: "candidates", extra: 2 }])] } }), era("three", 2000));
    expect(play(atTurn(newCareer(config), turnFor(1993)), config).log.nextEvent).toBeNull(); // 1994: the base chance is 0
    expect(play(atTurn(newCareer(config), turnFor(1999)), config).log.nextEvent).toBeNull(); // 2000: the base chance again
  });

  it("gives the numbers of a year as the config with its era's values laid over it", () => {
    expect(rulesForTurn(ERAS, turnFor(1994)).salary).toBe(40_000);
    expect(rulesForTurn(ERAS, turnFor(1995)).salary).toBe(100_000);
    expect(rulesForTurn(ERAS, turnFor(1995)).hiring).toEqual({ candidatesPerTurn: 9, capacityPerWork: 2, fee: 10_000 });
    expect(rulesForTurn(ERAS, turnFor(2000)).salary).toBe(40_000);
    expect(rulesForTurn(ERAS, turnFor(2038)).market).toEqual({ newUsersTurn1: 20_000, growthPerTurn: 0.1 });
  });

  it("finds the era of a year: the last era whose first year has come", () => {
    const career = ERAS.career ?? CAREER_RULES;
    expect(eraIndexOf(1, career)).toBe(0);
    expect(eraIndexOf(turnFor(1994), career)).toBe(0);
    expect(eraIndexOf(turnFor(1995), career)).toBe(1);
    expect(eraIndexOf(turnFor(1999), career)).toBe(1);
    expect(eraIndexOf(turnFor(2000), career)).toBe(2);
    expect(eraIndexOf(49, career)).toBe(2);
  });

  it("ships eight eras in order from 1990, two of them invented", () => {
    const eras = CAREER_DESIGN.career.eras;
    expect(eras.map((each) => each.firstYear)).toEqual([1990, 1995, 2000, 2007, 2014, 2022, 2027, 2033]);
    expect(eras.filter((each) => each.invented).map((each) => each.firstYear)).toEqual([2027, 2033]);
    expect(CAREER_DESIGN.career.firstYear).toBe(eras[0].firstYear);
  });
});

// ── C3. Dated events ──

describe("C3: a dated card is its year's card", () => {
  const CHANCE_ONE: Config = { ...CAREER_TEST, events: { ...DESIGN.events, chance: 1 } };
  const DECK_IDS = DESIGN.events.deck.map((each) => each.id);

  it("replaces the random draw of its year, whatever the dice say", () => {
    const config = withCareer({ dated: [dated("c1995", 1995, [{ kind: "candidates", extra: 1 }])] }, CHANCE_ONE);
    for (let seed = 1; seed <= 8; seed++) {
      const result = play(atTurn(newCareer(config), turnFor(1994)), config, {}, seed);
      expect(result.log.nextEvent).toEqual({ cardId: "c1995", targetId: null });
    }
  });

  it("leaves the year after it to the random draw", () => {
    const config = withCareer({ dated: [dated("c1995", 1995, [{ kind: "candidates", extra: 1 }])] }, CHANCE_ONE);
    const next = play(atTurn(newCareer(config), turnFor(1995)), config).log.nextEvent;
    expect(next).not.toBeNull();
    expect(DECK_IDS).toContain(next?.cardId);
  });

  it("brings no card in a year without one when the deck's chance is 0", () => {
    const config = withCareer({ dated: [dated("c1995", 1995, [{ kind: "candidates", extra: 1 }])] });
    expect(play(atTurn(newCareer(config), turnFor(1995)), config).log.nextEvent).toBeNull();
  });

  it("comes in turn 2 although random draws start at turn 3", () => {
    const config = withCareer({ dated: [dated("c1991", 1991, [{ kind: "candidates", extra: 1 }])] });
    expect(play(newCareer(config), config).state.event?.cardId).toBe("c1991");
  });

  it("deals the first year's card with the game", () => {
    const config = withCareer({ dated: [dated("c1990", 1990, [{ kind: "newUsers", multiplier: 0.8 }])] });
    const state = newCareer(config);
    expect(state.event?.cardId).toBe("c1990");
    expect(state.modifiers.newUsers).toBe(0.8);
    expect(play(state, config).log.market.newUsers).toBe(16_000); // 20,000 × 0.8
  });

  it("lets the first year's card hit no one company, though its other effects hold", () => {
    const config = withCareer({
      dated: [dated("c1990", 1990, [{ kind: "targetHype", delta: 20 }, { kind: "newUsers", multiplier: 1.5 }], { pick: "random" })],
    });
    const state = newCareer(config);
    expect(state.event).toEqual({ cardId: "c1990", targetId: null });
    expect(state.companies.map((company) => company.hype)).toEqual([10, 10, 10, 20]);
    expect(state.modifiers.newUsers).toBe(1.5);
  });

  it("applies every effect of a crash: valuations, new users and candidates", () => {
    const config = withCareer({
      dated: [
        dated("crash", 1995, [
          { kind: "fundingClimate", multiplier: 0.5, turns: 3 },
          { kind: "newUsers", multiplier: 0.8 },
          { kind: "candidates", extra: 4 },
        ]),
      ],
    });
    const drawn = play(atTurn(newCareer(config), turnFor(1994)), config).state;
    expect(drawn.climate).toEqual({ multiplier: 0.5, turnsLeft: 3 });
    expect(drawn.modifiers).toEqual({ newUsers: 0.8, marketing: 1, extraCandidates: 4 });
    const year = play(drawn, config);
    expectNear(year.log.market.newUsers, baseNewUsers(6) * 0.8); // 32,210.2 × 0.8 = 25,768
    expect(year.log.hiring.candidates).toBe(10); // 6 + 4
    expect(year.log.climateMultiplier).toBe(0.5);
  });

  it("keeps a dated funding climate for its N years, counting its own, then lets it go", () => {
    const config = withCareer({ dated: [dated("crash", 1995, [{ kind: "fundingClimate", multiplier: 0.5, turns: 3 }])] });
    let state = play(atTurn(newCareer(config), turnFor(1994)), config).state;
    const multipliers: number[] = [];
    for (let year = 1995; year <= 1998; year++) {
      const result = play(state, config);
      multipliers.push(result.log.climateMultiplier);
      state = result.state;
    }
    expect(multipliers).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it("carries the one-year changes for its year only", () => {
    const config = withCareer({ dated: [dated("boom", 1995, [{ kind: "newUsers", multiplier: 1.25 }, { kind: "candidates", extra: -2 }])] });
    const year = play(play(atTurn(newCareer(config), turnFor(1994)), config).state, config);
    expect(year.log.hiring.candidates).toBe(4); // 6 − 2
    expect(year.state.modifiers).toEqual({ newUsers: 1, marketing: 1, extraCandidates: 0 });
  });

  it("puts a dated card's marketing change in the year's modifiers", () => {
    const config = withCareer({ dated: [dated("adverts", 1995, [{ kind: "marketingEffect", multiplier: 1.5 }])] });
    expect(play(atTurn(newCareer(config), turnFor(1994)), config).state.modifiers.marketing).toBe(1.5);
  });

  it("never offers fewer than no candidates", () => {
    const config = withCareer({ dated: [dated("drought", 1995, [{ kind: "candidates", extra: -10 }])] });
    const year = play(play(atTurn(newCareer(config), turnFor(1994)), config).state, config);
    expect(year.log.hiring.candidates).toBe(0); // 6 − 10, not below 0
    expect(year.log.companies.every((report) => report === null || report.hiring.hired === 0)).toBe(true);
  });

  describe("a dated card with a target", () => {
    const OUTAGE = dated(
      "outage",
      1995,
      [
        { kind: "targetUsers", fraction: 0.1 },
        { kind: "targetHype", delta: -10 },
        { kind: "newUsers", multiplier: 1.5 },
      ],
      { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
    );
    const config = withCareer({ dated: [OUTAGE] });
    /** 1994, with only the player and the Incumbent in the game; the Incumbent's product is too good to be hit. */
    const start = (): GameState =>
      withCompany(onlyActive(atTurn(newCareer(config), turnFor(1994)), [HUMAN, INCUMBENT]), INCUMBENT, { quality: 80 });

    it("is still in force when no company meets its rule, and hits nobody", () => {
      // The player stays unlaunched; the Incumbent closes 1994 above quality 50.
      const result = play(start(), config, { [HUMAN]: idle(3) });
      expect(result.state.event).toEqual({ cardId: "outage", targetId: null });
      expect(result.state.modifiers.newUsers).toBe(1.5);
      const incumbent = reportOf(result, INCUMBENT);
      expect(result.state.companies[INCUMBENT].users).toBe(incumbent.users.end);
      expect(result.state.companies[INCUMBENT].hype).toBe(incumbent.hype.end);
    });

    it("hits the one company that meets its rule", () => {
      // The player: launched at 40 with 10,000 users; 40 + 5 × 2.687869 × 0.6 − 2 = 46.06, still under 50.
      const state = launchedCompany(start(), HUMAN, { quality: 40 });
      const result = play(state, config, { [HUMAN]: PRODUCT_3 });
      const report = reportOf(result, HUMAN);
      expect(result.state.event).toEqual({ cardId: "outage", targetId: HUMAN });
      expectNear(result.state.companies[HUMAN].users, report.users.end * 0.9);
      expect(result.state.companies[HUMAN].hype).toBeCloseTo(Math.max(0, report.hype.end - 10), 4);
    });

    it("passes over a product at exactly the quality it must be below", () => {
      // Idle from 52: it closes 1994 at exactly 50, which is not below 50.
      const state = onlyActive(launchedCompany(atTurn(newCareer(config), turnFor(1994)), HUMAN, { quality: 52 }), [HUMAN]);
      const result = play(state, config, { [HUMAN]: idle(3) });
      expect(reportOf(result, HUMAN).quality.end).toBe(50);
      expect(result.state.event).toEqual({ cardId: "outage", targetId: null });
    });

    it("hits a product just below that quality", () => {
      // Idle from 51.5: it closes 1994 at 49.5.
      const state = onlyActive(launchedCompany(atTurn(newCareer(config), turnFor(1994)), HUMAN, { quality: 51.5 }), [HUMAN]);
      const result = play(state, config, { [HUMAN]: idle(3) });
      expect(result.state.event).toEqual({ cardId: "outage", targetId: HUMAN });
    });
  });

  it("comes in the last year, 2038, when one is dated to it", () => {
    const config = withCareer({ dated: [dated("c2038", 2038, [{ kind: "candidates", extra: 1 }])] });
    expect(play(atTurn(newCareer(config), 48), config).log.nextEvent?.cardId).toBe("c2038");
  });

  it("draws nothing after the last year, even a card dated to 2039", () => {
    const config = withCareer({ dated: [dated("c2039", 2039, [{ kind: "candidates", extra: 1 }])] });
    expect(play(atTurn(newCareer(config), 49), config).log.nextEvent).toBeNull();
  });

  it("finds the dated card of a turn, and none in a year without one", () => {
    const config = withCareer({ dated: [dated("c1995", 1995, [{ kind: "candidates", extra: 1 }])] });
    expect(datedCardFor(turnFor(1995), config)?.id).toBe("c1995");
    expect(datedCardFor(turnFor(1994), config)).toBeNull();
    expect(datedCardFor(turnFor(1996), config)).toBeNull();
  });

  describe("the shipped timeline", () => {
    const cards = CAREER_DESIGN.career.dated;
    const byYear = (year: number): DatedCard | undefined => cards.find((each) => each.year === year);

    it("has 28 dated cards, at most one a year, all from 1990 to 2037", () => {
      expect(cards).toHaveLength(28);
      expect(new Set(cards.map((each) => each.year)).size).toBe(28);
      expect(cards.every((each) => each.year >= 1990 && each.year <= 2037)).toBe(true);
    });

    it("leaves 1992, 1996, 1997, 2026 and the final year to the random deck", () => {
      for (const year of [1992, 1996, 1997, 2026, 2038]) expect(byYear(year)).toBeUndefined();
    });

    it("gives the crashes and booms more than a change in valuations", () => {
      expect(byYear(2000)?.effects).toEqual([
        { kind: "fundingClimate", multiplier: 0.5, turns: 3 },
        { kind: "newUsers", multiplier: 0.7 },
        { kind: "candidates", extra: 4 },
      ]);
      expect(byYear(2008)?.effects).toEqual([
        { kind: "fundingClimate", multiplier: 0.5, turns: 2 },
        { kind: "newUsers", multiplier: 0.8 },
        { kind: "candidates", extra: 4 },
      ]);
      expect(byYear(1998)?.effects).toEqual([
        { kind: "fundingClimate", multiplier: 1.6, turns: 2 },
        { kind: "newUsers", multiplier: 1.25 },
        { kind: "candidates", extra: -2 },
      ]);
    });

    it("aims the two outage cards at one weak launched product with users", () => {
      expect(byYear(2011)?.target).toEqual({ pick: "random", launched: true, qualityBelow: 50, minUsers: 1 });
      expect(byYear(2011)?.effects).toEqual([{ kind: "targetUsers", fraction: 0.1 }, { kind: "targetHype", delta: -10 }]);
      expect(byYear(2035)?.target).toEqual({ pick: "random", launched: true, qualityBelow: 60, minUsers: 1 });
      expect(byYear(2035)?.effects).toEqual([{ kind: "targetUsers", fraction: 0.2 }, { kind: "targetHype", delta: -15 }]);
    });

    it("keeps funding climates, ceilings and waves out of every era's deck", () => {
      const owned = new Set(["fundingClimate", "qualityCeiling", "userWave"]);
      for (const each of CAREER_DESIGN.career.eras) {
        const deck = each.values.events?.deck ?? [];
        expect(deck.length).toBeGreaterThanOrEqual(5);
        expect(deck.length).toBeLessThanOrEqual(7);
        expect(deck.flatMap((c) => c.effects).some((effect) => owned.has(effect.kind))).toBe(false);
      }
    });
  });
});

// ── C4. Platform shifts ──

describe("C4: a platform shift cuts every product down to its ceiling and brings a wave of new users", () => {
  /**
   * 1994 with every company idle, so each closes the year 2 below where it starts: the player at 90 (launched),
   * the Blitzscaler at 35 (launched), the Bootstrapper at 6 (not launched), the Incumbent at 60.
   */
  const before = (config: Config): GameState => {
    let state = atTurn(newCareer(config), turnFor(1994));
    state = launchedCompany(state, HUMAN, { quality: 92 });
    state = launchedCompany(state, BLITZ, { quality: 37, users: 5_000, usersAtLastClose: 5_000 });
    state = withCompany(state, BOOT, { quality: 8, launched: false, users: 0, usersAtLastClose: 0 });
    state = withCompany(state, INCUMBENT, { quality: 62 });
    return state;
  };
  const ALL_IDLE = { [HUMAN]: idle(3), [BLITZ]: idle(3), [BOOT]: idle(3), [INCUMBENT]: idle(8) };
  /** The state 1995 opens on, after its card. */
  const opened = (config: Config): TurnResult => play(before(config), config, ALL_IDLE);

  const HELD = withCareer({ dated: [shift(1995)] });
  const ONCE = withCareer({ dated: [shift(1995, 30, 0)] });

  it("cuts every company above the ceiling down to it as the year opens, the Incumbent included", () => {
    const state = opened(HELD).state;
    expect(state.event?.cardId).toBe("shift-1995");
    expect(state.companies.map((company) => company.quality)).toEqual([30, 30, 6, 30]);
  });

  it("takes nothing from a product below the ceiling or exactly at it", () => {
    const config = withCareer({ dated: [shift(1995, 35)] });
    const state = opened(config).state;
    expect(state.companies[BLITZ].quality).toBe(35); // closed at 35: at the ceiling
    expect(state.companies[BOOT].quality).toBe(6);
    expect(state.companies[HUMAN].quality).toBe(35);
  });

  it("keeps last year's closing quality public, from before the cut", () => {
    const state = opened(HELD).state;
    expect([HUMAN, BLITZ, BOOT, INCUMBENT].map((id) => careerOf(state, id).qualityAtLastClose)).toEqual([90, 35, 6, 60]);
  });

  it("cuts a launched product below the launch bar without taking its launch away", () => {
    const state = opened(withCareer({ dated: [shift(1995, 5)] })).state;
    expect(state.companies[HUMAN]).toMatchObject({ quality: 5, launched: true });
    expect(state.companies[INCUMBENT]).toMatchObject({ quality: 5, launched: true });
  });

  it("cuts a product that has not launched, too", () => {
    const state = opened(withCareer({ dated: [shift(1995, 5)] })).state;
    expect(state.companies[BOOT]).toMatchObject({ quality: 5, launched: false });
  });

  it("reports how much quality the card took from each company", () => {
    const year = play(opened(HELD).state, HELD, ALL_IDLE);
    expect([HUMAN, BLITZ, BOOT, INCUMBENT].map((id) => reportOf(year, id).career?.qualityLostToEvent)).toEqual([60, 5, 0, 30]);
    expect(reportOf(year, HUMAN).quality.start).toBe(30);
  });

  it("reports no quality lost in a year without a shift", () => {
    const year = play(before(HELD), HELD, ALL_IDLE);
    expect(year.log.companies.map((report) => report?.career?.qualityLostToEvent)).toEqual([0, 0, 0, 0]);
  });

  it("holds a ceiling with turns 1 through its year: Product work lifts a product to it and no further", () => {
    // Uncapped: 30 + 5 × 2.687869 × 0.7 − 2 = 37.4075.
    const year = play(opened(HELD).state, HELD, { ...ALL_IDLE, [HUMAN]: PRODUCT_3 });
    expect(reportOf(year, HUMAN).quality.end).toBe(30);
    expect(year.state.companies[HUMAN].quality).toBe(30);
    expect(careerOf(year.state, HUMAN).qualityAtLastClose).toBe(30);
  });

  it("caps a product that starts the year below a held ceiling and would pass it", () => {
    // The Blitzscaler closes 1994 at 25: 25 + 5 × 2.687869 × 0.75 − 2 = 33.08, held to 30.
    const config = HELD;
    const state = withCompany(before(config), BLITZ, { quality: 27 });
    const year = play(play(state, config, ALL_IDLE).state, config, { ...ALL_IDLE, [BLITZ]: PRODUCT_3 });
    expect(reportOf(year, BLITZ).quality.start).toBe(25);
    expect(reportOf(year, BLITZ).quality.end).toBe(30);
  });

  it("lets a product decay below a held ceiling as usual", () => {
    const year = play(opened(HELD).state, HELD, ALL_IDLE);
    expect(reportOf(year, HUMAN).quality.end).toBe(28); // 30 − 2
  });

  it("makes a ceiling with turns 0 a cut made once: that year's Product work builds on it", () => {
    const year = play(opened(ONCE).state, ONCE, { ...ALL_IDLE, [HUMAN]: PRODUCT_3 });
    expect(opened(ONCE).state.companies[HUMAN].quality).toBe(30);
    expect(reportOf(year, HUMAN).quality.end).toBeCloseTo(37.4075, 3);
  });

  it("starts the rebuilding the year after a held ceiling", () => {
    const shiftYear = play(opened(HELD).state, HELD, { ...ALL_IDLE, [HUMAN]: PRODUCT_3 });
    const after = play(shiftYear.state, HELD, { ...ALL_IDLE, [HUMAN]: PRODUCT_3 });
    expect(reportOf(after, HUMAN).quality.start).toBe(30);
    expect(reportOf(after, HUMAN).quality.end).toBeCloseTo(37.4075, 3);
  });

  it("caps the one-year projection the same way in a held year", () => {
    const state = opened(HELD).state;
    const plan = { ...plansOf(state)[HUMAN], ...PRODUCT_3 } as Plan;
    expect(projectTurn(viewFor(state, HUMAN), plan, HELD).quality).toBe(30);
  });

  it("does not cap the projection after a cut made once", () => {
    const state = opened(ONCE).state;
    const plan = { ...plansOf(state)[HUMAN], ...PRODUCT_3 } as Plan;
    expect(projectTurn(viewFor(state, HUMAN), plan, ONCE).quality).toBeCloseTo(37.4075, 3);
  });

  it("names the ceiling held in a shift's year, and none the year before or after", () => {
    expect(datedHeldCeiling(turnFor(1995), HELD)).toBe(30);
    expect(datedHeldCeiling(turnFor(1994), HELD)).toBeNull();
    expect(datedHeldCeiling(turnFor(1996), HELD)).toBeNull();
  });

  it("sets a shift in the first year with the game: the cut and the wave", () => {
    const config = withCareer({ dated: [shift(1990, 20)] });
    const state = newCareer(config);
    expect(state.companies[INCUMBENT].quality).toBe(20); // the Incumbent starts at 30
    expect(state.wave).toEqual({ multiplier: 1.3, turnsLeft: 3 });
    const year = play(state, config);
    expect(year.log.market.newUsers).toBe(26_000); // 20,000 × 1.3
    expect(year.state.wave).toEqual({ multiplier: 1.3, turnsLeft: 2 });
  });

  describe("the wave of new users", () => {
    /** The years 1995 to 1998 played from the close of 1994, with the log of each. */
    const years = (config: Config): TurnResult[] => {
      const results: TurnResult[] = [];
      let state = play(atTurn(newCareer(config), turnFor(1994)), config).state;
      for (let year = 1995; year <= 1998; year++) {
        const result = play(state, config);
        results.push(result);
        state = result.state;
      }
      return results;
    };

    it("is set by the shift as its year opens", () => {
      expect(play(atTurn(newCareer(HELD), turnFor(1994)), HELD).state.wave).toEqual({ multiplier: 1.3, turnsLeft: 3 });
    });

    it("multiplies the new users of the shift's year and the two after it, then ends", () => {
      const [y1995, y1996, y1997, y1998] = years(HELD);
      expectNear(y1995.log.market.newUsers, baseNewUsers(6) * 1.3); // 32,210.2 × 1.3 = 41,873
      expectNear(y1996.log.market.newUsers, baseNewUsers(7) * 1.3); // 35,431.2 × 1.3 = 46,061
      expectNear(y1997.log.market.newUsers, baseNewUsers(8) * 1.3); // 38,974.3 × 1.3 = 50,667
      expectNear(y1998.log.market.newUsers, baseNewUsers(9)); // 42,871.8: the wave is over
    });

    it("ticks down with the funding climate, one a year, to rest", () => {
      expect(years(HELD).map((result) => result.state.wave)).toEqual([
        { multiplier: 1.3, turnsLeft: 2 },
        { multiplier: 1.3, turnsLeft: 1 },
        { multiplier: 1, turnsLeft: 0 },
        { multiplier: 1, turnsLeft: 0 },
      ]);
    });

    it("multiplies with a card's one-year change in new users", () => {
      const config = withCareer({ dated: [shift(1995), dated("crunch", 1996, [{ kind: "newUsers", multiplier: 0.8 }])] });
      expectNear(years(config)[1].log.market.newUsers, baseNewUsers(7) * 1.3 * 0.8); // 36,848
    });

    it("is replaced by a new wave while it still runs, not multiplied by it", () => {
      const config = withCareer({ dated: [shift(1995), dated("surge", 1996, [{ kind: "userWave", multiplier: 2, turns: 2 }])] });
      const [, y1996, y1997, y1998] = years(config);
      expectNear(y1996.log.market.newUsers, baseNewUsers(7) * 2);
      expectNear(y1997.log.market.newUsers, baseNewUsers(8) * 2);
      expectNear(y1998.log.market.newUsers, baseNewUsers(9)); // neither 2 nor the old 1.3 is left
    });

    it("multiplies the new era's first-year users when the era opens with the shift", () => {
      const config = withCareer(
        { dated: [shift(1995)] },
        withEras(era("one", 1990), era("web", 1995, { market: { newUsersTurn1: 100_000 } })),
      );
      expect(years(config)[0].log.market.newUsers).toBe(130_000); // 100,000 × 1.3
    });
  });

  describe("the notice of a coming shift", () => {
    it("announces a shift two years ahead and one year ahead", () => {
      expect(upcomingShift(turnFor(1993), HELD)).toEqual({ cardId: "shift-1995", year: 1995, yearsAway: 2, ceiling: 30 });
      expect(upcomingShift(turnFor(1994), HELD)).toEqual({ cardId: "shift-1995", year: 1995, yearsAway: 1, ceiling: 30 });
    });

    it("does not announce it in its own year, or before the notice opens, or after it", () => {
      expect(upcomingShift(turnFor(1995), HELD)).toBeNull();
      expect(upcomingShift(turnFor(1992), HELD)).toBeNull();
      expect(upcomingShift(turnFor(1996), HELD)).toBeNull();
    });

    it("opens the notice shiftNoticeYears years ahead", () => {
      const config = withCareer({ dated: [shift(1995)], shiftNoticeYears: 3 });
      expect(upcomingShift(turnFor(1992), config)).toMatchObject({ year: 1995, yearsAway: 3 });
      expect(upcomingShift(turnFor(1991), config)).toBeNull();
    });

    it("announces nothing for a dated card that is not a shift", () => {
      const config = withCareer({ dated: [dated("crash", 1995, [{ kind: "fundingClimate", multiplier: 0.5, turns: 3 }])] });
      expect(upcomingShift(turnFor(1993), config)).toBeNull();
      expect(upcomingShift(turnFor(1994), config)).toBeNull();
    });
  });

  describe("the shipped shifts", () => {
    it("open 1995, 2007, 2023 and 2033 with a ceiling of 30 held for the year, then a wave of 1.3 for 3 years", () => {
      const shifts = CAREER_DESIGN.career.dated.filter((each) => each.effects.some((effect) => effect.kind === "qualityCeiling"));
      expect(shifts.map((each) => each.year)).toEqual([1995, 2007, 2023, 2033]);
      for (const each of shifts) {
        expect(each.effects.slice(0, 2)).toEqual([
          { kind: "qualityCeiling", ceiling: 30, turns: 1 },
          { kind: "userWave", multiplier: 1.3, turns: 3 },
        ]);
      }
    });

    it("fall in the first year of their era, except 2023, the second year of Winter and AI", () => {
      const eraYears = CAREER_DESIGN.career.eras.map((each) => each.firstYear);
      for (const year of [1995, 2007, 2033]) expect(eraYears).toContain(year);
      // 2023 is the second year of Winter and AI (2022 to 2026): the spec's table puts the shift there.
      expect(eraYears).not.toContain(2023);
    });
  });
});
