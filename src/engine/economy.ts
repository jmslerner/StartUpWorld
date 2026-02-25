import type { GameState, Stage, TeamRole } from "../types/game";
import { clamp } from "./utils";
import { founderMods } from "./founders";

export const BASE_AP = 3;

export const roleComp: Record<TeamRole, { salary: number; hireCost: number }> = {
  engineering: { salary: 3500, hireCost: 3000 },
  design: { salary: 2800, hireCost: 2500 },
  marketing: { salary: 2600, hireCost: 2200 },
  sales: { salary: 3000, hireCost: 2500 },
  ops: { salary: 2400, hireCost: 2000 },
};

export const stageOverhead: Record<Stage, number> = {
  garage: 500,
  seed: 2500,
  "series-a": 8000,
  growth: 18000,
};

export const calcBurn = (state: GameState): number => {
  const teamBurn = (Object.keys(state.team) as TeamRole[]).reduce(
    (acc, role) => acc + state.team[role] * roleComp[role].salary,
    0
  );
  const overhead = stageOverhead[state.stage];

  // Chaos tax: high volatility + low cohesion makes everything cost more.
  const chaosTax = 1 + (state.volatility / 100) * 0.12 + (1 - state.culture.cohesion / 100) * 0.08;

  const archetype = state.founder.archetype;
  const efficiency = archetype ? founderMods[archetype].burnEfficiency : 1;

  return Math.round((teamBurn + overhead) * chaosTax * efficiency) + Math.max(0, state.debtService);
};

export const calcRunwayWeeks = (state: GameState): number => {
  const burn = Math.max(1, state.burn);
  return Math.floor(state.cash / burn);
};

export const clamp01 = (n: number): number => clamp(n, 0, 1);

export const percent = (n: number): string => `${Math.round(n * 100)}%`;
