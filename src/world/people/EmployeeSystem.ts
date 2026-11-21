/**
 * The people in the office.
 *
 * This file is only the three.js side: it gives every Actor a Character body,
 * keeps the two in step each frame, registers people for hover / click, and
 * turns the Crew's requests (bubbles, dust, sparkle streams) into FxApi calls.
 * Who is in the office, where they walk and how they react is decided by the
 * Crew (./crew.ts) and its Actors (./actor.ts), which are pure and unit-tested.
 */
import * as THREE from "three";
import { addHitBox } from "../interaction/hitProxy";
import { roleTitle } from "../names";
import type {
  BubbleIcon,
  OfficeLayout,
  PersonView,
  StaffView,
  StationKind,
  Vec2,
  WorldContext,
  WorldEvent,
  WorldSnapshot,
  WorldSystem,
} from "../types";
import type { Actor } from "./actor";
import { chairKey } from "./approach";
import { createCharacter } from "./Character";
import type { CharacterHandle, CharacterPose, PoseOptions } from "./Character";
import { Crew, MAX_GROUP_BUBBLES } from "./crew";
import type { CrewHost } from "./crew";
import { Footfall } from "./footfall";
import { markerFor, PersonMarkers, pizzaPlan } from "./markers";

/** The inspector card hangs just above the head anchor (which already sits over the hair). */
const CARD_LIFT = 0.15;
/** Where on a wall board the sparkles from a shipped feature land. */
const STREAM_TARGET_HEIGHT = 1.45;
const STREAM_PARTICLES = 4;
const DUST_HEIGHT = 0.06;
const DUST_INTENSITY = 0.6;
/**
 * A person's click area: a box around the whole figure. Peg people are a dozen
 * pixels wide in the big offices, and nobody should have to aim for a head.
 */
const CLICK_BOX = { x: 0, y: 0, z: 0, width: 0.66, height: 1.6, depth: 0.66 } as const;
/** Below this a body is hidden rather than drawn as a speck (and never given a zero scale). */
const MIN_VISIBLE_SCALE = 0.02;
/** How near the doorway somebody has to be for the door to be held open for them. */
const DOORWAY_RADIUS = 1.7;

/**
 * Is this person walking through the doorway? `door` is the spot just inside it;
 * the radius reaches the pavement where arrivals appear and leavers vanish.
 */
const isInDoorway = (actor: Actor, door: Vec2, floor: OfficeLayout["floor"]): boolean => {
  if (!actor.visible || actor.walkSpeed <= 0) return false;
  if (Math.hypot(actor.x - door.x, actor.z - door.z) >= DOORWAY_RADIUS) return false;
  // On the way out, or still outside on the way in. Somebody merely walking past
  // the door on the inside does not set it swinging.
  const outside = actor.x < floor.minX || actor.x > floor.maxX || actor.z < floor.minZ || actor.z > floor.maxZ;
  return outside || actor.goal === "exit";
};

/** Hover label and inspector title for a person: "Amara Okafor — Engineer". */
export const personLabel = (person: PersonView): string => {
  if (person.kind === "founder") return `${person.name} — Founder`;
  if (person.kind === "cofounder") return `${person.name} — Cofounder`;
  return person.role ? `${person.name} — ${roleTitle(person.role)}` : person.name;
};

/** An actor's Character, plus what was last pushed to it (so only changes are sent). */
interface Body {
  readonly character: CharacterHandle;
  pose: CharacterPose | null;
  seated: boolean;
  floor: boolean;
  teleports: number;
  scale: number;
}

export class EmployeeSystem implements WorldSystem, CrewHost {
  private readonly ctx: WorldContext;
  private readonly root = new THREE.Group();
  private readonly crew: Crew;
  private readonly bodies = new Map<Actor, Body>();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  /** Re-used for every setPose call so pose changes do not allocate. */
  private readonly poseOptions: PoseOptions = { seated: false, floor: false, immediate: false };
  /** Published as ctx.signals.chairsOut: which chairs are in use and how far they are pulled out. */
  private readonly chairsOut = new Map<number, number>();
  /** Published as ctx.signals.vacated (replaced whenever it changes). */
  private vacated: ReadonlySet<string> = new Set<string>();
  /** The roster of the latest snapshot. */
  private people: readonly PersonView[] = [];
  /** Footsteps and chairs for the app's sound listener; null when nobody listens. */
  private readonly footfall: Footfall | null;
  /** Offer envelopes, lead stars and pizza boxes. */
  private readonly markers: PersonMarkers;
  private staff = new Map<string, StaffView>();
  private readonly scratch = new THREE.Vector3();

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
    this.root.name = "people";
    ctx.scene.add(this.root);
    ctx.signals.chairsOut = this.chairsOut;
    ctx.signals.vacated = this.vacated;
    this.footfall = ctx.sound ? new Footfall(ctx.sound) : null;
    // The pizza boxes live beside the people (not among them: the people root holds only bodies).
    this.markers = new PersonMarkers(ctx.scene, ctx.reducedMotion);
    this.crew = new Crew(this, ctx.getLayout(), {
      reducedMotion: ctx.reducedMotion,
      // "low" quality means a phone-sized view: half as many bubbles keeps them from piling up.
      maxGroupBubbles: ctx.quality === "low" ? MAX_GROUP_BUBBLES / 2 : MAX_GROUP_BUBBLES,
    });
  }

  // ── WorldSystem ─────────────────────────────────────────────────────────────

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    this.people = next.people;
    this.crew.applySnapshot(next, prev, events, this.ctx.seating, this.ctx.getLayout());
    // Show the result now rather than on the next frame: a snapshot can arrive while the
    // loop is paused, and a first build must never flash people at the origin.
    this.syncAll(0, 0);
    this.syncMarkers(next, prev !== null ? events : []);
    if (prev !== null) this.react(events);
  }

  update(dt: number, elapsed: number): void {
    this.crew.update(dt);
    this.syncAll(dt, elapsed);
    this.markers.update(dt);
  }

  dispose(): void {
    this.markers.dispose();
    this.crew.dispose();
    // The crew has despawned everyone it knew; this is the safety net.
    for (const actor of [...this.bodies.keys()]) this.despawn(actor);
    this.ctx.signals.doorTraffic = 0;
    if (this.ctx.signals.chairsOut === this.chairsOut) this.ctx.signals.chairsOut = undefined;
    if (this.ctx.signals.vacated === this.vacated) this.ctx.signals.vacated = undefined;
    this.chairsOut.clear();
    this.root.removeFromParent();
  }

  // ── CrewHost ────────────────────────────────────────────────────────────────

  spawn(actor: Actor): void {
    const character = createCharacter(actor.person);
    // Hidden until the first sync places it.
    character.group.visible = false;
    addHitBox(character.group, CLICK_BOX);
    this.root.add(character.group);
    this.bodies.set(actor, { character, pose: null, seated: false, floor: false, teleports: -1, scale: 1 });
    this.register(actor, character);
  }

  renamed(actor: Actor): void {
    const body = this.bodies.get(actor);
    // Registering the same target again replaces the entry, which is how a label is updated.
    if (body && !actor.dismissed) this.register(actor, body.character);
  }

  retire(actor: Actor): void {
    const body = this.bodies.get(actor);
    if (body) this.ctx.interactables.unregister(body.character.group);
  }

  despawn(actor: Actor): void {
    const body = this.bodies.get(actor);
    if (!body) return;
    this.bodies.delete(actor);
    this.ctx.interactables.unregister(body.character.group);
    body.character.dispose();
  }

  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void {
    const body = this.bodies.get(actor);
    // The crew asks mid-update, before this frame's sync: put the body where the actor is
    // first, or a bubble for somebody who has just appeared would start at their old spot.
    if (body && this.place(actor, body)) this.ctx.fx.bubble(body.character.headAnchor, icon, seconds);
  }

  dust(x: number, z: number): void {
    this.ctx.fx.burst("dust", this.from.set(x, DUST_HEIGHT, z), DUST_INTENSITY);
  }

  stream(actor: Actor, station: StationKind): void {
    const body = this.bodies.get(actor);
    if (!body || !this.place(actor, body)) return;
    const target = this.ctx.getLayout().stations[station];
    body.character.headAnchor.getWorldPosition(this.from);
    this.to.set(target.x, STREAM_TARGET_HEIGHT, target.z);
    this.ctx.fx.stream("sparkle", this.from, this.to, STREAM_PARTICLES);
  }

  // ── Tycoon markers ──────────────────────────────────────────────────────────

  /** Envelopes and stars over heads, pizza boxes on desks: straight from the snapshot. */
  private syncMarkers(next: WorldSnapshot, events: readonly WorldEvent[]): void {
    this.staff = new Map(next.staff.map((view) => [view.id, view]));
    const landed = new Set<string>();
    for (const event of events) if (event.type === "offer-landed") landed.add(event.personId);
    const keep = new Set<string>();
    // After a lost run the staff have gone home: nothing left to badge.
    const live = next.gameOver === null;
    for (const actor of this.crew.cast) {
      const body = this.bodies.get(actor);
      if (!body) continue;
      keep.add(actor.id);
      this.markers.sync(actor.id, body.character.headAnchor, live ? markerFor(this.staff.get(actor.id)) : null, landed.has(actor.id));
    }
    this.markers.prune(keep);
    this.markers.setPizza(live ? pizzaPlan(next, (id) => (this.crew.actor(id) ? this.ctx.seating.seatOf(id) : null)) : []);
  }

  /** The person-level moments of the tycoon layer: credit for a release, a retention bonus. */
  private react(events: readonly WorldEvent[]): void {
    for (const event of events) {
      if (event.type === "experience") {
        for (const personId of event.personIds) {
          const at = this.headOf(personId);
          if (at) this.ctx.fx.floatText("+1 exp", at, "good");
        }
      } else if (event.type === "retained") {
        const at = this.headOf(event.personId);
        if (at) this.ctx.fx.burst("sparkle", at, 0.7);
      }
    }
  }

  /** Where somebody's head is right now (a scratch vector), or null if they are not on stage. */
  private headOf(personId: string): THREE.Vector3 | null {
    const actor = this.crew.actor(personId);
    const body = actor ? this.bodies.get(actor) : undefined;
    if (!actor || !body || !actor.visible) return null;
    return body.character.headAnchor.getWorldPosition(this.scratch);
  }

  // ── Bodies ──────────────────────────────────────────────────────────────────

  private register(actor: Actor, character: CharacterHandle): void {
    this.ctx.interactables.register(
      character.group,
      { kind: "person", personId: actor.id },
      { label: personLabel(actor.person), anchor: character.headAnchor, anchorHeight: CARD_LIFT }
    );
  }

  private syncAll(dt: number, elapsed: number): void {
    const { cast, departing } = this.crew;
    const { door, floor } = this.ctx.getLayout();
    const { footfall } = this;
    let atDoor = 0;
    for (let i = 0; i < cast.length; i += 1) {
      this.sync(cast[i], dt, elapsed);
      footfall?.observe(cast[i], door);
      if (isInDoorway(cast[i], door, floor)) atDoor += 1;
    }
    for (let i = 0; i < departing.length; i += 1) {
      this.sync(departing[i], dt, elapsed);
      footfall?.observe(departing[i], door);
      if (isInDoorway(departing[i], door, floor)) atDoor += 1;
    }
    // The office holds the front door open for whoever is walking through it.
    this.ctx.signals.doorTraffic = atDoor;
    this.publishChairs();
    this.publishVacated();
  }

  /** Tell the office which chairs are in use and how far each one is pulled out. */
  private publishChairs(): void {
    const { chairsOut } = this;
    chairsOut.clear();
    const { cast, departing } = this.crew;
    for (let i = 0; i < cast.length; i += 1) this.claimChair(cast[i]);
    for (let i = 0; i < departing.length; i += 1) this.claimChair(departing[i]);
  }

  private claimChair(actor: Actor): void {
    if (actor.gone) return;
    const key = chairKey(actor.home);
    if (key === null) return;
    // Two people can belong to one chair for a moment (somebody leaving it, somebody
    // given it): whoever is sitting in it wins.
    const known = this.chairsOut.get(key);
    this.chairsOut.set(key, known === undefined ? actor.chairOut : Math.min(known, actor.chairOut));
  }

  /**
   * People the seating plan still seats who are not here to work at their desk: they
   * have left (a lost run's staff go home), or have got up to go. Their desks go dark.
   */
  private publishVacated(): void {
    const { seating } = this.ctx;
    let count = 0;
    let differs = false;
    for (const person of this.people) {
      if (seating.seatOf(person.id) === null || this.atDesk(person.id)) continue;
      count += 1;
      if (!this.vacated.has(person.id)) differs = true;
    }
    if (!differs && count === this.vacated.size) return;
    const vacated = new Set<string>();
    for (const person of this.people) {
      if (seating.seatOf(person.id) !== null && !this.atDesk(person.id)) vacated.add(person.id);
    }
    this.vacated = vacated;
    this.ctx.signals.vacated = vacated;
  }

  /** Is this person in the cast — or leaving, but not out of their seat yet? */
  private atDesk(personId: string): boolean {
    if (this.crew.actor(personId) !== null) return true;
    const { departing } = this.crew;
    for (let i = 0; i < departing.length; i += 1) {
      const actor = departing[i];
      if (actor.id === personId && actor.mode === "seated") return true;
    }
    return false;
  }

  /** Put a body where its actor is. Returns whether the actor is on stage. */
  private place(actor: Actor, body: Body): boolean {
    const { group } = body.character;
    if (!actor.visible) {
      group.visible = false;
      return false;
    }
    // The first instant of a scale-in is too small to draw (and a zero scale is a singular
    // matrix), but the person is there: a bubble may already hang over the spot.
    const scale = Math.max(actor.scale, MIN_VISIBLE_SCALE);
    group.visible = actor.scale >= MIN_VISIBLE_SCALE;
    group.position.set(actor.x, 0, actor.z);
    group.rotation.y = actor.facing;
    if (scale !== body.scale) {
      body.scale = scale;
      group.scale.setScalar(scale);
    }
    return true;
  }

  /** Copy one actor's state onto its character and advance the character's animation. */
  private sync(actor: Actor, dt: number, elapsed: number): void {
    const body = this.bodies.get(actor);
    if (!body || !this.place(actor, body)) return;
    const { character } = body;

    const teleported = body.teleports !== actor.teleports;
    if (teleported || body.pose !== actor.pose || body.seated !== actor.poseSeated || body.floor !== actor.poseFloor) {
      body.pose = actor.pose;
      body.seated = actor.poseSeated;
      body.floor = actor.poseFloor;
      body.teleports = actor.teleports;
      this.poseOptions.seated = actor.poseSeated;
      this.poseOptions.floor = actor.poseFloor;
      // Somebody who was placed rather than walked has no previous pose worth blending from.
      this.poseOptions.immediate = teleported;
      character.setPose(actor.pose, this.poseOptions);
    }
    character.setWalkSpeed(actor.walkSpeed);
    character.setEnergy(actor.energy);
    character.setCarrying(actor.carrying);
    character.update(dt, elapsed);
  }
}
