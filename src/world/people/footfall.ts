/**
 * The moments in the people system worth hearing, read off the actors as they happen:
 *
 *   • an arrival's footsteps, timed to end as they reach their seat (swelling: approach +1);
 *   • somebody leaving: footsteps as they set off for the door (fading: approach −1);
 *   • the founder's `coffee` errand: steps there and steps back (passing: approach 0);
 *   • the chair taking an arrival's weight when they sit down.
 *
 * Ordinary wandering, pacing and moving desks stay silent: a busy floor is the ambience's job.
 * It only observes — nothing here changes what anybody does — and it is only built when the
 * app has asked for these sounds (WorldContext.sound).
 */
import { clamp } from "../core/math";
import type { Vec2, WorldSoundSink } from "../types";
import { WALK_SPEED, type ActorGoal, type ActorMode, type ErrandKind } from "./actor";

/** What Footfall reads off an Actor each frame. */
export interface FootfallSubject {
  readonly mode: ActorMode;
  readonly goal: ActorGoal;
  readonly errand: ErrandKind | null;
  readonly x: number;
  readonly z: number;
  readonly home: Vec2;
  readonly errandStop: Vec2 | null;
  /** On stage, having come in through the door, and not sat down yet. */
  readonly arriving: boolean;
  /** Walking distance left on the current walk (0 when not walking). */
  readonly distanceLeft: number;
  /** Bumped whenever the actor is moved discontinuously (placed, not walked). */
  readonly teleports: number;
}

/** The footsteps sound spaces its steps about 0.3 s apart: this much ground per step at walking pace. */
export const STEP_LENGTH = WALK_SPEED * 0.3;
/** The footsteps sound plays at most this many steps. */
export const MAX_STEPS = 6;
/** An arrival's steps start this far (walking distance) from the seat, so the last one lands as they get there. */
export const ARRIVAL_STEPS_FROM = STEP_LENGTH * MAX_STEPS;

/** Steps to play for a walk of `distance` world units. */
export const stepsFor = (distance: number): number =>
  Number.isFinite(distance) ? clamp(Math.round(distance / STEP_LENGTH), 1, MAX_STEPS) : 1;

interface Track {
  mode: ActorMode;
  teleports: number;
  arriving: boolean;
  /** This arrival's footsteps have been played. */
  arrivalHeard: boolean;
}

export class Footfall {
  private readonly sink: WorldSoundSink;
  private readonly tracks = new WeakMap<FootfallSubject, Track>();
  private readonly here: Vec2 = { x: 0, z: 0 };

  constructor(sink: WorldSoundSink) {
    this.sink = sink;
  }

  /**
   * Call once per frame for every actor on stage or on their way out, after they have moved.
   * `door` is the spot just inside the front door (where leavers are heading).
   */
  observe(actor: FootfallSubject, door: Vec2): void {
    const track = this.tracks.get(actor);
    if (!track) {
      // First sight: whatever they are doing was already under way.
      this.tracks.set(actor, { mode: actor.mode, teleports: actor.teleports, arriving: actor.arriving, arrivalHeard: false });
      return;
    }
    const teleported = track.teleports !== actor.teleports;
    const setOff = actor.mode === "walking" && track.mode !== "walking";
    const here = this.here;
    here.x = actor.x;
    here.z = actor.z;

    if (actor.arriving && actor.mode === "walking") {
      const left = actor.distanceLeft;
      if (!track.arrivalHeard && left > 0 && left <= ARRIVAL_STEPS_FROM) {
        track.arrivalHeard = true;
        this.sink.footsteps(here, actor.home, stepsFor(left), 1);
      }
    } else if (setOff && actor.goal === "exit") {
      this.sink.footsteps(here, door, stepsFor(actor.distanceLeft), -1);
    } else if (setOff && actor.errand === "coffee") {
      this.sink.footsteps(here, actor.errandStop ?? actor.home, stepsFor(actor.distanceLeft), 0);
    }

    // Sat down at the end of walking in (not put back in the seat by a watchdog or a rebuild).
    if (track.arriving && !actor.arriving && actor.mode === "seated" && !teleported) this.sink.chairSit(actor.home);

    if (!actor.arriving) track.arrivalHeard = false;
    track.mode = actor.mode;
    track.teleports = actor.teleports;
    track.arriving = actor.arriving;
  }
}
