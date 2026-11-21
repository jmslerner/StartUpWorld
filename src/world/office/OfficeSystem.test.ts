import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ASSET_CATALOG } from "../../engine/assets";
import { createInitialState } from "../../engine";
import type { AssetId, CompanyPhase, GameState, TeamRole } from "../../types/game";
import { SeatingPlan } from "../people/seating";
import { buildWorldSnapshot } from "../snapshot";
import { targetKey } from "../targets";
import type {
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  OfficeLayout,
  WorldContext,
  WorldSignals,
  WorldEvent,
  WorldSnapshot,
} from "../types";
import { priceLabel } from "./AssetSlots";
import { CHAIR_PULL, CHAIR_TUCK, EMPTY_DESK_LABEL, MAX_VACANT_MARKERS } from "./DeskSlots";
import { createDecorProp } from "./dressing";
import {
  ASSET_IDS,
  DECOR_SIZES,
  decorSize,
  getLayoutDecor,
  getOfficeLayout,
  groundRect,
  STATION_KINDS,
} from "./layouts";
import type { DecorKind } from "./layouts";
import { StageMotion } from "./motion";
import { BEACON_LABEL, DOOR_LABEL, LOW_RUNWAY_WEEKS, STATION_LABELS } from "./OfficeStage";
import { OfficeSystem } from "./OfficeSystem";

// ─────────────────────────────────────────────────────────────────────────────
// A world small enough for node: a scene, a recording registry, real seating
// ─────────────────────────────────────────────────────────────────────────────

const PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];
const FRAME = 1 / 60;

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

  keys(): string[] {
    return [...this.entries.values()].map((entry) => targetKey(entry.target)).sort();
  }

  find(key: string): Entry | undefined {
    return [...this.entries.values()].find((entry) => targetKey(entry.target) === key);
  }

  ofKind<K extends InteractableTarget["kind"]>(kind: K): Entry[] {
    return [...this.entries.values()].filter((entry) => entry.target.kind === kind);
  }
}

interface StateOptions {
  phase?: CompanyPhase;
  team?: Partial<Record<TeamRole, number>>;
  assets?: AssetId[];
  event?: boolean;
  setup?: boolean;
  companyName?: string;
  seed?: number;
}

const makeState = (options: StateOptions = {}): GameState => {
  const base = createInitialState();
  const setup = options.setup ?? true;
  return {
    ...base,
    seed: options.seed ?? 1234,
    companyName: setup ? (options.companyName ?? "Test Labs") : "",
    founder: { name: setup ? "Robin" : "", archetype: setup ? "hacker" : null },
    cofounder: { ...base.cofounder, name: "Sam", archetype: setup ? "operator" : null },
    companyPhase: options.phase ?? "garage",
    team: { ...base.team, engineering: 0, ...options.team },
    assets: (options.assets ?? []).map((id) => ({ id, name: ASSET_CATALOG[id].name, purchaseWeek: 1 })),
    pendingEvent: options.event
      ? { id: "test", title: "A journalist is on the line", prompt: "Well?", choices: [{ id: "a", text: "Talk" }] }
      : null,
  };
};

/** Drives an OfficeSystem the way core/World.ts does: layout, then seating, then the system. */
class Harness {
  readonly scene = new THREE.Scene();
  readonly registry = new RecordingRegistry();
  readonly seating = new SeatingPlan();
  readonly signals: WorldSignals = { doorTraffic: 0 };
  readonly system: OfficeSystem;
  layout: OfficeLayout = getOfficeLayout("garage");
  previous: WorldSnapshot | null = null;
  private elapsed = 0;

  constructor(reducedMotion = false) {
    const ctx: WorldContext = {
      scene: this.scene,
      camera: new THREE.OrthographicCamera(),
      quality: "high",
      reducedMotion,
      interactables: this.registry,
      fx: { burst: () => undefined, stream: () => undefined, floatText: () => undefined, bubble: () => undefined, shake: () => undefined },
      seating: this.seating,
      signals: this.signals,
      getLayout: () => this.layout,
      focusCamera: () => undefined,
    };
    this.system = new OfficeSystem(ctx);
  }

  apply(options: StateOptions, events: WorldEvent[] = [], tweak?: (snapshot: WorldSnapshot) => WorldSnapshot): WorldSnapshot {
    const built = buildWorldSnapshot(makeState(options));
    const next = tweak ? tweak(built) : built;
    this.layout = getOfficeLayout(next.phase, next.ownedAssets);
    // Same rule as World: nobody but the founder is in the office until setup is done.
    const roster = next.setupComplete ? next.people : next.people.filter((person) => person.kind === "founder");
    this.seating.reconcile(roster, next.setupComplete ? next.hiddenPeople : 0, this.layout);
    this.system.applySnapshot(next, this.previous, events);
    this.previous = next;
    return next;
  }

  run(seconds: number): void {
    for (let t = 0; t < seconds; t += FRAME) {
      this.elapsed += FRAME;
      this.system.update(FRAME, this.elapsed);
    }
  }

  emptyDeskSlots(): number[] {
    return this.registry
      .ofKind("empty-desk")
      .map((entry) => (entry.target.kind === "empty-desk" ? entry.target.slotIndex : -1))
      .sort((a, b) => a - b);
  }

  /** Is the object in the scene and shown (the real registry only counts such objects)? */
  isLive(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (!node.visible) return false;
      if (node === this.scene) return true;
      node = node.parent;
    }
    return false;
  }
}

const stationKeys = STATION_KINDS.map((kind) => `station:${kind}`);

// ─────────────────────────────────────────────────────────────────────────────

describe.each(PHASES)("OfficeSystem in the %s", (phase) => {
  it("registers all eight stations and the door on the first snapshot", () => {
    const world = new Harness();
    world.apply({ phase });
    for (const key of [...stationKeys, "door"]) {
      const entry = world.registry.find(key);
      expect(entry, key).toBeDefined();
      expect(world.isLive(entry!.object), `${key} is in the scene`).toBe(true);
      expect(entry!.options.anchorHeight).toBeGreaterThan(0.5);
    }
    for (const kind of STATION_KINDS) expect(world.registry.find(`station:${kind}`)!.options.label).toBe(STATION_LABELS[kind]);
    expect(world.registry.find("door")!.options.label).toBe(DOOR_LABEL);
  });

  it("puts every station where the floor plan says", () => {
    const world = new Harness();
    world.apply({ phase });
    for (const kind of STATION_KINDS) {
      const { object } = world.registry.find(`station:${kind}`)!;
      const spot = world.layout.stations[kind];
      expect(object.position.x).toBeCloseTo(spot.x, 6);
      expect(object.position.z).toBeCloseTo(spot.z, 6);
      expect(object.rotation.y).toBeCloseTo(spot.facing, 6);
    }
  });

  it("offers exactly the free desks as empty desks", () => {
    const world = new Harness();
    world.apply({ phase, team: { engineering: 2, design: 1 } });
    expect(world.emptyDeskSlots()).toEqual(world.seating.freeDeskSlots());
    expect(world.emptyDeskSlots().length).toBe(world.layout.deskSeats.length - 3);
    for (const entry of world.registry.ofKind("empty-desk")) expect(entry.options.label).toBe(EMPTY_DESK_LABEL);
  });

  it("stands each desk's chair exactly on its seat, facing with it", () => {
    const world = new Harness();
    world.apply({ phase });
    for (const entry of world.registry.ofKind("empty-desk")) {
      const slot = entry.target.kind === "empty-desk" ? entry.target.slotIndex : -1;
      const seat = world.layout.deskSeats[slot];
      expect(entry.object.position.x).toBeCloseTo(seat.x, 6);
      expect(entry.object.position.z).toBeCloseTo(seat.z, 6);
      expect(entry.object.rotation.y).toBeCloseTo(seat.facing, 6);
    }
  });

  it("unregisters exactly the desk a new hire takes, and frees it again when they leave", () => {
    const world = new Harness();
    world.apply({ phase, team: { engineering: 1 } });
    const before = world.emptyDeskSlots();
    world.apply({ phase, team: { engineering: 1, sales: 1 } }, [{ type: "hired", role: "sales", personIds: ["sales-0"] }]);
    const taken = world.seating.seatOf("sales-0")!.slotIndex;
    expect(before).toContain(taken);
    expect(world.emptyDeskSlots()).toEqual(before.filter((slot) => slot !== taken));

    world.apply({ phase, team: { engineering: 1 } }, [{ type: "departed", role: "sales", personIds: ["sales-0"] }]);
    expect(world.emptyDeskSlots()).toEqual(before);
  });

  it("does not rebuild the office when only the head count changes", () => {
    const world = new Harness();
    world.apply({ phase });
    const stage = world.system.currentStage;
    const door = world.registry.find("door")!.object;
    world.apply({ phase, team: { engineering: 3 } });
    world.apply({ phase, team: { engineering: 3 }, event: true });
    expect(world.system.currentStage).toBe(stage);
    expect(world.registry.find("door")!.object).toBe(door);
  });

  it("shows owned assets, ghosts of those for sale, and nothing of the locked ones", () => {
    const world = new Harness();
    const snapshot = world.apply({ phase, assets: ["lounge"] });
    const stage = world.system.currentStage!;
    for (const assetId of ASSET_IDS) {
      const entry = world.registry.find(`asset:${assetId}`);
      const owned = snapshot.ownedAssets.includes(assetId);
      const forSale = snapshot.availableAssets.includes(assetId);
      expect(stage.assets.stateOf(assetId), assetId).toBe(owned ? "owned" : forSale ? "ghost" : "none");
      if (!owned && !forSale) {
        expect(entry, `${assetId} is locked`).toBeUndefined();
        continue;
      }
      expect(entry, assetId).toBeDefined();
      expect(entry!.options.label).toBe(ASSET_CATALOG[assetId].name);
      const anchor = world.layout.assetAnchors[assetId];
      expect(entry!.object.position.x).toBeCloseTo(anchor.x, 6);
      expect(entry!.object.position.z).toBeCloseTo(anchor.z, 6);
      // A blueprint wraps the prop in its own group; the real thing is the prop itself.
      expect(entry!.object.name === "blueprint").toBe(!owned);
    }
    expect(stage.assets.stateOf("lounge")).toBe("owned");
  });

  it("raises the event beacon while an event is pending and takes it down afterwards", () => {
    const world = new Harness();
    world.apply({ phase });
    expect(world.registry.find("event-beacon")).toBeUndefined();
    world.apply({ phase, event: true }, [{ type: "event-opened", title: "A journalist is on the line" }]);
    const beacon = world.registry.find("event-beacon");
    expect(beacon).toBeDefined();
    expect(beacon!.options.label).toBe(BEACON_LABEL);
    expect(world.isLive(beacon!.object)).toBe(true);
    world.apply({ phase }, [{ type: "event-resolved" }]);
    expect(world.registry.find("event-beacon")).toBeUndefined();
    expect(beacon!.object.parent).toBeNull();
  });

  it("stays quiet before setup is complete and after the run has ended", () => {
    const world = new Harness();
    world.apply({ phase, setup: false, event: true }, [], (snapshot) => ({ ...snapshot, runwayWeeks: 1 }));
    const stage = world.system.currentStage!;
    expect(world.registry.find("event-beacon")).toBeUndefined();
    expect(stage.desks.visibleMarkers()).toBe(0);
    expect(stage.alarmActive).toBe(false);
    // Desks are still there to be clicked; they just do not wave.
    expect(world.emptyDeskSlots()).toEqual(world.seating.freeDeskSlots());

    world.apply({ phase, event: true }, [{ type: "setup-completed" }], (snapshot) => ({ ...snapshot, runwayWeeks: 1 }));
    expect(world.registry.find("event-beacon")).toBeDefined();
    expect(stage.alarmActive).toBe(true);
    expect(stage.desks.visibleMarkers()).toBeGreaterThan(0);

    world.apply({ phase, event: true }, [{ type: "game-over", ending: "bankruptcy" }], (snapshot) => ({
      ...snapshot,
      runwayWeeks: 0,
      gameOver: "bankruptcy",
    }));
    expect(world.registry.find("event-beacon")).toBeUndefined();
    expect(stage.alarmActive).toBe(false);
    expect(stage.desks.visibleMarkers()).toBe(0);
  });

  it("shows at most a handful of vacant markers however many desks are free", () => {
    const world = new Harness();
    world.apply({ phase });
    const free = world.seating.freeDeskSlots().length;
    expect(world.system.currentStage!.desks.visibleMarkers()).toBe(Math.min(free, MAX_VACANT_MARKERS));
  });

  it("sounds the alarm only while the runway is short", () => {
    const world = new Harness();
    world.apply({ phase }, [], (snapshot) => ({ ...snapshot, runwayWeeks: LOW_RUNWAY_WEEKS + 1 }));
    const stage = world.system.currentStage!;
    expect(stage.alarmActive).toBe(false);
    world.apply({ phase }, [], (snapshot) => ({ ...snapshot, runwayWeeks: LOW_RUNWAY_WEEKS }));
    expect(stage.alarmActive).toBe(true);
    world.apply({ phase }, [], (snapshot) => ({ ...snapshot, runwayWeeks: 999 }));
    expect(stage.alarmActive).toBe(false);
  });

  it("seats the overflow on beanbags and counts whoever is left on the sign", () => {
    const world = new Harness();
    world.apply({ phase });
    expect(world.registry.find("overflow-sign")).toBeUndefined();

    const layout = getOfficeLayout(phase);
    const capacity = layout.deskSeats.length;
    const crowd = layout.deskSeats.length + layout.overflowSpots.length + 3;
    world.apply({ phase, team: { engineering: Math.min(crowd, 60) } });
    const hidden = world.seating.hiddenCount();
    const stage = world.system.currentStage!;
    expect(stage.desks.cushionCount()).toBe(
      layout.overflowSpots.filter((_, index) => world.seating.overflowOccupant(index) !== null).length
    );
    expect(world.emptyDeskSlots()).toEqual([]);
    if (hidden > 0) {
      const sign = world.registry.find("overflow-sign");
      expect(sign, "overflow sign").toBeDefined();
      expect(sign!.options.label).toBe(`+${hidden} more people`);
    }

    world.apply({ phase });
    expect(world.registry.find("overflow-sign")).toBeUndefined();
    expect(stage.desks.cushionCount()).toBe(0);
    expect(world.emptyDeskSlots().length).toBe(capacity);
  });

  it("leaves nothing in the scene after dispose", () => {
    const world = new Harness();
    world.apply({ phase, team: { engineering: 4 }, assets: ["office-upgrade"], event: true });
    world.run(0.2);
    world.system.dispose();
    expect(world.scene.children).toEqual([]);
    expect(world.registry.entries.size).toBe(0);
    // Idempotent, and later calls are harmless.
    world.system.dispose();
    world.system.update(FRAME, 1);
    world.apply({ phase });
    expect(world.scene.children).toEqual([]);
  });
});

describe("OfficeSystem phase changes", () => {
  it("swaps everything for the new phase and leaves no stale registrations", () => {
    const world = new Harness();
    world.apply({ phase: "garage", team: { engineering: 2 }, event: true });
    const oldObjects = new Set(world.registry.entries.keys());
    const oldStage = world.system.currentStage!;

    world.apply({ phase: "coworking", team: { engineering: 2 }, event: true }, [{ type: "phase-changed", from: "garage", to: "coworking" }]);
    const stage = world.system.currentStage!;
    expect(stage).not.toBe(oldStage);
    expect(stage.phase).toBe("coworking");
    for (const object of world.registry.entries.keys()) expect(oldObjects.has(object)).toBe(false);
    for (const key of [...stationKeys, "door", "event-beacon"]) expect(world.registry.find(key), key).toBeDefined();
    expect(world.emptyDeskSlots()).toEqual(world.seating.freeDeskSlots());
    // One entry per target: nothing is registered twice.
    expect(new Set(world.registry.keys()).size).toBe(world.registry.entries.size);

    // The old office is still sinking away; once the transition is over only the new one remains.
    const root = world.scene.children[0];
    expect(root.children).toContain(oldStage.root);
    world.run(1.3);
    expect(root.children).toEqual([stage.root]);
    for (const entry of world.registry.entries.values()) expect(world.isLive(entry.object)).toBe(true);
  });

  it("finishes the transition within 1.2 seconds, with every piece at its resting size", () => {
    const world = new Harness();
    world.apply({ phase: "office", team: { engineering: 6 } });
    world.apply({ phase: "unicorn", team: { engineering: 6 } }, [{ type: "phase-changed", from: "office", to: "unicorn" }]);
    const stage = world.system.currentStage!;
    world.run(0.1);
    // Mid-transition the new contents have not popped in yet.
    expect(stage.kit.entrances.some((object) => object.scale.x < 0.01)).toBe(true);
    world.run(1.1);
    expect(stage.kit.structure.position.y).toBeCloseTo(0, 6);
    expect(stage.kit.structure.visible).toBe(true);
    for (const object of stage.kit.entrances) {
      expect(Math.abs(object.scale.x)).toBeGreaterThan(0.4);
      expect(object.scale.y).toBeGreaterThan(0.4);
    }
  });

  it("builds instantly on the first snapshot and under reduced motion", () => {
    const first = new Harness();
    first.apply({ phase: "office" });
    const stage = first.system.currentStage!;
    expect(stage.kit.structure.position.y).toBe(0);
    for (const object of stage.kit.entrances) expect(object.scale.y).toBeGreaterThan(0.4);

    const calm = new Harness(true);
    calm.apply({ phase: "garage" });
    calm.apply({ phase: "coworking" }, [{ type: "phase-changed", from: "garage", to: "coworking" }]);
    const root = calm.scene.children[0];
    expect(root.children).toEqual([calm.system.currentStage!.root]);
    expect(calm.system.currentStage!.kit.structure.position.y).toBe(0);
  });

  it("survives phases flipping back and forth mid-transition", () => {
    const world = new Harness();
    world.apply({ phase: "garage" });
    world.apply({ phase: "coworking" }, [{ type: "phase-changed", from: "garage", to: "coworking" }]);
    world.run(0.1);
    world.apply({ phase: "garage" }, [{ type: "phase-changed", from: "coworking", to: "garage" }]);
    world.run(0.1);
    world.apply({ phase: "office" }, [{ type: "phase-changed", from: "garage", to: "office" }]);
    world.run(1.5);
    const root = world.scene.children[0];
    expect(root.children).toEqual([world.system.currentStage!.root]);
    expect(world.system.currentStage!.phase).toBe("office");
    expect(world.emptyDeskSlots()).toEqual(world.seating.freeDeskSlots());
  });

  it("rebuilds cleanly on a run reset", () => {
    const world = new Harness();
    world.apply({ phase: "office", team: { engineering: 5 }, assets: ["lounge"] });
    const oldStage = world.system.currentStage;
    world.seating.reset();
    world.apply({ phase: "office", seed: 99, setup: false }, [{ type: "run-reset" }]);
    expect(world.system.currentStage).not.toBe(oldStage);
    const root = world.scene.children[0];
    expect(root.children).toEqual([world.system.currentStage!.root]);
    expect(world.system.currentStage!.assets.stateOf("lounge")).toBe("ghost");
  });
});

describe("OfficeSystem assets", () => {
  it("swaps the blueprint for the real thing when an asset is bought", () => {
    const world = new Harness();
    world.apply({ phase: "office" });
    const ghost = world.registry.find("asset:helicopter")!;
    expect(ghost.object.name).toBe("blueprint");

    world.apply({ phase: "office", assets: ["helicopter"] }, [{ type: "asset-acquired", assetId: "helicopter" }]);
    const real = world.registry.find("asset:helicopter")!;
    expect(real.object).not.toBe(ghost.object);
    expect(ghost.object.parent).toBeNull();
    expect(world.system.currentStage!.assets.stateOf("helicopter")).toBe("owned");
    // It lands with a bounce: tiny at first, full size shortly after.
    expect(real.object.scale.x).toBeLessThan(0.01);
    world.run(0.6);
    expect(real.object.scale.x).toBeCloseTo(1, 6);
  });

  it("upgrades the coffee machine and the desks with the office upgrade, keeping who sits where", () => {
    const world = new Harness();
    world.apply({ phase: "coworking", team: { engineering: 3 } });
    const stage = world.system.currentStage;
    const coffee = world.registry.find("station:coffee")!.object;
    const free = world.emptyDeskSlots();

    world.apply({ phase: "coworking", team: { engineering: 3 }, assets: ["office-upgrade"] }, [
      { type: "asset-acquired", assetId: "office-upgrade" },
    ]);
    expect(world.system.currentStage).toBe(stage);
    expect(world.registry.find("station:coffee")!.object).not.toBe(coffee);
    expect(coffee.parent).toBeNull();
    expect(world.emptyDeskSlots()).toEqual(free);
    expect(world.registry.find("asset:office-upgrade")!.object.name).not.toBe("blueprint");
  });

  it("lays paving under assets parked beyond the ground tile", () => {
    const world = new Harness();
    world.apply({ phase: "unicorn" });
    const stage = world.system.currentStage!;
    const ground = groundRect(world.layout);
    const bounds = new THREE.Box3().setFromObject(stage.kit.structure);
    // Jet and helipad stand off +Z, the yacht off +X: the structure has grown to carry them.
    expect(bounds.max.z).toBeGreaterThan(ground.maxZ + 4);
    expect(bounds.max.x).toBeGreaterThan(ground.maxX + 3);
  });

  it("prints prices the way the terminal abbreviates them", () => {
    expect(priceLabel("office-upgrade")).toBe("$50K");
    expect(priceLabel("jet")).toBe("$2M");
  });
});

describe("OfficeSystem reactions", () => {
  it("keeps the stations in step with the snapshot", () => {
    const world = new Harness();
    world.apply({ phase: "office" }, [], (snapshot) => ({ ...snapshot, week: 7, reputation: 50, users: 1000 }));
    const { stations } = world.system.currentStage!;
    expect(stations.ship.maxNotes).toBeGreaterThan(0);
    // No throw, and animation keeps running, through a week change and both ship outcomes.
    world.apply({ phase: "office" }, [{ type: "week-advanced", week: 8 }, { type: "ship", ok: true, reputationDelta: 3 }], (snapshot) => ({
      ...snapshot,
      week: 8,
    }));
    world.run(0.5);
    world.apply({ phase: "office" }, [{ type: "ship", ok: false, reputationDelta: -2 }, { type: "launch", ok: true, usersDelta: 40 }], (snapshot) => ({
      ...snapshot,
      week: 8,
    }));
    world.run(0.5);
    expect(world.system.currentStage!.stations).toBe(stations);
  });

  it("renames the sign without rebuilding the office", () => {
    const world = new Harness();
    world.apply({ phase: "office", companyName: "First Name" });
    const stage = world.system.currentStage;
    const count = stage!.kit.props.size;
    world.apply({ phase: "office", companyName: "Second Name" });
    expect(world.system.currentStage).toBe(stage);
    expect(stage!.kit.props.size).toBe(count);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("floor-plan décor", () => {
  it("builds a prop that fits the floor area its plan reserves", () => {
    for (const phase of PHASES) {
      for (const spot of getLayoutDecor(getOfficeLayout(phase))) {
        const prop = createDecorProp(phase, spot);
        const reserved = decorSize(spot);
        // A little overhang is tolerated (leaves, chair legs); people keep 0.25 clear of footprints anyway.
        expect(prop.footprint.w, `${phase} ${spot.kind} width`).toBeLessThanOrEqual(reserved.width + 0.1);
        expect(prop.footprint.d, `${phase} ${spot.kind} depth`).toBeLessThanOrEqual(reserved.depth + 0.1);
        prop.dispose();
      }
    }
  });

  it("has a size for every kind and gives every phase some", () => {
    for (const kind of Object.keys(DECOR_SIZES) as DecorKind[]) {
      expect(DECOR_SIZES[kind].width).toBeGreaterThan(0);
      expect(DECOR_SIZES[kind].depth).toBeGreaterThan(0);
    }
    for (const phase of PHASES) expect(getLayoutDecor(getOfficeLayout(phase)).length).toBeGreaterThan(0);
  });
});

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

describe("OfficeSystem at the end of a run", () => {
  const LOSS: WorldEvent[] = [{ type: "game-over", ending: "bankruptcy" }];

  it("takes the for-sale blueprints down, keeps what was owned", () => {
    const world = new Harness();
    world.apply({ phase: "office", assets: ["lounge"] });
    const stage = world.system.currentStage!;
    expect(stage.assets.stateOf("helicopter")).toBe("ghost");
    world.apply({ phase: "office", assets: ["lounge"] }, LOSS, (snapshot) => ({ ...snapshot, gameOver: "bankruptcy" }));
    expect(stage.assets.stateOf("helicopter")).toBe("none");
    expect(world.registry.find("asset:helicopter")).toBeUndefined();
    expect(stage.assets.stateOf("lounge")).toBe("owned");
  });

  it("darkens the desks of the people who have gone home, and tucks their chairs in", () => {
    const world = new Harness();
    const team = { engineering: 3 };
    world.apply({ phase: "office", team });
    const stage = world.system.currentStage!;
    const taken = [0, 1, 2].map((slot) => world.seating.deskOccupant(slot));
    expect(taken.every((id) => id !== null)).toBe(true);
    // As the people system would publish it: everyone in their chair.
    const chairs = new Map<number, number>([
      [-1, 0],
      [-2, 0],
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    world.signals.chairsOut = chairs;
    world.run(0.5);
    expect(stage.desks.isLit(0)).toBe(true);
    expect(stage.desks.chairOffset(0)).toBeCloseTo(0, 3);
    // Somebody getting up: their chair rolls back.
    chairs.set(1, 1);
    world.run(0.5);
    expect(stage.desks.chairOffset(1)).toBeCloseTo(-CHAIR_PULL, 2);

    world.apply({ phase: "office", team }, LOSS, (snapshot) => ({ ...snapshot, gameOver: "bankruptcy" }));
    // Still at their desks until the people system says they have gone.
    expect(stage.desks.isLit(0)).toBe(true);
    world.signals.vacated = new Set(taken as string[]);
    for (const slot of [0, 1, 2]) chairs.delete(slot);
    world.run(1);
    for (const slot of [0, 1, 2]) {
      expect(stage.desks.isLit(slot), `desk ${slot}`).toBe(false);
      expect(stage.desks.chairOffset(slot), `chair ${slot}`).toBeCloseTo(CHAIR_TUCK, 2);
    }
    // The founders' chairs stay under them; the desks stay "taken" for hiring purposes.
    expect(stage.desks.chairOffset(0, "founder")).toBeCloseTo(0, 3);
    expect(world.emptyDeskSlots()).not.toContain(0);
  });

  it("a lost game loaded from a save looks like the end of the live one", () => {
    const team = { engineering: 3 };
    const world = new Harness();
    world.signals.vacated = new Set(["engineering-0", "engineering-1", "engineering-2"]);
    world.signals.chairsOut = new Map([
      [-1, 0],
      [-2, 0],
    ]);
    world.apply({ phase: "office", team }, [], (snapshot) => ({ ...snapshot, gameOver: "zombie-saas" }));
    world.run(1 / 60);
    const stage = world.system.currentStage!;
    for (const slot of [0, 1, 2]) {
      expect(stage.desks.isLit(slot)).toBe(false);
      // A first build lands the chairs at once rather than rolling them there.
      expect(stage.desks.chairOffset(slot)).toBeCloseTo(CHAIR_TUCK, 3);
    }
    expect(stage.assets.stateOf("helicopter")).toBe("none");
    expect(stage.desks.visibleMarkers()).toBe(0);
    expect(world.registry.find("event-beacon")).toBeUndefined();
  });

  it("sends the people it had no room for home too", () => {
    const world = new Harness();
    world.apply({ phase: "garage", team: { engineering: 12 } });
    expect(world.registry.find("overflow-sign")).toBeDefined();
    world.apply({ phase: "garage", team: { engineering: 12 } }, LOSS, (snapshot) => ({ ...snapshot, gameOver: "bankruptcy" }));
    expect(world.registry.find("overflow-sign")).toBeUndefined();
  });
});

describe("OfficeSystem pricing board", () => {
  it("shows the company's pricing model and lights up when it changes", () => {
    const world = new Harness();
    world.apply({ phase: "office" }, [], (snapshot) => ({ ...snapshot, pricingModel: "prosumer" }));
    const pricing = world.system.currentStage!.stations.pricing;
    const shown: string[] = [];
    let flashes = 0;
    const setModel = pricing.setModel;
    pricing.setModel = (model) => {
      shown.push(model);
      setModel(model);
    };
    pricing.flash = () => {
      flashes += 1;
    };
    world.apply({ phase: "office" }, [{ type: "pricing-changed" }], (snapshot) => ({ ...snapshot, pricingModel: "enterprise" }));
    expect(shown.at(-1)).toBe("enterprise");
    expect(flashes).toBe(1);
    world.apply({ phase: "office" }, [], (snapshot) => ({ ...snapshot, pricingModel: "enterprise" }));
    expect(flashes).toBe(1);
  });
});
