/**
 * The building itself: ground tile, floor slab, the two back walls, the low
 * kerbs on the open sides and the front door.
 *
 * What differs between phases is data (SHELL_SPECS): the wall finish, where the
 * windows are, whether the entrance is a roll-up garage door.
 */
import * as THREE from "three";
import type { CompanyPhase } from "../../types/game";
import type { OfficeLayout, Vec2 } from "../types";
import { forwardOf, GROUND_SINK, groundRect, LOFT_ANNEX_WIDTH } from "./layouts";
import {
  addCommandPlate,
  createCornerPost,
  createDoor,
  createFloor,
  createGarageDoor,
  createGround,
  createKerb,
  createWall,
  PropKit,
  WALL_THICKNESS,
} from "./props";
import type { DoorHandle, PropHandle, WallStyle } from "./props";
import type { StageKit } from "./StageKit";

/** A stretch of wall, as [from, to] along it (x for the −Z wall, z for the −X wall). */
type Span = readonly [number, number];

interface ShellSpec {
  wall: WallStyle;
  /**
   * Finish of the stretches listed in `backFeatures` / `sideFeatures`. The same
   * as `wall` means "this stretch has windows"; a different style (glass) means
   * the stretch is built in that style instead.
   */
  feature: WallStyle;
  /** Stretches of the −Z wall that are windowed / glazed. Keep them clear of wall-hung stations. */
  backFeatures: readonly Span[];
  /** Stretches of the −X wall that are windowed / glazed. */
  sideFeatures: readonly Span[];
  /** Low cut-away wall along the open +Z edge; null leaves it bare. */
  kerb: WallStyle | null;
  /** The same along the +X edge. */
  sideKerb: WallStyle | null;
  /**
   * Width of extra floor beyond the +X edge that is not the company's: the
   * rest of a shared loft. The −Z wall carries on behind it.
   */
  annex: number;
  /** The garage is entered through its raised roll-up door instead of a framed one. */
  rollUpDoor: boolean;
}

/**
 * Window positions are chosen against the floor plans: the product wall,
 * calendar and pricing board hang on the −Z wall, so its windows sit in the
 * gaps and toward the +X end; the −X wall is mostly free above the founders.
 */
const SHELL_SPECS: Record<CompanyPhase, ShellSpec> = {
  garage: {
    wall: "drywall",
    feature: "drywall",
    backFeatures: [],
    sideFeatures: [[-3.2, -1.5]],
    kerb: null,
    sideKerb: null,
    annex: 0,
    rollUpDoor: true,
  },
  coworking: {
    wall: "brick",
    feature: "brick",
    backFeatures: [
      [-5.6, -3.7],
      [6.3, 8.3],
    ],
    sideFeatures: [[-4.4, -0.3]],
    kerb: "brick",
    // Open toward the neighbours: the loft simply carries on.
    sideKerb: null,
    annex: LOFT_ANNEX_WIDTH,
    rollUpDoor: false,
  },
  office: {
    wall: "plaster",
    feature: "plaster",
    backFeatures: [
      [-8.0, -5.2],
      [2.4, 3.9],
    ],
    sideFeatures: [
      [-2.8, -0.9],
      [3.9, 6.2],
    ],
    kerb: "plaster",
    sideKerb: "plaster",
    annex: 0,
    rollUpDoor: false,
  },
  unicorn: {
    wall: "plaster",
    feature: "glass",
    backFeatures: [
      [-11.5, -5.7],
      [6.9, 11.5],
    ],
    sideFeatures: [
      [-8.5, -5.0],
      [1.2, 8.5],
    ],
    kerb: "glass",
    sideKerb: "glass",
    annex: 0,
    rollUpDoor: false,
  },
  public: {
    wall: "panel",
    feature: "panel",
    backFeatures: [[-11.8, -7.2]],
    sideFeatures: [
      [-9.0, -6.6],
      [3.6, 7.8],
    ],
    kerb: "panel",
    sideKerb: "panel",
    annex: 0,
    rollUpDoor: false,
  },
};

/** Width of the garage's roll-up opening, and of the gap a framed door needs in the kerb. */
export const ROLL_UP_WIDTH = 3.2;
const DOOR_GAP = 1.5;
/** Average wall length per window in a windowed stretch. */
const WINDOW_PITCH = 1.85;
const KERB_HEIGHT = 0.18;

export interface Shell {
  /** The object to register as the "door" interactable. */
  doorObject: THREE.Object3D;
  /** Present for framed doors, which can swing open. */
  door: DoorHandle | null;
  /** Height of the top of the door, for the inspector anchor. */
  doorHeight: number;
}

/** The point where the doorway crosses the edge of the floor (layout.door is a step inside it). */
export const doorOnEdge = (layout: OfficeLayout): Vec2 => {
  const { door, floor } = layout;
  const forward = forwardOf(door.facing);
  if (Math.abs(forward.x) > Math.abs(forward.z)) return { x: forward.x < 0 ? floor.maxX : floor.minX, z: door.z };
  return { x: door.x, z: forward.z < 0 ? floor.maxZ : floor.minZ };
};

/** Which open edge the door is on. */
const doorSide = (layout: OfficeLayout): "x" | "z" => {
  const forward = forwardOf(layout.door.facing);
  return Math.abs(forward.x) > Math.abs(forward.z) ? "x" : "z";
};

/**
 * One back wall as a run of segments: plain wall, and "feature" stretches that
 * are windowed (or glazed). `put` places a segment given its centre along the wall.
 */
const buildWallRun = (
  spec: ShellSpec,
  from: number,
  to: number,
  features: readonly Span[],
  put: (wall: PropHandle, centre: number) => void
): void => {
  const segment = (a: number, b: number, feature: boolean): void => {
    const length = b - a;
    if (length < 0.05) return;
    const glazed = feature && spec.feature !== spec.wall;
    const wall = createWall(length, {
      style: glazed ? spec.feature : spec.wall,
      windows: feature && !glazed ? Math.max(1, Math.round(length / WINDOW_PITCH)) : 0,
    });
    put(wall, (a + b) / 2);
  };
  let cursor = from;
  for (const [start, end] of [...features].sort((a, b) => a[0] - b[0])) {
    const a = Math.max(cursor, start);
    const b = Math.min(to, end);
    if (b <= a) continue;
    segment(cursor, a, false);
    segment(a, b, true);
    cursor = b;
  }
  segment(cursor, to, false);
};

/** A kerb from `from` to `to` along one open edge, leaving `gap` (if any) free for the doorway. */
const buildKerbRun = (
  style: WallStyle,
  from: number,
  to: number,
  gap: Span | null,
  put: (kerb: PropHandle, centre: number) => void
): void => {
  const piece = (a: number, b: number): void => {
    if (b - a < 0.2) return;
    put(createKerb(b - a, { height: KERB_HEIGHT, style }), (a + b) / 2);
  };
  if (!gap) {
    piece(from, to);
    return;
  }
  piece(from, Math.max(from, gap[0]));
  piece(Math.min(to, gap[1]), to);
};

/** The "> phases" plate for the roll-up door, which (unlike the framed doors) has none built in. */
const createRoadmapPlate = (): PropHandle => {
  const kit = new PropKit("door-plate");
  addCommandPlate(kit, "phases", 0, 0, 0, 0.2, 0.12);
  return kit.finish({ w: 0.9, d: 0.06 });
};

export const buildShell = (kit: StageKit): Shell => {
  const { layout, phase } = kit;
  const spec = SHELL_SPECS[phase];
  const { minX, maxX, minZ, maxZ } = layout.floor;
  const half = WALL_THICKNESS / 2;

  const ground = groundRect(layout);
  kit.build(createGround(ground.maxX - ground.minX, ground.maxZ - ground.minZ, phase), {
    x: (ground.minX + ground.maxX) / 2,
    y: -GROUND_SINK,
    z: (ground.minZ + ground.maxZ) / 2,
  });
  kit.build(createFloor(maxX - minX, maxZ - minZ, phase), { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 });

  if (spec.annex > 0) {
    kit.build(createFloor(spec.annex, maxZ - minZ, phase), { x: maxX + spec.annex / 2, z: (minZ + maxZ) / 2 });
  }

  // Back walls: their inner faces sit exactly on the floor's −Z and −X edges.
  buildWallRun(spec, minX, maxX + spec.annex, spec.backFeatures, (wall, centre) => {
    kit.build(wall, { x: centre, z: minZ - half });
  });
  buildWallRun(spec, minZ, maxZ, spec.sideFeatures, (wall, centre) => {
    kit.build(wall, { x: minX - half, z: centre, facing: Math.PI / 2 });
  });
  kit.build(createCornerPost({ style: spec.wall }), { x: minX - half, z: minZ - half });

  const edge = doorOnEdge(layout);
  const side = doorSide(layout);
  const gapWidth = spec.rollUpDoor ? ROLL_UP_WIDTH + 0.3 : DOOR_GAP;
  const gapAlong = side === "x" ? edge.z : edge.x;
  const gap: Span = [gapAlong - gapWidth / 2, gapAlong + gapWidth / 2];
  if (spec.kerb) {
    // Runs on past the corner by a wall's thickness so the two kerbs meet.
    const end = maxX + spec.annex + (spec.sideKerb ? WALL_THICKNESS : 0);
    buildKerbRun(spec.kerb, minX, end, side === "z" ? gap : null, (kerb, centre) => {
      kit.build(kerb, { x: centre, z: maxZ + half });
    });
  }
  if (spec.sideKerb) {
    buildKerbRun(spec.sideKerb, minZ, maxZ, side === "x" ? gap : null, (kerb, centre) => {
      kit.build(kerb, { x: maxX + half, z: centre, facing: Math.PI / 2 });
    });
  }

  if (spec.rollUpDoor) {
    // Just outside the floor edge, like the walls.
    const inward = forwardOf(layout.door.facing);
    const rollUp = kit.build(createGarageDoor(ROLL_UP_WIDTH, { slim: true }), {
      x: edge.x - inward.x * half,
      z: edge.z - inward.z * half,
      facing: layout.door.facing,
    });
    const plate = kit.props.add(createRoadmapPlate(), rollUp.group);
    // Hanging from the rail over the middle of the opening like a shop sign, its face to the street
    // (and so to the camera): the room side of anything on an open edge is the side nobody sees.
    plate.group.position.set(0, 1.98, -0.02);
    plate.group.rotation.y = Math.PI;
    return { doorObject: rollUp.group, door: null, doorHeight: 2.5 };
  }

  const door = kit.build(createDoor(phase), { x: edge.x, z: edge.z, facing: layout.door.facing });
  return { doorObject: door.group, door, doorHeight: 2.4 };
};
