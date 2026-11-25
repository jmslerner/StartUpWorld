/**
 * The camera rig fitted to each office's building frame: the shot the world opens on. These tests sat with the
 * camera rig's own until the layouts they need moved here.
 */
import { describe, expect, it } from "vitest";
import { CameraRig } from "../core/CameraRig";
import type { OfficeIndex } from "../types";
import { WALL_HEIGHT } from "./footprints";
import { computeBuildingFrame } from "./framing";
import { getOfficeLayout, groundRect } from "./layouts";

describe("CameraRig building framing", () => {
  const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];
  const FILL = 0.85;
  const ASPECTS = [0.45, 0.6, 0.8, 1, 1.5, 2, 2.4, 2.9, 3];

  /** Screen rectangle (canvas px) of the building: floor, back walls, doorway. */
  const buildingRect = (rig: CameraRig, office: OfficeIndex) => {
    const layout = getOfficeLayout(office);
    const points: Array<{ x: number; y: number; z: number }> = [];
    const { floor } = layout;
    for (const y of [0, WALL_HEIGHT]) for (const x of [floor.minX, floor.maxX]) for (const z of [floor.minZ, floor.maxZ]) points.push({ x, y, z });
    points.push({ x: layout.door.x, y: 0, z: layout.door.z });
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of points) {
      const screen = rig.project(point);
      left = Math.min(left, screen.x);
      right = Math.max(right, screen.x);
      top = Math.min(top, screen.y);
      bottom = Math.max(bottom, screen.y);
    }
    return { left, right, top, bottom, layout };
  };

  const frameFor = (office: OfficeIndex, width: number, height: number) => {
    const rig = new CameraRig();
    rig.setViewport(width, height);
    const frame = computeBuildingFrame(getOfficeLayout(office));
    rig.setFraming(frame.target, frame.height, { instant: true, fitWidth: frame.width, fill: FILL });
    return rig;
  };

  for (const office of OFFICES) {
    it(`office ${office}: fills the binding dimension and crops nothing of the building`, () => {
      for (const aspect of ASPECTS) {
        const height = 400;
        const width = Math.round(height * aspect);
        const rig = frameFor(office, width, height);
        const rect = buildingRect(rig, office);
        const fracW = (rect.right - rect.left) / width;
        const fracH = (rect.bottom - rect.top) / height;
        const label = `office ${office} @ ${aspect}`;
        // Everything of the building is on screen, with the margin split evenly.
        expect(rect.left, label).toBeGreaterThan(0);
        expect(rect.top, label).toBeGreaterThan(0);
        expect(rect.right, label).toBeLessThan(width);
        expect(rect.bottom, label).toBeLessThan(height);
        expect(Math.abs(rect.left - (width - rect.right)), label).toBeLessThan(1);
        expect(Math.abs(rect.top - (height - rect.bottom)), label).toBeLessThan(1);
        // Whichever dimension binds is filled to the target; the other one fits.
        expect(Math.max(fracW, fracH), label).toBeCloseTo(FILL, 3);
        expect(Math.min(fracW, fracH), label).toBeLessThanOrEqual(FILL + 1e-6);
      }
    });
  }

  it("frames the building, not the ground tile: scenery may crop on a wide, short canvas", () => {
    const rig = frameFor(0, 1150, 394);
    const ground = groundRect(getOfficeLayout(0));
    const corners = [
      rig.project({ x: ground.maxX, y: 0, z: ground.maxZ }),
      rig.project({ x: ground.minX, y: 0, z: ground.maxZ }),
      rig.project({ x: ground.maxX, y: 0, z: ground.minZ }),
    ];
    // The front corner of the tile (the street) runs off the bottom...
    expect(corners.some((point) => point.y > 394)).toBe(true);
    // ...and the building is drawn larger than when the whole tile had to fit across.
    const rect = buildingRect(rig, 0);
    expect((rect.bottom - rect.top) / 394).toBeCloseTo(FILL, 3);
  });
});
