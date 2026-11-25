// A one-quarter projection for one company, from what that company can see. The planning panel
// uses it for "projected end-of-quarter cash" and the CPU planner uses it to compare plans.
//
// Everything a company controls is computed with the engine's own formulas, so it is exact. What
// depends on rivals (how the pool is split, how many candidates are left) is an estimate built
// from public information only.

import { CONFIG } from "../config";
import { heldCeiling, marketTurn, rulesForTurn } from "./career";
import {
  churnRate,
  clamp,
  departmentWork,
  effectiveWork,
  hiringCapacity,
  newUsersForTurn,
  nextQuality,
  poachChance,
  pullOf,
  qualityGain,
  raiseAmount,
  revenueOf,
  round4,
  round6,
  runwayOf,
  valuationOf,
} from "./formulas";
import { handOutCandidates } from "./hiring";
import { normalizePlanFor } from "./plan";
import type { CompanyReport, CompanyView, CostBreakdown, Plan, PublicCompany, RulesConfig } from "./types";

/** What the rivals are expected to do to this turn's market. */
export interface RivalEstimate {
  /** Their combined pull. */
  readonly pull: number;
  /** Their combined churned users, which join the pool. */
  readonly churn: number;
}

export interface Projection {
  /** The plan as the engine would resolve it. */
  readonly plan: Plan;
  readonly notes: readonly string[];
  readonly work: CompanyReport["work"];
  readonly raise: CompanyReport["raise"];
  readonly equity: number;
  readonly investorSeats: number;
  readonly quality: number;
  readonly launched: boolean;
  readonly launchedNow: boolean;
  readonly pull: number;
  /** Expected pool, and this company's expected share of it (0–1). */
  readonly pool: number;
  readonly share: number;
  readonly usersChurned: number;
  readonly usersWon: number;
  readonly users: number;
  readonly revenue: number;
  /** Hiring is costed for every hire wanted, so cash errs on the low side. */
  readonly costs: CostBreakdown;
  readonly cash: number;
  /** Cash if it wins no users at all this quarter and makes every hire it wants: it cannot end lower. */
  readonly cashFloor: number;
  readonly profitable: boolean;
  readonly runway: number | null;
  readonly hype: number;
  readonly valuation: number;
  readonly hiresWanted: number;
  /** Hires it can expect given who is ahead in the hype order. */
  readonly hires: number;
  /** Team size next turn, not counting a poach that may or may not work. */
  readonly headcount: number;
  /** Odds of the planned poach, or null if none is planned. */
  readonly poachChance: number | null;
  /** Chance the board fires the founder at the end of this turn. */
  readonly boardRisk: number;
}

const inPlay = (rival: PublicCompany): boolean => rival.out === null && rival.launched;

/** The quality a rival closed last year with: in a career it is public, and a card may have cut it since. */
const closedQuality = (rival: PublicCompany): number => rival.career?.qualityAtLastClose ?? rival.quality;

/**
 * Where a rival's quality is heading if it keeps building as it did last quarter, from the quality it has now. Its
 * gain last quarter is read from the quality it closed with. In a year with a ceiling that holds, no higher than that.
 */
const nextQualityGuess = (rival: PublicCompany, ceiling: number | null, rules: RulesConfig): number => {
  const last = rival.lastQuarter;
  let heading = rival.quality;
  if (last !== null && last.qualityAtOpen < 100) {
    const lastGain = closedQuality(rival) - last.qualityAtOpen + rules.quality.decay;
    const gain = Math.max(0, lastGain) * ((100 - rival.quality) / (100 - last.qualityAtOpen));
    heading = clamp(rival.quality + gain - rules.quality.decay, 0, 100);
  }
  return ceiling === null ? heading : Math.min(heading, ceiling);
};

/**
 * Rivals' pull and churn this turn, from public information. Once this company has a quarter of
 * its own in the market, each rival's pull last quarter follows from the users it won (the pool is
 * split in proportion to pull), and is then carried forward along the rival's public quality and
 * hype trend: from the quality it closed with to where its quality is heading. Before that, or for a rival that
 * closed at 0, a rival's pull is a guess from its public stats.
 */
export const estimateRivals = (view: CompanyView, config: RulesConfig = CONFIG): RivalEstimate => {
  const rules = rulesForTurn(config, view.turn);
  const ceiling = heldCeiling(view.event, config);
  const { self } = view;
  const pullPerUserWon = self.lastPull !== null && self.lastQuarter !== null && self.lastQuarter.usersWon > 0 ? self.lastPull / self.lastQuarter.usersWon : null;
  let pull = 0;
  let churn = 0;
  for (const rival of view.rivals) {
    if (rival.out !== null) continue;
    const guessFrom = (quality: number): number =>
      quality * rules.projection.rivalPullGuess * rules.priceTiers[rival.price].pullFactor * (1 + rival.hype / 100);
    if (!rival.launched) {
      // Not in the market yet, but it will be if its product keeps improving at this rate.
      const heading = nextQualityGuess(rival, ceiling, rules);
      if (heading >= rules.quality.launchAt) pull += guessFrom(heading);
      continue;
    }
    churn += Math.min(rival.users, Math.round(rival.users * churnRate(rival.quality, rival.price, rules)));
    const last = rival.lastQuarter;
    const closed = closedQuality(rival);
    if (pullPerUserWon !== null && last !== null && closed > 0) {
      const lastPull = pullPerUserWon * last.usersWon;
      const qualityTrend = nextQualityGuess(rival, ceiling, rules) / closed;
      const hypeTrend = (1 + rival.hype / 100) / (1 + last.hypeAtOpen / 100);
      pull += lastPull * qualityTrend * hypeTrend;
    } else {
      pull += guessFrom(rival.quality);
    }
  }
  return { pull, churn };
};

/** Hires this company can expect: the real hand-out, with every rival assumed to want a few and to win ties. */
const expectedHires = (view: CompanyView, wanted: number, layoffs: number, rules: RulesConfig): number => {
  const candidates = rules.hiring.candidatesPerTurn + view.modifiers.extraCandidates + view.freedPeople + layoffs;
  const bids = [
    { id: view.self.id, hype: view.self.hype, tieKey: 1, wanted },
    ...view.rivals.filter((rival) => rival.out === null).map((rival) => ({ id: rival.id, hype: rival.hype, tieKey: 0, wanted: rules.projection.rivalHireGuess })),
  ];
  return handOutCandidates(candidates, bids).hired[view.self.id] ?? 0;
};

export const projectTurn = (
  view: CompanyView,
  plan: Plan | null,
  config: RulesConfig = CONFIG,
  rivals: RivalEstimate = estimateRivals(view, config),
): Projection => {
  const rules = rulesForTurn(config, view.turn);
  const { self } = view;
  const checked = normalizePlanFor(self, view.turn, view.rivals, plan, rules);
  const resolved = checked.plan;
  const archetype = rules.archetypes[self.archetype];
  const payroll = self.headcount - resolved.layoffs;

  let raise: Projection["raise"] = null;
  if (resolved.raisePercent > 0) {
    const valuation = valuationOf(self.users, self.hype, view.climate.multiplier, rules);
    raise = { percent: resolved.raisePercent, valuation, amount: raiseAmount(valuation, resolved.raisePercent) };
  }
  const equity = raise ? round6(self.founderEquity * (1 - raise.percent / 100)) : self.founderEquity;
  const investorSeats = self.investorSeats + (raise ? 1 : 0);

  const effective = effectiveWork(payroll, archetype.workExponent);
  const work = {
    effective,
    product: departmentWork(effective, resolved.allocation.product, payroll),
    growth: departmentWork(effective, resolved.allocation.growth, payroll),
    recruiting: departmentWork(effective, resolved.allocation.recruiting, payroll),
  };

  const rivalQualities = view.rivals.filter(inPlay).map((rival) => rival.quality);
  const catchUp = archetype.catchUpMultiplier > 1 && rivalQualities.length > 0 && self.quality < Math.max(...rivalQualities);
  const built = nextQuality(self.quality, qualityGain(self.quality, work.product, catchUp ? archetype.catchUpMultiplier : 1, rules), rules);
  // In a career, a ceiling that holds through the year caps the quality Product work reaches, as in the turn.
  const ceiling = heldCeiling(view.event, config);
  const quality = ceiling === null ? built : Math.min(built, ceiling);
  const launchedNow = !self.launched && quality >= rules.quality.launchAt;
  const launched = self.launched || launchedNow;

  const pull = launched
    ? pullOf({ quality, growthWork: work.growth, marketing: resolved.marketing, tier: resolved.price, hype: self.hype, marketingModifier: view.modifiers.marketing }, rules)
    : 0;
  const usersChurned = launched ? Math.min(self.users, Math.round(self.users * churnRate(quality, resolved.price, rules))) : 0;
  const newUsers = newUsersForTurn(marketTurn(config, view.turn), view.modifiers.newUsers * (view.wave?.multiplier ?? 1), rules);
  const pool = newUsers + view.carryOverUsers + usersChurned + rivals.churn;
  const share = pull > 0 ? pull / (pull + rivals.pull) : 0;
  const usersWon = Math.round(pool * share);
  const users = self.users - usersChurned + usersWon;

  const target = resolved.poachTarget === null ? undefined : view.rivals.find((rival) => rival.id === resolved.poachTarget);
  const odds = target === undefined ? null : poachChance(self.hype, target.hype, rules);

  const hiresWanted = Math.min(hiringCapacity(work.recruiting, rules), resolved.hireLimit ?? Number.MAX_SAFE_INTEGER);
  const hires = expectedHires(view, hiresWanted, resolved.layoffs, rules);

  const revenue = revenueOf(users, resolved.price, rules);
  const salaries = payroll * rules.salary;
  const hiring = hiresWanted * rules.hiring.fee;
  const poaching = odds === null ? 0 : rules.poach.cost;
  const severance = resolved.layoffs * rules.layoff.severance;
  const costs: CostBreakdown = { salaries, marketing: resolved.marketing, hiring, poaching, severance, total: salaries + resolved.marketing + hiring + poaching + severance };
  const cash = self.cash + (raise?.amount ?? 0) + revenue - costs.total;
  const runway = runwayOf(cash, revenue, costs.total);

  const grew = self.usersAtLastClose > 0 && users >= self.usersAtLastClose * (1 + rules.hype.growthThreshold);
  const hype = round4(
    clamp(
      self.hype * (1 - rules.hype.decay) +
        (launchedNow ? rules.hype.launch : 0) +
        (raise ? rules.hype.raise : 0) +
        (grew ? rules.hype.growth : 0) +
        (resolved.layoffs > 0 ? rules.layoff.hype : 0),
      0,
      100,
    ),
  );

  const badQuarter = users < self.usersAtLastClose || (runway !== null && runway < rules.board.runwayTurns);
  const boardRisk = investorSeats > self.founderSeats && badQuarter ? rules.board.fireChance : 0;

  return {
    plan: resolved,
    notes: checked.notes,
    work,
    raise,
    equity,
    investorSeats,
    quality,
    launched,
    launchedNow,
    pull,
    pool,
    share,
    usersChurned,
    usersWon,
    users,
    revenue,
    costs,
    cash,
    cashFloor: self.cash + (raise?.amount ?? 0) + revenueOf(self.users - usersChurned, resolved.price, rules) - costs.total,
    profitable: revenue >= costs.total,
    runway,
    hype,
    valuation: valuationOf(users, hype, view.climate.multiplier, rules),
    hiresWanted,
    hires,
    headcount: payroll + hires,
    poachChance: odds,
    boardRisk,
  };
};
