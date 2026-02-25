import type { FounderArchetype, GameState } from "../types/game";
import { clamp } from "./utils";

export interface FounderMods {
  shipSuccess: number; // additive probability
  launchSuccess: number;
  pitchSuccess: number;
  volatilitySensitivity: number; // multiplier
  stressSensitivity: number; // multiplier

  burnEfficiency: number; // multiplier applied to burn (lower is better)
  cultureWinMult: number; // multiplier applied to positive weekly culture drift
  cultureHitMult: number; // multiplier applied to negative weekly culture drift
}

export const founderMods: Record<FounderArchetype, FounderMods> = {
  visionary: {
    shipSuccess: -0.03,
    launchSuccess: 0.03,
    pitchSuccess: 0.06,
    volatilitySensitivity: 1.22,
    stressSensitivity: 1.08,
    burnEfficiency: 1.02,
    cultureWinMult: 0.98,
    cultureHitMult: 1.04,
  },
  hacker: {
    shipSuccess: 0.08,
    launchSuccess: -0.02,
    pitchSuccess: -0.03,
    volatilitySensitivity: 1.08,
    stressSensitivity: 0.98,
    burnEfficiency: 0.96,
    cultureWinMult: 1.0,
    cultureHitMult: 1.0,
  },
  "sales-animal": {
    shipSuccess: -0.05,
    launchSuccess: 0.06,
    pitchSuccess: 0.1,
    volatilitySensitivity: 1.28,
    stressSensitivity: 1.15,
    burnEfficiency: 1.05,
    cultureWinMult: 0.92,
    cultureHitMult: 1.12,
  },
  philosopher: {
    shipSuccess: -0.01,
    launchSuccess: -0.01,
    pitchSuccess: 0.0,
    volatilitySensitivity: 0.85,
    stressSensitivity: 0.85,
    burnEfficiency: 0.99,
    cultureWinMult: 1.18,
    cultureHitMult: 0.86,
  },
};

export const isFounderChosen = (state: GameState): boolean => state.founder.archetype !== null;

export const setFounder = (state: GameState, archetype: FounderArchetype): GameState => ({
  ...state,
  founder: { archetype },
});

export const applyCofounderWeeklyDrift = (state: GameState, opts: { hit: number; win: number }): GameState => {
  // hit: negative week magnitude 0..1, win: positive week magnitude 0..1
  const ambitionPull = (state.cofounder.ambition - 50) / 50; // -1..1

  const trustDelta = Math.round(opts.win * 6 - opts.hit * 10 - Math.max(0, ambitionPull) * 1);
  const egoDelta = Math.round(opts.win * 2 + opts.hit * 5 + Math.max(0, ambitionPull) * 2);

  return {
    ...state,
    cofounder: {
      trust: clamp(state.cofounder.trust + trustDelta, 0, 100),
      ego: clamp(state.cofounder.ego + egoDelta, 0, 100),
      ambition: clamp(state.cofounder.ambition + Math.round(opts.win * 2 - opts.hit * 1), 0, 100),
    },
  };
};
