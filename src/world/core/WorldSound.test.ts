import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { WorldFootstepsCue, WorldSoundCue, WorldSoundListener } from "../types";
import { CameraRig } from "./CameraRig";
import { SOUND_PAN_SPREAD, WorldSound } from "./WorldSound";

const WIDTH = 1200;
const HEIGHT = 600;

const harness = (listener: WorldSoundListener | null) => {
  const rig = new CameraRig();
  rig.setViewport(WIDTH, HEIGHT);
  rig.setFraming({ x: 0, z: 0 }, 12, { instant: true });
  const lighting = { duskAmount: 0, daylight: 1 };
  const world = { disposed: false };
  const sound = new WorldSound(listener, rig.camera, lighting, () => world.disposed);
  /** The ground point drawn at canvas x `px`, halfway down. */
  const groundAt = (px: number) => rig.screenToGround({ x: px, y: HEIGHT / 2 });
  return { rig, lighting, world, sound, groundAt };
};

describe("WorldSound", () => {
  it("places footsteps, a chair and a bubble in stereo by where the camera draws them, never hard in one ear", () => {
    const footsteps: WorldFootstepsCue[] = [];
    const chairs: WorldSoundCue[] = [];
    const bubbles: WorldSoundCue[] = [];
    const h = harness({
      onFootsteps: (cue) => footsteps.push(cue),
      onChairSit: (cue) => chairs.push(cue),
      onBubble: (cue) => bubbles.push(cue),
    });
    const centre = h.groundAt(WIDTH / 2);
    const halfRight = h.groundAt(WIDTH * 0.75);
    const farLeft = h.groundAt(-10 * WIDTH);

    h.sound.sink()?.footsteps(centre, halfRight, 6, 1);
    h.sound.sink()?.chairSit(farLeft);
    // A bubble shows over a head: only where it stands on the ground counts.
    h.sound.bubbleSink()?.(new THREE.Vector3(halfRight.x, 1.7, halfRight.z));

    expect(footsteps).toHaveLength(1);
    expect(footsteps[0].steps).toBe(6);
    expect(footsteps[0].approach).toBe(1);
    expect(footsteps[0].pan).toBeCloseTo(0, 9);
    expect(footsteps[0].panTo).toBeCloseTo(0.5 * SOUND_PAN_SPREAD, 9);
    expect(chairs).toEqual([{ pan: -SOUND_PAN_SPREAD }]);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].pan).toBeCloseTo(0.5 * SOUND_PAN_SPREAD, 9);
  });

  it("gives the systems no sink when nobody hears footsteps or chairs, and the effects no hook when nobody hears bubbles", () => {
    expect(harness(null).sound.sink()).toBeUndefined();
    expect(harness(null).sound.bubbleSink()).toBeUndefined();
    expect(harness({ onBubble: () => {}, onDusk: () => {} }).sound.sink()).toBeUndefined();
    expect(harness({ onChairSit: () => {} }).sound.sink()).toBeDefined();
    expect(harness({ onFootsteps: () => {} }).sound.sink()).toBeDefined();
    expect(harness({ onFootsteps: () => {}, onChairSit: () => {} }).sound.bubbleSink()).toBeUndefined();
  });

  it("passes the time of day on when it has moved noticeably, and on reaching either end", () => {
    const heard: number[] = [];
    const h = harness({ onDusk: (amount) => heard.push(amount) });
    for (const dusk of [0, 0, 0.01, 0.025, 0.03, 0.99, 1, 1, 0.5, 0.49, 0.01, 0, 0]) {
      h.lighting.duskAmount = dusk;
      h.sound.reportDusk();
    }
    expect(heard).toEqual([0, 0.025, 0.99, 1, 0.5, 0.01, 0]);
  });

  it("keeps whatever the listener does wrong out of the world, and tells it nothing once the world is disposed", () => {
    const heard: string[] = [];
    const h = harness({
      onFootsteps: () => {
        throw new Error("a broken listener");
      },
      onChairSit: () => heard.push("chair"),
      onBubble: () => heard.push("bubble"),
      onDusk: () => heard.push("dusk"),
    });
    const sink = h.sound.sink();
    expect(() => sink?.footsteps({ x: 0, z: 0 }, { x: 1, z: 1 }, 4, -1)).not.toThrow();
    sink?.chairSit({ x: 0, z: 0 });
    h.sound.bubbleSink()?.(new THREE.Vector3());
    h.sound.reportDusk();
    expect(heard).toEqual(["chair", "bubble", "dusk"]);

    h.world.disposed = true;
    sink?.chairSit({ x: 0, z: 0 });
    h.sound.bubbleSink()?.(new THREE.Vector3());
    h.lighting.duskAmount = 1;
    h.sound.reportDusk();
    expect(heard).toEqual(["chair", "bubble", "dusk"]);
  });
});
