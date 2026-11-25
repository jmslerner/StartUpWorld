import type { InteractableTarget } from "./types";

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
