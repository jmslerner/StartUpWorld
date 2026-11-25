/**
 * Moves a point along a list of waypoints at a steady pace, turning smoothly.
 *
 * The position never leaves the polyline (that is what keeps people out of the
 * furniture: `findPath` hands us a route that is clear, and we do not cut its
 * corners). Only the heading is smoothed, and a walker who is facing well away
 * from where they are going slows down while they turn, so nobody slides
 * sideways out of their chair.
 *
 * Pure: no three.js, no clock of its own. `advance` never allocates.
 */
import type { Vec2 } from "../types";

/** How fast a walker can turn, in radians per second (a half turn takes about a third of a second). */
export const TURN_RATE = 9.5;
/** Heading error (radians) up to which a walker moves at full speed … */
const FULL_SPEED_ANGLE = 0.45;
/** … and beyond which they only shuffle while they turn. */
const SHUFFLE_ANGLE = 1.9;
const SHUFFLE_FACTOR = 0.22;
/** Waypoints closer than this to the walker are treated as already reached. */
const REACHED = 1e-4;

const TAU = Math.PI * 2;
const NO_POINTS: readonly Vec2[] = [];

/** Wrap an angle into (−π, π]. */
export const wrapAngle = (angle: number): number => {
  let wrapped = angle % TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  else if (wrapped <= -Math.PI) wrapped += TAU;
  return wrapped;
};

/** Signed shortest rotation from `from` to `to`, in (−π, π]. */
export const angleDelta = (from: number, to: number): number => wrapAngle(to - from);

/** Rotate `current` toward `target` by at most `maxStep` radians, the short way round. */
export const turnToward = (current: number, target: number, maxStep: number): number => {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxStep);
};

/** The `facing` (yaw; 0 = +Z, π/2 = +X) that looks from one point toward another. */
export const headingBetween = (fromX: number, fromZ: number, toX: number, toZ: number): number =>
  Math.atan2(toX - fromX, toZ - fromZ);

export class PathFollower {
  x = 0;
  z = 0;
  /** Yaw in radians, same convention as Placement.facing. */
  facing = 0;
  /** Ground speed over the most recent `advance`, in units per second (drives the walk cycle). */
  speed = 0;

  private points: readonly Vec2[] = NO_POINTS;
  private next = 0;

  /** Put the walker somewhere, standing still. Drops any route. */
  place(x: number, z: number, facing: number): void {
    this.x = x;
    this.z = z;
    this.facing = wrapAngle(facing);
    this.clear();
  }

  /** Start walking `points` in order from the current position. The array is kept, not copied. */
  follow(points: readonly Vec2[]): void {
    this.points = points;
    this.next = 0;
    this.speed = 0;
    this.skipReached();
  }

  /** Stop where we are. */
  clear(): void {
    this.points = NO_POINTS;
    this.next = 0;
    this.speed = 0;
  }

  /** True while there is still somewhere to go. */
  get moving(): boolean {
    return this.next < this.points.length;
  }

  /** Distance still to walk along the route. */
  remaining(): number {
    let length = 0;
    let x = this.x;
    let z = this.z;
    for (let i = this.next; i < this.points.length; i += 1) {
      const point = this.points[i];
      length += Math.hypot(point.x - x, point.z - z);
      x = point.x;
      z = point.z;
    }
    return length;
  }

  /** Jump straight to the end of the route (the heading is left alone). */
  finish(): void {
    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      this.x = last.x;
      this.z = last.z;
    }
    this.clear();
  }

  /**
   * Walk for `dt` seconds at up to `speed` units per second.
   * @returns true on the step that reaches the end of the route.
   */
  advance(dt: number, speed: number): boolean {
    if (!this.moving) {
      this.speed = 0;
      return false;
    }
    if (!(dt > 0) || !(speed > 0)) {
      this.speed = 0;
      return false;
    }

    const target = this.points[this.next];
    const heading = headingBetween(this.x, this.z, target.x, target.z);
    const error = Math.abs(angleDelta(this.facing, heading));
    this.facing = turnToward(this.facing, heading, TURN_RATE * dt);

    let pace = 1;
    if (error > FULL_SPEED_ANGLE) {
      const turned = Math.min(1, (error - FULL_SPEED_ANGLE) / (SHUFFLE_ANGLE - FULL_SPEED_ANGLE));
      pace = 1 - turned * (1 - SHUFFLE_FACTOR);
    }

    const step = speed * pace * dt;
    let budget = step;
    while (budget > 0 && this.moving) {
      const point = this.points[this.next];
      const dx = point.x - this.x;
      const dz = point.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= budget) {
        this.x = point.x;
        this.z = point.z;
        budget -= distance;
        this.next += 1;
      } else {
        this.x += (dx / distance) * budget;
        this.z += (dz / distance) * budget;
        budget = 0;
      }
    }
    this.speed = (step - budget) / dt;

    if (this.moving) return false;
    this.clear();
    return true;
  }

  private skipReached(): void {
    while (this.next < this.points.length) {
      const point = this.points[this.next];
      if (Math.hypot(point.x - this.x, point.z - this.z) > REACHED) break;
      this.next += 1;
    }
  }
}
