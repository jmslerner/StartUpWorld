// The computer players. Each turn a CPU builds a few dozen candidate plans, projects each one
// quarter ahead from what it can see (its own company in full, rivals in public), scores the
// projections with its personality's weights, and takes the best, with a little seeded noise.
//
// A personality is fixed habits plus weights. The habits (which price, when it raises, whether it
// poaches, how big it lets the team get) are what a player can learn to read.

import { CONFIG, type GameConfig } from "../config";
import { raiseAmount, valuationOf } from "../engine/formulas";
import { raiseBlocker } from "../engine/plan";
import { estimateRivals, projectTurn, type Projection } from "../engine/project";
import { STREAM, nextFloat01, streamSeed } from "../engine/rng";
import type { Allocation, CompanyView, CpuKind, Plan, PublicCompany } from "../engine/types";
import { companyRunway } from "../engine/view";
import type { CpuPersonality } from "./types";

interface Situation {
  /** Runway as the turn starts. */
  readonly runway: number | null;
  /** Past the user bar: cut costs to turn a profit and list. */
  readonly ipoPush: boolean;
  /** Less than a turn or so of cash: layoffs are on the table. */
  readonly trouble: boolean;
}

const situationOf = (view: CompanyView, config: GameConfig): Situation => {
  const runway = companyRunway(view.self, config);
  return {
    runway,
    ipoPush: view.self.users >= config.ipo.users,
    trouble: runway !== null && runway < config.cpu.layoffRunway,
  };
};

const unique = (values: readonly number[]): number[] => [...new Set(values)];

/** The raise sizes to consider this turn. A lone 0 means no raise; no 0 at all means it must raise. */
const raiseOptions = (view: CompanyView, personality: CpuPersonality, situation: Situation, config: GameConfig): number[] => {
  if (raiseBlocker(view.self, view.turn, config) !== null) return [0];
  const sizes = personality.raise.percents.filter((percent) => config.raise.options.includes(percent));
  if (sizes.length === 0) return [0];
  if (personality.raise.when === "eligible") return sizes;
  return situation.runway !== null && situation.runway < personality.raise.runway ? sizes : [0];
};

const layoffOptions = (view: CompanyView, situation: Situation): number[] => {
  const headcount = view.self.headcount;
  const most = headcount - 1;
  if (most <= 0) return [0];
  if (situation.ipoPush) return unique([0, 1, 2, 3, 5, 8, 12, 16, 20, 25, 30].filter((n) => n <= most));
  if (situation.trouble) return unique([0, 1, 2, Math.round(headcount / 3), Math.round(headcount / 2), Math.round((2 * headcount) / 3), most].filter((n) => n <= most));
  return [0];
};

/** The base candidates: every combination of raise, layoffs, recruiters, team mix and marketing the personality allows. */
export const candidatePlans = (view: CompanyView, kind: CpuKind, config: GameConfig = CONFIG): Plan[] => {
  const { self } = view;
  const personality = config.cpu.personalities[kind];
  const situation = situationOf(view, config);
  const cautious = situation.ipoPush || situation.trouble;
  const step = config.pull.marketingStep;
  const productShares = self.launched ? personality.productShares : unique([1, ...personality.productShares]);

  const plans: Plan[] = [];
  const seen = new Set<string>();
  for (const raisePercent of raiseOptions(view, personality, situation, config)) {
    const raised = raisePercent > 0 ? raiseAmount(valuationOf(self.users, self.hype, view.climate.multiplier, config), raisePercent) : 0;
    const spendable = Math.max(0, self.cash + raised);
    const marketingLevels = cautious
      ? [0]
      : unique(personality.marketingShares.map((share) => Math.min(config.pull.maxMarketing, Math.floor((share * spendable) / step) * step)));

    for (const layoffs of layoffOptions(view, situation)) {
      const available = self.headcount - layoffs - (raisePercent > 0 ? 1 : 0);
      const roomToHire = personality.teamCap - (self.headcount - layoffs);
      const mayHire = !cautious && layoffs === 0 && roomToHire > 0;
      const recruiterOptions = mayHire ? (available >= 8 ? [0, 1, 2] : [0, 1]) : [0];

      for (const recruiting of recruiterOptions) {
        const builders = available - recruiting;
        if (builders < 0) continue;
        for (const share of productShares) {
          const product = Math.min(builders, Math.max(0, Math.round(share * builders)));
          const allocation: Allocation = { product, growth: builders - product, recruiting };
          for (const marketing of marketingLevels) {
            const plan: Plan = {
              allocation,
              marketing,
              price: personality.price,
              raisePercent,
              poachTarget: null,
              layoffs,
              hireLimit: recruiting > 0 ? roomToHire : 0,
            };
            const key = JSON.stringify(plan);
            if (seen.has(key)) continue;
            seen.add(key);
            plans.push(plan);
          }
        }
      }
    }
  }
  return plans;
};

/** Runway after this quarter, at next quarter's payroll and the same marketing. */
const runwayAfter = (projection: Projection, config: GameConfig): number | null => {
  const nextBurn = projection.headcount * config.salary + projection.plan.marketing - projection.revenue;
  return nextBurn > 0 ? projection.cash / nextBurn : null;
};

const scoreOf = (view: CompanyView, projection: Projection, personality: CpuPersonality, situation: Situation, config: GameConfig): number => {
  const { self } = view;
  // A plan that ends below $0 is bankruptcy: anything else beats it, and among such plans the least bad wins.
  if (projection.cash < 0) return -1_000 + projection.cash / 1_000_000;

  const weights = personality.weights;
  const horizon = Math.min(personality.horizon, Math.max(0, config.game.maxTurns - view.turn));
  // What a relative gain in pull is worth per turn, as a share of the pool: s × (1 − s).
  const leverage = Math.max(projection.share * (1 - projection.share), config.cpu.minShareForGrowth);

  let score = (weights.users * (projection.users - self.users)) / Math.max(1, projection.pool);

  const built = projection.quality - self.quality;
  score += projection.launched
    ? (weights.quality * horizon * leverage * built) / Math.max(projection.quality, config.quality.launchAt)
    : (weights.quality * built) / config.quality.launchAt;
  if (projection.launchedNow) score += weights.quality;

  const exponent = config.archetypes[self.archetype].workExponent;
  const work = (people: number): number => Math.pow(Math.max(1, people), exponent);
  score += (weights.team * 0.5 * horizon * leverage * (work(projection.headcount) - work(self.headcount))) / work(self.headcount);

  const runway = runwayAfter(projection, config);
  score += weights.runway * (runway === null ? 1 : runway / (runway + weights.runwayHalf));
  if (runway !== null && runway < 1) score -= config.cpu.shortRunwayPenalty * (1 - runway);

  score += (weights.hype * projection.hype) / 100;
  score += weights.equity * projection.equity;
  score -= config.cpu.boardRiskPenalty * projection.boardRisk;

  const listed = projection.users >= config.ipo.users && projection.profitable;
  if (listed) {
    score += config.cpu.ipo.win;
  } else if (situation.ipoPush) {
    const revenue = Math.max(1, projection.revenue);
    const nextCosts = projection.headcount * config.salary + projection.plan.marketing;
    score += config.cpu.ipo.deficit * Math.min(0, (projection.revenue - projection.costs.total) / revenue);
    score += config.cpu.ipo.nextDeficit * Math.min(0, (projection.revenue - nextCosts) / revenue);
    score -= (config.cpu.ipo.usersShortfall * Math.max(0, config.ipo.users - projection.users)) / config.ipo.users;
  }
  return score;
};

/** Who the Incumbent goes after: the rival with the most users that is big enough to lose someone. */
const poachTargetFor = (view: CompanyView, config: GameConfig): PublicCompany | null => {
  const open = view.rivals.filter((rival) => rival.out === null && rival.headcount >= config.poach.minTargetHeadcount);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => b.users - a.users || b.quality - a.quality || a.id - b.id)[0];
};

export const chooseCpuPlan = (view: CompanyView, kind: CpuKind, seed: number, config: GameConfig = CONFIG): Plan => {
  const personality = config.cpu.personalities[kind];
  const situation = situationOf(view, config);
  const rivals = estimateRivals(view, config);
  const target = personality.poachRunway !== null && !situation.ipoPush && !situation.trouble ? poachTargetFor(view, config) : null;

  let noise = streamSeed(seed, view.turn, STREAM.cpuNoise, view.self.id);
  let best: Plan | null = null;
  let bestScore = -Infinity;
  let fallback: Plan | null = null;
  let fallbackScore = -Infinity;

  for (const base of candidatePlans(view, kind, config)) {
    let plan = base;
    let projection = projectTurn(view, plan, config, rivals);

    // The habit: poach whenever it can afford to.
    if (target !== null && personality.poachRunway !== null) {
      const poaching = { ...base, poachTarget: target.id };
      const withPoach = projectTurn(view, poaching, config, rivals);
      const runway = runwayAfter(withPoach, config);
      if (withPoach.cash >= 0 && (runway === null || runway >= personality.poachRunway)) {
        plan = poaching;
        projection = withPoach;
      }
    }

    const draw = nextFloat01(noise);
    noise = draw.rng;
    const score = scoreOf(view, projection, personality, situation, config) + config.cpu.noise * (draw.value - 0.5);

    // The habit: recruit only while the runway allows. Such plans are kept as a fallback only.
    const runway = runwayAfter(projection, config);
    const overHiring = projection.hiresWanted > 0 && runway !== null && runway < personality.hireRunway;
    if (overHiring) {
      if (score > fallbackScore) {
        fallback = plan;
        fallbackScore = score;
      }
      continue;
    }
    if (score > bestScore) {
      best = plan;
      bestScore = score;
    }
  }

  const chosen = best ?? fallback;
  if (chosen === null) throw new Error("A CPU had no plan to choose from.");
  return chosen;
};
