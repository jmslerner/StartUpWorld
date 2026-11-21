import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { TeamRole } from "../../types/game";
import { COFOUNDER_OUTFIT, disposeSharedResources, EXEC_TIE, FOUNDER_OUTFIT, ROLE_COLORS, sharedResourceStats } from "../core/palette";
import type { PersonView } from "../types";
import {
  CHARACTER_HEIGHT,
  CHARACTER_POSES,
  createCharacter,
  deriveLook,
  FLOOR_SEAT_Y,
  HAIR_STYLES,
  SEAT_Y,
} from "./Character";
import type { CharacterHandle, CharacterPose } from "./Character";

const ROLES: readonly TeamRole[] = ["engineering", "design", "product", "data", "marketing", "sales", "ops", "hr", "legal", "executive"];

const employee = (role: TeamRole, look: number): PersonView => ({ id: `${role}-0`, kind: "employee", role, name: role, look });
const founder = (look = 7): PersonView => ({ id: "founder", kind: "founder", role: null, name: "Robin", look });
const cofounder = (look = 9): PersonView => ({ id: "cofounder", kind: "cofounder", role: null, name: "Sam", look });

const CAST: readonly PersonView[] = [founder(), cofounder(), ...ROLES.map((role, i) => employee(role, 1000 + i * 77))];

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
};

const boundsOf = (root: THREE.Object3D): THREE.Box3 => {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
};

/** The limb pivots sit either side of the centre line: legs at hip height (y = 0 on the hips), arms at the shoulders. */
const limbPivots = (character: CharacterHandle, kind: "leg" | "arm"): THREE.Object3D[] => {
  const pivots: THREE.Object3D[] = [];
  character.group.traverse((object) => {
    if (object.type !== "Group" || Math.abs(object.position.x) < 0.05) return;
    if ((kind === "leg") === (object.position.y === 0)) pivots.push(object);
  });
  return pivots;
};

/** Bounds of both whole legs (thigh, shin and shoe). */
const legBounds = (character: CharacterHandle): THREE.Box3 => {
  character.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const pivot of limbPivots(character, "leg")) bounds.expandByObject(pivot, true);
  return bounds;
};

/** Underside of the thighs — where a seated character meets its seat. */
const thighBottom = (character: CharacterHandle): number => {
  character.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const pivot of limbPivots(character, "leg")) {
    for (const child of pivot.children) if ((child as THREE.Mesh).isMesh) bounds.expandByObject(child, true);
  }
  return bounds.min.y;
};

const SEATED: readonly CharacterPose[] = ["sit", "type", "slump", "sleep"];

afterEach(() => {
  disposeSharedResources();
});

describe("deriveLook", () => {
  it("is deterministic", () => {
    expect(deriveLook(employee("design", 12345))).toEqual(deriveLook(employee("design", 12345)));
    expect(deriveLook(employee("design", 12345))).not.toEqual(deriveLook(employee("design", 12346)));
  });

  it("gives every role its colour, with only a whisker of shade variety", () => {
    for (const role of ROLES) {
      if (role === "executive") continue;
      const base = new THREE.Color(ROLE_COLORS[role]);
      for (let seed = 0; seed < 40; seed += 1) {
        const top = new THREE.Color(deriveLook(employee(role, seed * 7919)).top);
        const distance = Math.hypot(top.r - base.r, top.g - base.g, top.b - base.b);
        expect(distance, `${role} seed ${seed}`).toBeLessThan(0.3);
      }
    }
  });

  it("dresses founders, cofounders and executives specially", () => {
    const f = deriveLook(founder());
    expect(f.outfit).toBe("hoodie");
    expect(f.top).toBe(FOUNDER_OUTFIT.top);
    expect(f.trim).toBe(FOUNDER_OUTFIT.trim);
    const c = deriveLook(cofounder());
    expect(c.top).toBe(COFOUNDER_OUTFIT.top);
    expect(c.trim).toBe(COFOUNDER_OUTFIT.trim);
    const e = deriveLook(employee("executive", 4));
    expect(e.outfit).toBe("suit");
    expect(e.top).toBe(ROLE_COLORS.executive);
    expect(e.trim).toBe(EXEC_TIE);
  });

  it("varies skin, hair and height across a crowd", () => {
    const styles = new Set<string>();
    const skins = new Set<number>();
    const hairs = new Set<number>();
    const accessories = new Set<string>();
    for (let seed = 0; seed < 400; seed += 1) {
      const look = deriveLook(employee(ROLES[seed % 9], Math.imul(seed + 1, 2654435761) >>> 0));
      styles.add(look.hairStyle);
      skins.add(look.skin);
      hairs.add(look.hair);
      accessories.add(look.accessory);
      expect(look.scale).toBeGreaterThanOrEqual(0.92);
      expect(look.scale).toBeLessThanOrEqual(1.08);
    }
    expect(styles.size).toBe(HAIR_STYLES.length);
    for (const style of ["bald", "cap", "bun", "long"]) expect(styles.has(style), style).toBe(true);
    expect(skins.size).toBeGreaterThanOrEqual(5);
    expect(hairs.size).toBeGreaterThanOrEqual(5);
    expect(accessories).toEqual(new Set(["none", "glasses", "headphones"]));
  });
});

describe("createCharacter", () => {
  it("builds every kind of person in every pose within the mesh budget", () => {
    for (const view of CAST) {
      for (const pose of CHARACTER_POSES) {
        const name = `${view.id} / ${pose}`;
        const character = createCharacter(view);
        character.setPose(pose, { immediate: true });
        character.setWalkSpeed(1.2);
        for (let frame = 0; frame < 90; frame += 1) character.update(1 / 30, frame / 30);

        const meshes = meshesOf(character.group);
        expect(meshes.length, `${name} meshes`).toBeGreaterThanOrEqual(6);
        expect(meshes.length, `${name} meshes`).toBeLessThanOrEqual(12);
        const bounds = boundsOf(character.group);
        for (const value of [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]) {
          expect(Number.isFinite(value), `${name} finite`).toBe(true);
        }
        expect(bounds.min.y, `${name} stays above the floor`).toBeGreaterThan(-0.03);
        expect(bounds.max.y, `${name} height`).toBeLessThan(2.2);
        character.dispose();
      }
    }
  });

  it("stands about 1.5 tall with its feet on the floor, facing +Z", () => {
    for (const view of CAST) {
      const character = createCharacter(view);
      const bounds = boundsOf(character.group);
      expect(bounds.min.y, view.id).toBeCloseTo(0, 2);
      expect(character.height, view.id).toBeGreaterThan(CHARACTER_HEIGHT * 0.88);
      expect(character.height, view.id).toBeLessThan(CHARACTER_HEIGHT * 1.1);
      expect(bounds.max.y, view.id).toBeGreaterThan(character.height - 0.02);
      // Shoes stick out in front: the legs reach further toward +Z than −Z.
      expect(limbPivots(character, "leg")).toHaveLength(2);
      const legs = legBounds(character);
      expect(legs.max.z, view.id).toBeGreaterThan(-legs.min.z);
      character.dispose();
    }
  });

  it("puts seated characters on a 0.45 seat whatever their height", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const view = employee("engineering", seed * 104729 + 3);
      for (const pose of SEATED) {
        const character = createCharacter(view);
        character.setPose(pose, { immediate: true });
        character.update(1 / 60, 0);
        expect(thighBottom(character), `${pose} seed ${seed}`).toBeGreaterThan(SEAT_Y - 0.035);
        expect(thighBottom(character), `${pose} seed ${seed}`).toBeLessThan(SEAT_Y + 0.02);
        // Shins hang from the knee; the feet stay clear of the floor.
        expect(legBounds(character).min.y, `${pose} seed ${seed} feet`).toBeGreaterThan(0.1);
        character.dispose();
      }
      const lounger = createCharacter(view);
      lounger.setPose("floor-sit", { immediate: true });
      lounger.update(1 / 60, 0);
      expect(thighBottom(lounger), `floor-sit seed ${seed}`).toBeGreaterThan(FLOOR_SEAT_Y - 0.035);
      expect(thighBottom(lounger), `floor-sit seed ${seed}`).toBeLessThan(FLOOR_SEAT_Y + 0.02);
      lounger.dispose();
    }
  });

  it("lets cheer, slump, sleep and phone work seated or standing", () => {
    const character = createCharacter(employee("sales", 5));
    character.setPose("cheer", { immediate: true });
    const standing = boundsOf(character.group).min.y;
    character.setPose("cheer", { seated: true, immediate: true });
    expect(thighBottom(character)).toBeGreaterThan(SEAT_Y - 0.05);
    expect(standing).toBeLessThan(0.2);
    character.setPose("phone", { seated: true, immediate: true });
    expect(thighBottom(character)).toBeGreaterThan(SEAT_Y - 0.05);
    character.setPose("slump", { seated: false, immediate: true });
    expect(boundsOf(character.group).min.y).toBeLessThan(0.05);
    character.dispose();
  });

  it("keeps the head anchor on top of the head", () => {
    const character = createCharacter(employee("product", 21));
    const position = new THREE.Vector3();
    character.group.updateMatrixWorld(true);
    character.headAnchor.getWorldPosition(position);
    expect(position.y).toBeGreaterThan(character.height);
    expect(position.y).toBeLessThan(character.height + 0.35);

    character.setPose("sit", { immediate: true });
    character.group.updateMatrixWorld(true);
    character.headAnchor.getWorldPosition(position);
    expect(position.y).toBeGreaterThan(1.3);
    character.dispose();
  });

  it("blends between poses instead of snapping", () => {
    const character = createCharacter(employee("marketing", 8));
    const arms = limbPivots(character, "arm");
    expect(arms).toHaveLength(2);
    const lift = (): number => Math.abs(arms[0].rotation.x);
    const resting = lift();
    character.setPose("cheer");
    character.update(0.02, 0.02);
    const early = lift();
    for (let i = 0; i < 30; i += 1) character.update(0.02, 0.04 + i * 0.02);
    const late = lift();
    expect(resting).toBeLessThan(0.2);
    expect(late).toBeGreaterThan(2.4);
    expect(early).toBeGreaterThan(resting);
    expect(early).toBeLessThan(late * 0.4);
    expect(character.getPose()).toBe("cheer");
    character.dispose();
  });

  it("walks faster with more speed and stands still with none", () => {
    const stride = (speed: number): number => {
      const character = createCharacter(employee("ops", 3));
      character.setPose("walk", { immediate: true });
      character.setWalkSpeed(speed);
      let widest = 0;
      for (let i = 0; i < 60; i += 1) {
        character.update(1 / 30, i / 30);
        const bounds = boundsOf(character.group);
        widest = Math.max(widest, bounds.max.z - bounds.min.z);
      }
      character.dispose();
      return widest;
    };
    expect(stride(1.2)).toBeGreaterThan(stride(0) + 0.1);
  });

  it("slouches when energy is low", () => {
    const headHeight = (energy: number): number => {
      const character = createCharacter(employee("hr", 14));
      character.setEnergy(energy);
      character.setPose("sit", { immediate: true });
      const top = boundsOf(character.group).max.y;
      character.dispose();
      return top;
    };
    expect(headHeight(0)).toBeLessThan(headHeight(1));
  });

  it("dims and tints by swapping shared materials, and owns nothing", () => {
    const character = createCharacter(founder());
    const meshes = meshesOf(character.group);
    const normal = meshes[0].material;
    character.setDimmed(true);
    expect(meshes[0].material).not.toBe(normal);
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1);
    character.setDimmed(false);
    expect(meshes[0].material).toBe(normal);
    character.setTint(0xff8888);
    expect(meshes[0].material).not.toBe(normal);
    character.setTint(null);
    expect(meshes[0].material).toBe(normal);

    const parent = new THREE.Group();
    parent.add(character.group);
    character.dispose();
    expect(character.group.parent).toBeNull();
  });

  it("builds each person the same whoever was built before them (no cache-key collisions)", () => {
    const signature = (view: PersonView): string => {
      const character = createCharacter(view);
      character.setPose("floor-sit", { immediate: true });
      character.setPose("phone", { immediate: true });
      const meshes = meshesOf(character.group).map((mesh) => {
        const colors = mesh.geometry.getAttribute("color");
        let sum = 0;
        for (let i = 0; i < colors.count; i += 7) sum += colors.getX(i) + colors.getY(i) * 2 + colors.getZ(i) * 3;
        return `${mesh.geometry.getAttribute("position").count}:${sum.toFixed(3)}`;
      });
      const bounds = boundsOf(character.group);
      character.dispose();
      return `${meshes.join(",")} @ ${bounds.max.y.toFixed(4)}`;
    };
    const crowd: PersonView[] = [founder(3), cofounder(4)];
    for (let i = 0; i < 150; i += 1) crowd.push(employee(ROLES[i % ROLES.length], Math.imul(i + 11, 2246822519) >>> 0));
    const together = crowd.map(signature);
    crowd.forEach((view, i) => {
      disposeSharedResources();
      expect(signature(view), `${view.id} #${i}`).toBe(together[i]);
    });
  });

  it("shares geometry between people who look alike, and survives a cache reset", () => {
    const a = createCharacter(employee("data", 99));
    const before = sharedResourceStats().geometries;
    const b = createCharacter(employee("data", 99));
    expect(sharedResourceStats().geometries).toBe(before);
    expect(meshesOf(a.group).map((mesh) => mesh.geometry)).toEqual(meshesOf(b.group).map((mesh) => mesh.geometry));
    a.dispose();
    b.dispose();

    disposeSharedResources();
    const again = createCharacter(employee("data", 99));
    again.setPose("floor-sit", { immediate: true });
    again.setPose("phone");
    again.update(0.016, 1);
    expect(meshesOf(again.group).length).toBeLessThanOrEqual(12);
    again.dispose();
  });
});
