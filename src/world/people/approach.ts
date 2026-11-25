/**
 * How people get in and out of a desk chair without walking through it.
 *
 * The chair stands on the seat. Somebody sitting down walks to a spot just
 * beside the chair, the chair rolls back out of the way, they step across in
 * front of it, and it rolls in under them as they sit; getting up is the same
 * in reverse. This module only finds that spot beside the chair. Pure: no
 * three.js.
 */
import { footprintContains, forwardOf, getLayoutObstacles, isInsideFloor } from "../office/layouts";
import type { OfficeLayout, Placement, Seat, Vec2 } from "../types";

/** The `WorldSignals.chairsOut` key of the chair at a seat (the desk's index), or null for a spot by the door (no chair). */
export const chairKey = (seat: Pick<Seat, "kind" | "index">): number | null => (seat.kind === "desk" ? seat.index : null);

/** How far to the side of the seat the step in starts (half a chair plus a body, plus a little air). */
export const CHAIR_SIDESTEP = 0.62;
/** …and how far back from the seat line, so a body standing there keeps clear of the desk edge. */
export const CHAIR_SIDESTEP_BACK = 0.1;
/** Clearance a standing body needs from any other furniture. */
const BODY_CLEARANCE = 0.2;

const cache = new WeakMap<OfficeLayout, Map<string, readonly Vec2[]>>();

const clearSpots = (layout: OfficeLayout, seat: Placement): readonly Vec2[] => {
  let perLayout = cache.get(layout);
  if (!perLayout) {
    perLayout = new Map();
    cache.set(layout, perLayout);
  }
  const key = `${seat.x},${seat.z},${seat.facing}`;
  const known = perLayout.get(key);
  if (known) return known;

  const forward = forwardOf(seat.facing);
  // The seat's own right / left on the floor.
  const sideX = forward.z;
  const sideZ = -forward.x;
  const obstacles = getLayoutObstacles(layout);
  const spots: Vec2[] = [];
  for (const sign of [1, -1]) {
    const spot = {
      x: seat.x + sideX * sign * CHAIR_SIDESTEP - forward.x * CHAIR_SIDESTEP_BACK,
      z: seat.z + sideZ * sign * CHAIR_SIDESTEP - forward.z * CHAIR_SIDESTEP_BACK,
    };
    if (!isInsideFloor(layout, spot, BODY_CLEARANCE)) continue;
    if (obstacles.some((obstacle) => footprintContains(obstacle, spot.x, spot.z, BODY_CLEARANCE))) continue;
    spots.push(spot);
  }
  perLayout.set(key, spots);
  return spots;
};

/**
 * Where to stand to step into (or out of) the chair at `seat`: the clear side
 * of the chair nearer `toward` (where the walk comes from or goes to). Null
 * when neither side is clear; the walker then uses the seat itself.
 */
export const chairApproach = (layout: OfficeLayout, seat: Placement, toward: Vec2): Vec2 | null => {
  const spots = clearSpots(layout, seat);
  if (spots.length === 0) return null;
  if (spots.length === 1) return spots[0];
  const [a, b] = spots;
  return Math.hypot(a.x - toward.x, a.z - toward.z) <= Math.hypot(b.x - toward.x, b.z - toward.z) ? a : b;
};
