/**
 * Who sits where.
 *
 * The cast says who is with the company, in which team and in what standing; it does not say where they sit. The
 * seating plan does, and it *remembers*: a person keeps a desk for as long as it still belongs to their team, so a
 * hire or a change of team moves as few people as it can.
 *
 * The rulings:
 *
 * 1. Desks are taken in fill order. Product has the first desks, Growth the next, Recruiting the next, each as many
 *    as it has people working or away. That run of desks is the team's area, and `teamOfDesk` reports it.
 * 2. A person whose desk is still in their team's area keeps it. The others give their desks up first, and then
 *    take, in id order, the lowest free desk of their team's area. So when one person changes team, at most two
 *    people walk if the two teams are neighbours in that order, and at most three between Product and Recruiting:
 *    Growth's area lies between them and moves along by a desk, so one of Growth's may have to walk as well.
 * 3. Someone away keeps a desk and is not drawn at it: the chair is empty and the screen dark.
 * 4. People leaving stand on the waiting spots nearest the door, then people expected. More of them than spots: the
 *    rest have no seat and are not drawn.
 * 5. More people working than desks: the last ones in fill order have no seat. `hiddenCount()` is `cast.hidden` plus
 *    the working people without a seat.
 * 6. In another office everyone is seated afresh, in id order, by the same rules.
 *
 * Where the rulings are silent:
 *
 * - A fresh cast (another run, or an earlier year) seats everyone afresh too, as another office does.
 * - A team's area stops where the desks stop: the teams later in the order may have a shorter area, or none.
 * - Someone away for whom there is no desk is not counted on the sign: the sign counts people who work here now.
 * - The waiting spots are handed out again on every reconcile, people leaving first, each group in id order. A
 *   person whose spot comes out the same keeps the same Seat object.
 *
 * Pure logic: no three.js, no DOM. Owned by the World, reconciled before the systems are handed a frame, and
 * exposed to them as `ctx.seating` (SeatingApi).
 */
import type { Cast, CastMember } from "../cast";
import { TEAMS } from "../types";
import type { OfficeLayout, Placement, Seat, SeatChange, SeatingApi, SeatKind, Team } from "../types";

export type { SeatChange } from "../types";

const samePlacement = (a: Placement, b: Placement): boolean => a === b || (a.x === b.x && a.z === b.z && a.facing === b.facing);

const samePlacements = (a: readonly Placement[], b: readonly Placement[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!samePlacement(a[i], b[i])) return false;
  }
  return true;
};

/** Can seats handed out for `a` be carried over to `b`? Looser than identity: the same office with the same places. */
const sameSeatGeometry = (a: OfficeLayout, b: OfficeLayout): boolean =>
  a === b || (a.office === b.office && samePlacements(a.deskSeats, b.deskSeats) && samePlacements(a.waitingSpots, b.waitingSpots));

// Seats are handed out by reference and shared, so they are frozen: a consumer
// that nudges `seat.x` would silently move the desk for everyone.
const makeSeat = (placement: Placement, kind: SeatKind, index: number): Seat =>
  Object.freeze({ x: placement.x, z: placement.z, facing: placement.facing, kind, index });

const sameSeat = (a: Seat | null, b: Seat | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.index === b.index && samePlacement(a, b));

const holdsDesk = (person: CastMember): boolean => person.standing === "working" || person.standing === "away";

/** The team whose desks a person working or away sits at. The cast always names one; Product if it somehow does not. */
const teamOf = (person: CastMember): Team => person.team ?? "product";

interface Area {
  /** First desk of the area, and the desk after its last. */
  readonly from: number;
  readonly to: number;
}

const NO_AREA: Area = { from: 0, to: 0 };

export class SeatingPlan implements SeatingApi {
  private layout: OfficeLayout | null = null;
  private runId: string | null = null;
  private year = 0;
  private readonly seats = new Map<string, Seat>();
  /** Person id per desk / waiting spot (null = free). Parallel to the layout's arrays. */
  private deskOwners: Array<string | null> = [];
  private waitingOwners: Array<string | null> = [];
  private areas: Record<Team, Area> = { product: NO_AREA, growth: NO_AREA, recruiting: NO_AREA };
  /** Working people the office has no desk for. */
  private unseated = 0;
  /** Staff the cast does not draw. */
  private beyondCast = 0;
  private changes: SeatChange[] = [];

  /** Bring the plan in line with the cast and the layout, by the rulings at the top of this file. */
  reconcile(cast: Cast, layout: OfficeLayout): void {
    const afresh =
      this.layout === null || !sameSeatGeometry(this.layout, layout) || this.runId !== cast.runId || cast.year < this.year;
    const previous = new Map(this.seats);
    if (afresh) {
      this.seats.clear();
      this.deskOwners = new Array<string | null>(layout.deskSeats.length).fill(null);
    }
    this.layout = layout;
    this.runId = cast.runId;
    this.year = cast.year;
    this.beyondCast = Number.isFinite(cast.hidden) ? Math.max(0, Math.floor(cast.hidden)) : 0;

    // A cast never repeats an id; if one somehow does, the first entry wins.
    const people: CastMember[] = [];
    const known = new Set<string>();
    for (const person of cast.people) {
      if (known.has(person.id)) continue;
      known.add(person.id);
      people.push(person);
    }

    this.drawAreas(people, layout);
    this.seatAtDesks(people, layout);
    this.standAtTheDoor(people, layout, previous);

    const changes: SeatChange[] = [];
    for (const [personId, from] of previous) {
      if (!known.has(personId)) changes.push({ personId, from, to: null });
    }
    for (const person of people) {
      const from = previous.get(person.id) ?? null;
      const to = this.seats.get(person.id) ?? null;
      if (!sameSeat(from, to)) changes.push({ personId: person.id, from, to });
    }
    this.changes = changes;
  }

  /**
   * null when the person has no visible spot (or is not in the cast).
   * The same Seat object is returned for as long as the person's seat is
   * unchanged, so `seat !== previousSeat` is a valid, cheap "did they move?" test.
   */
  seatOf(personId: string): Seat | null {
    return this.seats.get(personId) ?? null;
  }

  /** The team whose area the desk is in, or null when no team has it (or there is no such desk). */
  teamOfDesk(index: number): Team | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.deskOwners.length) return null;
    for (const team of TEAMS) {
      const area = this.areas[team];
      if (index >= area.from && index < area.to) return team;
    }
    return null;
  }

  /** Indices into layout.deskSeats that nobody holds, ascending. A fresh array on every call. */
  freeDeskSlots(): number[] {
    const free: number[] = [];
    for (let i = 0; i < this.deskOwners.length; i += 1) {
      if (this.deskOwners[i] === null) free.push(i);
    }
    return free;
  }

  /** Everybody who works here and is not shown: the cast's hidden ones plus the working people without a desk. */
  hiddenCount(): number {
    return this.beyondCast + this.unseated;
  }

  /**
   * Seat moves made by the most recent `reconcile`: people who are gone first, then everyone else in id order.
   * Empty when nothing moved. The array is replaced (not mutated) by the next reconcile, so it is safe to hold.
   */
  lastChanges(): readonly SeatChange[] {
    return this.changes;
  }

  /** Person id at `layout.deskSeats[index]` (someone away included), or null when nobody holds the desk. */
  deskOccupant(index: number): string | null {
    return this.deskOwners[index] ?? null;
  }

  /** Person id at `layout.waitingSpots[index]`, or null when the spot is empty. */
  waitingOccupant(index: number): string | null {
    return this.waitingOwners[index] ?? null;
  }

  /** The layout the current seats were handed out for (null before the first reconcile). */
  currentLayout(): OfficeLayout | null {
    return this.layout;
  }

  /** Forget everything (a new run). The next reconcile seats everyone from scratch. */
  reset(): void {
    this.layout = null;
    this.runId = null;
    this.year = 0;
    this.seats.clear();
    this.deskOwners = [];
    this.waitingOwners = [];
    this.areas = { product: NO_AREA, growth: NO_AREA, recruiting: NO_AREA };
    this.unseated = 0;
    this.beyondCast = 0;
    this.changes = [];
  }

  /** Ruling 1: each team's run of desks, in the order of the teams. */
  private drawAreas(people: readonly CastMember[], layout: OfficeLayout): void {
    const desks = layout.deskSeats.length;
    const areas: Record<Team, Area> = { product: NO_AREA, growth: NO_AREA, recruiting: NO_AREA };
    let next = 0;
    for (const team of TEAMS) {
      let count = 0;
      for (const person of people) if (holdsDesk(person) && teamOf(person) === team) count += 1;
      const from = Math.min(next, desks);
      const to = Math.min(next + count, desks);
      areas[team] = { from, to };
      next += count;
    }
    this.areas = areas;
  }

  /** Rulings 2 and 5: who keeps a desk, who gives one up, and who takes which. */
  private seatAtDesks(people: readonly CastMember[], layout: OfficeLayout): void {
    const holders = new Map<string, CastMember>();
    for (const person of people) if (holdsDesk(person)) holders.set(person.id, person);

    // First everyone whose desk is no longer theirs gives it up: people who are gone or no longer hold a desk, and
    // people whose desk has passed to another team.
    for (let index = 0; index < this.deskOwners.length; index += 1) {
      const personId = this.deskOwners[index];
      if (personId === null) continue;
      const holder = holders.get(personId);
      const area = holder ? this.areas[teamOf(holder)] : NO_AREA;
      if (index >= area.from && index < area.to) continue;
      this.deskOwners[index] = null;
      this.seats.delete(personId);
    }

    // Then, in id order, everyone without a desk takes the lowest free one of their team's area.
    let unseated = 0;
    for (const person of people) {
      if (!holdsDesk(person)) continue;
      if (this.seats.get(person.id)?.kind === "desk") continue;
      this.seats.delete(person.id);
      const area = this.areas[teamOf(person)];
      let desk = -1;
      for (let index = area.from; index < area.to; index += 1) {
        if (this.deskOwners[index] === null) {
          desk = index;
          break;
        }
      }
      if (desk < 0) {
        if (person.standing === "working") unseated += 1;
        continue;
      }
      this.deskOwners[desk] = person.id;
      this.seats.set(person.id, makeSeat(layout.deskSeats[desk], "desk", desk));
    }
    this.unseated = unseated;
  }

  /** Ruling 4: people leaving on the spots nearest the door, then people expected. */
  private standAtTheDoor(people: readonly CastMember[], layout: OfficeLayout, previous: ReadonlyMap<string, Seat>): void {
    for (const [personId, seat] of this.seats) {
      if (seat.kind === "waiting") this.seats.delete(personId);
    }
    const spots = layout.waitingSpots;
    this.waitingOwners = new Array<string | null>(spots.length).fill(null);
    const line = [...people.filter((person) => person.standing === "leaving"), ...people.filter((person) => person.standing === "waiting")];
    for (let index = 0; index < line.length; index += 1) {
      const person = line[index];
      // Somebody who held a desk a moment ago and found no spot here simply has no seat.
      this.seats.delete(person.id);
      if (index >= spots.length) continue;
      const before = previous.get(person.id);
      const kept = before !== undefined && before.kind === "waiting" && before.index === index && samePlacement(before, spots[index]);
      this.waitingOwners[index] = person.id;
      this.seats.set(person.id, kept ? before : makeSeat(spots[index], "waiting", index));
    }
  }
}
