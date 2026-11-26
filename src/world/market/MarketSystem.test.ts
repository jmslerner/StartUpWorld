import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { targetKey } from "../targets";
import type { InteractableOptions, InteractableRegistry, InteractableTarget, MarketCompany, MarketScene, MarketSeatState } from "../types";
import { MARKET_DRAW_CEILING } from "./marketLayout";
import { MarketSystem } from "./MarketSystem";

interface Entry {
  object: THREE.Object3D;
  target: InteractableTarget;
  options: InteractableOptions;
}

/** Mirrors the real registry's rules: one entry per object, one per target key (the newer wins). */
class RecordingRegistry implements InteractableRegistry {
  readonly entries = new Map<THREE.Object3D, Entry>();

  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void {
    const key = targetKey(target);
    for (const [other, entry] of this.entries) {
      if (other !== object && targetKey(entry.target) === key) this.entries.delete(other);
    }
    this.entries.set(object, { object, target, options });
  }

  unregister(object: THREE.Object3D): void {
    this.entries.delete(object);
  }

  /** What the world's clearRegistry does after a new run: forget everything at once. */
  clear(): void {
    this.entries.clear();
  }

  /** The registered targets' keys, in the order they were registered. */
  keys(): string[] {
    return [...this.entries.values()].map((entry) => targetKey(entry.target));
  }

  labels(): string[] {
    return [...this.entries.values()].map((entry) => entry.options.label);
  }
}

const company = (seat: number, height: number, won: number, state: MarketSeatState = seat === 0 ? "player" : "rival"): MarketCompany =>
  ({ seat, name: `C${seat}`, state, users: Math.round(height * 100), height, won, listed: false, newcomer: false });
const scene = (companies: MarketCompany[], bar = 0.5): MarketScene =>
  ({ runId: "r", year: 2000, era: "bust", barUsers: 100, bar, pool: 100, companies });

describe("the market system", () => {
  it("registers each company still in the market while active, with its name, and none while not", () => {
    const registry = new RecordingRegistry();
    const market = new MarketSystem({ interactables: registry, reducedMotion: false });
    market.show(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0, 0, "out")]));
    expect(registry.keys()).toEqual([]);
    market.setActive(true);
    expect(registry.keys()).toEqual(["company:0", "company:1", "company:2"]);
    expect(registry.labels().sort()).toEqual(["C0", "C1", "C2"]);
    market.setActive(false);
    expect(registry.keys()).toEqual([]);
    // What World does after a new run cleared the registry while the market showed: off and on brings the targets back.
    market.setActive(true);
    registry.clear();
    market.setActive(false);
    market.setActive(true);
    expect(registry.keys()).toEqual(["company:0", "company:1", "company:2"]);
    market.dispose();
  });

  it("streams the users when it becomes active and then rests; under reduced motion it rests at once", () => {
    const moving = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: false });
    moving.show(scene([company(0, 0.2, 0.5), company(1, 1, 0.5), company(2, 0.5, 0), company(3, 0.1, 0)]));
    moving.setActive(true);
    expect(moving.busy()).toBe(true);
    for (let i = 0; i < 300; i++) moving.update(1 / 60, i / 60);
    expect(moving.busy()).toBe(false);
    const still = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: true });
    still.show(scene([company(0, 0.2, 0.5), company(1, 1, 0.5), company(2, 0.5, 0), company(3, 0.1, 0)]));
    still.setActive(true);
    expect(still.busy()).toBe(false);
    moving.dispose();
    still.dispose();
  });

  it("draws within its ceiling, the same scene again builds nothing, and disposing leaves nothing", () => {
    const market = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: true });
    const shown = scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0.1, 0.2)]);
    market.show(shown);
    const first = market.root.children.slice();
    market.show(shown);
    expect(market.root.children).toEqual(first);
    expect(market.meshCount()).toBeLessThanOrEqual(MARKET_DRAW_CEILING / 2); // halved: each may also be drawn in the shadow pass
    market.dispose();
    expect(market.root.children).toEqual([]);
  });
});
