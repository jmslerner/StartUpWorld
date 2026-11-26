import type { Cast } from "./cast";
import type { InteractableTarget, SeatingApi, Team } from "./types";

/** Stable string identity for an interactable target (usable as a Map key). */
export const targetKey = (target: InteractableTarget): string => {
  switch (target.kind) {
    case "person":
      return `person:${target.personId}`;
    case "desk":
      return `desk:${target.desk}`;
    case "team":
      return `team:${target.team}`;
    case "station":
      return `station:${target.station}`;
    case "door":
      return "door";
    case "sign":
      return "sign";
  }
};

export const sameTarget = (a: InteractableTarget | null, b: InteractableTarget | null): boolean => {
  if (a === null || b === null) return a === b;
  return targetKey(a) === targetKey(b);
};

/**
 * The team a target belongs to: a person working has their team (someone away, leaving or waiting at the door has
 * none), a desk has the team whose area it is in, a team area is its own team, and anything else has none.
 */
export const teamOfTarget = (target: InteractableTarget, cast: Cast | null, seating: Pick<SeatingApi, "teamOfDesk">): Team | null => {
  switch (target.kind) {
    case "person": {
      const person = cast?.people.find((member) => member.id === target.personId);
      return person?.standing === "working" ? person.team : null;
    }
    case "desk":
      return seating.teamOfDesk(target.desk);
    case "team":
      return target.team;
    default:
      return null;
  }
};
