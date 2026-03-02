import type { Stage, TeamRole } from "../types/game";

/** Minimum stage required to hire each role. Omitted = available at garage. */
export const ROLE_MIN_STAGE: Partial<Record<TeamRole, Stage>> = {
  data: "seed",
  product: "series-a",
  executive: "growth",
};

export interface StagePerkConfig {
  apBonus: number; // +N max AP
  shipSuccessBonus: number; // flat added to ship success probability
  launchSuccessBonus: number;
  pitchSuccessBonus: number;
  overheadDiscount: number; // 0..1 fraction off stage overhead
  unlockMessages: string[]; // shown when entering this stage
}

/** Cumulative perks at each stage — later stages include earlier bonuses. */
export const STAGE_PERKS: Record<Stage, StagePerkConfig> = {
  garage: {
    apBonus: 0,
    shipSuccessBonus: 0,
    launchSuccessBonus: 0,
    pitchSuccessBonus: 0,
    overheadDiscount: 0,
    unlockMessages: [],
  },
  seed: {
    apBonus: 0,
    shipSuccessBonus: 0.03,
    launchSuccessBonus: 0,
    pitchSuccessBonus: 0,
    overheadDiscount: 0,
    unlockMessages: [
      "Stage perk: Ship success +3% (better processes).",
      "New role unlocked: `data` — analytics-driven retention.",
    ],
  },
  "series-a": {
    apBonus: 1,
    shipSuccessBonus: 0.03,
    launchSuccessBonus: 0.05,
    pitchSuccessBonus: 0,
    overheadDiscount: 0,
    unlockMessages: [
      "Stage perk: +1 max AP (organizational bandwidth).",
      "Stage perk: Launch success +5% (brand recognition).",
      "New role unlocked: `product` — boosts ship success.",
    ],
  },
  growth: {
    apBonus: 1,
    shipSuccessBonus: 0.03,
    launchSuccessBonus: 0.05,
    pitchSuccessBonus: 0.05,
    overheadDiscount: 0.2,
    unlockMessages: [
      "Stage perk: Pitch success +5% (market credibility).",
      "Stage perk: Overhead -20% (economies of scale).",
      "New role unlocked: `executive` — reduces overhead, boosts pitches.",
    ],
  },
};

const STAGE_ORDER: Stage[] = ["garage", "seed", "series-a", "growth"];

/** Check if a role can be hired at the current stage. */
export const canHireRole = (role: TeamRole, stage: Stage): boolean => {
  const minStage = ROLE_MIN_STAGE[role];
  if (!minStage) return true;
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(minStage);
};
