import type { InteractableTarget } from "./types";

/** Stable string identity for an interactable target (usable as a Map key). */
export const targetKey = (target: InteractableTarget): string => {
  switch (target.kind) {
    case "person":
      return `person:${target.personId}`;
    case "empty-desk":
      return `empty-desk:${target.slotIndex}`;
    case "station":
      return `station:${target.station}`;
    case "asset":
      return `asset:${target.assetId}`;
    case "door":
      return "door";
    case "event-beacon":
      return "event-beacon";
    case "overflow-sign":
      return "overflow-sign";
  }
};

export const sameTarget = (a: InteractableTarget | null, b: InteractableTarget | null): boolean => {
  if (a === null || b === null) return a === b;
  return targetKey(a) === targetKey(b);
};
