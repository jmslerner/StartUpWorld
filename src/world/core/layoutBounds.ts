import type { AssetId } from "../../types/game";
import { assetFootprint } from "../office/layouts";
import type { OfficeLayout } from "../types";
import type { GroundBounds } from "./CameraRig";

/**
 * The ground area covered by the building plus the given assets (several of
 * which — helipad, jet, yacht — are parked well outside the floor).
 *
 * Used twice with different asset lists: pan limits include everything on show
 * (owned assets and the "for sale" blueprints), while the shadow frustum only
 * needs what actually casts a shadow, i.e. owned assets — keeping it small
 * keeps the shadow map sharp.
 */
export const layoutBounds = (layout: OfficeLayout, assets: readonly AssetId[]): GroundBounds => {
  const bounds: GroundBounds = { ...layout.floor };
  const include = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.minZ = Math.min(bounds.minZ, minZ);
    bounds.maxZ = Math.max(bounds.maxZ, maxZ);
  };
  // The doorway can sit on (or just past) the floor's edge.
  include(layout.door.x, layout.door.x, layout.door.z, layout.door.z);
  for (const assetId of assets) {
    const footprint = assetFootprint(layout, assetId);
    include(footprint.minX, footprint.maxX, footprint.minZ, footprint.maxZ);
  }
  return bounds;
};
