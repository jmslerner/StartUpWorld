import type { GameState } from "../types/game";
import { clamp } from "./utils";
import { calcRunwayWeeks } from "./economy";

// ── Stress calculation constants ──
const RUNWAY_PRESSURE_WEEKS = 10;     // stress maxes when runway drops below this
const MORALE_PRESSURE_THRESHOLD = 60; // morale below this adds stress
const BASE_STRESS = 12;
const RUNWAY_STRESS_WEIGHT = 60;      // max stress contribution from low runway
const MORALE_STRESS_WEIGHT = 35;      // max stress contribution from low morale
const VOLATILITY_STRESS_WEIGHT = 12;  // max stress contribution from volatility
const MAX_SUCCESS_PENALTY = 0.35;
const BASE_SUCCESS_PENALTY = 0.05;
const STRESS_PENALTY_SCALE = 0.3;

export const calcStress = (state: GameState): number => {
  const runway = calcRunwayWeeks(state);

  // Runway pressure (0..1)
  const runwayPressure = runway <= 0 ? 1 : clamp((RUNWAY_PRESSURE_WEEKS - runway) / RUNWAY_PRESSURE_WEEKS, 0, 1);
  const moralePressure = clamp((MORALE_PRESSURE_THRESHOLD - state.culture.morale) / MORALE_PRESSURE_THRESHOLD, 0, 1);

  const raw = BASE_STRESS + runwayPressure * RUNWAY_STRESS_WEIGHT + moralePressure * MORALE_STRESS_WEIGHT + (state.volatility / 100) * VOLATILITY_STRESS_WEIGHT;
  return clamp(Math.round(raw), 0, 100);
};

export const successPenaltyFromStress = (state: GameState): number => {
  const s = state.stress / 100;
  return Math.min(MAX_SUCCESS_PENALTY, BASE_SUCCESS_PENALTY + s * STRESS_PENALTY_SCALE);
};
