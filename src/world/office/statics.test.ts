import * as THREE from "three";
import { afterEach, expect, it } from "vitest";
import { disposeSharedResources, LOOKS, PHASES } from "../core/palette";
import { dressOffice } from "./dressing";
import { getOfficeLayout } from "./layouts";
import type { PropHandle } from "./props/shared";
import { StageKit } from "./StageKit";

const meshesUnder = (root: THREE.Object3D): number => {
  let count = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) count += 1;
  });
  return count;
};
afterEach(() => disposeSharedResources());

// The full floor's dressing was 41 meshes before the merge. What is left beside the merged still things belongs to
// props that glow (meeting pod, reception, two arcade cabinets, vending machine, neon sign, street lamp: 19 meshes),
// which must stay whole for setGlow, so the bound is 21.
it("dresses each office with its still things merged: the full floor in at most 21 meshes in every look", () => {
  for (const look of LOOKS)
    for (const office of PHASES) {
      const kit = new StageKit(getOfficeLayout(office), look);
      dressOffice(kit);
      const drawn = meshesUnder(kit.contents);
      if (office === 3) expect(drawn, `${look}`).toBeLessThanOrEqual(21);
      expect(meshesUnder(kit.statics), `${look} ${office}`).toBeLessThanOrEqual(12);
      kit.dispose();
    }
});

const under = (object: THREE.Object3D, ancestor: THREE.Object3D): boolean => {
  for (let o = object.parent; o !== null; o = o.parent) if (o === ancestor) return true;
  return false;
};

it("leaves every prop that animates or glows where it was, and pops the still ones in as one", () => {
  const kit = new StageKit(getOfficeLayout(3), "winter-ai");
  // Record every handle the dressing places, by the way it was placed.
  const moving: PropHandle[] = [];
  const still: PropHandle[] = [];
  const place = kit.place.bind(kit);
  const placeStatic = kit.placeStatic.bind(kit);
  kit.place = (handle, spot) => {
    moving.push(handle);
    return place(handle, spot);
  };
  kit.placeStatic = (handle, spot) => {
    still.push(handle);
    return placeStatic(handle, spot);
  };
  dressOffice(kit);
  expect(still.length).toBeGreaterThan(0);
  for (const handle of [...moving, ...still]) {
    const lives = handle.update !== undefined || handle.setGlow !== undefined;
    if (lives) {
      expect(under(handle.group, kit.contents), handle.group.name).toBe(true);
      expect(under(handle.group, kit.statics), handle.group.name).toBe(false);
    } else {
      // A still prop went through placeStatic and its meshes now live in the merged group, not in the scene.
      expect(still).toContain(handle);
      expect(under(handle.group, kit.root), handle.group.name).toBe(false);
    }
  }
  expect(still.map((handle) => handle.group.name)).toContain("ping-pong"); // office 3's ping-pong table is still
  expect(kit.statics.children.every((child) => (child as THREE.Mesh).isMesh || child.name === "structure:merged")).toBe(true);
  expect(kit.entrances.filter((entrance) => entrance === kit.statics)).toHaveLength(1);
  const merged = meshesUnder(kit.statics);
  kit.mergeStatics(); // a second call changes nothing
  expect(meshesUnder(kit.statics)).toBe(merged);
  expect(kit.entrances.filter((entrance) => entrance === kit.statics)).toHaveLength(1);
  kit.dispose();
});
