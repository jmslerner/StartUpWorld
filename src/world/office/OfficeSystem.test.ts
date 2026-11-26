import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { nextCast } from "../cast";
import { ROLE_COLORS } from "../core/palette";
import { bindLightingState } from "../core/lightingState";
import { sceneEvents } from "../sceneEvents";
import { targetKey } from "../targets";
import { TEAMS } from "../types";
import type {
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  OfficeIndex,
  OfficeLayout,
  OfficeScene,
  Seat,
  SeatChange,
  SeatingApi,
  Team,
  WorldContext,
  WorldFrame,
  WorldSignals,
} from "../types";
import { CHAIR_PULL, CHAIR_TUCK, deskAccentFor, FREE_DESK_LABEL, NEUTRAL_DESK_ACCENT } from "./DeskSlots";
import { createDecorProp } from "./dressing";
import { DECOR_SIZES, decorSize, getLayoutDecor, getOfficeLayout, STATION_KINDS } from "./layouts";
import type { DecorKind } from "./layouts";
import { DOOR_LABEL, signLabel, STATION_LABELS } from "./OfficeStage";
import { OfficeSystem } from "./OfficeSystem";
import type { OfficeContext } from "./OfficeSystem";
import { REBUILD_POP_SECONDS, REBUILD_POP_SPREAD, REBUILD_POP_START } from "./timing";

// ─────────────────────────────────────────────────────────────────────────────
// A world small enough for node: a scene, a recording registry, a stand-in for the seating plan
// ─────────────────────────────────────────────────────────────────────────────

const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];
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

  labels(): string[] {
    return [...this.entries.values()].map((entry) => entry.options.label);
  }
}

/**
 * A stand-in for the seating plan: it holds what a test puts in it and answers the interface from that. It seats
 * nobody by any rule of its own. The real plan comes with the people.
 */
class StubSeating implements SeatingApi {
  /** Who sits at each desk, by desk index. */
  readonly occupants = new Map<number, string>();
  /** The team each desk belongs to, by desk index; a desk not listed belongs to none. */
  readonly teams = new Map<number, Team>();
  hidden = 0;
  private desks = 0;

  /** Called by the harness: the office this plan answers for. */
  use(layout: OfficeLayout): void {
    this.desks = layout.deskSeats.length;
  }

  /** Seat `count` people of a team at the next free desks, lowest first, and give those desks to the team. */
  seat(team: Team, count: number): string[] {
    const ids: string[] = [];
    for (let desk = 0; desk < this.desks && ids.length < count; desk += 1) {
      if (this.occupants.has(desk)) continue;
      const id = `${team}-${desk}`;
      this.occupants.set(desk, id);
      this.teams.set(desk, team);
      ids.push(id);
    }
    return ids;
  }

  clear(): void {
    this.occupants.clear();
    this.teams.clear();
    this.hidden = 0;
  }

  seatOf(personId: string): Seat | null {
    for (const [index, id] of this.occupants) if (id === personId) return { kind: "desk", index, x: 0, z: 0, facing: 0 };
    return null;
  }
  teamOfDesk(index: number): Team | null {
    return this.teams.get(index) ?? null;
  }
  freeDeskSlots(): number[] {
    return Array.from({ length: this.desks }, (_, index) => index).filter((index) => !this.occupants.has(index));
  }
  hiddenCount(): number {
    return this.hidden;
  }
  lastChanges(): readonly SeatChange[] {
    return [];
  }
  deskOccupant(index: number): string | null {
    return this.occupants.get(index) ?? null;
  }
  waitingOccupant(): string | null {
    return null;
  }
}

const sceneOf = (patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "run",
  seed: 7,
  year: 1990,
  office: 0,
  capacity: 4,
  era: "flat",
  teams: { product: 0, growth: 0, recruiting: 0 },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});

/** Drives an OfficeSystem the way the world will: layout, then seating, then the system. */
class Harness {
  readonly scene = new THREE.Scene();
  readonly registry = new RecordingRegistry();
  readonly seating: StubSeating | undefined;
  readonly signals: WorldSignals = { doorTraffic: 0 };
  readonly system: OfficeSystem;
  layout: OfficeLayout = getOfficeLayout(0);
  previous: WorldFrame | null = null;
  private elapsed = 0;

  constructor(options: { reducedMotion?: boolean; seating?: boolean } = {}) {
    const base: OfficeContext = {
      scene: this.scene,
      reducedMotion: options.reducedMotion ?? false,
      interactables: this.registry,
      signals: this.signals,
      getLayout: () => this.layout,
    };
    if (options.seating === false) {
      this.system = new OfficeSystem(base);
      return;
    }
    this.seating = new StubSeating();
    // With a seating plan, hand over a whole world context, as the world itself will.
    const ctx: WorldContext = {
      ...base,
      camera: new THREE.OrthographicCamera(),
      quality: "high",
      fx: { burst: () => undefined, stream: () => undefined, floatText: () => undefined, bubble: () => undefined, shake: () => undefined },
      seating: this.seating,
      focusCamera: () => undefined,
    };
    this.system = new OfficeSystem(ctx);
  }

  /** Show a scene. `seat` arranges the stand-in seating plan for it first (it starts from where it was). */
  apply(patch: Partial<OfficeScene> = {}, seat?: (seating: StubSeating) => void): WorldFrame {
    const scene = sceneOf({ ...(this.previous?.scene ?? {}), ...patch });
    this.layout = getOfficeLayout(scene.office);
    if (this.seating) {
      if (this.previous !== null && this.previous.scene.office !== scene.office) this.seating.clear();
      this.seating.use(this.layout);
      seat?.(this.seating);
    }
    const frame: WorldFrame = {
      scene,
      cast: nextCast(this.previous?.cast ?? null, scene),
      events: sceneEvents(this.previous?.scene ?? null, scene),
    };
    this.system.applyFrame(frame, this.previous);
    this.previous = frame;
    return frame;
  }

  run(seconds: number): void {
    for (let t = 0; t < seconds; t += FRAME) {
      this.elapsed += FRAME;
      this.system.update(FRAME, this.elapsed);
    }
  }

  /** Step until the system says it is at rest; returns the seconds that took (at most `limit`). */
  settle(limit = 10): number {
    let seconds = 0;
    while (this.system.busy() && seconds < limit) {
      this.elapsed += FRAME;
      seconds += FRAME;
      this.system.update(FRAME, this.elapsed);
    }
    return seconds;
  }

  freeDesks(): number[] {
    return this.registry
      .ofKind("desk")
      .map((entry) => (entry.target.kind === "desk" ? entry.target.desk : -1))
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

/** How many corners of the meshes under `root` are painted exactly this colour. */
const painted = (root: THREE.Object3D, hex: number): number => {
  let count = 0;
  const scratch = new THREE.Color();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const colour = mesh.isMesh ? mesh.geometry.getAttribute("color") : undefined;
    if (!colour) return;
    for (let i = 0; i < colour.count; i += 1) {
      if (scratch.setRGB(colour.getX(i), colour.getY(i), colour.getZ(i)).getHex() === hex) count += 1;
    }
  });
  return count;
};

// ─────────────────────────────────────────────────────────────────────────────

describe.each(OFFICES)("OfficeSystem in office %i", (office) => {
  it("registers all eight stations and the door on the first frame", () => {
    const world = new Harness();
    world.apply({ office });
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
    world.apply({ office });
    for (const kind of STATION_KINDS) {
      const { object } = world.registry.find(`station:${kind}`)!;
      const spot = world.layout.stations[kind];
      expect(object.position.x).toBeCloseTo(spot.x, 6);
      expect(object.position.z).toBeCloseTo(spot.z, 6);
      expect(object.rotation.y).toBeCloseTo(spot.facing, 6);
    }
  });

  it("offers exactly the free desks as free desks", () => {
    const world = new Harness();
    world.apply({ office }, (seating) => {
      seating.seat("product", 2);
      seating.seat("growth", 1);
    });
    expect(world.freeDesks()).toEqual(world.seating!.freeDeskSlots());
    expect(world.freeDesks().length).toBe(world.layout.deskSeats.length - 3);
    for (const entry of world.registry.ofKind("desk")) expect(entry.options.label).toBe(FREE_DESK_LABEL);
  });

  it("stands each desk and its chair exactly on its seat, facing with it", () => {
    const world = new Harness();
    world.apply({ office });
    expect(world.freeDesks()).toHaveLength(world.layout.deskSeats.length);
    for (const entry of world.registry.ofKind("desk")) {
      const desk = entry.target.kind === "desk" ? entry.target.desk : -1;
      const seat = world.layout.deskSeats[desk];
      expect(entry.object.position.x).toBeCloseTo(seat.x, 6);
      expect(entry.object.position.z).toBeCloseTo(seat.z, 6);
      expect(entry.object.rotation.y).toBeCloseTo(seat.facing, 6);
    }
  });

  it("stops offering exactly the desk somebody takes, and offers it again when they go", () => {
    const world = new Harness();
    world.apply({ office }, (seating) => seating.seat("product", 1));
    const before = world.freeDesks();
    let taken = -1;
    world.apply({}, (seating) => {
      const [id] = seating.seat("recruiting", 1);
      taken = seating.seatOf(id)!.index;
    });
    expect(before).toContain(taken);
    expect(world.freeDesks()).toEqual(before.filter((desk) => desk !== taken));

    world.apply({}, (seating) => {
      seating.occupants.delete(taken);
    });
    expect(world.freeDesks()).toEqual(before);
  });

  it("does not rebuild the office when only the people change", () => {
    const world = new Harness();
    world.apply({ office });
    const stage = world.system.currentStage;
    const door = world.registry.find("door")!.object;
    world.apply({ teams: { product: 2, growth: 1, recruiting: 0 } }, (seating) => seating.seat("product", 3));
    world.apply({ year: 1991, leaving: 1, arriving: 2 });
    expect(world.system.currentStage).toBe(stage);
    expect(world.registry.find("door")!.object).toBe(door);
  });

  it("dresses each desk in its team's colour, and a desk no team has in none", () => {
    const world = new Harness();
    world.apply({ office }, (seating) => {
      seating.seat("product", 1);
      seating.seat("growth", 1);
      seating.seat("recruiting", 1);
    });
    const desks = world.system.currentStage!.desks;
    expect([0, 1, 2, 3].map((desk) => desks.teamOf(desk))).toEqual(["product", "growth", "recruiting", null]);
    // A team's colour is on its own desk and chair in bulk (the mat, the trim, the upholstery); on anybody else's
    // it is at most a status light that happens to be the same green or blue.
    for (const [desk, team] of TEAMS.entries()) {
      const own = painted(desks.objectOf(desk)!, ROLE_COLORS[team]);
      expect(own, `desk ${desk} wears ${team}`).toBeGreaterThan(40);
      for (const [otherDesk, other] of TEAMS.entries()) {
        if (other !== team) expect(painted(desks.objectOf(otherDesk)!, ROLE_COLORS[team]), `desk ${otherDesk} wears ${team}`).toBeLessThanOrEqual(own / 2);
      }
      expect(painted(desks.objectOf(3)!, ROLE_COLORS[team]), `a neutral desk wears ${team}`).toBeLessThanOrEqual(own / 2);
    }
    expect(deskAccentFor(null)).toBe(NEUTRAL_DESK_ACCENT);
    expect(TEAMS.map(deskAccentFor)).toEqual(TEAMS.map((team) => ROLE_COLORS[team]));
  });

  it("recolours a desk that passes to another team, where it stands and with whoever sits at it", () => {
    const world = new Harness();
    world.apply({ office }, (seating) => seating.seat("product", 2));
    const stage = world.system.currentStage!;
    const group = stage.desks.objectOf(0)!;
    const props = stage.kit.props.size;
    const blueBefore = [0, 1].map((desk) => painted(stage.desks.objectOf(desk)!, ROLE_COLORS.product));
    expect(blueBefore[0]).toBeGreaterThan(40);
    world.apply({}, (seating) => {
      seating.teams.set(0, "growth");
      seating.teams.delete(1);
    });
    expect(world.system.currentStage).toBe(stage);
    expect(stage.desks.objectOf(0)).toBe(group);
    expect([stage.desks.teamOf(0), stage.desks.teamOf(1)]).toEqual(["growth", null]);
    expect(painted(group, ROLE_COLORS.growth)).toBeGreaterThan(40);
    expect(painted(group, ROLE_COLORS.product)).toBeLessThanOrEqual(painted(group, ROLE_COLORS.growth) / 2);
    // Both desks lost their blue: one to orange, one to no colour at all.
    for (const desk of [0, 1]) expect(painted(stage.desks.objectOf(desk)!, ROLE_COLORS.product), `desk ${desk}`).toBeLessThanOrEqual(blueBefore[desk] / 2);
    expect([stage.desks.isLit(0), stage.desks.isLit(1)]).toEqual([true, true]);
    // Swapped, not added to.
    expect(stage.kit.props.size).toBe(props);
    expect(group.children.filter((child) => child.userData.hitProxy !== true)).toHaveLength(2);
  });

  it("shows on the sign how many people are not drawn, and takes the sign away when all are", () => {
    const world = new Harness();
    world.apply({ office });
    expect(world.registry.find("sign")).toBeUndefined();
    const stage = world.system.currentStage!;

    world.apply({}, (seating) => {
      seating.hidden = 3;
    });
    const sign = world.registry.find("sign");
    expect(sign, "the sign").toBeDefined();
    expect(sign!.options.label).toBe("3 more people work here");
    expect(world.isLive(sign!.object)).toBe(true);
    expect(stage.signCount).toBe(3);
    // Outside the building, beside the doorway.
    const { floor } = world.layout;
    const at = sign!.object.position;
    expect(at.x > floor.maxX || at.z > floor.maxZ).toBe(true);

    world.apply({}, (seating) => {
      seating.hidden = 1;
    });
    expect(world.registry.find("sign")!.object).toBe(sign!.object);
    expect(world.registry.find("sign")!.options.label).toBe("1 more person works here");

    world.apply({}, (seating) => {
      seating.hidden = 0;
    });
    expect(world.registry.find("sign")).toBeUndefined();
    expect(stage.signCount).toBe(0);
    expect(stage.signObject).toBeNull();
    expect(world.system.currentStage).toBe(stage);
  });

  it("works with no seating plan at all: every desk free and neutral, and no sign", () => {
    const world = new Harness({ seating: false });
    world.apply({ office, teams: { product: 60, growth: 50, recruiting: 40 } });
    const stage = world.system.currentStage!;
    const desks = world.layout.deskSeats.length;
    expect(world.freeDesks()).toEqual(Array.from({ length: desks }, (_, desk) => desk));
    for (let desk = 0; desk < desks; desk += 1) {
      expect(stage.desks.teamOf(desk)).toBeNull();
      expect(stage.desks.isLit(desk)).toBe(false);
    }
    expect(world.registry.find("sign")).toBeUndefined();
    expect(stage.signCount).toBe(0);
    for (const key of [...stationKeys, "door"]) expect(world.registry.find(key), key).toBeDefined();
    world.settle();
    expect(world.system.busy()).toBe(false);
  });

  it("leaves nothing in the scene after dispose", () => {
    const world = new Harness();
    world.apply({ office }, (seating) => {
      seating.seat("product", 3);
      seating.hidden = 12;
    });
    world.run(0.2);
    world.system.dispose();
    expect(world.scene.children).toEqual([]);
    expect(world.registry.entries.size).toBe(0);
    expect(world.system.busy()).toBe(false);
    // Idempotent, and later calls are harmless.
    world.system.dispose();
    world.system.update(FRAME, 1);
    world.apply({ office });
    expect(world.scene.children).toEqual([]);
    expect(world.system.currentStage).toBeNull();
  });
});

describe("OfficeSystem when the office changes", () => {
  it("builds the office of the frame, and rebuilds it when the office changes", () => {
    const world = new Harness();
    world.apply({ office: 0 }, (seating) => seating.seat("product", 2));
    const oldObjects = new Set(world.registry.entries.keys());
    const oldStage = world.system.currentStage!;
    expect(oldStage.office).toBe(0);
    expect(oldStage.layout).toBe(getOfficeLayout(0));
    expect(oldStage.look).toBe("classic");

    const frame = world.apply({ office: 1, capacity: 9, year: 1991 }, (seating) => seating.seat("product", 2));
    expect(frame.events).toContainEqual({ kind: "office-changed", from: 0, to: 1 });
    const stage = world.system.currentStage!;
    expect(stage).not.toBe(oldStage);
    expect(stage.office).toBe(1);
    expect(stage.layout).toBe(getOfficeLayout(1));
    for (const object of world.registry.entries.keys()) expect(oldObjects.has(object)).toBe(false);
    for (const key of [...stationKeys, "door"]) expect(world.registry.find(key), key).toBeDefined();
    expect(world.freeDesks()).toEqual(world.seating!.freeDeskSlots());
    // One entry per target: nothing is registered twice.
    expect(new Set(world.registry.keys()).size).toBe(world.registry.entries.size);

    // The old office is still sinking away; once the change is over only the new one remains.
    const root = world.scene.children[0];
    expect(root.children).toContain(oldStage.root);
    world.run(1.3);
    expect(root.children).toEqual([stage.root]);
    for (const entry of world.registry.entries.values()) expect(world.isLive(entry.object)).toBe(true);
  });

  it("builds each of the five offices with its own number of desks", () => {
    const world = new Harness({ reducedMotion: true });
    const desks = OFFICES.map((office) => {
      world.apply({ office });
      expect(world.system.currentStage!.office).toBe(office);
      return world.freeDesks().length;
    });
    expect(desks).toEqual([4, 9, 22, 40, 50]);
  });

  it("the first office appears at once; a later one sinks and rises unless motion is reduced", () => {
    const first = new Harness();
    first.apply({ office: 2 });
    const built = first.system.currentStage!;
    expect(built.kit.structure.position.y).toBe(0);
    expect(built.kit.structure.visible).toBe(true);
    for (const object of built.kit.entrances) expect(object.scale.y).toBeGreaterThan(0.4);
    // Nothing is on its way anywhere once the chairs have been stood where they belong.
    expect(first.settle()).toBeLessThanOrEqual(2 * FRAME);
    expect(first.system.busy()).toBe(false);

    first.apply({ office: 3, year: 1991 });
    const stage = first.system.currentStage!;
    expect(first.system.busy()).toBe(true);
    // The old office is on its way down, the new one not yet up.
    expect(first.scene.children[0].children).toEqual([built.root, stage.root]);
    expect(stage.kit.structure.visible).toBe(false);
    expect(stage.kit.entrances.every((object) => object.scale.x < 0.01)).toBe(true);
    first.run(0.2);
    expect(built.root.position.y).toBeLessThan(0);
    expect(first.system.busy()).toBe(true);
    const took = 0.2 + first.settle();
    expect(first.system.busy()).toBe(false);
    expect(took).toBeGreaterThan(1);
    expect(took).toBeLessThanOrEqual(REBUILD_POP_START + REBUILD_POP_SPREAD + REBUILD_POP_SECONDS + 3 * FRAME);
    expect(first.scene.children[0].children).toEqual([stage.root]);
    expect(stage.kit.structure.position.y).toBeCloseTo(0, 6);
    for (const object of stage.kit.entrances) expect(object.scale.y).toBeCloseTo(1, 6);

    const calm = new Harness({ reducedMotion: true });
    calm.apply({ office: 0 });
    calm.settle();
    calm.apply({ office: 1, year: 1991 });
    const root = calm.scene.children[0];
    expect(root.children).toEqual([calm.system.currentStage!.root]);
    expect(calm.system.currentStage!.kit.structure.position.y).toBe(0);
    expect(calm.system.currentStage!.kit.structure.visible).toBe(true);
    for (const object of calm.system.currentStage!.kit.entrances) expect(object.scale.y).toBe(1);
    expect(calm.settle()).toBeLessThanOrEqual(2 * FRAME);
  });

  it("finishes the change within 1.2 seconds, with every piece at its resting size", () => {
    const world = new Harness();
    world.apply({ office: 2 }, (seating) => seating.seat("product", 6));
    world.apply({ office: 3, year: 1991 }, (seating) => seating.seat("product", 6));
    const stage = world.system.currentStage!;
    world.run(0.1);
    // Mid-change the new contents have not popped in yet.
    expect(stage.kit.entrances.some((object) => object.scale.x < 0.01)).toBe(true);
    world.run(1.1);
    expect(stage.kit.structure.position.y).toBeCloseTo(0, 6);
    expect(stage.kit.structure.visible).toBe(true);
    for (const object of stage.kit.entrances) {
      expect(Math.abs(object.scale.x)).toBeGreaterThan(0.4);
      expect(object.scale.y).toBeGreaterThan(0.4);
    }
  });

  it("survives offices flipping back and forth mid-change", () => {
    const world = new Harness();
    world.apply({ office: 0 });
    world.apply({ office: 1, year: 1991 });
    world.run(0.1);
    world.apply({ office: 0, year: 1992 });
    world.run(0.1);
    world.apply({ office: 2, year: 1993 });
    world.run(1.5);
    const root = world.scene.children[0];
    expect(root.children).toEqual([world.system.currentStage!.root]);
    expect(world.system.currentStage!.office).toBe(2);
    expect(world.freeDesks()).toEqual(world.seating!.freeDeskSlots());
    expect(world.settle()).toBe(0);
  });

  it("rebuilds at once on a run reset, even in the same office", () => {
    const world = new Harness();
    world.apply({ office: 2 }, (seating) => {
      seating.seat("product", 5);
      seating.hidden = 4;
    });
    world.settle();
    const oldStage = world.system.currentStage;
    const frame = world.apply({ runId: "another" }, (seating) => seating.clear());
    expect(frame.events).toEqual([{ kind: "run-reset" }]);
    expect(world.system.currentStage).not.toBe(oldStage);
    const root = world.scene.children[0];
    expect(root.children).toEqual([world.system.currentStage!.root]);
    expect(world.system.currentStage!.kit.structure.position.y).toBe(0);
    expect(world.registry.find("sign")).toBeUndefined();
    expect(world.freeDesks()).toHaveLength(22);
    expect(world.settle()).toBeLessThanOrEqual(2 * FRAME);
  });

  it("the sign by the door shows how many people are not drawn, and nothing when all are", () => {
    const world = new Harness();
    // 150 people at the campus: 50 drawn, 100 on the sign.
    const frame = world.apply({ office: 4, capacity: 150, teams: { product: 60, growth: 50, recruiting: 40 } }, (seating) => {
      seating.seat("product", 20);
      seating.seat("growth", 17);
      seating.seat("recruiting", 13);
      seating.hidden = 100;
    });
    expect(frame.cast.hidden).toBe(100);
    expect(world.freeDesks()).toEqual([]);
    const stage = world.system.currentStage!;
    expect(stage.signCount).toBe(100);
    expect(world.registry.find("sign")!.options.label).toBe(signLabel(100));
    expect(signLabel(100)).toBe("100 more people work here");
    expect(world.isLive(stage.signObject!)).toBe(true);

    world.apply({ teams: { product: 20, growth: 17, recruiting: 13 } }, (seating) => {
      seating.hidden = 0;
    });
    expect(stage.signCount).toBe(0);
    expect(world.registry.find("sign")).toBeUndefined();
    expect(stage.signObject).toBeNull();

    // A count that is no count shows nothing rather than nonsense.
    for (const odd of [Number.NaN, -3, 0.4, Number.POSITIVE_INFINITY]) {
      world.apply({}, (seating) => {
        seating.hidden = odd;
      });
      expect(stage.signCount, String(odd)).toBe(0);
      expect(world.registry.find("sign"), String(odd)).toBeUndefined();
    }
  });

  it("every change of era rebuilds the office in place; a year within an era does not", () => {
    const world = new Harness();
    world.apply({ office: 2, capacity: 22, era: "bust", year: 2006 }, (seating) => seating.seat("product", 3));
    world.settle();
    const bust = world.system.currentStage!;
    expect(bust.look).toBe("bust");
    world.apply({ era: "phones", year: 2007 }); // bust → phones, the same decade: a new stage all the same
    const phones = world.system.currentStage!;
    expect(phones).not.toBe(bust);
    expect(phones.look).toBe("phones");
    world.settle();
    world.apply({ year: 2008 }); // the same era: the same stage
    expect(world.system.currentStage).toBe(phones);
    world.settle();
    world.apply({ era: "cheap-money", year: 2014 }); // a new era: a new stage in the same office
    const cheap = world.system.currentStage!;
    expect(cheap).not.toBe(phones);
    expect(cheap.look).toBe("cheap-money");
    expect(cheap.office).toBe(2);
    // The old office sinks away while the new one rises in the same place.
    const root = world.scene.children[0];
    expect(root.children).toEqual([phones.root, cheap.root]);
    world.run(0.2);
    expect(phones.root.position.y).toBeLessThan(0);
    world.settle();
    expect(root.children).toEqual([cheap.root]);
    expect(world.freeDesks()).toEqual(world.seating!.freeDeskSlots());
  });

  it("the calendar shows the scene's year, and the next one after the year has advanced", () => {
    const lit = (root: THREE.Object3D): number => {
      let n = 0;
      root.traverse((o) => {
        if (o.name === "calendar-segment" && o.visible) n += 1;
      });
      return n;
    };
    const world = new Harness();
    world.apply({ office: 2, capacity: 22, era: "dial-up", year: 1990 });
    const stage = world.system.currentStage!;
    expect(lit(stage.stations.calendar.group)).toBe(2 + 6 + 6 + 6);
    world.apply({ year: 1991 });
    expect(world.system.currentStage).toBe(stage);
    expect(lit(stage.stations.calendar.group)).toBe(2 + 6 + 6 + 2);
  });

  it("a sign that arrives with a new office is part of what pops in", () => {
    const world = new Harness();
    world.apply({ office: 3 });
    world.apply({ office: 4, capacity: 150, year: 1991 }, (seating) => {
      seating.hidden = 100;
    });
    const stage = world.system.currentStage!;
    expect(stage.kit.entrances).toContain(stage.signObject);
    expect(stage.signObject!.scale.x).toBeLessThan(0.01);
    world.settle();
    expect(stage.signObject!.scale.x).toBeCloseTo(1, 6);
  });

  it("no station carries a command or a label from the old game", () => {
    const old = /\b(ship|launch|pitch|raise|end week|week|roadmap|phases?|hire|status|pricing|build|respond|event|upgrade)\b/i;
    for (const office of OFFICES) {
      const world = new Harness();
      world.apply({ office }, (seating) => {
        seating.seat("product", 1);
        seating.hidden = 5;
      });
      const labels = world.registry.labels();
      // Eight stations, the door, the sign, and every desk but the taken one.
      expect(labels).toHaveLength(8 + 1 + 1 + world.layout.deskSeats.length - 1);
      for (const label of labels) {
        expect(label, label).not.toMatch(/[>—–:$]/);
        expect(label, label).not.toMatch(old);
        expect(label.trim(), label).toBe(label);
        expect(label.length, label).toBeGreaterThan(3);
      }
      expect(STATION_KINDS.map((kind) => world.registry.find(`station:${kind}`)!.options.label)).toEqual([
        "Whiteboard",
        "Marketing corner",
        "Phone corner",
        "Board table",
        "Wall calendar",
        "Coffee machine",
        "Server rack",
        "Price board",
      ]);
      // Nothing of a station is a plate: no part of one is named for a command.
      for (const kind of STATION_KINDS) {
        world.registry.find(`station:${kind}`)!.object.traverse((object) => expect(object.name).not.toMatch(/plate|command/i));
      }
    }
  });
});

describe("OfficeSystem between frames", () => {
  it("darkens the desk of someone who is away, and tucks their chair in", () => {
    const world = new Harness();
    let ids: string[] = [];
    world.apply({ office: 2 }, (seating) => {
      ids = seating.seat("product", 3);
    });
    const stage = world.system.currentStage!;
    // As the people system would publish it: everyone in their chair.
    const chairs = new Map<number, number>([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    world.signals.chairsOut = chairs;
    world.run(0.5);
    expect(stage.desks.isLit(0)).toBe(true);
    expect(stage.desks.chairOffset(0)).toBeCloseTo(0, 3);
    expect(world.system.busy()).toBe(false);
    // Somebody getting up: their chair rolls back, and the office is busy while it does.
    chairs.set(1, 1);
    world.run(FRAME);
    expect(world.system.busy()).toBe(true);
    world.settle();
    expect(stage.desks.chairOffset(1)).toBeCloseTo(-CHAIR_PULL, 3);

    // They have gone to raise money: they keep the desk, which goes dark.
    world.signals.vacated = new Set([ids[1]]);
    chairs.delete(1);
    world.run(FRAME);
    expect(stage.desks.isLit(1)).toBe(false);
    expect([stage.desks.isLit(0), stage.desks.isLit(2)]).toEqual([true, true]);
    world.settle();
    expect(stage.desks.chairOffset(1)).toBeCloseTo(CHAIR_TUCK, 3);
    // Taken all the same.
    expect(world.freeDesks()).not.toContain(1);

    world.signals.vacated = new Set();
    world.run(FRAME);
    expect(stage.desks.isLit(1)).toBe(true);
  });

  it("without a people system a chair stands under whoever has the desk, and is tucked in at a free one", () => {
    const world = new Harness();
    world.apply({ office: 1 }, (seating) => seating.seat("growth", 1));
    world.settle();
    const { desks } = world.system.currentStage!;
    expect(desks.chairOffset(0)).toBe(0);
    expect(desks.chairOffset(1)).toBe(CHAIR_TUCK);
  });

  it("holds the door open for whoever is walking through it, and is busy until it has shut again", () => {
    const world = new Harness();
    world.apply({ office: 2 });
    world.settle();
    const door = world.registry.find("door")!.object;
    const leaf = door.children.find((child) => child.type === "Group" && child.children.length > 0)!;
    expect(leaf.rotation.y).toBe(0);

    world.signals.doorTraffic = 1;
    expect(world.system.busy()).toBe(true);
    world.run(1);
    expect(Math.abs(leaf.rotation.y)).toBeGreaterThan(1.5);
    expect(world.system.busy()).toBe(true);

    world.signals.doorTraffic = 0;
    expect(world.system.busy()).toBe(true);
    const took = world.settle();
    expect(took).toBeGreaterThan(0.8);
    expect(took).toBeLessThan(4);
    expect(leaf.rotation.y).toBeCloseTo(0, 6);
    expect(world.system.busy()).toBe(false);
  });

  it("passes the dusk on to its lamps and screens, and is not at rest until it has", () => {
    const world = new Harness();
    world.apply({ office: 3 }, (seating) => seating.seat("product", 4));
    world.settle();
    const lighting = bindLightingState(world.scene);
    lighting.duskAmount = 1;
    expect(world.system.busy()).toBe(true);
    world.run(FRAME);
    expect(world.system.busy()).toBe(false);
    // A drift too small to see is not worth waking for; the way back to full daylight always is.
    lighting.duskAmount = 0.995;
    expect(world.system.busy()).toBe(false);
    lighting.duskAmount = 0;
    expect(world.system.busy()).toBe(true);
    world.settle();
    expect(world.system.busy()).toBe(false);
  });
});

describe("floor-plan décor", () => {
  it("builds a prop that fits the floor area its plan reserves", () => {
    for (const office of OFFICES) {
      for (const spot of getLayoutDecor(getOfficeLayout(office))) {
        const prop = createDecorProp(office, spot);
        const reserved = decorSize(spot);
        // A little overhang is tolerated (leaves, chair legs); people keep 0.25 clear of footprints anyway.
        expect(prop.footprint.w, `office ${office} ${spot.kind} width`).toBeLessThanOrEqual(reserved.width + 0.1);
        expect(prop.footprint.d, `office ${office} ${spot.kind} depth`).toBeLessThanOrEqual(reserved.depth + 0.1);
        prop.dispose();
      }
    }
  });

  it("has a size for every kind and gives every office some", () => {
    for (const kind of Object.keys(DECOR_SIZES) as DecorKind[]) {
      expect(DECOR_SIZES[kind].width).toBeGreaterThan(0);
      expect(DECOR_SIZES[kind].depth).toBeGreaterThan(0);
    }
    for (const office of OFFICES) expect(getLayoutDecor(getOfficeLayout(office)).length).toBeGreaterThan(0);
  });
});
