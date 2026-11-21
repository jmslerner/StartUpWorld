import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CAMERA_ELEVATION, CameraRig, ZOOM_MAX, ZOOM_MIN } from "./CameraRig";

const WIDTH = 1200;
const HEIGHT = 600;

const makeRig = (options: { reducedMotion?: boolean } = {}): CameraRig => {
  const rig = new CameraRig(options);
  rig.setViewport(WIDTH, HEIGHT);
  rig.setFraming({ x: 0, z: 0 }, 12, { instant: true });
  return rig;
};

/** Step the rig in 60 fps frames for `seconds`. */
const run = (rig: CameraRig, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60);
};

/** Where three.js itself would draw a world point, in canvas pixels. */
const threeProject = (rig: CameraRig, x: number, y: number, z: number): { x: number; y: number } => {
  const ndc = new THREE.Vector3(x, y, z).project(rig.camera);
  return { x: (ndc.x * 0.5 + 0.5) * WIDTH, y: (0.5 - ndc.y * 0.5) * HEIGHT };
};

describe("CameraRig projection", () => {
  it("draws the framed ground point at the centre of the canvas", () => {
    const rig = makeRig();
    rig.setFraming({ x: 3, z: -2 }, 10, { instant: true });
    const centre = rig.project({ x: 3, y: 0, z: -2 });
    expect(centre.x).toBeCloseTo(WIDTH / 2, 6);
    expect(centre.y).toBeCloseTo(HEIGHT / 2, 6);
  });

  it("looks from +X +Y +Z: +X runs right-and-down, +Z left-and-down, +Y straight up", () => {
    const rig = makeRig();
    const origin = rig.project({ x: 0, y: 0, z: 0 });
    const alongX = rig.project({ x: 1, y: 0, z: 0 });
    const alongZ = rig.project({ x: 0, y: 0, z: 1 });
    const alongY = rig.project({ x: 0, y: 1, z: 0 });

    expect(alongX.x).toBeGreaterThan(origin.x);
    expect(alongX.y).toBeGreaterThan(origin.y);
    expect(alongZ.x).toBeLessThan(origin.x);
    expect(alongZ.y).toBeGreaterThan(origin.y);
    expect(alongY.x).toBeCloseTo(origin.x, 6);
    expect(alongY.y).toBeLessThan(origin.y);
    // True isometric: the two floor axes foreshorten identically.
    expect(alongX.x - origin.x).toBeCloseTo(origin.x - alongZ.x, 6);
    expect(alongX.y).toBeCloseTo(alongZ.y, 6);
  });

  it("sits at the isometric elevation above the point it frames", () => {
    const rig = makeRig();
    const { x, y, z } = rig.camera.position;
    expect(Math.atan2(y, Math.hypot(x, z))).toBeCloseTo(CAMERA_ELEVATION, 6);
    expect(x).toBeCloseTo(z, 6);
    expect(x).toBeGreaterThan(0);
  });

  it("agrees with three.js's own projection of the synced camera", () => {
    const rig = makeRig();
    rig.setFraming({ x: -4, z: 2.5 }, 17, { instant: true });
    rig.zoomAt(1.4, { x: 300, y: 420 });
    for (const [x, y, z] of [
      [0, 0, 0],
      [5, 0, -3],
      [-7.5, 2.6, 4],
      [1.25, 1.5, 9],
    ]) {
      const ours = rig.project({ x, y, z });
      const theirs = threeProject(rig, x, y, z);
      expect(ours.x).toBeCloseTo(theirs.x, 3);
      expect(ours.y).toBeCloseTo(theirs.y, 3);
    }
  });

  it("round-trips ground points through the screen and back", () => {
    const rig = makeRig();
    rig.setFraming({ x: 2, z: 1 }, 9, { instant: true });
    rig.zoomAt(0.8, { x: 900, y: 100 });
    for (const [x, z] of [
      [0, 0],
      [4.2, -3.3],
      [-6, 7],
    ]) {
      const ground = rig.screenToGround(rig.project({ x, y: 0, z }));
      expect(ground.x).toBeCloseTo(x, 6);
      expect(ground.z).toBeCloseTo(z, 6);
    }
    for (const [sx, sy] of [
      [0, 0],
      [WIDTH, HEIGHT],
      [333, 77],
    ]) {
      const ground = rig.screenToGround({ x: sx, y: sy });
      const screen = rig.project({ x: ground.x, y: 0, z: ground.z });
      expect(screen.x).toBeCloseTo(sx, 6);
      expect(screen.y).toBeCloseTo(sy, 6);
    }
  });

  it("shows viewHeight world units from top to bottom, whatever the canvas width", () => {
    const rig = makeRig();
    expect(rig.viewHeight).toBeCloseTo(12, 6);
    expect(rig.unitsPerPixel()).toBeCloseTo(12 / HEIGHT, 9);
    rig.setViewport(400, HEIGHT);
    expect(rig.viewHeight).toBeCloseTo(12, 6);
    expect(rig.camera.right - rig.camera.left).toBeCloseTo((12 * 400) / HEIGHT, 6);
    expect(rig.camera.top - rig.camera.bottom).toBeCloseTo(12, 6);
  });

  it("keeps the same ground point centred when the canvas is resized", () => {
    const rig = makeRig();
    rig.setFraming({ x: 3, z: 4 }, 12, { instant: true });
    rig.setViewport(500, 900);
    const centre = rig.project({ x: 3, y: 0, z: 4 });
    expect(centre.x).toBeCloseTo(250, 6);
    expect(centre.y).toBeCloseTo(450, 6);
  });

  it("widens the view on a narrow canvas so fitWidth stays visible", () => {
    const rig = makeRig();
    rig.setFraming({ x: 0, z: 0 }, 10, { instant: true, fitWidth: 16 });
    // 1200 × 600: 10 units tall already shows 20 across.
    expect(rig.viewHeight).toBeCloseTo(10, 6);
    rig.setViewport(400, 800);
    expect(rig.viewHeight).toBeCloseTo(32, 6);
    expect(rig.camera.right - rig.camera.left).toBeCloseTo(16, 6);
    expect(rig.zoom).toBe(1);
  });
});

describe("CameraRig panning", () => {
  it("keeps the grabbed ground point under the pointer", () => {
    const rig = makeRig();
    const grab = { x: 420, y: 310 };
    const ground = rig.screenToGround(grab);
    rig.panByPixels(85, -40);
    const after = rig.project({ x: ground.x, y: 0, z: ground.z });
    expect(after.x).toBeCloseTo(grab.x + 85, 6);
    expect(after.y).toBeCloseTo(grab.y - 40, 6);
  });

  it("stops the centre of the view at the bounds plus margin", () => {
    const rig = makeRig();
    rig.setBounds({ minX: -5, maxX: 5, minZ: -4, maxZ: 4 }, 1.5);
    for (let i = 0; i < 50; i += 1) rig.panByPixels(-400, 0);
    let target = rig.getTarget();
    // Dragging left moves the view toward +X and −Z until both limits are hit.
    expect(target.x).toBeCloseTo(6.5, 6);
    expect(target.z).toBeCloseTo(-5.5, 6);

    for (let i = 0; i < 50; i += 1) rig.panByPixels(0, -400);
    target = rig.getTarget();
    expect(target.x).toBeCloseTo(6.5, 6);
    expect(target.z).toBeCloseTo(5.5, 6);
  });

  it("pulls the view back inside when tighter bounds are set", () => {
    const rig = makeRig();
    rig.setFraming({ x: 20, z: -20 }, 12, { instant: true });
    rig.setBounds({ minX: -5, maxX: 5, minZ: -4, maxZ: 4 });
    expect(rig.getTarget()).toEqual({ x: 5, z: -4 });
    rig.setBounds(null);
    rig.panByPixels(-10_000, 0);
    expect(rig.getTarget().x).toBeGreaterThan(5);
  });
});

describe("CameraRig zoom", () => {
  it("clamps to the allowed range around the framing's default", () => {
    const rig = makeRig();
    rig.zoomAt(1000);
    expect(rig.zoom).toBe(ZOOM_MAX);
    expect(rig.viewHeight).toBeCloseTo(12 / ZOOM_MAX, 6);
    rig.zoomAt(1e-6);
    expect(rig.zoom).toBe(ZOOM_MIN);
    expect(rig.viewHeight).toBeCloseTo(12 / ZOOM_MIN, 6);
  });

  it("ignores nonsensical factors", () => {
    const rig = makeRig();
    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) rig.zoomAt(factor);
    expect(rig.zoom).toBe(1);
  });

  it("zooms toward the pointer: the ground under it does not move", () => {
    const rig = makeRig();
    const pointer = { x: 950, y: 140 };
    const before = rig.screenToGround(pointer);
    rig.zoomAt(1.8, pointer);
    const zoomedIn = rig.screenToGround(pointer);
    expect(zoomedIn.x).toBeCloseTo(before.x, 6);
    expect(zoomedIn.z).toBeCloseTo(before.z, 6);
    rig.zoomAt(0.4, pointer);
    const zoomedOut = rig.screenToGround(pointer);
    expect(zoomedOut.x).toBeCloseTo(before.x, 6);
    expect(zoomedOut.z).toBeCloseTo(before.z, 6);
  });

  it("zooms about the centre when no pointer is given", () => {
    const rig = makeRig();
    rig.setFraming({ x: 2, z: -1 }, 12, { instant: true });
    rig.zoomAt(2);
    expect(rig.getTarget()).toEqual({ x: 2, z: -1 });
    expect(rig.zoom).toBe(2);
  });
});

describe("CameraRig tweens", () => {
  it("glides to a new framing and lands on it exactly", () => {
    const rig = makeRig();
    rig.setFraming({ x: 8, z: -6 }, 24, { seconds: 1 });
    expect(rig.isAnimating).toBe(true);
    // The first frame of the tween must show exactly what was on screen before.
    expect(rig.viewHeight).toBeCloseTo(12, 6);
    expect(rig.getTarget()).toEqual({ x: 0, z: 0 });

    run(rig, 0.5);
    const midway = rig.getTarget();
    expect(midway.x).toBeGreaterThan(0);
    expect(midway.x).toBeLessThan(8);
    expect(midway.z).toBeLessThan(0);
    expect(midway.z).toBeGreaterThan(-6);
    expect(rig.viewHeight).toBeGreaterThan(12);
    expect(rig.viewHeight).toBeLessThan(24);

    run(rig, 0.6);
    expect(rig.isAnimating).toBe(false);
    expect(rig.getTarget()).toEqual({ x: 8, z: -6 });
    expect(rig.viewHeight).toBeCloseTo(24, 9);
    expect(rig.zoom).toBe(1);
  });

  it("moves monotonically toward the goal", () => {
    const rig = makeRig();
    rig.setFraming({ x: 10, z: 0 }, 12, { seconds: 1 });
    let previous = rig.getTarget().x;
    for (let i = 0; i < 70; i += 1) {
      rig.update(1 / 60);
      const x = rig.getTarget().x;
      expect(x).toBeGreaterThanOrEqual(previous);
      previous = x;
    }
    expect(previous).toBe(10);
  });

  it("cuts instantly when asked to, or when motion is reduced", () => {
    const rig = makeRig();
    rig.setFraming({ x: 5, z: 5 }, 20, { instant: true });
    expect(rig.isAnimating).toBe(false);
    expect(rig.getTarget()).toEqual({ x: 5, z: 5 });
    expect(rig.viewHeight).toBeCloseTo(20, 9);

    const calm = makeRig({ reducedMotion: true });
    calm.setFraming({ x: -3, z: 2 }, 30);
    expect(calm.isAnimating).toBe(false);
    expect(calm.getTarget()).toEqual({ x: -3, z: 2 });
    calm.focus({ x: 1, z: 1 }, 15, 2);
    expect(calm.isAnimating).toBe(false);
    expect(calm.getTarget()).toEqual({ x: 1, z: 1 });
  });

  it("focuses on a point without changing what reset() returns to", () => {
    const rig = makeRig();
    rig.focus({ x: 4, z: 2 }, 6, 0.5);
    run(rig, 0.6);
    expect(rig.getTarget()).toEqual({ x: 4, z: 2 });
    expect(rig.viewHeight).toBeCloseTo(6, 9);
    expect(rig.zoom).toBeCloseTo(2, 9);

    rig.reset(0.5);
    run(rig, 0.6);
    expect(rig.getTarget()).toEqual({ x: 0, z: 0 });
    expect(rig.zoom).toBe(1);
    expect(rig.viewHeight).toBeCloseTo(12, 9);
  });

  it("clamps a focus request to the zoom limits and the pan bounds", () => {
    const rig = makeRig();
    rig.setBounds({ minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
    rig.focus({ x: 50, z: -50 }, 0.1, 0.2);
    run(rig, 0.3);
    expect(rig.getTarget()).toEqual({ x: 2, z: -2 });
    expect(rig.zoom).toBe(ZOOM_MAX);
  });

  it("lets the player take over mid-tween", () => {
    const rig = makeRig();
    rig.setFraming({ x: 10, z: 10 }, 12, { seconds: 2 });
    run(rig, 0.5);
    rig.panByPixels(10, 0);
    expect(rig.isAnimating).toBe(false);
    const held = rig.getTarget();
    run(rig, 2);
    expect(rig.getTarget()).toEqual(held);
  });
});

describe("CameraRig shake", () => {
  it("jolts the rendered camera, leaves project() steady, and settles", () => {
    const rig = makeRig();
    const rest = rig.camera.position.clone();
    const anchor = rig.project({ x: 1, y: 1.6, z: 2 });

    rig.shake(1);
    let peak = 0;
    for (let i = 0; i < 12; i += 1) {
      rig.update(1 / 60);
      peak = Math.max(peak, rig.camera.position.distanceTo(rest));
      const steady = rig.project({ x: 1, y: 1.6, z: 2 });
      expect(steady.x).toBe(anchor.x);
      expect(steady.y).toBe(anchor.y);
    }
    expect(peak).toBeGreaterThan(0.01);
    // Bounded: a full-strength shake never throws the view more than a few percent.
    expect(peak).toBeLessThan(rig.viewHeight * 0.05);

    run(rig, 1.5);
    expect(rig.isAnimating).toBe(false);
    expect(rig.camera.position.distanceTo(rest)).toBe(0);
  });

  it("does nothing under reduced motion", () => {
    const rig = makeRig({ reducedMotion: true });
    const rest = rig.camera.position.clone();
    rig.shake(1);
    run(rig, 0.2);
    expect(rig.isAnimating).toBe(false);
    expect(rig.camera.position.distanceTo(rest)).toBe(0);
  });
});

describe("CameraRig revision", () => {
  it("changes only when the view changes", () => {
    const rig = makeRig();
    const start = rig.revision;
    rig.update(1 / 60);
    rig.setViewport(WIDTH, HEIGHT);
    rig.zoomAt(1);
    expect(rig.revision).toBe(start);
    rig.panByPixels(5, 0);
    expect(rig.revision).toBeGreaterThan(start);
  });
});
