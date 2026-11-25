// The computer players. Each turn a CPU builds a few dozen candidate plans, projects each one
// quarter ahead from what it can see (its own company in full, rivals in public), scores the
// projections with its personality's weights, and takes the best, with a little seeded noise.
//
// A personality is fixed habits plus weights. The habits (which price, when it raises, whether it
// poaches, how big it lets the team get) are what a player can learn to read.
//
// Every number, the personalities included, is read from the numbers of the turn being planned: the config itself
// in a race, the config with the year's era laid over it in a career. What a career changes in the planner is
// marked "In a career" below; a race plays none of it.

import { CONFIG, type PlayConfig } from "../config";
import { listingBlocker, listingOf, rulesForTurn, upcomingShift, type ShiftNotice } from "../engine/career";
import { founderStake, poachFloor, raiseAmount, valuationOf } from "../engine/formulas";
import { raiseBlocker } from "../engine/plan";
import { estimateRivals, projectTurn, type Projection } from "../engine/project";
import { STREAM, nextFloat01, nextIntInclusive, streamSeed } from "../engine/rng";
import type { Allocation, CompanyView, CpuKind, Plan, PublicCompany } from "../engine/types";
import { companyRunway } from "../engine/view";
import type { CpuPersonality } from "./types";

interface Situation {
  /** Runway as the turn starts. */
  readonly runway: number | null;
  /**
   * Past the user bar: cut costs to turn a profit and list. In a career, only while a profitable year at the bar is
   * all the company still needs before it may list, and never in the final year.
   */
  readonly ipoPush: boolean;
  /** Less than a turn or so of cash: layoffs are on the table. */
  readonly trouble: boolean;
  /** The game ends this turn: only the founder's stake counts, and there is nothing to save for. */
  readonly lastTurn: boolean;
  /**
   * A turn that closes at the user bar with a profit takes the prize `cpu.ipo.win`. Always in a race, where it wins
   * the game. In a career only for a company that has not qualified to list yet, and never in the final year, when
   * qualifying buys nothing.
   */
  readonly prizeAtBar: boolean;
  /** In a career: the company goes public this year, the first in which it may. Never in a race. */
  readonly goPublic: boolean;
  /** In a career: the platform shift announced for the years ahead, if there is one. Never in a race. */
  readonly shift: ShiftNotice | null;
}

const situationOf = (view: CompanyView, rules: PlayConfig): Situation => {
  const { self, turn } = view;
  const runway = companyRunway(self, rules);
  const trouble = runway !== null && runway < rules.cpu.layoffRunway;
  const lastTurn = turn >= rules.game.maxTurns;
  if (rules.career === undefined) {
    return { runway, ipoPush: self.users >= rules.ipo.users, trouble, lastTurn, prizeAtBar: true, goPublic: false, shift: null };
  }
  // In a career the bar ends nothing: a profitable year there qualifies a company to list, once.
  const blocker = listingBlocker(self, turn, rules);
  const yetToQualify = blocker === "users" || blocker === "profit";
  return {
    runway,
    ipoPush: blocker === "profit" && !lastTurn,
    trouble,
    lastTurn,
    prizeAtBar: yetToQualify && !lastTurn,
    goPublic: blocker === null,
    shift: upcomingShift(turn, rules),
  };
};

const unique = (values: readonly number[]): number[] => [...new Set(values)];

/** The raise sizes to consider this turn. A lone 0 means no raise; no 0 at all means it must raise. */
const raiseOptions = (view: CompanyView, personality: CpuPersonality, situation: Situation, rules: PlayConfig): number[] => {
  if (raiseBlocker(view.self, view.turn, rules) !== null) return [0];
  // In a career, no raise in the year it goes public: the rules would drop it, and the person set aside to raise
  // would sit idle.
  if (situation.goPublic) return [0];
  const sizes = personality.raise.percents.filter((percent) => rules.raise.options.includes(percent));
  if (sizes.length === 0) return [0];
  if (personality.raise.when === "eligible") return sizes;
  return situation.runway !== null && situation.runway < personality.raise.runway ? sizes : [0];
};

const layoffOptions = (view: CompanyView, situation: Situation, rules: PlayConfig): number[] => {
  const headcount = view.self.headcount;
  const most = headcount - 1;
  if (most <= 0) return [0];
  if (situation.ipoPush) return unique(rules.cpu.ipoPushLayoffs.filter((n) => n <= most));
  if (situation.trouble) {
    // In a career a company short of cash keeps two people at least: a team of one cannot both raise and work.
    const mostInTrouble = rules.career === undefined ? most : most - 1;
    const { counts, shares } = rules.cpu.troubleLayoffs;
    return unique([...counts, ...shares.map((share) => Math.min(mostInTrouble, Math.round(share * headcount)))].filter((n) => n <= mostInTrouble));
  }
  return [0];
};

/** The base candidates: every combination of raise, layoffs, recruiters, team mix and marketing the personality allows. */
export const candidatePlans = (view: CompanyView, kind: CpuKind, config: PlayConfig = CONFIG): Plan[] => {
  const rules = rulesForTurn(config, view.turn);
  const inCareer = rules.career !== undefined;
  const { self } = view;
  const personality = rules.cpu.personalities[kind];
  const situation = situationOf(view, rules);
  const cautious = situation.ipoPush || situation.trouble;
  const step = rules.pull.marketingStep;
  const productShares = self.launched ? personality.productShares : unique([1, ...personality.productShares]);
  const marketingShares = situation.lastTurn && !cautious ? rules.cpu.lastTurnMarketingShares : cautious ? [0] : personality.marketingShares;
  const recruiters = rules.cpu.recruiters;

  const plans: Plan[] = [];
  const seen = new Set<string>();
  for (const raiseOption of raiseOptions(view, personality, situation, rules)) {
    for (const layoffs of layoffOptions(view, situation, rules)) {
      // In a career nobody is sent to raise when that would leave nobody working.
      const raisePercent = inCareer && self.headcount - layoffs === 1 ? 0 : raiseOption;
      // The cash this turn's funding brings: the raise, or in a career the listing in the year it goes public.
      const proceeds = situation.goPublic
        ? listingOf(self, view.climate.multiplier, rules).amount
        : raisePercent > 0
          ? raiseAmount(valuationOf(self.users, self.hype, view.climate.multiplier, rules), raisePercent)
          : 0;
      const spendable = Math.max(0, self.cash + proceeds);
      const marketingLevels = unique(marketingShares.map((share) => Math.min(rules.pull.maxMarketing, Math.floor((share * spendable) / step) * step)));

      const available = self.headcount - layoffs - (raisePercent > 0 ? 1 : 0);
      const roomToHire = personality.teamCap - (self.headcount - layoffs);
      const mayHire = !cautious && !situation.lastTurn && layoffs === 0 && roomToHire > 0;
      const headCounts = available >= recruiters.manyFrom ? recruiters.many : recruiters.few;
      // In a career whose config gives shares, those shares of the people free to assign are weighed as well.
      const byShare = inCareer && recruiters.shares !== undefined ? recruiters.shares.map((share) => Math.round(share * available)) : [];
      const recruiterOptions = !mayHire ? [0] : byShare.length === 0 ? headCounts : unique([...headCounts, ...byShare]);

      for (const recruiting of recruiterOptions) {
        const builders = available - recruiting;
        if (builders < 0) continue;
        for (const share of productShares) {
          const product = Math.min(builders, Math.max(0, Math.round(share * builders)));
          const allocation: Allocation = { product, growth: builders - product, recruiting };
          for (const marketing of marketingLevels) {
            const base: Plan = {
              allocation,
              marketing,
              price: personality.price,
              raisePercent,
              poachTarget: null,
              layoffs,
              hireLimit: recruiting > 0 ? roomToHire : 0,
            };
            // A career plan always says whether the company goes public, as its last key. A race plan has no such key.
            const plan: Plan = inCareer ? { ...base, goPublic: situation.goPublic } : base;
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
const runwayAfter = (projection: Projection, rules: PlayConfig): number | null => {
  const nextBurn = projection.headcount * rules.salary + projection.plan.marketing - projection.revenue;
  return nextBurn > 0 ? projection.cash / nextBurn : null;
};

const scoreOf = (view: CompanyView, projection: Projection, personality: CpuPersonality, situation: Situation, rules: PlayConfig): number => {
  const { self } = view;
  // A plan that ends below $0 is bankruptcy: anything else beats it, and among such plans the least bad wins.
  if (projection.cash < 0) return rules.cpu.bankruptScore + projection.cash / 1_000_000;

  const prize = situation.prizeAtBar && projection.users >= rules.ipo.users && projection.profitable;
  if (situation.lastTurn) {
    // No next quarter: what counts is the founder's stake, if the founder is still there to hold it.
    const stake = founderStake(projection.equity, projection.valuation) * (1 - projection.boardRisk);
    // Measured against the quarter's market; the outer floor only matters if users are worth $0 (every stake is then $0).
    return stake / Math.max(1, Math.max(1, projection.pool) * rules.valuation.perUser) + (prize ? rules.cpu.ipo.win : 0);
  }

  const weights = personality.weights;
  const horizon = Math.min(personality.horizon, Math.max(0, rules.game.maxTurns - view.turn));
  // In a career the planner reads the timeline: what a product gains above an announced shift's ceiling is lost
  // when the shift lands, so quality that ends the year above it is valued for no more years than the shift is away.
  const { shift } = situation;
  const qualityHorizon = shift !== null && projection.quality > shift.ceiling ? Math.min(horizon, shift.yearsAway) : horizon;
  // What a relative gain in pull is worth per turn, as a share of the pool: s × (1 − s).
  const leverage = Math.max(projection.share * (1 - projection.share), rules.cpu.minShareForGrowth);

  let score = (weights.users * (projection.users - self.users)) / Math.max(1, projection.pool);

  const built = projection.quality - self.quality;
  score += projection.launched
    ? (weights.quality * qualityHorizon * leverage * built) / Math.max(projection.quality, rules.quality.launchAt)
    : (weights.quality * built) / rules.quality.launchAt;
  if (projection.launchedNow) score += weights.quality;

  const exponent = rules.archetypes[self.archetype].workExponent;
  const work = (people: number): number => Math.pow(Math.max(1, people), exponent);
  score += (weights.team * rules.cpu.teamGrowthShare * horizon * leverage * (work(projection.headcount) - work(self.headcount))) / work(self.headcount);

  const runway = runwayAfter(projection, rules);
  score += weights.runway * (runway === null ? 1 : runway / (runway + weights.runwayHalf));
  if (runway !== null && runway < rules.cpu.shortRunwayTurns) score -= rules.cpu.shortRunwayPenalty * (1 - runway / rules.cpu.shortRunwayTurns);

  score += (weights.hype * projection.hype) / 100;
  score += weights.equity * projection.equity;
  score -= personality.boardRiskPenalty * projection.boardRisk;

  if (prize) {
    score += rules.cpu.ipo.win;
  } else if (situation.ipoPush) {
    const revenue = Math.max(1, projection.revenue);
    const nextCosts = projection.headcount * rules.salary + projection.plan.marketing;
    score += rules.cpu.ipo.deficit * Math.min(0, (projection.revenue - projection.costs.total) / revenue);
    score += rules.cpu.ipo.nextDeficit * Math.min(0, (projection.revenue - nextCosts) / revenue);
    score -= (rules.cpu.ipo.usersShortfall * Math.max(0, rules.ipo.users - projection.users)) / rules.ipo.users;
  }
  return score;
};

/**
 * Who the Incumbent goes after: the rival with the most users that is big enough to lose someone.
 * Rivals that are level (every startup on turn 1) are picked between by the game's seed, never by
 * where they sit: the player's seat must not be the one that always gets raided first.
 */
const poachTargetFor = (view: CompanyView, seed: number, rules: PlayConfig): PublicCompany | null => {
  const open = view.rivals.filter((rival) => rival.out === null && rival.headcount >= poachFloor(rules));
  if (open.length === 0) return null;
  const ranked = [...open].sort((a, b) => b.users - a.users || b.quality - a.quality || a.id - b.id);
  const level = ranked.filter((rival) => rival.users === ranked[0].users && rival.quality === ranked[0].quality);
  return level[nextIntInclusive(streamSeed(seed, view.turn, STREAM.poachTarget, view.self.id), 0, level.length - 1).value];
};

export const chooseCpuPlan = (view: CompanyView, kind: CpuKind, seed: number, config: PlayConfig = CONFIG): Plan => {
  const rules = rulesForTurn(config, view.turn);
  const personality = rules.cpu.personalities[kind];
  const situation = situationOf(view, rules);
  const rivals = estimateRivals(view, config);
  // No poach on the last turn: the person would only start in a quarter that is never played.
  const mayPoach = personality.poachRunway !== null && !situation.ipoPush && !situation.trouble && !situation.lastTurn;
  const target = mayPoach ? poachTargetFor(view, seed, rules) : null;

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
      const runway = runwayAfter(withPoach, rules);
      if (withPoach.cash >= 0 && (runway === null || runway >= personality.poachRunway)) {
        plan = poaching;
        projection = withPoach;
      }
    }

    const draw = nextFloat01(noise);
    noise = draw.rng;
    const score = scoreOf(view, projection, personality, situation, rules) + rules.cpu.noise * (draw.value - 0.5);

    // The habit: recruit only while the runway allows. Such plans are kept as a fallback only.
    const runway = runwayAfter(projection, rules);
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
