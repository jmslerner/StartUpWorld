import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { nextCast } from "../cast";
import type { CastMember } from "../cast";
import { disposeSharedResources, ROLE_COLORS, sharedResourceStats } from "../core/palette";
import { TEAMS } from "../types";
import type { OfficeIndex, Team } from "../types";
import {
  CHARACTER_HEIGHT,
  CHARACTER_POSES,
  createCharacter,
  deriveLook,
  HAIR_STYLES,
  PLAIN_SHIRT,
  SEAT_Y,
} from "./Character";
import type { CharacterHandle, CharacterLook, CharacterPose } from "./Character";
import { scene } from "./testKit";

type View = Pick<CastMember, "id" | "look" | "team">;

const employee = (team: Team | null, look: number): View => ({ id: `${team ?? "nobody"}-0`, team, look });

/** Somebody of each team, and somebody no team has yet. */
const CAST: readonly View[] = [...TEAMS.map((team, i) => employee(team, 1000 + i * 77)), employee(null, 4242)];

/** A look without its shirt: what must stay the same when the team changes. */
const face = (look: CharacterLook): Omit<CharacterLook, "team" | "top" | "trim"> => {
  const { team, top, trim, ...rest } = look;
  void team;
  void top;
  void trim;
  return rest;
};

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
    expect(deriveLook(employee("growth", 12345))).toEqual(deriveLook(employee("growth", 12345)));
    expect(deriveLook(employee("growth", 12345))).not.toEqual(deriveLook(employee("growth", 12346)));
  });

  it("gives every team its colour, with only a whisker of shade variety", () => {
    for (const role of TEAMS) {
      const base = new THREE.Color(ROLE_COLORS[role]);
      for (let seed = 0; seed < 40; seed += 1) {
        const top = new THREE.Color(deriveLook(employee(role, seed * 7919)).top);
        const distance = Math.hypot(top.r - base.r, top.g - base.g, top.b - base.b);
        expect(distance, `${role} seed ${seed}`).toBeLessThan(0.3);
      }
    }
  });

  it("the same cast member has the same face in every office and every year", () => {
    // One person followed through five offices, six years and three teams.
    let cast = nextCast(null, scene([1, 0, 0], { office: 0 }));
    const first = cast.people[0];
    const born = deriveLook(first);
    const teams: Array<[number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ];
    teams.forEach((counts, step) => {
      cast = nextCast(cast, scene(counts, { office: step as OfficeIndex, year: 1991 + step }));
      const member = cast.people.find((person) => person.id === first.id)!;
      expect(member.look).toBe(first.look);
      expect(face(deriveLook(member)), `year ${1991 + step}`).toEqual(face(born));
    });
    // The face is the look's alone: whatever the team, and with none at all.
    for (const team of [...TEAMS, null]) expect(face(deriveLook({ look: first.look, team }))).toEqual(face(born));
    // A later game with the same seed gives the same person the same face.
    const again = nextCast(null, scene([1, 0, 0], { office: 4, runId: "another" }));
    expect(face(deriveLook(again.people[0]))).toEqual(face(born));
  });

  it("somebody no team has yet wears a plain shirt", () => {
    const base = new THREE.Color(PLAIN_SHIRT);
    const top = new THREE.Color(deriveLook(employee(null, 99)).top);
    expect(Math.hypot(top.r - base.r, top.g - base.g, top.b - base.b)).toBeLessThan(0.3);
    expect(deriveLook(employee(null, 99)).team).toBeNull();
  });

  it("varies skin, hair and height across a crowd", () => {
    const styles = new Set<string>();
    const skins = new Set<number>();
    const hairs = new Set<number>();
    const accessories = new Set<string>();
    for (let seed = 0; seed < 400; seed += 1) {
      const look = deriveLook(employee(TEAMS[seed % TEAMS.length], Math.imul(seed + 1, 2654435761) >>> 0));
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
      const view = employee("product", seed * 104729 + 3);
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
    }
  });

  it("lets cheer, slump, sleep and phone work seated or standing", () => {
    const character = createCharacter(employee("growth", 5));
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
    const character = createCharacter(employee("growth", 8));
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
      const character = createCharacter(employee("product", 3));
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
      const character = createCharacter(employee("recruiting", 14));
      character.setEnergy(energy);
      character.setPose("sit", { immediate: true });
      const top = boundsOf(character.group).max.y;
      character.dispose();
      return top;
    };
    expect(headHeight(0)).toBeLessThan(headHeight(1));
  });

  it("dims and tints by swapping shared materials, and owns nothing", () => {
    const character = createCharacter(employee("product", 7));
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
    const signature = (view: View): string => {
      const character = createCharacter(view);
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
    const crowd: View[] = [employee(null, 3), employee(null, 4)];
    for (let i = 0; i < 150; i += 1) crowd.push(employee(TEAMS[i % TEAMS.length], Math.imul(i + 11, 2246822519) >>> 0));
    const together = crowd.map(signature);
    crowd.forEach((view, i) => {
      disposeSharedResources();
      expect(signature(view), `${view.id} #${i}`).toBe(together[i]);
    });
  });

  it("shares geometry between people who look alike, and survives a cache reset", () => {
    const a = createCharacter(employee("recruiting", 99));
    const before = sharedResourceStats().geometries;
    const b = createCharacter(employee("recruiting", 99));
    expect(sharedResourceStats().geometries).toBe(before);
    expect(meshesOf(a.group).map((mesh) => mesh.geometry)).toEqual(meshesOf(b.group).map((mesh) => mesh.geometry));
    a.dispose();
    b.dispose();

    disposeSharedResources();
    const again = createCharacter(employee("recruiting", 99));
    again.setCarrying(true);
    again.setPose("phone");
    again.update(0.016, 1);
    expect(meshesOf(again.group).length).toBeLessThanOrEqual(12);
    again.dispose();
  });

  it("a shirt is the team's colour, and changing team changes the shirt and nothing else", () => {
    const character = createCharacter(employee("product", 31337));
    const before = character.look;
    const meshes = meshesOf(character.group);
    const geometries = meshes.map((mesh) => mesh.geometry);
    const height = character.height;
    const anchor = character.headAnchor;
    const distance = (look: CharacterLook, team: Team): number => {
      const top = new THREE.Color(look.top);
      const base = new THREE.Color(ROLE_COLORS[team]);
      return Math.hypot(top.r - base.r, top.g - base.g, top.b - base.b);
    };
    expect(distance(before, "product")).toBeLessThan(0.3);

    character.setTeam("growth");
    const after = character.look;
    expect(after.team).toBe("growth");
    expect(distance(after, "growth")).toBeLessThan(0.3);
    expect(distance(after, "product")).toBeGreaterThan(0.3);
    expect(face(after)).toEqual(face(before));
    // Exactly what a person born into Growth with this face would wear.
    expect(after).toEqual(deriveLook(employee("growth", 31337)));

    // The same eight meshes: the torso and the two arms wear the new shirt, the rest is untouched.
    const now = meshesOf(character.group);
    expect(now).toEqual(meshes);
    const changed = now.map((mesh, i) => mesh.geometry !== geometries[i]);
    expect(changed.filter(Boolean)).toHaveLength(3);
    // The head, at the neck, is not one of them.
    const head = now.find((mesh) => mesh.parent?.children.some((child) => child.name === "head-anchor"))!;
    expect(changed[now.indexOf(head)]).toBe(false);
    expect(character.height).toBe(height);
    expect(character.headAnchor).toBe(anchor);

    // And it looks exactly like somebody who was built in that team.
    const born = createCharacter(employee("growth", 31337));
    expect(now.map((mesh) => mesh.geometry)).toEqual(meshesOf(born.group).map((mesh) => mesh.geometry));

    // Back again, and to no team at all.
    character.setTeam("product");
    expect(meshesOf(character.group).map((mesh) => mesh.geometry)).toEqual(geometries);
    expect(character.look).toEqual(before);
    character.setTeam(null);
    expect(character.look.team).toBeNull();
    expect(face(character.look)).toEqual(face(before));
    character.dispose();
    born.dispose();
  });

  it("changing to the team they are in changes nothing", () => {
    const character = createCharacter(employee("recruiting", 5));
    const look = character.look;
    const geometries = meshesOf(character.group).map((mesh) => mesh.geometry);
    character.setTeam("recruiting");
    expect(character.look).toBe(look);
    expect(meshesOf(character.group).map((mesh) => mesh.geometry)).toEqual(geometries);
    character.dispose();
  });

  it("costs eight meshes, and two more at most for what it holds", () => {
    const character = createCharacter(employee("growth", 77));
    expect(meshesOf(character.group)).toHaveLength(8);
    character.setCarrying(true);
    character.setPose("stand", { immediate: true });
    expect(meshesOf(character.group)).toHaveLength(9);
    character.setPose("phone", { immediate: true });
    expect(meshesOf(character.group)).toHaveLength(10);
    character.dispose();
  });
});
