import { describe, expect, it } from "vitest";
import { CAREER } from "./config";
import type { CareerGameConfig } from "./config";
import { CAREER_DESIGN } from "./config.design";
import { marketTurn, rulesForTurn, turnOf, yearOf } from "./engine/career";
import { ENTRANT_PITCHES, PITCHES } from "./engine/cast";
import { newUsersForTurn } from "./engine/formulas";
import { EVENT_EFFECT_KINDS } from "./engine/types";
import type { EventEffect } from "./engine/types";
import { changedNumbers } from "./sim/changes";

// These tests check the shape of the career's config, never a tunable value, except where a test says it holds a
// number tuning may not change.

const REAL_NAMES = ["netscape", "google", "youtube", "facebook", "instagram", "whatsapp", "twitter", "amazon", "microsoft",
  "alphabet", "apple", "iphone", "openai", "chatgpt", "nvidia", "wework", "lehman", "nasdaq", "aol", "cern", "mosaic",
  "hotwired", "at&t", "pets.com", "theglobe", "greenspan", "altman", "meta", "berners", "nielsen", "nsfnet", "super bowl", "usenet"];

/** True when the text holds the name as a whole word: not "cern" in "concern", nor "apple" in "pineapple". */
const namesAsWord = (text: string, name: string): boolean =>
  new RegExp(`(?<![a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text.toLowerCase());

/** Every era's numbers, as in force in its first year. */
const eraRules = (config: CareerGameConfig) =>
  config.career.eras.map((era) => ({ era, rules: rulesForTurn(config, turnOf(era.firstYear, config.career)) }));

/** Every card a career can deal: the dated ones, then each era's deck. */
const allCards = (config: CareerGameConfig) => [...config.career.dated, ...config.career.eras.flatMap((era) => era.values.events?.deck ?? [])];

const FUNDING_CEILING_WAVE: readonly EventEffect["kind"][] = ["fundingClimate", "qualityCeiling", "userWave"];

describe("the real-name check", () => {
  it("finds a name as a whole word only", () => {
    expect(namesAsWord("Shares of the Nasdaq fall", "nasdaq")).toBe(true);
    expect(namesAsWord("A deal with AT&T.", "at&t")).toBe(true);
    expect(namesAsWord("Nobody visits pets.com now", "pets.com")).toBe(true);
    expect(namesAsWord("A matter of concern", "cern")).toBe(false);
    expect(namesAsWord("Pineapple on the menu", "apple")).toBe(false);
    expect(namesAsWord("Metal desks", "meta")).toBe(false);
    expect(namesAsWord("petsXcom", "pets.com")).toBe(false);
  });
});

describe.each([["CAREER", CAREER], ["CAREER_DESIGN", CAREER_DESIGN]] as const)("%s", (_name, config) => {
  it("is plain data that survives a JSON round trip", () => {
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  it("runs from 1990 to 2038 in 49 turns", () => {
    expect([config.career.firstYear, config.game.maxTurns, yearOf(config.game.maxTurns, config.career)]).toEqual([1990, 49, 2038]);
  });

  it("has the design's eight eras, in order", () => {
    expect(config.career.eras.map((era) => [era.id, era.firstYear])).toEqual([["dial-up", 1990], ["gold-rush", 1995],
      ["bust", 2000], ["phones", 2007], ["cheap-money", 2014], ["winter-ai", 2022], ["agents", 2027], ["ambient", 2033]]);
    expect(config.career.eras.filter((era) => era.invented).map((era) => era.id)).toEqual(["agents", "ambient"]);
  });

  it("gives every era its own market, salary, bar and starting cash", () => {
    for (const era of config.career.eras) {
      const values = era.values;
      const own = [values.market?.newUsersTurn1, values.market?.growthPerTurn, values.salary, values.ipo?.users, values.archetypes?.startup?.cash];
      for (const value of own) {
        expect(typeof value, era.id).toBe("number");
        expect(value, era.id).toBeGreaterThan(0);
      }
    }
  });

  it("has no cliff between eras: a first year brings 0.8 to 2 times the year before", () => {
    const newUsers = (year: number): number => {
      const turn = turnOf(year, config.career);
      return newUsersForTurn(marketTurn(config, turn), 1, rulesForTurn(config, turn));
    };
    for (const era of config.career.eras.slice(1)) {
      const ratio = newUsers(era.firstYear) / newUsers(era.firstYear - 1);
      expect(ratio, era.id).toBeGreaterThanOrEqual(0.8);
      expect(ratio, era.id).toBeLessThanOrEqual(2);
    }
  });

  it("deals the design's dated cards in their years, with their kinds of effect", () => {
    expect(Object.fromEntries(config.career.dated.map((card) => [card.year, card.effects.map((effect) => effect.kind)]))).toEqual({
      1990: ["fundingClimate", "newUsers"], 1991: ["newUsers"], 1993: ["newUsers"], 1994: ["marketingEffect"],
      1995: ["qualityCeiling", "userWave", "fundingClimate"], 1998: ["fundingClimate", "newUsers", "candidates"],
      2000: ["fundingClimate", "newUsers", "candidates"], 2004: ["newUsers"], 2006: ["fundingClimate", "newUsers"],
      2007: ["qualityCeiling", "userWave"], 2008: ["fundingClimate", "newUsers", "candidates"],
      2011: ["targetUsers", "targetHype"],
      2012: ["fundingClimate", "candidates"], 2014: ["fundingClimate", "candidates"], 2018: ["marketingEffect"],
      2019: ["fundingClimate", "marketingEffect"], 2020: ["newUsers", "candidates"],
      2022: ["fundingClimate", "newUsers", "candidates"], 2023: ["qualityCeiling", "userWave", "candidates"],
      2025: ["fundingClimate", "candidates"], 2028: ["newUsers"], 2029: ["marketingEffect"],
      2030: ["fundingClimate", "newUsers"], 2031: ["candidates"], 2033: ["qualityCeiling", "userWave"],
      2035: ["targetUsers", "targetHype"], 2036: ["newUsers"], 2037: ["fundingClimate", "newUsers"],
    });
    // One card a year, listed in order of year.
    const years = config.career.dated.map((card) => card.year);
    expect(years).toEqual([...new Set(years)].sort((a, b) => a - b));
  });

  it("has no dated card in the last year, and none in the first that hits one company", () => {
    const lastYear = yearOf(config.game.maxTurns, config.career);
    expect(config.career.dated.filter((card) => card.year === lastYear)).toEqual([]);
    const first = config.career.dated.filter((card) => card.year === config.career.firstYear);
    for (const card of first) {
      expect(card.target, card.id).toBeUndefined();
      expect(card.effects.some((effect) => effect.kind.startsWith("target")), card.id).toBe(false);
    }
  });

  it("caps quality at a platform shift no lower than that year's launch bar, for its year or for none", () => {
    const ceilings = config.career.dated.flatMap((card) =>
      card.effects.flatMap((effect) => (effect.kind === "qualityCeiling" ? [{ card, effect }] : [])),
    );
    expect(ceilings.length).toBeGreaterThan(0);
    for (const { card, effect } of ceilings) {
      const rules = rulesForTurn(config, turnOf(card.year, config.career));
      expect(effect.ceiling, card.id).toBeGreaterThanOrEqual(rules.quality.launchAt);
      expect(effect.ceiling, card.id).toBeLessThanOrEqual(100);
      expect([0, 1], card.id).toContain(effect.turns);
    }
  });

  it("gives every era its own deck of at least four cards, none of which touches funding, ceilings or waves", () => {
    for (const era of config.career.eras) {
      const deck = era.values.events?.deck ?? [];
      expect(deck.length, era.id).toBeGreaterThanOrEqual(4);
      for (const card of deck) {
        for (const effect of card.effects) expect(FUNDING_CEILING_WAVE, card.id).not.toContain(effect.kind);
      }
    }
    // Two eras do not share a deck: each is worded for its own years.
    const decks = config.career.eras.map((era) => era.values.events?.deck);
    expect(new Set(decks).size).toBe(decks.length);
  });

  it("gives every card, dated or in any era's deck, its own id, a name and a line of text", () => {
    const cards = allCards(config);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    for (const card of cards) {
      expect(card.id.length, card.id).toBeGreaterThan(0);
      expect(card.name.length, card.id).toBeGreaterThan(0);
      expect(card.text.length, card.id).toBeGreaterThan(0);
      expect(card.text, card.id).not.toMatch(/\n/);
      expect(card.effects.length, card.id).toBeGreaterThan(0);
    }
    for (const era of config.career.eras) {
      for (const card of era.values.events?.deck ?? []) expect(card.weight, card.id).toBeGreaterThan(0);
    }
  });

  it("uses only effects the engine knows, with a target rule exactly where an effect needs one", () => {
    for (const card of allCards(config)) {
      for (const effect of card.effects) expect(EVENT_EFFECT_KINDS, card.id).toContain(effect.kind);
      const hitsOne = card.effects.some((effect) => effect.kind.startsWith("target"));
      expect(card.target !== undefined, card.id).toBe(hitsOne);
      for (const effect of card.effects) {
        if (effect.kind === "targetHeadcount" && effect.delta < 0) {
          expect(card.target?.minHeadcount ?? 0, card.id).toBeGreaterThanOrEqual(1 - effect.delta);
        }
        if (effect.kind === "targetUsers") {
          expect(effect.fraction, card.id).toBeGreaterThan(0);
          expect(effect.fraction, card.id).toBeLessThanOrEqual(1);
        }
        if (effect.kind === "fundingClimate" || effect.kind === "userWave") {
          expect(effect.multiplier, card.id).toBeGreaterThan(0);
          expect(effect.turns, card.id).toBeGreaterThanOrEqual(1);
        }
        if (effect.kind === "newUsers" || effect.kind === "marketingEffect") {
          expect(effect.multiplier, card.id).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("keeps every probability and share between 0 and 1, in every era", () => {
    for (const { era, rules } of eraRules(config)) {
      const { blitzscaler, bootstrapper, incumbent } = rules.cpu.personalities;
      const shares = [
        rules.churn.base,
        rules.churn.min,
        rules.board.fireChance,
        rules.poach.baseChance,
        rules.poach.minChance,
        rules.poach.maxChance,
        rules.hype.decay,
        rules.hype.growthThreshold,
        rules.events.chance,
        rules.projection.cautiousShortfall,
        rules.cpu.minShareForGrowth,
        rules.cpu.teamGrowthShare,
        ...rules.cpu.lastTurnMarketingShares,
        ...rules.cpu.troubleLayoffs.shares,
        ...(rules.cpu.recruiters.shares ?? []),
        ...[blitzscaler, bootstrapper, incumbent].flatMap((personality) => [...personality.marketingShares, ...personality.productShares]),
        rules.baseline.split.product,
        rules.baseline.split.growth,
        rules.baseline.split.recruiting,
      ];
      for (const share of shares) {
        expect(share, era.id).toBeGreaterThanOrEqual(0);
        expect(share, era.id).toBeLessThanOrEqual(1);
      }
      expect(rules.poach.minChance, era.id).toBeLessThanOrEqual(rules.poach.maxChance);
      expect(rules.churn.min, era.id).toBeLessThanOrEqual(rules.churn.base);
    }
  });

  it("has offices of growing size, and starts every company in one that holds it", () => {
    const capacities = config.career.offices.map((office) => office.capacity);
    for (const [i, capacity] of capacities.entries()) if (i > 0) expect(capacity).toBeGreaterThan(capacities[i - 1]);
    for (const { era, rules } of eraRules(config)) {
      for (const archetype of ["startup", "incumbent"] as const) {
        const start = rules.archetypes[archetype];
        expect(start.headcount, `${era.id} ${archetype}`).toBeLessThanOrEqual(capacities[capacities.length - 1]);
        expect(start.allocation.product + start.allocation.growth + start.allocation.recruiting, `${era.id} ${archetype}`).toBe(start.headcount);
      }
    }
  });

  it("keeps a listing from shrinking the founder's stake", () => {
    expect(config.career.listing.premium * (1 - config.career.listing.percent / 100)).toBeGreaterThanOrEqual(1);
  });

  it("uses a marketing step that divides every era's largest budget", () => {
    for (const { era, rules } of eraRules(config)) {
      expect(rules.pull.marketingStep, era.id).toBeGreaterThan(0);
      expect(rules.pull.maxMarketing % rules.pull.marketingStep, era.id).toBe(0);
    }
  });

  it("names no real company, product or person in anything a player reads", () => {
    const texts = [
      ...allCards(config).flatMap((card) => [card.name, card.text]),
      ...config.career.eras.map((era) => era.name),
      ...config.career.offices.map((office) => office.name),
      ...Object.values(PITCHES).flat(),
      ...Object.values(ENTRANT_PITCHES).flat(),
    ];
    const found = texts.flatMap((text) => REAL_NAMES.filter((name) => namesAsWord(text, name)).map((name) => `${name}: ${text}`));
    expect(found).toEqual([]);
  });
});

describe("the career's starting numbers", () => {
  it("are the ones the spec names", () => {
    expect(CAREER_DESIGN.career.listing).toEqual({ percent: 20, premium: 1.25, hype: 20, investorSeats: 1 });
    expect(CAREER_DESIGN.career.rescue).toEqual({ equityKept: 0.5, investorSeats: 2, hype: -10, salaryYears: 1 });
    expect(CAREER_DESIGN.career.replacement).toEqual({ afterYears: 2, styles: ["blitzscaler", "bootstrapper", "incumbent"] });
    expect(CAREER_DESIGN.career.offices.map((office) => office.capacity)).toEqual([4, 9, 22, 40, 150]);
    expect(CAREER_DESIGN.career.moving).toEqual({ salaryYears: 0.5 });
    expect(CAREER_DESIGN.career.shiftNoticeYears).toBe(2);
  });

  it("deal the dated cards with exactly the effects the design lists", () => {
    const climate = (multiplier: number, turns: number) => ({ kind: "fundingClimate", multiplier, turns });
    const users = (multiplier: number) => ({ kind: "newUsers", multiplier });
    const adverts = (multiplier: number) => ({ kind: "marketingEffect", multiplier });
    const candidates = (extra: number) => ({ kind: "candidates", extra });
    const shift = [{ kind: "qualityCeiling", ceiling: 30, turns: 1 }, { kind: "userWave", multiplier: 1.3, turns: 3 }];
    const weak = (fraction: number, hype: number) => [{ kind: "targetUsers", fraction }, { kind: "targetHype", delta: -hype }];
    expect(Object.fromEntries(CAREER_DESIGN.career.dated.map((card) => [card.year, card.effects]))).toEqual({
      1990: [climate(0.7, 2), users(0.8)], 1991: [users(1.25)], 1993: [users(1.5)], 1994: [adverts(1.5)],
      1995: [...shift, climate(1.5, 3)], 1998: [climate(1.6, 2), users(1.25), candidates(-2)],
      2000: [climate(0.5, 3), users(0.7), candidates(4)], 2004: [users(1.5)], 2006: [climate(1.4, 2), users(1.25)],
      2007: shift, 2008: [climate(0.5, 2), users(0.8), candidates(4)], 2011: weak(0.1, 10),
      2012: [climate(1.4, 2), candidates(-2)], 2014: [climate(1.5, 3), candidates(-2)], 2018: [adverts(0.7)],
      2019: [climate(0.7, 1), adverts(1.25)], 2020: [users(1.5), candidates(4)],
      2022: [climate(0.6, 2), users(0.8), candidates(4)], 2023: [...shift, candidates(4)],
      2025: [climate(1.4, 2), candidates(-2)], 2028: [users(0.7)], 2029: [adverts(0.5)],
      2030: [climate(1.6, 2), users(1.25)], 2031: [candidates(5)], 2033: shift, 2035: weak(0.2, 15),
      2036: [users(0.7)], 2037: [climate(1.5, 2), users(1.25)],
    });
    expect(CAREER_DESIGN.career.dated.filter((card) => card.target !== undefined).map((card) => [card.year, card.target])).toEqual([
      [2011, { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 }],
      [2035, { pick: "random", launched: true, qualityBelow: 60, minUsers: 1 }],
    ]);
    expect(CAREER_DESIGN.career.dated.map((card) => card.name)).toEqual(["Recession", "A web of pages", "Free for all",
      "First banner adverts", "The browser", "Seven-fold debut", "The worst week", "Broadband majority", "Video site sale",
      "The touchscreen phone", "Bank collapse", "Cloud outage", "Thirteen people, one billion", "Nineteen billion",
      "Privacy law", "The pulled offering", "Everyone goes home", "Rates rise", "The chatbot", "Four trillion",
      "Compute crunch", "Sign-off law", "The one-person billion", "Back-office layoffs", "Glasses outsell phones",
      "Home-helper recall", "Power rationing", "Citizen funds"]);
  });

  it("make the last two eras play as the design describes them", () => {
    const rulesOf = (id: string) =>
      rulesForTurn(CAREER_DESIGN, turnOf(CAREER_DESIGN.career.eras.find((era) => era.id === id)!.firstYear, CAREER_DESIGN.career));
    expect(rulesOf("agents").quality.gainPerWork).toBeGreaterThan(rulesOf("winter-ai").quality.gainPerWork); // small teams that build fast
    expect(rulesOf("ambient").pull.marketingCoefficient).toBeLessThan(rulesOf("agents").pull.marketingCoefficient); // trust is worth more than reach
  });

  /**
   * Numbers that only one of two configs has. Whole cards are left out, dated or in an era's deck, and so is
   * anything inside an era's `values`: tuning may give an era a number it did not set, or take one away.
   */
  const oneSided = (start: unknown, now: unknown): string[] =>
    changedNumbers(start, now)
      .filter((change) => change.start === undefined || change.now === undefined)
      .map((change) => change.path)
      .filter((path) => !/^career\.dated\.[^.]+$/.test(path) && !/^career\.eras\.[^.]+\.values\./.test(path));

  it("cover exactly the same numbers as the career's config: none missing on either side", () => {
    expect(oneSided(CAREER_DESIGN, CAREER)).toEqual([]);
    // The check still sees a number that only one side has, outside an era's values or inside a dated card.
    expect(oneSided(CAREER_DESIGN, { ...CAREER, signingBonus: 5_000 })).toEqual(["signingBonus"]);
    expect(oneSided(CAREER_DESIGN, { ...CAREER, career: { ...CAREER.career, moving: {} } })).toEqual(["career.moving.salaryYears"]);
    const [first, ...rest] = CAREER.career.dated;
    const bare = Object.fromEntries(Object.entries(first).filter(([key]) => key !== "year"));
    expect(oneSided(CAREER_DESIGN, { ...CAREER, career: { ...CAREER.career, dated: [bare, ...rest] } })).toEqual([`career.dated.${first.id}.year`]);
    // And lets an era gain a number of its own.
    const [dialUp, ...later] = CAREER.career.eras;
    const tuned = { ...dialUp, values: { ...dialUp.values, layoff: { severance: 1 } } };
    expect(oneSided(CAREER_DESIGN, { ...CAREER, career: { ...CAREER.career, eras: [tuned, ...later] } })).toEqual([]);
  });
});

describe("what tuning may not change in a career", () => {
  it("the five targets the owner approved, and the year the lead is taken", () => {
    expect(CAREER.sim.targets).toEqual({ maxCpuWinShare: 0.4, baselineWinShare: [0.15, 0.35], baselineOutShare: [0.1, 0.3],
      baselineListedShare: [0.4, 0.8], leaderHoldsBelow: 0.6 });
    expect(CAREER.sim.leaderYear).toBe(2010);
  });

  it("the habits that make each rival readable, in every era", () => {
    const heaviest = (shares: readonly number[]): number => Math.max(...shares);
    for (const { era, rules } of eraRules(CAREER)) {
      const { blitzscaler, bootstrapper, incumbent } = rules.cpu.personalities;
      expect(blitzscaler.price, era.id).toBe("budget");
      expect(blitzscaler.raise.when, era.id).toBe("eligible");
      expect(blitzscaler.raise.percents, era.id).toEqual([30]);
      expect(heaviest(blitzscaler.marketingShares), era.id).toBeGreaterThan(heaviest(bootstrapper.marketingShares));
      expect(heaviest(blitzscaler.marketingShares), era.id).toBeGreaterThan(heaviest(incumbent.marketingShares));
      expect(bootstrapper.price, era.id).toBe("premium");
      expect(bootstrapper.raise.when, era.id).toBe("runway");
      expect(bootstrapper.teamCap, era.id).toBeLessThan(blitzscaler.teamCap);
      expect(bootstrapper.teamCap, era.id).toBeLessThan(incumbent.teamCap);
      expect(typeof incumbent.poachRunway, era.id).toBe("number");
      expect(rules.baseline, era.id).toMatchObject({
        split: { product: 0.4, growth: 0.4, recruiting: 0.2 },
        price: "standard",
        raisePercent: 20,
        raiseRunway: 3,
        hireRunway: 3,
      });
    }
  });

  it("the rules' own numbers stay within what the rules mean", () => {
    const { rescue, listing, replacement, shiftNoticeYears } = CAREER.career;
    expect(rescue.equityKept).toBeGreaterThan(0);
    expect(rescue.equityKept).toBeLessThan(1);
    expect(rescue.investorSeats).toBeGreaterThanOrEqual(1);
    expect(listing.percent).toBeGreaterThan(0);
    expect(listing.percent).toBeLessThan(100);
    expect(listing.investorSeats).toBeGreaterThanOrEqual(1);
    expect(replacement.afterYears).toBeGreaterThanOrEqual(1);
    expect(shiftNoticeYears).toBeGreaterThanOrEqual(1);
  });
});
