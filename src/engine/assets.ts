import type { AssetId, CompanyPhase } from "../types/game";

export interface AssetDefinition {
  id: AssetId;
  name: string;
  cost: number;
  maintenanceCost: number;
  description: string;
  flavorText: string;
  minPhase: CompanyPhase;
  effects: {
    overheadReduction?: number;
    moraleBoost?: number;
    pitchSuccessBonus?: number;
    vcReputationBonus?: number;
    boardConfidenceBonus?: number;
  };
}

const PHASE_ORDER: CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];

export const phaseAtLeast = (current: CompanyPhase, required: CompanyPhase): boolean =>
  PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(required);

export const ASSET_CATALOG: Record<AssetId, AssetDefinition> = {
  "office-upgrade": {
    id: "office-upgrade",
    name: "Office Upgrade",
    cost: 50_000,
    maintenanceCost: 1_000,
    description: "Standing desks, espresso machine, and walls that aren't drywall.",
    flavorText: "The office is now a place people want to be. Overhead drops slightly.",
    minPhase: "coworking",
    effects: {
      overheadReduction: 0.08,
      moraleBoost: 2,
    },
  },
  lounge: {
    id: "lounge",
    name: "Executive Lounge",
    cost: 100_000,
    maintenanceCost: 2_500,
    description: "Leather chairs, single-malt, and a view. For 'strategic thinking.'",
    flavorText: "Morale jumps. Productivity... TBD.",
    minPhase: "office",
    effects: {
      moraleBoost: 4,
      boardConfidenceBonus: 3,
    },
  },
  helicopter: {
    id: "helicopter",
    name: "Company Helicopter",
    cost: 500_000,
    maintenanceCost: 8_000,
    description: "Skip traffic. Arrive with authority. Leave before the board asks questions.",
    flavorText: "The helicopter is a statement. VCs notice.",
    minPhase: "office",
    effects: {
      pitchSuccessBonus: 0.04,
      vcReputationBonus: 5,
    },
  },
  jet: {
    id: "jet",
    name: "Private Jet",
    cost: 2_000_000,
    maintenanceCost: 25_000,
    description: "Sand Hill Road to board meetings to yacht parties. The holy triangle.",
    flavorText: "You have arrived. Literally and figuratively.",
    minPhase: "unicorn",
    effects: {
      pitchSuccessBonus: 0.06,
      vcReputationBonus: 8,
      boardConfidenceBonus: 5,
    },
  },
  yacht: {
    id: "yacht",
    name: "Company Yacht",
    cost: 5_000_000,
    maintenanceCost: 50_000,
    description: "For 'team offsites' and 'investor dinners'. Definitely not a vanity purchase.",
    flavorText: "Board confidence soars. So does your burn rate.",
    minPhase: "unicorn",
    effects: {
      moraleBoost: 6,
      boardConfidenceBonus: 8,
      vcReputationBonus: 4,
    },
  },
};

export const ALL_ASSET_IDS: AssetId[] = Object.keys(ASSET_CATALOG) as AssetId[];
