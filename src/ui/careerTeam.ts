// The career's "+" on a team. In the race "+" needs someone unassigned (stepDepartment, frozen by the race's
// tests); in a career it may also move one person over from another team, and the row says from where.

import type { Company, Department, Plan } from "../engine/types";
import { stepDepartment, unassigned } from "./draft";

/** The teams, in the order ties are broken in. */
export const TEAMS: readonly Department[] = ["product", "growth", "recruiting"];

const TEAM_NAME: Record<Department, string> = { product: "Product", growth: "Growth", recruiting: "Recruiting" };

export interface TeamStep {
  readonly plan: Plan;
  readonly from: Department | null;
}

/** The team other than `department` with the most people, the first in TEAMS on ties; null when nobody is on one. */
const donorFor = (plan: Plan, department: Department): Department | null => {
  let donor: Department | null = null;
  for (const team of TEAMS) {
    if (team === department || plan.allocation[team] < 1) continue;
    if (donor === null || plan.allocation[team] > plan.allocation[donor]) donor = team;
  }
  return donor;
};

/**
 * Career "+": as stepDepartment with someone free; with nobody free, one person from the largest other team
 * (Product, then Growth, then Recruiting on ties). "−" is stepDepartment's. Unchanged: the same plan object, from null.
 */
export const careerStepDepartment = (company: Company, plan: Plan, department: Department, delta: 1 | -1): TeamStep => {
  if (delta < 0 || unassigned(company, plan) > 0) return { plan: stepDepartment(company, plan, department, delta), from: null };
  const donor = donorFor(plan, department);
  if (donor === null) return { plan, from: null };
  return {
    plan: { ...plan, allocation: { ...plan.allocation, [donor]: plan.allocation[donor] - 1, [department]: plan.allocation[department] + 1 } },
    from: donor,
  };
};

/** Whether "+" can do anything: someone is free, or another team has someone. */
export const careerCanIncrease = (company: Company, plan: Plan, department: Department): boolean =>
  unassigned(company, plan) > 0 || TEAMS.some((team) => team !== department && plan.allocation[team] > 0);

/** Moves made into each team this year, by the team they came from. */
export type MoveNotes = Readonly<Partial<Record<Department, Readonly<Partial<Record<Department, number>>>>>>;

export const NO_MOVES: MoveNotes = {};

export const noteMove = (notes: MoveNotes, from: Department, to: Department): MoveNotes => {
  const into = notes[to] ?? {};
  return { ...notes, [to]: { ...into, [from]: (into[from] ?? 0) + 1 } };
};

/** "−" on a team takes back one noted move into it: from the source with the most, TEAMS order on ties. */
export const dropMove = (notes: MoveNotes, department: Department): MoveNotes => {
  const into = notes[department];
  if (into === undefined) return notes;
  let source: Department | null = null;
  for (const team of TEAMS) {
    const count = into[team] ?? 0;
    if (count > 0 && (source === null || count > (into[source] ?? 0))) source = team;
  }
  if (source === null) return notes;
  const rest: Partial<Record<Department, number>> = { ...into };
  if ((into[source] ?? 0) > 1) rest[source] = (into[source] ?? 0) - 1;
  else delete rest[source];
  const next: Partial<Record<Department, Readonly<Partial<Record<Department, number>>>>> = { ...notes };
  if (Object.keys(rest).length > 0) next[department] = rest;
  else delete next[department];
  return next;
};

/** "1 moved from Product", "2 moved from Product, 1 from Growth"; null with none. Sources in TEAMS order. */
export const moveNote = (notes: MoveNotes, department: Department): string | null => {
  const into = notes[department] ?? {};
  const parts = TEAMS.filter((team) => (into[team] ?? 0) > 0).map(
    (team, index) => `${into[team] ?? 0} ${index === 0 ? "moved from" : "from"} ${TEAM_NAME[team]}`,
  );
  return parts.length === 0 ? null : parts.join(", ");
};
