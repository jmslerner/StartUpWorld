import { describe, expect, it } from "vitest";
import { getOfficeLayout, groundRect } from "../office/layouts";
import type { OfficeIndex, OfficeLayout } from "../types";
import { layoutBounds } from "./layoutBounds";

const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];

describe("layoutBounds", () => {
  it("covers the whole ground tile, the floor and the doorway of every office (pan limits, shadow frustum)", () => {
    for (const office of OFFICES) {
      const layout = getOfficeLayout(office);
      const bounds = layoutBounds(layout);
      const ground = groundRect(layout);
      expect(bounds.minX, `office ${office}`).toBeLessThanOrEqual(Math.min(ground.minX, layout.floor.minX, layout.door.x));
      expect(bounds.maxX, `office ${office}`).toBeGreaterThanOrEqual(Math.max(ground.maxX, layout.floor.maxX, layout.door.x));
      expect(bounds.minZ, `office ${office}`).toBeLessThanOrEqual(Math.min(ground.minZ, layout.floor.minZ, layout.door.z));
      expect(bounds.maxZ, `office ${office}`).toBeGreaterThanOrEqual(Math.max(ground.maxZ, layout.floor.maxZ, layout.door.z));
    }
  });

  it("reaches a doorway that stands past the tile, and hands back bounds of its own", () => {
    const base = getOfficeLayout(0);
    const ground = groundRect(base);
    const beyond: OfficeLayout = { ...base, door: { x: ground.maxX + 3, z: ground.minZ - 2, facing: 0 } };
    const bounds = layoutBounds(beyond);
    expect(bounds.maxX).toBe(ground.maxX + 3);
    expect(bounds.minZ).toBe(ground.minZ - 2);
    expect(bounds.minX).toBe(ground.minX);
    expect(bounds.maxZ).toBe(ground.maxZ);
    expect(layoutBounds(base)).not.toBe(layoutBounds(base));
    expect(layoutBounds(base)).toEqual({ ...ground });
  });
});
