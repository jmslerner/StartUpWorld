/**
 * The director of the office's little people.
 *
 * The Crew owns one Actor per person who is drawn somewhere: at a desk, or standing at the door. It keeps that cast
 * in line with every frame, and the cast says how each person moves:
 *
 *   • somebody in `cast.arrived` walks in through the door;
 *   • somebody in `cast.left` walks out, carrying a box if they worked here;
 *   • somebody whose seat changed walks to it;
 *   • somebody whose team changed changes shirt (the Actor's `team`, which the body follows);
 *   • somebody who goes away walks out empty-handed, and walks back in when they return;
 *   • somebody let go packs a box and stands with it at the door until the year has played out;
 *   • on a fresh cast, a reset or reduced motion everyone is simply placed, and in another office everyone pops in
 *     at the new seats once the building is up.
 *
 * Between frames it runs a little ambient life: now and then somebody wanders to the coffee machine and back. That
 * only happens for a while after a frame, so the office always comes to rest (see `busy`).
 *
 * It is pure: no three.js and no DOM. Everything visible goes through CrewHost, which the EmployeeSystem implements
 * with real characters and which tests implement with a recorder. All randomness comes from seeded generators, so a
 * given sequence of frames always plays out the same way.
 */
import type { Cast, CastMember } from "../cast";
import { doorExterior } from "../office/layouts";
import { REBUILD_POP_SECONDS, REBUILD_POP_START } from "../office/timing";
import type { BubbleIcon, OfficeLayout, Seat, SeatingApi, Vec2, WorldFrame } from "../types";
import { Actor } from "./actor";
import type { ActorStage, ErrandLeg } from "./actor";
import { Rng } from "./random";

// ─────────────────────────────────────────────────────────────────────────────
// Tuning
// ─────────────────────────────────────────────────────────────────────────────

/** Gap between people filing in (or out) when several arrive at once. */
export const ENTRY_STAGGER = 0.4;
/** A queue of arrivals never makes anyone wait longer than this to appear. */
const MAX_ENTRY_WAIT = 5;
/** How far outside the doorway arrivals appear and leavers disappear. */
const DOOR_STEP = 0.8;

/**
 * When the company changes office everyone is hidden while it is rebuilt, then pops in
 * over REBUILD_SPREAD. The new office's desks are the first of its contents to
 * pop in (from REBUILD_POP_START, each taking REBUILD_POP_SECONDS): people follow
 * once their chairs are nearly full size, and the last of them has finished
 * appearing just inside 1.5 s.
 */
const REBUILD_HIDE = REBUILD_POP_START + REBUILD_POP_SECONDS * 0.85;
const REBUILD_SPREAD = 0.4;
const REBUILD_STEP = 0.035;

/** A new year: whoever is away from their seat has this long to trot back before being snapped into it. */
const YEAR_SNAP = 0.7;
/** Arrivals and departures that come with a new year wait for the lighting's sweep before they start. */
export const YEAR_DELAY = 1.3;
/**
 * Leavers walk out in single file, keeping DOOR_QUEUE_GAP behind whoever is nearer
 * the way out; within DOOR_QUEUE_RANGE of it they also stop for anybody coming in.
 */
const DOOR_QUEUE_RANGE = 3.5;
export const DOOR_QUEUE_GAP = 0.65;
/**
 * For this long after a frame somebody may still set off to wander. After it nobody starts a trip, so with every
 * trip on a watchdog the office is still within a minute of the last frame, and the drawing loop can rest.
 */
export const LIVELY_SECONDS = 15;

type ReconcileMode =
  /** A fresh cast, a reset or reduced motion: everyone simply is where they belong. */
  | "instant"
  /** The office itself changed: hide, then pop in at the new seats. */
  | "rebuild"
  /** Business as usual: people walk in, walk out and walk over. */
  | "live";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/** How many people may be away from their desks wandering at once: about one in eight, at most five. */
export const wanderCap = (people: number): number => Math.min(5, Math.max(1, Math.round(people / 8)));

/** Does this cast start from nothing: no cast before it, another run, or an earlier year? */
const isFresh = (next: Cast, prev: Cast | null): boolean => prev === null || prev.runId !== next.runId || next.year < prev.year;

const isStaff = (person: CastMember): boolean => person.standing !== "waiting";

/**
 * The arrivals who were in the building all along. At the cast's cap, people who were counted on the sign take the
 * places of drawn people who left; the cast gives them new ids and lists them as arrived. They do not walk in from
 * the door: as many staff arrivals as the previous cast had hidden people, in id order, are simply there.
 */
export const alreadyInside = (next: Cast, prev: Cast | null): Set<string> => {
  const inside = new Set<string>();
  if (prev === null || !(prev.hidden > 0)) return inside;
  const arrived = new Set(next.arrived);
  for (const person of next.people) {
    if (inside.size >= prev.hidden) break;
    if (arrived.has(person.id) && isStaff(person)) inside.add(person.id);
  }
  return inside;
};

// ─────────────────────────────────────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the Crew needs done in the visible world. */
export interface CrewHost {
  /** A new actor joined the cast: give it a body (it may start invisible). */
  spawn(actor: Actor): void;
  /** The actor is on their way out: it should no longer be clickable as that person. */
  retire(actor: Actor): void;
  /** The actor is finished with: free its body. Always follows `spawn`, and `retire` when they walked out. */
  despawn(actor: Actor): void;
  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void;
  /** A small puff of dust on the floor (somebody sat down). */
  dust(x: number, z: number): void;
}

export interface CrewOptions {
  reducedMotion: boolean;
  /** Seed for the ambient scheduler (default: fixed). */
  seed?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew
// ─────────────────────────────────────────────────────────────────────────────

export class Crew implements ActorStage {
  layout: OfficeLayout;

  private readonly host: CrewHost;
  private readonly reducedMotion: boolean;
  private readonly rng: Rng;

  private readonly actors = new Map<string, Actor>();
  /** The cast in id order — what `update` iterates, so a frame allocates nothing. */
  private readonly order: Actor[] = [];
  /** People on their way out. They are no longer in `actors`, so somebody who comes back gets a new actor. */
  private readonly leavers: Actor[] = [];
  private readonly seen = new Set<string>();
  /** Scratch list for picking people. */
  private readonly pool: Actor[] = [];

  private time = 0;
  private nextEntryAt = 0;
  private nextExitAt = 0;
  /** Extra wait applied to arrivals / departures of the frame being applied. */
  private batchHold = 0;

  private wanderTimer: number;
  private lastWanderer: Actor | null = null;
  /** Nobody sets off to wander after this time. */
  private livelyUntil = 0;

  constructor(host: CrewHost, layout: OfficeLayout, options: CrewOptions) {
    this.host = host;
    this.layout = layout;
    this.reducedMotion = options.reducedMotion;
    this.rng = new Rng(options.seed ?? 0x0ff1ce);
    this.wanderTimer = this.rng.range(4, 8);
  }

  // ── Read access ─────────────────────────────────────────────────────────────

  /** Everyone drawn who is with the company (or expected), in id order. */
  get cast(): readonly Actor[] {
    return this.order;
  }

  /** People who are walking out (or shrinking away). */
  get departing(): readonly Actor[] {
    return this.leavers;
  }

  actor(personId: string): Actor | null {
    return this.actors.get(personId) ?? null;
  }

  get now(): number {
    return this.time;
  }

  /**
   * True while anybody is still on the move: waiting for a turn at the door, walking, settling, popping in,
   * walking out. False once everyone is at their place — however much they type, sway or breathe there — so the
   * drawing loop can rest. Every one of those ends by itself: each mode of an Actor runs on a timer or a watchdog.
   */
  busy(): boolean {
    if (this.leavers.length > 0) return true;
    for (let i = 0; i < this.order.length; i += 1) if (this.order[i].busy) return true;
    return false;
  }

  // ── Frames ──────────────────────────────────────────────────────────────────

  applyFrame(next: WorldFrame, prev: WorldFrame | null, seating: SeatingApi, layout: OfficeLayout): void {
    const fresh = isFresh(next.cast, prev?.cast ?? null) || next.events.some((event) => event.kind === "run-reset");
    const instant = fresh || this.reducedMotion;
    const rebuilt = !instant && layout.office !== this.layout.office;
    const mode: ReconcileMode = instant ? "instant" : rebuilt ? "rebuild" : "live";
    this.layout = layout;

    if (mode !== "live") this.clearTransients(fresh);
    else if (next.events.some((event) => event.kind === "year-advanced")) this.startYear();

    this.reconcile(next.cast, prev?.cast ?? null, seating, mode);
    this.batchHold = 0;
    this.livelyUntil = mode === "instant" ? 0 : this.time + LIVELY_SECONDS;
  }

  /** Bring the actors in line with who is drawn where right now. */
  private reconcile(cast: Cast, prev: Cast | null, seating: SeatingApi, mode: ReconcileMode): void {
    const { seen, order } = this;
    const arrived = new Set(cast.arrived);
    const left = new Set(cast.left);
    const inside = mode === "live" ? alreadyInside(cast, prev) : null;
    const rebuildStep = Math.min(REBUILD_STEP, REBUILD_SPREAD / Math.max(1, cast.people.length));
    seen.clear();
    order.length = 0;

    for (const person of cast.people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      const seat = seating.seatOf(person.id);
      // Someone away keeps a desk and is not at it.
      const wanted = seat !== null && person.standing !== "away";

      let actor = this.actors.get(person.id) ?? null;
      if (actor && actor.look !== person.look) {
        // The id now belongs to somebody else entirely; never morph one person into another.
        this.remove(actor);
        actor = null;
      }
      if (!wanted || seat === null) {
        if (actor) this.dismiss(actor, person.standing === "away" ? "away" : "unseated", mode);
        continue;
      }

      const popDelay = REBUILD_HIDE + order.length * rebuildStep;
      if (!actor) {
        actor = this.hire(person, seat);
        if (mode === "instant") actor.placeAtHome();
        else if (mode === "rebuild") actor.popInAtHome(popDelay);
        else if (this.walksIn(person, arrived, inside, prev)) this.walkIn(actor);
        else actor.popInAtHome(0);
      } else {
        actor.person = person;
        if (mode === "instant") this.place(actor, seat);
        else if (mode === "rebuild") actor.relocate(seat, popDelay);
        else actor.rehome(seat, this);
      }
      // A shirt is kept until there is another team to wear: somebody let go leaves in the one they had.
      if (person.team !== null) actor.team = person.team;
      actor.packed = person.standing === "leaving";
      // The frame is drawn before the next update: the pose has to be right already.
      actor.resolvePose();
      order.push(actor);
    }

    // Whoever is no longer in the cast at all.
    for (const actor of this.actors.values()) {
      if (!seen.has(actor.id)) this.dismiss(actor, left.has(actor.id) ? "left" : "unseated", mode);
    }
  }

  /**
   * Does a person who has just been given a body come in through the door? Yes if they have arrived (unless they
   * were in the building all along, counted on the sign) or are back from being away. Anybody else who gains a
   * place without arriving (a desk came free in a full office, a spot at the door) simply appears.
   */
  private walksIn(person: CastMember, arrived: ReadonlySet<string>, inside: ReadonlySet<string> | null, prev: Cast | null): boolean {
    if (arrived.has(person.id)) return !(inside?.has(person.id) ?? false);
    return prev?.people.some((before) => before.id === person.id && before.standing === "away") ?? false;
  }

  private hire(person: CastMember, seat: Seat): Actor {
    const actor = new Actor(person, seat);
    this.actors.set(person.id, actor);
    this.host.spawn(actor);
    return actor;
  }

  /** Be at this seat, now. */
  private place(actor: Actor, seat: Seat): void {
    if (actor.home === seat && !actor.busy) return;
    actor.home = seat;
    actor.placeAtHome();
  }

  /** Queue an arrival through the door: people file in ENTRY_STAGGER apart. */
  private walkIn(actor: Actor): void {
    const earliest = this.time + this.batchHold;
    const at = Math.min(Math.max(earliest, this.nextEntryAt), earliest + MAX_ENTRY_WAIT);
    this.nextEntryAt = at + ENTRY_STAGGER;
    actor.enterFrom(doorExterior(this.layout, DOOR_STEP), this.layout.door.facing, at - this.time, true);
  }

  /**
   * An actor has no place in the office any more: they left the company ("left"), went away for the year ("away"),
   * or are still with it and the office has no room to draw them ("unseated").
   */
  private dismiss(actor: Actor, why: "left" | "away" | "unseated", mode: ReconcileMode): void {
    if (mode !== "live") {
      this.remove(actor);
      return;
    }
    this.actors.delete(actor.id);
    actor.dismissed = true;
    this.host.retire(actor);
    this.leavers.push(actor);

    if (why === "unseated") {
      actor.vanish();
      return;
    }
    const earliest = this.time + this.batchHold;
    const at = Math.min(Math.max(earliest, this.nextExitAt), earliest + MAX_ENTRY_WAIT);
    this.nextExitAt = at + ENTRY_STAGGER;
    // Whoever worked here takes their things. Somebody who was only expected has none, and somebody away is coming back.
    const carrying = why === "left" && actor.person.standing !== "waiting";
    actor.leave(doorExterior(this.layout, DOOR_STEP), at - this.time, carrying);
  }

  /** Take an actor out of the world immediately. */
  private remove(actor: Actor): void {
    if (this.actors.get(actor.id) === actor) this.actors.delete(actor.id);
    actor.dismissed = true;
    this.host.despawn(actor);
  }

  /** Drop everything that is in flight: a fresh start (`everything`), or a new office or a placement. */
  private clearTransients(everything: boolean): void {
    for (const actor of this.leavers) this.host.despawn(actor);
    this.leavers.length = 0;
    this.lastWanderer = null;
    this.nextEntryAt = 0;
    this.nextExitAt = 0;
    if (!everything) return;
    for (const actor of this.order) this.remove(actor);
    // Anyone the cast order did not know about (there should be nobody).
    for (const actor of this.actors.values()) this.remove(actor);
    this.actors.clear();
    this.order.length = 0;
  }

  /** A new year: everyone back to their places while the light sweeps round. */
  private startYear(): void {
    for (const actor of this.order) {
      actor.clearEmote();
      if (actor.away) actor.hurry(YEAR_SNAP, this);
    }
    for (const actor of this.leavers) actor.hurry(YEAR_SNAP, this);
    this.wanderTimer = this.rng.range(4, 8);
    // Anyone who arrives or leaves with the new year does it after the sweep.
    this.batchHold = YEAR_DELAY;
  }

  // ── Ambient life ────────────────────────────────────────────────────────────

  /** Is this a moment when people may leave their desks of their own accord? */
  private canRoam(): boolean {
    return !this.reducedMotion && this.time < this.livelyUntil;
  }

  private tickWander(dt: number): void {
    this.wanderTimer -= dt;
    if (this.wanderTimer > 0) return;
    const people = this.order.length;
    // Bigger teams start trips more often, so the share of people on their feet stays similar.
    this.wanderTimer = this.rng.range(7, 13) / Math.min(3.5, Math.max(1, people / 8));
    if (!this.canRoam()) return;

    let out = 0;
    const { pool } = this;
    pool.length = 0;
    for (const actor of this.order) {
      if (actor.errand === "wander") out += 1;
      // Only people at a desk wander: whoever stands at the door is waiting there.
      else if (actor.home.kind === "desk" && actor.seatedIdle && actor.mood === "work" && actor !== this.lastWanderer) pool.push(actor);
    }
    if (out >= wanderCap(people) || pool.length === 0) return;

    const spot = this.pickWanderSpot();
    if (!spot) return;
    const actor = pool[this.rng.index(pool.length)];
    this.lastWanderer = actor;
    actor.runErrand("wander", [spot], this);
  }

  /** A hang-out spot nobody else is using or heading for: the coffee machine or one of the layout's wander spots. */
  private pickWanderSpot(): ErrandLeg | null {
    const coffee = this.layout.stationStandSpots.coffee;
    const spots = this.layout.wanderSpots;
    const total = spots.length + 1;
    // Start somewhere random and take the first free one, so no list has to be built.
    const start = this.rng.index(total);
    for (let i = 0; i < total; i += 1) {
      const index = (start + i) % total;
      const isCoffee = index === spots.length;
      const spot = isCoffee ? coffee : spots[index];
      if (this.spotTaken(spot)) continue;
      return {
        x: spot.x,
        z: spot.z,
        facing: spot.facing,
        pause: isCoffee ? this.rng.range(2.6, 4) : this.rng.range(2.4, 4.6),
        bubble: isCoffee ? "coffee" : null,
      };
    }
    return null;
  }

  private spotTaken(spot: Vec2): boolean {
    for (const actor of this.order) {
      const stop = actor.errandStop;
      if (stop && Math.hypot(stop.x - spot.x, stop.z - spot.z) < 0.4) return true;
    }
    return false;
  }

  // ── Per frame ───────────────────────────────────────────────────────────────

  update(dt: number): void {
    this.time += dt;

    for (let i = 0; i < this.order.length; i += 1) this.order[i].update(dt, this);
    for (let i = this.leavers.length - 1; i >= 0; i -= 1) {
      const actor = this.leavers[i];
      actor.update(dt, this);
      if (!actor.gone) continue;
      this.leavers.splice(i, 1);
      this.host.despawn(actor);
    }

    this.tickWander(dt);
  }

  /** Remove everybody (the system is being disposed). */
  dispose(): void {
    this.clearTransients(true);
  }

  // ── ActorStage ──────────────────────────────────────────────────────────────

  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void {
    if (actor.dismissed) return;
    this.host.bubble(actor, icon, seconds);
  }

  settled(actor: Actor): void {
    this.host.dust(actor.home.x, actor.home.z);
  }

  // The three door checks below scan the cast live, each time they are asked, on
  // purpose: earlier actors in the same frame may already have appeared at the door,
  // set off, re-pathed or reached the door, and the answer has to reflect that. A
  // list taken at the top of the frame lets a newcomer and a leaver cross in the
  // doorway, and lets leavers step into the person ahead. With at most 56 people,
  // a scan of cheap checks per asking actor is affordable, and it allocates nothing.

  /** Newcomers wait outside while anybody is on their way out, so the two never meet in the doorway. */
  holdArrival(actor: Actor): boolean {
    void actor;
    for (const leaver of this.leavers) if (leaver.exiting) return true;
    return false;
  }

  /** Leavers give way to newcomers already on their way in: they stay where they are, or stop short of the door. */
  holdExit(actor: Actor): boolean {
    if (actor.mode === "walking" && actor.distanceLeft >= DOOR_QUEUE_RANGE) return false;
    for (const other of this.order) if (other.arriving) return true;
    return false;
  }

  /** Leavers file out in single file, a step behind whoever is nearer the way out. */
  queueBehind(actor: Actor): boolean {
    const left = actor.distanceLeft;
    for (const other of this.leavers) {
      if (other === actor || other.mode !== "walking" || !other.visible) continue;
      if (other.distanceLeft < left && Math.hypot(other.x - actor.x, other.z - actor.z) < DOOR_QUEUE_GAP) return true;
    }
    return false;
  }
}
