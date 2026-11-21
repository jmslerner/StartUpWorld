import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraRig } from "../core/CameraRig";
import type { ScreenPoint } from "../types";
import { computeLocalBounds, createFootprint, footprintFromBounds } from "./footprint";
import { CLICK_THRESHOLD_PX, GestureRecognizer, type PointerKind } from "./gestures";
import { DEFAULT_ANCHOR_HEIGHT, InteractableStore } from "./picking";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const makeWorld = (): { scene: THREE.Scene; rig: CameraRig; store: InteractableStore } => {
  const scene = new THREE.Scene();
  const rig = new CameraRig();
  rig.setViewport(800, 600);
  rig.setFraming({ x: 0, z: 0 }, 12, { instant: true });
  const store = new InteractableStore(scene, rig.camera, () => rig.viewport);
  return { scene, rig, store };
};

const makeBox = (x: number, z: number, size = 1): THREE.Mesh => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
  box.position.set(x, size / 2, z);
  return box;
};

/** The renderer normally refreshes world matrices every frame; tests do it by hand. */
const settle = (scene: THREE.Scene): void => scene.updateMatrixWorld(true);

const centreOf = (rig: CameraRig, object: THREE.Object3D): ScreenPoint =>
  rig.project(object.getWorldPosition(new THREE.Vector3()));

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

describe("InteractableStore registry", () => {
  it("replaces an existing entry when the same target is registered again", () => {
    const { scene, rig, store } = makeWorld();
    const first = makeBox(-3, 0);
    const second = makeBox(3, 0);
    scene.add(first, second);
    settle(scene);

    store.register(first, { kind: "station", station: "ship" }, { label: "Old wall" });
    store.register(second, { kind: "station", station: "ship" }, { label: "New wall" });

    expect(store.size).toBe(1);
    expect(store.get({ kind: "station", station: "ship" })?.object).toBe(second);
    expect(store.get({ kind: "station", station: "ship" })?.label).toBe("New wall");
    // The object that lost its registration is no longer clickable.
    expect(store.pick(centreOf(rig, first))).toBeNull();
    expect(store.pick(centreOf(rig, second))?.label).toBe("New wall");
  });

  it("keeps one target per object when an object is re-registered as something else", () => {
    const { scene, store } = makeWorld();
    const box = makeBox(0, 0);
    scene.add(box);

    store.register(box, { kind: "empty-desk", slotIndex: 2 }, { label: "Empty desk" });
    store.register(box, { kind: "person", personId: "engineering-0" }, { label: "Engineer" });

    expect(store.size).toBe(1);
    expect(store.get({ kind: "empty-desk", slotIndex: 2 })).toBeNull();
    expect(store.get({ kind: "person", personId: "engineering-0" })?.object).toBe(box);
  });

  it("unregisters by object and shrugs at objects it has never seen", () => {
    const { scene, rig, store } = makeWorld();
    const box = makeBox(0, 0);
    scene.add(box);
    settle(scene);
    store.register(box, { kind: "door" }, { label: "Door" });

    store.unregister(new THREE.Object3D());
    expect(store.size).toBe(1);

    store.unregister(box);
    expect(store.size).toBe(0);
    expect(store.get({ kind: "door" })).toBeNull();
    expect(store.pick(centreOf(rig, box))).toBeNull();

    store.unregister(box);
    expect(store.size).toBe(0);
  });

  it("bumps its revision only when the set of entries changes", () => {
    const { store } = makeWorld();
    const box = makeBox(0, 0);
    const start = store.revision;
    store.unregister(box);
    store.clear();
    expect(store.revision).toBe(start);
    store.register(box, { kind: "door" }, { label: "Door" });
    const registered = store.revision;
    expect(registered).toBeGreaterThan(start);
    store.unregister(box);
    expect(store.revision).toBeGreaterThan(registered);
  });

  it("applies the documented defaults", () => {
    const { store } = makeWorld();
    const box = makeBox(0, 0);
    const anchor = new THREE.Object3D();
    store.register(box, { kind: "door" }, { label: "Door" });
    const plain = store.get({ kind: "door" });
    expect(plain?.anchor).toBe(box);
    expect(plain?.anchorHeight).toBe(DEFAULT_ANCHOR_HEIGHT);
    expect(plain?.noHighlight).toBe(false);

    store.register(box, { kind: "door" }, { label: "Door", anchor, anchorHeight: 0.4, noHighlight: true });
    const custom = store.get({ kind: "door" });
    expect(custom?.anchor).toBe(anchor);
    expect(custom?.anchorHeight).toBe(0.4);
    expect(custom?.noHighlight).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Picking
// ─────────────────────────────────────────────────────────────────────────────

describe("InteractableStore picking", () => {
  it("returns null over empty space and for an empty registry", () => {
    const { scene, rig, store } = makeWorld();
    expect(store.pick({ x: 400, y: 300 })).toBeNull();
    const box = makeBox(0, 0);
    scene.add(box);
    settle(scene);
    store.register(box, { kind: "door" }, { label: "Door" });
    expect(store.pick(rig.project({ x: 4, y: 0, z: 4 }))).toBeNull();
    expect(store.pick(centreOf(rig, box))?.label).toBe("Door");
  });

  it("picks whatever is nearest the camera along the ray", () => {
    const { scene, rig, store } = makeWorld();
    // Two boxes on the camera's line of sight: (2, 2) is nearer the camera than (0, 0),
    // and tall enough to cover the far one's centre on screen.
    const far = makeBox(0, 0);
    const near = makeBox(2, 2, 3);
    scene.add(far, near);
    settle(scene);
    store.register(far, { kind: "station", station: "servers" }, { label: "Far" });
    store.register(near, { kind: "station", station: "coffee" }, { label: "Near" });

    const sharedPixel = centreOf(rig, far);
    expect(store.pick(sharedPixel)?.label).toBe("Near");

    // Registration order must not matter.
    store.unregister(far);
    store.register(far, { kind: "station", station: "servers" }, { label: "Far" });
    expect(store.pick(sharedPixel)?.label).toBe("Near");

    near.visible = false;
    expect(store.pick(sharedPixel)?.label).toBe("Far");
  });

  it("maps a hit on a nested mesh up to the registered root", () => {
    const { scene, rig, store } = makeWorld();
    const person = new THREE.Group();
    const torso = new THREE.Group();
    const head = makeBox(0, 0, 0.4);
    head.position.set(0, 1.3, 0);
    torso.add(head);
    person.add(torso);
    person.position.set(-2, 0, 1);
    scene.add(person);
    settle(scene);
    store.register(person, { kind: "person", personId: "founder" }, { label: "Founder" });

    const hit = store.pick(centreOf(rig, head));
    expect(hit?.object).toBe(person);
    expect(hit?.target).toEqual({ kind: "person", personId: "founder" });
  });

  it("prefers the innermost registered object when registrations are nested", () => {
    const { scene, rig, store } = makeWorld();
    const desk = new THREE.Group();
    const top = makeBox(0, 0, 1);
    const phone = makeBox(0, 0, 0.2);
    phone.position.set(0, 1.1, 0);
    desk.add(top, phone);
    scene.add(desk);
    settle(scene);
    store.register(desk, { kind: "empty-desk", slotIndex: 0 }, { label: "Desk" });
    store.register(phone, { kind: "station", station: "investors" }, { label: "Phone" });

    expect(store.pick(centreOf(rig, phone))?.label).toBe("Phone");
    expect(store.pick(rig.project({ x: 0, y: 0.5, z: 0 }))?.label).toBe("Desk");
  });

  it("ignores objects that are no longer in the scene", () => {
    const { scene, rig, store } = makeWorld();
    const group = new THREE.Group();
    const box = makeBox(0, 0);
    group.add(box);
    scene.add(group);
    settle(scene);
    store.register(box, { kind: "door" }, { label: "Door" });
    const pixel = centreOf(rig, box);
    expect(store.pick(pixel)?.label).toBe("Door");

    // Removed through an ancestor, without anyone unregistering it.
    scene.remove(group);
    const entry = store.get({ kind: "door" });
    expect(entry).not.toBeNull();
    expect(entry && store.isLive(entry)).toBe(false);
    expect(store.pick(pixel)).toBeNull();

    scene.add(group);
    expect(store.pick(pixel)?.label).toBe("Door");
  });

  it("ignores hidden objects, including ones hidden through an ancestor or a child", () => {
    const { scene, rig, store } = makeWorld();
    const group = new THREE.Group();
    const root = new THREE.Group();
    const box = makeBox(0, 0);
    root.add(box);
    group.add(root);
    scene.add(group);
    settle(scene);
    store.register(root, { kind: "door" }, { label: "Door" });
    const pixel = centreOf(rig, box);

    for (const node of [box, root, group]) {
      node.visible = false;
      expect(store.pick(pixel)).toBeNull();
      node.visible = true;
      expect(store.pick(pixel)?.label).toBe("Door");
    }
  });

  it("accepts an invisible mesh flagged as a hit proxy", () => {
    const { scene, rig, store } = makeWorld();
    const phone = new THREE.Group();
    const proxy = makeBox(0, 0, 1.2);
    proxy.visible = false;
    phone.add(proxy);
    scene.add(phone);
    settle(scene);
    store.register(phone, { kind: "station", station: "investors" }, { label: "Phone" });
    const pixel = centreOf(rig, proxy);

    expect(store.pick(pixel)).toBeNull();
    proxy.userData.hitProxy = true;
    expect(store.pick(pixel)?.label).toBe("Phone");
    // A proxy does not keep a hidden object clickable.
    phone.visible = false;
    expect(store.pick(pixel)).toBeNull();
  });

  it("does not give thin lines a metre-wide hitbox", () => {
    const { scene, rig, store } = makeWorld();
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.5, -2), new THREE.Vector3(0, 0.5, 2)]);
    const wire = new THREE.Line(geometry, new THREE.LineBasicMaterial());
    scene.add(wire);
    settle(scene);
    store.register(wire, { kind: "door" }, { label: "Wire" });

    expect(store.pick(rig.project({ x: 0, y: 0.5, z: 0 }))?.label).toBe("Wire");
    expect(store.pick(rig.project({ x: 0.5, y: 0.5, z: 0 }))).toBeNull();
  });

  it("follows the camera", () => {
    const { scene, rig, store } = makeWorld();
    const box = makeBox(6, -6);
    scene.add(box);
    settle(scene);
    store.register(box, { kind: "door" }, { label: "Door" });

    const before = centreOf(rig, box);
    rig.panByPixels(-120, 60);
    rig.zoomAt(1.7, { x: 100, y: 500 });
    const after = centreOf(rig, box);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(50);
    expect(store.pick(after)?.label).toBe("Door");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anchors
// ─────────────────────────────────────────────────────────────────────────────

describe("InteractableStore anchors", () => {
  it("projects the anchor point: object origin plus anchorHeight", () => {
    const { scene, rig, store } = makeWorld();
    const desk = makeBox(3, -2);
    desk.position.y = 0;
    scene.add(desk);
    settle(scene);
    store.register(desk, { kind: "empty-desk", slotIndex: 4 }, { label: "Desk", anchorHeight: 1.2 });
    const entry = store.get({ kind: "empty-desk", slotIndex: 4 });
    if (!entry) throw new Error("entry missing");

    expect(store.anchorWorld(entry, new THREE.Vector3()).toArray()).toEqual([3, 1.2, -2]);
    const screen = store.projectEntry(entry);
    const expected = rig.project({ x: 3, y: 1.2, z: -2 });
    expect(screen?.x).toBeCloseTo(expected.x, 3);
    expect(screen?.y).toBeCloseTo(expected.y, 3);
  });

  it("uses a separate anchor object when one is given, and tracks it as it moves", () => {
    const { scene, rig, store } = makeWorld();
    const person = new THREE.Group();
    const head = new THREE.Object3D();
    head.position.set(0, 1.4, 0);
    person.add(head);
    person.position.set(-1, 0, 2);
    scene.add(person);
    store.register(person, { kind: "person", personId: "cofounder" }, { label: "Cofounder", anchor: head, anchorHeight: 0.3 });
    const entry = store.get({ kind: "person", personId: "cofounder" });
    if (!entry) throw new Error("entry missing");

    let screen = store.projectEntry(entry);
    let expected = rig.project({ x: -1, y: 1.7, z: 2 });
    expect(screen?.x).toBeCloseTo(expected.x, 3);
    expect(screen?.y).toBeCloseTo(expected.y, 3);

    // No manual matrix update: anchors must be right even between renders.
    person.position.set(4, 0, -3);
    screen = store.projectEntry(entry);
    expected = rig.project({ x: 4, y: 1.7, z: -3 });
    expect(screen?.x).toBeCloseTo(expected.x, 3);
    expect(screen?.y).toBeCloseTo(expected.y, 3);
  });

  it("returns null for anything that is not live", () => {
    const { scene, store } = makeWorld();
    const box = makeBox(0, 0);
    store.register(box, { kind: "door" }, { label: "Door" });
    const entry = store.get({ kind: "door" });
    if (!entry) throw new Error("entry missing");

    expect(store.projectEntry(entry)).toBeNull();
    scene.add(box);
    expect(store.projectEntry(entry)).not.toBeNull();
    box.visible = false;
    expect(store.projectEntry(entry)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gestures
// ─────────────────────────────────────────────────────────────────────────────

interface GestureLog {
  taps: Array<{ x: number; y: number; kind: PointerKind }>;
  pans: Array<[number, number]>;
  zooms: Array<{ factor: number; x: number; y: number }>;
  dragStarts: number;
  dragEnds: number;
}

const makeGestures = (): { gestures: GestureRecognizer; log: GestureLog } => {
  const log: GestureLog = { taps: [], pans: [], zooms: [], dragStarts: 0, dragEnds: 0 };
  const gestures = new GestureRecognizer({
    onTap: (point, kind) => log.taps.push({ x: point.x, y: point.y, kind }),
    onPan: (dx, dy) => log.pans.push([dx, dy]),
    onZoom: (factor, at) => log.zooms.push({ factor, x: at.x, y: at.y }),
    onDragStart: () => {
      log.dragStarts += 1;
    },
    onDragEnd: () => {
      log.dragEnds += 1;
    },
  });
  return { gestures, log };
};

const totalPan = (log: GestureLog): [number, number] =>
  log.pans.reduce<[number, number]>((sum, [dx, dy]) => [sum[0] + dx, sum[1] + dy], [0, 0]);

describe("GestureRecognizer", () => {
  it("treats a press that barely moves as a tap", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 100, 100);
    expect(gestures.pressed).toBe(true);
    gestures.move(1, 103, 102);
    gestures.move(1, 100 + CLICK_THRESHOLD_PX - 0.5, 100);
    gestures.up(1, 104, 101, "mouse");

    expect(log.taps).toEqual([{ x: 104, y: 101, kind: "mouse" }]);
    expect(log.pans).toEqual([]);
    expect(log.dragStarts).toBe(0);
    expect(gestures.pressed).toBe(false);
  });

  it("turns a press that leaves the threshold into a pan, with no tap and no jump", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 100, 100);
    gestures.move(1, 100 + CLICK_THRESHOLD_PX, 100);
    expect(gestures.dragging).toBe(true);
    expect(log.dragStarts).toBe(1);
    // Crossing the threshold starts the drag but does not itself move the view.
    expect(log.pans).toEqual([]);

    gestures.move(1, 120, 110);
    gestures.move(1, 150, 90);
    expect(totalPan(log)).toEqual([150 - (100 + CLICK_THRESHOLD_PX), -10]);

    // Coming back to the start does not turn it back into a click.
    gestures.move(1, 100, 100);
    gestures.up(1, 100, 100, "mouse");
    expect(log.taps).toEqual([]);
    expect(log.dragEnds).toBe(1);
    expect(gestures.dragging).toBe(false);
  });

  it("reports the pointer kind so touch taps can skip hover", () => {
    const { gestures, log } = makeGestures();
    gestures.down(7, 10, 10);
    gestures.up(7, 10, 10, "touch");
    expect(log.taps[0].kind).toBe("touch");
  });

  it("zooms and pans with two fingers, around their midpoint", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 100, 200);
    gestures.down(2, 200, 200);
    expect(log.dragStarts).toBe(1);

    // Spread to twice the distance, symmetrically: pure zoom about (150, 200).
    gestures.move(1, 50, 200);
    gestures.move(2, 250, 200);
    const factor = log.zooms.reduce((product, zoom) => product * zoom.factor, 1);
    expect(factor).toBeCloseTo(2, 9);
    expect(log.zooms[log.zooms.length - 1]).toMatchObject({ x: 150, y: 200 });
    expect(totalPan(log)[0]).toBeCloseTo(0, 9);

    // Move both fingers together: pure pan.
    log.zooms.length = 0;
    log.pans.length = 0;
    gestures.move(1, 50, 240);
    gestures.move(2, 250, 240);
    expect(totalPan(log)).toEqual([0, 40]);
    expect(log.zooms.reduce((product, zoom) => product * zoom.factor, 1)).toBeCloseTo(1, 9);
  });

  it("never ends a pinch as a tap, and carries on panning with the remaining finger", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 100, 100);
    gestures.down(2, 300, 100);
    gestures.up(2, 300, 100, "touch");
    expect(log.taps).toEqual([]);
    expect(gestures.dragging).toBe(true);

    log.pans.length = 0;
    gestures.move(1, 110, 105);
    expect(log.pans).toEqual([[10, 5]]);

    gestures.up(1, 110, 105, "touch");
    expect(log.taps).toEqual([]);
    expect(log.dragEnds).toBe(1);
  });

  it("ignores a third finger", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 0, 0);
    gestures.down(2, 100, 0);
    gestures.down(3, 50, 50);
    expect(gestures.isTracking(3)).toBe(false);
    gestures.move(3, 400, 400);
    expect(log.pans).toEqual([]);
    expect(log.zooms).toEqual([]);
  });

  it("drops a cancelled press without tapping", () => {
    const { gestures, log } = makeGestures();
    gestures.down(1, 10, 10);
    gestures.cancel(1);
    expect(gestures.pressed).toBe(false);
    expect(log.taps).toEqual([]);
    expect(log.dragEnds).toBe(0);

    gestures.down(1, 10, 10);
    gestures.move(1, 60, 10);
    gestures.cancel(1);
    expect(log.dragEnds).toBe(1);

    gestures.down(1, 10, 10);
    gestures.down(2, 90, 10);
    gestures.cancelAll();
    expect(gestures.pressed).toBe(false);
    expect(log.dragEnds).toBe(2);
    expect(log.taps).toEqual([]);
  });

  it("ignores moves and releases for pointers it is not tracking", () => {
    const { gestures, log } = makeGestures();
    gestures.move(9, 50, 50);
    gestures.up(9, 50, 50, "mouse");
    gestures.cancel(9);
    expect(log).toEqual({ taps: [], pans: [], zooms: [], dragStarts: 0, dragEnds: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Highlight footprints
// ─────────────────────────────────────────────────────────────────────────────

describe("highlight footprint", () => {
  it("hugs a rotated object instead of its axis-aligned bounds", () => {
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.6), new THREE.MeshBasicMaterial());
    top.position.y = 0.72;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), new THREE.MeshBasicMaterial());
    leg.position.set(0.9, 0.36, 0.2);
    desk.add(top, leg);
    desk.position.set(4, 0, -3);
    desk.rotation.y = Math.PI / 4;

    const bounds = new THREE.Box3();
    expect(computeLocalBounds(desk, bounds)).toBe(true);
    const footprint = footprintFromBounds(desk, bounds, createFootprint());

    expect(footprint.x).toBeCloseTo(4, 6);
    expect(footprint.z).toBeCloseTo(-3, 6);
    expect(footprint.yaw).toBeCloseTo(Math.PI / 4, 6);
    // Half the desk plus padding — not the ~0.92 half-diagonal a world-aligned box would give.
    expect(footprint.halfX).toBeCloseTo(1 + 0.14, 6);
    expect(footprint.halfZ).toBeCloseTo(0.3 + 0.14, 6);
    expect(footprint.radius).toBeLessThan(footprint.halfZ);
    // Sits just above the floor.
    expect(footprint.y).toBeGreaterThan(0);
    expect(footprint.y).toBeLessThan(0.1);
  });

  it("gives small, roughly square things a visible round ring", () => {
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 0.2), new THREE.MeshBasicMaterial());
    peg.position.set(0, 0.75, 0);
    const bounds = new THREE.Box3();
    computeLocalBounds(peg, bounds);
    const footprint = footprintFromBounds(peg, bounds, createFootprint());
    expect(footprint.halfX).toBeGreaterThan(0.4);
    expect(footprint.halfX).toBe(footprint.halfZ);
    expect(footprint.radius).toBe(footprint.halfX);
  });

  it("puts the ring on the floor under wall-mounted things and on the pad under raised ones", () => {
    const calendar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.05), new THREE.MeshBasicMaterial());
    calendar.position.set(0, 1.6, 0);
    const bounds = new THREE.Box3();
    computeLocalBounds(calendar, bounds);
    expect(footprintFromBounds(calendar, bounds, createFootprint()).y).toBeLessThan(0.1);

    const helicopter = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial());
    helicopter.position.set(0, 0.8, 0);
    computeLocalBounds(helicopter, bounds);
    const onPad = footprintFromBounds(helicopter, bounds, createFootprint());
    expect(onPad.y).toBeGreaterThan(0.3);
    expect(onPad.y).toBeLessThan(0.4);
  });

  it("skips hidden parts and copes with objects that have no geometry", () => {
    const group = new THREE.Group();
    const visible = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial());
    proxy.visible = false;
    group.add(visible, proxy);
    const bounds = new THREE.Box3();
    expect(computeLocalBounds(group, bounds)).toBe(true);
    expect(bounds.max.x).toBeCloseTo(0.5, 6);

    const empty = new THREE.Group();
    empty.position.set(2, 0, 5);
    expect(computeLocalBounds(empty, bounds)).toBe(false);
    const footprint = footprintFromBounds(empty, null, createFootprint());
    expect(footprint.x).toBe(2);
    expect(footprint.z).toBe(5);
    expect(footprint.halfX).toBeGreaterThan(0.3);
  });

  it("follows an object that moves without re-measuring it", () => {
    const person = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 0.4), new THREE.MeshBasicMaterial());
    person.position.set(0, 0.75, 0);
    const bounds = new THREE.Box3();
    computeLocalBounds(person, bounds);
    person.position.set(5, 0.75, -2);
    const footprint = footprintFromBounds(person, bounds, createFootprint());
    expect(footprint.x).toBeCloseTo(5, 6);
    expect(footprint.z).toBeCloseTo(-2, 6);
  });
});
