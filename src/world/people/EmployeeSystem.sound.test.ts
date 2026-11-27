import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { disposeSharedResources } from "../core/palette";
import type { FxApi, InteractableRegistry, Vec2, WorldSignals, WorldSoundSink } from "../types";
import { EmployeeSystem } from "./EmployeeSystem";
import type { PeopleContext } from "./EmployeeSystem";
import { scene, Studio } from "./testKit";

const NO_FX: FxApi = { burst() {}, stream() {}, floatText() {}, bubble() {}, shake() {} };
const NO_REGISTRY: InteractableRegistry = { register() {}, unregister() {} };

interface Heard {
  readonly footsteps: Array<{ from: Vec2; to: Vec2; steps: number; approach: number }>;
  readonly chairs: Vec2[];
}

const harness = (options: { reducedMotion?: boolean; sound?: boolean } = {}) => {
  const studio = new Studio();
  const signals: WorldSignals = { doorTraffic: 0 };
  const heard: Heard = { footsteps: [], chairs: [] };
  const sound: WorldSoundSink = {
    footsteps: (from, to, steps, approach) => heard.footsteps.push({ from: { ...from }, to: { ...to }, steps, approach }),
    chairSit: (at) => heard.chairs.push({ ...at }),
  };
  const ctx: PeopleContext = {
    scene: new THREE.Scene(),
    reducedMotion: options.reducedMotion ?? false,
    interactables: NO_REGISTRY,
    fx: NO_FX,
    seating: studio.seating,
    signals,
    getLayout: () => studio.layout,
    ...(options.sound === false ? {} : { sound }),
  };
  const system = new EmployeeSystem(ctx);
  let elapsed = 0;
  return {
    heard,
    studio,
    system,
    apply(teams: readonly [number, number, number]) {
      const frame = studio.frame(scene(teams));
      system.applyFrame(frame.next, frame.prev);
    },
    run(seconds: number) {
      for (let i = 0; i < Math.round(seconds * 60); i += 1) {
        elapsed += 1 / 60;
        system.update(1 / 60, elapsed);
      }
    },
  };
};

afterEach(() => disposeSharedResources());

describe("EmployeeSystem: the sounds only the people can time", () => {
  it("a hire walking in is heard arriving, once, and sits down with a chair's sound at their desk", () => {
    const h = harness();
    h.apply([1, 0, 0]);
    h.run(80);
    expect(h.heard.footsteps).toEqual([]);
    h.apply([2, 0, 0]);
    h.run(80);
    expect(h.heard.footsteps).toHaveLength(1);
    const [walk] = h.heard.footsteps;
    expect(walk.approach).toBe(1);
    expect(walk.steps).toBeGreaterThanOrEqual(1);
    expect(walk.steps).toBeLessThanOrEqual(6);
    const seat = h.studio.seating.seatOf("p1");
    expect(walk.to).toEqual({ x: seat?.x, z: seat?.z });
    const door = h.studio.layout.door;
    expect(Math.hypot(walk.from.x - door.x, walk.from.z - door.z)).toBeLessThan(1.2);
    expect(h.heard.chairs).toEqual([{ x: seat?.x, z: seat?.z }]);
  });

  it("somebody leaving is heard walking away toward the door, with no chair", () => {
    const h = harness();
    h.apply([2, 0, 0]);
    h.run(80);
    h.apply([1, 0, 0]);
    h.run(80);
    expect(h.heard.footsteps).toHaveLength(1);
    expect(h.heard.footsteps[0].approach).toBe(-1);
    expect(h.heard.footsteps[0].to).toEqual({ x: h.studio.layout.door.x, z: h.studio.layout.door.z });
    expect(h.heard.chairs).toEqual([]);
  });

  it("people placed without a walk (the first scene, reduced motion) make no sound", () => {
    const first = harness();
    first.apply([3, 1, 0]);
    first.run(80);
    expect(first.heard).toEqual({ footsteps: [], chairs: [] });
    const still = harness({ reducedMotion: true });
    still.apply([1, 0, 0]);
    still.apply([3, 0, 0]);
    still.run(80);
    expect(still.heard).toEqual({ footsteps: [], chairs: [] });
  });

  it("without a sound sink the people walk in as before", () => {
    const h = harness({ sound: false });
    h.apply([1, 0, 0]);
    h.apply([2, 0, 0]);
    h.run(80);
    expect(h.system.figureCount).toBe(2);
    expect(h.system.busy()).toBe(false);
  });
});
