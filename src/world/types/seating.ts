/** Seating plan contracts (pure logic — see people/seating.ts). Re-exported by ../types. */

import type { Placement } from "./geometry";
import type { Team } from "./scene";

/** A desk, or a spot at the door for someone leaving or expected. */
export type SeatKind = "desk" | "waiting";

/** One person's move in the most recent seating reconcile. */
export interface SeatChange {
  personId: string;
  /** Where they were. null = nowhere visible (a new arrival, or somebody the office had no room for). */
  from: Seat | null;
  /**
   * Where they are now. null = nowhere visible: they either left the company
   * (no longer in the cast) or the office has no room for them.
   */
  to: Seat | null;
}

export interface Seat extends Placement {
  kind: SeatKind;
  /** Index into layout.deskSeats (kind "desk") or layout.waitingSpots (kind "waiting"). */
  index: number;
}

export interface SeatingApi {
  /** null when the person has no visible spot (the office is over capacity). */
  seatOf(personId: string): Seat | null;
  /** The team whose area the desk layout.deskSeats[index] is in, or null when no team has it. */
  teamOfDesk(index: number): Team | null;
  /** Indices into layout.deskSeats that nobody occupies. */
  freeDeskSlots(): number[];
  /** People who exist and have no visible spot: the cast's hidden ones plus the people in it without a seat. */
  hiddenCount(): number;
  /** Who moved, arrived or left in the most recent reconcile (empty when nothing changed). */
  lastChanges(): readonly SeatChange[];
  /** Person id sitting at layout.deskSeats[index], or null when that desk is empty. */
  deskOccupant(index: number): string | null;
  /** Person id at layout.waitingSpots[index], or null when that spot is empty. */
  waitingOccupant(index: number): string | null;
}
