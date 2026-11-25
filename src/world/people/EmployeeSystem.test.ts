import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_STAFF_DRAWN, MAX_WAITING_DRAWN } from "../cast";
import { disposeSharedResources } from "../core/palette";
import { computeLocalBounds } from "../interaction/footprint";
import { CHAIR_TUCK } from "../office/DeskSlots";
import { OfficeSystem } from "../office/OfficeSystem";
import { targetKey } from "../targets";
import type {
  BubbleIcon,
  BurstKind,
  FxApi,
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  OfficeScene,
  Vec3Like,
  WorldSignals,
} from "../types";
import { createCharacter } from "./Character";
import { YEAR_DELAY } from "./crew";
import { EmployeeSystem, PERSON_LABEL, personLabel, TEAM_LABELS } from "./EmployeeSystem";
import type { PeopleContext } from "./EmployeeSystem";
import { scene, Studio } from "./testKit";

interface Entry {
  object: THREE.Object3D;
  target: InteractableTarget;
  options: InteractableOptions;
}

class FakeRegistry implements InteractableRegistry {
  readonly entries = new Map<string, Entry>();

  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void {
    // Same rules as the real one: one entry per target key, one per object.
    this.unregister(object);
    this.entries.set(targetKey(target), { object, target, options });
  }

  unregister(object: THREE.Object3D): void {
    for (const [key, entry] of this.entries) if (entry.object === object) this.entries.delete(key);
  }

  people(): string[] {
    return [...this.entries.keys()].filter((key) => key.startsWith("person:"));
  }
}

class FakeFx implements FxApi {
  readonly bursts: Array<{ kind: BurstKind; at: Vec3Like }> = [];
  readonly bubbles: Array<{ anchor: THREE.Object3D; icon: BubbleIcon }> = [];

  burst(kind: BurstKind, at: Vec3Like): void {
    // Positions are scratch vectors: copy, as the real fx layer reads them synchronously.
    this.bursts.push({ kind, at: { x: at.x, y: at.y, z: at.z } });
  }

  stream(): void {}

  floatText(): void {}

  bubble(anchor: THREE.Object3D, icon: BubbleIcon): void {
    this.bubbles.push({ anchor, icon });
  }

  shake(): void {}
}

type Teams = readonly [number, number, number];

interface Harness {
  scene: THREE.Scene;
  signals: WorldSignals;
  registry: FakeRegistry;
  fx: FakeFx;
  studio: Studio;
  system: EmployeeSystem;
  /** The office beside the people, when the harness was asked for one. It is handed each frame first, as in the World. */
  office: OfficeSystem | null;
  apply(teams: Teams, patch?: Partial<OfficeScene>): void;
  run(seconds: number, each?: () => void): void;
  /** The scene group for a person, via the interactable registered for them. */
  body(personId: string): THREE.Object3D | null;
  people(): THREE.Object3D[];
}

const harness = (options: { reducedMotion?: boolean; withOffice?: boolean } = {}): Harness => {
  const world = new THREE.Scene();
  const registry = new FakeRegistry();
  const fx = new FakeFx();
  const studio = new Studio();
  const signals: WorldSignals = { doorTraffic: 0 };
  const ctx: PeopleContext = {
    scene: world,
    reducedMotion: options.reducedMotion ?? false,
    interactables: registry,
    fx,
    seating: studio.seating,
    signals,
    getLayout: () => studio.layout,
  };
  // World order: the office first, then the people.
  const office = options.withOffice ? new OfficeSystem(ctx) : null;
  const system = new EmployeeSystem(ctx);
  let elapsed = 0;
  return {
    scene: world,
    signals,
    registry,
    fx,
    studio,
    system,
    office,
    apply(teams, patch = {}) {
      // As the World does: the cast and the seating first, then every system in order.
      const frame = studio.frame(scene(teams, patch));
      office?.applyFrame(frame.next, frame.prev);
      system.applyFrame(frame.next, frame.prev);
    },
    run(seconds, each) {
      for (let i = 0; i < Math.round(seconds * 60); i += 1) {
        elapsed += 1 / 60;
        office?.update(1 / 60, elapsed);
        system.update(1 / 60, elapsed);
        each?.();
      }
    },
    body: (personId) => registry.entries.get(`person:${personId}`)?.object ?? null,
    people: () => world.getObjectByName("people")?.children ?? [],
  };
};

const SETTLED = 80;

afterEach(() => disposeSharedResources());

describe("personLabel", () => {
  it("names people by their team, and nobody by name", () => {
    expect(personLabel("product")).toBe("Product");
    expect(personLabel("growth")).toBe("Growth");
    expect(personLabel("recruiting")).toBe("Recruiting");
    expect(personLabel(null)).toBe("Person");
    expect(Object.values(TEAM_LABELS)).toHaveLength(3);
  });
});

describe("Character carrying a box (the leaver's walk)", () => {
  const visibleMeshes = (root: THREE.Object3D): number => {
    let count = 0;
    root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      let shown = true;
      for (let at: THREE.Object3D | null = node; at; at = at.parent) shown = shown && at.visible;
      if (shown) count += 1;
    });
    return count;
  };

  it("shows the box only while upright, and stays within the mesh budget", () => {
    const character = createCharacter({ id: "p0", team: "growth", look: 77 });
    character.setPose("type", { immediate: true });
    expect(visibleMeshes(character.group)).toBe(8);
    character.setCarrying(true);
    // Still at the desk: nothing in their arms yet.
    expect(visibleMeshes(character.group)).toBe(8);
    character.setPose("walk");
    expect(visibleMeshes(character.group)).toBe(9);
    character.setPose("stand");
    expect(visibleMeshes(character.group)).toBe(9);
    character.setCarrying(false);
    expect(visibleMeshes(character.group)).toBe(8);
    // Every optional prop made at once is still within the 12-mesh budget.
    character.setPose("phone");
    let total = 0;
    character.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) total += 1;
    });
    expect(total).toBeLessThanOrEqual(12);
  });

  it("holds both arms forward instead of swinging them", () => {
    const character = createCharacter({ id: "p0", team: "growth", look: 77 });
    character.setPose("walk", { immediate: true });
    character.setWalkSpeed(1.6);
    character.setCarrying(true);
    const arms: THREE.Object3D[] = [];
    character.group.traverse((node) => {
      // Arm pivots sit either side of the chest at shoulder height.
      if (node.type === "Group" && Math.abs(node.position.x) > 0.2 && node.position.y > 0.3) arms.push(node);
    });
    expect(arms).toHaveLength(2);
    for (let i = 0; i < 90; i += 1) {
      character.update(1 / 60, i / 60);
      if (i < 20) continue;
      expect(arms[0].rotation.x).toBeCloseTo(arms[1].rotation.x, 5);
      expect(arms[0].rotation.x).toBeLessThan(-0.8);
    }
  });
});

describe("EmployeeSystem", () => {
  it("builds one character per person with a seat, in place on the first frame", () => {
    const h = harness();
    h.apply([3, 1, 0], { leaving: 1, arriving: 1 });
    expect(h.people()).toHaveLength(6);
    expect(h.system.figureCount).toBe(6);
    expect(h.registry.entries.size).toBe(6);
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5"]) {
      const seat = h.studio.seating.seatOf(id);
      const body = h.body(id);
      expect(body, id).not.toBeNull();
      expect(body?.visible, id).toBe(true);
      expect([body?.position.x, body?.position.y, body?.position.z], id).toEqual([seat?.x, 0, seat?.z]);
      expect(Math.cos((body?.rotation.y ?? 0) - (seat?.facing ?? 0)), id).toBeCloseTo(1);
    }
    expect(h.fx.bubbles).toHaveLength(0);
    expect(h.fx.bursts).toHaveLength(0);
    expect(h.system.busy()).toBe(false);
  });

  it("a figure exists for every cast member with a seat, and for nobody else", () => {
    const h = harness({ withOffice: true });
    // The campus: 150 people, of whom 50 are drawn and 100 are counted on the sign; six more wait at the door.
    h.apply([90, 45, 15], { office: 4, capacity: 150, arriving: 9 });
    const cast = h.studio.cast!;
    expect([cast.people.length, cast.hidden]).toEqual([MAX_STAFF_DRAWN + MAX_WAITING_DRAWN, 100]);
    expect(h.system.figureCount).toBe(56);
    expect(h.people()).toHaveLength(56);
    expect(h.registry.people().sort()).toEqual(cast.people.map((person) => `person:${person.id}`).sort());
    expect(h.studio.seating.hiddenCount()).toBe(100);
    expect(h.office?.currentStage?.signCount).toBe(100);
    // 50 figures in the teams' proportions: 30, 15 and 5.
    const labels = h.registry.people().map((key) => h.registry.entries.get(key)?.options.label);
    expect(["Product", "Growth", "Recruiting", "Person"].map((label) => labels.filter((l) => l === label).length)).toEqual([30, 15, 5, 6]);
    // Eight meshes a figure, and nothing else under the people's root.
    let meshes = 0;
    h.scene.getObjectByName("people")?.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) meshes += 1;
    });
    expect(meshes).toBe(56 * 8);

    // The garage: four desks and four spots at the door for six of Product and six expected.
    const small = harness({ withOffice: true });
    small.apply([6, 0, 0], { office: 0, capacity: 4, arriving: 6 });
    expect(small.system.figureCount).toBe(8);
    expect(small.registry.people().sort()).toEqual(["p0", "p1", "p2", "p3", "p6", "p7", "p8", "p9"].map((id) => `person:${id}`));
    expect(small.office?.currentStage?.signCount).toBe(2);
    // Someone away has a desk and no figure.
    small.apply([3, 0, 0], { office: 0, capacity: 4, away: 1, runId: "another" });
    expect(small.system.figureCount).toBe(3);
    expect(small.body("p3")).toBeNull();
    expect(small.studio.seating.seatOf("p3")?.kind).toBe("desk");
  });

  it("sits people at chair height from the very first frame (no blend from standing)", () => {
    const h = harness();
    h.apply([1, 0, 0]);
    const body = h.body("p0") as THREE.Object3D;
    // What is drawn, in the body's own frame — not the invisible click box around it.
    const bounds = new THREE.Box3();
    expect(computeLocalBounds(body, bounds)).toBe(true);
    // Standing, the feet are on the floor. On a 0.45 chair these short legs dangle well clear of it.
    expect(bounds.min.y).toBeGreaterThan(0.05);
    expect(bounds.min.y).toBeLessThan(0.45);
    expect(bounds.max.y).toBeGreaterThan(1.1);
  });

  it("stands somebody let go at the door with the box in their arms from the very first frame", () => {
    const h = harness();
    h.apply([1, 0, 0], { leaving: 1 });
    const body = h.body("p1") as THREE.Object3D;
    const bounds = new THREE.Box3();
    expect(computeLocalBounds(body, bounds)).toBe(true);
    expect(bounds.min.y).toBeCloseTo(0, 1);
    let meshes = 0;
    body.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) meshes += 1;
    });
    expect(meshes).toBe(9);
  });

  it("registers each person with their team's name and a head anchor that follows them", () => {
    const h = harness();
    h.apply([1, 1, 1], { arriving: 1 });
    const first = h.registry.entries.get("person:p0");
    expect(first?.options.label).toBe("Product");
    expect(first?.target).toEqual({ kind: "person", personId: "p0" });
    const anchor = first?.options.anchor;
    expect(anchor).toBeDefined();
    // The anchor is part of the character, above its head.
    let parent = anchor?.parent ?? null;
    while (parent && parent !== first?.object) parent = parent.parent;
    expect(parent).toBe(first?.object);
    const head = new THREE.Vector3();
    anchor?.getWorldPosition(head);
    expect(head.y).toBeGreaterThan(1);
    expect(first?.options.anchorHeight).toBeLessThan(0.5);
    expect(["p1", "p2", "p3"].map((id) => h.registry.entries.get(`person:${id}`)?.options.label)).toEqual(["Growth", "Recruiting", PERSON_LABEL]);
    // Nobody has a name, and no label is anything but a team's name or "Person".
    for (const entry of h.registry.entries.values()) expect(["Product", "Growth", "Recruiting", "Person"]).toContain(entry.options.label);
  });

  it("someone who arrives walks in from the door; someone who leaves walks out and is gone", () => {
    const h = harness();
    h.apply([1, 0, 0]);
    h.apply([2, 0, 0]);
    expect(h.system.figureCount).toBe(2);
    const body = h.body("p1") as THREE.Object3D;
    expect(body).not.toBeNull();
    // Nobody flashes into view at their desk (or the origin) before the walk starts.
    expect(body.visible).toBe(false);
    expect(h.system.busy()).toBe(true);

    h.run(0.1);
    expect(body.visible).toBe(true);
    expect(h.fx.bubbles.map((bubble) => bubble.icon)).toEqual(["wave"]);
    expect(h.fx.bubbles[0].anchor.name).toBe("head-anchor");
    const start = body.position.clone();
    // They appear just outside the door, not at the origin or at their desk.
    const door = h.studio.layout.door;
    expect(Math.hypot(start.x - door.x, start.z - door.z)).toBeLessThan(1.2);
    expect(h.signals.doorTraffic).toBe(1);

    h.run(1);
    expect(body.position.distanceTo(start)).toBeGreaterThan(0.8);
    expect(body.position.y).toBe(0);

    h.run(SETTLED);
    const seat = h.studio.seating.seatOf("p1");
    expect([body.position.x, body.position.z]).toEqual([seat?.x, seat?.z]);
    expect(body.scale.x).toBe(1);
    expect(h.fx.bursts).toHaveLength(1);
    expect(h.fx.bursts[0].kind).toBe("dust");
    expect([h.fx.bursts[0].at.x, h.fx.bursts[0].at.z]).toEqual([seat?.x, seat?.z]);
    expect(h.signals.doorTraffic).toBe(0);
    expect(h.system.busy()).toBe(false);

    // And out again: unclickable at once, a box in their arms, gone from the scene at the door.
    h.apply([1, 0, 0]);
    expect(h.body("p1")).toBeNull();
    expect(body.parent).not.toBeNull();
    expect(h.system.figureCount).toBe(2);
    h.run(0.8);
    let meshes = 0;
    body.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) meshes += 1;
    });
    expect(meshes).toBe(9);
    h.run(SETTLED);
    expect(body.parent).toBeNull();
    expect(h.people()).toHaveLength(1);
    expect(h.system.figureCount).toBe(1);
    expect(h.system.busy()).toBe(false);
  });

  it("never has more than 56 figures, even while the people let go walk out of a full campus", () => {
    const h = harness();
    const campus = { office: 4 as const, capacity: 150 };
    h.apply([150, 0, 0], campus);
    h.apply([120, 0, 0], { ...campus, leaving: 30 });
    let most = h.system.figureCount;
    const watch = (): void => {
      most = Math.max(most, h.system.figureCount);
      expect(h.people().length).toBe(h.system.figureCount);
    };
    h.run(10, watch);
    // The year plays out: ten drawn people leave, and ten who were counted on the sign are at their desks at once.
    h.apply([120, 0, 0], { ...campus, year: 1991 });
    expect(h.studio.cast?.left).toHaveLength(10);
    watch();
    let walkingOut = 0;
    h.run(SETTLED, () => {
      watch();
      walkingOut = Math.max(walkingOut, h.system.figureCount - MAX_STAFF_DRAWN);
    });
    expect(most).toBe(MAX_STAFF_DRAWN + MAX_WAITING_DRAWN);
    // As many of them walk out as there are figures to spare.
    expect(walkingOut).toBe(MAX_WAITING_DRAWN);
    expect(h.system.figureCount).toBe(MAX_STAFF_DRAWN);
    expect(h.registry.people()).toHaveLength(MAX_STAFF_DRAWN);
    expect(h.system.busy()).toBe(false);
  });

  it("someone back before they are out of the door stays clickable while the earlier figure walks out", () => {
    const h = harness();
    h.apply([2, 1, 0]);
    const old = h.body("p2") as THREE.Object3D;
    h.apply([2, 0, 0], { away: 1 });
    expect(h.body("p2")).toBeNull();
    h.run(1);
    expect(old.visible).toBe(true);
    // Undone within the year: the same person is at work again, with a figure of their own.
    h.apply([2, 1, 0]);
    const fresh = h.body("p2") as THREE.Object3D;
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(old);
    expect(h.system.figureCount).toBe(4);
    expect(h.people()).toHaveLength(4);
    expect(h.registry.people().sort()).toEqual(["person:p0", "person:p1", "person:p2"]);
    let together = 0;
    let unregistered = 0;
    h.run(30, () => {
      if (old.parent !== null && old.visible && fresh.visible) together += 1;
      if (h.body("p2") !== fresh) unregistered += 1;
    });
    // The earlier figure's removal did not take the registration with it, and the two were never seen at once.
    expect([together, unregistered]).toEqual([0, 0]);
    expect(old.parent).toBeNull();
    expect(h.system.figureCount).toBe(3);
    h.run(SETTLED);
    const seat = h.studio.seating.seatOf("p2");
    expect([fresh.visible, fresh.position.x, fresh.position.z]).toEqual([true, seat?.x, seat?.z]);
    expect(h.registry.entries.get("person:p2")?.options.label).toBe("Growth");
    expect(h.system.busy()).toBe(false);
  });

  it("a frame time that is not one moves nobody and spoils nothing", () => {
    const h = harness();
    h.apply([2, 0, 0]);
    h.apply([3, 0, 0]);
    h.run(1.5);
    const body = h.body("p2") as THREE.Object3D;
    const sitting = h.body("p0") as THREE.Object3D;
    const at = body.position.clone();
    for (const dt of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      h.system.update(dt, 2);
      expect(body.position.equals(at), String(dt)).toBe(true);
    }
    const finite = (root: THREE.Object3D): boolean => {
      let ok = true;
      root.traverse((node) => {
        const { position, rotation, scale } = node;
        const sum = position.x + position.y + position.z + rotation.x + rotation.y + rotation.z + scale.x + scale.y + scale.z;
        if (!Number.isFinite(sum)) ok = false;
      });
      return ok;
    };
    h.run(0.5);
    expect([finite(body), finite(sitting)]).toEqual([true, true]);
    expect(body.position.distanceTo(at)).toBeGreaterThan(0.3);
    h.run(SETTLED);
    const seat = h.studio.seating.seatOf("p2");
    expect([body.position.x, body.position.z]).toEqual([seat?.x, seat?.z]);
    expect([finite(body), finite(sitting)]).toEqual([true, true]);
    expect(h.system.busy()).toBe(false);
  });

  it("someone whose desk changed walks to it; nobody else gets up", () => {
    const h = harness();
    h.apply([3, 2, 0]);
    const bodies = ["p0", "p1", "p2", "p4"].map((id) => h.body(id) as THREE.Object3D);
    const places = bodies.map((body) => body.position.clone());
    const displaced = h.body("p3") as THREE.Object3D;
    const from = displaced.position.clone();
    h.apply([4, 2, 0]);
    // Long enough for the walk, short enough that nobody has set off to wander yet.
    let moved = 0;
    h.run(3.5, () => {
      moved = Math.max(moved, displaced.position.distanceTo(from));
      bodies.forEach((body, i) => expect(body.position.distanceTo(places[i])).toBe(0));
    });
    expect(moved).toBeGreaterThan(0.5);
    h.run(SETTLED);
    const seat = h.studio.seating.seatOf("p3");
    expect(seat?.index).toBe(5);
    expect([displaced.position.x, displaced.position.z]).toEqual([seat?.x, seat?.z]);
    expect(h.body("p3")).toBe(displaced);
    expect(h.system.busy()).toBe(false);
  });

  it("someone whose team changed gets the new team's shirt and label on the same body", () => {
    const h = harness();
    h.apply([3, 0, 0]);
    const body = h.body("p2") as THREE.Object3D;
    const meshes: THREE.Mesh[] = [];
    body.traverse((node) => {
      // What is drawn: not the invisible click box around the figure.
      if ((node as THREE.Mesh).isMesh && node.userData.hitProxy !== true) meshes.push(node as THREE.Mesh);
    });
    expect(meshes).toHaveLength(8);
    const before = meshes.map((mesh) => mesh.geometry);
    h.apply([2, 1, 0]);
    expect(h.body("p2")).toBe(body);
    expect(h.registry.entries.get("person:p2")?.options.label).toBe("Growth");
    expect(meshes.filter((mesh, i) => mesh.geometry !== before[i])).toHaveLength(3);
    expect(h.system.figureCount).toBe(3);
    expect(h.system.busy()).toBe(false);
    // And it is exactly the shirt somebody of Growth with that face wears.
    const person = h.studio.cast!.people[2];
    const twin = createCharacter(person);
    const twinMeshes: THREE.BufferGeometry[] = [];
    twin.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) twinMeshes.push((node as THREE.Mesh).geometry);
    });
    expect(meshes.map((mesh) => mesh.geometry)).toEqual(twinMeshes);
  });

  it("a fresh cast, a reset and reduced motion place everyone without a walk", () => {
    const h = harness();
    h.apply([4, 2, 1], { leaving: 1, arriving: 2 });
    expect(h.system.busy()).toBe(false);
    h.apply([6, 1, 1], { runId: "another", arriving: 1 });
    expect(h.system.busy()).toBe(false);
    expect(h.system.figureCount).toBe(9);
    for (const body of h.people()) expect(body.visible).toBe(true);

    const still = harness({ reducedMotion: true });
    still.apply([2, 1, 0]);
    still.apply([3, 1, 0], { leaving: 1, arriving: 2, year: 1991 });
    expect(still.system.busy()).toBe(false);
    expect(still.system.figureCount).toBe(7);
    for (const person of still.studio.cast!.people) {
      const seat = still.studio.seating.seatOf(person.id);
      const body = still.body(person.id);
      expect([body?.visible, body?.position.x, body?.position.z], person.id).toEqual([true, seat?.x, seat?.z]);
    }
    expect(still.fx.bubbles).toHaveLength(0);
    still.apply([2, 0, 0], { office: 2, capacity: 22, year: 1992 });
    expect(still.system.busy()).toBe(false);
    expect(still.system.figureCount).toBe(2);
  });

  it("the system is busy while anyone is walking or settling, and rests when all are still", () => {
    const h = harness();
    h.apply([3, 2, 0]);
    h.run(5, () => expect(h.system.busy()).toBe(false));
    h.apply([4, 2, 0], { leaving: 1, arriving: 1, year: 1991 });
    expect(h.system.busy()).toBe(true);
    // Through the wait for the year's sweep and the staggered turns at the door.
    h.run(YEAR_DELAY, () => expect(h.system.busy()).toBe(true));
    let last = 0;
    let time = 0;
    h.run(120, () => {
      time += 1 / 60;
      if (h.system.busy()) last = time;
    });
    expect(last).toBeGreaterThan(1);
    expect(last).toBeLessThan(100);
    // Still for good: everyone is at their place, alive and not busy.
    h.run(120, () => expect(h.system.busy()).toBe(false));
    for (const person of h.studio.cast!.people) {
      const seat = h.studio.seating.seatOf(person.id);
      const body = h.body(person.id);
      expect([body?.position.x, body?.position.z], person.id).toEqual([seat?.x, seat?.z]);
    }
  });

  it("hides everyone while the office is rebuilt and never shows a zero-scale body", () => {
    const h = harness();
    h.apply([2, 0, 0], { office: 0, capacity: 4 });
    h.apply([2, 0, 0], { office: 1, capacity: 9, year: 1991 });
    for (const body of h.people()) expect(body.visible).toBe(false);
    for (let i = 0; i < 90; i += 1) {
      h.run(1 / 60);
      for (const body of h.people()) if (body.visible) expect(body.scale.x).toBeGreaterThan(0);
    }
    for (const id of ["p0", "p1"]) {
      const seat = h.studio.seating.seatOf(id);
      const body = h.body(id);
      expect(body?.visible, id).toBe(true);
      expect([body?.position.x, body?.position.z, body?.scale.x], id).toEqual([seat?.x, seat?.z, 1]);
    }
    expect(h.system.busy()).toBe(false);
  });

  it("applies frames correctly while the loop is not running", () => {
    const h = harness({ reducedMotion: true });
    h.apply([2, 0, 0]);
    h.apply([1, 0, 0], { arriving: 1 });
    // No update has run: who is left is shown at their place, and who has gone is gone.
    expect(h.body("p0")?.visible).toBe(true);
    expect(h.body("p1")).toBeNull();
    const spot = h.studio.layout.waitingSpots[0];
    expect([h.body("p2")?.visible, h.body("p2")?.position.x, h.body("p2")?.position.z]).toEqual([true, spot.x, spot.z]);
  });

  it("tells the office which chairs are in use", () => {
    const h = harness();
    h.apply([2, 1, 0], { office: 2, capacity: 22, arriving: 1 });
    h.run(0.1);
    const chairs = h.signals.chairsOut!;
    // The desks' own indices; a spot at the door has no chair.
    expect([...chairs.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect([...chairs.values()].every((out) => out === 0)).toBe(true);
    expect(h.signals.vacated!.size).toBe(0);
  });

  it("someone away keeps the desk and is not drawn: the chair is empty and the screen dark", () => {
    const h = harness({ withOffice: true });
    h.apply([2, 1, 0]);
    h.run(0.1);
    const desks = h.office!.currentStage!.desks;
    expect(desks.isLit(2)).toBe(true);
    expect(desks.chairOffset(2)).toBeCloseTo(0, 6);

    // The one of Growth goes away for the year: they get up and walk out, and the desk goes dark behind them.
    h.apply([2, 0, 0], { away: 1 });
    expect(h.studio.seating.deskOccupant(2)).toBe("p2");
    expect(h.signals.vacated!.size).toBe(0);
    h.run(SETTLED);
    expect([...h.signals.vacated!]).toEqual(["p2"]);
    expect(h.body("p2")).toBeNull();
    expect(h.system.figureCount).toBe(2);
    expect([...h.signals.chairsOut!.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(desks.isLit(2)).toBe(false);
    expect(desks.chairOffset(2)).toBeCloseTo(CHAIR_TUCK, 3);
    // The desk is still theirs: it is not offered as a free one, and it keeps the team's colour.
    expect(desks.registeredSlots()).not.toContain(2);
    expect(desks.teamOf(2)).toBe("growth");
    expect([desks.isLit(0), desks.isLit(1)]).toEqual([true, true]);
    expect(h.system.busy()).toBe(false);
    expect(h.office!.busy()).toBe(false);

    // Back the next year: through the door, to the same desk, and the screen comes on.
    h.apply([2, 1, 0], { year: 1991 });
    h.run(SETTLED);
    expect(h.signals.vacated!.size).toBe(0);
    expect(desks.isLit(2)).toBe(true);
    expect(desks.chairOffset(2)).toBeCloseTo(0, 6);
    expect(h.body("p2")).not.toBeNull();
  });

  it("shows someone away as away from the very first frame", () => {
    const h = harness({ withOffice: true });
    h.apply([2, 0, 0], { away: 1 });
    // One update, as the first drawn frame has.
    h.run(1 / 60);
    const desks = h.office!.currentStage!.desks;
    expect([...h.signals.vacated!]).toEqual(["p2"]);
    expect([desks.isLit(0), desks.isLit(1), desks.isLit(2)]).toEqual([true, true, false]);
    expect(desks.chairOffset(2)).toBeCloseTo(CHAIR_TUCK, 3);
    expect(h.system.figureCount).toBe(2);
  });

  it("leaves nothing behind on dispose, and can be built again afterwards", () => {
    const h = harness();
    h.apply([4, 2, 0]);
    h.apply([3, 3, 0], { arriving: 2 });
    h.apply([2, 3, 0], { arriving: 2 });
    h.run(0.7);
    h.system.dispose();
    expect(h.registry.entries.size).toBe(0);
    expect(h.scene.getObjectByName("people")).toBeUndefined();
    expect(h.scene.children).toHaveLength(0);
    expect(h.system.figureCount).toBe(0);
    expect(h.system.busy()).toBe(false);
    expect([h.signals.doorTraffic, h.signals.chairsOut, h.signals.vacated]).toEqual([0, undefined, undefined]);
    // Disposing twice is harmless, and so is a frame or an update that arrives afterwards.
    h.system.dispose();
    h.apply([1, 0, 0]);
    h.run(0.1);
    expect(h.scene.children).toHaveLength(0);

    const again = harness();
    again.apply([4, 0, 0]);
    expect(again.people()).toHaveLength(4);
    again.system.dispose();
  });

  it("does not grow the scene over many cycles of arriving and leaving", () => {
    const h = harness();
    h.apply([2, 0, 0]);
    for (let cycle = 0; cycle < 30; cycle += 1) {
      h.apply([3, 0, 0]);
      h.run(0.4);
      h.apply([2, 0, 0]);
      h.run(0.4);
    }
    h.run(SETTLED);
    expect(h.people()).toHaveLength(2);
    expect(h.registry.entries.size).toBe(2);
    expect(h.system.figureCount).toBe(2);
    expect(h.system.busy()).toBe(false);
  });
});
