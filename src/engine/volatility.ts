import type { GameState } from "../types/game";
import { clamp } from "./utils";

// Event / outcome scaling: 1.0 at 0, 2.0 at 50, 2.6 at 80, 3.0 at 100.
export const impactMultiplier = (volatility: number): number => 1 + clamp(volatility, 0, 100) / 50;

// Make high volatility produce bigger swings by fattening the distribution tails.
// `x` is expected in [-1, 1] (e.g. from signedUnit).
export const fatTailSigned = (x: number, volatility: number): number => {
  const v = clamp(volatility, 0, 100);

  // 0..20: almost unchanged, 40..60: noticeably fatter, 70+: extreme.
  const strength = v < 20 ? 0.05 : v < 40 ? 0.22 : v < 60 ? 0.45 : v < 70 ? 0.65 : v < 85 ? 0.85 : 1.1;

  // power in (0,1]: lower power => fatter tails.
  const power = clamp(1 - strength, 0.25, 1);
  const s = Math.max(-1, Math.min(1, x));
  return Math.sign(s) * Math.pow(Math.abs(s), power);
};

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
