/**
 * Picking a person up in the office and setting them down in another team. Pure: every tap goes through
 * `carryStep`, which says what is carried next and, when a person is set down in another team, the one change
 * to the plan. The world only draws what `highlightFor` says.
 */

import type { Department, Plan } from "../engine/types";
import type { InteractableTarget } from "../world/types/interaction";
import type { Team } from "../world/types/scene";

/** The person being carried, with the team they work in, or nothing. */
export type Carry = { readonly team: Team; readonly personId: string } | null;

/** What a tap landed on: a person (team null when they are not working: at the door or away), a desk (no person). */
export interface Picked {
  readonly team: Team | null;
  readonly personId: string | null;
}

/** One person from `from` to `to`, as the plan's new allocation; null when the move cannot be made. */
export const moveBetweenTeams = (draft: Plan, from: Department, to: Department): Pick<Plan, "allocation"> | null => {
  if (from === to) return null;
  const { allocation } = draft;
  if (allocation[from] < 1) return null;
  return { allocation: { ...allocation, [from]: allocation[from] - 1, [to]: allocation[to] + 1 } };
};

/**
 * The plan as the office draws it: the drafted plan with the split the scene shows (the plan refitted to everyone,
 * as the engine will resolve it). Moves are made on this, so one move changes one person drawn and one plan count,
 * and a person carried always comes from a team that has someone in it.
 */
export const asDrawn = (draft: Plan, teams: Readonly<Record<Team, number>>): Plan => ({
  ...draft,
  allocation: { ...draft.allocation, product: teams.product, growth: teams.growth, recruiting: teams.recruiting },
});

const NOTHING = { carry: null, move: null } as const;

/** One tap, given what is carried and the plan being drafted. */
export const carryStep = (
  carry: Carry,
  picked: Picked | null,
  draft: Plan,
): { readonly carry: Carry; readonly move: Pick<Plan, "allocation"> | null } => {
  if (carry === null) {
    if (picked === null || picked.team === null || picked.personId === null) return NOTHING;
    return { carry: { team: picked.team, personId: picked.personId }, move: null };
  }
  if (picked === null || picked.team === null) return NOTHING;
  if (picked.team === carry.team) {
    if (picked.personId === null || picked.personId === carry.personId) return NOTHING;
    return { carry: { team: picked.team, personId: picked.personId }, move: null };
  }
  return { carry: null, move: moveBetweenTeams(draft, carry.team, picked.team) };
};

export const TEAM_NAMES: Readonly<Record<Team, string>> = { product: "Product", growth: "Growth", recruiting: "Recruiting" };

export const carryLine = (team: Team): string => `Move one ${TEAM_NAMES[team]} person to`;

export const CARRY_WORDS: { readonly keep: "Keep them"; readonly label: "Move a person between teams" } = {
  keep: "Keep them",
  label: "Move a person between teams",
};

/** What the world highlights: the person carried, or nothing. Set after every tap, move, put-back and drop. */
export const highlightFor = (carry: Carry): InteractableTarget | null =>
  carry === null ? null : { kind: "person", personId: carry.personId };
