import type { GameState } from "../types/game";
import { clamp } from "./utils";

export const calcVolatility = (state: GameState, opts: { growthRate: number; burnIntensity: number }): number => {
  // growthRate: weekly users growth (e.g. 0.08), burnIntensity: burn / max(cash,1)
  const growth = clamp(opts.growthRate, -0.5, 0.8);
  const burn = clamp(opts.burnIntensity, 0, 3);

  // VC reputation makes your life louder (more attention, more scrutiny).
  const vc = clamp(state.vcReputation / 100, 0, 1);

  const target = 18 + growth * 55 + burn * 22 + vc * 28;
  // Smooth-ish: move toward target.
  const next = state.volatility + (target - state.volatility) * 0.35;
  return clamp(Math.round(next), 0, 100);
};

export const severityMultiplier = (volatility: number): number => 1 + (clamp(volatility, 0, 100) / 100) * 1.3;
