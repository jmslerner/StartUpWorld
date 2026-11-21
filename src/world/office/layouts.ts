/**
 * Floor plans: one hand-designed office per company phase.
 *
 * Pure data. Everything else about the office (which props stand where, what
 * they look like) is built from these plans by OfficeSystem, people walk them
 * via `findPath`, and SeatingPlan hands out their desks.
 *
 * How to read a plan (top-down, the way the comments below are drawn):
 *   • the −X wall is on the left, the −Z wall at the top; +X (right) and +Z
 *     (bottom) are the open sides that face the camera;
 *   • facing 0 looks toward +Z ("down the page"), π/2 toward +X ("right");
 *   • a seat is where the PERSON is; the desk is DESK_OFFSET in front of them.
 *
 * Rules every plan keeps (enforced by layouts.test.ts):
 *   • nothing overlaps: desks, chairs, stations, cushions, indoor asset zones;
 *   • ≥ 0.9 clear behind every seat, ≥ 1.0 between any two seats;
 *   • every seat, station stand spot and hang-out spot is reachable from the door;
 *   • the helicopter, jet and yacht stand outside, ≥ 2 from the building and
 *     from each other, off the open +X / +Z sides where the camera sees them.
 */
import { ASSET_CATALOG, phaseAtLeast } from "../../engine/assets";
import type { AssetId, CompanyPhase } from "../../types/game";
import type { OfficeLayout, Placement, StationKind, Vec2 } from "../types";
import {
  ASSET_IDS,
  ASSET_SIZES,
  DESK_OFFSET,
  DESK_SIZE,
  OUTDOOR_ASSET_IDS,
  STAND_DISTANCE,
  STATION_SIZES,
  WALL_GAP,
  isInsideFloor,
  normalizeFacing,
} from "./footprints";
import type { FootprintSize } from "./footprints";
import { FRAME_REFERENCE_ASPECT, computeLayoutFrame, viewHeightForFrame } from "./framing";
import type { LayoutFrame } from "./framing";

export * from "./footprints";
export { NAV_AGENT_RADIUS, NAV_CELL_SIZE, findPath, isWalkable, pathLength } from "./pathfinding";
export { FRAME_REFERENCE_ASPECT, ISO_AZIMUTH, ISO_ELEVATION, computeLayoutFrame, viewHeightForFrame } from "./framing";
export type { LayoutFrame } from "./framing";

type Floor = OfficeLayout["floor"];

/** The part of a layout that depends only on the phase, never on what the company owns. */
interface FloorPlan extends Omit<OfficeLayout, "camera"> {
  /** Extra hang-out spots that only exist once the asset has been bought. */
  assetWanderSpots: Partial<Record<AssetId, Placement[]>>;
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

const standSpots = (
  phase: CompanyPhase,
  stations: Record<StationKind, Placement>
): Record<StationKind, Placement> => {
  const sizes = STATION_SIZES[phase];
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

/** Minimum distance kept between outdoor assets and the building, and between each other. */
const OUTDOOR_CLEARANCE = 2;

/** A deck just outside the +X edge, for phases too small to have a lounge indoors. */
const PATIO_GAP = 0.4;
const patioLounge = (floor: Floor, z: number): Placement =>
  at(floor.maxX + PATIO_GAP + ASSET_SIZES.lounge.depth / 2, z, TO_POS_X);

/** Where the water starts when a patio already occupies the strip next to the building. */
const BEYOND_PATIO = PATIO_GAP + ASSET_SIZES.lounge.depth + OUTDOOR_CLEARANCE;

/**
 * Outdoor assets park outside the two open sides, where the camera sees them in
 * front of the building instead of hidden behind its back walls:
 *
 *   airside   — off +Z: the jet and the helipad;
 *   waterside — off +X: the yacht.
 *
 * Both the jet and the yacht lie parallel to the building. That keeps their
 * tall parts (tail fin, superstructure) a few units away from the edge, so
 * from the camera they do not cover the floor behind them. The yacht's bow
 * points toward +Z, which puts its port (−X) side — where the prop has its
 * jetty — toward the building.
 *
 * Where along each side they sit is chosen per plan so that, seen by the
 * isometric camera, they tuck under the building's two front edges and enlarge
 * the default shot as little as possible (see framing.ts). The longer +Z edge
 * has the bigger pocket under it, which is why the jet goes there.
 */
const outdoorAnchors = (
  floor: Floor,
  spots: { jetX: number; helipadX: number; yachtZ: number; yachtGap?: number }
): Pick<Record<AssetId, Placement>, "helicopter" | "jet" | "yacht"> => ({
  jet: at(spots.jetX, floor.maxZ + OUTDOOR_CLEARANCE + ASSET_SIZES.jet.width / 2, TO_POS_X),
  helicopter: at(spots.helipadX, floor.maxZ + OUTDOOR_CLEARANCE + ASSET_SIZES.helicopter.depth / 2, TO_POS_Z),
  yacht: at(floor.maxX + (spots.yachtGap ?? OUTDOOR_CLEARANCE) + ASSET_SIZES.yacht.width / 2, spots.yachtZ, TO_POS_Z),
});

// ─────────────────────────────────────────────────────────────────────────────
// Garage — 8 × 7. Two founders, a whiteboard and whoever fits.
//
//      srv  [= whiteboard =]   cal    prices   coffee
//     ┌───────────────────────────────────────────────┐
//     │                                               │
//     │   F▶[  ][  ]◀C            ▼                   │
//     │    partners' desk        [  ]  ╱╲             │
//     │                         [  ]   ╲╱◀            │
//     │ ☎                        ▲                    │
//     │                                        door ◀ │   patio
//     │ bar     ▯ folding      ▯ megaphone            │
//     │  ○        table          ○         ○   ○      │
//     └───────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const garagePlan = (): FloorPlan => {
  const floor = centredFloor(8, 7);
  const size = STATION_SIZES.garage;
  const bar = onSideWall(floor, ASSET_SIZES["office-upgrade"], 2.55);

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
    phase: "garage",
    floor,
    // One table, two founders, eye to eye across it.
    founderSeat: at(-3.05, -0.9, TO_POS_X),
    cofounderSeat: at(-1.2, -0.9, TO_NEG_X),
    // Three desks jammed in wherever they fit: a face-to-face pair that does not
    // quite line up, and a third shoved against their end at an angle.
    deskSeats: [at(1.25, -1.45, TO_POS_Z), at(1.1, 0.4, TO_NEG_Z), at(3.0, -0.5, TO_NEG_X + 0.14)],
    overflowSpots: [
      at(2.45, 3.0, TO_NEG_Z + 0.25),
      at(3.4, 3.0, TO_NEG_X - 0.2),
      at(0.35, 3.0, TO_NEG_Z - 0.2),
      at(-2.55, 3.0, TO_POS_X - 0.3),
    ],
    door: at(3.6, 1.9, TO_NEG_X),
    stations,
    stationStandSpots: standSpots("garage", stations),
    wanderSpots: [
      lookingAt(2.4, -2.3, stations.coffee),
      lookingAt(-0.5, -2.2, stations.ship),
      at(3.5, 0.95, TO_POS_X),
      at(0.0, 1.4, TO_POS_Z),
    ],
    // Standing at the near end of the bar: its far end is somebody's cushion.
    assetWanderSpots: { "office-upgrade": [inFrontOf(bar, ASSET_SIZES["office-upgrade"], 0.5)] },
    assetAnchors: {
      "office-upgrade": bar,
      lounge: patioLounge(floor, -1.7),
      ...outdoorAnchors(floor, { jetX: -5.5, helipadX: 3.5, yachtZ: 0, yachtGap: BEYOND_PATIO }),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Coworking — 12 × 10. A rented corner of somebody else's open plan.
//
//          [=== product wall ===]  cal  prices   coffee   srv
//     ┌──────────────────────────────────────────────────────────┐
//     │ F▶[ ]                                                    │
//     │ C▶[ ]             ▼    ▼    ▼    ▼                  ○     │
//     │                  [  ] [  ] [  ] [  ]   hot-desk      ○    │   patio
//     │ ☎ booth          [  ] [  ] [  ] [  ]   island       ○     │
//     │                   ▲    ▲    ▲    ▲                   ○    │
//     │ bar                                                 ○     │
//     │       ▭ meeting table         ▭ launch               ○    │
//     │                                               door ▲      │
//     └──────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

const coworkingPlan = (): FloorPlan => {
  const floor = centredFloor(12, 10);
  const size = STATION_SIZES.coworking;
  const bar = onSideWall(floor, ASSET_SIZES["office-upgrade"], 2.2);

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
    phase: "coworking",
    floor,
    // The founders keep their own bench by the wall, a step away from the hot desks.
    founderSeat: at(-5.0, -3.0, TO_POS_X),
    cofounderSeat: at(-5.0, -1.4, TO_POS_X),
    // One shared hot-desk island: two short rows facing each other.
    deskSeats: bench("x", -1.7, -0.625, 4),
    // Beanbags strung along the open side.
    overflowSpots: [
      at(4.75, -2.0, TO_NEG_X + 0.2),
      at(5.45, -1.1, TO_NEG_X - 0.25),
      at(4.7, -0.3, TO_NEG_X + 0.1),
      at(5.5, 0.6, TO_NEG_X - 0.15),
      at(4.75, 1.5, TO_NEG_X + 0.3),
      at(5.4, 2.4, TO_NEG_X - 0.1),
    ],
    door: at(4.6, 4.6, TO_NEG_Z),
    stations,
    stationStandSpots: standSpots("coworking", stations),
    wanderSpots: [
      lookingAt(4.5, -3.5, stations.coffee),
      lookingAt(-0.9, -3.4, stations.ship),
      at(0.4, 4.3, TO_POS_Z),
      lookingAt(-4.3, 1.3, stations.investors),
      at(3.3, 2.7, TO_POS_Z),
    ],
    assetWanderSpots: { "office-upgrade": [inFrontOf(bar, ASSET_SIZES["office-upgrade"])] },
    assetAnchors: {
      "office-upgrade": bar,
      lounge: patioLounge(floor, -3.0),
      ...outdoorAnchors(floor, { jetX: -8.5, helipadX: 0.5, yachtZ: 0, yachtGap: BEYOND_PATIO }),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Office — 17 × 13. A lease, pods, and a corner for the founders.
//
//                [==== product wall ====]   cal  prices     coffee   bar
//     ┌───────────────────────────────────────────────────────────────────────┐
//     │  F▼                                                                   │
//     │ [  ]        ▼   ▼   ▼            ▼   ▼   ▼                 ○   ○      │
//     │            [  ][  ][  ]         [  ][  ][  ]                          │
//     │ C▶[ ]      [  ][  ][  ]         [  ][  ][  ]                          │
//     │             ▲   ▲   ▲            ▲   ▲   ▲            ┌────────┐      │
//     │ servers                                               │ lounge │      │
//     │              ▶[ ][ ]◀              ▶[ ][ ]◀           └────────┘      │
//     │ ☎            ▶[ ][ ]◀              ▶[ ][ ]◀                           │
//     │                                                           ○   ○       │
//     │    ▭▭▭ board table      ○ ○        ▭ launch               ○   ○       │
//     │                                                 door ▲                │
//     └───────────────────────────────────────────────────────────────────────┘
//                                  helipad
// ─────────────────────────────────────────────────────────────────────────────

const officePlan = (): FloorPlan => {
  const floor = centredFloor(17, 13);
  const size = STATION_SIZES.office;
  const bar = onBackWall(floor, ASSET_SIZES["office-upgrade"], 7.2);
  const lounge = at(7.1, 0.0, TO_NEG_X);

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
    phase: "office",
    floor,
    // The founders' corner: one desk looks down the room, the other across it.
    founderSeat: at(-7.1, -5.2, TO_POS_Z),
    cofounderSeat: at(-7.45, -2.3, TO_POS_X),
    deskSeats: [
      // Two pods of six under the product wall…
      ...bench("x", -4.55, -3.5, 3),
      ...bench("x", 1.25, -3.5, 3),
      // …and two pods of four turned the other way in front of them.
      ...bench("z", -4.075, 0.9, 2),
      ...bench("z", 1.725, 0.9, 2),
    ],
    overflowSpots: [
      at(6.5, 3.0, TO_NEG_X + 0.2),
      at(7.6, 3.3, TO_NEG_X - 0.15),
      at(6.4, 4.2, TO_NEG_X - 0.25),
      at(7.5, 4.5, TO_NEG_X + 0.1),
      at(6.6, -3.4, TO_POS_Z + 0.2),
      at(7.7, -3.1, TO_POS_Z - 0.25),
      at(-2.6, 5.0, TO_POS_Z + 0.15),
      at(-1.5, 5.5, TO_POS_Z - 0.2),
    ],
    door: at(5.0, 6.1, TO_NEG_Z),
    stations,
    stationStandSpots: standSpots("office", stations),
    wanderSpots: [
      lookingAt(3.6, -5.3, stations.coffee),
      lookingAt(-0.9, -5.2, stations.ship),
      at(-0.4, -0.5, TO_POS_Z),
      at(-0.6, 5.7, TO_POS_Z),
      at(3.6, 5.2, TO_POS_Z),
    ],
    assetWanderSpots: {
      "office-upgrade": [inFrontOf(bar, ASSET_SIZES["office-upgrade"])],
      lounge: [inFrontOf(lounge, ASSET_SIZES.lounge, -0.8), inFrontOf(lounge, ASSET_SIZES.lounge, 0.8)],
    },
    assetAnchors: {
      "office-upgrade": bar,
      lounge,
      ...outdoorAnchors(floor, { jetX: -9, helipadX: 0, yachtZ: 0 }),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Unicorn — 23 × 17. Departments on long benches, wide aisles, room for plants.
//
//                  [===== product wall =====]  cal  prices    coffee    bar
//     ┌─────────────────────────────────────────────────────────────────────────────┐
//     │   F▼     C▼                                                                 │
//     │  [  ]   [  ]     ▶[][]◀      ▶[][]◀      ▶[][]◀           ┌────────┐        │
//     │                  ▶[][]◀      ▶[][]◀      ▶[][]◀           │ lounge │        │
//     │ servers          ▶[][]◀      ▶[][]◀      ▶[][]◀           └────────┘        │
//     │                  ▶[][]◀      ▶[][]◀      ▶[][]◀                             │   yacht
//     │ ☎                ▶[][]◀      ▶[][]◀      ▶[][]◀          ▭ launch           │
//     │                  ▶[][]◀      ▶[][]◀                                         │
//     │  ▯ board         ▶[][]◀                                 ○  ○  ○  ○          │
//     │  ▯ table                                                 ○  ○  ○            │
//     │  ▯                                                      ○  ○  ○             │
//     │                                                                 door ▲      │
//     └─────────────────────────────────────────────────────────────────────────────┘
//                     jet                       helipad
// ─────────────────────────────────────────────────────────────────────────────

const unicornPlan = (): FloorPlan => {
  const floor = centredFloor(23, 17);
  const size = STATION_SIZES.unicorn;
  const bar = onBackWall(floor, ASSET_SIZES["office-upgrade"], 8.3);
  const lounge = at(9.2, -3.4, TO_NEG_X);

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
    phase: "unicorn",
    floor,
    // Side by side with their backs to the wall, surveying the benches.
    founderSeat: at(-9.9, -7.3, TO_POS_Z),
    cofounderSeat: at(-7.5, -7.3, TO_POS_Z),
    deskSeats: [
      // Three benches of 14, 12 and 10, stepping down toward the lounge side.
      ...bench("z", -5.6, -4.2, 7),
      ...bench("z", -1.35, -4.2, 6),
      ...bench("z", 2.9, -4.2, 5),
    ],
    overflowSpots: [
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
    ],
    door: at(9.6, 8.1, TO_NEG_Z),
    stations,
    stationStandSpots: standSpots("unicorn", stations),
    wanderSpots: [
      lookingAt(4.0, -7.2, stations.coffee),
      lookingAt(-0.9, -7.2, stations.ship),
      at(10.9, 1.0, TO_POS_X),
      at(2.0, 7.2, TO_POS_Z),
      at(6.0, 1.4, TO_POS_Z),
    ],
    assetWanderSpots: {
      "office-upgrade": [inFrontOf(bar, ASSET_SIZES["office-upgrade"])],
      lounge: [inFrontOf(lounge, ASSET_SIZES.lounge, -0.8), inFrontOf(lounge, ASSET_SIZES.lounge, 0.8)],
    },
    assetAnchors: {
      "office-upgrade": bar,
      lounge,
      ...outdoorAnchors(floor, { jetX: -5, helipadX: 4, yachtZ: 0 }),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Public — 27 × 19. Headquarters: six teams on a grid, an executive corner.
//
//                   [====== product wall ======]  cal  ticker     coffee    bar
//     ┌──────────────────────────────────────────────────────────────────────────────────┐
//     │        C▼                                                                        │
//     │ F▶[ ] [  ]     ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                                    │
//     │               [ ][ ][ ][ ]        [ ][ ][ ][ ]               ┌────────┐          │
//     │ servers       [ ][ ][ ][ ]        [ ][ ][ ][ ]               │ lounge │          │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲                └────────┘          │
//     │                ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                                    │   yacht
//     │ ☎             [ ][ ][ ][ ]        [ ][ ][ ][ ]              ○  ○  ○  ○           │
//     │               [ ][ ][ ][ ]        [ ][ ][ ][ ]               ○  ○  ○             │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲               ○  ○  ○              │
//     │  ▯ board       ▼  ▼  ▼  ▼          ▼  ▼  ▼  ▼                ○  ○                │
//     │  ▯ table      [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │  ▯            [ ][ ][ ][ ]        [ ][ ][ ][ ]                                   │
//     │                ▲  ▲  ▲  ▲          ▲  ▲  ▲  ▲                                    │
//     │                            ▭ launch                             door ▲           │
//     └──────────────────────────────────────────────────────────────────────────────────┘
//                         jet                        helipad
// ─────────────────────────────────────────────────────────────────────────────

const publicPlan = (): FloorPlan => {
  const floor = centredFloor(27, 19);
  const size = STATION_SIZES.public;
  const bar = onBackWall(floor, ASSET_SIZES["office-upgrade"], 9.8);
  const lounge = at(11.4, -4.0, TO_NEG_X);

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
    phase: "public",
    floor,
    // The executive corner: the founder holds the corner itself, the cofounder the wall beside it.
    founderSeat: at(-12.2, -7.0, TO_POS_X),
    cofounderSeat: at(-9.8, -8.3, TO_POS_Z),
    deskSeats: [
      // Six benches of eight in a 2 × 3 grid, filled from the back row forward.
      ...bench("x", -6.55, -5.4, 4),
      ...bench("x", 1.55, -5.4, 4),
      ...bench("x", -6.55, -1.15, 4),
      ...bench("x", 1.55, -1.15, 4),
      ...bench("x", -6.55, 3.1, 4),
      ...bench("x", 1.55, 3.1, 4),
    ],
    overflowSpots: [
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
    ],
    door: at(10.5, 9.1, TO_NEG_Z),
    stations,
    stationStandSpots: standSpots("public", stations),
    wanderSpots: [
      lookingAt(4.6, -8.1, stations.coffee),
      lookingAt(-0.9, -8.1, stations.ship),
      at(-0.4, 1.9, TO_POS_Z),
      at(12.9, -1.7, TO_POS_X),
      at(-3.0, 7.6, TO_POS_Z),
    ],
    assetWanderSpots: {
      "office-upgrade": [inFrontOf(bar, ASSET_SIZES["office-upgrade"])],
      lounge: [inFrontOf(lounge, ASSET_SIZES.lounge, -0.8), inFrontOf(lounge, ASSET_SIZES.lounge, 0.8)],
    },
    assetAnchors: {
      "office-upgrade": bar,
      lounge,
      ...outdoorAnchors(floor, { jetX: -5, helipadX: 4, yachtZ: 0 }),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout assembly + memoisation
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_BUILDERS: Record<CompanyPhase, () => FloorPlan> = {
  garage: garagePlan,
  coworking: coworkingPlan,
  office: officePlan,
  unicorn: unicornPlan,
  public: publicPlan,
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const planCache = new Map<CompanyPhase, FloorPlan>();
const layoutCache = new Map<string, OfficeLayout>();
const frameCache = new WeakMap<OfficeLayout, LayoutFrame>();

const planFor = (phase: CompanyPhase): FloorPlan => {
  let plan = planCache.get(phase);
  if (!plan) {
    plan = deepFreeze(PLAN_BUILDERS[phase]());
    planCache.set(phase, plan);
  }
  return plan;
};

/**
 * The floor plan for a company phase.
 *
 * Pure and memoised: the same phase and the same set of owned assets (in any
 * order) always return the same, deeply frozen object.
 *
 * What the company owns changes only two things, and never the furniture:
 *   • `camera` — the default shot keeps every asset that is on show outside
 *     (owned, or for sale in this phase as a blueprint) in view;
 *   • `wanderSpots` — people only hang out at the espresso bar or in the lounge
 *     once it has actually been bought.
 * Seats, stations, the door and the anchors are shared by reference between
 * all variants of a phase, so seat assignments and routes survive a purchase.
 */
export const getOfficeLayout = (phase: CompanyPhase, ownedAssets: readonly AssetId[] = []): OfficeLayout => {
  const plan = planFor(phase);
  const owned = ASSET_IDS.filter((id) => ownedAssets.includes(id));

  // Everything parked outside that the player can see: bought, or on sale in
  // this phase (and therefore drawn as a blueprint).
  const framed = ASSET_IDS.filter(
    (id) =>
      !isInsideFloor(plan, plan.assetAnchors[id]) &&
      (owned.includes(id) || phaseAtLeast(phase, ASSET_CATALOG[id].minPhase))
  );
  const hangouts = owned.filter((id) => plan.assetWanderSpots[id] !== undefined);

  // Key on what actually differs between variants, so e.g. buying the
  // helicopter in a phase that already frames its blueprint is the same layout.
  const key = `${phase}|${framed.join(",")}|${hangouts.join(",")}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const frame = computeLayoutFrame(plan, framed);
  const layout: OfficeLayout = deepFreeze({
    phase: plan.phase,
    floor: plan.floor,
    founderSeat: plan.founderSeat,
    cofounderSeat: plan.cofounderSeat,
    deskSeats: plan.deskSeats,
    overflowSpots: plan.overflowSpots,
    door: plan.door,
    stations: plan.stations,
    stationStandSpots: plan.stationStandSpots,
    wanderSpots: [...plan.wanderSpots, ...hangouts.flatMap((id) => plan.assetWanderSpots[id] ?? [])],
    assetAnchors: plan.assetAnchors,
    camera: { target: frame.target, viewHeight: viewHeightForFrame(frame, FRAME_REFERENCE_ASPECT) },
  });
  layoutCache.set(key, layout);
  frameCache.set(layout, deepFreeze(frame));
  return layout;
};

/**
 * What the default shot of a layout has to contain, for camera rigs that want
 * to fit it to their own viewport. For a layout that did not come from
 * `getOfficeLayout` only the building itself is framed.
 */
export const getLayoutFrame = (layout: OfficeLayout): LayoutFrame =>
  frameCache.get(layout) ?? computeLayoutFrame(layout, []);

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

/** Is this one of the assets that stand outside the building in this layout? */
export const isOutdoorAsset = (layout: OfficeLayout, assetId: AssetId): boolean =>
  OUTDOOR_ASSET_IDS.includes(assetId) || !isInsideFloor(layout, layout.assetAnchors[assetId]);
