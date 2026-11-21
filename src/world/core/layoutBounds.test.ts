import { describe, expect, it } from "vitest";
import type { AssetId, CompanyPhase } from "../../types/game";
import { assetFootprint, getOfficeLayout, groundRect } from "../office/layouts";
import { layoutBounds } from "./layoutBounds";

const PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "public", "unicorn"];
const OUTDOOR: readonly AssetId[] = ["helicopter", "jet", "yacht"];

describe("layoutBounds", () => {
  it("covers the whole ground tile and the floor in every phase (pan limits, shadow frustum)", () => {
    for (const phase of PHASES) {
      const layout = getOfficeLayout(phase, []);
      const bounds = layoutBounds(layout, []);
      const ground = groundRect(layout);
      expect(bounds.minX, phase).toBeLessThanOrEqual(Math.min(ground.minX, layout.floor.minX));
      expect(bounds.maxX, phase).toBeGreaterThanOrEqual(Math.max(ground.maxX, layout.floor.maxX));
      expect(bounds.minZ, phase).toBeLessThanOrEqual(Math.min(ground.minZ, layout.floor.minZ));
      expect(bounds.maxZ, phase).toBeGreaterThanOrEqual(Math.max(ground.maxZ, layout.floor.maxZ));
    }
  });

  it("reaches every asset it is given, even ones parked beyond the tile", () => {
    for (const phase of PHASES) {
      const layout = getOfficeLayout(phase, OUTDOOR);
      const bounds = layoutBounds(layout, OUTDOOR);
      for (const id of OUTDOOR) {
        const footprint = assetFootprint(layout, id);
        expect(bounds.minX, `${phase} ${id}`).toBeLessThanOrEqual(footprint.minX);
        expect(bounds.maxX, `${phase} ${id}`).toBeGreaterThanOrEqual(footprint.maxX);
        expect(bounds.minZ, `${phase} ${id}`).toBeLessThanOrEqual(footprint.minZ);
        expect(bounds.maxZ, `${phase} ${id}`).toBeGreaterThanOrEqual(footprint.maxZ);
      }
    }
  });
});
