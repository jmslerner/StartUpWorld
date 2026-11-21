/**
 * The director of the office's little people.
 *
 * The Crew owns one Actor per person who has a seat, keeps that cast in line
 * with every snapshot (arrivals, departures, seat moves, a whole new office),
 * turns WorldEvents into reactions (code bubbles, cheers, slumps, the walk out
 * after a lost run) and runs the ambient life in between: wandering for coffee,
 * dozing when morale is low, the founder pacing when stress is high.
 *
 * It is pure: no three.js and no DOM. Everything visible goes through CrewHost,
 * which the EmployeeSystem implements with real characters and which tests
 * implement with a recorder. All randomness comes from seeded generators, so a
 * given sequence of snapshots always plays out the same way.
 */
import type { EndingType, TeamRole } from "../../types/game";
import { doorExterior, forwardOf, isWalkable } from "../office/layouts";
import { REBUILD_POP_SECONDS, REBUILD_POP_START } from "../office/timing";
import { isPromotion, WIN_ENDINGS } from "../outcomes";
import type {
  BubbleIcon,
  OfficeLayout,
  PersonView,
  Placement,
  Seat,
  SeatingApi,
  StationKind,
  Vec2,
  WorldEvent,
  WorldSnapshot,
} from "../types";
import { Actor } from "./actor";
import type { ActorStage, Emote, ErrandLeg, Routine } from "./actor";
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

/** Morale below which people start to slump and doze; above HIGH_MORALE they show it. */
export const LOW_MORALE = 35;
export const HIGH_MORALE = 70;
/** Stress above which the founder frets and paces. */
export const HIGH_STRESS = 70;

/** Most bubbles a single group reaction may put up at once (the fx layer has its own, higher, cap). */
export const MAX_GROUP_BUBBLES = 8;
/** A group reaction ripples through the room over at most this long. */
const RIPPLE_SPREAD = 0.6;
const RIPPLE_STEP = 0.05;

/**
 * On a phase change everyone is hidden while the office is rebuilt, then pops in
 * over REBUILD_SPREAD. The new office's desks are the first of its contents to
 * pop in (from REBUILD_POP_START, each taking REBUILD_POP_SECONDS): people follow
 * once their chairs are nearly full size, and the last of them has finished
 * appearing just inside 1.5 s.
 */
const REBUILD_HIDE = REBUILD_POP_START + REBUILD_POP_SECONDS * 0.85;
const REBUILD_SPREAD = 0.4;
const REBUILD_STEP = 0.035;

/** A new week: whoever is away has this long to trot back before being snapped into their seat. */
const MORNING_SNAP = 0.7;
/** Arrivals and departures that come with a new week wait for the sunrise sweep before they start. */
const MORNING_DELAY = 1.3;
/** After a lost run: how long everyone sits slumped before the first person leaves, and how long the exodus takes. */
const EXODUS_DELAY = 1.8;
const EXODUS_STAGGER = 0.45;
const EXODUS_SPREAD = 8;
/**
 * Leavers walk out in single file, keeping DOOR_QUEUE_GAP behind whoever is nearer
 * the way out; within DOOR_QUEUE_RANGE of it they also stop for anybody coming in.
 */
const DOOR_QUEUE_RANGE = 3.5;
const DOOR_QUEUE_GAP = 0.65;
/** After the run ends, people who are away get this long to come back. */
const OUTCOME_SNAP = 1.5;
/** Nobody wanders while a ship / launch reaction is playing out. */
const REACTION_QUIET = 3.2;

const BUILDER_ROLES: readonly TeamRole[] = ["engineering", "design", "product"];
const GROWTH_ROLES: readonly TeamRole[] = ["marketing", "sales"];

const FOUNDER_ID = "founder";

type Outcome = "none" | "win" | "loss";
type ReconcileMode =
  /** First snapshot / new run: everyone simply is where they belong. */
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

/** Character energy (0 … 1) for a person, from team morale — and, for the founder, their own stress. */
export const energyFor = (kind: PersonView["kind"], morale: number, stress: number): number => {
  const fromMorale = 0.3 + 0.7 * Math.min(1, Math.max(0, morale / 100));
  if (kind !== "founder") return fromMorale;
  const frazzled = Math.min(1, Math.max(0, (stress - 50) / 50));
  return Math.max(0.15, fromMorale - 0.35 * frazzled);
};

/**
 * A named person's own energy (0–100) caps how lively they look: a crunching crew slouches and
 * slows down whatever the company's morale is. Unknown (unlisted heads, founders): no cap.
 */
export const personalEnergyCap = (energy: number | undefined): number =>
  energy === undefined ? 1 : 0.2 + 0.8 * Math.min(1, Math.max(0, energy / 100));

/**
 * Up to `max` indices out of `count`, evenly spread and always including the
 * first: which members of a big team get a bubble when all of them cannot.
 */
export const spreadIndices = (count: number, max: number): number[] => {
  if (count <= 0 || max <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.floor((i * count) / max));
};

/**
 * One or two clear spots near a seat for its owner to pace between: behind the
 * chair when there is room, otherwise beside it or out in front of the desk
 * (a founder's desk is often backed up against a wall). Empty when the seat is
 * completely hemmed in.
 */
export const pacePoints = (layout: OfficeLayout, seat: Placement): Vec2[] => {
  const forward = forwardOf(seat.facing);
  // Perpendicular to the facing, on the floor.
  const side = { x: forward.z, z: -forward.x };
  // Negative `back` is in front of the seat; -1.6 clears the desk.
  const candidates: Array<[back: number, across: number]> = [
    [1.0, 1.1],
    [1.0, -1.1],
    [1.1, 0],
    [1.7, 0.7],
    [1.7, -0.7],
    [0.2, 1.4],
    [0.2, -1.4],
    [-1.6, 0.9],
    [-1.6, -0.9],
  ];
  const clear: Vec2[] = [];
  for (const [back, across] of candidates) {
    const point = { x: seat.x - forward.x * back + side.x * across, z: seat.z - forward.z * back + side.z * across };
    if (isWalkable(layout, point)) clear.push(point);
  }
  if (clear.length <= 1) return clear;
  const first = clear[0];
  let far = clear[1];
  for (const point of clear) {
    if (Math.hypot(point.x - first.x, point.z - first.z) > Math.hypot(far.x - first.x, far.z - first.z)) far = point;
  }
  return [first, far];
};

const outcomeOf = (ending: EndingType | null): Outcome => (ending === null ? "none" : WIN_ENDINGS.has(ending) ? "win" : "loss");

const hasEvent = (events: readonly WorldEvent[], type: WorldEvent["type"]): boolean => events.some((event) => event.type === type);

/**
 * Does a hired / departed event in this batch name this person? Only the people it
 * names walk in or out; anybody else who gains or loses a place in the office
 * without being hired or let go (a desk freed up, the office ran out of room)
 * simply appears or fades.
 */
const coveredBy = (events: readonly WorldEvent[], type: "hired" | "departed", id: string): boolean =>
  events.some((event) => event.type === type && event.personIds.includes(id));

// ─────────────────────────────────────────────────────────────────────────────
// Host
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the Crew needs done in the visible world. */
export interface CrewHost {
  /** A new actor joined the cast: give it a body (it may start invisible). */
  spawn(actor: Actor): void;
  /** `actor.person` changed in a way the outside world shows (their name). */
  renamed(actor: Actor): void;
  /** The actor is on their way out: it should no longer be clickable as that person. */
  retire(actor: Actor): void;
  /** The actor is finished with: free its body. Always follows `spawn`, and `retire` when they walked out. */
  despawn(actor: Actor): void;
  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void;
  /** A small puff of dust on the floor (somebody sat down). */
  dust(x: number, z: number): void;
  /** Sparkles from the actor's head to a station. */
  stream(actor: Actor, station: StationKind): void;
}

export interface CrewOptions {
  reducedMotion: boolean;
  /** Seed for the ambient schedulers (default: fixed). */
  seed?: number;
  /**
   * Most bubbles (and sparkle streams) one group reaction may show. Default
   * MAX_GROUP_BUBBLES; small screens want fewer, because bubbles keep a minimum
   * size in pixels and pile up when the office is drawn small.
   */
  maxGroupBubbles?: number;
}

/** Something scheduled to happen to one actor a moment from now (how reactions ripple). */
interface Cue {
  at: number;
  actor: Actor;
  bubble: BubbleIcon | null;
  bubbleSeconds: number;
  emote: Emote | null;
  emoteSeconds: number;
  stream: StationKind | null;
}

interface CueSpec {
  bubble?: BubbleIcon;
  bubbleSeconds?: number;
  emote?: Emote;
  emoteSeconds?: number;
  stream?: StationKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew
// ─────────────────────────────────────────────────────────────────────────────

export class Crew implements ActorStage {
  layout: OfficeLayout;

  private readonly host: CrewHost;
  private readonly reducedMotion: boolean;
  private readonly maxGroupBubbles: number;
  private readonly rng: Rng;

  private readonly actors = new Map<string, Actor>();
  /** The cast in roster order — what `update` iterates, so a frame allocates nothing. */
  private readonly order: Actor[] = [];
  /** People on their way out. They are no longer in `actors`, so their id can be re-used by a new hire. */
  private readonly leavers: Actor[] = [];
  private readonly cues: Cue[] = [];
  private readonly seen = new Set<string>();
  /** Scratch list for picking people. */
  private readonly pool: Actor[] = [];

  private time = 0;
  /** Named people's own energy, by id (from the snapshot's staff). */
  private personal: ReadonlyMap<string, number> = new Map();
  private morale = 60;
  private stress = 0;
  private setupComplete = false;
  private outcome: Outcome = "none";

  private nextEntryAt = 0;
  private nextExitAt = 0;
  /** Extra wait applied to arrivals / departures of the snapshot being applied. */
  private batchHold = 0;
  private exodusCount = 0;
  private exodusStep = EXODUS_STAGGER;

  private wanderTimer: number;
  private paceTimer: number;
  private ambientTimer: number;
  private lastWanderer: Actor | null = null;
  /** No wandering before this time (a ship / launch reaction is playing). */
  private quietUntil = 0;
  /** When the founder's next bubble may start, so several in one batch play in sequence. */
  private founderLine = 0;

  constructor(host: CrewHost, layout: OfficeLayout, options: CrewOptions) {
    this.host = host;
    this.layout = layout;
    this.reducedMotion = options.reducedMotion;
    this.maxGroupBubbles = Math.max(1, options.maxGroupBubbles ?? MAX_GROUP_BUBBLES);
    this.rng = new Rng(options.seed ?? 0x0ff1ce);
    this.wanderTimer = this.rng.range(4, 8);
    this.paceTimer = this.rng.range(3, 6);
    this.ambientTimer = this.rng.range(2, 5);
  }

  // ── Read access ─────────────────────────────────────────────────────────────

  /** Everyone on the books, in roster order. */
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

  // ── Snapshots ───────────────────────────────────────────────────────────────

  applySnapshot(
    next: WorldSnapshot,
    prev: WorldSnapshot | null,
    events: readonly WorldEvent[],
    seating: SeatingApi,
    layout: OfficeLayout
  ): void {
    const instant = prev === null || hasEvent(events, "run-reset");
    const rebuilt = !instant && layout.phase !== this.layout.phase;
    const mode: ReconcileMode = instant ? "instant" : rebuilt ? "rebuild" : "live";
    this.layout = layout;
    this.morale = next.morale;
    this.stress = next.stress;
    this.personal = new Map((next.staff ?? []).map((view) => [view.id, view.energy]));
    this.setupComplete = next.setupComplete;
    const outcome = outcomeOf(next.gameOver);
    const outcomeChanged = outcome !== this.outcome;
    this.outcome = outcome;

    if (mode !== "live") this.clearTransients(instant);
    else if (hasEvent(events, "week-advanced")) this.startMorning();

    if (mode === "live" && outcomeChanged && outcome === "loss") this.planExodus();
    this.reconcile(next, events, seating, mode, outcomeChanged);
    this.applyRoutines();
    this.batchHold = 0;

    if (instant) return;
    if (outcomeChanged) this.settleForOutcome();
    this.react(events);
  }

  /** Bring the cast in line with who has a seat right now. */
  private reconcile(
    next: WorldSnapshot,
    events: readonly WorldEvent[],
    seating: SeatingApi,
    mode: ReconcileMode,
    outcomeChanged: boolean
  ): void {
    const { seen, order } = this;
    const welcome = hasEvent(events, "setup-completed");
    const rebuildStep = Math.min(REBUILD_STEP, REBUILD_SPREAD / Math.max(1, next.people.length));
    seen.clear();
    order.length = 0;

    for (const person of next.people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      const seat = seating.seatOf(person.id);
      // After a lost run the staff have gone home; only the founders stay to face it.
      const wanted = seat !== null && !(this.outcome === "loss" && person.kind === "employee");

      let actor = this.actors.get(person.id) ?? null;
      if (actor && (actor.look !== person.look || actor.role !== person.role || actor.kind !== person.kind)) {
        // The id now belongs to somebody else entirely; never morph one person into another.
        this.remove(actor);
        actor = null;
      }
      if (!wanted || seat === null) {
        if (actor) this.dismiss(actor, events, mode, outcomeChanged);
        continue;
      }

      const popDelay = this.reducedMotion ? 0 : REBUILD_HIDE + order.length * rebuildStep;
      if (!actor) {
        actor = this.hire(person, seat);
        if (mode === "instant") actor.placeAtHome();
        else if (mode === "rebuild") actor.popInAtHome(popDelay);
        else if (welcome || coveredBy(events, "hired", person.id)) this.walkIn(actor);
        else actor.popInAtHome(0);
      } else {
        if (actor.person !== person) {
          const renamed = actor.person.name !== person.name;
          actor.person = person;
          if (renamed) this.host.renamed(actor);
        }
        if (mode === "rebuild") actor.relocate(seat, popDelay);
        else actor.rehome(seat, this);
      }
      order.push(actor);
    }

    // Whoever is no longer in the roster at all.
    for (const actor of this.actors.values()) {
      if (!seen.has(actor.id)) this.dismiss(actor, events, mode, outcomeChanged);
    }
  }

  private hire(person: PersonView, seat: Seat): Actor {
    const actor = new Actor(person, seat);
    actor.moodTimer = actor.rng.range(0.5, 6);
    this.actors.set(person.id, actor);
    this.host.spawn(actor);
    return actor;
  }

  /** Queue an arrival through the door: people file in ENTRY_STAGGER apart. */
  private walkIn(actor: Actor): void {
    const earliest = this.time + this.batchHold;
    const at = Math.min(Math.max(earliest, this.nextEntryAt), earliest + MAX_ENTRY_WAIT);
    this.nextEntryAt = at + ENTRY_STAGGER;
    actor.enterFrom(doorExterior(this.layout, DOOR_STEP), this.layout.door.facing, at - this.time, true);
  }

  private dismiss(actor: Actor, events: readonly WorldEvent[], mode: ReconcileMode, outcomeChanged: boolean): void {
    if (mode !== "live") {
      this.remove(actor);
      return;
    }
    this.actors.delete(actor.id);
    actor.dismissed = true;
    this.host.retire(actor);
    this.leavers.push(actor);

    const exit = doorExterior(this.layout, DOOR_STEP);
    if (this.outcome === "loss" && outcomeChanged && actor.kind === "employee") {
      // The company is over: sit with it for a moment, then pack up and go, one by one.
      actor.routine = "defeat";
      if (actor.away) actor.hurry(OUTCOME_SNAP, this);
      actor.leave(exit, EXODUS_DELAY + this.exodusCount * this.exodusStep, true);
      this.exodusCount += 1;
    } else if (coveredBy(events, "departed", actor.id)) {
      const earliest = this.time + this.batchHold;
      const at = Math.min(Math.max(earliest, this.nextExitAt), earliest + MAX_ENTRY_WAIT);
      this.nextExitAt = at + ENTRY_STAGGER;
      actor.leave(exit, at - this.time, true);
    } else {
      // Off the visible roster without having left the company (the office is over capacity).
      actor.vanish();
    }
  }

  /** Take an actor out of the world immediately. */
  private remove(actor: Actor): void {
    if (this.actors.get(actor.id) === actor) this.actors.delete(actor.id);
    actor.dismissed = true;
    this.host.despawn(actor);
  }

  private planExodus(): void {
    let staff = 0;
    for (const actor of this.order) if (actor.kind === "employee") staff += 1;
    this.exodusCount = 0;
    this.exodusStep = Math.min(EXODUS_STAGGER, EXODUS_SPREAD / Math.max(1, staff));
  }

  /** Drop everything that is in flight: a fresh start (`everything`) or a new office. */
  private clearTransients(everything: boolean): void {
    for (const actor of this.leavers) this.host.despawn(actor);
    this.leavers.length = 0;
    this.cues.length = 0;
    this.lastWanderer = null;
    this.quietUntil = 0;
    this.founderLine = 0;
    this.nextEntryAt = 0;
    this.nextExitAt = 0;
    if (!everything) return;
    for (const actor of this.order) this.remove(actor);
    // Anyone the roster order did not know about (there should be nobody).
    for (const actor of this.actors.values()) this.remove(actor);
    this.actors.clear();
    this.order.length = 0;
  }

  private applyRoutines(): void {
    const routine: Routine = !this.setupComplete
      ? "wait"
      : this.outcome === "win"
        ? "celebrate"
        : this.outcome === "loss"
          ? "defeat"
          : "work";
    const dozing = routine === "work" && this.morale < LOW_MORALE;
    for (const actor of this.order) {
      actor.routine = routine;
      actor.energy = Math.min(energyFor(actor.kind, this.morale, this.stress), personalEnergyCap(this.personal.get(actor.id)));
      if (!dozing) actor.mood = "work";
      // Morale has just been seen to be low: do not make the room wait a whole mood cycle to show it.
      else if (actor.mood === "work") actor.moodTimer = Math.min(actor.moodTimer, actor.rng.range(0.3, 3.5));
      // The snapshot is drawn before the next update: the pose has to be right already.
      actor.resolvePose();
    }
  }

  /** A new week: everyone back to their desks for the morning. */
  private startMorning(): void {
    this.cues.length = 0;
    this.founderLine = 0;
    for (const actor of this.order) {
      actor.clearEmote();
      actor.mood = "work";
      actor.moodTimer = actor.rng.range(3, 10);
      if (!actor.away) continue;
      if (this.reducedMotion) actor.snapHome();
      else actor.hurry(MORNING_SNAP, this);
    }
    for (const actor of this.leavers) actor.hurry(MORNING_SNAP, this);
    this.wanderTimer = this.rng.range(4, 8);
    this.paceTimer = this.rng.range(5, 9);
    this.quietUntil = 0;
    // Anyone who arrives or leaves with the new week does it in daylight, after the sweep.
    this.batchHold = MORNING_DELAY;
  }

  /** The run just ended (or un-ended): stop the day-to-day business. */
  private settleForOutcome(): void {
    this.cues.length = 0;
    for (const actor of this.order) {
      actor.clearEmote();
      if (!actor.away) continue;
      if (this.reducedMotion) actor.snapHome();
      else actor.hurry(OUTCOME_SNAP, this);
    }
  }

  // ── Reactions ───────────────────────────────────────────────────────────────

  private react(events: readonly WorldEvent[]): void {
    let cheered = false;
    for (const event of events) {
      switch (event.type) {
        case "ship":
          this.quietUntil = this.time + REACTION_QUIET;
          this.gather(BUILDER_ROLES);
          if (event.ok) {
            this.ripple({ bubble: "code", bubbleSeconds: 1.1 }, 0, true);
            this.ripple({ stream: "ship" }, 0.85, true);
            this.ripple({ emote: "cheer", emoteSeconds: 1.3 }, 0.95, false);
          } else {
            this.ripple({ bubble: "bug", bubbleSeconds: 2 }, 0, true);
            this.ripple({ emote: "slump", emoteSeconds: 2.2 }, 0.1, false);
          }
          break;
        case "launch":
          this.quietUntil = this.time + REACTION_QUIET;
          this.gather(GROWTH_ROLES);
          if (event.ok) {
            this.ripple({ bubble: "megaphone", bubbleSeconds: 1.6 }, 0, true);
            this.ripple({ emote: "cheer", emoteSeconds: 1.4 }, 0.45, false);
          } else {
            this.ripple({ bubble: "question", bubbleSeconds: 2 }, 0, true);
          }
          break;
        case "pitch": {
          const founder = this.founder();
          if (!founder) break;
          founder.emote("phone", 1.7);
          this.say("phone", 1.5);
          this.say(event.ok ? "idea" : "question", 2);
          break;
        }
        case "raise": {
          if (event.ok) {
            this.gatherEveryone();
            this.ripple({ emote: "cheer", emoteSeconds: 2 }, 0, false);
            this.say("money", 2.4);
            cheered = true;
          } else {
            this.founder()?.emote("slump", 2.6);
            this.say("stress", 2.4);
          }
          break;
        }
        case "stage-changed":
          // A raise that carries the company to a new stage is one celebration, not two.
          if (cheered) break;
          this.gatherEveryone();
          this.ripple({ emote: "cheer", emoteSeconds: 1.6 }, 0, false);
          cheered = true;
          break;
        case "phase-changed":
          // A little cheer for the new office. Everyone is hidden while it is rebuilt, so each
          // cue waits for its person and plays as they pop in.
          // Nobody cheers for the smaller office after a fall.
          if (cheered || this.reducedMotion || !isPromotion(event.from, event.to)) break;
          this.gatherEveryone();
          this.ripple({ emote: "cheer", emoteSeconds: 1.3 }, 0.3, false);
          cheered = true;
          break;
        case "event-opened":
          this.say("exclaim", 2.4);
          break;
        case "command-failed":
          this.say("question", 1.6);
          break;
        case "easter-egg":
          if (event.command === "coffee") this.coffeeRun();
          break;
        // ── People and product builds ──
        case "released":
          this.quietUntil = this.time + REACTION_QUIET;
          this.gather(BUILDER_ROLES);
          if (event.tier === "breakout") {
            this.ripple({ bubble: "rocket", bubbleSeconds: 1.6 }, 0.2, true);
            this.ripple({ emote: "cheer", emoteSeconds: 2 }, 0.9, false);
            cheered = true;
          } else if (event.tier === "solid") {
            this.ripple({ stream: "ship" }, 0.3, true);
            this.ripple({ emote: "cheer", emoteSeconds: 1.3 }, 0.9, false);
          } else if (event.tier === "shrug") {
            this.ripple({ bubble: "question", bubbleSeconds: 1.6 }, 0.6, true);
          } else {
            this.ripple({ bubble: "bug", bubbleSeconds: 2 }, 0.3, true);
            this.ripple({ emote: "slump", emoteSeconds: 2.4 }, 0.5, false);
          }
          break;
        case "build-started":
          this.gather(BUILDER_ROLES);
          this.ripple({ bubble: "idea", bubbleSeconds: 1.4 }, 0.1, true);
          break;
        case "surprise":
          this.gather(BUILDER_ROLES);
          this.ripple({ bubble: "question", bubbleSeconds: 1.8 }, 0.2, true);
          break;
        case "crunch-changed":
          if (event.on) {
            this.gather(BUILDER_ROLES);
            this.ripple({ bubble: "coffee", bubbleSeconds: 1.6 }, 0.1, true);
          }
          break;
        case "offer-landed": {
          const person = this.actors.get(event.personId);
          if (person?.present) this.cue(person, 0.3, { bubble: event.kind === "burnout" ? "stress" : "phone", bubbleSeconds: 2 });
          break;
        }
        case "retained": {
          const person = this.actors.get(event.personId);
          if (person?.present) this.cue(person, 0.1, { bubble: "heart", bubbleSeconds: 1.6, emote: "cheer", emoteSeconds: 1 });
          break;
        }
        case "energy-band": {
          const person = this.actors.get(event.personId);
          if (!person?.present) break;
          if (event.band === "burnt-out") this.cue(person, 0.4, { bubble: "zzz", bubbleSeconds: 2.2, emote: "slump", emoteSeconds: 2.4 });
          else if (event.band === "fumes") this.cue(person, 0.4, { bubble: "coffee", bubbleSeconds: 1.8 });
          break;
        }
        default:
          // Arrivals, departures and the end of the run are handled from the roster and the
          // snapshot itself; the remaining events belong to other systems.
          break;
      }
    }
  }

  private founder(): Actor | null {
    const founder = this.actors.get(FOUNDER_ID);
    return founder && founder.present ? founder : null;
  }

  /** Fill the pool with everyone present in the given roles; the founder stands in for an empty team. */
  private gather(roles: readonly TeamRole[]): void {
    const { pool } = this;
    pool.length = 0;
    for (const actor of this.order) {
      if (actor.role !== null && roles.includes(actor.role) && actor.present) pool.push(actor);
    }
    if (pool.length === 0) {
      const founder = this.founder();
      if (founder) pool.push(founder);
    }
  }

  private gatherEveryone(): void {
    const { pool } = this;
    pool.length = 0;
    for (const actor of this.order) if (actor.present) pool.push(actor);
  }

  /**
   * Schedule the same cue for the pooled people, rippling through them a few
   * tens of milliseconds apart. `subset` limits it to a spread-out handful
   * (bubbles and particle streams do not scale to sixty people at once).
   */
  private ripple(spec: CueSpec, delay: number, subset: boolean): void {
    const { pool } = this;
    const step = Math.min(RIPPLE_STEP, RIPPLE_SPREAD / Math.max(1, pool.length));
    if (!subset) {
      for (let i = 0; i < pool.length; i += 1) this.cue(pool[i], delay + i * step, spec);
      return;
    }
    for (const index of spreadIndices(pool.length, this.maxGroupBubbles)) this.cue(pool[index], delay + index * step, spec);
  }

  private cue(actor: Actor, delay: number, spec: CueSpec): void {
    this.cues.push({
      at: this.time + Math.max(0, delay),
      actor,
      bubble: spec.bubble ?? null,
      bubbleSeconds: spec.bubbleSeconds ?? 2.2,
      emote: spec.emote ?? null,
      emoteSeconds: spec.emoteSeconds ?? 0,
      stream: spec.stream ?? null,
    });
  }

  /** A bubble over the founder. Several in a row play one after another instead of replacing each other. */
  private say(icon: BubbleIcon, seconds: number): void {
    const founder = this.founder();
    if (!founder) return;
    const at = Math.max(this.time, this.founderLine);
    this.founderLine = at + seconds * 0.9;
    this.cue(founder, at - this.time, { bubble: icon, bubbleSeconds: seconds });
  }

  private fireCues(): void {
    const { cues } = this;
    let kept = 0;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      const { actor } = cue;
      // Not due yet — or due for somebody who is hidden for a moment while the office is
      // rebuilt: they react as soon as they pop back in.
      if (cue.at > this.time || (!actor.visible && actor.present && !actor.dismissed)) {
        cues[kept] = cue;
        kept += 1;
        continue;
      }
      if (actor.dismissed || !actor.visible) continue;
      if (cue.emote) actor.emote(cue.emote, cue.emoteSeconds);
      if (cue.bubble) this.host.bubble(actor, cue.bubble, cue.bubbleSeconds);
      if (cue.stream) this.host.stream(actor, cue.stream);
    }
    cues.length = kept;
  }

  // ── Ambient life ────────────────────────────────────────────────────────────

  /** Is this a moment when people may leave their desks of their own accord? */
  private canRoam(): boolean {
    return this.setupComplete && this.outcome === "none" && !this.reducedMotion && this.time >= this.quietUntil;
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
      // The founder stays put: they are the player's stand-in, and their reactions (the phone
      // call, the exclamation mark) read best at their desk. They pace and fetch coffee instead.
      else if (actor.kind !== "founder" && actor.seatedIdle && actor.mood === "work" && actor !== this.lastWanderer) {
        pool.push(actor);
      }
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

  /** A stressed founder cannot sit still. */
  private tickPace(dt: number): void {
    if (this.stress <= HIGH_STRESS) return;
    this.paceTimer -= dt;
    if (this.paceTimer > 0) return;
    this.paceTimer = this.rng.range(10, 18);
    const founder = this.founder();
    if (!founder || !founder.seatedIdle || !this.canRoam()) return;
    const points = pacePoints(this.layout, founder.home);
    if (points.length === 0) {
      this.host.bubble(founder, "stress");
      return;
    }
    const [a, b] = points;
    const legs: ErrandLeg[] = [{ x: a.x, z: a.z, facing: null, pause: b ? 0.35 : 1.4, bubble: "stress" }];
    if (b) {
      legs.push({ x: b.x, z: b.z, facing: null, pause: 0.35, bubble: null });
      legs.push({ x: a.x, z: a.z, facing: null, pause: 0.3, bubble: null });
    }
    founder.runErrand("pace", legs, this);
  }

  /** The `coffee` easter egg: the founder fetches one. */
  private coffeeRun(): void {
    const founder = this.founder();
    if (!founder) return;
    const mayWalk = this.setupComplete && this.outcome === "none" && !this.reducedMotion && founder.mode !== "waiting";
    if (!mayWalk) {
      this.say("coffee", 2.2);
      return;
    }
    const spot = this.layout.stationStandSpots.coffee;
    founder.clearEmote();
    founder.runErrand("coffee", [{ x: spot.x, z: spot.z, facing: spot.facing, pause: 1.8, bubble: "coffee" }], this);
  }

  /** Now and then somebody's mood shows: hearts and ideas when things are good, zzz when they are not. */
  private tickAmbient(dt: number): void {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    const people = Math.max(1, this.order.length);
    // 3–6 s at a dozen people; a little sparser in a tiny team, a little busier in a big one.
    this.ambientTimer = this.rng.range(3, 6) * Math.min(1.6, Math.max(0.6, 12 / people));
    if (!this.setupComplete || this.outcome !== "none") return;

    if (this.stress > HIGH_STRESS && this.rng.chance(0.4)) {
      const founder = this.founder();
      if (founder && founder.emoting === null) {
        this.host.bubble(founder, "stress");
        return;
      }
    }

    const { pool } = this;
    pool.length = 0;
    if (this.morale < LOW_MORALE) {
      for (const actor of this.order) if (actor.seatedIdle && actor.mood === "sleep") pool.push(actor);
      if (pool.length > 0) this.host.bubble(pool[this.rng.index(pool.length)], "zzz", 2.6);
    } else if (this.morale > HIGH_MORALE) {
      for (const actor of this.order) if (actor.seatedIdle) pool.push(actor);
      if (pool.length > 0) this.host.bubble(pool[this.rng.index(pool.length)], this.rng.chance(0.5) ? "heart" : "idea");
    }
  }

  /** Low morale: people drift between working, slumping and dozing, each on their own clock. */
  private tickMood(actor: Actor, dt: number): void {
    // The founder is the player: stressed, never asleep at the desk.
    if (actor.kind === "founder" || actor.routine !== "work" || this.morale >= LOW_MORALE) return;
    actor.moodTimer -= dt;
    if (actor.moodTimer > 0) return;
    if (actor.mood !== "work") {
      actor.mood = "work";
      actor.moodTimer = actor.rng.range(6, 14);
      return;
    }
    if (!actor.seatedIdle) {
      actor.moodTimer = 2;
      return;
    }
    const gloom = (LOW_MORALE - this.morale) / LOW_MORALE;
    if (actor.rng.chance(0.18 + 0.4 * gloom)) {
      actor.mood = actor.rng.chance(0.45) ? "sleep" : "slump";
      actor.moodTimer = actor.rng.range(9, 20);
    } else {
      actor.moodTimer = actor.rng.range(6, 14);
    }
  }

  // ── Per frame ───────────────────────────────────────────────────────────────

  update(dt: number): void {
    this.time += dt;
    if (this.cues.length > 0) this.fireCues();

    for (let i = 0; i < this.order.length; i += 1) {
      const actor = this.order[i];
      this.tickMood(actor, dt);
      actor.update(dt, this);
    }
    for (let i = this.leavers.length - 1; i >= 0; i -= 1) {
      const actor = this.leavers[i];
      actor.update(dt, this);
      if (!actor.gone) continue;
      this.leavers.splice(i, 1);
      this.host.despawn(actor);
    }

    this.tickWander(dt);
    this.tickPace(dt);
    this.tickAmbient(dt);
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

  /** Newcomers wait outside while anybody is on their way out, so the two never meet in the doorway. */
  holdArrival(actor: Actor): boolean {
    void actor;
    for (const leaver of this.leavers) if (leaver.exiting) return true;
    return false;
  }

  /** Leavers give way to newcomers already on their way in: they stay at their desk, or stop short of the door. */
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
