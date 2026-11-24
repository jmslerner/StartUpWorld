// Every number in the game lives in this file. The rules that use them are in src/engine and are
// described in docs/turn-based-design.md: keep the rules, tune the numbers. Each change from the
// design's starting value is recorded in that document's Tuning log.
//
// Nothing here is code. To add an event, add a card to `events.deck` using the effects listed in
// EventEffect (src/engine/types.ts).

import type { BaselineConfig, CpuConfig, SimConfig } from "./ai/types";
import type { RulesConfig } from "./engine/types";

const K = 1_000;
const M = 1_000_000;

/** The rules' numbers, plus the numbers behind the computer players and the simulator. */
export interface GameConfig extends RulesConfig {
  readonly cpu: CpuConfig;
  readonly baseline: BaselineConfig;
  readonly sim: SimConfig;
}

export const CONFIG: GameConfig = {
  // ── Game length and the win ──
  game: { maxTurns: 20 },
  /** A company with this many users and a profitable quarter goes public and wins. */
  ipo: { users: 250 * K },

  // ── Starting state ──
  archetypes: {
    // Player, Blitzscaler, Bootstrapper.
    startup: {
      cash: 500 * K,
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
      workExponent: 0.8,
      /** +50% product output while it trails the quality leader. */
      catchUpMultiplier: 1.5,
      allocation: { product: 5, growth: 2, recruiting: 1 },
    },
  },

  // ── Talent ──
  /** Per person per quarter. */
  salary: 40 * K,
  hiring: {
    candidatesPerTurn: 6,
    /** Hiring capacity = this × Recruiting effective work, rounded. */
    capacityPerWork: 2,
    fee: 10 * K,
  },
  poach: {
    cost: 50 * K,
    baseChance: 0.5,
    /** (your hype − their hype) ÷ 2 points = 0.005 per hype point. */
    chancePerHypePoint: 0.005,
    minChance: 0.1,
    maxChance: 0.9,
    /** A target needs at least this many people. Not in the design; see the rulings. */
    minTargetHeadcount: 2,
  },
  layoff: { severance: 20 * K, hype: -10 },

  // ── Product ──
  quality: {
    /** Gain per turn = this × Product effective work × (1 − quality/100). */
    gainPerWork: 5,
    decay: 2,
    launchAt: 10,
  },

  // ── Market ──
  market: { newUsersTurn1: 20 * K, growthPerTurn: 0.1 },
  /** Pull = quality × (1 + growthCoefficient × Growth work + marketingCoefficient × √(marketing ÷ step)) × price factor × (1 + hype/100). */
  pull: {
    growthCoefficient: 0.3,
    marketingCoefficient: 0.5,
    marketingStep: 25 * K,
    /** Largest spend a plan may carry. Not in the design; a sanity limit only. */
    maxMarketing: 5 * M,
  },
  priceTiers: {
    budget: { price: 2, pullFactor: 1.25, churnDelta: -0.02 },
    standard: { price: 3, pullFactor: 1, churnDelta: 0 },
    premium: { price: 5, pullFactor: 0.75, churnDelta: 0.04 },
  },
  /** Churn per turn = base − perQualityPoint × quality + the tier's churnDelta, never below min. */
  churn: { base: 0.12, perQualityPoint: 0.0008, min: 0.02 },

  // ── Money ──
  raise: { minUsers: 1 * K, cooldownTurns: 2, options: [10, 20, 30] },
  /** Valuation = users × perUser × (1 + hype/100) × funding-climate multiplier. */
  valuation: { perUser: 150 },
  board: { fireChance: 0.3, runwayTurns: 2 },

  // ── Hype ──
  hype: { decay: 0.2, launch: 15, raise: 10, growth: 5, growthThreshold: 0.25 },

  // ── Projection (planning panel and CPU planner) ──
  // Not rules: assumptions the one-quarter projection uses about rivals it cannot see into.
  projection: { rivalPullGuess: 1.6, rivalHireGuess: 1 },

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
        target: { pick: "random", minHeadcount: 2 },
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
    boardRiskPenalty: 3,
    layoffRunway: 1,
    minShareForGrowth: 0.1,
    shortRunwayPenalty: 2,
    ipo: { win: 100, deficit: 20, nextDeficit: 10, usersShortfall: 20 },
    personalities: {
      // Chases users: Budget price, raises 30% the moment it can, heavy marketing.
      blitzscaler: {
        price: "budget",
        raise: { when: "eligible", runway: 0, percents: [30] },
        poachRunway: null,
        teamCap: 14,
        hireRunway: 2,
        marketingShares: [0, 0.1, 0.2, 0.35, 0.5],
        productShares: [0.7, 0.5, 0.3, 0.15],
        horizon: 4,
        weights: { users: 3, quality: 1, team: 1, runway: 0.5, runwayHalf: 1, hype: 0.3, equity: 0 },
      },
      // Protects runway and equity: Premium price, raises only under 2 turns of runway, small team, product first.
      bootstrapper: {
        price: "premium",
        raise: { when: "runway", runway: 2, percents: [10, 20, 30] },
        poachRunway: null,
        teamCap: 6,
        hireRunway: 5,
        marketingShares: [0, 0.03, 0.06],
        productShares: [1, 0.8, 0.6],
        horizon: 6,
        weights: { users: 1, quality: 2, team: 0.6, runway: 2, runwayHalf: 3, hype: 0.1, equity: 2 },
      },
      // Product-heavy, and poaches whenever it can afford to.
      incumbent: {
        price: "standard",
        raise: { when: "runway", runway: 3, percents: [10, 20, 30] },
        poachRunway: 3,
        teamCap: 16,
        hireRunway: 4,
        marketingShares: [0, 0.05, 0.1],
        productShares: [0.85, 0.7, 0.55],
        horizon: 5,
        weights: { users: 1.5, quality: 2.5, team: 0.8, runway: 1, runwayHalf: 2, hype: 0.3, equity: 0.5 },
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
