/**
 * The people in the office.
 *
 * This file is only the three.js side: it gives every Actor a Character body, keeps the two in step each frame,
 * registers people for hover / click, and turns the Crew's requests (bubbles, dust) into FxApi calls. Who is in the
 * office, where they walk and when they come to rest is decided by the Crew (./crew.ts) and its Actors (./actor.ts),
 * which are pure and unit-tested; who sits where is the seating plan's to say (ctx.seating), which the World
 * reconciles before any system is handed a frame.
 *
 * One figure is drawn for each cast member with a seat who is not away, and one for each person still walking out:
 * never more than 56 in all, which the Crew sees to (MAX_FIGURES). A figure is eight meshes, so
 * eight draw calls, plus two in the shadow pass while sitting and six while on their feet (see ./Character.ts).
 */
import * as THREE from "three";
import type { CastMember } from "../cast";
import { addHitBox } from "../interaction/hitProxy";
import type { BubbleIcon, OfficeLayout, Team, Vec2, WorldContext, WorldFrame, WorldSystem } from "../types";
import type { Actor } from "./actor";
import { chairKey } from "./approach";
import { createCharacter } from "./Character";
import type { CharacterHandle, CharacterPose, PoseOptions } from "./Character";
import { Crew } from "./crew";
import type { CrewHost } from "./crew";

/** What the people read of the world. A whole WorldContext is one of these. */
export type PeopleContext = Pick<WorldContext, "scene" | "reducedMotion" | "interactables" | "fx" | "seating" | "signals" | "getLayout">;

/** The inspector card hangs just above the head anchor (which already sits over the hair). */
const CARD_LIFT = 0.15;
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

/** What a team is called when one of its people is pointed at. */
export const TEAM_LABELS: Record<Team, string> = { product: "Product", growth: "Growth", recruiting: "Recruiting" };

/** What somebody no team has is called. */
export const PERSON_LABEL = "Person";

/** Hover label for a person. People have no names: the team whose shirt they wear, or just "Person". */
export const personLabel = (team: Team | null): string => (team === null ? PERSON_LABEL : TEAM_LABELS[team]);

/** An actor's Character, plus what was last pushed to it (so only changes are sent). */
interface Body {
  readonly character: CharacterHandle;
  pose: CharacterPose | null;
  seated: boolean;
  teleports: number;
  scale: number;
  team: Team | null;
}

export class EmployeeSystem implements WorldSystem, CrewHost {
  private readonly ctx: PeopleContext;
  private readonly root = new THREE.Group();
  private readonly crew: Crew;
  private readonly bodies = new Map<Actor, Body>();
  private readonly from = new THREE.Vector3();
  /** Re-used for every setPose call so pose changes do not allocate. */
  private readonly poseOptions: PoseOptions = { seated: false, immediate: false };
  /** Published as ctx.signals.chairsOut: which chairs are in use and how far they are pulled out. */
  private readonly chairsOut = new Map<number, number>();
  /** Published as ctx.signals.vacated (replaced whenever it changes). */
  private vacated: ReadonlySet<string> = new Set<string>();
  /** The people of the latest frame. */
  private people: readonly CastMember[] = [];
  private disposed = false;

  constructor(ctx: PeopleContext) {
    this.ctx = ctx;
    this.root.name = "people";
    ctx.scene.add(this.root);
    ctx.signals.chairsOut = this.chairsOut;
    ctx.signals.vacated = this.vacated;
    this.crew = new Crew(this, ctx.getLayout(), { reducedMotion: ctx.reducedMotion });
  }

  /** How many figures there are right now: the people in the office and the people still walking out of it. At most 56. */
  get figureCount(): number {
    return this.bodies.size;
  }

  // ── WorldSystem ─────────────────────────────────────────────────────────────

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    if (this.disposed) return;
    this.people = next.cast.people;
    this.crew.applyFrame(next, prev, this.ctx.seating, this.ctx.getLayout());
    // Show the result now rather than on the next frame: a scene can arrive while the
    // loop is at rest, and a first build must never flash people at the origin.
    this.syncAll(0, 0);
  }

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    // A step that is not a positive, finite time moves nothing: one NaN in a walk's timer or a figure's animation
    // clock would never leave it again. (The crew has the same guard for whoever steps it directly.)
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.crew.update(dt);
    this.syncAll(dt, elapsed);
  }

  /**
   * True while anybody is waiting for a turn at the door, walking, settling, popping in or walking out. False once
   * everyone is at their place: the typing, swaying and breathing they do there never ends and does not count, so
   * the loop rests on a still office and those little movements stand still with it.
   */
  busy(): boolean {
    return !this.disposed && this.crew.busy();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    const character = createCharacter({ id: actor.id, look: actor.look, team: actor.team });
    // Hidden until the first sync places it.
    character.group.visible = false;
    addHitBox(character.group, CLICK_BOX);
    this.root.add(character.group);
    this.bodies.set(actor, { character, pose: null, seated: false, teleports: -1, scale: 1, team: actor.team });
    this.register(actor, character);
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

  // ── Bodies ──────────────────────────────────────────────────────────────────

  private register(actor: Actor, character: CharacterHandle): void {
    this.ctx.interactables.register(
      character.group,
      { kind: "person", personId: actor.id },
      { label: personLabel(actor.team), anchor: character.headAnchor, anchorHeight: CARD_LIFT }
    );
  }

  private syncAll(dt: number, elapsed: number): void {
    const { cast, departing } = this.crew;
    const { door, floor } = this.ctx.getLayout();
    let atDoor = 0;
    for (let i = 0; i < cast.length; i += 1) {
      this.sync(cast[i], dt, elapsed);
      if (isInDoorway(cast[i], door, floor)) atDoor += 1;
    }
    for (let i = 0; i < departing.length; i += 1) {
      this.sync(departing[i], dt, elapsed);
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
   * People who hold a desk in the seating plan and are not here to work at it: someone away for the year, or
   * somebody who has got up to go. Their desks go dark and their chairs stand empty.
   */
  private publishVacated(): void {
    let count = 0;
    let differs = false;
    for (const person of this.people) {
      if (!this.deskIsEmpty(person.id)) continue;
      count += 1;
      if (!this.vacated.has(person.id)) differs = true;
    }
    if (!differs && count === this.vacated.size) return;
    const vacated = new Set<string>();
    for (const person of this.people) if (this.deskIsEmpty(person.id)) vacated.add(person.id);
    this.vacated = vacated;
    this.ctx.signals.vacated = vacated;
  }

  /** Does this person hold a desk that nobody is at? */
  private deskIsEmpty(personId: string): boolean {
    if (this.ctx.seating.seatOf(personId)?.kind !== "desk") return false;
    // In the office — or leaving it, but not out of their seat yet.
    if (this.crew.actor(personId) !== null) return false;
    const { departing } = this.crew;
    for (let i = 0; i < departing.length; i += 1) {
      const actor = departing[i];
      if (actor.id === personId && actor.mode === "seated") return false;
    }
    return true;
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
    if (!body) return;
    const { character } = body;
    if (body.team !== actor.team) {
      // Another team: another shirt, and another label for whoever points at them.
      body.team = actor.team;
      character.setTeam(actor.team);
      if (!actor.dismissed) this.register(actor, character);
    }
    if (!this.place(actor, body)) return;

    character.setWalkSpeed(actor.walkSpeed);
    character.setEnergy(actor.energy);
    // Before the pose: somebody placed with a box in their arms is holding it at once.
    character.setCarrying(actor.carrying);
    const teleported = body.teleports !== actor.teleports;
    if (teleported || body.pose !== actor.pose || body.seated !== actor.poseSeated) {
      body.pose = actor.pose;
      body.seated = actor.poseSeated;
      body.teleports = actor.teleports;
      this.poseOptions.seated = actor.poseSeated;
      // Somebody who was placed rather than walked has no previous pose worth blending from.
      this.poseOptions.immediate = teleported;
      character.setPose(actor.pose, this.poseOptions);
    }
    character.update(dt, elapsed);
  }
}
