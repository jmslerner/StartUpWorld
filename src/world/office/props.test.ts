import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyPhase } from "../../types/game";
import {
  bakeModel,
  canDrawTextures,
  canvasTexture,
  createDynamicTexture,
  disposeSharedResources,
  mat,
  mixColor,
  ModelBuilder,
  PHASES,
  ROLE_COLORS,
  roundedRect,
  sharedResourceStats,
  unitBox,
  vertexMat,
} from "../core/palette";
import { ASSET_SIZES, CHAIR_SIZE, DESK_SIZE, OVERFLOW_SIZE, STATION_KINDS, STATION_SIZES, WALL_GAP } from "./footprints";
import {
  ASSET_FOOTPRINTS,
  createAsset,
  createChair,
  createDesk,
  createHelicopter,
  createOverflowSpot,
  createProductWall,
  createStation,
  createWall,
  DESK_STYLES,
  makeBlueprint,
  PROP_CATALOG,
  PROP_SETS,
  STATION_FOOTPRINTS,
} from "./props";
import type { CatalogEntry, PropHandle } from "./props";

const MESH_BUDGET = { hero: 25, decor: 10 } as const;

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

/** Bounds of the solid parts only: light pools, beams and other glows may spill past a footprint. */
const solidBoundsOf = (root: THREE.Object3D): THREE.Box3 => {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const mesh of meshesOf(root)) if (mesh.castShadow) bounds.expandByObject(mesh, true);
  return bounds;
};

const phasesFor = (entry: CatalogEntry): readonly CompanyPhase[] => (entry.styled ? PHASES : ["office"]);

/** Share of triangles whose winding disagrees with their vertex normals — i.e. faces that would render inside-out. */
const invertedShare = (geometry: THREE.BufferGeometry): number => {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!position || !normal) return 0;
  const count = index ? index.count : position.count;
  const a = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  let total = 0;
  let inverted = 0;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia);
    ab.fromBufferAttribute(position, ib).sub(a);
    ac.fromBufferAttribute(position, ic).sub(a);
    ab.cross(ac);
    if (ab.lengthSq() < 1e-16) continue;
    n.fromBufferAttribute(normal, ia).add(ac.fromBufferAttribute(normal, ib)).add(ac.fromBufferAttribute(normal, ic));
    total += 1;
    if (ab.dot(n) < 0) inverted += 1;
  }
  return total === 0 ? 0 : inverted / total;
};

/**
 * A stand-in for the browser's canvas: every drawing call is accepted and
 * ignored. With it installed the props take their "textures available" paths
 * (command plates, calendar pages, signs, price tags) in node too.
 */
const installFakeCanvas = (): void => {
  const makeContext = (canvas: object): unknown =>
    new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === "canvas") return canvas;
          if (property === "measureText") return () => ({ width: 10 });
          if (property === "createRadialGradient" || property === "createLinearGradient") return () => ({ addColorStop: () => undefined });
          return () => undefined;
        },
        set: () => true,
      }
    );
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: (): unknown => context };
      const context = makeContext(canvas);
      return canvas;
    },
  });
};

afterEach(() => {
  disposeSharedResources();
  vi.unstubAllGlobals();
});

describe("palette", () => {
  it("has a shirt colour for every role, as specified", () => {
    expect(ROLE_COLORS).toEqual({
      engineering: 0x7dd3fc,
      design: 0xf472b6,
      product: 0xa78bfa,
      data: 0x2dd4bf,
      marketing: 0xfb923c,
      sales: 0x4ade80,
      ops: 0xfacc15,
      hr: 0xfda4af,
      legal: 0x94a3b8,
      executive: 0x1f2937,
    });
  });

  it("shares materials and geometries, and rebuilds them after disposal", () => {
    const first = mat(0x123456, { emissive: 0xff0000 });
    expect(mat(0x123456, { emissive: 0xff0000 })).toBe(first);
    expect(mat(0x123456)).not.toBe(first);
    expect(vertexMat()).toBe(vertexMat());
    const box = unitBox();
    expect(unitBox()).toBe(box);
    expect(sharedResourceStats().materials).toBeGreaterThan(0);

    disposeSharedResources();
    expect(sharedResourceStats()).toEqual({ materials: 0, geometries: 0, textures: 0 });
    expect(mat(0x123456, { emissive: 0xff0000 })).not.toBe(first);
    expect(unitBox()).not.toBe(box);
  });

  it("returns null from the canvas helpers when there is no DOM", () => {
    expect(canDrawTextures()).toBe(false);
    expect(canvasTexture("test", 8, 8, () => undefined)).toBeNull();
    expect(createDynamicTexture(8, 8, () => undefined)).toBeNull();
  });

  it("mixes colours channel by channel", () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0x102030, 0x405060, 0)).toBe(0x102030);
    expect(mixColor(0x102030, 0x405060, 1)).toBe(0x405060);
  });

  it("bakes every primitive facing outward", () => {
    const builders: Record<string, (b: ModelBuilder) => void> = {
      box: (b) => b.box(1, 0.5, 0.3, 0xffffff),
      "sharp box": (b) => b.box(1, 0.5, 0.3, 0xffffff, 0, 0, 0, { r: 0 }),
      "round box": (b) => b.box(1, 0.5, 0.6, 0xffffff, 0, 0, 0, { r: 0.1, round: 3, taper: 0.8 }),
      "rotated box": (b) => b.box(1, 0.5, 0.3, 0xffffff, 1, 2, 3, { rx: 0.4, ry: 1.1, rz: -0.7, taper: 0.6 }),
      strut: (b) => b.strut([0, 0, 0], [0.4, 1, -0.2], 0.1, 0xffffff),
      tube: (b) => b.tube([0, 1, 0], [0.4, 0, -0.2], 0.1, 0xffffff, { taper: 0.5 }),
      cylinder: (b) => b.cyl(0.3, 1, 0xffffff, 0, 0, 0, { axis: "x", taper: 0.5 }),
      ball: (b) => b.ball(0.4, 0xffffff, 0, 0, 0, { sx: 1.3, sy: 0.6 }),
      blob: (b) => b.blob(0.4, 0xffffff),
      torus: (b) => b.torus(0.5, 0.1, 0xffffff, 0, 0, 0, { axis: "z", arc: Math.PI }),
      lathe: (b) =>
        b.lathe(
          [
            [0.2, 0],
            [0.4, 0.5],
            [0.1, 1],
          ],
          0xffffff
        ),
      prism: (b) => b.prism(roundedRect(1, 0.6, 0.1), 0.2, 0xffffff, 0, 0, 0, { bevel: 0.03 }),
      plate: (b) => b.plate(roundedRect(1, 0.6, 0.1), 0.2, 0xffffff),
      "mirrored group": (b) => b.place(0, 0, 0, { ry: 0.5, scale: 2 }, () => b.box(1, 1, 1, 0xffffff)),
    };
    for (const [name, build] of Object.entries(builders)) {
      const geometry = bakeModel(null, build);
      expect(geometry.getAttribute("position").count, name).toBeGreaterThan(0);
      expect(geometry.getAttribute("color").count, name).toBe(geometry.getAttribute("position").count);
      expect(invertedShare(geometry), name).toBe(0);
      geometry.dispose();
    }
  });

  it("anchors parts by their base", () => {
    const geometry = bakeModel(null, (b) => {
      b.box(1, 0.5, 1, 0xffffff, 0, 2, 0);
      b.cyl(0.2, 0.4, 0xffffff, 0, 2, 0, { axis: "x" });
      b.ball(0.3, 0xffffff, 0, 2, 0);
    });
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.y).toBeCloseTo(2, 5);
    geometry.dispose();
  });
});

describe("prop catalog", () => {
  it("covers every set and has unique ids", () => {
    const ids = PROP_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of PROP_SETS) expect(PROP_CATALOG.some((entry) => entry.set === set), set).toBe(true);
  });

  const buildAnimateDispose = (): void => {
    for (const entry of PROP_CATALOG) {
      for (const phase of phasesFor(entry)) {
        const name = `${entry.id} (${phase})`;
        const { handle, demo } = entry.create(phase);
        expect(handle.footprint.w, name).toBeGreaterThan(0);
        expect(handle.footprint.d, name).toBeGreaterThan(0);

        const meshes = meshesOf(handle.group);
        expect(meshes.length, name).toBeGreaterThan(0);
        expect(meshes.length, `${name} mesh count`).toBeLessThanOrEqual(MESH_BUDGET[entry.budget]);

        // Run a few seconds of game time, including the gallery's state changes.
        for (let frame = 0; frame < 240; frame += 1) {
          const elapsed = frame / 20;
          demo?.(elapsed);
          handle.update?.(1 / 20, elapsed);
        }
        handle.setGlow?.(0);
        handle.setGlow?.(1);
        handle.update?.(1 / 60, 13);

        const bounds = boundsOf(handle.group);
        expect(Number.isFinite(bounds.min.y) && Number.isFinite(bounds.max.y), `${name} finite bounds`).toBe(true);
        if (entry.mount === "floor") expect(Math.abs(bounds.min.y - entry.minY), `${name} sits on the floor`).toBeLessThan(0.04);
        if (entry.mount === "wall") expect(bounds.min.y, `${name} hangs clear of the floor`).toBeGreaterThan(0.3);

        const parent = new THREE.Group();
        parent.add(handle.group);
        handle.dispose();
        expect(handle.group.parent, `${name} detached`).toBeNull();
      }
    }
  };

  it("builds, animates and disposes every prop within budget", buildAnimateDispose);

  it("does the same when canvas textures are available, as in the browser", () => {
    installFakeCanvas();
    expect(canDrawTextures()).toBe(true);
    buildAnimateDispose();
    expect(sharedResourceStats().textures).toBeGreaterThan(0);
  });

  it("builds an identical second copy of every prop (cached geometry must not skip any setup)", () => {
    installFakeCanvas();
    const describeProp = (handle: PropHandle): { objects: number; meshes: number; bounds: number[] } => {
      handle.setGlow?.(1);
      handle.update?.(0.05, 0.4);
      let objects = 0;
      handle.group.traverse(() => {
        objects += 1;
      });
      const bounds = boundsOf(handle.group);
      return { objects, meshes: meshesOf(handle.group).length, bounds: [...bounds.min.toArray(), ...bounds.max.toArray()].map((value) => Math.round(value * 1e4)) };
    };
    for (const entry of PROP_CATALOG) {
      for (const phase of phasesFor(entry)) {
        const first = entry.create(phase).handle;
        const second = entry.create(phase).handle;
        expect(describeProp(second), `${entry.id} (${phase})`).toEqual(describeProp(first));
        first.dispose();
        second.dispose();
      }
    }
  });

  it("builds each prop the same whatever was built before it (no cache-key collisions)", () => {
    const signature = (handle: PropHandle): string => {
      const bounds = boundsOf(handle.group);
      const meshes = meshesOf(handle.group).map((mesh) => `${mesh.geometry.getAttribute("position").count}/${mesh.geometry.getIndex()?.count ?? 0}`);
      return `${meshes.join(",")} @ ${[...bounds.min.toArray(), ...bounds.max.toArray()].map((value) => value.toFixed(3)).join(" ")}`;
    };
    // First with one cache shared by everything, in catalog order…
    const shared = new Map<string, string>();
    for (const entry of PROP_CATALOG) {
      for (const phase of phasesFor(entry)) {
        const { handle } = entry.create(phase);
        shared.set(`${entry.id}/${phase}`, signature(handle));
        handle.dispose();
      }
    }
    // …then each one on its own from empty caches.
    for (const entry of PROP_CATALOG) {
      for (const phase of phasesFor(entry)) {
        disposeSharedResources();
        const { handle } = entry.create(phase);
        expect(signature(handle), `${entry.id} (${phase})`).toBe(shared.get(`${entry.id}/${phase}`));
        handle.dispose();
      }
    }
  });

  it("never bakes inside-out geometry", () => {
    for (const entry of PROP_CATALOG) {
      for (const phase of phasesFor(entry)) {
        const { handle } = entry.create(phase);
        for (const mesh of meshesOf(handle.group)) {
          expect(invertedShare(mesh.geometry), `${entry.id} (${phase}) / ${mesh.geometry.uuid}`).toBeLessThan(0.002);
        }
        handle.dispose();
      }
    }
  });

  it("can rebuild everything after the shared caches are disposed", () => {
    const build = (): PropHandle[] => PROP_CATALOG.flatMap((entry) => phasesFor(entry).map((phase) => entry.create(phase).handle));
    const first = build();
    for (const handle of first) handle.dispose();
    disposeSharedResources();
    expect(sharedResourceStats().geometries).toBe(0);

    const second = build();
    expect(sharedResourceStats().geometries).toBeGreaterThan(0);
    for (const handle of second) {
      handle.update?.(0.016, 1);
      expect(meshesOf(handle.group).length).toBeGreaterThan(0);
      handle.dispose();
    }
  });
});

describe("workstations", () => {
  it("builds every desk and chair tier inside the layout's footprints", () => {
    for (const style of DESK_STYLES) {
      for (const upgraded of [false, true]) {
        const desk = createDesk({ style, upgraded });
        expect(desk.footprint).toEqual({ w: DESK_SIZE.width, d: DESK_SIZE.depth });
        const bounds = boundsOf(desk.group);
        expect(bounds.max.x - bounds.min.x, `${style} width`).toBeLessThanOrEqual(DESK_SIZE.width + 0.03);
        // Monitors and cables may overhang the back edge a little; nothing reaches the sitter's side.
        expect(bounds.min.z, `${style} front`).toBeGreaterThanOrEqual(-DESK_SIZE.depth / 2 - 0.01);
        expect(bounds.max.z, `${style} back`).toBeLessThanOrEqual(DESK_SIZE.depth / 2 + 0.08);
        desk.dispose();
      }
      const chair = createChair({ style });
      const bounds = boundsOf(chair.group);
      expect(bounds.max.x - bounds.min.x, `${style} chair width`).toBeLessThanOrEqual(CHAIR_SIZE.width + 0.14);
      expect(bounds.max.z - bounds.min.z, `${style} chair depth`).toBeLessThanOrEqual(CHAIR_SIZE.depth + 0.14);
      chair.dispose();
    }
  });

  it("keeps the desk top at 0.72 and the legroom clear", () => {
    for (const style of DESK_STYLES) {
      const desk = createDesk({ style });
      const body = meshesOf(desk.group)[0];
      const position = body.geometry.getAttribute("position");
      let intruders = 0;
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        // The sitter's legs: a 0.36-wide slot under the near half of the top.
        if (Math.abs(x) < 0.18 && z < -0.02 && y > 0.3 && y < 0.6) intruders += 1;
      }
      expect(intruders, `${style} legroom`).toBe(0);
      desk.dispose();
    }
  });

  it("swaps a desk between occupied and vacant without leaking", () => {
    const desk = createDesk({ style: "standard", variant: 1 });
    const body = meshesOf(desk.group)[0];
    const busy = body.geometry;
    desk.setOccupied(false);
    expect(body.geometry).not.toBe(busy);
    expect(body.geometry.getAttribute("position").count).toBeLessThan(busy.getAttribute("position").count);
    desk.setOccupied(true);
    expect(body.geometry).toBe(busy);
    desk.setScreen("chart");
    desk.setScreenGlow(1);
    desk.setGlow?.(0.5);
    desk.dispose();
  });

  it("sizes the overflow beanbag to its reserved spot", () => {
    const spot = createOverflowSpot({ variant: 2 });
    expect(spot.footprint).toEqual({ w: OVERFLOW_SIZE.width, d: OVERFLOW_SIZE.depth });
    const bounds = boundsOf(spot.group);
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(OVERFLOW_SIZE.width + 0.02);
    spot.setOccupied(true);
    expect(meshesOf(spot.group).some((mesh) => !mesh.visible)).toBe(true);
    spot.dispose();
  });
});

describe("stations", () => {
  it("fits every station of every phase inside the rectangle the layout reserves", () => {
    for (const phase of PHASES) {
      for (const kind of STATION_KINDS) {
        const name = `${kind} (${phase})`;
        const station = createStation(kind, phase);
        const size = STATION_SIZES[phase][kind];
        expect(station.kind, name).toBe(kind);
        expect(station.phase, name).toBe(phase);
        expect(station.footprint, name).toEqual({ w: size.width, d: size.depth });
        expect(STATION_FOOTPRINTS[phase][kind], name).toEqual(station.footprint);

        station.update?.(0.016, 0.5);
        const bounds = solidBoundsOf(station.group);
        const slack = 0.06;
        expect(bounds.min.x, `${name} left`).toBeGreaterThanOrEqual(-size.width / 2 - slack);
        expect(bounds.max.x, `${name} right`).toBeLessThanOrEqual(size.width / 2 + slack);
        expect(bounds.max.z, `${name} front`).toBeLessThanOrEqual(size.depth / 2 + slack);
        // Wall stations may reach back across the wall gap, but never into the wall.
        expect(bounds.min.z, `${name} back`).toBeGreaterThanOrEqual(-size.depth / 2 - WALL_GAP);
        station.dispose();
      }
    }
  });

  it("gives every station its command plate when text can be drawn", () => {
    const textured = (root: THREE.Object3D): number =>
      meshesOf(root).filter((mesh) => (mesh.material as THREE.MeshLambertMaterial).map != null).length;
    const plain = STATION_KINDS.map((kind) => {
      const station = createStation(kind, "office");
      const count = textured(station.group);
      station.dispose();
      return count;
    });
    disposeSharedResources();
    installFakeCanvas();
    STATION_KINDS.forEach((kind, i) => {
      // Twice: the second build is served from the caches and must be just as complete.
      for (let copy = 0; copy < 2; copy += 1) {
        const station = createStation(kind, "office");
        expect(textured(station.group), `${kind} copy ${copy}`).toBeGreaterThan(plain[i]);
        station.dispose();
      }
    });
  });

  it("reveals sticky notes with a draw range", () => {
    const wall = createProductWall("office");
    const notes = meshesOf(wall.group)[1];
    wall.setNoteCount(0);
    expect(notes.geometry.drawRange.count).toBe(0);
    wall.setNoteCount(5);
    const five = notes.geometry.drawRange.count;
    expect(five).toBeGreaterThan(0);
    wall.setNoteCount(wall.maxNotes + 100);
    expect(notes.geometry.drawRange.count).toBe((five / 5) * wall.maxNotes);
    expect(notes.geometry.drawRange.count).toBe(notes.geometry.getIndex()?.count);
    wall.pulse("bad");
    wall.update?.(0.1, 1);
    wall.dispose();
  });
});

describe("assets", () => {
  it("fits every asset inside its reserved ground", () => {
    for (const assetId of Object.keys(ASSET_SIZES) as Array<keyof typeof ASSET_SIZES>) {
      const asset = createAsset(assetId);
      const size = ASSET_SIZES[assetId];
      expect(asset.footprint).toEqual(ASSET_FOOTPRINTS[assetId]);
      expect(asset.footprint).toEqual({ w: size.width, d: size.depth });
      asset.update?.(0.016, 0.3);
      const bounds = solidBoundsOf(asset.group);
      expect(bounds.max.x - bounds.min.x, `${assetId} width`).toBeLessThanOrEqual(size.width + 0.05);
      expect(bounds.max.z - bounds.min.z, `${assetId} depth`).toBeLessThanOrEqual(size.depth + 0.05);
      asset.dispose();
    }
  });

  it("turns a prop into a blueprint ghost and takes ownership of it", () => {
    const helicopter = createHelicopter();
    const solidMeshes = meshesOf(helicopter.group).length;
    const ghost = makeBlueprint(helicopter, "$500K");
    expect(ghost.footprint).toBe(helicopter.footprint);
    // Every original mesh gained a depth pre-pass and a wireframe; the plot outline is extra.
    expect(meshesOf(ghost.group).length).toBe(solidMeshes * 3 + 1);
    const materials = new Set(meshesOf(helicopter.group).map((mesh) => mesh.material));
    expect(materials.size).toBe(3);
    expect(meshesOf(ghost.group).every((mesh) => !mesh.castShadow)).toBe(true);

    const rotor = helicopter.group.children[1];
    const before = rotor.rotation.y;
    ghost.update?.(0.1, 1);
    expect(rotor.rotation.y).not.toBe(before);
    ghost.setPriceLabel("$1M");
    ghost.setPriceLabel(null);

    const parent = new THREE.Group();
    parent.add(ghost.group);
    ghost.dispose();
    expect(ghost.group.parent).toBeNull();
    expect(helicopter.group.parent).toBeNull();
  });
});

describe("building kit", () => {
  it("builds walls of any length, with and without windows", () => {
    for (const style of ["drywall", "brick", "plaster", "glass", "panel"] as const) {
      for (const [length, windows] of [
        [0.6, 3],
        [3, 0],
        [8, 3],
        [27, 9],
      ] as const) {
        const wall = createWall(length, { style, windows });
        const bounds = boundsOf(wall.group);
        expect(bounds.max.x - bounds.min.x, `${style} ${length}`).toBeLessThanOrEqual(length + 0.12);
        expect(bounds.max.y, `${style} ${length} height`).toBeCloseTo(2.6, 1);
        expect(bounds.min.y).toBeCloseTo(0, 5);
        wall.dispose();
      }
    }
  });
});
