import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { disposeSharedResources } from "../core/palette";
import { computeLocalBounds } from "../interaction/footprint";
import { targetKey } from "../targets";
import type {
  BubbleIcon,
  BurstKind,
  FxApi,
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  Vec3Like,
  WorldContext,
  WorldSignals,
  WorldEvent,
} from "../types";
import { createCharacter } from "./Character";
import { EmployeeSystem, personLabel } from "./EmployeeSystem";
import { company, departed, hired, Studio } from "./testKit";

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
}

class FakeFx implements FxApi {
  readonly bursts: Array<{ kind: BurstKind; at: Vec3Like }> = [];
  readonly streams: Array<{ kind: BurstKind; from: Vec3Like; to: Vec3Like; count: number | undefined }> = [];
  readonly bubbles: Array<{ anchor: THREE.Object3D; icon: BubbleIcon }> = [];

  burst(kind: BurstKind, at: Vec3Like): void {
    // Positions are scratch vectors: copy, as the real fx layer reads them synchronously.
    this.bursts.push({ kind, at: { x: at.x, y: at.y, z: at.z } });
  }

  stream(kind: BurstKind, from: Vec3Like, to: Vec3Like, count?: number): void {
    this.streams.push({ kind, from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z }, count });
  }

  floatText(): void {}

  bubble(anchor: THREE.Object3D, icon: BubbleIcon): void {
    this.bubbles.push({ anchor, icon });
  }

  shake(): void {}
}

interface Harness {
  scene: THREE.Scene;
  signals: WorldSignals;
  registry: FakeRegistry;
  fx: FakeFx;
  studio: Studio;
  system: EmployeeSystem;
  apply(state: GameState, events?: readonly WorldEvent[]): void;
  run(seconds: number): void;
  /** The scene group for a person, via the interactable registered for them. */
  body(personId: string): THREE.Object3D | null;
  people(): THREE.Object3D[];
}

const harness = (reducedMotion = true): Harness => {
  const scene = new THREE.Scene();
  const registry = new FakeRegistry();
  const fx = new FakeFx();
  const studio = new Studio();
  const signals: WorldSignals = { doorTraffic: 0 };
  const ctx: WorldContext = {
    scene,
    camera: new THREE.OrthographicCamera(),
    quality: "high",
    reducedMotion,
    interactables: registry,
    fx,
    seating: studio.seating,
    signals,
    getLayout: () => studio.layout,
    focusCamera: () => {},
  };
  const system = new EmployeeSystem(ctx);
  let elapsed = 0;
  return {
    scene,
    signals,
    registry,
    fx,
    studio,
    system,
    apply(state, events = []) {
      const frame = studio.frame(state, events);
      system.applySnapshot(frame.next, frame.prev, frame.events);
    },
    run(seconds) {
      for (let i = 0; i < Math.round(seconds * 60); i += 1) {
        elapsed += 1 / 60;
        system.update(1 / 60, elapsed);
      }
    },
    body: (personId) => registry.entries.get(`person:${personId}`)?.object ?? null,
    people: () => scene.getObjectByName("people")?.children ?? [],
  };
};

afterEach(() => disposeSharedResources());

describe("personLabel", () => {
  it("names people by what they are", () => {
    expect(personLabel({ id: "founder", kind: "founder", role: null, name: "Robin", look: 1 })).toBe("Robin — Founder");
    expect(personLabel({ id: "cofounder", kind: "cofounder", role: null, name: "Sam", look: 1 })).toBe("Sam — Cofounder");
    expect(personLabel({ id: "engineering-0", kind: "employee", role: "engineering", name: "Amara Okafor", look: 1 })).toBe(
      "Amara Okafor — Engineer"
    );
    expect(personLabel({ id: "sales-0", kind: "employee", role: "sales", name: "Li Wei", look: 1 })).toBe("Li Wei — Account Exec");
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
    const character = createCharacter({ id: "sales-0", kind: "employee", role: "sales", name: "Li Wei", look: 77 });
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
    character.setPose("floor-sit");
    character.setPose("phone");
    let total = 0;
    character.group.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) total += 1;
    });
    expect(total).toBeLessThanOrEqual(12);
  });

  it("holds both arms forward instead of swinging them", () => {
    const character = createCharacter({ id: "sales-0", kind: "employee", role: "sales", name: "Li Wei", look: 77 });
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
  it("builds one seated character per person with a seat, in place on the first snapshot", () => {
    const h = harness();
    h.apply(company({ phase: "coworking", team: { engineering: 3, design: 1 } }));
    expect(h.people()).toHaveLength(6);
    expect(h.registry.entries.size).toBe(6);
    for (const id of ["founder", "cofounder", "engineering-0", "engineering-1", "engineering-2", "design-0"]) {
      const seat = h.studio.seating.seatOf(id);
      const body = h.body(id);
      expect(body, id).not.toBeNull();
      expect(body?.visible, id).toBe(true);
      expect([body?.position.x, body?.position.y, body?.position.z], id).toEqual([seat?.x, 0, seat?.z]);
      expect(Math.cos((body?.rotation.y ?? 0) - (seat?.facing ?? 0)), id).toBeCloseTo(1);
    }
    expect(h.fx.bubbles).toHaveLength(0);
    expect(h.fx.bursts).toHaveLength(0);
  });

  it("sits people at chair height from the very first frame (no blend from standing)", () => {
    const h = harness();
    h.apply(company({ phase: "coworking", team: { engineering: 1 } }));
    const body = h.body("engineering-0") as THREE.Object3D;
    // What is drawn, in the body's own frame — not the invisible click box around it.
    const bounds = new THREE.Box3();
    expect(computeLocalBounds(body, bounds)).toBe(true);
    // Standing, the feet are on the floor. On a 0.45 chair these short legs dangle well clear of it.
    expect(bounds.min.y).toBeGreaterThan(0.05);
    expect(bounds.min.y).toBeLessThan(0.45);
    expect(bounds.max.y).toBeGreaterThan(1.1);
  });

  it("registers each person with their label and a head anchor that follows them", () => {
    const h = harness();
    h.apply(company({ team: { engineering: 1 } }));
    const founder = h.registry.entries.get("person:founder");
    expect(founder?.options.label).toBe("Robin — Founder");
    expect(founder?.target).toEqual({ kind: "person", personId: "founder" });
    const anchor = founder?.options.anchor;
    expect(anchor).toBeDefined();
    // The anchor is part of the character, above its head.
    let parent = anchor?.parent ?? null;
    while (parent && parent !== founder?.object) parent = parent.parent;
    expect(parent).toBe(founder?.object);
    const head = new THREE.Vector3();
    anchor?.getWorldPosition(head);
    expect(head.y).toBeGreaterThan(1);
    expect(founder?.options.anchorHeight).toBeLessThan(0.5);
    expect(h.registry.entries.get("person:engineering-0")?.options.label).toMatch(/ — Engineer$/);
  });

  it("shows only the founder until setup completes, and relabels them when they get a name", () => {
    const h = harness();
    h.apply(company({ setup: false, team: { engineering: 1 } }));
    expect(h.people()).toHaveLength(1);
    expect(h.registry.entries.get("person:founder")?.options.label).toBe("Founder — Founder");
    const before = h.body("founder");
    h.apply({ ...company({ setup: false, team: { engineering: 1 } }), founder: { name: "Grace", archetype: null } });
    expect(h.registry.entries.get("person:founder")?.options.label).toBe("Grace — Founder");
    expect(h.body("founder")).toBe(before);
    expect(h.registry.entries.size).toBe(1);
  });

  it("walks a hire in: hidden at first, waving at the door, moving every frame, dust when they sit", () => {
    const h = harness();
    h.apply(company({ team: { engineering: 1 } }));
    h.apply(company({ team: { engineering: 2 } }), [hired("engineering", 1)]);
    const body = h.body("engineering-1") as THREE.Object3D;
    expect(body).not.toBeNull();
    // Nobody flashes into view at their desk (or the origin) before the walk starts.
    expect(body.visible).toBe(false);

    h.run(0.1);
    expect(body.visible).toBe(true);
    expect(h.fx.bubbles.map((bubble) => bubble.icon)).toEqual(["wave"]);
    expect(h.fx.bubbles[0].anchor.name).toBe("head-anchor");
    const start = body.position.clone();
    // They appear just outside the door, not at the origin or at their desk.
    const door = h.studio.layout.door;
    expect(Math.hypot(start.x - door.x, start.z - door.z)).toBeLessThan(1.2);

    h.run(1);
    expect(body.position.distanceTo(start)).toBeGreaterThan(0.8);
    expect(body.position.y).toBe(0);

    h.run(20);
    const seat = h.studio.seating.seatOf("engineering-1");
    expect([body.position.x, body.position.z]).toEqual([seat?.x, seat?.z]);
    expect(body.scale.x).toBe(1);
    expect(h.fx.bursts).toHaveLength(1);
    expect(h.fx.bursts[0].kind).toBe("dust");
    expect([h.fx.bursts[0].at.x, h.fx.bursts[0].at.z]).toEqual([seat?.x, seat?.z]);
  });

  it("makes a leaver unclickable at once and removes them from the scene when they reach the door", () => {
    const h = harness();
    h.apply(company({ team: { engineering: 2 } }));
    const leaver = h.body("engineering-1") as THREE.Object3D;
    h.apply(company({ team: { engineering: 1 } }), [departed("engineering", 1)]);
    expect(h.body("engineering-1")).toBeNull();
    expect(leaver.parent).not.toBeNull();
    h.run(0.6);
    // The box of desk things is in their arms.
    let meshes = 0;
    leaver.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.visible) meshes += 1;
    });
    expect(meshes).toBe(9);
    h.run(20);
    expect(leaver.parent).toBeNull();
    expect(h.people()).toHaveLength(3);
  });

  it("keeps a re-hire clickable while the previous holder of the id is still walking out", () => {
    const h = harness();
    h.apply(company({ team: { sales: 1 } }));
    const old = h.body("sales-0");
    h.apply(company({ team: {} }), [departed("sales", 0)]);
    h.run(0.5);
    h.apply(company({ team: { sales: 1 } }), [hired("sales", 0)]);
    const fresh = h.body("sales-0");
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(old);
    expect(h.people()).toHaveLength(4);
    h.run(20);
    // The old body's removal must not take the new registration with it.
    expect(h.body("sales-0")).toBe(fresh);
    expect(h.people()).toHaveLength(3);
  });

  it("sends sparkles from builders' heads to the product wall when a feature ships", () => {
    const h = harness();
    const state = company({ phase: "office", team: { engineering: 2 } });
    h.apply(state);
    h.apply(state, [{ type: "ship", ok: true, reputationDelta: 2 }]);
    h.run(1.5);
    expect(h.fx.bubbles.map((bubble) => bubble.icon)).toEqual(["code", "code"]);
    expect(h.fx.streams).toHaveLength(2);
    const wall = h.studio.layout.stations.ship;
    for (const stream of h.fx.streams) {
      expect(stream.kind).toBe("sparkle");
      expect([stream.to.x, stream.to.z]).toEqual([wall.x, wall.z]);
      expect(stream.to.y).toBeGreaterThan(1);
      expect(stream.from.y).toBeGreaterThan(1);
    }
    // Each stream starts at a different person.
    expect(h.fx.streams[0].from.x === h.fx.streams[1].from.x && h.fx.streams[0].from.z === h.fx.streams[1].from.z).toBe(false);
  });

  it("hides everyone while the office is rebuilt and never shows a zero-scale body", () => {
    const h = harness(false);
    h.apply(company({ phase: "garage", team: { engineering: 2 } }));
    h.apply(company({ phase: "coworking", team: { engineering: 2 } }), [
      { type: "phase-changed", from: "garage", to: "coworking" },
    ]);
    for (const body of h.people()) expect(body.visible).toBe(false);
    for (let i = 0; i < 90; i += 1) {
      h.run(1 / 60);
      for (const body of h.people()) if (body.visible) expect(body.scale.x).toBeGreaterThan(0);
    }
    for (const id of ["founder", "cofounder", "engineering-0", "engineering-1"]) {
      const seat = h.studio.seating.seatOf(id);
      const body = h.body(id);
      expect(body?.visible, id).toBe(true);
      expect([body?.position.x, body?.position.z, body?.scale.x], id).toEqual([seat?.x, seat?.z, 1]);
    }
  });

  it("applies snapshots correctly while the loop is not running", () => {
    const h = harness();
    h.apply(company({ phase: "garage", team: { engineering: 1 } }));
    h.apply(company({ phase: "garage", team: { engineering: 1 }, over: "bankruptcy" }), [
      { type: "game-over", ending: "bankruptcy" },
    ]);
    // No update has run: the founders are still shown, in their seats.
    expect(h.body("founder")?.visible).toBe(true);
    expect(h.body("engineering-0")).toBeNull();
  });

  it("tells the office which chairs are in use and who has gone home", () => {
    const h = harness(false);
    const team = { engineering: 2 };
    h.apply(company({ phase: "office", team }));
    h.run(0.1);
    const chairs = h.signals.chairsOut!;
    expect([...chairs.keys()].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1]);
    expect([...chairs.values()].every((out) => out === 0)).toBe(true);
    expect(h.signals.vacated!.size).toBe(0);

    h.apply(company({ phase: "office", team, over: "bankruptcy" }), [{ type: "game-over", ending: "bankruptcy" }]);
    // Slumped at their desks first…
    expect(h.signals.vacated!.size).toBe(0);
    // …then up, out, and gone: their desks are vacated and nobody is using their chairs.
    h.run(15);
    expect([...h.signals.vacated!].sort()).toEqual(["engineering-0", "engineering-1"]);
    expect([...chairs.keys()].sort((a, b) => a - b)).toEqual([-2, -1]);
  });

  it("vacates the staff's desks at once when a lost game is loaded", () => {
    const h = harness();
    h.apply(company({ phase: "office", team: { engineering: 3 }, over: "forced-acquisition" }));
    expect([...h.signals.vacated!].sort()).toEqual(["engineering-0", "engineering-1", "engineering-2"]);
  });

  it("leaves nothing behind on dispose, and can be built again afterwards", () => {
    const h = harness();
    h.apply(company({ team: { engineering: 4, sales: 2 } }));
    h.apply(company({ team: { engineering: 3, sales: 3 } }), [departed("engineering", 3), hired("sales", 2)]);
    h.run(0.7);
    h.system.dispose();
    expect(h.registry.entries.size).toBe(0);
    expect(h.scene.getObjectByName("people")).toBeUndefined();
    expect(h.scene.children).toHaveLength(0);
    // Disposing twice is harmless.
    h.system.dispose();

    const again = harness();
    again.apply(company({ team: { engineering: 4 } }));
    expect(again.people()).toHaveLength(6);
    again.system.dispose();
  });

  it("does not grow the scene over many hire / fire cycles", () => {
    const h = harness();
    h.apply(company({ team: { engineering: 2 } }));
    for (let cycle = 0; cycle < 30; cycle += 1) {
      h.apply(company({ team: { engineering: 3 } }), [hired("engineering", 2)]);
      h.run(0.4);
      h.apply(company({ team: { engineering: 2 } }), [departed("engineering", 2)]);
      h.run(0.4);
    }
    h.run(30);
    expect(h.people()).toHaveLength(4);
    expect(h.registry.entries.size).toBe(4);
  });
});
