import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { StageMotion } from "./motion";

const FRAME = 1 / 60;

describe("StageMotion", () => {
  it("pops an object from nothing to its resting scale", () => {
    const motion = new StageMotion();
    const object = new THREE.Object3D();
    object.scale.set(2, 2, 2);
    motion.pop(object, 0.1, 0.3);
    expect(object.scale.x).toBeLessThan(0.01);
    motion.update(0.05);
    expect(object.scale.x).toBeLessThan(0.01);
    for (let i = 0; i < 30; i += 1) motion.update(FRAME);
    expect(object.scale.x).toBeCloseTo(2, 6);
    expect(motion.busy).toBe(false);
  });

  it("raises an object into place and sinks one away, calling back once", () => {
    const motion = new StageMotion();
    const rising = new THREE.Object3D();
    rising.position.y = 0.5;
    motion.rise(rising, 2, 0, 0.4);
    expect(rising.position.y).toBeCloseTo(-1.5, 6);
    expect(rising.visible).toBe(false);

    const sinking = new THREE.Object3D();
    let done = 0;
    motion.sink(sinking, 3, 0.4, () => {
      done += 1;
    });
    for (let i = 0; i < 40; i += 1) motion.update(FRAME);
    expect(rising.position.y).toBeCloseTo(0.5, 6);
    expect(rising.visible).toBe(true);
    expect(sinking.position.y).toBeCloseTo(-3, 6);
    expect(done).toBe(1);
  });

  it("can be cut short", () => {
    const motion = new StageMotion();
    const object = new THREE.Object3D();
    let done = false;
    motion.pop(object, 5);
    motion.sink(new THREE.Object3D(), 1, 5, () => {
      done = true;
    });
    motion.finishAll();
    expect(object.scale.x).toBe(1);
    expect(done).toBe(true);
    expect(motion.busy).toBe(false);
  });
});
