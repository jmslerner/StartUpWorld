/** Things that can be hovered and tapped, and the registry contract. Re-exported by ../types. */

import type * as THREE from "three";
import type { StationKind } from "./office";
import type { Team } from "./scene";

export type InteractableTarget =
  | { kind: "person"; personId: string }
  /** `desk` is an index into the layout's deskSeats. */
  | { kind: "desk"; desk: number }
  /** A team's area: the run of desks the team sits at. */
  | { kind: "team"; team: Team }
  | { kind: "station"; station: StationKind }
  | { kind: "door" }
  /** The sign beside the door that counts the people who are not drawn. */
  | { kind: "sign" }
  /** A company's building in the market view; `seat` 0 is the player. */
  | { kind: "company"; seat: number };

export interface InteractableOptions {
  /** Short hover label, e.g. "Whiteboard". */
  label: string;
  /** Object whose world position anchors a card. Defaults to the registered object. */
  anchor?: THREE.Object3D;
  /** World-unit offset above the anchor origin where the card/marker attaches. Default 1.6. */
  anchorHeight?: number;
  /**
   * Skip the built-in hover/selection highlight (for objects that manage their own look).
   *
   * Picking notes: only objects attached to the scene and visible are hit. To give a small
   * or hollow object a generous click area, add a child mesh with `visible = false` and
   * `userData.hitProxy = true` — it is pickable while its parent is shown.
   */
  noHighlight?: boolean;
}

export interface InteractableRegistry {
  /**
   * Make `object` (and all of its descendants) hoverable/clickable.
   * Registering a target key that is already registered replaces the old entry.
   */
  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void;
  unregister(object: THREE.Object3D): void;
}
