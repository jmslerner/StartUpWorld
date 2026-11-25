/**
 * Floor footprints: the rectangle of floor each piece of furniture owns.
 *
 * This is the shared vocabulary between the floor plans (which must not overlap
 * things), the pathfinder (which must walk around them) and the office builder
 * (whose props must fit inside them). Pure geometry — no three.js.
 *
 * Conventions (see also the top of ../types.ts):
 *   • `facing` is a yaw; forward = (sin facing, cos facing) in (x, z).
 *   • A footprint is `width` across its facing and `depth` along it, centred on
 *     (x, z). Rectangles may be rotated by any angle; `minX … maxZ` is always the
 *     axis-aligned box around them.
 *   • The floor rectangle is the room's interior. Walls stand outside it, with
 *     their inner face on the floor edge.
 */
import type { OfficeLayout, Placement, StationKind, Vec2 } from "../types";

/** Distance from a seat to the centre of its desk surface, along the seat's facing. */
export const DESK_OFFSET = 0.55;

/** Height of the back walls on the −X and −Z edges (spec §2). Used for camera framing. */
export const WALL_HEIGHT = 2.6;

/** Gap left between a wall-hugging station and the wall's inner face. */
export const WALL_GAP = 0.05;

/** How far in front of a station's footprint its stand spot is. */
export const STAND_DISTANCE = 0.6;

export interface FootprintSize {
  /** Extent across the object's facing. */
  width: number;
  /** Extent along the object's facing. */
  depth: number;
}

/** Desk surface (spec §2). The desk is centred DESK_OFFSET in front of its seat. */
export const DESK_SIZE: FootprintSize = { width: 1.3, depth: 0.65 };

/** The chair a seated person occupies, centred on the seat itself. */
export const CHAIR_SIZE: FootprintSize = { width: 0.5, depth: 0.5 };

/**
 * The floor a person standing at a waiting spot takes up, centred on the spot. Nothing is built there and nobody
 * has to walk around it: it is the room the plans keep clear of furniture.
 */
export const WAITING_SIZE: FootprintSize = { width: 0.7, depth: 0.7 };

/**
 * Floor area reserved for each station, per office (0 the garage … 4 the campus): stations grow with the
 * company (a whiteboard and a folding table in the garage; a product wall and a
 * boardroom at the campus). Props for a station must fit inside its
 * rectangle; `layout.stations[kind]` is the rectangle's centre and front
 * direction. Wall-mounted boards are thin because only their floor shadow counts.
 *
 * These numbers are the single source of truth: the layouts below are built
 * from them and the tests check every plan against them.
 */
export const STATION_SIZES: readonly Record<StationKind, FootprintSize>[] = [
  {
    ship: { width: 1.8, depth: 0.2 },
    calendar: { width: 0.8, depth: 0.15 },
    pricing: { width: 0.9, depth: 0.15 },
    servers: { width: 0.7, depth: 0.6 },
    coffee: { width: 0.8, depth: 0.55 },
    boardroom: { width: 1.4, depth: 0.8 },
    launch: { width: 0.9, depth: 0.6 },
    investors: { width: 0.7, depth: 0.6 },
  },
  {
    ship: { width: 2.4, depth: 0.2 },
    calendar: { width: 0.9, depth: 0.15 },
    pricing: { width: 1.1, depth: 0.15 },
    servers: { width: 0.8, depth: 0.7 },
    coffee: { width: 1.2, depth: 0.6 },
    boardroom: { width: 1.8, depth: 1.0 },
    launch: { width: 1.2, depth: 0.7 },
    investors: { width: 0.9, depth: 0.9 },
  },
  {
    ship: { width: 3.2, depth: 0.25 },
    calendar: { width: 1.0, depth: 0.15 },
    pricing: { width: 1.4, depth: 0.2 },
    servers: { width: 1.6, depth: 0.8 },
    coffee: { width: 1.6, depth: 0.6 },
    boardroom: { width: 2.6, depth: 1.4 },
    launch: { width: 1.6, depth: 0.8 },
    investors: { width: 1.2, depth: 0.8 },
  },
  {
    ship: { width: 4.0, depth: 0.25 },
    calendar: { width: 1.2, depth: 0.15 },
    pricing: { width: 1.6, depth: 0.2 },
    servers: { width: 2.4, depth: 0.9 },
    coffee: { width: 2.0, depth: 0.65 },
    boardroom: { width: 3.4, depth: 1.6 },
    launch: { width: 2.0, depth: 0.9 },
    investors: { width: 1.4, depth: 0.9 },
  },
  {
    ship: { width: 4.8, depth: 0.3 },
    calendar: { width: 1.2, depth: 0.15 },
    pricing: { width: 2.0, depth: 0.2 },
    servers: { width: 3.2, depth: 1.0 },
    coffee: { width: 2.4, depth: 0.7 },
    boardroom: { width: 4.2, depth: 1.8 },
    launch: { width: 2.4, depth: 1.0 },
    investors: { width: 1.6, depth: 1.0 },
  },
];

export const STATION_KINDS: readonly StationKind[] = [
  "ship", "launch", "investors", "boardroom", "calendar", "coffee", "servers", "pricing",
];

// ─────────────────────────────────────────────────────────────────────────────
// Set dressing that stands on the floor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Free-standing indoor set dressing: furniture that is neither a desk nor a station,
 * but that people still have to walk around. The floor plans say
 * where each piece stands; OfficeSystem builds the matching prop.
 */
export type DecorKind =
  | "plant"
  | "plant-large"
  | "bookshelf"
  | "filing-cabinet"
  | "boxes"
  | "couch"
  | "couch-wide"
  | "coffee-table"
  | "water-cooler"
  | "whiteboard"
  | "bicycle"
  | "ping-pong"
  | "arcade"
  | "vending"
  | "trophy-shelf"
  | "stock-ticker"
  | "reception"
  | "meeting-pod"
  | "floor-lamp"
  | "guest-desk"
  | "partition";

/**
 * Floor area each kind of set dressing needs (the props are built to fit).
 * A "partition" is as long as its spot says (`DecorSpot.width`).
 */
export const DECOR_SIZES: Record<DecorKind, FootprintSize> = {
  plant: { width: 0.55, depth: 0.55 },
  "plant-large": { width: 0.8, depth: 0.8 },
  bookshelf: { width: 0.95, depth: 0.34 },
  "filing-cabinet": { width: 0.46, depth: 0.6 },
  boxes: { width: 1.0, depth: 0.6 },
  couch: { width: 1.6, depth: 0.84 },
  "couch-wide": { width: 2.22, depth: 0.84 },
  "coffee-table": { width: 1.0, depth: 0.55 },
  "water-cooler": { width: 0.45, depth: 0.4 },
  whiteboard: { width: 1.62, depth: 0.5 },
  bicycle: { width: 0.6, depth: 1.75 },
  "ping-pong": { width: 2.2, depth: 1.37 },
  arcade: { width: 0.72, depth: 0.8 },
  vending: { width: 0.92, depth: 0.74 },
  "trophy-shelf": { width: 1.1, depth: 0.36 },
  "stock-ticker": { width: 2.8, depth: 0.3 },
  reception: { width: 2.36, depth: 0.9 },
  "meeting-pod": { width: 2.4, depth: 2.0 },
  "floor-lamp": { width: 0.4, depth: 0.4 },
  // Somebody else's desk and chair in a shared space, as one block.
  "guest-desk": { width: 1.3, depth: 1.25 },
  partition: { width: 1, depth: 0.16 },
};

/** One piece of set dressing: where it stands and which way its front faces. */
export interface DecorSpot extends Placement {
  kind: DecorKind;
  /** Picks a colour / arrangement among the prop's variants. */
  variant: number;
  /** Extent across the facing, for kinds without a fixed size (partitions). */
  width?: number;
}

/** Width of the strip of shared loft beyond the shared office's +X edge. */
export const LOFT_ANNEX_WIDTH = 2.5;

/**
 * Height the scenery behind the back walls reaches, where there is any (the
 * skyline behind the campus), by office. The default shot leaves room for it.
 */
export const SKYLINE_HEIGHTS: readonly number[] = [0, 0, 0, 0, 5.6];

/**
 * How far the ground tile under the building extends past the floor on each
 * side. The back sides only need room for the walls; the open sides carry the
 * street, the driveway and whatever stands outside.
 */
export interface GroundMargins {
  negX: number;
  posX: number;
  negZ: number;
  posZ: number;
}

/** By office. */
export const GROUND_MARGINS: readonly GroundMargins[] = [
  // The garage's driveway runs out of the +X side to the street, where a car is parked.
  { negX: 1.2, posX: 4.7, negZ: 1.2, posZ: 2.4 },
  // The shared office: +X is the rest of the loft (other people's desks); +Z is a pavement and a road.
  { negX: 1.2, posX: LOFT_ANNEX_WIDTH, negZ: 1.2, posZ: 3.4 },
  { negX: 1.2, posX: 2.2, negZ: 1.2, posZ: 2.4 },
  { negX: 1.4, posX: 2.2, negZ: 1.4, posZ: 2.4 },
  { negX: 1.4, posX: 2.2, negZ: 1.4, posZ: 2.4 },
];

/**
 * How far the ground's surface lies below the office floor (y = 0). Just enough
 * that the ground never shows through the joints between floor tiles, and the
 * floor reads as a slab laid on the site. Roads, pads and paving sink with it.
 */
export const GROUND_SINK = 0.02;

/** Thickness of the ground tile, i.e. how far below y = 0 the diorama reaches. */
export const GROUND_DEPTH = 0.5;

export interface GroundRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The ground tile the building stands on: the floor grown by the office's margins. */
export const groundRect = (layout: Pick<OfficeLayout, "office" | "floor">): GroundRect => {
  const margins = GROUND_MARGINS[layout.office];
  return {
    minX: layout.floor.minX - margins.negX,
    maxX: layout.floor.maxX + margins.posX,
    minZ: layout.floor.minZ - margins.negZ,
    maxZ: layout.floor.maxZ + margins.posZ,
  };
};

/** An oriented rectangle on the floor. */
export interface Footprint extends FootprintSize {
  /** Centre. */
  x: number;
  z: number;
  facing: number;
  /** Axis-aligned bounds (exact when `facing` is a multiple of 90°, enclosing otherwise). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface SeatFurniture extends Footprint {
  /** Index into layout.deskSeats. */
  slotIndex: number;
}

export interface DeskObstacle extends SeatFurniture {
  kind: "desk";
}
export interface ChairObstacle extends SeatFurniture {
  kind: "chair";
}
export interface StationObstacle extends Footprint {
  kind: "station";
  station: StationKind;
}

export interface DecorObstacle extends Footprint {
  kind: "decor";
  decor: DecorKind;
  /** Index into getLayoutDecor(layout). */
  decorIndex: number;
}

/** Something on the floor that people walk around. */
export type Obstacle = DeskObstacle | ChairObstacle | StationObstacle | DecorObstacle;

// ─────────────────────────────────────────────────────────────────────────────
// Rectangle maths
// ─────────────────────────────────────────────────────────────────────────────

/** Unit vector a placement with this facing looks along. */
export const forwardOf = (facing: number): Vec2 => ({ x: Math.sin(facing), z: Math.cos(facing) });

/** Wrap an angle into (−π, π]. */
export const normalizeFacing = (facing: number): number => {
  const turn = Math.PI * 2;
  const wrapped = ((((facing + Math.PI) % turn) + turn) % turn) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
};

export const makeFootprint = (center: Vec2, size: FootprintSize, facing: number): Footprint => {
  const sin = Math.abs(Math.sin(facing));
  const cos = Math.abs(Math.cos(facing));
  const halfX = (cos * size.width + sin * size.depth) / 2;
  const halfZ = (sin * size.width + cos * size.depth) / 2;
  return {
    x: center.x,
    z: center.z,
    width: size.width,
    depth: size.depth,
    facing,
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
};

/** Centre of the desk surface that belongs to a seat. */
export const deskCenter = (seat: Placement): Vec2 => ({
  x: seat.x + Math.sin(seat.facing) * DESK_OFFSET,
  z: seat.z + Math.cos(seat.facing) * DESK_OFFSET,
});

export const deskFootprint = (seat: Placement): Footprint => makeFootprint(deskCenter(seat), DESK_SIZE, seat.facing);

export const chairFootprint = (seat: Placement): Footprint => makeFootprint(seat, CHAIR_SIZE, seat.facing);

/** The clear floor a waiting spot needs (see WAITING_SIZE). Not an obstacle. */
export const waitingFootprint = (spot: Placement): Footprint => makeFootprint(spot, WAITING_SIZE, spot.facing);

export const stationFootprint = (layout: Pick<OfficeLayout, "office" | "stations">, station: StationKind): Footprint => {
  const placement = layout.stations[station];
  return makeFootprint(placement, STATION_SIZES[layout.office][station], placement.facing);
};

/** Is the point inside the rectangle grown by `pad` on every side? (Edges count as inside.) */
export const footprintContains = (footprint: Footprint, x: number, z: number, pad = 0): boolean => {
  const dx = x - footprint.x;
  const dz = z - footprint.z;
  const sin = Math.sin(footprint.facing);
  const cos = Math.cos(footprint.facing);
  // Rotate into the rectangle's own frame: `across` runs along its width, `along` along its depth.
  const across = dx * cos - dz * sin;
  const along = dx * sin + dz * cos;
  return Math.abs(across) <= footprint.width / 2 + pad && Math.abs(along) <= footprint.depth / 2 + pad;
};

/**
 * Does the segment a→b touch the rectangle grown by `pad`?
 * Liang–Barsky clipping in the rectangle's own frame, so rotation is free.
 */
export const segmentHitsFootprint = (
  footprint: Footprint,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  pad = 0
): boolean => {
  // Cheap reject on the axis-aligned bounds first: almost every query misses.
  if (
    (ax < footprint.minX - pad && bx < footprint.minX - pad) ||
    (ax > footprint.maxX + pad && bx > footprint.maxX + pad) ||
    (az < footprint.minZ - pad && bz < footprint.minZ - pad) ||
    (az > footprint.maxZ + pad && bz > footprint.maxZ + pad)
  ) {
    return false;
  }

  const sin = Math.sin(footprint.facing);
  const cos = Math.cos(footprint.facing);
  const adx = ax - footprint.x;
  const adz = az - footprint.z;
  const bdx = bx - footprint.x;
  const bdz = bz - footprint.z;
  const startAcross = adx * cos - adz * sin;
  const startAlong = adx * sin + adz * cos;
  const deltaAcross = bdx * cos - bdz * sin - startAcross;
  const deltaAlong = bdx * sin + bdz * cos - startAlong;
  const halfAcross = footprint.width / 2 + pad;
  const halfAlong = footprint.depth / 2 + pad;

  let enter = 0;
  let exit = 1;
  // Slab 1: across the width. Slab 2: along the depth.
  for (let axis = 0; axis < 2; axis += 1) {
    const start = axis === 0 ? startAcross : startAlong;
    const delta = axis === 0 ? deltaAcross : deltaAlong;
    const half = axis === 0 ? halfAcross : halfAlong;
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(start) > half) return false;
    } else {
      const t1 = (-half - start) / delta;
      const t2 = (half - start) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return false;
    }
  }
  return true;
};

const cornersOf = (footprint: Footprint): Vec2[] => {
  const sin = Math.sin(footprint.facing);
  const cos = Math.cos(footprint.facing);
  const hw = footprint.width / 2;
  const hd = footprint.depth / 2;
  // across axis = (cos, −sin), along axis = (sin, cos)
  return [
    { x: footprint.x + hw * cos + hd * sin, z: footprint.z - hw * sin + hd * cos },
    { x: footprint.x - hw * cos + hd * sin, z: footprint.z + hw * sin + hd * cos },
    { x: footprint.x - hw * cos - hd * sin, z: footprint.z + hw * sin - hd * cos },
    { x: footprint.x + hw * cos - hd * sin, z: footprint.z - hw * sin - hd * cos },
  ];
};

/**
 * Lower bound on the gap between two rectangles (separating-axis test): positive
 * when they are apart, negative when they overlap. Exact for axis-aligned pairs
 * that face each other; for corner-to-corner cases the true gap can be larger,
 * never smaller — so `footprintGap(a, b) >= d` safely proves "at least d apart".
 */
export const footprintGap = (a: Footprint, b: Footprint): number => {
  const cornersA = cornersOf(a);
  const cornersB = cornersOf(b);
  let widest = -Infinity;
  for (const footprint of [a, b]) {
    const sin = Math.sin(footprint.facing);
    const cos = Math.cos(footprint.facing);
    const axes: Vec2[] = [
      { x: cos, z: -sin },
      { x: sin, z: cos },
    ];
    for (const axis of axes) {
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const corner of cornersA) {
        const d = corner.x * axis.x + corner.z * axis.z;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const corner of cornersB) {
        const d = corner.x * axis.x + corner.z * axis.z;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      widest = Math.max(widest, minB - maxA, minA - maxB);
    }
  }
  return widest;
};

/** Do the two rectangles overlap (sharing an edge does not count)? */
export const footprintsOverlap = (a: Footprint, b: Footprint): boolean => footprintGap(a, b) < -1e-9;

/** Is the point on the floor, at least `margin` in from every edge? */
export const isInsideFloor = (layout: Pick<OfficeLayout, "floor">, point: Vec2, margin = 0): boolean =>
  point.x >= layout.floor.minX + margin &&
  point.x <= layout.floor.maxX - margin &&
  point.z >= layout.floor.minZ + margin &&
  point.z <= layout.floor.maxZ - margin;

/** Is the whole rectangle on the floor, at least `margin` in from every edge? */
export const isFootprintInsideFloor = (
  layout: Pick<OfficeLayout, "floor">,
  footprint: Footprint,
  margin = 0
): boolean =>
  footprint.minX >= layout.floor.minX + margin &&
  footprint.maxX <= layout.floor.maxX - margin &&
  footprint.minZ >= layout.floor.minZ + margin &&
  footprint.maxZ <= layout.floor.maxZ - margin;

// ─────────────────────────────────────────────────────────────────────────────
// Obstacles of a layout
// ─────────────────────────────────────────────────────────────────────────────

const obstacleCache = new WeakMap<OfficeLayout, readonly Obstacle[]>();
const decorByLayout = new WeakMap<OfficeLayout, readonly DecorSpot[]>();
const NO_DECOR: readonly DecorSpot[] = Object.freeze([]);

/**
 * For layouts.ts only: record the set dressing of a floor plan. It is kept
 * beside the layout rather than on it because OfficeLayout (../types.ts) is the
 * cross-team contract and says nothing about décor. Must be called before the
 * layout's obstacles are first asked for.
 */
export const registerLayoutDecor = (layout: OfficeLayout, decor: readonly DecorSpot[]): void => {
  decorByLayout.set(layout, decor);
};

/** The free-standing set dressing of a layout from getOfficeLayout (empty for any other layout). */
export const getLayoutDecor = (layout: OfficeLayout): readonly DecorSpot[] => decorByLayout.get(layout) ?? NO_DECOR;

export const decorSize = (spot: DecorSpot): FootprintSize => {
  const size = DECOR_SIZES[spot.kind];
  return spot.width === undefined ? size : { width: spot.width, depth: size.depth };
};

export const decorFootprint = (spot: DecorSpot): Footprint => makeFootprint(spot, decorSize(spot), spot.facing);

const buildObstacles = (layout: OfficeLayout): readonly Obstacle[] => {
  const obstacles: Obstacle[] = [];

  layout.deskSeats.forEach((seat, slotIndex) => {
    obstacles.push({ ...deskFootprint(seat), kind: "desk", slotIndex });
    obstacles.push({ ...chairFootprint(seat), kind: "chair", slotIndex });
  });

  for (const station of STATION_KINDS) {
    obstacles.push({ ...stationFootprint(layout, station), kind: "station", station });
  }

  getLayoutDecor(layout).forEach((spot, decorIndex) => {
    obstacles.push({ ...decorFootprint(spot), kind: "decor", decor: spot.kind, decorIndex });
  });

  return Object.freeze(obstacles);
};

/**
 * Everything on the floor of this layout that blocks walking: desks, chairs,
 * stations and free-standing set dressing. Waiting spots are clear floor, not
 * obstacles. Memoised per layout object.
 *
 * The office builder can use the same list to place props (filter by `kind`).
 */
export const getLayoutObstacles = (layout: OfficeLayout): readonly Obstacle[] => {
  let obstacles = obstacleCache.get(layout);
  if (!obstacles) {
    obstacles = buildObstacles(layout);
    obstacleCache.set(layout, obstacles);
  }
  return obstacles;
};
