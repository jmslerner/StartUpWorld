/**
 * Camera framing for a floor plan: where to look and how much to show so the
 * whole office, its back walls and the assets parked outside are in view.
 *
 * Pure maths for the fixed isometric view of spec §6 (camera looking from
 * +X, +Y, +Z). The camera rig owns the actual THREE camera; this only answers
 * "what should the default shot be?".
 */
import type { AssetId } from "../../types/game";
import type { OfficeLayout, Vec2 } from "../types";
import { ASSET_HEIGHTS, WALL_HEIGHT, assetFootprint } from "./footprints";
import type { GroundRect } from "./footprints";

/** Compass angle of the camera around +Y, measured from +Z toward +X. */
export const ISO_AZIMUTH = Math.PI / 4;

/** Camera elevation above the horizon: the true-isometric 35.26° ("≈ 35°" in the spec). */
export const ISO_ELEVATION = Math.atan(Math.SQRT1_2);

/**
 * Aspect ratio (width / height) `layout.camera.viewHeight` is computed for. On
 * a wider viewport everything fits with room to spare; on a narrower one use
 * `fitViewHeight(layout, aspect)` instead.
 */
export const FRAME_REFERENCE_ASPECT = 1.5;

// Breathing room around the framed content: a proportional margin plus a fixed
// one, so small offices do not touch the viewport edges either.
const FRAME_MARGIN = 0.03;
const FRAME_PADDING = 0.3;

/**
 * How much of the ground in front of the building's two open edges the shot
 * must show top to bottom: the doorstep, the kerb, whoever is walking in.
 */
export const FRAME_APRON = 1;

/** What the default shot has to contain, as seen by the isometric camera. */
export interface LayoutFrame {
  /** Ground point (y = 0) that sits in the middle of the shot. */
  target: Vec2;
  /** On-screen extent of the content plus margins, in world units (orthographic). */
  width: number;
  height: number;
}

const SIN_AZIMUTH = Math.sin(ISO_AZIMUTH);
const COS_AZIMUTH = Math.cos(ISO_AZIMUTH);
const SIN_ELEVATION = Math.sin(ISO_ELEVATION);
const COS_ELEVATION = Math.cos(ISO_ELEVATION);

/** Screen-right coordinate of a world point (world units). */
const screenU = (x: number, z: number): number => x * COS_AZIMUTH - z * SIN_AZIMUTH;

/** Screen-up coordinate of a world point (world units). */
const screenV = (x: number, y: number, z: number): number =>
  -(x * SIN_AZIMUTH + z * COS_AZIMUTH) * SIN_ELEVATION + y * COS_ELEVATION;

/**
 * Frame the floor, the back walls and the given assets.
 *
 * The ground tile the building stands on (when given) is treated as scenery:
 * the shot is always wide enough to show all of it, but top to bottom it only
 * has to hold the building, the assets and a doorstep's worth of ground. The
 * viewport above the terminal is wide and short, so the height is what limits
 * how large the office can be drawn — and the far corner of a lawn or the tip
 * of a road is worth less there than people you can actually make out. On a
 * tall, narrow viewport the width is the limit and the whole tile is in view.
 *
 * Works on projected extents rather than a world-space bounding box: in an
 * isometric view a long thin shape can be much larger on screen than its
 * bounding box suggests, and the other way round.
 */
export const computeLayoutFrame = (
  layout: Pick<OfficeLayout, "floor" | "assetAnchors">,
  framedAssets: readonly AssetId[],
  ground?: GroundRect
): LayoutFrame => {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  /** A point the shot must contain completely. */
  const include = (x: number, y: number, z: number): void => {
    const u = screenU(x, z);
    const v = screenV(x, y, z);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  };
  /** A point the shot must be wide enough for, but may crop top or bottom. */
  const includeAcross = (x: number, z: number): void => {
    const u = screenU(x, z);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
  };
  const includeBox = (minX: number, maxX: number, minZ: number, maxZ: number, height: number): void => {
    for (const y of [0, height]) {
      include(minX, y, minZ);
      include(minX, y, maxZ);
      include(maxX, y, minZ);
      include(maxX, y, maxZ);
    }
  };

  const { minX, maxX, minZ, maxZ } = layout.floor;
  includeBox(minX, maxX, minZ, maxZ, 0);
  // Only the −X and −Z edges carry walls; their top edges are what reach highest on screen.
  include(minX, WALL_HEIGHT, minZ);
  include(minX, WALL_HEIGHT, maxZ);
  include(maxX, WALL_HEIGHT, minZ);

  for (const assetId of framedAssets) {
    const footprint = assetFootprint(layout, assetId);
    includeBox(footprint.minX, footprint.maxX, footprint.minZ, footprint.maxZ, ASSET_HEIGHTS[assetId]);
  }

  if (ground) {
    // The doorstep: the ground just outside the two open edges, as far as the tile goes.
    include(Math.min(ground.maxX, maxX + FRAME_APRON), 0, Math.min(ground.maxZ, maxZ + FRAME_APRON));
    includeAcross(ground.minX, ground.minZ);
    includeAcross(ground.minX, ground.maxZ);
    includeAcross(ground.maxX, ground.minZ);
    includeAcross(ground.maxX, ground.maxZ);
  }

  // Un-project the centre of the shot back onto the ground plane.
  const u = (minU + maxU) / 2;
  const depthAlongView = -((minV + maxV) / 2) / SIN_ELEVATION;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    target: {
      x: round(u * COS_AZIMUTH + depthAlongView * SIN_AZIMUTH),
      z: round(-u * SIN_AZIMUTH + depthAlongView * COS_AZIMUTH),
    },
    width: round((maxU - minU) * (1 + 2 * FRAME_MARGIN) + 2 * FRAME_PADDING),
    height: round((maxV - minV) * (1 + 2 * FRAME_MARGIN) + 2 * FRAME_PADDING),
  };
};

/**
 * The building itself, tightly: the floor, the two back walls, the doorway and
 * the assets the company OWNS that are parked outside. No margins and no
 * scenery — the ground tile, the street and any "for sale" blueprints may crop
 * at the edges of the shot (the player can pan to them).
 *
 * This is what the camera rig fits to the viewport (with its own margin), so on
 * a wide, short viewport the office is drawn as large as the height allows and
 * on a phone in portrait as large as the width allows.
 */
export const computeBuildingFrame = (
  layout: Pick<OfficeLayout, "floor" | "assetAnchors" | "door">,
  ownedAssets: readonly AssetId[]
): LayoutFrame => {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const include = (x: number, y: number, z: number): void => {
    const u = screenU(x, z);
    const v = screenV(x, y, z);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  };
  const includeBox = (minX: number, maxX: number, minZ: number, maxZ: number, height: number): void => {
    for (const y of [0, height]) {
      include(minX, y, minZ);
      include(minX, y, maxZ);
      include(maxX, y, minZ);
      include(maxX, y, maxZ);
    }
  };

  const { minX, maxX, minZ, maxZ } = layout.floor;
  includeBox(minX, maxX, minZ, maxZ, 0);
  include(minX, WALL_HEIGHT, minZ);
  include(minX, WALL_HEIGHT, maxZ);
  include(maxX, WALL_HEIGHT, minZ);
  // Whoever is walking in or out stands in the doorway, which may sit on the floor's edge.
  include(layout.door.x, 0, layout.door.z);
  for (const assetId of ownedAssets) {
    const footprint = assetFootprint(layout, assetId);
    includeBox(footprint.minX, footprint.maxX, footprint.minZ, footprint.maxZ, ASSET_HEIGHTS[assetId]);
  }

  const u = (minU + maxU) / 2;
  const depthAlongView = -((minV + maxV) / 2) / SIN_ELEVATION;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    target: {
      x: round(u * COS_AZIMUTH + depthAlongView * SIN_AZIMUTH),
      z: round(-u * SIN_AZIMUTH + depthAlongView * COS_AZIMUTH),
    },
    width: round(maxU - minU),
    height: round(maxV - minV),
  };
};

/** World units that must be visible vertically for the frame to fit a viewport of this aspect ratio. */
export const viewHeightForFrame = (frame: LayoutFrame, aspect: number): number => {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : FRAME_REFERENCE_ASPECT;
  return Math.max(frame.height, frame.width / safeAspect);
};
