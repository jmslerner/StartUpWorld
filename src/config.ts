// Every number in the game lives in this file. The rules that use them are in src/engine and are
// described in docs/turn-based-design.md: keep the rules, tune the numbers. Each change from the
// design's starting value is recorded in that document's Tuning log.
//
// Nothing here is code. To add an event, add a card to `events.deck` using the effects listed in
// EventEffect (src/engine/types.ts).

import type { BaselineConfig, CareerSimConfig, CpuConfig, SimConfig } from "./ai/types";
import type { CareerRules, EraConfig, Overlay, RulesConfig } from "./engine/types";

const K = 1_000;
const M = 1_000_000;

/** The rules' numbers, plus the numbers behind the computer players: all it takes to play a game. */
export interface PlayConfig extends RulesConfig {
  readonly cpu: CpuConfig;
  readonly baseline: BaselineConfig;
}

/** An era whose values for the computer players are type-checked too. */
export type PlayEra = Omit<EraConfig, "values"> & { readonly values: Overlay<Omit<PlayConfig, "game" | "career">> };

/** A config that can be played, plus the numbers behind the simulator. */
export interface GameConfig extends PlayConfig {
  readonly sim: SimConfig;
}

/** The career's config: every number of a game played from 1990 to 2038, and the numbers behind its simulator. */
export interface CareerGameConfig extends PlayConfig {
  readonly career: CareerRules;
  readonly sim: CareerSimConfig;
}

export const CONFIG: GameConfig = {
  // ── Game length and the win ──
  game: { maxTurns: 20 },
  /** A company with this many users and a profitable quarter goes public and wins. */
  ipo: { users: 330 * K },

  // ── Starting state ──
  archetypes: {
    // Player, Blitzscaler, Bootstrapper.
    startup: {
      cash: 900 * K,
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
      cash: 3 * M,
      headcount: 8,
      users: 10 * K,
      quality: 30,
      hype: 20,
      founderEquity: 0.6,
      founderSeats: 2,
      investorSeats: 1,
      workExponent: 0.625,
      /** +50% product output while it trails the quality leader. */
      catchUpMultiplier: 1.5,
      allocation: { product: 5, growth: 2, recruiting: 1 },
    },
  },

  // ── Talent ──
  /** Per person per quarter. */
  salary: 30 * K,
  hiring: {
    candidatesPerTurn: 6,
    /** Hiring capacity = this × Recruiting effective work, rounded. */
    capacityPerWork: 2,
    fee: 10 * K,
  },
  poach: {
    cost: 75 * K,
    baseChance: 0.5,
    /** (your hype − their hype) ÷ 2 points = 0.005 per hype point. */
    chancePerHypePoint: 0.005,
    minChance: 0.1,
    maxChance: 0.9,
    /** A target needs at least this many people. Not in the design; see the rulings. */
    minTargetHeadcount: 4,
  },
  layoff: { severance: 20 * K, hype: -10 },

  // ── Product ──
  quality: {
    /** Gain per turn = this × Product effective work × (1 − quality/100). */
    gainPerWork: 4.5,
    decay: 2,
    launchAt: 10,
  },

  // ── Market ──
  market: { newUsersTurn1: 16 * K, growthPerTurn: 0.09 },
  /** Pull = quality × (1 + growthCoefficient × Growth work + marketingCoefficient × √(marketing ÷ step)) × price factor × (1 + hype/100). */
  pull: {
    growthCoefficient: 0.3,
    marketingCoefficient: 0.3,
    marketingStep: 25 * K,
    /** Largest spend a plan may carry. Not in the design; a sanity limit only. */
    maxMarketing: 5 * M,
  },
  priceTiers: {
    budget: { price: 2, pullFactor: 1.05, churnDelta: -0.02 },
    standard: { price: 3, pullFactor: 1, churnDelta: 0 },
    premium: { price: 5, pullFactor: 0.75, churnDelta: 0.01 },
  },
  /** Churn per turn = base − perQualityPoint × quality + the tier's churnDelta, never below min. */
  churn: { base: 0.12, perQualityPoint: 0.0008, min: 0.02 },

  // ── Money ──
  raise: { minUsers: 1 * K, cooldownTurns: 2, options: [10, 20, 30] },
  /** Valuation = users × perUser × (1 + hype/100) × funding-climate multiplier. */
  valuation: { perUser: 80 },
  board: { fireChance: 0.3, runwayTurns: 2 },

  // ── Hype ──
  hype: { decay: 0.2, launch: 15, raise: 10, growth: 5, growthThreshold: 0.25 },

  // ── Projection (planning panel and CPU planner) ──
  // Not rules: assumptions the one-quarter projection uses about rivals it cannot see into.
  projection: { rivalPullGuess: 1.6, rivalHireGuess: 1, cautiousShortfall: 0.25 },

  // ── Events ──
  events: {
    firstTurn: 3,
    chance: 0.5,
    deck: [
      {
        id: "funding-winter",
        name: "Funding winter",
        text: "Investors pull back: valuations ×0.6 for 3 turns.",
        weight: 1,
        effects: [{ kind: "fundingClimate", multiplier: 0.6, turns: 3 }],
      },
      {
        id: "hot-market",
        name: "Hot market",
        text: "Money is cheap: valuations ×1.4 for 2 turns.",
        weight: 1,
        effects: [{ kind: "fundingClimate", multiplier: 1.4, turns: 2 }],
      },
      {
        id: "viral-moment",
        name: "Viral moment",
        text: "One company is everywhere this quarter: +20 hype.",
        weight: 1,
        target: { pick: "random" },
        effects: [{ kind: "targetHype", delta: 20 }],
      },
      {
        id: "burnout",
        name: "Burnout",
        text: "One company loses a person to burnout.",
        weight: 1,
        target: { pick: "random", minHeadcount: 4 },
        effects: [{ kind: "targetHeadcount", delta: -1 }],
      },
      {
        id: "press-feature",
        name: "Press feature",
        text: "The best product gets a glowing write-up: +15 hype.",
        weight: 1,
        target: { pick: "highestQuality", launched: true },
        effects: [{ kind: "targetHype", delta: 15 }],
      },
      {
        id: "security-breach",
        name: "Security breach",
        text: "A shaky product leaks data: it loses 10% of its users and 10 hype.",
        weight: 1,
        target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
        effects: [
          { kind: "targetUsers", fraction: 0.1 },
          { kind: "targetHype", delta: -10 },
        ],
      },
      {
        id: "talent-glut",
        name: "Talent glut",
        text: "Layoffs elsewhere: 4 extra candidates this turn.",
        weight: 1,
        effects: [{ kind: "candidates", extra: 4 }],
      },
      {
        id: "market-boom",
        name: "Market boom",
        text: "Demand surges: new users ×1.5 this turn.",
        weight: 1,
        effects: [{ kind: "newUsers", multiplier: 1.5 }],
      },
      {
        id: "ad-prices-spike",
        name: "Ad prices spike",
        text: "Marketing is half as effective this turn.",
        weight: 1,
        effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
      },
    ],
  },
  // ── Computer players ──
  // Each CPU builds a few dozen plans, projects them one quarter ahead and scores them with these
  // weights. The fixed habits (price, when it raises, whether it poaches) are what a player can read.
  cpu: {
    noise: 0.03,
    layoffRunway: 1,
    minShareForGrowth: 0.1,
    shortRunwayPenalty: 2,
    shortRunwayTurns: 1,
    lastTurnMarketingShares: [0, 0.2, 0.4, 0.6, 0.8, 0.95],
    /** Layoffs a CPU weighs when it has the users to go public and needs a profitable quarter. */
    ipoPushLayoffs: [0, 1, 2, 3, 5, 8, 12, 16, 20, 25, 30],
    /** Layoffs it weighs when short of cash: these head counts, then these shares of the team (1 = everyone but one). */
    troubleLayoffs: { counts: [0, 1, 2], shares: [0.3333, 0.5, 0.6667, 1] },
    /** Recruiters it weighs: `few`, or `many` once `manyFrom` people are free to assign. */
    recruiters: { few: [0, 1], many: [0, 1, 2], manyFrom: 8 },
    /** A bigger team is worth this share of what the same gain in product quality is worth. */
    teamGrowthShare: 0.5,
    /** Score of a plan that ends below $0 (less a point per $1M short): under any plan that survives. */
    bankruptScore: -1000,
    ipo: { win: 100, deficit: 20, nextDeficit: 10, usersShortfall: 20 },
    personalities: {
      // Chases users: Budget price, raises 30% the moment it can, heavy marketing.
      blitzscaler: {
        price: "budget",
        raise: { when: "eligible", runway: 0, percents: [30] },
        poachRunway: null,
        teamCap: 11,
        hireRunway: 1.5,
        marketingShares: [0, 0.05, 0.1, 0.175, 0.25],
        productShares: [0.7, 0.5, 0.3, 0.15],
        horizon: 4,
        boardRiskPenalty: 0,
        weights: { users: 3.25, quality: 1, team: 1, runway: 0, runwayHalf: 1, hype: 0.3, equity: 0 },
      },
      // Protects runway and equity: Premium price, raises only under 2 turns of runway, small team, product first.
      bootstrapper: {
        price: "premium",
        raise: { when: "runway", runway: 2, percents: [10, 20, 30] },
        poachRunway: null,
        teamCap: 7,
        hireRunway: 5,
        marketingShares: [0, 0.081, 0.162],
        productShares: [1, 0.8, 0.6],
        horizon: 6,
        boardRiskPenalty: 3,
        weights: { users: 1, quality: 2, team: 0.6, runway: 2.25, runwayHalf: 3, hype: 0.1, equity: 2 },
      },
      // Product-heavy, and poaches whenever it can afford to.
      incumbent: {
        price: "standard",
        raise: { when: "runway", runway: 3, percents: [10, 20, 30] },
        poachRunway: 3,
        teamCap: 14,
        hireRunway: 4,
        marketingShares: [0, 0.075, 0.15],
        productShares: [0.85, 0.7, 0.55],
        horizon: 5,
        boardRiskPenalty: 2,
        weights: { users: 2.5, quality: 3, team: 0.8, runway: 1, runwayHalf: 2, hype: 0.3, equity: 0.5 },
      },
    },
  },

  // ── Simulator ──
  // The baseline bot sits in the player's seat in `npm run sim`: a new player's simple policy.
  baseline: {
    split: { product: 0.4, growth: 0.4, recruiting: 0.2 },
    price: "standard",
    raisePercent: 20,
    raiseRunway: 3,
    hireRunway: 3,
    marketing: 0,
  },
  sim: {
    games: 1_000,
    firstSeed: 1,
    targets: {
      maxCpuWinShare: 0.4,
      baselineWinShare: [0.15, 0.35],
      medianTurns: [14, 20],
      ipoShare: [0.4, 0.8],
    },
  },
};

// ── The career ──
// The second game: one company from 1990 to 2038, a turn a year. Its rules are in docs/career-rules.md; the numbers
// below are the tuned ones. Their starting values, and where each group came from, are under "Starting numbers"
// there (and in CAREER_DESIGN, src/config.design.ts); what tuning changed, under "Tuning log". Each era's `values` are
// laid over the numbers above them for the era's years; whatever an era leaves out keeps the value above. Nothing
// here is read from the race's CONFIG: tuning one game never moves the other.

export const CAREER: CareerGameConfig = {
  // ── Game length ──
  /** 1990 to 2038, one turn a year. */
  game: { maxTurns: 49 },
  /** The users a company needs before it may go public: the first era's bar. */
  ipo: { users: 60 * K },

  // ── Starting state ──
  archetypes: {
    // Player, Blitzscaler, Bootstrapper, and every newcomer.
    startup: {
      cash: 400 * K,
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
      cash: 1.5 * M,
      headcount: 8,
      users: 10 * K,
      quality: 30,
      hype: 20,
      founderEquity: 0.9,
      founderSeats: 2,
      investorSeats: 1,
      workExponent: 0.78,
      catchUpMultiplier: 1.5,
      allocation: { product: 5, growth: 2, recruiting: 1 },
    },
  },

  // ── Talent ──
  /** Per person per year: the first era's. */
  salary: 50 * K,
  hiring: { candidatesPerTurn: 2, capacityPerWork: 3, fee: 20 * K },
  poach: { cost: 150 * K, baseChance: 0.5, chancePerHypePoint: 0.005, minChance: 0.1, maxChance: 0.9, minTargetHeadcount: 4 },
  layoff: { severance: 40 * K, hype: -10 },

  // ── Product ──
  quality: { gainPerWork: 9, decay: 6, launchAt: 10 },

  // ── Market ──
  /** The first era's curve. Each era starts its own curve in its first year. */
  market: { newUsersTurn1: 20 * K, growthPerTurn: 0.35 },
  pull: { growthCoefficient: 0.3, marketingCoefficient: 0.3, marketingStep: 50 * K, maxMarketing: 1 * M },
  /** The first era's prices. Each era sets its own: a user brings less as the market grows. */
  priceTiers: {
    budget: { price: 5.44, pullFactor: 1.05, churnDelta: -0.05 },
    standard: { price: 8.16, pullFactor: 1, churnDelta: 0 },
    premium: { price: 13.6, pullFactor: 0.75, churnDelta: 0.03 },
  },
  churn: { base: 0.3, perQualityPoint: 0.002, min: 0.05 },

  // ── Money ──
  raise: { minUsers: 1 * K, cooldownTurns: 2, options: [10, 20, 30] },
  valuation: { perUser: 27 },
  board: { fireChance: 0.3, runwayTurns: 2 },

  // ── Hype ──
  hype: { decay: 0.4, launch: 15, raise: 10, growth: 5, growthThreshold: 0.25 },

  // ── Projection ──
  projection: { rivalPullGuess: 1.6, rivalHireGuess: 1, cautiousShortfall: 0.25 },

  // ── Events ──
  // No deck here: each era deals its own, and the dated cards own the funding climate, the ceilings and the waves.
  events: { firstTurn: 2, chance: 0.5, deck: [] },

  // ── Computer players ──
  cpu: {
    noise: 0.03,
    layoffRunway: 1,
    minShareForGrowth: 0.1,
    shortRunwayPenalty: 2,
    shortRunwayTurns: 1,
    lastTurnMarketingShares: [0, 0.2, 0.4, 0.6, 0.8, 0.95],
    /** At most two people laid off to make a listing year profitable: the prize for listing is small. */
    ipoPushLayoffs: [0, 1, 2],
    troubleLayoffs: { counts: [0, 1, 2], shares: [0.3333, 0.5, 0.6667, 1] },
    /** Also a fifth and three tenths of the people free to assign, so a rival can grow its team in a year. */
    recruiters: { few: [0, 1], many: [0, 1, 2], manyFrom: 8, shares: [0.2, 0.3] },
    teamGrowthShare: 1,
    bankruptScore: -1000,
    ipo: { win: 2, deficit: 2, nextDeficit: 1, usersShortfall: 2 },
    personalities: {
      // Team caps are the first era's; each era sets its own.
      blitzscaler: {
        price: "budget",
        raise: { when: "eligible", runway: 0, percents: [30] },
        poachRunway: null,
        teamCap: 12,
        hireRunway: 1,
        marketingShares: [0, 0.05, 0.1, 0.175, 0.25],
        productShares: [0.7, 0.5, 0.3, 0.15],
        horizon: 3,
        boardRiskPenalty: 0,
        weights: { users: 3.25, quality: 1, team: 1, runway: 0, runwayHalf: 1, hype: 0.3, equity: 0 },
      },
      bootstrapper: {
        price: "premium",
        raise: { when: "runway", runway: 1, percents: [10, 20, 30] },
        poachRunway: null,
        teamCap: 11,
        hireRunway: 2,
        marketingShares: [0, 0.081, 0.162],
        productShares: [1, 0.8, 0.6],
        horizon: 4,
        boardRiskPenalty: 3,
        weights: { users: 1, quality: 2, team: 0.6, runway: 2.25, runwayHalf: 3, hype: 0.1, equity: 2 },
      },
      incumbent: {
        price: "standard",
        raise: { when: "runway", runway: 1.5, percents: [10, 20, 30] },
        poachRunway: 1.5,
        teamCap: 18,
        hireRunway: 1.5,
        marketingShares: [0, 0.075, 0.15],
        productShares: [0.85, 0.7, 0.55],
        horizon: 3,
        boardRiskPenalty: 2,
        weights: { users: 2.5, quality: 3, team: 0.8, runway: 1, runwayHalf: 2, hype: 0.3, equity: 0.5 },
      },
    },
  },

  // ── Simulator ──
  baseline: {
    split: { product: 0.4, growth: 0.4, recruiting: 0.2 },
    price: "standard",
    raisePercent: 20,
    raiseRunway: 3,
    hireRunway: 3,
    marketing: 0,
  },
  sim: {
    careers: 1_000,
    firstSeed: 1,
    leaderYear: 2010,
    checkpointYears: [1995, 2000, 2010, 2020, 2030, 2038],
    overspendYear: 1993,
    loopholeMargin: 0.03,
    targets: {
      maxCpuWinShare: 0.4,
      baselineWinShare: [0.15, 0.35],
      baselineOutShare: [0.1, 0.3],
      baselineListedShare: [0.4, 0.8],
      leaderHoldsBelow: 0.6,
    },
  },

  // ── The career ──
  career: {
    firstYear: 1990,
    eras: [
      {
        id: "dial-up",
        name: "Dial-up dawn",
        firstYear: 1990,
        invented: false,
        values: {
          market: { newUsersTurn1: 20 * K, growthPerTurn: 0.35 },
          salary: 50 * K,
          valuation: { perUser: 27 },
          priceTiers: { budget: { price: 5.44 }, standard: { price: 8.16 }, premium: { price: 13.6 } },
          hiring: { candidatesPerTurn: 2 },
          ipo: { users: 60 * K },
          archetypes: { startup: { cash: 400 * K } },
          // Magazine adverts, trade shows and disks in the post buy little.
          pull: { maxMarketing: 1 * M, marketingCoefficient: 0.2 },
          cpu: { personalities: { blitzscaler: { teamCap: 12 }, bootstrapper: { teamCap: 11 }, incumbent: { teamCap: 18 } } },
          events: {
            deck: [
              {
                id: "dial-up-shareware-hit",
                name: "Shareware hit",
                text: "One company's free trial disk is copied from hand to hand: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "dial-up-all-nighters",
                name: "All-nighters",
                text: "A year of all-nighters costs one company a person.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "dial-up-magazine-review",
                name: "Magazine review",
                text: "A computer magazine names the best product its pick of the year: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "dial-up-disk-virus",
                name: "Disk virus",
                text: "A virus spreads on one shaky product's disks: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "dial-up-graduates",
                name: "Graduates",
                text: "A class of programmers leaves college looking for work: 4 extra candidates this year.",
                weight: 1,
                effects: [{ kind: "candidates", extra: 4 }],
              },
              {
                id: "dial-up-cheap-modems",
                name: "Cheap modems",
                text: "Modem prices fall and more homes dial in: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "gold-rush",
        name: "Browser gold rush",
        firstYear: 1995,
        invented: false,
        values: {
          market: { newUsersTurn1: 100 * K, growthPerTurn: 0.4 },
          salary: 70 * K,
          valuation: { perUser: 90 },
          priceTiers: { budget: { price: 3.6 }, standard: { price: 5.4 }, premium: { price: 9 } },
          hiring: { candidatesPerTurn: 4 },
          ipo: { users: 300 * K },
          archetypes: { startup: { cash: 600 * K } },
          pull: { maxMarketing: 5 * M },
          cpu: { personalities: { blitzscaler: { teamCap: 22 }, bootstrapper: { teamCap: 18 }, incumbent: { teamCap: 30 } } },
          // Hiring is a fight: staff leave for share options.
          poach: { baseChance: 0.6 },
          events: {
            deck: [
              {
                id: "gold-rush-forwarded",
                name: "Forwarded to everyone",
                text: "One company's site is the link everyone emails this year: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "gold-rush-options-or-sleep",
                name: "Options or sleep",
                text: "One company loses a person who swaps share options for a night's sleep.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "gold-rush-cover-story",
                name: "Cover story",
                text: "A business weekly puts the best product on its cover: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "gold-rush-defaced",
                name: "Defaced home page",
                text: "Vandals break into a shaky product's site: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "gold-rush-everyone-online",
                name: "Everyone goes online",
                text: "Free trial disks arrive in every letterbox: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
              {
                id: "gold-rush-portal-deals",
                name: "Portal deals",
                text: "The big portals double their prices for a place on the front page: marketing is half as effective this year.",
                weight: 1,
                effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "bust",
        name: "Bust and broadband",
        firstYear: 2000,
        invented: false,
        values: {
          market: { newUsersTurn1: 380 * K, growthPerTurn: 0.05 },
          salary: 85 * K,
          valuation: { perUser: 18 },
          priceTiers: { budget: { price: 2.8 }, standard: { price: 4.2 }, premium: { price: 7 } },
          // The cheapest hiring of the career.
          hiring: { candidatesPerTurn: 5, fee: 10 * K },
          ipo: { users: 1.2 * M },
          archetypes: { startup: { cash: 500 * K } },
          pull: { maxMarketing: 5 * M },
          cpu: { personalities: { blitzscaler: { teamCap: 22 }, bootstrapper: { teamCap: 18 }, incumbent: { teamCap: 30 } } },
          events: {
            deck: [
              {
                id: "bust-blog-darling",
                name: "Blog darling",
                text: "Every weblog links to one company this year: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "bust-burnout",
                name: "Burnout",
                text: "Doing three jobs at once costs one company a person.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "bust-survivor-story",
                name: "Survivor story",
                text: "The press praises the best product as one that will outlast the crash: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "bust-worm",
                name: "Worm outbreak",
                text: "An email worm tears through a shaky product: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "bust-pink-slips",
                name: "Pink slips",
                text: "Another round of closures elsewhere: 4 extra candidates this year.",
                weight: 1,
                effects: [{ kind: "candidates", extra: 4 }],
              },
              {
                id: "bust-always-on",
                name: "Always on",
                text: "Cable and phone companies wire up a wave of homes: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "phones",
        name: "Phones and cloud",
        firstYear: 2007,
        invented: false,
        values: {
          market: { newUsersTurn1: 700 * K, growthPerTurn: 0.1 },
          salary: 100 * K,
          valuation: { perUser: 16 },
          priceTiers: { budget: { price: 1.6 }, standard: { price: 2.4 }, premium: { price: 4 } },
          hiring: { candidatesPerTurn: 5 },
          ipo: { users: 2.3 * M },
          archetypes: { startup: { cash: 600 * K } },
          // Rented servers: each builder ships more. Store charts and sharing make Growth work count for more.
          quality: { gainPerWork: 11 },
          pull: { maxMarketing: 10 * M, growthCoefficient: 0.4 },
          cpu: { personalities: { blitzscaler: { teamCap: 38 }, bootstrapper: { teamCap: 27 }, incumbent: { teamCap: 52 } } },
          events: {
            deck: [
              {
                id: "phones-top-of-the-charts",
                name: "Top of the charts",
                text: "One company's app tops the download charts: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "phones-crunch",
                name: "Launch crunch",
                text: "A crunch before launch costs one company a person.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "phones-editors-pick",
                name: "Editors' pick",
                text: "The app shop features the best product on its front page: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "phones-password-leak",
                name: "Password leak",
                text: "A shaky product leaks its users' passwords: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "phones-talent-glut",
                name: "Talent glut",
                text: "An old phone maker shuts a whole division: 4 extra candidates this year.",
                weight: 1,
                effects: [{ kind: "candidates", extra: 4 }],
              },
              {
                id: "phones-gift-season",
                name: "Gift season",
                text: "Smartphones are the present of the year: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
              {
                id: "phones-install-ads",
                name: "Install ad bidding war",
                text: "Every studio bids for the same app adverts: marketing is half as effective this year.",
                weight: 1,
                effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "cheap-money",
        name: "Cheap money years",
        firstYear: 2014,
        invented: false,
        values: {
          market: { newUsersTurn1: 1.3 * M, growthPerTurn: 0.03 },
          salary: 130 * K,
          valuation: { perUser: 23 },
          priceTiers: { budget: { price: 1.44 }, standard: { price: 2.16 }, premium: { price: 3.6 } },
          hiring: { candidatesPerTurn: 10 },
          ipo: { users: 6 * M },
          archetypes: { startup: { cash: 1 * M } },
          pull: { maxMarketing: 30 * M },
          cpu: { personalities: { blitzscaler: { teamCap: 75 }, bootstrapper: { teamCap: 49 }, incumbent: { teamCap: 105 } } },
          // Users move between rivals.
          churn: { base: 0.35 },
          events: {
            deck: [
              {
                id: "cheap-money-trending",
                name: "Trending",
                text: "One company is trending on every feed this year: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "cheap-money-burnout",
                name: "Burnout",
                text: "One company loses a person to burnout, and to a rival's signing bonus.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "cheap-money-best-of",
                name: "Best of the year",
                text: "Reviewers name the best product the one to beat: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "cheap-money-data-breach",
                name: "Data breach",
                text: "A shaky product leaks its customer records: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "cheap-money-subscription-boom",
                name: "Subscription boom",
                text: "Businesses move their work to software by subscription: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
              {
                id: "cheap-money-crowded-feeds",
                name: "Crowded feeds",
                text: "Every startup buys the same social adverts: marketing is half as effective this year.",
                weight: 1,
                effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "winter-ai",
        name: "Winter and AI",
        firstYear: 2022,
        invented: false,
        values: {
          market: { newUsersTurn1: 1.6 * M, growthPerTurn: 0.04 },
          salary: 150 * K,
          valuation: { perUser: 18 },
          priceTiers: { budget: { price: 1.44 }, standard: { price: 2.16 }, premium: { price: 3.6 } },
          hiring: { candidatesPerTurn: 7 },
          ipo: { users: 8 * M },
          archetypes: { startup: { cash: 1 * M } },
          // Coding assistants build faster; features are copied in weeks.
          quality: { gainPerWork: 12, decay: 8 },
          pull: { maxMarketing: 30 * M },
          cpu: { personalities: { blitzscaler: { teamCap: 75 }, bootstrapper: { teamCap: 49 }, incumbent: { teamCap: 105 } } },
          events: {
            deck: [
              {
                id: "winter-ai-demo",
                name: "Demo goes viral",
                text: "One company's demo video is shared by millions: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "winter-ai-burnout",
                name: "Burnout",
                text: "Shipping every week costs one company a person.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "winter-ai-benchmark",
                name: "Top of the benchmark",
                text: "The best product tops an independent test: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "winter-ai-leaked-chats",
                name: "Leaked chats",
                text: "A shaky product shows users each other's conversations: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "winter-ai-cuts",
                name: "Another round of cuts",
                text: "Big tech firms cut staff again: 4 extra candidates this year.",
                weight: 1,
                effects: [{ kind: "candidates", extra: 4 }],
              },
              {
                id: "winter-ai-ad-prices",
                name: "Ad prices spike",
                text: "Advertisers crowd into the same few platforms: marketing is half as effective this year.",
                weight: 1,
                effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "agents",
        name: "Agent economy",
        firstYear: 2027,
        invented: true,
        values: {
          market: { newUsersTurn1: 2 * M, growthPerTurn: 0.06 },
          salary: 365 * K,
          valuation: { perUser: 4 },
          priceTiers: { budget: { price: 1.2 }, standard: { price: 1.8 }, premium: { price: 3 } },
          hiring: { candidatesPerTurn: 2 },
          ipo: { users: 10 * M },
          archetypes: { startup: { cash: 1.5 * M } },
          // Small teams that build fast; agents switch to the better product at once and do not watch adverts.
          quality: { gainPerWork: 18 },
          churn: { perQualityPoint: 0.003 },
          pull: { maxMarketing: 40 * M, marketingCoefficient: 0.15 },
          cpu: { personalities: { blitzscaler: { teamCap: 45 }, bootstrapper: { teamCap: 29 }, incumbent: { teamCap: 60 } } },
          events: {
            deck: [
              {
                id: "agents-default-pick",
                name: "Default pick",
                text: "A popular assistant starts recommending one company's product: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "agents-sign-off-fatigue",
                name: "Sign-off fatigue",
                text: "Approving ten thousand agent actions a day costs one company a person.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "agents-top-rated",
                name: "Top rated",
                text: "Buying agents rate the best product first in its field: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "agents-rogue-agent",
                name: "Rogue agent",
                text: "A shaky product's agent sends customers the wrong orders: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "agents-shopping-spree",
                name: "Agents go shopping",
                text: "Household agents are allowed to sign up for services on their own: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
      {
        id: "ambient",
        name: "Ambient age",
        firstYear: 2033,
        invented: true,
        values: {
          market: { newUsersTurn1: 3.5 * M, growthPerTurn: 0.1 },
          salary: 280 * K,
          valuation: { perUser: 11 },
          priceTiers: { budget: { price: 1.12 }, standard: { price: 1.68 }, premium: { price: 2.8 } },
          hiring: { candidatesPerTurn: 10 },
          ipo: { users: 25 * M },
          archetypes: { startup: { cash: 2 * M } },
          // Trust is worth more than reach: adverts hardly move users, a launch moves them more.
          pull: { maxMarketing: 60 * M, marketingCoefficient: 0.1 },
          hype: { launch: 25 },
          cpu: { personalities: { blitzscaler: { teamCap: 90 }, bootstrapper: { teamCap: 58 }, incumbent: { teamCap: 135 } } },
          events: {
            deck: [
              {
                id: "ambient-word-of-mouth",
                name: "Word of mouth",
                text: "Neighbours show off one company's product over the fence: +20 hype.",
                weight: 1,
                target: { pick: "random" },
                effects: [{ kind: "targetHype", delta: 20 }],
              },
              {
                id: "ambient-burnout",
                name: "Burnout",
                text: "Even on a four-day week, one company loses a person to burnout.",
                weight: 1,
                target: { pick: "random", minHeadcount: 4 },
                effects: [{ kind: "targetHeadcount", delta: -1 }],
              },
              {
                id: "ambient-safety-licence",
                name: "Safety licence",
                text: "The best product is the first to earn the new safety licence: +15 hype.",
                weight: 1,
                target: { pick: "highestQuality", launched: true },
                effects: [{ kind: "targetHype", delta: 15 }],
              },
              {
                id: "ambient-glasses-glitch",
                name: "Glasses glitch",
                text: "A shaky product's glasses show strangers' messages: it loses 10% of its users and 10 hype.",
                weight: 1,
                target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
                effects: [
                  { kind: "targetUsers", fraction: 0.1 },
                  { kind: "targetHype", delta: -10 },
                ],
              },
              {
                id: "ambient-screen-makers-close",
                name: "Screen makers close",
                text: "Old screen makers close their software teams: 4 extra candidates this year.",
                weight: 1,
                effects: [{ kind: "candidates", extra: 4 }],
              },
              {
                id: "ambient-every-room",
                name: "Every room",
                text: "Homes fit voice panels in every room: new users ×1.5 this year.",
                weight: 1,
                effects: [{ kind: "newUsers", multiplier: 1.5 }],
              },
            ],
          },
        } satisfies Overlay<Omit<PlayConfig, "game" | "career">>,
      },
    ],
    // One card a year, in its year. Real events stop in 2025; from 2027 the cards are invented.
    dated: [
      // US recession, July 1990 to March 1991 (NBER business-cycle dates).
      {
        id: "recession",
        year: 1990,
        name: "Recession",
        text: "The economy tips into recession and banks tighten their lending.",
        effects: [
          { kind: "fundingClimate", multiplier: 0.7, turns: 2 },
          { kind: "newUsers", multiplier: 0.8 },
        ],
      },
      // Tim Berners-Lee announces the World Wide Web project on alt.hypertext, 6 August 1991 (CERN).
      {
        id: "web-of-pages",
        year: 1991,
        name: "A web of pages",
        text: "A researcher at a physics laboratory invites the public to try a new system of linked pages on the internet.",
        effects: [{ kind: "newUsers", multiplier: 1.25 }],
      },
      // CERN puts the World Wide Web software in the public domain, 30 April 1993.
      {
        id: "free-for-all",
        year: 1993,
        name: "Free for all",
        text: "The laboratory that invented the web puts its software in the public domain, free for anyone to use or build on.",
        effects: [{ kind: "newUsers", multiplier: 1.5 }],
      },
      // HotWired launches with paid banner adverts, AT&T's among them, 27 October 1994.
      {
        id: "first-banner-adverts",
        year: 1994,
        name: "First banner adverts",
        text: "A web magazine launches with what are usually counted as the first paid banner adverts; one is said to have been clicked by 44% of the people who saw it.",
        effects: [{ kind: "marketingEffect", multiplier: 1.5 }],
      },
      // Platform shift. Netscape Navigator makes the web a mass market; Netscape's IPO, 9 August 1995, priced at $28
      // and closed at $58.25, sixteen months after the company was founded.
      {
        id: "the-browser",
        year: 1995,
        name: "The browser",
        text: "The browser turns the internet into a mass market, and a sixteen-month-old browser maker with no profits sells shares that more than double on the first day.",
        effects: [
          { kind: "qualityCeiling", ceiling: 30, turns: 1 },
          { kind: "userWave", multiplier: 1.3, turns: 5 },
          { kind: "fundingClimate", multiplier: 1.5, turns: 3 },
        ],
      },
      // theGlobe.com's IPO, 13 November 1998: priced at $9, closed at $63.50 (+606%).
      {
        id: "seven-fold-debut",
        year: 1998,
        name: "Seven-fold debut",
        text: "An online community site's shares end their first day about 600% above the offer price, a record at the time.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.6, turns: 2 },
          { kind: "newUsers", multiplier: 1.25 },
          { kind: "candidates", extra: -2 },
        ],
      },
      // The Nasdaq Composite falls 25.3% in the week ending 14 April 2000, after its record close on 10 March 2000.
      {
        id: "worst-week",
        year: 2000,
        name: "The worst week",
        text: "The technology share index loses a quarter of its value in one week, a month after its record high.",
        effects: [
          { kind: "fundingClimate", multiplier: 0.5, turns: 3 },
          { kind: "newUsers", multiplier: 0.7 },
          { kind: "candidates", extra: 4 },
        ],
      },
      // Nielsen//NetRatings, July 2004: 51% of active US home internet users connect by broadband.
      {
        id: "broadband-majority",
        year: 2004,
        name: "Broadband majority",
        text: "For the first time more than half of the home internet users in the largest market connect by broadband instead of dial-up.",
        effects: [{ kind: "newUsers", multiplier: 1.5 }],
      },
      // Google buys YouTube for $1.65 billion in shares, announced 9 October 2006; YouTube was founded in February 2005.
      {
        id: "video-site-sale",
        year: 2006,
        name: "Video site sale",
        text: "A search company buys a twenty-month-old video-sharing site for $1.65 billion in shares.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.4, turns: 2 },
          { kind: "newUsers", multiplier: 1.25 },
        ],
      },
      // Platform shift. The first iPhone goes on sale in the United States, 29 June 2007.
      {
        id: "touchscreen-phone",
        year: 2007,
        name: "The touchscreen phone",
        text: "A touchscreen phone with a full web browser goes on sale and buyers queue overnight.",
        effects: [
          { kind: "qualityCeiling", ceiling: 30, turns: 1 },
          { kind: "userWave", multiplier: 1.3, turns: 5 },
        ],
      },
      // Lehman Brothers files for bankruptcy, 15 September 2008.
      {
        id: "bank-collapse",
        year: 2008,
        name: "Bank collapse",
        text: "A 158-year-old investment bank files the largest bankruptcy in the country's history and lending freezes worldwide.",
        effects: [
          { kind: "fundingClimate", multiplier: 0.5, turns: 2 },
          { kind: "newUsers", multiplier: 0.8 },
          { kind: "candidates", extra: 4 },
        ],
      },
      // Amazon Web Services US-East outage from 21 April 2011: most storage back in about 36 hours, all in about four days.
      {
        id: "cloud-outage",
        year: 2011,
        name: "Cloud outage",
        text: "A fault in one region of the largest cloud provider knocks many well-known startups offline, some for more than a day; full recovery takes about four days.",
        target: { pick: "random", launched: true, qualityBelow: 87, minUsers: 1 },
        effects: [
          { kind: "targetUsers", fraction: 0.1 },
          { kind: "targetHype", delta: -10 },
        ],
      },
      // Facebook agrees to buy Instagram for $1 billion, announced 9 April 2012.
      {
        id: "thirteen-people",
        year: 2012,
        name: "Thirteen people, one billion",
        text: "A social network agrees to pay $1 billion for a photo-sharing app that has 13 employees and no revenue.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.4, turns: 2 },
          { kind: "candidates", extra: -2 },
        ],
      },
      // Facebook agrees to buy WhatsApp for $19 billion, announced 19 February 2014.
      {
        id: "nineteen-billion",
        year: 2014,
        name: "Nineteen billion",
        text: "A social network agrees to pay $19 billion for a messaging app with about 55 employees and 450 million users.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.5, turns: 3 },
          { kind: "candidates", extra: -2 },
        ],
      },
      // The European Union's General Data Protection Regulation applies from 25 May 2018.
      {
        id: "privacy-law",
        year: 2018,
        name: "Privacy law",
        text: "A data-protection law takes effect across a bloc of 28 countries, with fines of up to 4% of a company's worldwide revenue.",
        effects: [{ kind: "marketingEffect", multiplier: 0.7 }],
      },
      // WeWork withdraws its IPO filing, 30 September 2019; it was valued at $47 billion in January 2019.
      {
        id: "pulled-offering",
        year: 2019,
        name: "The pulled offering",
        text: "An office-rental startup valued at $47 billion at the start of the year cancels its share offering after investors balk at its losses.",
        effects: [
          { kind: "fundingClimate", multiplier: 0.7, turns: 1 },
          { kind: "marketingEffect", multiplier: 1.25 },
        ],
      },
      // The World Health Organization declares COVID-19 a pandemic, 11 March 2020; Twitter tells its staff they may
      // work from home for good, 12 May 2020.
      {
        id: "everyone-goes-home",
        year: 2020,
        name: "Everyone goes home",
        text: "A pandemic is declared, offices close within days and daily life moves online; some companies tell their staff they may work from home for good.",
        effects: [
          { kind: "newUsers", multiplier: 1.5 },
          { kind: "candidates", extra: 4 },
        ],
      },
      // The US Federal Reserve's first rise since 2018, 16 March 2022; seven rises that year take the rate to
      // 4.25-4.50% by December.
      {
        id: "rates-rise",
        year: 2022,
        name: "Rates rise",
        text: "The central bank raises interest rates for the first time since 2018 and keeps raising them, from near zero to above 4% by December.",
        effects: [
          { kind: "fundingClimate", multiplier: 0.6, turns: 2 },
          { kind: "newUsers", multiplier: 0.8 },
          { kind: "candidates", extra: 4 },
        ],
      },
      // Platform shift. ChatGPT, released 30 November 2022, is estimated at 100 million monthly users in January 2023;
      // Amazon, Microsoft and Alphabet announce 40,000 job cuts between 4 and 20 January 2023.
      {
        id: "the-chatbot",
        year: 2023,
        name: "The chatbot",
        text: "A research lab's free chatbot, out since late last year, is said to reach 100 million users in two months, while three of the largest technology companies announce 40,000 job cuts.",
        effects: [
          { kind: "qualityCeiling", ceiling: 30, turns: 1 },
          { kind: "userWave", multiplier: 1.3, turns: 5 },
          { kind: "candidates", extra: 4 },
        ],
      },
      // Nvidia passes $4 trillion in market value during trading, 9 July 2025.
      {
        id: "four-trillion",
        year: 2025,
        name: "Four trillion",
        text: "A maker of graphics chips becomes the first company valued at $4 trillion.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.4, turns: 2 },
          { kind: "candidates", extra: -2 },
        ],
      },
      // Invented.
      {
        id: "compute-crunch",
        year: 2028,
        name: "Compute crunch",
        text: "Chip supply falls short and services ration new sign-ups.",
        effects: [{ kind: "newUsers", multiplier: 0.7 }],
      },
      // Invented.
      {
        id: "sign-off-law",
        year: 2029,
        name: "Sign-off law",
        text: "A new law requires a named person to approve every automated message sent to a customer.",
        effects: [{ kind: "marketingEffect", multiplier: 0.5 }],
      },
      // Invented.
      {
        id: "one-person-billion",
        year: 2030,
        name: "The one-person billion",
        text: "A company with a single employee is valued at a billion.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.6, turns: 2 },
          { kind: "newUsers", multiplier: 1.25 },
        ],
      },
      // Invented.
      {
        id: "back-office-layoffs",
        year: 2031,
        name: "Back-office layoffs",
        text: "Large firms replace whole departments with agents and experienced people flood the job market.",
        effects: [{ kind: "candidates", extra: 5 }],
      },
      // Invented. Platform shift.
      {
        id: "glasses-outsell-phones",
        year: 2033,
        name: "Glasses outsell phones",
        text: "For the first time more smart glasses than handsets are sold in a year.",
        effects: [
          { kind: "qualityCeiling", ceiling: 30, turns: 1 },
          { kind: "userWave", multiplier: 1.3, turns: 5 },
        ],
      },
      // Invented.
      {
        id: "home-helper-recall",
        year: 2035,
        name: "Home-helper recall",
        text: "A home-robot model is recalled after a software fault, and the scare costs one product in the market a fifth of its users.",
        target: { pick: "random", launched: true, qualityBelow: 101, minUsers: 1 },
        effects: [
          { kind: "targetUsers", fraction: 0.2 },
          { kind: "targetHype", delta: -15 },
        ],
      },
      // Invented.
      {
        id: "power-rationing",
        year: 2036,
        name: "Power rationing",
        text: "A hot summer forces data halls to ration electricity for a month.",
        effects: [{ kind: "newUsers", multiplier: 0.7 }],
      },
      // Invented.
      {
        id: "citizen-funds",
        year: 2037,
        name: "Citizen funds",
        text: "Public pension funds are allowed to back young companies directly.",
        effects: [
          { kind: "fundingClimate", multiplier: 1.5, turns: 2 },
          { kind: "newUsers", multiplier: 1.25 },
        ],
      },
    ],
    shiftNoticeYears: 2,
    listing: { percent: 20, premium: 1.25, hype: 20, investorSeats: 1 },
    rescue: { equityKept: 0.5, investorSeats: 2, hype: -10, salaryYears: 1 },
    replacement: { afterYears: 2, styles: ["blitzscaler", "bootstrapper", "incumbent"] },
    offices: [
      { id: "garage", name: "Garage", capacity: 4 },
      { id: "shared", name: "Shared office", capacity: 9 },
      { id: "own", name: "Own office", capacity: 22 },
      { id: "floor", name: "Full floor", capacity: 40 },
      { id: "campus", name: "Campus", capacity: 150 },
    ],
    moving: { salaryYears: 0.5 },
  },
};
