/** Split from src/world/types.ts (M5): office layout data (pure data — see office/layouts.ts). Re-exported by ../types. */

import type { AssetId, CompanyPhase } from "../../types/game";
import type { Placement, Vec2 } from "./geometry";

/**
 * Fixed points of interest. Every phase's layout provides every station so the
 * same interactions exist from the garage to the public-company HQ (they just
 * look different: a folding table in the garage, a glass boardroom later).
 */
export type StationKind =
  | "ship" // whiteboard / kanban wall — ship a feature
  | "launch" // marketing corner — launch a campaign
  | "investors" // phone / pitch corner — pitch + raise
  | "boardroom" // board table
  | "calendar" // wall calendar — end the week
  | "coffee" // coffee machine
  | "servers" // server rack — users / MRR
  | "pricing"; // pricing board

export interface OfficeLayout {
  phase: CompanyPhase;
  /** Interior floor rectangle. */
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * For every seat below, the Placement is where the PERSON sits and the
   * direction they face. The desk surface goes in front of them, centred at
   * seat + forward × DESK_OFFSET (see office/layouts.ts).
   */
  founderSeat: Placement;
  cofounderSeat: Placement;
  /** Employee desks, in fill order. */
  deskSeats: Placement[];
  /** Floor spots (beanbags / laptops on the floor) used once desks run out. */
  overflowSpots: Placement[];
  /** Where people walk in and out. Position is just inside the doorway, facing into the room. */
  door: Placement;
  /** Station object centre + the direction its front faces. */
  stations: Record<StationKind, Placement>;
  /** Where a person stands to use a station (in front of it, facing it). */
  stationStandSpots: Record<StationKind, Placement>;
  /** Places idle people wander to (coffee, windows, lounge). */
  wanderSpots: Placement[];
  /** Where each purchasable asset is shown (owned = real, available = blueprint ghost). */
  assetAnchors: Record<AssetId, Placement>;
  /**
   * Reference framing for this phase at a 3:2 viewport. The camera rig does not
   * read it directly: it frames from getLayoutFrame() so the shot adapts to the
   * canvas aspect and to owned outdoor assets.
   */
  camera: {
    target: Vec2;
    /** World units visible vertically at default zoom. */
    viewHeight: number;
  };
}

