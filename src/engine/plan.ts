// Plans: the default for a new turn, and the check that turns any plan into a legal one.
// An illegal part is fixed up or dropped at no cost, with a note for the quarterly report.

import { refitAllocation } from "./formulas";
import { PRICE_TIERS } from "./types";
import type { Allocation, Company, CompanyId, GameState, Plan, PublicCompany, RulesConfig } from "./types";

/** Last turn's split refitted to today's team, same marketing, price and hire limit; no one-off actions. */
export const defaultPlan = (company: Company): Plan => ({
  allocation: refitAllocation(company.lastPlan.allocation, company.headcount),
  marketing: company.lastPlan.marketing,
  price: company.price,
  raisePercent: 0,
  poachTarget: null,
  layoffs: 0,
  hireLimit: company.lastPlan.hireLimit,
});

export type RaiseBlocker = "users" | "cooldown";

/** Why this company cannot raise this turn, or null if it can. */
export const raiseBlocker = (company: Company, turn: number, config: RulesConfig): RaiseBlocker | null => {
  if (company.users < config.raise.minUsers) return "users";
  if (company.lastRaise !== null && turn - company.lastRaise.turn <= config.raise.cooldownTurns) return "cooldown";
  return null;
};

const whole = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

const sameSplit = (a: Allocation, b: Allocation): boolean =>
  a.product === b.product && a.growth === b.growth && a.recruiting === b.recruiting;

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

const dollars = (n: number): string => `$${n.toLocaleString("en-US")}`;

export interface CheckedPlan {
  readonly plan: Plan;
  /** What was changed, in plain words. Empty for a plan that was already legal. */
  readonly notes: readonly string[];
}

/** The check itself, from what one company can see: itself, the turn, and the public side of the others. */
export const normalizePlanFor = (
  company: Company,
  turn: number,
  others: readonly PublicCompany[],
  plan: Plan | null,
  config: RulesConfig,
): CheckedPlan => {
  const wanted = plan ?? defaultPlan(company);
  const notes: string[] = [];

  const askedLayoffs = whole(wanted.layoffs);
  const layoffs = Math.min(askedLayoffs, Math.max(0, company.headcount - 1));
  if (layoffs !== askedLayoffs) notes.push(`Laid off ${layoffs}, not ${askedLayoffs}: at least one person has to stay.`);

  const price = PRICE_TIERS.includes(wanted.price) ? wanted.price : company.price;
  if (price !== wanted.price) notes.push("Unknown price tier: the price stays where it was.");

  let raisePercent = wanted.raisePercent;
  if (raisePercent !== 0) {
    const blocker = raiseBlocker(company, turn, config);
    if (!config.raise.options.includes(raisePercent)) {
      notes.push(`Raise dropped: ${raisePercent}% is not on offer.`);
      raisePercent = 0;
    } else if (blocker === "users") {
      notes.push(`Raise dropped: it needs ${config.raise.minUsers.toLocaleString("en-US")} users.`);
      raisePercent = 0;
    } else if (blocker === "cooldown") {
      notes.push("Raise dropped: the last raise was too recent.");
      raisePercent = 0;
    }
  }

  const available = company.headcount - layoffs - (raisePercent > 0 ? 1 : 0);
  const allocation = refitAllocation(wanted.allocation, available);
  if (!sameSplit(allocation, wanted.allocation)) notes.push(`Team split refitted to ${people(available)}.`);

  const step = config.pull.marketingStep;
  const marketing = Math.min(config.pull.maxMarketing, Math.floor(whole(wanted.marketing) / step) * step);
  if (marketing !== wanted.marketing) notes.push(`Marketing set to ${dollars(marketing)}.`);

  let poachTarget = wanted.poachTarget;
  if (poachTarget !== null) {
    const wantedTarget = poachTarget;
    const target = others.find((other) => other.id === wantedTarget);
    if (target === undefined || target.id === company.id || target.out !== null) {
      notes.push("Poach dropped: that company cannot be poached from.");
      poachTarget = null;
    } else if (target.headcount < config.poach.minTargetHeadcount) {
      notes.push(`Poach dropped: ${target.name} is too small to lose anyone.`);
      poachTarget = null;
    }
  }

  const hireLimit = wanted.hireLimit === null ? null : whole(wanted.hireLimit);

  return { plan: { allocation, marketing, price, raisePercent, poachTarget, layoffs, hireLimit }, notes };
};

export const normalizePlan = (state: GameState, id: CompanyId, plan: Plan | null, config: RulesConfig): CheckedPlan =>
  normalizePlanFor(state.companies[id], state.turn, state.companies, plan, config);
