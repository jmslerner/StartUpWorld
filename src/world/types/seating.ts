/** Split from src/world/types.ts (M5): seating plan contracts (pure logic — see people/seating.ts). Re-exported by ../types. */

import type { Placement } from "./geometry";

export type SeatKind = "founder" | "cofounder" | "desk" | "overflow";

/** One person's move in the most recent seating reconcile. */
export interface SeatChange {
  personId: string;
  /** Where they were. null = nowhere visible (a new hire, or somebody the office had no room for). */
  from: Seat | null;
  /**
   * Where they are now. null = nowhere visible: they either left the company
   * (no longer in the roster) or the new office has no room for them.
   */
  to: Seat | null;
}

export interface Seat extends Placement {
  kind: SeatKind;
  /** Index into layout.deskSeats (kind "desk") or layout.overflowSpots (kind "overflow"); −1 otherwise. */
  slotIndex: number;
}

export interface SeatingApi {
  /** null when the person has no visible spot (office is over capacity). */
  seatOf(personId: string): Seat | null;
  /** Indices into layout.deskSeats that nobody occupies. */
  freeDeskSlots(): number[];
  /** People in the snapshot (plus snapshot.hiddenPeople) that have no visible spot. */
  hiddenCount(): number;
  /** Who moved, arrived or left in the most recent reconcile (empty when nothing changed). */
  lastChanges(): readonly SeatChange[];
  /** Person id sitting at layout.deskSeats[slotIndex], or null when that desk is empty. */
  deskOccupant(slotIndex: number): string | null;
  /** Person id at layout.overflowSpots[slotIndex], or null when that spot is empty. */
  overflowOccupant(slotIndex: number): string | null;
}

