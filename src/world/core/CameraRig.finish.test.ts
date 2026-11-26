import { describe, expect, it } from "vitest";
import { CameraRig } from "./CameraRig";

const makeRig = (): CameraRig => {
  const rig = new CameraRig();
  rig.setViewport(1200, 600);
  rig.setFraming({ x: 0, z: 0 }, 12, { instant: true });
  return rig;
};

describe("CameraRig.finish: a glide or a shake ends at once (the world settling a year)", () => {
  it("puts the camera where a new framing's glide would end, and nothing animates after", () => {
    const glided = makeRig();
    glided.setFraming({ x: 4, z: -3 }, 20);
    for (let n = 0; n < 200; n++) glided.update(1 / 60);

    const rig = makeRig();
    rig.setFraming({ x: 4, z: -3 }, 20);
    expect(rig.isAnimating).toBe(true);
    rig.finish();
    expect(rig.isAnimating).toBe(false);
    expect(rig.getTarget()).toEqual(glided.getTarget());
    expect(rig.zoom).toBeCloseTo(glided.zoom, 9);
    expect(rig.camera.position.toArray()).toEqual(glided.camera.position.toArray());
  });

  it("stops a shake, and does nothing when nothing moves", () => {
    const rig = makeRig();
    rig.shake(1);
    expect(rig.isAnimating).toBe(true);
    rig.finish();
    expect(rig.isAnimating).toBe(false);
    const before = rig.camera.position.toArray();
    rig.finish();
    expect(rig.camera.position.toArray()).toEqual(before);
  });
});
