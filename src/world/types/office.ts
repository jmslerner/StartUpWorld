/** An office's plan: pure data (see office/layouts.ts). Re-exported by ../types. */

import type { Placement, Vec2 } from "./geometry";
import type { OfficeIndex } from "./scene";

/**
 * Fixed pieces of furniture. Every office's plan has every station, so the same places exist from the garage to
 * the campus (they just look different: a folding table in the garage, a glass boardroom later). The names are
 * the old ones, kept because the plans were drawn around them; nothing is done at a station any more.
 */
export type StationKind =
  | "ship" // whiteboard wall
  | "launch" // marketing corner
  | "investors" // phone corner
  | "boardroom" // board table
  | "calendar" // wall calendar
  | "coffee" // coffee machine
  | "servers" // server rack
  | "pricing"; // price board

export interface OfficeLayout {
  office: OfficeIndex;
  /** Interior floor rectangle. */
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * Desks, in fill order, bench by bench. The Placement is where the PERSON sits and the direction they face. The
   * desk surface goes in front of them, centred at seat + forward × DESK_OFFSET (see office/layouts.ts).
   */
  deskSeats: Placement[];
  /** Floor spots near the door, nearest first, where people leaving and people expected stand. */
  waitingSpots: Placement[];
  /** Where people walk in and out. Position is just inside the doorway, facing into the room. */
  door: Placement;
  /** Station object centre + the direction its front faces. */
  stations: Record<StationKind, Placement>;
  /** Where a person stands at a station (in front of it, facing it). */
  stationStandSpots: Record<StationKind, Placement>;
  /** Places idle people wander to (coffee, windows, lounge). */
  wanderSpots: Placement[];
  /**
   * Reference framing for this office at a 3:2 viewport. The camera rig does not read it directly: it frames from
   * getLayoutFrame() so the shot adapts to the canvas aspect.
   */
  camera: {
    target: Vec2;
    /** World units visible vertically at default zoom. */
    viewHeight: number;
  };
}
