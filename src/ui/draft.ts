// Editing the plan for the coming quarter. Pure functions from one plan to the next, so the
// planning panel only has to call them. The engine checks the plan again when the quarter ends.

import { refitAllocation } from "../engine/formulas";
import type { Company, Department, Plan, RulesConfig } from "../engine/types";

const assigned = (plan: Plan): number => plan.allocation.product + plan.allocation.growth + plan.allocation.recruiting;

/** People who can be put to work: the team, less layoffs, less the one who runs the raise. */
export const peopleAvailable = (company: Company, plan: Plan): number =>
  Math.max(0, company.headcount - plan.layoffs - (plan.raisePercent > 0 ? 1 : 0));

/** People not yet in a department. */
export const unassigned = (company: Company, plan: Plan): number => Math.max(0, peopleAvailable(company, plan) - assigned(plan));

/** If the split holds more people than are available, shrink it in proportion. */
const fit = (company: Company, plan: Plan): Plan => {
  const available = peopleAvailable(company, plan);
  return assigned(plan) > available ? { ...plan, allocation: refitAllocation(plan.allocation, available) } : plan;
};

/** Move one person into (+1) or out of (−1) a department. Adding needs someone unassigned. */
export const stepDepartment = (company: Company, plan: Plan, department: Department, delta: 1 | -1): Plan => {
  if (delta > 0 && unassigned(company, plan) <= 0) return plan;
  if (delta < 0 && plan.allocation[department] <= 0) return plan;
  return { ...plan, allocation: { ...plan.allocation, [department]: plan.allocation[department] + delta } };
};

/** Put everyone still unassigned to work, following the current split. */
export const assignEveryone = (company: Company, plan: Plan): Plan =>
  unassigned(company, plan) === 0 ? plan : { ...plan, allocation: refitAllocation(plan.allocation, peopleAvailable(company, plan)) };

export const setLayoffs = (company: Company, plan: Plan, layoffs: number): Plan =>
  fit(company, { ...plan, layoffs: Math.min(Math.max(0, Math.floor(layoffs)), Math.max(0, company.headcount - 1)) });

/** 0 switches the raise off. */
export const setRaise = (company: Company, plan: Plan, percent: number): Plan => fit(company, { ...plan, raisePercent: percent });

export const stepMarketing = (plan: Plan, steps: number, config: RulesConfig): Plan => ({
  ...plan,
  marketing: Math.min(config.pull.maxMarketing, Math.max(0, plan.marketing + steps * config.pull.marketingStep)),
});

/**
 * The "hire at most" control: 0, 1, 2 … up to what recruiting can find today, then "no limit" (null).
 * A number stays as the player set it from one quarter to the next; only "no limit" grows with recruiting.
 */
export const stepHireLimit = (plan: Plan, delta: 1 | -1, capacity: number): Plan => {
  const { hireLimit } = plan;
  if (delta < 0) return { ...plan, hireLimit: hireLimit === null ? capacity : Math.max(0, hireLimit - 1) };
  return { ...plan, hireLimit: hireLimit === null || hireLimit >= capacity ? null : hireLimit + 1 };
};
