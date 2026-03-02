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
  hr: { salary: 2600, hireCost: 2200 },
  legal: { salary: 4200, hireCost: 5000 },
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

  // Org imbalance: too much go-to-market without enough operators makes everything more expensive.
  const gtm = state.team.sales + state.team.marketing;
  const ops = state.team.ops;
  const gtmOpsGap = Math.max(0, gtm - ops);
  const orgInefficiency = 1 + Math.min(0.18, gtmOpsGap * 0.03);

  // Chaos tax: high volatility + low cohesion makes everything cost more.
  const chaosTax = 1 + (state.volatility / 100) * 0.12 + (1 - state.culture.cohesion / 100) * 0.08;

  const archetype = state.founder.archetype;
  const efficiency = archetype ? founderMods[archetype].burnEfficiency : 1;

  return Math.round((teamBurn + overhead) * chaosTax * efficiency * orgInefficiency) + Math.max(0, state.debtService);
};

/** Weekly revenue = MRR / 4 (burn is weekly, MRR is monthly). */
export const calcWeeklyRevenue = (state: GameState): number => Math.round(state.mrr / 4);

/** Net burn = gross burn - weekly revenue. Negative means profitable. */
export const calcNetBurn = (state: GameState): number => state.burn - calcWeeklyRevenue(state);

export const calcRunwayWeeks = (state: GameState): number => {
  const net = calcNetBurn(state);
  if (net <= 0) return 999; // profitable — effectively infinite runway
  return Math.floor(state.cash / net);
};

export const clamp01 = (n: number): number => clamp(n, 0, 1);

export const percent = (n: number): string => `${Math.round(n * 100)}%`;

// --- AP system helpers ---

export const AP_COSTS: Record<string, number> = {
  hire: 1,
  ship: 1,
  launch: 1,
  pitch: 1,
  "raise-vc": 2,
  "raise-bootstrap": 1,
};

/** Philosopher gets 4 AP per week; everyone else gets 3. */
export const getEffectiveMaxAp = (state: GameState): number => {
  if (state.founder.archetype === "philosopher") return BASE_AP + 1;
  return BASE_AP;
};

/**
 * Returns the AP cost for an action, accounting for archetype free perks.
 * Hacker: first ship free. Sales Animal: first pitch free. Visionary: first launch free.
 */
export const getApCost = (state: GameState, action: string): number => {
  const baseCost = AP_COSTS[action] ?? 1;
  const archetype = state.founder.archetype;
  if (!archetype || baseCost === 0) return baseCost;

  const freeKey = `${archetype}-free-${action}`;
  if (state.freeActionUsed[freeKey]) return baseCost;

  if (archetype === "hacker" && action === "ship") return 0;
  if (archetype === "sales-animal" && action === "pitch") return 0;
  if (archetype === "visionary" && action === "launch") return 0;

  return baseCost;
};

/** Mark a free action as used for this week (resets on week end). */
export const markFreeActionUsed = (state: GameState, action: string): GameState => {
  const archetype = state.founder.archetype;
  if (!archetype) return state;
  const freeKey = `${archetype}-free-${action}`;
  if (state.freeActionUsed[freeKey]) return state;

  // Only mark if this archetype actually has a free perk for this action
  const hasPerk =
    (archetype === "hacker" && action === "ship") ||
    (archetype === "sales-animal" && action === "pitch") ||
    (archetype === "visionary" && action === "launch");
  if (!hasPerk) return state;

  return { ...state, freeActionUsed: { ...state.freeActionUsed, [freeKey]: true } };
};
