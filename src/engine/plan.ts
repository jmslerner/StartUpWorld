// Plans: the default for a new turn, and the check that turns any plan into a legal one.
// An illegal part is fixed up or dropped at no cost, with a note for the quarterly report.

import { listingBlocker, listingOf, peopleCap, rulesForTurn } from "./career";
import { poachFloor, raiseAmount, refitAllocation, valuationOf } from "./formulas";
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

export type RaiseBlocker = "users" | "cooldown" | "public";

/** Why this company cannot raise this turn, or null if it can, by that turn's numbers. A public company never can. */
export const raiseBlocker = (company: Company, turn: number, config: RulesConfig): RaiseBlocker | null => {
  const rules = rulesForTurn(config, turn);
  if (company.career !== undefined && company.career.listed !== null) return "public";
  if (company.users < rules.raise.minUsers) return "users";
  if (company.lastRaise !== null && turn - company.lastRaise.turn <= rules.raise.cooldownTurns) return "cooldown";
  return null;
};

const whole = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

const sameSplit = (a: Allocation, b: Allocation): boolean =>
  a.product === b.product && a.growth === b.growth && a.recruiting === b.recruiting;

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

const dollars = (n: number): string => `$${n.toLocaleString("en-US")}`;

/**
 * The most marketing a plan may budget in a career (C11), step-rounded; null outside a career. It is the cash in hand,
 * never counted below $0, plus what the plan's listing (`goPublic`) or raise (`raisePercent`) brings at the opening
 * valuation. `rules` are the year's.
 */
export const marketingRoom = (company: Company, plan: Plan, climateMultiplier: number, rules: RulesConfig): number | null => {
  if (rules.career === undefined) return null;
  const proceeds =
    plan.goPublic === true
      ? listingOf(company, climateMultiplier, rules).amount
      : plan.raisePercent > 0
        ? raiseAmount(valuationOf(company.users, company.hype, climateMultiplier, rules), plan.raisePercent)
        : 0;
  const step = rules.pull.marketingStep;
  return Math.floor((Math.max(0, company.cash) + proceeds) / step) * step;
};

export interface CheckedPlan {
  readonly plan: Plan;
  /** What was changed, in plain words. Empty for a plan that was already legal. */
  readonly notes: readonly string[];
}

/**
 * The check itself, from what one company can see: itself, the turn, the funding climate and the public side of the
 * others. Limits are those of the turn being planned.
 */
export const normalizePlanFor = (
  company: Company,
  turn: number,
  others: readonly PublicCompany[],
  plan: Plan | null,
  config: RulesConfig,
  climateMultiplier = 1,
): CheckedPlan => {
  const rules = rulesForTurn(config, turn);
  const wanted = plan ?? defaultPlan(company);
  const notes: string[] = [];

  const askedLayoffs = whole(wanted.layoffs);
  if (askedLayoffs !== wanted.layoffs) notes.push(`Layoffs set to ${askedLayoffs}: it has to be a whole number of people.`);
  const layoffs = Math.min(askedLayoffs, Math.max(0, company.headcount - 1));
  if (layoffs !== askedLayoffs) notes.push(`Laid off ${layoffs}, not ${askedLayoffs}: at least one person has to stay.`);

  const price = PRICE_TIERS.includes(wanted.price) ? wanted.price : company.price;
  if (price !== wanted.price) notes.push("Unknown price tier: the price stays where it was.");

  // In a career a plan may take the company public. Outside one the wish is not read, and the key is never written.
  let goPublic = false;
  if (rules.career !== undefined && wanted.goPublic === true) {
    const blocker = listingBlocker(company, turn, rules);
    if (blocker === null) goPublic = true;
    else if (blocker === "users") notes.push(`Going public dropped: it takes a year that closes with ${rules.ipo.users.toLocaleString("en-US")} users and a profit.`);
    else if (blocker === "profit") notes.push("Going public dropped: no year has yet closed at the bar with a profit.");
    else if (blocker === "listed") notes.push("Going public dropped: the company is already public.");
  }

  let raisePercent = wanted.raisePercent;
  if (raisePercent !== 0) {
    const blocker = raiseBlocker(company, turn, rules);
    if (!rules.raise.options.includes(raisePercent)) {
      notes.push(`Raise dropped: ${raisePercent}% is not on offer.`);
      raisePercent = 0;
    } else if (blocker === "public") {
      notes.push("Raise dropped: a public company cannot raise privately.");
      raisePercent = 0;
    } else if (goPublic) {
      notes.push("Raise dropped: a company cannot raise privately in the year it goes public.");
      raisePercent = 0;
    } else if (blocker === "users") {
      notes.push(`Raise dropped: it needs ${rules.raise.minUsers.toLocaleString("en-US")} users.`);
      raisePercent = 0;
    } else if (blocker === "cooldown") {
      notes.push("Raise dropped: the last raise was too recent.");
      raisePercent = 0;
    }
  }

  const available = company.headcount - layoffs - (raisePercent > 0 ? 1 : 0);
  const allocation = refitAllocation(wanted.allocation, available);
  if (!sameSplit(allocation, wanted.allocation)) notes.push(`Team split refitted to ${people(available)}.`);

  const step = rules.pull.marketingStep;
  let marketing = Math.min(rules.pull.maxMarketing, Math.floor(whole(wanted.marketing) / step) * step);
  // In a career marketing is paid from the cash in hand, never counted below $0, plus what this year's raise or
  // listing brings at the opening valuation. When this limit cuts the budget, its note is the only one.
  let cashCut = false;
  const room = marketingRoom(company, { ...wanted, goPublic, raisePercent }, climateMultiplier, rules);
  if (room !== null && room < marketing) {
    marketing = room;
    cashCut = true;
  }
  if (cashCut) notes.push(`Marketing set to ${dollars(marketing)}: it cannot exceed the cash in hand.`);
  else if (marketing !== wanted.marketing) notes.push(`Marketing set to ${dollars(marketing)}.`);

  let poachTarget = wanted.poachTarget;
  if (poachTarget !== null) {
    const wantedTarget = poachTarget;
    const target = others.find((other) => other.id === wantedTarget);
    // In a career no team grows beyond the last office: one that already fills it cannot take anyone in.
    const career = rules.career;
    if (career !== undefined && company.headcount - layoffs >= peopleCap(career)) {
      notes.push(`Poach dropped: the ${career.offices[career.offices.length - 1].name.toLowerCase()} is full.`);
      poachTarget = null;
    } else if (target === undefined || target.id === company.id || target.out !== null) {
      notes.push("Poach dropped: that company cannot be poached from.");
      poachTarget = null;
    } else if (target.headcount < poachFloor(rules)) {
      notes.push(`Poach dropped: ${target.name} is too small to lose anyone.`);
      poachTarget = null;
    }
  }

  const hireLimit = wanted.hireLimit === null ? null : whole(wanted.hireLimit);
  if (hireLimit !== wanted.hireLimit) notes.push(`Hire limit set to ${hireLimit}: it has to be a whole number of people.`);

  const resolved: Plan = { allocation, marketing, price, raisePercent, poachTarget, layoffs, hireLimit };
  return { plan: rules.career === undefined ? resolved : { ...resolved, goPublic }, notes };
};

export const normalizePlan = (state: GameState, id: CompanyId, plan: Plan | null, config: RulesConfig): CheckedPlan =>
  normalizePlanFor(state.companies[id], state.turn, state.companies, plan, config, state.climate.multiplier);
