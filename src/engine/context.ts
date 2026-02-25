import type { GameState } from "../types/game";
import { calcRunwayWeeks } from "./economy";
import { clamp } from "./utils";

export interface EngineContext {
  runwayWeeks: number;
  usersGrowthRate: number; // vs last week
  mrrGrowthRate: number;
  burnIntensity: number; // burn / max(cash,1)
  teamSize: number;
  hiresThisWeek: number;
  nearBankruptcy: boolean;
}

export const computeTeamSize = (state: GameState): number =>
  Object.values(state.team).reduce((acc, n) => acc + n, 0);

export const computeContext = (state: GameState): EngineContext => {
  const runwayWeeks = calcRunwayWeeks(state);
  const usersGrowthRate = state.lastWeek.users > 0 ? (state.users - state.lastWeek.users) / state.lastWeek.users : 0;
  const mrrGrowthRate = state.lastWeek.mrr > 0 ? (state.mrr - state.lastWeek.mrr) / state.lastWeek.mrr : 0;
  const burnIntensity = state.cash > 0 ? state.burn / Math.max(1, state.cash) : 3;
  const teamSize = computeTeamSize(state);
  const hiresThisWeek = Math.max(0, teamSize - state.lastWeek.teamSize);

  return {
    runwayWeeks,
    usersGrowthRate: clamp(usersGrowthRate, -0.9, 2.0),
    mrrGrowthRate: clamp(mrrGrowthRate, -0.9, 2.0),
    burnIntensity: clamp(burnIntensity, 0, 3),
    teamSize,
    hiresThisWeek,
    nearBankruptcy: runwayWeeks <= 3 || state.cash < 0,
  };
};
