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

export const calcValuation = (state: GameState, ctx: EngineContext): number => {
  const arr = calcArr(state);
  const base = stageMultipleBase[state.stage];

  // Growth drives multiples. Use weekly MRR growth (already clamped in context).
  // Mapping: +10% week -> +1.2x, +30% week -> +3.6x, +50% week -> +6x (cap).
  const growthBoost = clamp(ctx.mrrGrowthRate, -0.2, 0.5) * 12;

  const vc = clamp((state.vcReputation - 50) / 50, -1, 1) * 2.2;
  const rep = clamp((state.reputation - 50) / 50, -1, 1) * 1.2;
  const hype = clamp((state.volatility - 35) / 65, -1, 1) * 1.3;
  const stressPenalty = clamp(state.stress / 100, 0, 1) * 3.2;
  const pmBonus = PRICING_MODELS[state.pricingModel].valuationBonus;

  const multiple = clamp(base + growthBoost + vc + rep + hype - stressPenalty + pmBonus, 2.5, 32);

  const fromArr = arr * multiple;
  const floored = Math.max(STAGE_VALUATION_FLOOR[state.stage], fromArr);

  // If you just priced a round, the market narrative doesn't instantly un-price it,
  // but it decays over time — down rounds are real. ~8-week half-life.
  const weeksSinceRound = state.lastRound ? state.week - state.lastRound.week : 0;
  const postMoneyFloor = (state.lastRound?.postMoney ?? 0) * Math.pow(0.92, weeksSinceRound);
  const withRound = Math.max(floored, postMoneyFloor);

  // Hard cap per stage — even unicorns have limits.
  const capped = Math.min(STAGE_VALUATION_CAP[state.stage], withRound);

  // Keep numbers stable/readable.
  return Math.round(capped / 1000) * 1000;
};
