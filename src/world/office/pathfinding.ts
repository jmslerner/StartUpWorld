/**
 * Walking routes across an office floor.
 *
 * A coarse occupancy grid is rasterised once per layout from its obstacle
 * footprints; A* finds a cell path; exact line-of-sight tests against the
 * footprints then pull the path taut so people walk straight lines around
 * furniture instead of staircase zig-zags.
 *
 * Pure and allocation-light: the grid and all A* scratch buffers are reused
 * between calls. Nothing here can throw for finite inputs; when no route exists
 * the caller simply gets `[to]` and the person walks straight there.
 */
import type { OfficeLayout, Vec2 } from "../types";
import { footprintContains, getLayoutObstacles, isInsideFloor, segmentHitsFootprint } from "./footprints";
import type { Obstacle } from "./footprints";

/** Edge length of one grid cell, in world units. */
export const NAV_CELL_SIZE = 0.4;

/**
 * A cell is walkable when its centre is at least this far from every obstacle —
 * about half a character's width. Any straight corridor at least
 * `2 × NAV_AGENT_RADIUS + NAV_CELL_SIZE` (0.9) wide is guaranteed to be passable.
 */
export const NAV_AGENT_RADIUS = 0.25;

// Clearance kept by straightened segments. Smaller than NAV_AGENT_RADIUS on
// purpose: every hop between neighbouring walkable cells then always passes the
// sight test, so straightening can only ever shorten a path, never strand it.
const SIGHT_CLEARANCE = 0.2;

// Clearance from *other* furniture on the first / last step out of or into a
// spot that is itself inside furniture (a chair tucked under a desk).
const APPROACH_CLEARANCE = 0.1;

// Among the walkable cells a spot can be stepped into from, any within this
// much of the nearest one is as good as the nearest — so the one on the side
// the walker is coming from wins, and nobody circles a chair to sit down.
const APPROACH_SLACK = 0.45;

// How far ahead (in path points) straightening looks for a visible point.
const SIGHT_WINDOW = 64;

const SQRT2 = Math.SQRT2;
// Nudges A* to prefer cells nearer the goal among equal-cost options: far fewer
// expansions on open floor, at a cost below anything visible.
const HEURISTIC_WEIGHT = 1.001;

// 8-neighbourhood, orthogonal moves first.
const NEIGHBOUR_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOUR_DZ = [0, 0, 1, -1, 1, -1, 1, -1];

interface Anchor {
  /** Walkable cell the search starts from / ends at. */
  cell: number;
  /**
   * The point itself is not on walkable floor, so the route must pass through
   * this cell's centre and make one straight hop between it and the point.
   */
  snapped: boolean;
  /** False when even that hop has to cut through somebody else's furniture. */
  clean: boolean;
}

class NavGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly obstacles: readonly Obstacle[];
  private readonly blocked: Uint8Array;
  /** Connected region of each walkable cell (0 = blocked), and the region most of the floor belongs to. */
  private readonly region: Int32Array;
  private readonly mainRegion: number;

  // A* scratch, reused across searches. `searchId` stamps make clearing unnecessary.
  private readonly cost: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly opened: Uint32Array;
  private readonly closed: Uint32Array;
  private searchId = 0;
  private heapCells = new Int32Array(256);
  private heapKeys = new Float32Array(256);
  private heapSize = 0;

  constructor(layout: OfficeLayout) {
    const { minX, maxX, minZ, maxZ } = layout.floor;
    const width = Math.max(0, maxX - minX);
    const depth = Math.max(0, maxZ - minZ);
    this.cols = Math.max(1, Math.floor(width / NAV_CELL_SIZE + 1e-6));
    this.rows = Math.max(1, Math.floor(depth / NAV_CELL_SIZE + 1e-6));
    // Centre the grid so the uncovered sliver (< one cell) is split between both edges.
    this.originX = minX + (width - this.cols * NAV_CELL_SIZE) / 2;
    this.originZ = minZ + (depth - this.rows * NAV_CELL_SIZE) / 2;
    this.obstacles = getLayoutObstacles(layout);

    const count = this.cols * this.rows;
    this.blocked = new Uint8Array(count);
    this.cost = new Float32Array(count);
    this.cameFrom = new Int32Array(count);
    this.opened = new Uint32Array(count);
    this.closed = new Uint32Array(count);
    this.rasterise();
    this.region = new Int32Array(count);
    this.mainRegion = this.labelRegions();
  }

  centreX(cell: number): number {
    return this.originX + ((cell % this.cols) + 0.5) * NAV_CELL_SIZE;
  }

  centreZ(cell: number): number {
    return this.originZ + (Math.floor(cell / this.cols) + 0.5) * NAV_CELL_SIZE;
  }

  /** Is the point on walkable floor (inside the grid, in a free cell)? */
  isWalkable(x: number, z: number): boolean {
    const cell = this.cellAt(x, z);
    return cell >= 0 && this.blocked[cell] === 0;
  }

  /** Does the straight segment come within `pad` of any obstacle (other than `ignore`)? */
  sightBlocked(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    pad: number,
    ignore: readonly Obstacle[] | null
  ): boolean {
    for (const obstacle of this.obstacles) {
      if (ignore !== null && ignore.includes(obstacle)) continue;
      if (segmentHitsFootprint(obstacle, ax, az, bx, bz, pad)) return true;
    }
    return false;
  }

  /**
   * The walkable cell a route to / from (x, z) should use.
   *
   * Points on walkable floor use their own cell. Anything else — a seat tucked
   * under its desk — snaps to a nearby
   * walkable cell from which the point can be reached in one straight step
   * without crossing furniture other than the piece the point is already in.
   * That is what makes people get into their chair from the aisle side instead
   * of through a desk. Of the cells that qualify and are about equally near,
   * the one closest to (towardX, towardZ) — the other end of the walk — is used.
   *
   * Snapping only considers the main region of the floor: the nearest free cell
   * is sometimes a sliver sealed in between waiting spots, and a route cannot leave it.
   * With `mainOnly`, a point standing in such a sliver is snapped out of it too.
   */
  anchor(x: number, z: number, towardX: number, towardZ: number, mainOnly = false): Anchor | null {
    const own = this.cellAt(x, z);
    if (own >= 0 && this.blocked[own] === 0 && (!mainOnly || this.region[own] === this.mainRegion)) {
      return { cell: own, snapped: false, clean: true };
    }

    // Furniture the point is in (its own chair, its own waiting spot). The step may
    // pass through that — but not through the desk in front of the chair.
    const home: Obstacle[] = [];
    for (const obstacle of this.obstacles) {
      if (footprintContains(obstacle, x, z, APPROACH_CLEARANCE)) home.push(obstacle);
    }

    const col = this.clampCol(x);
    const row = this.clampRow(z);
    const reach = Math.max(this.cols, this.rows);
    let fallback = -1;
    let best = -1;
    let bestDetour = Infinity;
    let limit = Infinity;
    let scanned = 0;
    for (let radius = 4; ; radius *= 2) {
      // Nearest first, so the first clean cell found sets how far "about as near" reaches.
      for (const cell of this.mainCellsNear(col, row, radius, scanned, x, z)) {
        if (fallback < 0) fallback = cell;
        const cx = this.centreX(cell);
        const cz = this.centreZ(cell);
        const distance = Math.hypot(cx - x, cz - z);
        if (distance > limit) break;
        if (this.sightBlocked(cx, cz, x, z, APPROACH_CLEARANCE, home)) continue;
        if (best < 0) limit = distance + APPROACH_SLACK;
        const detour = Math.hypot(cx - towardX, cz - towardZ);
        if (detour < bestDetour) {
          best = cell;
          bestDetour = detour;
        }
      }
      // Every cell outside the scanned square is at least this far away.
      const beyond = (radius + 0.5) * NAV_CELL_SIZE;
      if (best >= 0 && limit <= beyond) break;
      if (radius >= reach) break;
      scanned = radius;
    }
    if (best >= 0) return { cell: best, snapped: true, clean: true };
    // Nothing has a clean approach: take the nearest floor and accept the cut.
    return fallback >= 0 ? { cell: fallback, snapped: true, clean: false } : null;
  }

  /** Can a route exist between the two walkable cells at all? */
  connected(a: number, b: number): boolean {
    return this.region[a] === this.region[b];
  }

  /** A* over walkable cells. Returns the cells from start to goal inclusive, or null. */
  search(start: number, goal: number): number[] | null {
    if (start === goal) return [start];
    // Different regions never connect; say so without flooding the whole floor.
    if (!this.connected(start, goal)) return null;

    const { cols, rows, blocked, cost, cameFrom, opened, closed } = this;
    if (this.searchId === 0xffffffff) {
      // The stamps are 32-bit: start over rather than let an old stamp match again.
      opened.fill(0);
      closed.fill(0);
      this.searchId = 0;
    }
    this.searchId += 1;
    const id = this.searchId;
    const goalCol = goal % cols;
    const goalRow = Math.floor(goal / cols);

    this.heapSize = 0;
    cost[start] = 0;
    cameFrom[start] = -1;
    opened[start] = id;
    this.heapPush(start, 0);

    while (this.heapSize > 0) {
      const cell = this.heapPop();
      if (closed[cell] === id) continue;
      closed[cell] = id;
      if (cell === goal) return this.trace(goal);

      const col = cell % cols;
      const row = Math.floor(cell / cols);
      for (let n = 0; n < 8; n += 1) {
        const nextCol = col + NEIGHBOUR_DX[n];
        const nextRow = row + NEIGHBOUR_DZ[n];
        if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
        const next = nextRow * cols + nextCol;
        if (blocked[next] !== 0 || closed[next] === id) continue;
        const diagonal = n >= 4;
        // No corner cutting: a diagonal step needs both cells it squeezes between.
        if (diagonal && (blocked[row * cols + nextCol] !== 0 || blocked[nextRow * cols + col] !== 0)) continue;

        const nextCost = cost[cell] + (diagonal ? SQRT2 : 1);
        if (opened[next] === id && nextCost >= cost[next]) continue;
        cost[next] = nextCost;
        cameFrom[next] = cell;
        opened[next] = id;

        const dx = Math.abs(nextCol - goalCol);
        const dz = Math.abs(nextRow - goalRow);
        const octile = Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
        this.heapPush(next, nextCost + octile * HEURISTIC_WEIGHT);
      }
    }
    return null;
  }

  private rasterise(): void {
    const { cols, rows, blocked } = this;
    for (const obstacle of this.obstacles) {
      const firstCol = Math.max(0, Math.ceil((obstacle.minX - NAV_AGENT_RADIUS - this.originX) / NAV_CELL_SIZE - 0.5));
      const lastCol = Math.min(
        cols - 1,
        Math.floor((obstacle.maxX + NAV_AGENT_RADIUS - this.originX) / NAV_CELL_SIZE - 0.5)
      );
      const firstRow = Math.max(0, Math.ceil((obstacle.minZ - NAV_AGENT_RADIUS - this.originZ) / NAV_CELL_SIZE - 0.5));
      const lastRow = Math.min(
        rows - 1,
        Math.floor((obstacle.maxZ + NAV_AGENT_RADIUS - this.originZ) / NAV_CELL_SIZE - 0.5)
      );
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let col = firstCol; col <= lastCol; col += 1) {
          const cell = row * cols + col;
          if (blocked[cell] !== 0) continue;
          if (footprintContains(obstacle, this.centreX(cell), this.centreZ(cell), NAV_AGENT_RADIUS)) blocked[cell] = 1;
        }
      }
    }
  }

  /**
   * Flood-fill the walkable cells into connected regions, using exactly the
   * moves `search` allows. Returns the label of the largest region (0 when the
   * floor has no walkable cell at all).
   */
  private labelRegions(): number {
    const { cols, rows, blocked, region } = this;
    const stack = new Int32Array(cols * rows);
    let labels = 0;
    let largest = 0;
    let largestSize = 0;
    for (let seed = 0; seed < blocked.length; seed += 1) {
      if (blocked[seed] !== 0 || region[seed] !== 0) continue;
      labels += 1;
      let size = 0;
      let top = 0;
      stack[top] = seed;
      top += 1;
      region[seed] = labels;
      while (top > 0) {
        top -= 1;
        const cell = stack[top];
        size += 1;
        const col = cell % cols;
        const row = Math.floor(cell / cols);
        for (let n = 0; n < 8; n += 1) {
          const nextCol = col + NEIGHBOUR_DX[n];
          const nextRow = row + NEIGHBOUR_DZ[n];
          if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= rows) continue;
          const next = nextRow * cols + nextCol;
          if (blocked[next] !== 0 || region[next] !== 0) continue;
          if (n >= 4 && (blocked[row * cols + nextCol] !== 0 || blocked[nextRow * cols + col] !== 0)) continue;
          region[next] = labels;
          stack[top] = next;
          top += 1;
        }
      }
      if (size > largestSize) {
        largestSize = size;
        largest = labels;
      }
    }
    return largest;
  }

  /** Cell containing the point, or −1 when the point is outside the grid. */
  private cellAt(x: number, z: number): number {
    const col = Math.floor((x - this.originX) / NAV_CELL_SIZE);
    const row = Math.floor((z - this.originZ) / NAV_CELL_SIZE);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  private clampCol(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.originX) / NAV_CELL_SIZE)));
  }

  private clampRow(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.originZ) / NAV_CELL_SIZE)));
  }

  /**
   * Main-region cells within `radius` cells (Chebyshev) of (col, row) but
   * farther than `skip`, nearest to (x, z) first.
   */
  private mainCellsNear(col: number, row: number, radius: number, skip: number, x: number, z: number): number[] {
    const { cols, rows, region, mainRegion } = this;
    const cells: number[] = [];
    // Region 0 means "blocked": a floor with no walkable cell has no main region.
    if (mainRegion === 0) return cells;
    const firstRow = Math.max(0, row - radius);
    const lastRow = Math.min(rows - 1, row + radius);
    const firstCol = Math.max(0, col - radius);
    const lastCol = Math.min(cols - 1, col + radius);
    for (let r = firstRow; r <= lastRow; r += 1) {
      for (let c = firstCol; c <= lastCol; c += 1) {
        if (skip > 0 && Math.abs(r - row) <= skip && Math.abs(c - col) <= skip) continue;
        const cell = r * cols + c;
        if (region[cell] === mainRegion) cells.push(cell);
      }
    }
    const distance = (cell: number): number => {
      const dx = this.centreX(cell) - x;
      const dz = this.centreZ(cell) - z;
      return dx * dx + dz * dz;
    };
    // Ties broken by cell index so the choice never depends on sort stability.
    return cells.sort((a, b) => distance(a) - distance(b) || a - b);
  }

  private trace(goal: number): number[] {
    const cells: number[] = [];
    for (let cell = goal; cell >= 0; cell = this.cameFrom[cell]) cells.push(cell);
    return cells.reverse();
  }

  private heapPush(cell: number, key: number): void {
    if (this.heapSize === this.heapCells.length) {
      const cells = new Int32Array(this.heapSize * 2);
      const keys = new Float32Array(this.heapSize * 2);
      cells.set(this.heapCells);
      keys.set(this.heapKeys);
      this.heapCells = cells;
      this.heapKeys = keys;
    }
    const { heapCells, heapKeys } = this;
    let i = this.heapSize;
    this.heapSize += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKeys[parent] <= key) break;
      heapCells[i] = heapCells[parent];
      heapKeys[i] = heapKeys[parent];
      i = parent;
    }
    heapCells[i] = cell;
    heapKeys[i] = key;
  }

  private heapPop(): number {
    const { heapCells, heapKeys } = this;
    const top = heapCells[0];
    this.heapSize -= 1;
    const size = this.heapSize;
    if (size > 0) {
      const cell = heapCells[size];
      const key = heapKeys[size];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && heapKeys[child + 1] < heapKeys[child]) child += 1;
        if (heapKeys[child] >= key) break;
        heapCells[i] = heapCells[child];
        heapKeys[i] = heapKeys[child];
        i = child;
      }
      heapCells[i] = cell;
      heapKeys[i] = key;
    }
    return top;
  }
}

const gridCache = new WeakMap<OfficeLayout, NavGrid>();

const gridFor = (layout: OfficeLayout): NavGrid => {
  let grid = gridCache.get(layout);
  if (!grid) {
    grid = new NavGrid(layout);
    gridCache.set(layout, grid);
  }
  return grid;
};

const MIN_STEP = 1e-3;

/** Route between two points on the floor. Waypoints exclude the start and end exactly on `destination`. */
const routeOnFloor = (layout: OfficeLayout, fromX: number, fromZ: number, destination: Vec2): Vec2[] => {
  const toX = destination.x;
  const toZ = destination.z;
  if (Math.hypot(toX - fromX, toZ - fromZ) < MIN_STEP) return [destination];

  const grid = gridFor(layout);
  let start = grid.anchor(fromX, fromZ, toX, toZ);
  let end = grid.anchor(toX, toZ, fromX, fromZ);
  if (start !== null && end !== null && !grid.connected(start.cell, end.cell)) {
    // One end stands in a pocket of free floor that furniture seals off (a gap
    // between waiting spots, say). If it can simply step out onto the main floor, the
    // walk goes ahead from there; if something solid is in the way there really
    // is no route.
    start = grid.anchor(fromX, fromZ, toX, toZ, true);
    end = grid.anchor(toX, toZ, fromX, fromZ, true);
    if (start === null || end === null || !start.clean || !end.clean) return [destination];
  }
  if (start === null || end === null) return [destination];
  const cells = grid.search(start.cell, end.cell);
  if (cells === null) return [destination];

  // Candidate polyline: from, every cell centre on the route, to.
  const count = cells.length + 2;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  xs[0] = fromX;
  zs[0] = fromZ;
  for (let i = 0; i < cells.length; i += 1) {
    xs[i + 1] = grid.centreX(cells[i]);
    zs[i + 1] = grid.centreZ(cells[i]);
  }
  xs[count - 1] = toX;
  zs[count - 1] = toZ;

  const path: Vec2[] = [];
  let lastX = fromX;
  let lastZ = fromZ;
  const emit = (index: number): void => {
    if (Math.hypot(xs[index] - lastX, zs[index] - lastZ) < MIN_STEP) return;
    lastX = xs[index];
    lastZ = zs[index];
    path.push({ x: lastX, z: lastZ });
  };

  // A snapped end is a fixed hop to its cell centre, so straightening only runs
  // over the stretch in between.
  let at = 0;
  if (start.snapped) {
    emit(1);
    at = 1;
  }
  const stop = end.snapped ? count - 2 : count - 1;
  while (at < stop) {
    // Farthest point that can be seen from here; the next point is always acceptable.
    let next = at + 1;
    for (let probe = Math.min(stop, at + SIGHT_WINDOW); probe > at + 1; probe -= 1) {
      if (!grid.sightBlocked(xs[at], zs[at], xs[probe], zs[probe], SIGHT_CLEARANCE, null)) {
        next = probe;
        break;
      }
    }
    emit(next);
    at = next;
  }

  // Finish exactly on the destination (replacing a waypoint that is practically on top of it).
  if (path.length > 0 && Math.hypot(toX - lastX, toZ - lastZ) < MIN_STEP) path.pop();
  path.push(destination);
  return path;
};

/**
 * Waypoints (excluding `from`, including `to`) for walking between two points
 * without cutting through desks, chairs, stations or set dressing.
 *
 * Either end may be somewhere a person cannot stand — a seat or a waiting spot. The
 * route then uses nearby walkable floor on the side the walk comes from and
 * makes one direct step for that end, through nothing but the piece of
 * furniture the end point is itself in (the walker's own chair or waiting spot —
 * never their desk, and never anybody else's furniture).
 *
 * An end outside the floor is connected through the door: people arrive and
 * leave through the doorway (`layout.door`), not over the edge of the floor
 * nearest to wherever they happen to be going.
 *
 * Always ends exactly at `to`. Returns `[to]` when the points are mutually
 * visible, when no route exists, when both ends are outside, or when an input
 * is not finite.
 */
export const findPath = (layout: OfficeLayout, from: Vec2, to: Vec2): Vec2[] => {
  const destination: Vec2 = { x: to.x, z: to.z };
  if (!Number.isFinite(from.x) || !Number.isFinite(from.z) || !Number.isFinite(to.x) || !Number.isFinite(to.z)) {
    return [destination];
  }

  const fromIndoors = isInsideFloor(layout, from);
  const toIndoors = isInsideFloor(layout, to);
  // (A plan whose door is not on its own floor has no doorway to go through.)
  if ((fromIndoors && toIndoors) || !isInsideFloor(layout, layout.door)) {
    return routeOnFloor(layout, from.x, from.z, destination);
  }
  if (!fromIndoors && !toIndoors) return [destination];

  const door: Vec2 = { x: layout.door.x, z: layout.door.z };
  if (toIndoors) {
    // Arriving: straight to the doorway, then across the floor.
    const indoors = routeOnFloor(layout, door.x, door.z, destination);
    const alreadyAtDoor = Math.hypot(door.x - from.x, door.z - from.z) < MIN_STEP;
    const doorIsDestination = Math.hypot(door.x - to.x, door.z - to.z) < MIN_STEP;
    return alreadyAtDoor || doorIsDestination ? indoors : [door, ...indoors];
  }
  // Leaving: across the floor to the doorway, then straight out.
  return [...routeOnFloor(layout, from.x, from.z, door), destination];
};

/** Total walking distance of a path returned by `findPath`, starting at `from`. */
export const pathLength = (from: Vec2, path: readonly Vec2[]): number => {
  let length = 0;
  let x = from.x;
  let z = from.z;
  for (const point of path) {
    length += Math.hypot(point.x - x, point.z - z);
    x = point.x;
    z = point.z;
  }
  return length;
};

/** Can a person stand at this point (on the floor and clear of furniture)? */
export const isWalkable = (layout: OfficeLayout, point: Vec2): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.z) && gridFor(layout).isWalkable(point.x, point.z);
