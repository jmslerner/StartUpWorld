/**
 * One person's behaviour: where they are, what they are doing and what they
 * look like doing it.
 *
 * An Actor is a small state machine with no three.js in it. The EmployeeSystem
 * copies its public state (position, facing, pose, scale …) onto a Character
 * every frame; the Crew tells it what to do next (walk in, run an errand,
 * leave). Keeping it pure is what lets the awkward cases — a scene landing
 * mid-walk, a seat changing under someone, a person being let go on their way to
 * the coffee machine — be unit-tested without a renderer.
 *
 * Nobody can get stuck: every mode either runs on a timer or has a watchdog, and
 * when a watchdog fires the person is simply put back in their seat (or, if they
 * were on their way out, removed). So an actor always comes to rest, and `busy`
 * says when it has: the drawing loop stops once nobody is busy.
 *
 * A "seat" is a desk chair or a spot at the door (Seat.kind "waiting"), where
 * somebody leaving or expected stands. "Seated" means at that place, sitting or
 * standing as the place has it.
 */
import type { CastMember } from "../cast";
import { easeOutBack } from "../core/math";
import { findPath, pathLength } from "../office/layouts";
import type { BubbleIcon, OfficeLayout, Seat, Team, Vec2 } from "../types";
import { CHAIR_SIDESTEP, chairApproach } from "./approach";
import type { CharacterPose } from "./Character";
import { angleDelta, PathFollower, turnToward, TURN_RATE } from "./pathFollower";

/** Normal walking pace, in world units per second. */
export const WALK_SPEED = 1.6;
/** How much faster somebody walks when they have been told to hurry. */
export const HURRY_FACTOR = 2.2;
/**
 * Getting up before the first step: the chair is pushed back while they are still
 * sitting (RISE_PUSH_SECONDS), then they stand. Their legs never swing through it.
 */
export const RISE_SECONDS = 0.36;
const RISE_PUSH_SECONDS = 0.14;
/** How long a desk chair takes to roll all the way out from under somebody, or back in. */
export const CHAIR_SECONDS = 0.3;
/** The longest anybody waits for the doorway (or the person ahead of them) to clear. */
export const DOOR_HOLD_LIMIT = 12;
/**
 * Walking back to their chair, it starts to roll out of the way this far (walking
 * distance) from the seat: the step in beside it plus enough for the chair to be
 * clear before they reach it.
 */
const CHAIR_ROLL_OUT_AT = CHAIR_SIDESTEP + 0.6;
/** Scale-in when somebody appears; scale-out when they vanish. */
export const POP_SECONDS = 0.28;
export const VANISH_SECONDS = 0.2;

/** Longest somebody may take to turn to their desk before they are simply sat down. */
const SETTLE_LIMIT = 0.5;
const SETTLE_TOLERANCE = 0.03;
/** A walk may take this many times its ideal duration (plus a grace period) before the watchdog fires. */
const WALK_SLACK = 1.7;
const WALK_GRACE = 2;
/** Nobody stays away from their seat longer than this, whatever chain of errands they are on. */
const TRIP_LIMIT = 45;

export type ActorMode =
  /** Not on stage yet: waiting for their turn to walk in or pop in. Invisible. */
  | "waiting"
  /** In their seat (the pose says what they are doing there). */
  | "seated"
  /** Getting up to go somewhere. */
  | "rising"
  | "walking"
  /** Standing at the end of an errand leg. */
  | "pausing"
  /** Back at the seat, turning to face the desk. */
  | "settling"
  /** Shrinking away before removal. */
  | "vanishing"
  /** Finished: the owner should remove this actor. */
  | "gone";

/** Where the current trip ends. */
export type ActorGoal = "home" | "errand" | "exit";
/** Why somebody is away from their seat of their own accord: a wander to the coffee machine or another spot. */
export type ErrandKind = "wander";

export interface ErrandLeg {
  x: number;
  z: number;
  /** Direction to turn to on arrival (null = keep the direction of travel). */
  facing: number | null;
  /** Seconds to stand there. */
  pause: number;
  /** Bubble to show on arrival. */
  bubble: BubbleIcon | null;
}

/** What an actor needs from the world around it. */
export interface ActorStage {
  readonly layout: OfficeLayout;
  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void;
  /** The actor just sat down at the end of an arrival or a seat move (worth a puff of dust). */
  settled(actor: Actor): void;
  /**
   * Should this arrival stay outside a moment longer (somebody is on their way out)?
   * Asked every frame once their turn has come. Absent = never.
   */
  holdArrival?(actor: Actor): boolean;
  /**
   * Should this leaver wait — before getting up, or on the way to the door — for
   * the doorway or the person ahead of them to clear? Absent = never.
   */
  holdExit?(actor: Actor): boolean;
  /**
   * Should this leaver, on the way out, stop to keep a step behind the person ahead?
   * A queue always moves (its front never waits), so this has no time limit of its
   * own; the trip watchdog still applies. Absent = never.
   */
  queueBehind?(actor: Actor): boolean;
}

const NO_LEGS: readonly ErrandLeg[] = [];

const sameSpot = (a: Seat, b: Seat): boolean =>
  a === b || (a.x === b.x && a.z === b.z && a.facing === b.facing && a.kind === b.kind);

export class Actor {
  readonly id: string;
  readonly look: number;
  /**
   * Whose shirt they wear: the team they are in, or were last in. Somebody who leaves keeps the shirt; somebody
   * expected, whom no team has yet, has none (null).
   */
  team: Team | null;
  /** This person as the latest cast has them. */
  person: CastMember;

  /** The seat this person belongs in. */
  home: Seat;
  mode: ActorMode = "seated";
  goal: ActorGoal = "home";
  /** Why they are away from their seat, when it is an errand. Cleared when they sit back down. */
  errand: ErrandKind | null = null;
  /** Set by the Crew once this actor is off the books (leaving, or already removed). */
  dismissed = false;

  // ── What the body should show (read by the EmployeeSystem every frame) ──────
  pose: CharacterPose = "type";
  /** The `seated` option that goes with `pose`. */
  poseSeated = true;
  /** Ground speed for the walk cycle. */
  walkSpeed = 0;
  /** 0 … 1; see CharacterHandle.setEnergy. */
  energy = 0.75;
  /** Carrying a box of desk things (somebody on their way out). Worked out from `packed` and the exit. */
  carrying = false;
  /** Has packed their desk into a box (somebody let go, standing at the door): they carry it whenever they are up. */
  packed = false;
  visible = true;
  /** Bumped whenever the actor is moved discontinuously, so the body can snap its pose instead of blending. */
  teleports = 0;
  /**
   * How far their desk chair is pulled out: 0 while they sit in it, 1 while they are
   * on their feet. Rolls between the two as they get up and sit down (always 0 at a
   * spot by the door, which has no chair).
   */
  chairOut = 0;

  private readonly motion = new PathFollower();
  private legs: readonly ErrandLeg[] = NO_LEGS;
  private leg = 0;
  private exitPoint: Vec2 | null = null;
  /** Seconds until a pending exit starts; negative when none is pending. */
  private exitDelay = -1;
  private carryOnExit = false;
  /** Walking out with the box. */
  private carryingOut = false;
  /** Countdown for the timed modes (waiting, rising, pausing, settling). */
  private timer = 0;
  private walkLimit = 0;
  /** Seconds spent away from the seat on the current trip. */
  private awayFor = 0;
  /** While positive the actor hurries; when it runs out they are snapped to where they were going. */
  private hurryLeft = 0;
  /** 0 … 1 progress of the scale-in (or, while vanishing, what is left of the scale-out). */
  private growth = 1;
  private afterWait: "enter" | "pop" = "pop";
  private waveOnEntry = false;
  private dustOnSit = false;
  /** The seat they are physically sitting in right now (null once they have stepped away from it). */
  private sittingIn: Seat | null = null;
  /** The chair they are stepping out from beside, until they are clear of it. */
  private steppingOutOf: Seat | null = null;
  /** Walked in from outside and not sat down yet. */
  private arrivingFromOutside = false;
  /** Seconds spent waiting for the doorway on the current arrival / exit. */
  private heldFor = 0;
  /** Standing still mid-walk, giving way (this frame). */
  private holding = false;

  constructor(person: CastMember, home: Seat) {
    this.id = person.id;
    this.team = person.team;
    this.look = person.look;
    this.person = person;
    this.home = home;
    this.placeAtHome();
  }

  get x(): number {
    return this.motion.x;
  }

  get z(): number {
    return this.motion.z;
  }

  get facing(): number {
    return this.motion.facing;
  }

  /** Uniform scale for the body: 1 normally, animating while popping in or vanishing. */
  get scale(): number {
    if (this.growth >= 1) return 1;
    return this.mode === "vanishing" ? Math.max(0, this.growth) : Math.max(0, easeOutBack(this.growth));
  }

  /**
   * Still doing something that will come to an end: waiting for a turn, on their feet, appearing, leaving, or the
   * chair still rolling. Somebody at their place and merely alive (typing, swaying, breathing) is not busy: the
   * loop may rest on them.
   */
  get busy(): boolean {
    if (this.mode === "gone") return false;
    return (
      this.mode !== "seated" ||
      this.exitDelay >= 0 ||
      this.growth < 1 ||
      this.hurryLeft > 0 ||
      this.chairOut !== 0
    );
  }

  /** In the seat, undisturbed and fully arrived: available for ambient behaviour. */
  get seatedIdle(): boolean {
    return this.mode === "seated" && this.goal === "home" && this.exitDelay < 0 && this.growth >= 1;
  }

  /** Away from the seat (or not yet arrived at it). */
  get away(): boolean {
    return this.mode !== "seated";
  }

  /** On the way out, or about to be. */
  get leaving(): boolean {
    return this.goal === "exit" || this.exitDelay >= 0;
  }

  /** On stage and on their feet heading out: getting up to leave, walking to the door, or fading out there. */
  get exiting(): boolean {
    return this.goal === "exit" && this.visible && (this.mode === "rising" || this.mode === "walking" || this.mode === "vanishing");
  }

  /** On stage, having come in through the door, and not sat down yet. */
  get arriving(): boolean {
    return this.arrivingFromOutside && this.visible;
  }

  /** Walking distance left on the current walk (0 when not walking). */
  get distanceLeft(): number {
    return this.mode === "walking" ? this.motion.remaining() : 0;
  }

  /** Part of the room right now — including the moment somebody is hidden while the office is rebuilt around them. */
  get present(): boolean {
    return this.visible || (this.mode === "waiting" && this.afterWait === "pop");
  }

  get gone(): boolean {
    return this.mode === "gone";
  }

  /** The errand stop this actor is heading for or standing at, if any. */
  get errandStop(): ErrandLeg | null {
    return this.goal === "errand" && this.leg < this.legs.length ? this.legs[this.leg] : null;
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  /** Be in the seat, now, with no animation. */
  placeAtHome(): void {
    this.motion.place(this.home.x, this.home.z, this.home.facing);
    this.mode = "seated";
    this.goal = "home";
    this.errand = null;
    this.legs = NO_LEGS;
    this.leg = 0;
    this.hurryLeft = 0;
    this.awayFor = 0;
    this.growth = 1;
    this.visible = true;
    this.carryingOut = false;
    this.dustOnSit = false;
    this.sittingIn = this.home;
    this.chairOut = 0;
    this.arrivingFromOutside = false;
    this.heldFor = 0;
    this.teleports += 1;
    this.resolvePose();
  }

  /** Appear at `from` after `delay` seconds and walk to the seat. */
  enterFrom(from: Vec2, facing: number, delay: number, wave: boolean): void {
    this.placeAtHome();
    this.motion.place(from.x, from.z, facing);
    this.mode = "waiting";
    this.timer = Math.max(0, delay);
    this.afterWait = "enter";
    this.waveOnEntry = wave;
    this.dustOnSit = true;
    this.visible = false;
    this.growth = 0;
    this.sittingIn = null;
    this.arrivingFromOutside = true;
  }

  /** Pop into the seat (scale-in) after `delay` seconds. */
  popInAtHome(delay: number): void {
    this.placeAtHome();
    this.mode = "waiting";
    this.timer = Math.max(0, delay);
    this.afterWait = "pop";
    this.visible = false;
    this.growth = 0;
  }

  /** The office was rebuilt around them: drop everything and pop in at the new seat. */
  relocate(seat: Seat, delay: number): void {
    this.home = seat;
    this.popInAtHome(delay);
  }

  /** Their seat changed within the same office: walk over to the new one. */
  rehome(seat: Seat, stage: ActorStage): void {
    const moved = !sameSpot(this.home, seat);
    this.home = seat;
    if (!moved || this.leaving) return;
    switch (this.mode) {
      case "waiting":
        // Not on stage yet. Somebody due to pop in does so at the new seat; a walk-in
        // works out its route when it starts.
        if (this.afterWait === "pop") this.motion.place(seat.x, seat.z, seat.facing);
        break;
      case "seated":
        this.dustOnSit = true;
        this.beginRising();
        break;
      case "settling":
        this.dustOnSit = true;
        this.walkTo(seat, stage);
        break;
      case "walking":
        if (this.goal === "home") this.walkTo(seat, stage);
        break;
      default:
        // Rising and pausing pick the new seat up when they next set off.
        break;
    }
  }

  /** Go to each stop in turn, then come back and sit down. */
  runErrand(kind: ErrandKind, legs: readonly ErrandLeg[], stage: ActorStage): void {
    if (legs.length === 0 || this.leaving || this.mode === "waiting" || this.mode === "vanishing") return;
    this.goal = "errand";
    this.errand = kind;
    this.legs = legs;
    this.leg = 0;
    if (this.mode === "seated") this.beginRising();
    else if (this.mode !== "rising") this.walkTo(legs[0], stage);
  }

  /**
   * Leave the office for good: after `delay` seconds stand up (wherever they are
   * by then), walk to `exit` and disappear. Until the delay is up they carry on
   * as they were. From here on the actor ends in "gone" no matter what happens.
   */
  leave(exit: Vec2, delay: number, carrying: boolean): void {
    if (this.mode === "gone") return;
    if (this.mode === "waiting") {
      // Never made it on stage; there is nobody to walk out.
      this.mode = "gone";
      return;
    }
    this.exitPoint = { x: exit.x, z: exit.z };
    this.exitDelay = Math.max(0, delay);
    this.carryOnExit = carrying;
  }

  /** Shrink away on the spot, then be gone. */
  vanish(): void {
    if (this.mode === "gone") return;
    this.goal = "exit";
    this.exitDelay = -1;
    if (this.mode === "waiting") {
      this.mode = "gone";
      return;
    }
    this.mode = "vanishing";
    this.growth = Math.min(1, this.growth);
    this.walkSpeed = 0;
  }

  /**
   * Wrap up within `seconds`: abandon any errand and head for the seat (or the
   * exit) at a trot; whoever has not made it by then is snapped there.
   */
  hurry(seconds: number, stage: ActorStage): void {
    if (this.mode === "gone" || this.mode === "vanishing") return;
    if (this.goal !== "exit") {
      if (this.mode === "seated") return;
      this.goal = "home";
      this.legs = NO_LEGS;
      this.leg = 0;
      if (this.mode === "waiting") this.timer = 0;
      else if (this.mode !== "rising") this.walkTo(this.home, stage);
    }
    this.hurryLeft = Math.max(0.001, seconds);
  }

  // ── Per frame ───────────────────────────────────────────────────────────────

  update(dt: number, stage: ActorStage): void {
    if (this.mode === "gone") return;

    if (this.hurryLeft > 0) {
      this.hurryLeft -= dt;
      if (this.hurryLeft <= 0) {
        this.hurryLeft = 0;
        this.bail();
        if (this.gone) return;
      }
    }

    if (this.exitDelay >= 0) {
      this.exitDelay -= dt;
      if (this.exitDelay < 0) {
        // Somebody still sitting waits at their desk until the doorway is clear.
        if (this.mode === "seated" && this.held(dt, stage.holdExit?.(this))) this.exitDelay = 0;
        else this.beginExit(stage);
      }
    }

    if (this.mode !== "waiting" && this.mode !== "vanishing" && this.growth < 1) {
      this.growth = Math.min(1, this.growth + dt / POP_SECONDS);
    }

    if (this.mode !== "seated" && this.mode !== "waiting") {
      this.awayFor += dt;
      if (this.awayFor > TRIP_LIMIT) this.bail();
    }

    switch (this.mode) {
      case "waiting":
        this.timer -= dt;
        if (this.timer <= 0 && !(this.afterWait === "enter" && this.held(dt, stage.holdArrival?.(this)))) this.appear(stage);
        break;
      case "rising":
        this.timer -= dt;
        if (this.timer <= 0) this.setOff(stage);
        break;
      case "walking":
        this.walk(dt, stage);
        break;
      case "pausing":
        this.pause(dt, stage);
        break;
      case "settling":
        this.motion.facing = turnToward(this.motion.facing, this.home.facing, TURN_RATE * dt);
        this.timer -= dt;
        if (this.timer <= 0 || Math.abs(angleDelta(this.motion.facing, this.home.facing)) < SETTLE_TOLERANCE) this.sit(stage);
        break;
      case "vanishing":
        this.growth -= dt / VANISH_SECONDS;
        if (this.growth <= 0) {
          this.growth = 0;
          this.visible = false;
          this.mode = "gone";
        }
        break;
      default:
        break;
    }

    this.rollChair(dt);
    this.resolvePose();
  }

  /**
   * Ask the stage whether to keep waiting for the doorway. Nobody waits longer
   * than DOOR_HOLD_LIMIT in all, so a busy door can never strand anyone.
   */
  private held(dt: number, asked: boolean | undefined): boolean {
    if (!asked || this.heldFor >= DOOR_HOLD_LIMIT) return false;
    this.heldFor += dt;
    return true;
  }

  /** Move the chair toward where it should be for what they are doing now. */
  private rollChair(dt: number): void {
    const target = this.home.kind === "desk" ? this.chairWanted() : 0;
    if (target === this.chairOut) return;
    const step = dt / CHAIR_SECONDS;
    this.chairOut = target > this.chairOut ? Math.min(target, this.chairOut + step) : Math.max(target, this.chairOut - step);
  }

  /**
   * The chair is out of the way only around getting up and sitting down: from
   * standing up until they have stepped clear of it, and from a little before
   * they step in until they sit. The rest of the time it stands at the desk,
   * where the walking routes expect it.
   */
  private chairWanted(): number {
    switch (this.mode) {
      case "rising":
      case "settling":
        return 1;
      case "walking": {
        const out = this.steppingOutOf;
        if (out) {
          if (Math.hypot(this.motion.x - out.x, this.motion.z - out.z) < CHAIR_SIDESTEP - 0.05) return 1;
          this.steppingOutOf = null;
        }
        return this.goal === "home" && this.motion.remaining() < CHAIR_ROLL_OUT_AT ? 1 : 0;
      }
      case "vanishing":
      case "gone":
        // Shrinking away on the spot: leave the chair where it is.
        return this.chairOut;
      default:
        return 0;
    }
  }

  // ── Transitions ─────────────────────────────────────────────────────────────

  private beginRising(): void {
    this.mode = "rising";
    this.timer = RISE_SECONDS;
  }

  /** The entrance / pop-in delay is over: come on stage. */
  private appear(stage: ActorStage): void {
    this.visible = true;
    if (this.afterWait === "pop") {
      this.mode = "seated";
      return;
    }
    if (this.waveOnEntry) stage.bubble(this, "wave");
    this.waveOnEntry = false;
    this.walkTo(this.home, stage);
  }

  /** Start walking toward wherever the current goal is. */
  private setOff(stage: ActorStage): void {
    if (this.goal === "exit" && this.exitPoint) this.walkTo(this.exitPoint, stage);
    else if (this.goal === "errand" && this.leg < this.legs.length) this.walkTo(this.legs[this.leg], stage);
    else {
      this.goal = "home";
      this.walkTo(this.home, stage);
    }
  }

  /**
   * Start walking to `point`. Somebody leaving a chair first steps out beside it;
   * somebody heading for their own chair walks to the spot beside it and steps
   * across in front of it (the chair is rolled back out of the way meanwhile), so
   * nobody walks through a chair back.
   */
  private walkTo(point: Vec2, stage: ActorStage): void {
    const { layout } = stage;
    this.holding = false;
    const from = { x: this.motion.x, z: this.motion.z };
    const path: Vec2[] = [];
    let start: Vec2 = from;
    const leaving = this.sittingIn;
    this.sittingIn = null;
    this.steppingOutOf = null;
    if (leaving && leaving.kind === "desk") {
      const out = chairApproach(layout, leaving, point);
      if (out) {
        path.push(out);
        start = out;
        this.steppingOutOf = leaving;
      }
    }
    const into = point === this.home && this.home.kind === "desk" ? chairApproach(layout, this.home, start) : null;
    if (into) {
      path.push(...findPath(layout, start, into), { x: point.x, z: point.z });
    } else {
      path.push(...findPath(layout, start, point));
    }
    this.motion.follow(path);
    this.mode = "walking";
    this.walkLimit = (pathLength(from, path) / WALK_SPEED) * WALK_SLACK + WALK_GRACE;
    if (!this.motion.moving) this.arrive(stage);
  }

  private walk(dt: number, stage: ActorStage): void {
    // On the way out, people give way at the door (and keep a step behind whoever is ahead).
    this.holding =
      this.goal === "exit" && (this.held(dt, stage.holdExit?.(this)) || stage.queueBehind?.(this) === true);
    if (this.holding) return;
    this.walkLimit -= dt;
    if (this.walkLimit <= 0) {
      this.bail();
      return;
    }
    const speed = this.hurryLeft > 0 ? WALK_SPEED * HURRY_FACTOR : WALK_SPEED;
    if (this.motion.advance(dt, speed)) this.arrive(stage);
  }

  private arrive(stage: ActorStage): void {
    if (this.goal === "exit") {
      this.mode = "vanishing";
      this.growth = Math.min(1, this.growth);
      return;
    }
    if (this.goal === "errand" && this.leg < this.legs.length) {
      const leg = this.legs[this.leg];
      this.mode = "pausing";
      this.timer = leg.pause;
      if (leg.bubble) stage.bubble(this, leg.bubble, Math.max(1.2, Math.min(leg.pause, 2.4)));
      return;
    }
    this.goal = "home";
    this.mode = "settling";
    this.timer = SETTLE_LIMIT;
  }

  private pause(dt: number, stage: ActorStage): void {
    const leg = this.leg < this.legs.length ? this.legs[this.leg] : null;
    if (leg && leg.facing !== null) this.motion.facing = turnToward(this.motion.facing, leg.facing, TURN_RATE * dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.leg += 1;
    this.setOff(stage);
  }

  private sit(stage: ActorStage): void {
    const dust = this.dustOnSit;
    this.motion.place(this.home.x, this.home.z, this.home.facing);
    this.sittingIn = this.home;
    this.arrivingFromOutside = false;
    this.heldFor = 0;
    this.mode = "seated";
    this.goal = "home";
    this.errand = null;
    this.legs = NO_LEGS;
    this.leg = 0;
    this.hurryLeft = 0;
    this.awayFor = 0;
    this.dustOnSit = false;
    if (dust) stage.settled(this);
  }

  /** A pending exit comes due: whatever they were doing, they now head for the door. */
  private beginExit(stage: ActorStage): void {
    this.exitDelay = -1;
    this.heldFor = 0;
    this.goal = "exit";
    this.errand = null;
    this.legs = NO_LEGS;
    this.leg = 0;
    this.hurryLeft = 0;
    this.carryingOut = this.carryOnExit;
    if (this.mode === "seated") this.beginRising();
    else if (this.mode !== "rising" && this.mode !== "vanishing") this.setOff(stage);
  }

  /** A watchdog fired or time ran out: finish the trip instantly. */
  private bail(): void {
    if (this.goal === "exit") {
      this.visible = false;
      this.mode = "gone";
    } else {
      this.placeAtHome();
    }
  }

  // ── Pose ────────────────────────────────────────────────────────────────────

  /**
   * Work out `pose` from the current state. `update` does this every frame; call
   * it directly after changing `packed` or the seat when the result must be right
   * before the next frame (a scene is shown as soon as it is applied).
   */
  resolvePose(): void {
    this.carrying = this.packed || this.carryingOut;
    switch (this.mode) {
      case "waiting":
      case "seated":
        this.resolveSeatedPose();
        this.walkSpeed = 0;
        break;
      case "walking":
        if (this.holding) this.setPose("stand", false, 0);
        else this.setPose("walk", false, this.motion.speed);
        break;
      case "pausing":
        this.setPose("stand", false, 0);
        break;
      case "rising":
        // Still sitting while the chair is pushed back, then up.
        if (this.timer > RISE_SECONDS - RISE_PUSH_SECONDS) this.resolveSeatedPose();
        else this.setPose("stand", false, 0);
        this.walkSpeed = 0;
        break;
      case "settling":
        this.setPose("stand", false, 0);
        break;
      default:
        // Vanishing / gone: keep whatever they were doing while they shrink away.
        this.walkSpeed = 0;
        break;
    }
  }

  private resolveSeatedPose(): void {
    // At a desk people sit and work; at a spot by the door they stand, and wait.
    if (this.home.kind === "desk") this.setPose("type", true, 0);
    else this.setPose("stand", false, 0);
  }

  private setPose(pose: CharacterPose, seated: boolean, walkSpeed: number): void {
    this.pose = pose;
    this.poseSeated = seated;
    this.walkSpeed = walkSpeed;
  }
}
