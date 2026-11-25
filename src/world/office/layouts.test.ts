import { describe, expect, it } from "vitest";
import { MAX_STAFF_DRAWN, MAX_WAITING_DRAWN } from "../cast";
import type { OfficeIndex, OfficeLayout, Placement, StationKind, Vec2 } from "../types";
import {
  CHAIR_SIZE,
  DESKS,
  DESK_OFFSET,
  DESK_SIZE,
  FRAME_REFERENCE_ASPECT,
  ISO_AZIMUTH,
  ISO_ELEVATION,
  NAV_AGENT_RADIUS,
  NAV_CELL_SIZE,
  STAND_DISTANCE,
  STATION_KINDS,
  FRAME_APRON,
  GROUND_DEPTH,
  STATION_SIZES,
  WALL_HEIGHT,
  chairFootprint,
  computeLayoutFrame,
  decorFootprint,
  deskCenter,
  deskFootprint,
  doorExterior,
  findPath,
  fitViewHeight,
  footprintContains,
  footprintGap,
  footprintsOverlap,
  forwardOf,
  getLayoutDecor,
  getLayoutFrame,
  getLayoutObstacles,
  getOfficeLayout,
  groundRect,
  isFootprintInsideFloor,
  isInsideFloor,
  isWalkable,
  makeFootprint,
  normalizeFacing,
  pathLength,
  registerLayoutDecor,
  segmentHitsFootprint,
  stationFootprint,
  viewHeightForFrame,
  waitingFootprint,
} from "./layouts";
import type { DecorSpot, Obstacle } from "./layouts";

/** The five offices: the garage, the shared office, the company's own office, the full floor, the campus. */
const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];
const OFFICE_NAMES = ["garage", "shared office", "own office", "full floor", "campus"] as const;

/**
 * What each plan must offer. `desks` is how many people the office holds (4, 9, 22, 40), and at the campus, which
 * holds 150, how many figures are ever drawn.
 */
const SPEC: readonly { desks: number; waiting: number; width: number; depth: number }[] = [
  { desks: 4, waiting: 4, width: 8, depth: 7 },
  { desks: 9, waiting: 6, width: 12, depth: 10 },
  { desks: 22, waiting: 8, width: 17, depth: 13 },
  { desks: 40, waiting: 10, width: 23, depth: 17 },
  { desks: 50, waiting: 12, width: 27, depth: 19 },
];

/** Who a walk is heading to: the furniture they are allowed to step into. */
type Destination =
  | { kind: "seat"; slotIndex: number; at: Placement; label: string }
  | { kind: "floor"; at: Placement; label: string };

const allSeats = (layout: OfficeLayout): Extract<Destination, { kind: "seat" }>[] =>
  layout.deskSeats.map((at, slotIndex): Extract<Destination, { kind: "seat" }> => ({ kind: "seat", slotIndex, at, label: `desk ${slotIndex}` }));

const allDestinations = (layout: OfficeLayout): Destination[] => [
  ...allSeats(layout),
  ...layout.waitingSpots.map((at, i): Destination => ({ kind: "floor", at, label: `waiting spot ${i}` })),
  ...STATION_KINDS.map((kind): Destination => ({ kind: "floor", at: layout.stationStandSpots[kind], label: `${kind} stand spot` })),
  ...layout.wanderSpots.map((at, i): Destination => ({ kind: "floor", at, label: `wander spot ${i}` })),
  { kind: "floor", at: layout.door, label: "door" },
];

/** Is this obstacle part of the walker's own seat (their desk or their chair)? */
const isOwnSeatFurniture = (obstacle: Obstacle, destination: Destination): boolean =>
  destination.kind === "seat" && (obstacle.kind === "desk" || obstacle.kind === "chair") && obstacle.slotIndex === destination.slotIndex;

/**
 * Is this the one piece of furniture the walker ends up in, and may therefore
 * walk into: their own chair. Their desk is NOT included —
 * people get into a chair from the aisle, not across the desk.
 */
const belongsTo = (obstacle: Obstacle, destination: Destination): boolean =>
  obstacle.kind === "chair" && isOwnSeatFurniture(obstacle, destination);

const describeObstacle = (obstacle: Obstacle): string =>
  obstacle.kind === "station"
    ? `station ${obstacle.station}`
    : obstacle.kind === "decor"
      ? `decor ${obstacle.decor} ${obstacle.decorIndex}`
      : `${obstacle.kind} ${obstacle.slotIndex}`;

/** Obstacles a walk from `from` to `to` comes within `pad` of, ignoring the furniture each end sits in. */
const obstaclesCrossed = (layout: OfficeLayout, from: Destination, to: Destination, path: Vec2[], pad: number): string[] => {
  const points = [from.at, ...path];
  // Bounds of the whole walk: most furniture is nowhere near it and can be skipped outright.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const crossed: string[] = [];
  for (const obstacle of getLayoutObstacles(layout)) {
    if (obstacle.maxX + pad < minX || obstacle.minX - pad > maxX || obstacle.maxZ + pad < minZ || obstacle.minZ - pad > maxZ) continue;
    if (belongsTo(obstacle, from) || belongsTo(obstacle, to)) continue;
    for (let i = 0; i + 1 < points.length; i += 1) {
      if (segmentHitsFootprint(obstacle, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z, pad)) {
        crossed.push(describeObstacle(obstacle));
        break;
      }
    }
  }
  return crossed;
};

describe.each(OFFICES)("the floor plan of office %i", (office) => {
  const layout = getOfficeLayout(office);
  const spec = SPEC[office];
  const obstacles = getLayoutObstacles(layout);
  const seats = allSeats(layout);

  it("has the office's desks and its places to wait", () => {
    expect(layout.office).toBe(office);
    expect(layout.deskSeats).toHaveLength(spec.desks);
    expect(layout.waitingSpots).toHaveLength(spec.waiting);
  });

  it("has a floor of about the specified size, centred on the origin", () => {
    const { minX, maxX, minZ, maxZ } = layout.floor;
    expect(Math.abs(maxX - minX - spec.width)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(maxZ - minZ - spec.depth)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(minX + maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(minZ + maxZ)).toBeLessThanOrEqual(1);
  });

  it("provides every station with a stand spot in front of it, facing it", () => {
    for (const kind of STATION_KINDS) {
      const station = layout.stations[kind];
      const stand = layout.stationStandSpots[kind];
      const size = STATION_SIZES[office][kind];
      const forward = forwardOf(station.facing);
      // Distance in front of the station's front edge, and sideways drift from its centre line.
      const ahead = (stand.x - station.x) * forward.x + (stand.z - station.z) * forward.z - size.depth / 2;
      const sideways = Math.abs((stand.x - station.x) * forward.z - (stand.z - station.z) * forward.x);
      expect(ahead, `${kind} stand distance`).toBeCloseTo(STAND_DISTANCE, 5);
      expect(sideways, `${kind} stand offset`).toBeLessThan(size.width / 2);
      expect(normalizeFacing(stand.facing - station.facing), `${kind} stand facing`).toBeCloseTo(Math.PI, 5);
    }
  });

  it("keeps every seat, spot, station, stand spot, wander spot and the door inside the floor", () => {
    for (const obstacle of obstacles) {
      expect(isFootprintInsideFloor(layout, obstacle), `${obstacle.kind} at ${obstacle.x},${obstacle.z}`).toBe(true);
    }
    for (const destination of allDestinations(layout)) {
      // People are about half a unit wide: nobody stands with a shoulder over the edge.
      expect(isInsideFloor(layout, destination.at, 0.25), destination.label).toBe(true);
    }
  });

  it("puts wall-mounted stations on the back walls and every station's front toward the camera", () => {
    for (const kind of STATION_KINDS) {
      const facing = layout.stations[kind].facing;
      const forward = forwardOf(facing);
      // The camera sits on the +X/+Z diagonal: a front is visible when it faces +X or +Z.
      expect(forward.x + forward.z, `${kind} faces the camera`).toBeGreaterThan(0.5);
    }
    for (const kind of ["ship", "calendar", "pricing", "servers", "coffee"] as StationKind[]) {
      const footprint = stationFootprint(layout, kind);
      const againstBackWall = Math.abs(footprint.minZ - layout.floor.minZ) < 0.11;
      const againstSideWall = Math.abs(footprint.minX - layout.floor.minX) < 0.11;
      expect(againstBackWall || againstSideWall, `${kind} hugs a wall`).toBe(true);
    }
  });

  it("has no overlapping desk footprints", () => {
    const desks = seats.map((seat) => ({ seat, footprint: deskFootprint(seat.at) }));
    for (let i = 0; i < desks.length; i += 1) {
      for (let j = i + 1; j < desks.length; j += 1) {
        expect(
          footprintGap(desks[i].footprint, desks[j].footprint),
          `${desks[i].seat.label} vs ${desks[j].seat.label}`
        ).toBeGreaterThanOrEqual(0.05);
      }
    }
  });

  it("has no desk overlapping a station footprint", () => {
    for (const seat of seats) {
      for (const kind of STATION_KINDS) {
        expect(
          footprintGap(deskFootprint(seat.at), stationFootprint(layout, kind)),
          `${seat.label} vs ${kind}`
        ).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it("has no two pieces of furniture overlapping at all", () => {
    for (let i = 0; i < obstacles.length; i += 1) {
      for (let j = i + 1; j < obstacles.length; j += 1) {
        const a = obstacles[i];
        const b = obstacles[j];
        const sameSeat =
          (a.kind === "desk" || a.kind === "chair") &&
          (b.kind === "desk" || b.kind === "chair") &&
          a.slotIndex === b.slotIndex;
        // A chair is tucked a hair under its own desk; everything else keeps apart.
        if (sameSeat) continue;
        expect(footprintsOverlap(a, b), `${a.kind}@${a.x},${a.z} vs ${b.kind}@${b.x},${b.z}`).toBe(false);
      }
    }
  });

  it("keeps any two seats at least 1.0 apart", () => {
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const distance = Math.hypot(seats[i].at.x - seats[j].at.x, seats[i].at.z - seats[j].at.z);
        expect(distance, `${seats[i].label} vs ${seats[j].label}`).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it("leaves at least 0.9 clear behind every seat", () => {
    for (const seat of seats) {
      const forward = forwardOf(seat.at.facing);
      // The strip of floor from the seat to 0.9 behind it, as wide as the chair.
      const behind = makeFootprint(
        { x: seat.at.x - forward.x * 0.45, z: seat.at.z - forward.z * 0.45 },
        { width: CHAIR_SIZE.width, depth: 0.9 },
        seat.at.facing
      );
      expect(isFootprintInsideFloor(layout, behind), `${seat.label}: wall behind`).toBe(true);
      for (const obstacle of obstacles) {
        if (isOwnSeatFurniture(obstacle, seat)) continue;
        expect(
          footprintsOverlap(behind, obstacle),
          `${seat.label}: ${obstacle.kind}@${obstacle.x},${obstacle.z} behind the chair`
        ).toBe(false);
      }
    }
  });

  it("spaces the waiting spots so people standing there do not touch", () => {
    const spots = layout.waitingSpots;
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z), `waiting ${i} vs ${j}`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  it("keeps the floor where people wait clear of furniture, and somewhere a person can stand", () => {
    layout.waitingSpots.forEach((spot, i) => {
      const standing = waitingFootprint(spot);
      expect(isFootprintInsideFloor(layout, standing), `waiting ${i}`).toBe(true);
      for (const obstacle of obstacles) expect(footprintsOverlap(standing, obstacle), `waiting ${i} vs ${describeObstacle(obstacle)}`).toBe(false);
      expect(isWalkable(layout, spot), `waiting ${i}`).toBe(true);
    });
  });

  it("lists the waiting spots nearest the door first, with room for everyone drawn waiting when the office is big enough", () => {
    const distances = layout.waitingSpots.map((spot) => Math.hypot(spot.x - layout.door.x, spot.z - layout.door.z));
    for (let i = 1; i < distances.length; i += 1) expect(distances[i], `waiting ${i}`).toBeGreaterThanOrEqual(distances[i - 1]);
    if (office > 0) expect(layout.waitingSpots.length).toBeGreaterThanOrEqual(MAX_WAITING_DRAWN);
  });

  it("has 3–8 wander spots on walkable floor", () => {
    expect(layout.wanderSpots.length).toBeGreaterThanOrEqual(3);
    expect(layout.wanderSpots.length).toBeLessThanOrEqual(8);
    for (const spot of layout.wanderSpots) {
      expect(isWalkable(layout, spot), `wander ${spot.x},${spot.z}`).toBe(true);
    }
  });

  it("puts the door on an open edge, just inside, facing in", () => {
    const { door, floor } = layout;
    const onPlusX = floor.maxX - door.x <= 0.6;
    const onPlusZ = floor.maxZ - door.z <= 0.6;
    expect(onPlusX || onPlusZ).toBe(true);
    const forward = forwardOf(door.facing);
    expect(isInsideFloor(layout, { x: door.x + forward.x, z: door.z + forward.z })).toBe(true);
    expect(isInsideFloor(layout, { x: door.x - forward.x, z: door.z - forward.z })).toBe(false);
    expect(isWalkable(layout, door)).toBe(true);
  });

  it("lets people walk in from, and out to, a point outside the door", () => {
    const outside = doorExterior(layout);
    expect(isInsideFloor(layout, outside)).toBe(false);
    expect(Math.hypot(outside.x - layout.door.x, outside.z - layout.door.z)).toBeCloseTo(1.5, 9);
    expect(doorExterior(layout, 3).x - layout.door.x).toBeCloseTo((outside.x - layout.door.x) * 2, 9);

    // Arriving: the first thing a newcomer does is step through the doorway.
    const target = layout.deskSeats[layout.deskSeats.length - 1];
    const arriving = findPath(layout, outside, target);
    expect(Math.hypot(arriving[0].x - layout.door.x, arriving[0].z - layout.door.z)).toBeLessThan(0.7);
    const visitor: Destination = { kind: "floor", at: { ...outside, facing: 0 }, label: "outside" };
    const seat = allSeats(layout)[allSeats(layout).length - 1];
    expect(obstaclesCrossed(layout, visitor, seat, arriving, 0.05)).toEqual([]);

    // Leaving: the last waypoint before the pavement is the doorway.
    const leaving = findPath(layout, target, outside);
    expect(leaving[leaving.length - 1]).toEqual(outside);
    const threshold = leaving[leaving.length - 2];
    expect(Math.hypot(threshold.x - layout.door.x, threshold.z - layout.door.z)).toBeLessThan(0.7);
    expect(obstaclesCrossed(layout, seat, visitor, leaving, 0.05)).toEqual([]);
  });

  it("stands people where they can actually stand", () => {
    for (const kind of STATION_KINDS) {
      expect(isWalkable(layout, layout.stationStandSpots[kind]), `${kind} stand spot`).toBe(true);
    }
  });

  it("frames the floor and the walls", () => {
    const everything = layout;
    const frame = getLayoutFrame(everything);
    const sinAz = Math.sin(ISO_AZIMUTH);
    const cosAz = Math.cos(ISO_AZIMUTH);
    const sinEl = Math.sin(ISO_ELEVATION);
    const cosEl = Math.cos(ISO_ELEVATION);
    const project = (x: number, y: number, z: number): { u: number; v: number } => ({
      u: x * cosAz - z * sinAz,
      v: -(x * sinAz + z * cosAz) * sinEl + y * cosEl,
    });
    const centre = project(everything.camera.target.x, 0, everything.camera.target.z);

    const points: Array<{ u: number; v: number }> = [];
    const { minX, maxX, minZ, maxZ } = everything.floor;
    for (const [x, z] of [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]]) points.push(project(x, 0, z));
    points.push(project(minX, WALL_HEIGHT, minZ), project(minX, WALL_HEIGHT, maxZ), project(maxX, WALL_HEIGHT, minZ));

    // At the reference aspect, and on a phone-shaped and a banner-shaped viewport.
    for (const aspect of [FRAME_REFERENCE_ASPECT, 0.8, 3]) {
      const viewHeight = fitViewHeight(everything, aspect);
      for (const point of points) {
        expect(Math.abs(point.u - centre.u)).toBeLessThanOrEqual((viewHeight * aspect) / 2);
        expect(Math.abs(point.v - centre.v)).toBeLessThanOrEqual(viewHeight / 2);
      }
    }
    expect(everything.camera.viewHeight).toBeCloseTo(fitViewHeight(everything, FRAME_REFERENCE_ASPECT), 6);
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
  });

  it("fits the whole ground tile across the default shot, and the building with its doorstep down it", () => {
    const frame = getLayoutFrame(layout);
    const sinAz = Math.sin(ISO_AZIMUTH);
    const cosAz = Math.cos(ISO_AZIMUTH);
    const sinEl = Math.sin(ISO_ELEVATION);
    const cosEl = Math.cos(ISO_ELEVATION);
    const project = (x: number, y: number, z: number): { u: number; v: number } => ({
      u: x * cosAz - z * sinAz,
      v: -(x * sinAz + z * cosAz) * sinEl + y * cosEl,
    });
    const centre = project(frame.target.x, 0, frame.target.z);
    const ground = groundRect(layout);
    expect(ground.minX).toBeLessThan(layout.floor.minX);
    expect(ground.maxX).toBeGreaterThan(layout.floor.maxX);
    expect(ground.minZ).toBeLessThan(layout.floor.minZ);
    expect(ground.maxZ).toBeGreaterThan(layout.floor.maxZ);
    // Side to side nothing of the diorama is cut off (this is what a phone in portrait is limited by).
    const corners = [
      project(ground.minX, 0, ground.minZ),
      project(ground.minX, 0, ground.maxZ),
      project(ground.maxX, 0, ground.minZ),
      project(ground.maxX, 0, ground.maxZ),
    ];
    for (const point of corners) {
      expect(Math.abs(point.u - centre.u)).toBeLessThanOrEqual(frame.width / 2);
    }
    // Top to bottom the shot holds the building and the ground just outside its open
    // edges — where the door is and people arrive — but not the tile's far corner:
    // on a wide, short viewport that corner would cost the office its size.
    const doorstep = project(
      Math.min(ground.maxX, layout.floor.maxX + FRAME_APRON),
      0,
      Math.min(ground.maxZ, layout.floor.maxZ + FRAME_APRON)
    );
    const outside = doorExterior(layout, 0.8);
    for (const point of [doorstep, project(outside.x, 0, outside.z), project(outside.x, 1.6, outside.z)]) {
      expect(Math.abs(point.u - centre.u)).toBeLessThanOrEqual(frame.width / 2);
      expect(Math.abs(point.v - centre.v)).toBeLessThanOrEqual(frame.height / 2);
    }
    const tileCorner = project(ground.maxX, -GROUND_DEPTH, ground.maxZ);
    expect(Math.abs(tileCorner.v - centre.v)).toBeGreaterThan(frame.height / 2);
  });

  it("stands its set dressing on the floor", () => {
    const decor = getLayoutDecor(layout);
    expect(decor.length).toBeGreaterThan(0);
    expect(getLayoutDecor(getOfficeLayout(office))).toBe(decor);
    for (const spot of decor) {
      expect(isFootprintInsideFloor(layout, decorFootprint(spot)), `${spot.kind} @ ${spot.x},${spot.z}`).toBe(true);
    }
    const blockers = obstacles.filter((obstacle) => obstacle.kind === "decor");
    expect(blockers.length).toBe(decor.length);
    // No stand spot, wander spot or the door has been furnished over.
    for (const spot of [...STATION_KINDS.map((kind) => layout.stationStandSpots[kind]), ...layout.wanderSpots, layout.door]) {
      expect(isWalkable(layout, spot), `spot ${spot.x},${spot.z}`).toBe(true);
    }
  });

  it("does not waste the shot: the default view is at most a third bigger than its content", () => {
    const frame = getLayoutFrame(layout);
    expect(layout.camera.viewHeight).toBeLessThanOrEqual(frame.height * 1.34);
    expect(layout.camera.viewHeight).toBeGreaterThanOrEqual(frame.height);
  });

  it("finds a clean walk from the door to every seat, waiting spot, stand spot and wander spot", () => {
    const door: Destination = { kind: "floor", at: layout.door, label: "door" };
    for (const destination of allDestinations(layout)) {
      const path = findPath(layout, layout.door, destination.at);
      expect(path.length, destination.label).toBeGreaterThanOrEqual(1);
      const last = path[path.length - 1];
      expect(last.x, destination.label).toBe(destination.at.x);
      expect(last.z, destination.label).toBe(destination.at.z);
      for (const point of path) expect(isInsideFloor(layout, point), `${destination.label} waypoint`).toBe(true);
      // Never within 5 cm of furniture that is not the walker's own.
      expect(obstaclesCrossed(layout, door, destination, path, 0.05), `door → ${destination.label}`).toEqual([]);
    }
  });

  it("finds a clean walk between the places people go, whichever way they are heading", () => {
    const destinations = allDestinations(layout);
    // Every ordered pair in the three smaller offices. In the two largest that is
    // ~6,000 walks, so every second place is used as an origin (to every destination).
    const stride = Math.ceil(destinations.length / 48);
    const dirty: string[] = [];
    for (let origin = 0; origin < destinations.length; origin += stride) {
      const from = destinations[origin];
      for (const to of destinations) {
        if (from === to) continue;
        const path = findPath(layout, from.at, to.at);
        const last = path[path.length - 1];
        const crossed = obstaclesCrossed(layout, from, to, path, 0.05);
        if (last.x !== to.at.x || last.z !== to.at.z || crossed.length > 0) {
          dirty.push(`${from.label} → ${to.label}: ${crossed.join(", ") || "wrong end point"}`);
        }
      }
    }
    expect(dirty).toEqual([]);
  });

  it("walks people into their chair from behind or beside it, never across the desk", () => {
    for (const seat of seats) {
      const path = findPath(layout, layout.door, seat.at);
      expect(path.length, seat.label).toBeGreaterThanOrEqual(2);
      const approach = path[path.length - 2];
      const forward = forwardOf(seat.at.facing);
      // The spot they step from is not on the desk side of the chair…
      const ahead = (approach.x - seat.at.x) * forward.x + (approach.z - seat.at.z) * forward.z;
      expect(ahead, `${seat.label}: steps in from ${ahead.toFixed(2)} ahead of the seat`).toBeLessThan(DESK_OFFSET - DESK_SIZE.depth / 2);
      // …it is close by, and the step itself stays clear of the desk.
      expect(Math.hypot(approach.x - seat.at.x, approach.z - seat.at.z), seat.label).toBeLessThan(1.6);
      expect(
        segmentHitsFootprint(deskFootprint(seat.at), approach.x, approach.z, seat.at.x, seat.at.z, 0.05),
        seat.label
      ).toBe(false);
    }
  });
});

describe("getOfficeLayout", () => {
  it("each office has as many desks as it holds, and the campus as many as are drawn", () => {
    expect([0, 1, 2, 3, 4].map((office) => getOfficeLayout(office as OfficeIndex).deskSeats.length)).toEqual([4, 9, 22, 40, 50]);
    expect(DESKS).toEqual([4, 9, 22, 40, 50]);
    expect(DESKS[4]).toBe(MAX_STAFF_DRAWN);
    expect(Object.isFrozen(DESKS)).toBe(true);
  });

  it("at least four people can stand at the door in every office", () => {
    for (const office of OFFICES) expect(getOfficeLayout(office).waitingSpots.length, OFFICE_NAMES[office]).toBeGreaterThanOrEqual(4);
  });

  it("every desk, waiting spot and wander spot can be walked to from the door", () => {
    for (const office of OFFICES) {
      const layout = getOfficeLayout(office);
      const outside = doorExterior(layout);
      for (const spot of [...layout.deskSeats, ...layout.waitingSpots, ...layout.wanderSpots]) {
        const label = `${OFFICE_NAMES[office]} ${spot.x},${spot.z}`;
        // A route that exists is more than one step, or a straight line nothing stands in.
        const path = findPath(layout, outside, spot);
        expect(path[path.length - 1], label).toEqual({ x: spot.x, z: spot.z });
        const points = [layout.door, ...findPath(layout, layout.door, spot)];
        for (const obstacle of getLayoutObstacles(layout)) {
          const own = (obstacle.kind === "chair" || obstacle.kind === "desk") && layout.deskSeats[obstacle.slotIndex] === spot;
          if (own && obstacle.kind === "chair") continue;
          for (let i = 0; i + 1 < points.length; i += 1) {
            expect(segmentHitsFootprint(obstacle, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z), label).toBe(false);
          }
        }
      }
    }
  });

  it("an index out of range gives the garage", () => {
    expect(getOfficeLayout(9 as OfficeIndex)).toBe(getOfficeLayout(0));
    for (const odd of [-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", "toString", "__proto__", undefined, null]) {
      expect(() => getOfficeLayout(odd as OfficeIndex), String(odd)).not.toThrow();
      expect(getOfficeLayout(odd as OfficeIndex), String(odd)).toBe(getOfficeLayout(0));
    }
    expect(getOfficeLayout(0).office).toBe(0);
  });

  it("no plan knows a founder or an asset", () => {
    const keysOf = (value: unknown, found: Set<string>): Set<string> => {
      if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          found.add(key);
          keysOf(child, found);
        }
      }
      return found;
    };
    for (const office of OFFICES) {
      const keys = keysOf(getOfficeLayout(office), new Set());
      for (const gone of ["founderSeat", "cofounderSeat", "assetAnchors", "overflowSpots", "phase"]) expect(keys.has(gone), `${OFFICE_NAMES[office]} ${gone}`).toBe(false);
      expect([...keys].filter((key) => /founder|asset/i.test(key)), OFFICE_NAMES[office]).toEqual([]);
    }
  });

  it("keeps the desks in fill order, bench by bench: neighbours in the list sit at the same bench", () => {
    // Along a bench, the next desk is the one across (1.85 away) or the first of the next pair (1.4 along and 1.85
    // across: 2.32). Only a handful of steps in each plan are longer: to the next bench, to the corner, and
    // between the two corner desks.
    const jumps = OFFICES.map((office) => {
      const seats = getOfficeLayout(office).deskSeats;
      return seats.slice(1).filter((seat, i) => Math.hypot(seat.x - seats[i].x, seat.z - seats[i].z) > 2.35).length;
    });
    expect(jumps).toEqual([1, 1, 5, 4, 7]);
  });

  it("knows of no set dressing for a layout it did not make", () => {
    const copy = { ...getOfficeLayout(2) };
    expect(getLayoutDecor(copy)).toEqual([]);
    expect(getLayoutObstacles(copy).some((obstacle) => obstacle.kind === "decor")).toBe(false);
  });

  it("is memoised per office", () => {
    for (const office of OFFICES) expect(getOfficeLayout(office)).toBe(getOfficeLayout(office));
    expect(new Set(OFFICES.map((office) => getOfficeLayout(office))).size).toBe(5);
    expect(OFFICES.map((office) => getOfficeLayout(office).office)).toEqual([0, 1, 2, 3, 4]);
  });

  it("can frame just the building, for viewports too narrow to show the ground around it as well", () => {
    const layout = getOfficeLayout(3);
    const everything = getLayoutFrame(layout);
    const building = computeLayoutFrame(layout);
    expect(building.width).toBeLessThan(everything.width);
    expect(building.height).toBeLessThanOrEqual(everything.height);
    expect(viewHeightForFrame(building, 1)).toBeLessThan(viewHeightForFrame(everything, 1));
    expect(viewHeightForFrame(everything, FRAME_REFERENCE_ASPECT)).toBe(layout.camera.viewHeight);
    // A nonsensical aspect ratio falls back to the reference one instead of dividing by zero.
    expect(viewHeightForFrame(everything, 0)).toBe(layout.camera.viewHeight);
    expect(viewHeightForFrame(everything, Number.NaN)).toBe(layout.camera.viewHeight);
    // Layouts that did not come from getOfficeLayout are framed by their building.
    const copy: OfficeLayout = structuredClone(layout);
    expect(getLayoutFrame(copy)).toEqual(building);
  });

  it("grows the default shot with the company", () => {
    const heights = OFFICES.map((office) => getOfficeLayout(office).camera.viewHeight);
    for (let i = 1; i < heights.length; i += 1) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  });

  it("hands out frozen plans, so a consumer cannot shift furniture for everyone else", () => {
    const layout = getOfficeLayout(2);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.deskSeats)).toBe(true);
    expect(Object.isFrozen(layout.deskSeats[0])).toBe(true);
    expect(Object.isFrozen(layout.waitingSpots)).toBe(true);
    expect(Object.isFrozen(layout.stations.ship)).toBe(true);
    expect(Object.isFrozen(layout.camera.target)).toBe(true);
    expect(Object.isFrozen(getLayoutDecor(layout))).toBe(true);
    expect(() => {
      (layout.door as { x: number }).x = 99;
    }).toThrow();
  });

  it("varies which way people face", () => {
    for (const office of OFFICES) {
      const layout = getOfficeLayout(office);
      const facings = new Set(layout.deskSeats.map((seat) => Math.round(normalizeFacing(seat.facing) * 100)));
      expect(facings.size, OFFICE_NAMES[office]).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("footprints", () => {
  it("puts a desk DESK_OFFSET in front of its seat", () => {
    expect(DESK_OFFSET).toBe(0.55);
    expect(deskCenter({ x: 1, z: 2, facing: 0 })).toEqual({ x: 1, z: 2 + DESK_OFFSET });
    const facingRight = deskCenter({ x: 1, z: 2, facing: Math.PI / 2 });
    expect(facingRight.x).toBeCloseTo(1 + DESK_OFFSET, 9);
    expect(facingRight.z).toBeCloseTo(2, 9);
  });

  it("orients a footprint's width across its facing and its depth along it", () => {
    const facingZ = deskFootprint({ x: 0, z: 0, facing: 0 });
    expect(facingZ.maxX - facingZ.minX).toBeCloseTo(DESK_SIZE.width, 9);
    expect(facingZ.maxZ - facingZ.minZ).toBeCloseTo(DESK_SIZE.depth, 9);
    const facingX = deskFootprint({ x: 0, z: 0, facing: Math.PI / 2 });
    expect(facingX.maxX - facingX.minX).toBeCloseTo(DESK_SIZE.depth, 9);
    expect(facingX.maxZ - facingX.minZ).toBeCloseTo(DESK_SIZE.width, 9);
  });

  it("tests points and segments against rotated rectangles", () => {
    const tilted = makeFootprint({ x: 0, z: 0 }, { width: 2, depth: 0.5 }, Math.PI / 4);
    // The long axis of this rectangle runs along (1, −1)/√2.
    expect(footprintContains(tilted, 0.6, -0.6)).toBe(true);
    expect(footprintContains(tilted, 0.6, 0.6)).toBe(false);
    expect(footprintContains(tilted, 0.6, 0.6, 0.7)).toBe(true);
    expect(segmentHitsFootprint(tilted, -1, -1, 1, 1)).toBe(true);
    expect(segmentHitsFootprint(tilted, 0.5, 0.5, 2, 2)).toBe(false);
    expect(segmentHitsFootprint(tilted, 0.5, 0.5, 2, 2, 0.5)).toBe(true);
    // Parallel to the long side, just outside it.
    expect(segmentHitsFootprint(tilted, 0.3, 0.3, 1.3, -0.7)).toBe(false);
  });

  it("measures the gap between rectangles", () => {
    const a = makeFootprint({ x: 0, z: 0 }, { width: 2, depth: 1 }, 0);
    const beside = makeFootprint({ x: 3, z: 0 }, { width: 2, depth: 1 }, 0);
    const touching = makeFootprint({ x: 2, z: 0 }, { width: 2, depth: 1 }, 0);
    const inside = makeFootprint({ x: 0.5, z: 0 }, { width: 1, depth: 0.5 }, 0.3);
    expect(footprintGap(a, beside)).toBeCloseTo(1, 9);
    expect(footprintsOverlap(a, beside)).toBe(false);
    expect(footprintsOverlap(a, touching)).toBe(false);
    expect(footprintsOverlap(a, inside)).toBe(true);
    expect(footprintGap(a, inside)).toBeLessThan(0);
  });

  it("lists a desk and a chair for every seat, every station and every piece of set dressing, and nothing else", () => {
    for (const office of OFFICES) {
      const layout = getOfficeLayout(office);
      const obstacles = getLayoutObstacles(layout);
      const count = (kind: Obstacle["kind"]): number => obstacles.filter((o) => o.kind === kind).length;
      expect(count("desk")).toBe(layout.deskSeats.length);
      expect(count("chair")).toBe(layout.deskSeats.length);
      expect(count("station")).toBe(8);
      expect(count("decor")).toBe(getLayoutDecor(layout).length);
      expect(obstacles).toHaveLength(2 * layout.deskSeats.length + 8 + getLayoutDecor(layout).length);
      expect(getLayoutObstacles(layout)).toBe(obstacles);
      expect(chairFootprint(layout.deskSeats[0]).x).toBe(layout.deskSeats[0].x);
    }
  });

  it("knows every station kind", () => {
    // Adding a StationKind without listing it here is a compile error.
    const everyStation: Record<StationKind, true> = {
      ship: true,
      launch: true,
      investors: true,
      boardroom: true,
      calendar: true,
      coffee: true,
      servers: true,
      pricing: true,
    };
    expect([...STATION_KINDS].sort()).toEqual(Object.keys(everyStation).sort());
  });

  it("exposes the sizes props have to fit", () => {
    expect(DESK_SIZE).toEqual({ width: 1.3, depth: 0.65 });
    expect(STATION_SIZES).toHaveLength(5);
    for (const office of OFFICES) {
      for (const kind of STATION_KINDS) {
        expect(STATION_SIZES[office][kind].width).toBeGreaterThan(0);
        expect(STATION_SIZES[office][kind].depth).toBeGreaterThan(0);
      }
    }
  });
});

describe("findPath", () => {
  const office = getOfficeLayout(2);

  it("returns just the destination when nothing is in the way", () => {
    const from = office.door;
    const forward = forwardOf(from.facing);
    const to = { x: from.x + forward.x * 0.8, z: from.z + forward.z * 0.8 };
    expect(findPath(office, from, to)).toEqual([to]);
  });

  it("returns just the destination when already there", () => {
    expect(findPath(office, office.door, office.door)).toEqual([{ x: office.door.x, z: office.door.z }]);
    const seat = office.deskSeats[4];
    expect(findPath(office, seat, seat)).toEqual([{ x: seat.x, z: seat.z }]);
  });

  it("returns fresh points the caller may keep or mutate", () => {
    const to = { x: office.door.x - 1, z: office.door.z - 1 };
    const first = findPath(office, office.door, to);
    const second = findPath(office, office.door, to);
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(to);
    expect(first[0]).not.toBe(second[0]);
  });

  it("walks around a bench instead of across it", () => {
    // Opposite sides of the same pod.
    const from = office.deskSeats[0];
    const to = office.deskSeats[1];
    const path = findPath(office, from, to);
    expect(path.length).toBeGreaterThan(2);
    expect(pathLength(from, path)).toBeGreaterThan(Math.hypot(to.x - from.x, to.z - from.z) * 1.5);
  });

  it("gets shorter, never longer, than the grid route it straightens", () => {
    const to = office.stationStandSpots.servers;
    const path = findPath(office, office.door, to);
    const straight = Math.hypot(to.x - office.door.x, to.z - office.door.z);
    // Straightened routes stay within a modest detour of the crow-flies distance on an open-plan floor.
    expect(pathLength(office.door, path)).toBeLessThan(straight * 1.6);
    expect(pathLength(office.door, path)).toBeGreaterThanOrEqual(straight - 1e-9);
  });

  it("starts from and arrives at points outside the building", () => {
    const outside = { x: office.floor.maxX + 3, z: office.floor.maxZ + 3 };
    const inward = findPath(office, outside, office.stationStandSpots.coffee);
    expect(inward[inward.length - 1]).toEqual({ x: office.stationStandSpots.coffee.x, z: office.stationStandSpots.coffee.z });
    const outward = findPath(office, office.deskSeats[7], outside);
    expect(outward[outward.length - 1]).toEqual(outside);
    for (const point of outward.slice(0, -1)) expect(isInsideFloor(office, point)).toBe(true);
  });

  it("falls back to the destination for unusable input instead of throwing", () => {
    const nowhere = { x: Number.NaN, z: 0 };
    expect(findPath(office, nowhere, office.door)).toEqual([{ x: office.door.x, z: office.door.z }]);
    expect(findPath(office, office.door, { x: Infinity, z: 2 })).toEqual([{ x: Infinity, z: 2 }]);
  });

  it("falls back to the destination when no route exists", () => {
    // A room cut in two by one wall-to-wall station.
    const base = getOfficeLayout(0);
    const far = { x: 100, z: 100, facing: 0 };
    const sealed: OfficeLayout = {
      ...base,
      office: 4,
      floor: { minX: -4, maxX: 4, minZ: -2, maxZ: 2 },
      deskSeats: [
        { x: -3, z: -1, facing: 0 },
        { x: -3, z: 1.2, facing: Math.PI },
      ],
      waitingSpots: [],
      stations: {
        // The campus's product wall is 4.8 long: longer than this room is deep.
        ship: { x: 0, z: 0, facing: Math.PI / 2 },
        boardroom: far,
        launch: far,
        investors: far,
        calendar: far,
        coffee: far,
        servers: far,
        pricing: far,
      },
    };
    const from = { x: 3, z: 0 };
    const to = { x: -1.5, z: 0 };
    expect(isWalkable(sealed, from)).toBe(true);
    expect(isWalkable(sealed, to)).toBe(true);
    expect(findPath(sealed, from, to)).toEqual([to]);
    // …while the same room with the wall slid aside is routed through the gap.
    const gapped: OfficeLayout = {
      ...sealed,
      stations: { ...sealed.stations, ship: { x: 0, z: -1.4, facing: Math.PI / 2 } },
    };
    const detour = findPath(gapped, from, to);
    expect(detour.length).toBeGreaterThan(1);
    expect(detour[detour.length - 1]).toEqual(to);
  });

  it("falls back to the destination on a floor with nowhere to stand", () => {
    const base = getOfficeLayout(0);
    const far = { x: 100, z: 100, facing: 0 };
    // A closet entirely filled by one boardroom table.
    const closet: OfficeLayout = {
      ...base,
      office: 4,
      floor: { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 },
      deskSeats: [],
      waitingSpots: [],
      stations: { ship: far, boardroom: { x: 0, z: 0, facing: 0 }, launch: far, investors: far, calendar: far, coffee: far, servers: far, pricing: far },
    };
    const to = { x: 0.5, z: 0.2 };
    expect(isWalkable(closet, to)).toBe(false);
    expect(findPath(closet, { x: -0.5, z: 0 }, to)).toEqual([to]);
    expect(findPath(closet, { x: -5, z: 3 }, to)).toEqual([to]);

    // …and on a floor too small to hold a single grid cell's worth of thought.
    const speck: OfficeLayout = { ...closet, floor: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };
    expect(findPath(speck, { x: -1, z: -1 }, { x: 2, z: 2 })).toEqual([{ x: 2, z: 2 }]);
  });

  it("steps out of a pocket of free floor that the grid cannot leave", () => {
    // A ring of big plants around one free cell, with a 0.6-wide neck toward +Z:
    // too narrow for the grid to route through, wide enough to step through.
    const base = getOfficeLayout(0);
    const far = { x: 100, z: 100, facing: 0 };
    const plant = (x: number, z: number): DecorSpot => ({ kind: "plant-large", x, z, facing: 0, variant: 0 });
    const ring: DecorSpot[] = [
      plant(-0.65, 0.2),
      plant(1.05, 0.2),
      plant(0.2, -0.65),
      plant(-0.65, -0.65),
      plant(1.05, -0.65),
      plant(-0.4, 1.05),
      plant(1.0, 1.05),
    ];
    const room = (decor: DecorSpot[]): OfficeLayout => {
      const layout: OfficeLayout = {
        ...base,
        floor: { minX: -4, maxX: 4, minZ: -2, maxZ: 2 },
        deskSeats: [
          { x: -3.4, z: -1.3, facing: 0 },
          { x: -3.4, z: 0.9, facing: 0 },
        ],
        waitingSpots: [],
        stations: { ship: far, boardroom: far, launch: far, investors: far, calendar: far, coffee: far, servers: far, pricing: far },
      };
      registerLayoutDecor(layout, decor);
      return layout;
    };
    const ringed = room(ring);
    const pocket = { x: 0.2, z: 0.2 };
    const outside = { x: 3, z: 1.8 };
    expect(isWalkable(ringed, pocket)).toBe(true);
    const plants = getLayoutObstacles(ringed).filter((obstacle) => obstacle.kind === "decor");
    expect(plants).toHaveLength(ring.length);

    for (const [from, to] of [[outside, pocket], [pocket, outside]]) {
      const path = findPath(ringed, from, to);
      expect(path.length).toBeGreaterThan(1);
      expect(path[path.length - 1]).toEqual(to);
      const points = [from, ...path];
      for (const pot of plants) {
        for (let i = 0; i + 1 < points.length; i += 1) {
          expect(segmentHitsFootprint(pot, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z, 0.05)).toBe(false);
        }
      }
    }
    // The way in and out is through the neck.
    const inward = findPath(ringed, outside, pocket);
    expect(inward[inward.length - 2].x).toBeCloseTo(0.2, 6);
    expect(inward[inward.length - 2].z).toBeGreaterThan(1.4);

    // Close the neck and there is no clean way in: straight to the destination.
    const closed = room([...ring, plant(0.3, 1.05)]);
    expect(findPath(closed, outside, pocket)).toEqual([pocket]);
  });

  it("handles rotated furniture", () => {
    const base = getOfficeLayout(0);
    const far = { x: 100, z: 100, facing: 0 };
    const skewed: OfficeLayout = {
      ...base,
      deskSeats: [
        { x: 0, z: -0.4, facing: 0.5 },
        { x: -3, z: -2.5, facing: 0 },
        { x: 3, z: -2.5, facing: 0 },
      ],
      waitingSpots: [],
      stations: { ship: far, boardroom: far, launch: far, investors: far, calendar: far, coffee: far, servers: far, pricing: far },
    };
    const desk = deskFootprint(skewed.deskSeats[0]);
    const forward = forwardOf(0.5);
    const from = { x: desk.x + forward.x * 1.4, z: desk.z + forward.z * 1.4 };
    const to = skewed.deskSeats[0];
    const path = findPath(skewed, from, to);
    const points = [from, ...path];
    for (let i = 0; i + 2 < points.length; i += 1) {
      expect(segmentHitsFootprint(desk, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z, 0.05)).toBe(false);
    }
    expect(path[path.length - 1]).toEqual({ x: to.x, z: to.z });
    expect(path.length).toBeGreaterThan(1);
  });

  it("copes with arbitrary points, inside furniture or out in the car park", () => {
    // Deterministic pseudo-random points over an area larger than the floor.
    let state = 0x2f6e2b1;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (const phase of OFFICES) {
      const layout = getOfficeLayout(phase);
      const { minX, maxX, minZ, maxZ } = layout.floor;
      const point = (): Vec2 => ({
        x: minX - 3 + random() * (maxX - minX + 6),
        z: minZ - 3 + random() * (maxZ - minZ + 6),
      });
      for (let i = 0; i < 150; i += 1) {
        const from = point();
        const to = point();
        const path = findPath(layout, from, to);
        expect(path.length).toBeGreaterThanOrEqual(1);
        expect(path[path.length - 1]).toEqual(to);
        // Everything between the two ends is a spot a person can actually stand on.
        for (const waypoint of path.slice(0, -1)) {
          expect(isWalkable(layout, waypoint), `${phase}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`).toBe(true);
        }
        // Consecutive waypoints are distinct, so a walker always has a heading.
        const points = [from, ...path];
        for (let k = 0; k + 1 < points.length; k += 1) {
          if (path.length === 1 && k === 0) continue; // from and to may coincide by chance
          expect(Math.hypot(points[k + 1].x - points[k].x, points[k + 1].z - points[k].z)).toBeGreaterThan(1e-4);
        }
      }
    }
  });

  it("reports walkability consistently with its grid", () => {
    expect(isWalkable(office, office.door)).toBe(true);
    expect(isWalkable(office, deskCenter(office.deskSeats[0]))).toBe(false);
    expect(isWalkable(office, office.deskSeats[0])).toBe(false);
    expect(isWalkable(office, { x: office.floor.maxX + 1, z: 0 })).toBe(false);
    expect(isWalkable(office, { x: Number.NaN, z: 0 })).toBe(false);
    expect(NAV_CELL_SIZE).toBeGreaterThanOrEqual(0.4);
    expect(NAV_CELL_SIZE).toBeLessThanOrEqual(0.5);
    expect(NAV_AGENT_RADIUS).toBeGreaterThan(0);
  });

  it("is fast enough to call for every walk", () => {
    const layout = getOfficeLayout(4);
    const destinations = allDestinations(layout);
    // Warm the grid and the JIT.
    for (const destination of destinations) findPath(layout, layout.door, destination.at);
    const rounds = 5;
    const started = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      for (const destination of destinations) findPath(layout, layout.door, destination.at);
    }
    const perPath = (performance.now() - started) / (rounds * destinations.length);
    expect(perPath).toBeLessThan(2);
  });
});
