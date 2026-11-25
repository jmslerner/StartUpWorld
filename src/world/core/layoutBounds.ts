import { groundRect } from "../office/layouts";
import type { OfficeLayout } from "../types";
import type { GroundBounds } from "./CameraRig";

/**
 * The ground area covered by the diorama: the tile the building stands on
 * (lawn, street, the neighbours' half of the loft) and the doorway.
 *
 * Used for the pan limits and for the shadow frustum: the scenery standing on
 * the tile (a parked car, trees) casts shadows too.
 */
export const layoutBounds = (layout: OfficeLayout): GroundBounds => {
  // The default shot may crop the tile's far corners, so the player must be able to pan to them.
  const bounds: GroundBounds = { ...groundRect(layout) };
  // The doorway can sit on (or just past) the floor's edge.
  bounds.minX = Math.min(bounds.minX, layout.door.x);
  bounds.maxX = Math.max(bounds.maxX, layout.door.x);
  bounds.minZ = Math.min(bounds.minZ, layout.door.z);
  bounds.maxZ = Math.max(bounds.maxZ, layout.door.z);
  return bounds;
};
