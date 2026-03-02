import type { PricingModel } from "../types/game";

export interface PricingModelConfig {
  label: string;
  arpuDefault: number;
  arpuMin: number;
  arpuMax: number;
  growthMult: number;
  churnMult: number;
  arpuDriftMult: number;
  valuationBonus: number;
  description: string;
}

export const PRICING_MODELS: Record<PricingModel, PricingModelConfig> = {
  consumer: {
    label: "Consumer (B2C)",
    arpuDefault: 5,
    arpuMin: 1,
    arpuMax: 25,
    growthMult: 1.6,
    churnMult: 1.4,
    arpuDriftMult: 0.5,
    valuationBonus: 0,
    description: "High volume, low price. Growth is fast but churn is brutal.",
  },
  prosumer: {
    label: "Prosumer (Default)",
    arpuDefault: 15,
    arpuMin: 2,
    arpuMax: 99,
    growthMult: 1.0,
    churnMult: 1.0,
    arpuDriftMult: 1.0,
    valuationBonus: 0,
    description: "Balanced model. Moderate growth, moderate churn.",
  },
  enterprise: {
    label: "Enterprise (B2B)",
    arpuDefault: 80,
    arpuMin: 30,
    arpuMax: 500,
    growthMult: 0.5,
    churnMult: 0.4,
    arpuDriftMult: 1.8,
    valuationBonus: 1.5,
    description: "Few customers, big contracts. Slow to grow but hard to kill.",
  },
};
