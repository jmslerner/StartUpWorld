import type { GameState } from "../types/game";
import { clamp } from "./utils";
import { calcRunwayWeeks } from "./economy";

export const calcStress = (state: GameState): number => {
  const runway = calcRunwayWeeks(state);

  // Runway pressure (0..1)
  const runwayPressure = runway <= 0 ? 1 : clamp((10 - runway) / 10, 0, 1);
  const moralePressure = clamp((60 - state.culture.morale) / 60, 0, 1);

  const raw = 12 + runwayPressure * 60 + moralePressure * 35 + (state.volatility / 100) * 12;
  return clamp(Math.round(raw), 0, 100);
};

export const successPenaltyFromStress = (state: GameState): number => {
  // Returns 0..0.35 probability penalty
  const s = state.stress / 100;
  return Math.min(0.35, 0.05 + s * 0.3);
};
