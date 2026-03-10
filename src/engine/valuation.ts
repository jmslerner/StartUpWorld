import type { GameState, Stage } from "../types/game";
import type { EngineContext } from "./context";
import { clamp } from "./utils";
import { PRICING_MODELS } from "./pricing";

export const calcArr = (state: GameState): number => Math.max(0, state.mrr) * 12;

const stageMultipleBase: Record<Stage, number> = {
  garage: 4.5,
  seed: 7.5,
  "series-a": 9.5,
  growth: 12,
};

// Narrative + market floor so early-stage companies can still feel "valuable".
export const STAGE_VALUATION_FLOOR: Record<Stage, number> = {
  garage: 2_000_000,
  seed: 12_000_000,
  "series-a": 60_000_000,
  growth: 250_000_000,
};

// Hard ceiling per stage — prevents runaway valuations.
const STAGE_VALUATION_CAP: Record<Stage, number> = {
  garage: 25_000_000,
  seed: 200_000_000,
  "series-a": 2_000_000_000,
  growth: 15_000_000_000,
};

// ── Valuation multiple weights ──
const GROWTH_BOOST_SCALE = 12;        // +10% weekly MRR → +1.2x multiple
const VC_REP_WEIGHT = 2.2;            // max ±2.2x from VC reputation
const REPUTATION_WEIGHT = 1.2;        // max ±1.2x from public reputation
const HYPE_WEIGHT = 1.3;              // max ±1.3x from volatility-driven hype
const STRESS_PENALTY_WEIGHT = 3.2;    // max -3.2x from founder stress
const MULTIPLE_CLAMP_MIN = 2.5;
const MULTIPLE_CLAMP_MAX = 32;
const POST_MONEY_DECAY_RATE = 0.92;   // ~8-week half-life for post-money floor

export const calcValuation = (state: GameState, ctx: EngineContext): number => {
  const arr = calcArr(state);
  const base = stageMultipleBase[state.stage];

  // Growth drives multiples. Use weekly MRR growth (already clamped in context).
  const growthBoost = clamp(ctx.mrrGrowthRate, -0.2, 0.5) * GROWTH_BOOST_SCALE;

  const vc = clamp((state.vcReputation - 50) / 50, -1, 1) * VC_REP_WEIGHT;
  const rep = clamp((state.reputation - 50) / 50, -1, 1) * REPUTATION_WEIGHT;
  const hype = clamp((state.volatility - 35) / 65, -1, 1) * HYPE_WEIGHT;
  const stressPenalty = clamp(state.stress / 100, 0, 1) * STRESS_PENALTY_WEIGHT;
  const pmBonus = PRICING_MODELS[state.pricingModel].valuationBonus;

  const multiple = clamp(base + growthBoost + vc + rep + hype - stressPenalty + pmBonus, MULTIPLE_CLAMP_MIN, MULTIPLE_CLAMP_MAX);

  const fromArr = arr * multiple;
  const floored = Math.max(STAGE_VALUATION_FLOOR[state.stage], fromArr);

  // If you just priced a round, the market narrative doesn't instantly un-price it,
  // but it decays over time — down rounds are real.
  const weeksSinceRound = state.lastRound ? state.week - state.lastRound.week : 0;
  const postMoneyFloor = (state.lastRound?.postMoney ?? 0) * Math.pow(POST_MONEY_DECAY_RATE, weeksSinceRound);
  const withRound = Math.max(floored, postMoneyFloor);

  // Hard cap per stage — even unicorns have limits.
  const capped = Math.min(STAGE_VALUATION_CAP[state.stage], withRound);

  // Keep numbers stable/readable.
  return Math.round(capped / 1000) * 1000;
};
