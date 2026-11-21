/**
 * Who sits where.
 *
 * The snapshot only says who works here; it does not say where they sit. If seats
 * were recomputed from the roster on every change, hiring one engineer would
 * shift every designer, marketer and lawyer one desk over (the roster is grouped
 * by role). SeatingPlan therefore *remembers*: once somebody has a desk they keep
 * it for as long as the office stays the same, and only the people who are
 * actually new, gone or promoted off the floor move.
 *
 * Pure logic — no three.js, no DOM. Owned by the World and exposed to the systems
 * as `ctx.seating` (SeatingApi).
 */
import type { OfficeLayout, PersonView, Placement, Seat, SeatChange, SeatingApi, SeatKind } from "../types";

export type { SeatChange } from "../types";

const samePlacement = (a: Placement, b: Placement): boolean =>
  a === b || (a.x === b.x && a.z === b.z && a.facing === b.facing);

const samePlacements = (a: readonly Placement[], b: readonly Placement[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!samePlacement(a[i], b[i])) return false;
  }
  return true;
};

/**
 * Can seat assignments made for `a` be carried over to `b`?
 *
 * Deliberately looser than object identity: buying an asset yields a different
 * layout object for the same phase (new camera framing, an extra hang-out spot)
 * but the desks have not moved, and nobody should be shuffled because the
 * company bought a helicopter.
 */
const sameSeatGeometry = (a: OfficeLayout, b: OfficeLayout): boolean =>
  a === b ||
  (a.phase === b.phase &&
    samePlacement(a.founderSeat, b.founderSeat) &&
    samePlacement(a.cofounderSeat, b.cofounderSeat) &&
    samePlacements(a.deskSeats, b.deskSeats) &&
    samePlacements(a.overflowSpots, b.overflowSpots));

const sameSeat = (a: Seat | null, b: Seat | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.kind === b.kind && a.slotIndex === b.slotIndex && samePlacement(a, b));

// Seats are handed out by reference and shared, so they are frozen: a consumer
// that nudges `seat.x` would silently move the desk for everyone.
const makeSeat = (placement: Placement, kind: SeatKind, slotIndex: number): Seat =>
  Object.freeze({ x: placement.x, z: placement.z, facing: placement.facing, kind, slotIndex });

const firstFree = (owners: ReadonlyArray<string | null>): number => owners.indexOf(null);

export class SeatingPlan implements SeatingApi {
  private layout: OfficeLayout | null = null;
  private readonly seats = new Map<string, Seat>();
  /** Person id per desk / overflow slot (null = free). Parallel to the layout arrays. */
  private deskOwners: Array<string | null> = [];
  private overflowOwners: Array<string | null> = [];
  /** Roster people the office has no spot for. */
  private unseated = 0;
  /** Employees beyond the snapshot's people cap; they are not in the roster at all. */
  private beyondRoster = 0;
  private changes: SeatChange[] = [];

  /**
   * Bring the plan in line with the current roster and layout.
   *
   * Same office (same seat geometry):
   *   1. people who left free their seat;
   *   2. founder → founderSeat, cofounder → cofounderSeat;
   *   3. while a desk is free, the overflow sitter with the lowest slot index is promoted to it;
   *   4. everyone still without a spot (new hires and people previously hidden), in
   *      roster order, takes the lowest free desk, else the lowest free overflow
   *      spot, else stays hidden.
   *   Nobody else moves.
   *
   * Different office (phase change, or first call): everyone is reseated from
   * scratch in roster order — desks first, then overflow spots, then hidden.
   */
  reconcile(people: readonly PersonView[], hiddenPeople: number, layout: OfficeLayout): void {
    const changes: SeatChange[] = [];
    if (this.layout !== null && sameSeatGeometry(this.layout, layout)) {
      this.updateInPlace(people, layout, changes);
    } else {
      this.reseatEveryone(people, layout, changes);
    }
    this.layout = layout;
    this.changes = changes;
    this.beyondRoster = Number.isFinite(hiddenPeople) ? Math.max(0, Math.floor(hiddenPeople)) : 0;
  }

  /**
   * null when the person has no visible spot (or is not in the roster).
   * The same Seat object is returned for as long as the person's seat is
   * unchanged, so `seat !== previousSeat` is a valid, cheap "did they move?" test.
   */
  seatOf(personId: string): Seat | null {
    return this.seats.get(personId) ?? null;
  }

  /** Indices into layout.deskSeats that nobody occupies, ascending. A fresh array on every call. */
  freeDeskSlots(): number[] {
    const free: number[] = [];
    for (let i = 0; i < this.deskOwners.length; i += 1) {
      if (this.deskOwners[i] === null) free.push(i);
    }
    return free;
  }

  /** Everybody who works here but is not shown: roster people without a spot + people beyond the roster cap. */
  hiddenCount(): number {
    return this.beyondRoster + this.unseated;
  }

  /**
   * Seat moves made by the most recent `reconcile`: people who left first, then
   * promotions off the floor, then everyone else in roster order. Empty when
   * nothing moved. The array is replaced (not mutated) by the next reconcile, so
   * it is safe to hold on to.
   */
  lastChanges(): readonly SeatChange[] {
    return this.changes;
  }

  /** Person id at `layout.deskSeats[slotIndex]`, or null when the desk is empty. */
  deskOccupant(slotIndex: number): string | null {
    return this.deskOwners[slotIndex] ?? null;
  }

  /** Person id at `layout.overflowSpots[slotIndex]`, or null when the spot is empty. */
  overflowOccupant(slotIndex: number): string | null {
    return this.overflowOwners[slotIndex] ?? null;
  }

  /** The layout the current assignments were made for (null before the first reconcile). */
  currentLayout(): OfficeLayout | null {
    return this.layout;
  }

  /** Forget everything (a new run). The next reconcile seats everyone from scratch. */
  reset(): void {
    this.layout = null;
    this.seats.clear();
    this.deskOwners = [];
    this.overflowOwners = [];
    this.unseated = 0;
    this.beyondRoster = 0;
    this.changes = [];
  }

  private updateInPlace(people: readonly PersonView[], layout: OfficeLayout, changes: SeatChange[]): void {
    const roster = new Set<string>();
    for (const person of people) roster.add(person.id);

    // 1. People who left give their seat back. (Deleting during Map iteration is well defined.)
    for (const [personId, seat] of this.seats) {
      if (roster.has(personId)) continue;
      this.release(seat);
      this.seats.delete(personId);
      changes.push({ personId, from: seat, to: null });
    }

    // 2. Founders have reserved seats and can only ever be missing one (the
    //    cofounder joins when setup completes).
    for (const person of people) {
      if (person.kind === "employee" || this.seats.has(person.id)) continue;
      const seat =
        person.kind === "founder"
          ? makeSeat(layout.founderSeat, "founder", -1)
          : makeSeat(layout.cofounderSeat, "cofounder", -1);
      this.seats.set(person.id, seat);
      changes.push({ personId: person.id, from: null, to: seat });
    }

    // 3. Floor sitters have waited longest for a desk: they go first, lowest slot first.
    for (let slot = 0; slot < this.overflowOwners.length; slot += 1) {
      const personId = this.overflowOwners[slot];
      if (personId === null) continue;
      const desk = firstFree(this.deskOwners);
      if (desk < 0) break;
      const from = this.seats.get(personId) ?? null;
      const to = makeSeat(layout.deskSeats[desk], "desk", desk);
      this.overflowOwners[slot] = null;
      this.deskOwners[desk] = personId;
      this.seats.set(personId, to);
      changes.push({ personId, from, to });
    }

    // 4. Then everyone without a spot, in roster order.
    let unseated = 0;
    const handled = new Set<string>();
    for (const person of people) {
      if (person.kind !== "employee" || handled.has(person.id)) continue;
      handled.add(person.id);
      if (this.seats.has(person.id)) continue;
      const seat = this.claimSpot(person.id, layout);
      if (seat === null) {
        unseated += 1;
      } else {
        this.seats.set(person.id, seat);
        changes.push({ personId: person.id, from: null, to: seat });
      }
    }
    this.unseated = unseated;
  }

  private reseatEveryone(people: readonly PersonView[], layout: OfficeLayout, changes: SeatChange[]): void {
    const previous = new Map(this.seats);
    this.seats.clear();
    this.deskOwners = new Array<string | null>(layout.deskSeats.length).fill(null);
    this.overflowOwners = new Array<string | null>(layout.overflowSpots.length).fill(null);

    let unseated = 0;
    const roster: string[] = [];
    const handled = new Set<string>();
    for (const person of people) {
      // A roster never repeats an id; if one somehow does, the first entry wins.
      if (handled.has(person.id)) continue;
      handled.add(person.id);
      roster.push(person.id);
      const seat =
        person.kind === "founder"
          ? makeSeat(layout.founderSeat, "founder", -1)
          : person.kind === "cofounder"
            ? makeSeat(layout.cofounderSeat, "cofounder", -1)
            : this.claimSpot(person.id, layout);
      if (seat === null) unseated += 1;
      else this.seats.set(person.id, seat);
    }
    this.unseated = unseated;

    for (const [personId, from] of previous) {
      if (!handled.has(personId)) changes.push({ personId, from, to: null });
    }
    for (const personId of roster) {
      const from = previous.get(personId) ?? null;
      const to = this.seats.get(personId) ?? null;
      if (!sameSeat(from, to)) changes.push({ personId, from, to });
    }
  }

  /** Lowest free desk, else lowest free overflow spot, else null. Marks the spot as taken. */
  private claimSpot(personId: string, layout: OfficeLayout): Seat | null {
    const desk = firstFree(this.deskOwners);
    if (desk >= 0) {
      this.deskOwners[desk] = personId;
      return makeSeat(layout.deskSeats[desk], "desk", desk);
    }
    const spot = firstFree(this.overflowOwners);
    if (spot >= 0) {
      this.overflowOwners[spot] = personId;
      return makeSeat(layout.overflowSpots[spot], "overflow", spot);
    }
    return null;
  }

  private release(seat: Seat): void {
    if (seat.kind === "desk") this.deskOwners[seat.slotIndex] = null;
    else if (seat.kind === "overflow") this.overflowOwners[seat.slotIndex] = null;
  }
}
