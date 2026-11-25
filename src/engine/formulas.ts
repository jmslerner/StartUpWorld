// The rules as formulas: pure functions of numbers, with every constant read from the config.
// Each one is a line of the design (docs/turn-based-design.md, "Rules").

import type { Allocation, PriceTier, RulesConfig } from "./types";

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const roundTo = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** Stored quality and hype keep four decimals, so saves and replays stay tidy. */
export const round4 = (value: number): number => roundTo(value, 4);

/** Founder equity keeps six. */
export const round6 = (value: number): number => roundTo(value, 6);

/**
 * Coordination drag: effective work = headcount ^ exponent. Rounded to six decimals because
 * Math.pow may differ in the last bit between JavaScript engines, and replays must not.
 */
export const effectiveWork = (payroll: number, exponent: number): number =>
  payroll <= 0 ? 0 : roundTo(Math.pow(payroll, exponent), 6);

/** A department's share of the effective work: its people over everyone on payroll. */
export const departmentWork = (effective: number, people: number, payroll: number): number =>
  payroll <= 0 ? 0 : (effective * people) / payroll;

/** Quality gained this turn, before the decay. `catchUp` is 1 unless the catch-up bonus applies. */
export const qualityGain = (quality: number, productWork: number, catchUp: number, config: RulesConfig): number =>
  config.quality.gainPerWork * productWork * (1 - quality / 100) * catchUp;

/** Gain, then decay, then clamp to 0–100. */
export const nextQuality = (quality: number, gain: number, config: RulesConfig): number =>
  round4(clamp(quality + gain - config.quality.decay, 0, 100));

/** Share of users lost this turn. */
export const churnRate = (quality: number, tier: PriceTier, config: RulesConfig): number =>
  Math.max(config.churn.min, config.churn.base - config.churn.perQualityPoint * quality + config.priceTiers[tier].churnDelta);

export interface PullInputs {
  readonly quality: number;
  readonly growthWork: number;
  readonly marketing: number;
  readonly tier: PriceTier;
  readonly hype: number;
  /** 1 normally; 0.5 when ad prices spike. */
  readonly marketingModifier: number;
}

/** What a marketing spend adds to pull, as a share: each extra dollar does less, and this turn's event may scale it. */
export const marketingPull = (marketing: number, modifier: number, config: RulesConfig): number =>
  config.pull.marketingCoefficient * Math.sqrt(Math.max(0, marketing) / config.pull.marketingStep) * modifier;

/** How strongly a launched company attracts users from the pool. */
export const pullOf = (inputs: PullInputs, config: RulesConfig): number => {
  const growth = config.pull.growthCoefficient * inputs.growthWork;
  const marketing = marketingPull(inputs.marketing, inputs.marketingModifier, config);
  return inputs.quality * (1 + growth + marketing) * config.priceTiers[inputs.tier].pullFactor * (1 + inputs.hype / 100);
};

/** In whole dollars. */
export const valuationOf = (users: number, hype: number, climateMultiplier: number, config: RulesConfig): number =>
  Math.round(users * config.valuation.perUser * (1 + hype / 100) * climateMultiplier);

export const raiseAmount = (valuation: number, percent: number): number => Math.round((valuation * percent) / 100);

/** What decides a game that reaches the turn limit. */
export const founderStake = (founderEquity: number, valuation: number): number => Math.round(founderEquity * valuation);

/** Turns of cash left at this burn, never below 0; null when the quarter was profitable (no limit). */
export const runwayOf = (cash: number, revenue: number, costs: number): number | null => {
  const burn = costs - revenue;
  return burn > 0 ? Math.max(0, cash) / burn : null;
};

export const hiringCapacity = (recruitingWork: number, config: RulesConfig): number =>
  Math.max(0, Math.round(config.hiring.capacityPerWork * recruitingWork));

export const poachChance = (myHype: number, theirHype: number, config: RulesConfig): number =>
  clamp(config.poach.baseChance + (myHype - theirHype) * config.poach.chancePerHypePoint, config.poach.minChance, config.poach.maxChance);

/** New users arriving in a turn, times the event multiplier (1 normally). */
export const newUsersForTurn = (turn: number, multiplier: number, config: RulesConfig): number =>
  Math.round(config.market.newUsersTurn1 * Math.pow(1 + config.market.growthPerTurn, turn - 1) * multiplier);

/**
 * Split a whole number in proportion to weights, by largest remainder, so the parts always add up
 * to the total. Leftover units go to the largest remainders; ties go to the lower index. With no
 * positive weight nobody gets anything.
 */
export const splitByWeights = (total: number, weights: readonly number[]): number[] => {
  const usable = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = usable.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return usable.map(() => 0);
  const exact = usable.map((w) => (total * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let leftover = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, index) => ({ index, remainder: x - Math.floor(x) }))
    .sort((a, b) => (Math.abs(a.remainder - b.remainder) < 1e-9 ? a.index - b.index : b.remainder - a.remainder));
  for (const { index } of order) {
    if (leftover <= 0) break;
    if (usable[index] <= 0) continue;
    parts[index] += 1;
    leftover -= 1;
  }
  return parts;
};

/** Fit a team split to the people available, keeping its proportions; with nothing to scale, everyone builds. */
export const refitAllocation = (allocation: Allocation, available: number): Allocation => {
  const people = Math.max(0, Math.floor(available));
  const clean = [allocation.product, allocation.growth, allocation.recruiting].map((n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
  if (people === 0) return { product: 0, growth: 0, recruiting: 0 };
  if (clean.reduce((a, b) => a + b, 0) === 0) return { product: people, growth: 0, recruiting: 0 };
  const [product, growth, recruiting] = splitByWeights(people, clean);
  return { product, growth, recruiting };
};
