// Every number in the game lives in this file. The rules that use them are in src/engine and are
// described in docs/turn-based-design.md: keep the rules, tune the numbers. Each change from the
// design's starting value is recorded in that document's Tuning log.
//
// Nothing here is code. To add an event, add a card to `events.deck` using the effects listed in
// EventEffect (src/engine/types.ts).

import type { RulesConfig } from "./engine/types";

const K = 1_000;
const M = 1_000_000;

export type GameConfig = RulesConfig;

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
};
