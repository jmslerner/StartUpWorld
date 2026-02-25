import type { GameState, Stage } from "../types/game";
import type { EngineContext } from "./context";
import { clamp } from "./utils";

export const calcArr = (state: GameState): number => Math.max(0, state.mrr) * 12;

const stageMultipleBase: Record<Stage, number> = {
  garage: 4.5,
  seed: 7.5,
  "series-a": 9.5,
  growth: 12,
};

// Narrative + market floor so early-stage companies can still feel "valuable".
const stageValuationFloor: Record<Stage, number> = {
  garage: 2_000_000,
  seed: 12_000_000,
  "series-a": 60_000_000,
  growth: 250_000_000,
};

export const calcValuation = (state: GameState, ctx: EngineContext): number => {
  const arr = calcArr(state);
  const base = stageMultipleBase[state.stage];

  // Growth drives multiples. Use weekly MRR growth (already clamped in context).
  // Rough mapping: +10% week -> +4.0x, +30% week -> +10x.
  const growthBoost = clamp(ctx.mrrGrowthRate, -0.35, 0.8) * 33;

  const vc = clamp((state.vcReputation - 50) / 50, -1, 1) * 2.2;
  const rep = clamp((state.reputation - 50) / 50, -1, 1) * 1.2;
  const hype = clamp((state.volatility - 35) / 65, -1, 1) * 1.3;
  const stressPenalty = clamp(state.stress / 100, 0, 1) * 3.2;

  const multiple = clamp(base + growthBoost + vc + rep + hype - stressPenalty, 2.5, 32);

  const fromArr = arr * multiple;
  const floored = Math.max(stageValuationFloor[state.stage], fromArr);

  // Keep numbers stable/readable.
  return Math.round(floored / 1000) * 1000;
};
