import { describe, expect, it } from "vitest";
import type { Vec2 } from "../types";
import { angleDelta, headingBetween, PathFollower, turnToward, TURN_RATE, wrapAngle } from "./pathFollower";

const DT = 1 / 60;

/** Distance from a point to the nearest point of a polyline. */
const distanceToRoute = (x: number, z: number, route: readonly Vec2[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < route.length; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
};

/** Advance until arrival; returns the seconds it took (or Infinity if it never arrived). */
const walk = (follower: PathFollower, speed: number, each?: () => void, limit = 60): number => {
  for (let time = DT; time < limit; time += DT) {
    const arrived = follower.advance(DT, speed);
    each?.();
    if (arrived) return time;
  }
  return Infinity;
};

describe("angle helpers", () => {
  it("wraps into (−π, π]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(3 * Math.PI + 0.25)).toBeCloseTo(-Math.PI + 0.25);
    expect(wrapAngle(-7)).toBeCloseTo(-7 + 2 * Math.PI);
  });

  it("measures the short way round", () => {
    expect(angleDelta(0.1, 0.4)).toBeCloseTo(0.3);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it("turns by at most the step and lands exactly on the target", () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25);
    expect(turnToward(0, 0.2, 0.25)).toBeCloseTo(0.2);
    // Across the ±π seam the short way is forwards, not back through zero.
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1);
  });

  it("uses the layout's facing convention: 0 looks along +Z, π/2 along +X", () => {
    expect(headingBetween(0, 0, 0, 1)).toBeCloseTo(0);
    expect(headingBetween(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2);
    expect(headingBetween(0, 0, -1, 0)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("PathFollower", () => {
  it("stands still until given a route", () => {
    const follower = new PathFollower();
    follower.place(1, 2, 0.5);
    expect(follower.moving).toBe(false);
    expect(follower.advance(DT, 1.6)).toBe(false);
    expect([follower.x, follower.z, follower.facing]).toEqual([1, 2, 0.5]);
    expect(follower.speed).toBe(0);
  });

  it("walks a straight line at the requested speed and stops exactly on the end", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([{ x: 0, z: 8 }]);
    const seconds = walk(follower, 1.6);
    expect(seconds).toBeGreaterThan(8 / 1.6 - 2 * DT);
    expect(seconds).toBeLessThan(8 / 1.6 + 2 * DT);
    expect(follower.x).toBe(0);
    expect(follower.z).toBe(8);
    expect(follower.moving).toBe(false);
  });

  it("reports arrival exactly once", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([{ x: 0, z: 0.5 }]);
    let arrivals = 0;
    for (let i = 0; i < 120; i += 1) if (follower.advance(DT, 1.6)) arrivals += 1;
    expect(arrivals).toBe(1);
  });

  it("never leaves the route, even around sharp corners", () => {
    const route: Vec2[] = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 1.5 },
      { x: -1, z: 1.5 },
      { x: -1, z: -2 },
      { x: -0.9, z: -2 },
    ];
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow(route.slice(1));
    let worst = 0;
    const seconds = walk(follower, 1.6, () => {
      worst = Math.max(worst, distanceToRoute(follower.x, follower.z, route));
    });
    expect(Number.isFinite(seconds)).toBe(true);
    expect(worst).toBeLessThan(1e-9);
    expect([follower.x, follower.z]).toEqual([-0.9, -2]);
  });

  it("turns smoothly: never faster than the turn rate, and ends up facing the way it walks", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([{ x: 5, z: 0 }]);
    let previous = follower.facing;
    let fastest = 0;
    for (let i = 0; i < 60; i += 1) {
      follower.advance(DT, 1.6);
      fastest = Math.max(fastest, Math.abs(angleDelta(previous, follower.facing)));
      previous = follower.facing;
    }
    expect(fastest).toBeLessThanOrEqual(TURN_RATE * DT + 1e-9);
    expect(follower.facing).toBeCloseTo(Math.PI / 2);
  });

  it("shuffles while facing the wrong way, then picks up to full speed", () => {
    const follower = new PathFollower();
    follower.place(0, 0, Math.PI); // back to the destination
    follower.follow([{ x: 0, z: 6 }]);
    follower.advance(DT, 1.6);
    expect(follower.speed).toBeGreaterThan(0);
    expect(follower.speed).toBeLessThan(0.5);
    for (let i = 0; i < 60; i += 1) follower.advance(DT, 1.6);
    expect(follower.speed).toBeCloseTo(1.6);
  });

  it("crosses several waypoints in one long step without overshooting", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([
      { x: 0, z: 0.1 },
      { x: 0, z: 0.2 },
      { x: 0, z: 0.3 },
    ]);
    expect(follower.advance(1, 5)).toBe(true);
    expect(follower.z).toBe(0.3);
  });

  it("skips waypoints it is already standing on and treats an empty route as arrived", () => {
    const follower = new PathFollower();
    follower.place(1, 1, 0);
    follower.follow([{ x: 1, z: 1 }]);
    expect(follower.moving).toBe(false);
    follower.follow([]);
    expect(follower.moving).toBe(false);
    follower.follow([
      { x: 1, z: 1 },
      { x: 1, z: 2 },
    ]);
    expect(follower.moving).toBe(true);
    expect(follower.remaining()).toBeCloseTo(1);
  });

  it("does not move on a zero or negative step", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([{ x: 0, z: 3 }]);
    expect(follower.advance(0, 1.6)).toBe(false);
    expect(follower.advance(-1, 1.6)).toBe(false);
    expect(follower.advance(DT, 0)).toBe(false);
    expect(follower.z).toBe(0);
    expect(follower.moving).toBe(true);
  });

  it("finish() jumps to the end; place() drops the route", () => {
    const follower = new PathFollower();
    follower.place(0, 0, 0);
    follower.follow([
      { x: 0, z: 3 },
      { x: 4, z: 3 },
    ]);
    expect(follower.remaining()).toBeCloseTo(7);
    follower.finish();
    expect([follower.x, follower.z, follower.moving]).toEqual([4, 3, false]);
    follower.follow([{ x: 0, z: 0 }]);
    follower.place(9, 9, 1);
    expect(follower.moving).toBe(false);
    expect(follower.remaining()).toBe(0);
  });
});
