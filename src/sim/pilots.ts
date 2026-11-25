// Pilots: the baseline bot with one change each, put in the player's seat to look for loopholes in the career's rules
// (never going public, going public at the last moment, spending past its means until it is rescued) and to measure
// what one kind of play is worth (spending everything in the final year, reading the timeline). Every plan a pilot
// makes starts from the baseline bot's and changes only what the pilot's comment says.

import { baselinePlan } from "../ai/baselineBot";
import type { CareerGameConfig, PlayConfig } from "../config";
import { heldCeiling, listingOf, peopleCap, rulesForTurn, upcomingShift, yearOf } from "../engine/career";
import { founderStake, poachFloor, raiseAmount, valuationOf } from "../engine/formulas";
import { projectTurn } from "../engine/project";
import type { CompanyView, Plan, PriceTier } from "../engine/types";
import { companyRunway } from "../engine/view";
import type { Pilot } from "./runCareer";

/** The names the report gives the pilots. The script and the tests both take them from here. */
export const PILOT_NAMES: {
  readonly neverList: string;
  readonly listLast: string;
  readonly endgame: string;
  readonly shiftAware: string;
  readonly overspend: (fromYear: number) => string;
} = {
  neverList: "Never goes public",
  listLast: "Goes public in the final year",
  endgame: "Spends everything in the final year",
  shiftAware: "Reads the timeline",
  overspend: (fromYear) => `Overspends from ${fromYear} until rescued`,
};

/**
 * The largest marketing budget the rules allow this plan: the step-rounded cash in hand, never counted below $0, plus
 * what the plan's raise or listing brings at the opening valuation, and never more than the year's limit. The same
 * sum as the plan check's, so a budget of this size is never cut.
 */
const marketingRoom = (view: CompanyView, plan: Plan, config: PlayConfig): number => {
  const rules = rulesForTurn(config, view.turn);
  const { self } = view;
  const climate = view.climate.multiplier;
  const proceeds =
    plan.goPublic === true
      ? listingOf(self, climate, rules).amount
      : plan.raisePercent > 0
        ? raiseAmount(valuationOf(self.users, self.hype, climate, rules), plan.raisePercent)
        : 0;
  const step = rules.pull.marketingStep;
  return Math.floor(Math.min(rules.pull.maxMarketing, Math.max(0, self.cash) + proceeds) / step) * step;
};

/** True in the career's final year. */
const finalYear = (view: CompanyView, config: PlayConfig): boolean => view.turn >= rulesForTurn(config, view.turn).game.maxTurns;

/**
 * Never goes public: the baseline bot's plan worked out as if no listing were on offer, so it still raises when short
 * of cash.
 */
export const neverListPilot: Pilot = (view, config) => {
  const facts = view.self.career;
  if (facts === undefined) return baselinePlan(view, config);
  // Not qualified, the baseline bot sees no listing on offer and plans the raise it would make without one.
  const plan = baselinePlan({ ...view, self: { ...view.self, career: { ...facts, qualified: false } } }, config);
  return { ...plan, goPublic: false };
};

/** Waits to go public until the final year, or until a year it opens with less than `baseline.raiseRunway` years of cash. */
export const listLastPilot: Pilot = (view, config) => {
  const base = baselinePlan(view, config);
  if (base.goPublic !== true || finalYear(view, config)) return base;
  const rules = rulesForTurn(config, view.turn);
  const runway = companyRunway(view.self, rules);
  if (runway !== null && runway < rules.baseline.raiseRunway) return base;
  return neverListPilot(view, config);
};

/**
 * In the final year it plays for its stake alone: of its own price or Budget, and of marketing at nothing, a quarter,
 * a half, three quarters and all of what the rules allow, the plan whose projected founder's stake times
 * (1 − boardRisk) is largest, among those whose projected cashFloor is not below $0; the baseline bot's plan when
 * there is none. The board votes at the end of the final year as in any other, so it never risks going below $0.
 */
export const endgamePilot: Pilot = (view, config) => {
  const base = baselinePlan(view, config);
  if (!finalYear(view, config)) return base;
  const step = rulesForTurn(config, view.turn).pull.marketingStep;
  const room = marketingRoom(view, base, config);
  const prices: PriceTier[] = base.price === "budget" ? ["budget"] : [base.price, "budget"];
  let best: Plan | null = null;
  let bestScore = -Infinity;
  for (const price of prices) {
    for (const share of [0, 0.25, 0.5, 0.75, 1]) {
      const plan: Plan = { ...base, price, marketing: Math.floor((room * share) / step) * step };
      const projection = projectTurn(view, plan, config);
      if (projection.cashFloor < 0) continue;
      const score = founderStake(projection.equity, projection.valuation) * (1 - projection.boardRisk);
      if (score > bestScore) {
        best = plan;
        bestScore = score;
      }
    }
  }
  return best ?? base;
};

/**
 * Reads the timeline: its Product people do Growth work in the announced years before a shift while its quality is
 * above that shift's ceiling, and in a year whose ceiling holds.
 */
export const shiftAwarePilot: Pilot = (view, config) => {
  const base = baselinePlan(view, config);
  const shift = upcomingShift(view.turn, config);
  const cutDown = shift !== null && view.self.quality > shift.ceiling;
  if (!cutDown && heldCeiling(view.event, config) === null) return base;
  const { product, growth, recruiting } = base.allocation;
  return { ...base, allocation: { product: 0, growth: product + growth, recruiting } };
};

/**
 * From `fromYear` until it has been rescued it spends all it can: the largest marketing budget the rules allow, a
 * third of its people (at least one) recruiting with no hire limit, taken from Growth first, and a poach of the rival
 * with the most users among those the rules let it poach from (ties: higher quality, lower seat).
 */
export const overspendPilot =
  (fromYear: number): Pilot =>
  (view, config) => {
    const base = baselinePlan(view, config);
    const rules = rulesForTurn(config, view.turn);
    const { self } = view;
    if (rules.career === undefined || self.career === undefined) return base;
    if (yearOf(view.turn, rules.career) < fromYear || self.career.rescue !== null) return base;

    const available = base.allocation.product + base.allocation.growth + base.allocation.recruiting;
    const recruiting = Math.min(available, Math.max(1, Math.round(self.headcount / 3)));
    let { product, growth } = base.allocation;
    const extra = recruiting - base.allocation.recruiting;
    if (extra >= 0) {
      const fromGrowth = Math.min(growth, extra);
      growth -= fromGrowth;
      product -= extra - fromGrowth;
    } else {
      // Fewer recruiters than the baseline bot's: the rest do Growth work.
      growth -= extra;
    }

    const roomForOne = self.headcount - base.layoffs < peopleCap(rules.career);
    const target = roomForOne
      ? view.rivals
          .filter((rival) => rival.out === null && rival.headcount >= poachFloor(rules))
          .sort((a, b) => b.users - a.users || b.quality - a.quality || a.id - b.id)[0]
      : undefined;

    return {
      ...base,
      allocation: { product, growth, recruiting },
      marketing: marketingRoom(view, base, config),
      poachTarget: target === undefined ? null : target.id,
      hireLimit: null,
    };
  };

/** The same config with every platform shift switched off: ceilings at 100, waves at 1. The control for the lead target. */
export const withoutShifts = (config: CareerGameConfig): CareerGameConfig => ({
  ...config,
  career: {
    ...config.career,
    dated: config.career.dated.map((card) => ({
      ...card,
      effects: card.effects.map((effect) =>
        effect.kind === "qualityCeiling" ? { ...effect, ceiling: 100 } : effect.kind === "userWave" ? { ...effect, multiplier: 1 } : effect,
      ),
    })),
  },
});
