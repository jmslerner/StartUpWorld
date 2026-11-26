/**
 * Floor plans: five hand-designed offices, by office index (0 the garage, 1 the shared office, 2 the company's own
 * office, 3 the full floor, 4 the campus).
 *
 * Pure data, and no three.js anywhere down this file's imports. Everything else about the office (which props
 * stand where, what they look like) is built from these plans by OfficeSystem, people walk them via `findPath`,
 * and the seating plan hands out their desks, team by team along `deskSeats`.
 *
 * How to read a plan (top-down, the way the comments below are drawn):
 *   • the −X wall is on the left, the −Z wall at the top; +X (right) and +Z
 *     (bottom) are the open sides that face the camera;
 *   • facing 0 looks toward +Z ("down the page"), π/2 toward +X ("right");
 *   • a seat is where the PERSON is; the desk is DESK_OFFSET in front of them.
 *
 * Rules every plan keeps (enforced by layouts.test.ts):
 *   • nothing overlaps: desks, chairs, stations, set dressing; and the spots where people wait are clear floor;
 *   • ≥ 0.9 clear behind every seat, ≥ 1.0 between any two seats;
 *   • every seat, waiting spot, station stand spot and hang-out spot is reachable from the door.
 *
 * Every figure in an office is one of the company's head count, so every seat is an ordinary desk. `deskSeats` is
 * in fill order, bench by bench; the two desks that stand apart in a corner come last (in the garage the table for
 * two comes first: it is the room's one real bench).
 */
import type { OfficeIndex, OfficeLayout, Placement, StationKind, Vec2 } from "../types";
import {
  DESK_OFFSET,
  DESK_SIZE,
  STAND_DISTANCE,
  DECOR_SIZES,
  STATION_SIZES,
  WALL_GAP,
  groundRect,
  normalizeFacing,
  registerLayoutDecor,
} from "./footprints";
import type { DecorKind, DecorSpot, FootprintSize } from "./footprints";
import { FRAME_REFERENCE_ASPECT, computeLayoutFrame, viewHeightForFrame } from "./framing";
import type { LayoutFrame } from "./framing";

export * from "./footprints";
export { NAV_AGENT_RADIUS, NAV_CELL_SIZE, findPath, isWalkable, pathLength } from "./pathfinding";
export { FRAME_APRON, FRAME_REFERENCE_ASPECT, ISO_AZIMUTH, ISO_ELEVATION, computeLayoutFrame, viewHeightForFrame } from "./framing";
export type { LayoutFrame } from "./framing";

type Floor = OfficeLayout["floor"];

/** A plan as it is drawn: the layout before its default shot is worked out, and its set dressing. */
interface FloorPlan extends Omit<OfficeLayout, "camera"> {
  /** Free-standing set dressing: plants, couches, shelves… (see DecorKind in footprints.ts). */
  decor: DecorSpot[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafting helpers
// ─────────────────────────────────────────────────────────────────────────────

const TO_POS_Z = 0;
const TO_POS_X = Math.PI / 2;
const TO_NEG_Z = Math.PI;
const TO_NEG_X = -Math.PI / 2;

// Plans are drawn to the nearest few centimetres; rounding keeps derived
// coordinates (wall offsets, bench rows) free of float dust like −3.3499999999999996.
const round = (value: number): number => Math.round(value * 1000) / 1000;

const at = (x: number, z: number, facing: number): Placement => ({ x: round(x), z: round(z), facing });

const centredFloor = (width: number, depth: number): Floor => ({
  minX: -width / 2,
  maxX: width / 2,
  minZ: -depth / 2,
  maxZ: depth / 2,
});

/** Something `size` big pushed against the −Z (back) wall, centred at `x`, facing into the room. */
const onBackWall = (floor: Floor, size: FootprintSize, x: number): Placement =>
  at(x, floor.minZ + WALL_GAP + size.depth / 2, TO_POS_Z);

/** Something `size` big pushed against the −X (side) wall, centred at `z`, facing into the room. */
const onSideWall = (floor: Floor, size: FootprintSize, z: number): Placement =>
  at(floor.minX + WALL_GAP + size.depth / 2, z, TO_POS_X);

/** Where to stand to use something: STAND_DISTANCE in front of its footprint, looking at it. */
const inFrontOf = (thing: Placement, size: FootprintSize, lateral = 0): Placement => {
  const reach = size.depth / 2 + STAND_DISTANCE;
  const sin = Math.sin(thing.facing);
  const cos = Math.cos(thing.facing);
  return at(
    thing.x + sin * reach + cos * lateral,
    thing.z + cos * reach - sin * lateral,
    normalizeFacing(thing.facing + Math.PI)
  );
};

/** A spot at (x, z) from which a person looks at `target`. */
const lookingAt = (x: number, z: number, target: { x: number; z: number }): Placement =>
  at(x, z, Math.atan2(target.x - x, target.z - z));

const standSpots = (office: OfficeIndex, stations: Record<StationKind, Placement>): Record<StationKind, Placement> => {
  const sizes = STATION_SIZES[office];
  return {
    ship: inFrontOf(stations.ship, sizes.ship),
    launch: inFrontOf(stations.launch, sizes.launch),
    investors: inFrontOf(stations.investors, sizes.investors),
    boardroom: inFrontOf(stations.boardroom, sizes.boardroom),
    calendar: inFrontOf(stations.calendar, sizes.calendar),
    coffee: inFrontOf(stations.coffee, sizes.coffee),
    servers: inFrontOf(stations.servers, sizes.servers),
    pricing: inFrontOf(stations.pricing, sizes.pricing),
  };
};

/** A piece of set dressing standing at `spot`, front toward the spot's facing. */
const decor = (kind: DecorKind, spot: Placement, variant = 0, width?: number): DecorSpot =>
  width === undefined ? { kind, ...spot, variant } : { kind, ...spot, variant, width };

/** A glass partition `length` long whose middle is at (x, z); `facing` is the side it shows its face to. */
const partition = (x: number, z: number, facing: number, length: number): DecorSpot =>
  decor("partition", at(x, z, facing), 0, length);

/** Centre-to-centre spacing of desks standing side by side. */
const DESK_PITCH = DESK_SIZE.width + 0.1;

/** Seat-to-seat distance across a bench: two desks deep, plus a gap for cables. */
const BENCH_DEPTH = 2 * (DESK_OFFSET + DESK_SIZE.depth / 2) + 0.1;

/**
 * A bench: two rows of desks pushed front to front, so colleagues face each other.
 *
 *   along "x": rows run along X. Row A (at `z`) faces +Z; row B sits across from it facing −Z.
 *   along "z": rows run along Z. Row A (at `x`) faces +X; row B sits across from it facing −X.
 *
 * (x, z) is the first seat of row A. Seats come back as A0, B0, A1, B1, … so a
 * bench fills up in facing pairs from its first end.
 */
const bench = (along: "x" | "z", x: number, z: number, pairs: number): Placement[] => {
  const seats: Placement[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const step = i * DESK_PITCH;
    if (along === "x") {
      seats.push(at(x + step, z, TO_POS_Z), at(x + step, z + BENCH_DEPTH, TO_NEG_Z));
    } else {
      seats.push(at(x, z + step, TO_POS_X), at(x + BENCH_DEPTH, z + step, TO_NEG_X));
    }
  }
  return seats;
};

/**
 * The spots where people leaving and people expected stand, nearest the door first: the first to arrive stands
 * closest to it. Spots the same distance away keep the order they were drawn in.
 */
const nearestFirst = (door: Placement, spots: Placement[]): Placement[] =>
  [...spots].sort((a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z));

// ─────────────────────────────────────────────────────────────────────────────
// 0, the garage — 8 × 7. Four desks, a whiteboard and whoever fits.
//
//      srv  [= whiteboard =]   cal    prices   coffee
//     ┌───────────────────────────────────────────────┐
//     │                                               │
//     │    ▶[  ][  ]◀             ▼                   │
//     │    partners' table       [  ]                 │
//     │                         [  ]                  │
//     │ ☎                        ▲                    │
//     │                                        door ◀ │
//     │         ▯ folding      ▯ megaphone            │
//     │  ·        table          ·         ·   ·      │     · where people wait
//     └───────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const garagePlan = (): FloorPlan => {
  const floor = centredFloor(8, 7);
  const size = STATION_SIZES[0];
  const door = at(3.6, 1.9, TO_NEG_X);

  const stations: Record<StationKind, Placement> = {
    servers: onBackWall(floor, size.servers, -3.5),
    ship: onBackWall(floor, size.ship, -1.8),
    calendar: onBackWall(floor, size.calendar, 0.1),
    pricing: onBackWall(floor, size.pricing, 1.55),
    coffee: onBackWall(floor, size.coffee, 3.3),
    investors: onSideWall(floor, size.investors, 0.95),
    boardroom: at(-1.3, 2.45, TO_POS_X),
    launch: at(1.35, 2.35, TO_POS_X),
  };

  return {
    office: 0,
    floor,
    deskSeats: [
      // The partners' table: two people eye to eye across it.
      at(-3.05, -0.9, TO_POS_X),
      at(-1.2, -0.9, TO_NEG_X),
      // Two more desks jammed in where they fit: a face-to-face pair that does not quite line up.
      at(1.25, -1.45, TO_POS_Z),
      at(1.1, 0.4, TO_NEG_Z),
    ],
    // Along the open side, by the door.
    waitingSpots: nearestFirst(door, [
      at(2.45, 3.0, TO_NEG_Z + 0.25),
      at(3.4, 3.0, TO_NEG_X - 0.2),
      at(0.35, 3.0, TO_NEG_Z - 0.2),
      at(-2.55, 3.0, TO_POS_X - 0.3),
    ]),
    door,
    stations,
    stationStandSpots: standSpots(0, stations),
    wanderSpots: [
      lookingAt(2.4, -2.3, stations.coffee),
      lookingAt(-0.5, -2.2, stations.ship),
      at(3.5, 0.95, TO_POS_X),
      at(0.0, 1.4, TO_POS_Z),
    ],
    // What was in the garage before the company was: boxes along the side wall, a cabinet nobody has opened.
    decor: [
      decor("filing-cabinet", onBackWall(floor, DECOR_SIZES["filing-cabinet"], 2.45)),
      decor("boxes", onSideWall(floor, DECOR_SIZES.boxes, 2.5), 2),
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 1, the shared office — 12 × 10. A rented corner of somebody else's open plan. Nine desks.
//
//          [=== product wall ===]  cal  prices   coffee   srv
//     ┌──────────────────────────────────────────────────────────┐
//     │  ▶[ ]                                                    │
//     │                   ▼    ▼    ▼    ▼                  ·     │
//     │                  [  ] [  ] [  ] [  ]   hot-desk      ·    │
//     │ ☎ booth          [  ] [  ] [  ] [  ]   island       ·     │
//     │                   ▲    ▲    ▲    ▲                   ·    │
//     │                                                     ·     │
//     │       ▭ meeting table         ▭ launch               ·    │
//     │                                               door ▲      │
//     └──────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const sharedPlan = (): FloorPlan => {
  const floor = centredFloor(12, 10);
  const size = STATION_SIZES[1];
  const door = at(4.6, 4.6, TO_NEG_Z);

  const stations: Record<StationKind, Placement> = {
    ship: onBackWall(floor, size.ship, -2.2),
    calendar: onBackWall(floor, size.calendar, 0.05),
    pricing: onBackWall(floor, size.pricing, 1.7),
    coffee: onBackWall(floor, size.coffee, 3.7),
    servers: onBackWall(floor, size.servers, 5.35),
    investors: onSideWall(floor, size.investors, 0.5),
    boardroom: at(-3.3, 3.3, TO_POS_Z),
    launch: at(1.6, 3.4, TO_POS_Z),
  };

  return {
    office: 1,
    floor,
    deskSeats: [
      // One shared hot-desk island: two short rows facing each other.
      ...bench("x", -1.7, -0.625, 4),
      // And one desk by the wall, a step away from the island.
      at(-5.0, -3.0, TO_POS_X),
    ],
    // Strung along the open side.
    waitingSpots: nearestFirst(door, [
      at(4.75, -2.0, TO_NEG_X + 0.2),
      at(5.45, -1.1, TO_NEG_X - 0.25),
      at(4.7, -0.3, TO_NEG_X + 0.1),
      at(5.5, 0.6, TO_NEG_X - 0.15),
      at(4.75, 1.5, TO_NEG_X + 0.3),
      at(5.4, 2.4, TO_NEG_X - 0.1),
    ]),
    door,
    stations,
    stationStandSpots: standSpots(1, stations),
    wanderSpots: [
      lookingAt(4.5, -3.5, stations.coffee),
      lookingAt(-0.9, -3.4, stations.ship),
      at(0.4, 4.3, TO_POS_Z),
      lookingAt(-4.3, 1.3, stations.investors),
      at(3.3, 2.7, TO_POS_Z),
    ],
    // A loft somebody has made an effort with: greenery in the corners, a sofa by the meeting table.
    decor: [
      decor("plant-large", at(-5.5, -4.5, TO_POS_Z)),
      decor("water-cooler", onBackWall(floor, DECOR_SIZES["water-cooler"], 2.68)),
      decor("couch", onSideWall(floor, DECOR_SIZES.couch, 4.1), 1),
      decor("plant", at(5.6, 4.6, TO_POS_Z), 1),
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2, the company's own office — 17 × 13. A lease, pods, and two desks in the corner. Twenty-two desks.
//
//                [==== product wall ====]   cal  prices     coffee
//     ┌───────────────────────────────────────────────────────────────────────┐
//     │   ▼                                                                   │
//     │ [  ]        ▼   ▼   ▼            ▼   ▼   ▼                 ·   ·      │
//     │            [  ][  ][  ]         [  ][  ][  ]                          │
//     │  ▶[ ]      [  ][  ][  ]         [  ][  ][  ]                          │
//     │             ▲   ▲   ▲            ▲   ▲   ▲                            │
//     │ servers                                                               │
//     │              ▶[ ][ ]◀              ▶[ ][ ]◀                           │
//     │ ☎            ▶[ ][ ]◀              ▶[ ][ ]◀                           │
//     │                                                           ·   ·       │
//     │    ▭▭▭ board table      · ·        ▭ launch               ·   ·       │
//     │                                                 door ▲                │
//     └───────────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const ownPlan = (): FloorPlan => {
  const floor = centredFloor(17, 13);
  const size = STATION_SIZES[2];
  const door = at(5.0, 6.1, TO_NEG_Z);

  const stations: Record<StationKind, Placement> = {
    ship: onBackWall(floor, size.ship, -3.15),
    calendar: onBackWall(floor, size.calendar, -0.3),
    pricing: onBackWall(floor, size.pricing, 1.5),
    coffee: onBackWall(floor, size.coffee, 4.9),
    servers: onSideWall(floor, size.servers, 0.4),
    investors: onSideWall(floor, size.investors, 2.5),
    boardroom: at(-5.7, 4.75, TO_POS_Z),
    launch: at(1.0, 4.8, TO_POS_Z),
  };

  return {
    office: 2,
    floor,
    deskSeats: [
      // Two pods of six under the product wall…
      ...bench("x", -4.55, -3.5, 3),
      ...bench("x", 1.25, -3.5, 3),
      // …and two pods of four turned the other way in front of them.
      ...bench("z", -4.075, 0.9, 2),
      ...bench("z", 1.725, 0.9, 2),
      // The corner: one desk looks down the room, the other across it.
      at(-7.1, -5.2, TO_POS_Z),
      at(-7.45, -2.3, TO_POS_X),
    ],
    waitingSpots: nearestFirst(door, [
      at(6.5, 3.0, TO_NEG_X + 0.2),
      at(7.6, 3.3, TO_NEG_X - 0.15),
      at(6.4, 4.2, TO_NEG_X - 0.25),
      at(7.5, 4.5, TO_NEG_X + 0.1),
      at(6.6, -3.4, TO_POS_Z + 0.2),
      at(7.7, -3.1, TO_POS_Z - 0.25),
      at(-2.6, 5.0, TO_POS_Z + 0.15),
      at(-1.5, 5.5, TO_POS_Z - 0.2),
    ]),
    door,
    stations,
    stationStandSpots: standSpots(2, stations),
    wanderSpots: [
      lookingAt(3.6, -5.3, stations.coffee),
      lookingAt(-0.9, -5.2, stations.ship),
      at(-0.4, -0.5, TO_POS_Z),
      at(-0.6, 5.7, TO_POS_Z),
      at(3.6, 5.2, TO_POS_Z),
    ],
    decor: [
      // The board table gets a glass room of its own in the corner; you walk in past the end of its front wall.
      partition(-6.3, 3.6, TO_POS_Z, 4.4),
      partition(-4.0, 4.45, TO_POS_X, 1.7),
      // A server closet: glass fins either side of the rack.
      partition(-7.95, -0.65, TO_POS_Z, 1.1),
      partition(-7.95, 1.52, TO_POS_Z, 1.1),
      // Kitchenette beside the coffee machine.
      decor("vending", onBackWall(floor, DECOR_SIZES.vending, 3.5)),
      decor("water-cooler", onBackWall(floor, DECOR_SIZES["water-cooler"], 2.65)),
      decor("bookshelf", onSideWall(floor, DECOR_SIZES.bookshelf, -3.7)),
      decor("plant-large", at(-8.05, -6.05, TO_POS_Z)),
      decor("plant", at(8.15, -5.15, TO_POS_Z), 1),
      decor("plant-large", at(6.45, 6.0, TO_POS_Z), 2),
      decor("plant", at(-0.575, -2.9, TO_POS_Z), 2),
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3, the full floor — 23 × 17. Teams on long benches, wide aisles, room for plants. Forty desks.
//
//                  [===== product wall =====]  cal  prices    coffee
//     ┌─────────────────────────────────────────────────────────────────────────────┐
//     │    ▼      ▼                                                                 │
//     │  [  ]   [  ]     ▶[][]◀      ▶[][]◀      ▶[][]◀                             │
//     │                  ▶[][]◀      ▶[][]◀      ▶[][]◀                             │
//     │ servers          ▶[][]◀      ▶[][]◀      ▶[][]◀                             │
//     │                  ▶[][]◀      ▶[][]◀      ▶[][]◀                             │
//     │ ☎                ▶[][]◀      ▶[][]◀      ▶[][]◀          ▭ launch           │
//     │                  ▶[][]◀      ▶[][]◀      ▶[][]◀                             │
//     │  ▯ board         ▶[][]◀                                 ·  ·  ·  ·          │
//     │  ▯ table                                                 ·  ·  ·            │
//     │  ▯                                                      ·  ·  ·             │
//     │                                                                 door ▲      │
//     └─────────────────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const floorPlan = (): FloorPlan => {
  const floor = centredFloor(23, 17);
  const size = STATION_SIZES[3];
  const door = at(9.6, 8.1, TO_NEG_Z);

  const stations: Record<StationKind, Placement> = {
    ship: onBackWall(floor, size.ship, -3.4),
    calendar: onBackWall(floor, size.calendar, 0.0),
    pricing: onBackWall(floor, size.pricing, 2.3),
    coffee: onBackWall(floor, size.coffee, 5.6),
    servers: onSideWall(floor, size.servers, -3.4),
    investors: onSideWall(floor, size.investors, 0.2),
    boardroom: at(-9.4, 4.9, TO_POS_X),
    launch: at(8.3, 0.4, TO_POS_Z),
  };

  return {
    office: 3,
    floor,
    deskSeats: [
      // Three benches of 14, 12 and 12.
      ...bench("z", -5.6, -4.2, 7),
      ...bench("z", -1.35, -4.2, 6),
      ...bench("z", 2.9, -4.2, 6),
      // Two desks side by side with their backs to the wall, looking over the benches.
      at(-9.9, -7.3, TO_POS_Z),
      at(-7.5, -7.3, TO_POS_Z),
    ],
    waitingSpots: nearestFirst(door, [
      at(6.7, 2.9, TO_NEG_X + 0.2),
      at(7.8, 3.1, TO_NEG_Z - 0.2),
      at(8.9, 2.8, TO_NEG_Z + 0.15),
      at(10.0, 3.1, TO_NEG_X - 0.25),
      at(7.2, 4.1, TO_POS_X + 0.1),
      at(8.4, 4.0, TO_NEG_Z + 0.3),
      at(9.5, 4.2, TO_NEG_X + 0.15),
      at(6.8, 5.2, TO_POS_X - 0.2),
      at(8.0, 5.1, TO_NEG_Z - 0.1),
      at(9.1, 5.3, TO_NEG_X - 0.3),
    ]),
    door,
    stations,
    stationStandSpots: standSpots(3, stations),
    wanderSpots: [
      lookingAt(4.0, -7.2, stations.coffee),
      lookingAt(-0.9, -7.2, stations.ship),
      at(10.9, 1.0, TO_POS_X),
      at(2.0, 7.2, TO_POS_Z),
      at(6.0, 1.4, TO_POS_Z),
    ],
    decor: [
      // Glass fins frame the board table against the wall; its long side stays open to the floor.
      partition(-9.85, 2.9, TO_POS_Z, 3.3),
      partition(-9.85, 6.95, TO_POS_Z, 3.3),
      decor("meeting-pod", at(-8.2, -1.2, TO_POS_Z)),
      decor("reception", at(7.6, 7.3, TO_POS_X)),
      // The play corner.
      decor("ping-pong", at(-1.2, 6.4, TO_POS_Z)),
      decor("arcade", at(3.9, 5.9, TO_POS_Z)),
      decor("arcade", at(4.75, 5.9, TO_POS_Z), 1),
      decor("vending", onBackWall(floor, DECOR_SIZES.vending, 3.85), 1),
      decor("water-cooler", onBackWall(floor, DECOR_SIZES["water-cooler"], 6.98)),
      // Plants wherever a bench ends or a corner would otherwise be bare.
      decor("plant-large", at(-10.95, -7.95, TO_POS_Z)),
      decor("plant", at(-8.7, -8.05, TO_POS_Z), 1),
      decor("plant-large", at(9.8, -8.0, TO_POS_Z), 1),
      decor("plant-large", at(10.9, -7.9, TO_POS_Z), 2),
      decor("plant-large", at(-11.0, 7.8, TO_POS_Z), 3),
      decor("plant", at(11.05, -0.8, TO_POS_Z), 2),
      decor("plant", at(-4.675, -5.6, TO_POS_Z)),
      decor("plant", at(-0.425, -5.6, TO_POS_Z), 1),
      decor("plant", at(3.825, -5.6, TO_POS_Z), 2),
      decor("plant", at(-0.425, 4.6, TO_POS_Z), 3),
      // Past the end of the third bench (it stood at z = 3.2 until that bench grew a sixth pair of desks).
      decor("plant", at(3.825, 4.5, TO_POS_Z)),
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 4, the campus — 27 × 19. One floor of something larger: six benches on a grid and a corner. Fifty desks, which
// is as many figures as are drawn; the rest of a bigger company is a count on the sign by the door.
//
//                   [====== product wall ======]  cal  ticker     coffee
//     ┌──────────────────────────────────────────────────────────────────────────────────┐
//     │         ▼                                                                        │
//     │  ▶[ ] [  ]     ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                                    │
//     │               [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │ servers       [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲                                    │
//     │                ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                                    │
//     │ ☎             [ ][ ][ ][ ]        [ ][ ][ ][ ]              ·  ·  ·  ·           │
//     │               [ ][ ][ ][ ]        [ ][ ][ ][ ]               ·  ·  ·             │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲               ·  ·  ·              │
//     │  ▯ board       ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                ·  ·                │
//     │  ▯ table      [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │  ▯            [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲                                    │
//     │                            ▭ launch                             door ▲           │
//     └──────────────────────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const campusPlan = (): FloorPlan => {
  const floor = centredFloor(27, 19);
  const size = STATION_SIZES[4];
  const door = at(10.5, 9.1, TO_NEG_Z);

  const stations: Record<StationKind, Placement> = {
    ship: onBackWall(floor, size.ship, -4.2),
    calendar: onBackWall(floor, size.calendar, 0.0),
    pricing: onBackWall(floor, size.pricing, 2.8),
    coffee: onBackWall(floor, size.coffee, 6.6),
    servers: onSideWall(floor, size.servers, -3.0),
    investors: onSideWall(floor, size.investors, 1.0),
    boardroom: at(-10.6, 5.7, TO_POS_X),
    launch: at(2.0, 7.2, TO_POS_Z),
  };

  return {
    office: 4,
    floor,
    deskSeats: [
      // Six benches of eight in a 2 × 3 grid, filled from the back row forward.
      ...bench("x", -6.55, -5.4, 4),
      ...bench("x", 1.55, -5.4, 4),
      ...bench("x", -6.55, -1.15, 4),
      ...bench("x", 1.55, -1.15, 4),
      ...bench("x", -6.55, 3.1, 4),
      ...bench("x", 1.55, 3.1, 4),
      // The corner: one desk in the corner itself, one against the wall beside it.
      at(-12.2, -7.0, TO_POS_X),
      at(-9.8, -8.3, TO_POS_Z),
    ],
    waitingSpots: nearestFirst(door, [
      at(8.9, -0.6, TO_POS_X + 0.2),
      at(10.2, -0.55, TO_NEG_Z - 0.15),
      at(11.4, -0.65, TO_NEG_Z + 0.25),
      at(12.6, -0.6, TO_NEG_X - 0.1),
      at(9.5, 1.2, TO_POS_X - 0.2),
      at(10.75, 1.25, TO_POS_Z + 0.25),
      at(12.0, 1.15, TO_NEG_X + 0.15),
      at(8.9, 3.0, TO_POS_X + 0.1),
      at(10.2, 3.05, TO_NEG_Z - 0.3),
      at(11.4, 2.95, TO_NEG_Z + 0.2),
      at(12.6, 3.0, TO_NEG_X - 0.2),
      at(10.8, 4.6, TO_NEG_Z + 0.1),
    ]),
    door,
    stations,
    stationStandSpots: standSpots(4, stations),
    wanderSpots: [
      lookingAt(4.6, -8.1, stations.coffee),
      lookingAt(-0.9, -8.1, stations.ship),
      at(-0.4, 1.9, TO_POS_Z),
      at(12.9, -1.7, TO_POS_X),
      at(-3.0, 7.6, TO_POS_Z),
    ],
    decor: [
      // The boardroom: glass fins from the wall on both sides of the long table.
      partition(-11.4, 3.3, TO_POS_Z, 4.2),
      partition(-11.4, 8.1, TO_POS_Z, 4.2),
      // Lobby: reception by the door, somewhere for visitors to wait.
      decor("reception", at(8.2, 8.3, TO_POS_X)),
      decor("couch", at(12.9, 7.0, TO_NEG_X), 4),
      decor("coffee-table", at(11.9, 7.0, TO_POS_X)),
      decor("plant-large", at(11.9, 9.0, TO_POS_Z)),
      decor("trophy-shelf", onBackWall(floor, DECOR_SIZES["trophy-shelf"], 4.6)),
      decor("water-cooler", onBackWall(floor, DECOR_SIZES["water-cooler"], 8.2)),
      decor("bookshelf", onSideWall(floor, DECOR_SIZES.bookshelf, -5.5)),
      decor("bookshelf", onBackWall(floor, DECOR_SIZES.bookshelf, -12.7)),
      decor("plant-large", at(13.0, -8.95, TO_POS_Z), 1),
      decor("plant-large", at(-13.0, 8.95, TO_POS_Z), 2),
      decor("plant", at(-0.4, -4.5, TO_POS_Z), 1),
      decor("plant", at(-0.4, 4.0, TO_POS_Z), 2),
      decor("plant", at(13.0, 5.8, TO_POS_Z), 3),
    ],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout assembly + memoisation
// ─────────────────────────────────────────────────────────────────────────────

/** The five plans, by office index. */
const PLAN_BUILDERS: readonly (() => FloorPlan)[] = [garagePlan, sharedPlan, ownPlan, floorPlan, campusPlan];

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const layoutCache = new Map<number, OfficeLayout>();
const frameCache = new WeakMap<OfficeLayout, LayoutFrame>();

/**
 * The floor plan of an office.
 *
 * Pure and memoised: the same index always returns the same deeply frozen layout, so layouts can be compared by
 * identity. An index that is not one of the five offices gives the garage, so nothing that asks for a floor plan
 * can throw on it.
 */
export const getOfficeLayout = (office: OfficeIndex): OfficeLayout => {
  const known = Number.isInteger(office) && office >= 0 && office < PLAN_BUILDERS.length ? office : 0;
  const cached = layoutCache.get(known);
  if (cached) return cached;

  const plan = PLAN_BUILDERS[known]();
  const frame = computeLayoutFrame(plan, groundRect(plan));
  const layout: OfficeLayout = deepFreeze({
    office: plan.office,
    floor: plan.floor,
    deskSeats: plan.deskSeats,
    waitingSpots: plan.waitingSpots,
    door: plan.door,
    stations: plan.stations,
    stationStandSpots: plan.stationStandSpots,
    wanderSpots: plan.wanderSpots,
    camera: { target: frame.target, viewHeight: viewHeightForFrame(frame, FRAME_REFERENCE_ASPECT) },
  });
  layoutCache.set(known, layout);
  frameCache.set(layout, deepFreeze(frame));
  registerLayoutDecor(layout, deepFreeze(plan.decor));
  return layout;
};

/**
 * How many desks each office's plan has: 4, 9, 22, 40 and 50. The first four are what those offices hold. The
 * campus holds more people than are ever drawn, and has a desk for each figure that is (the cast's cap on staff).
 */
export const DESKS: readonly number[] = Object.freeze(PLAN_BUILDERS.map((_, office) => getOfficeLayout(office as OfficeIndex).deskSeats.length));

/**
 * What the default shot of a layout has to contain, for camera rigs that want
 * to fit it to their own viewport. For a layout that did not come from
 * `getOfficeLayout` only the building itself is framed.
 */
export const getLayoutFrame = (layout: OfficeLayout): LayoutFrame =>
  frameCache.get(layout) ?? computeLayoutFrame(layout);

/**
 * World units that should be visible vertically so the layout's default shot
 * fits a viewport with this aspect ratio (width / height).
 * `layout.camera.viewHeight` is this value at FRAME_REFERENCE_ASPECT.
 */
export const fitViewHeight = (layout: OfficeLayout, aspect: number): number =>
  viewHeightForFrame(getLayoutFrame(layout), aspect);

/**
 * A point `distance` outside the doorway, straight out from the door: where
 * somebody arriving appears and somebody leaving disappears. It is off the
 * floor, which `findPath` handles: a walk to or from it passes through
 * `layout.door`.
 */
export const doorExterior = (layout: OfficeLayout, distance = 1.5): Vec2 => ({
  x: layout.door.x - Math.sin(layout.door.facing) * distance,
  z: layout.door.z - Math.cos(layout.door.facing) * distance,
});
