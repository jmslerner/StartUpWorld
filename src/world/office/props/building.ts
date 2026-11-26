/**
 * Building kit: floor slabs, the ground tile, back walls, doors, lamps, rugs
 * and signs.
 *
 * Sizes that depend on arguments (floor, ground, walls, rugs, kerbs) bake their
 * own geometry and free it in dispose(); fixed shapes come from the shared cache.
 */
import * as THREE from "three";
import type { FurnitureSet, LookId, OfficeIndex } from "../../types";
import {
  bakeModel,
  C,
  canvasTexture,
  createDynamicTexture,
  cssColor,
  darken,
  EMBER,
  furnitureOf,
  glassMat,
  glowMat,
  INK,
  LABEL_FONT,
  lighten,
  mixColor,
  ModelBuilder,
  modelMesh,
  NEON,
  phaseTier,
  roundedRect,
  SCALE,
  STEEL,
  themeFor,
  unitDisc,
  unitPlane,
  vertexMat,
} from "../../core/palette";
import type { CanvasDraw } from "../../core/palette";
import { clamp01, hash01, PropKit, shapeMesh, texturedPlane } from "./shared";
import type { PropFootprint, PropHandle } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Floor + ground
// ─────────────────────────────────────────────────────────────────────────────

/** How far the floor slab extends below y = 0. */
export const FLOOR_THICKNESS = 0.2;
/** How far the ground block extends below its top. */
export const GROUND_THICKNESS = 0.5;
/**
 * Suggested drop of the ground below the office floor (place the ground group
 * at y = −GROUND_DROP and outdoor props with it) so the floor slab reads as a
 * raised platform. Placing it flush (y = 0) also works: the ground's material
 * yields to anything coplanar.
 */
export const GROUND_DROP = 0.1;

interface FloorStyle {
  /** Slab body, also what shows in the grooves between tiles. */
  groove: number;
  side: number;
  tones: readonly number[];
}

/** The floor finish, by furniture set and then by office (0 the garage … 4 the campus). */
const FLOOR_STYLES: Record<FurnitureSet, readonly FloorStyle[]> = {
  classic: [
    { groove: C.concreteDark, side: C.concreteDark, tones: [C.concrete, 0xa5a6a6, 0xb2b3b2] },
    { groove: 0xb08f63, side: 0xa98a60, tones: [0xe6cba0, 0xe0c296, 0xebd3ab, 0xdcbc8d] },
    { groove: 0x56697a, side: 0x5d6874, tones: [0x6f8799, 0x688092, 0x778fa1] },
    { groove: 0xaeb1b3, side: 0xa3a6a8, tones: [0xd6d7d5, 0xd0d2d1, 0xdbdcda] },
    { groove: C.brass, side: 0x2c3038, tones: [0x454a57, 0x525866] },
  ],
  // Grey-blue office carpet tiles.
  nineties: [
    { groove: 0x5a6472, side: 0x535c69, tones: [0x7a8696, 0x737f8f, 0x808c9b] },
    { groove: 0x58637a, side: 0x515b70, tones: [0x76829a, 0x6f7b93, 0x7d88a0] },
    { groove: 0x55617a, side: 0x4e5970, tones: [0x6f7d96, 0x68768f, 0x76839b] },
    { groove: 0x5b6680, side: 0x545e76, tones: [0x7b87a0, 0x74809a, 0x828ea6] },
    { groove: 0x4b5468, side: 0x2c3038, tones: [0x626c84, 0x5b657c, 0x69738a] },
  ],
  // Warm laminate planks.
  noughties: [
    { groove: 0xa47a4c, side: 0x9a7245, tones: [0xd2a676, 0xcc9f6e, 0xd8ad7e] },
    { groove: 0xa9804f, side: 0x9f7749, tones: [0xdcb382, 0xd5ab79, 0xe1b98a, 0xcfa673] },
    { groove: 0x9c7243, side: 0x936b3e, tones: [0xc9995f, 0xc39258, 0xcfa067] },
    { groove: 0xa47a4c, side: 0x9a7245, tones: [0xd6ac7a, 0xd0a472, 0xdcb382] },
    { groove: 0x8a6239, side: 0x2c3038, tones: [0xb88a55, 0xb2834e, 0xbe915c] },
  ],
  // Pale polished concrete.
  twenties: [
    { groove: 0xb9bbbb, side: 0xaeb0b0, tones: [0xd9dad8, 0xd4d5d3, 0xdedfdd] },
    { groove: 0xbcbdbc, side: 0xb1b2b1, tones: [0xdcdcda, 0xd7d7d5, 0xe1e1df] },
    { groove: 0xb6b8b9, side: 0xabadae, tones: [0xd6d8d9, 0xd1d3d4, 0xdbdddd] },
    { groove: 0xbfc0bf, side: 0xb4b5b4, tones: [0xe0e0de, 0xdbdbd9, 0xe5e5e3] },
    { groove: 0xb3b5b6, side: 0x2c3038, tones: [0xd2d4d5, 0xcdcfd0, 0xd7d9da] },
  ],
};

const drawFloor = (b: ModelBuilder, w: number, d: number, office: OfficeIndex, look: LookId): void => {
  const tier = phaseTier(office);
  const style = FLOOR_STYLES[furnitureOf(look)][tier];
  const lip = 0.014;
  b.box(w, FLOOR_THICKNESS - lip, d, style.groove, 0, -FLOOR_THICKNESS, 0, { r: 0 });
  // Skirt so the cut edge is one clean colour rather than a stack of tile ends.
  b.box(w + 0.02, FLOOR_THICKNESS - 0.03, d + 0.02, style.side, 0, -FLOOR_THICKNESS, 0, { r: 0 });

  const tile = (x: number, z: number, tw: number, td: number, color: number): void => {
    b.box(tw, 0.03, td, color, x, -0.03, z, { r: 0 });
  };

  if (tier === 1) {
    // Planks running along X, staggered row to row.
    const rows = Math.max(1, Math.round(d / 0.22));
    const rowDepth = d / rows;
    for (let row = 0; row < rows; row += 1) {
      const z = -d / 2 + rowDepth * (row + 0.5);
      let x = -w / 2;
      let i = 0;
      while (x < w / 2 - 1e-6) {
        const seed = row * 97 + i * 13;
        const full = 0.9 + hash01(seed) * 0.9;
        const length = Math.min(i === 0 ? full * (0.35 + hash01(row * 7) * 0.65) : full, w / 2 - x);
        tile(x + length / 2, z, length - 0.008, rowDepth - 0.008, style.tones[Math.floor(hash01(seed + 5) * style.tones.length)]);
        x += length;
        i += 1;
      }
    }
    return;
  }

  // By office; the shared office (1) is planked above and never gets here.
  const target = [2.0, 1.0, 1.0, 2.3, 1.35][tier];
  const gap = [0.03, 0.008, 0.008, 0.014, 0.022][tier];
  const nx = Math.max(1, Math.round(w / target));
  const nz = Math.max(1, Math.round(d / target));
  const tw = w / nx;
  const td = d / nz;
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      const x = -w / 2 + tw * (ix + 0.5);
      const z = -d / 2 + td * (iz + 0.5);
      const seed = ix * 131 + iz * 17;
      const checker = (ix + iz) % 2;
      const color = tier === 4 ? style.tones[checker] : style.tones[Math.floor(hash01(seed) * style.tones.length)];
      tile(x, z, tw - gap, td - gap, color);
      if (tier === 4) {
        // Marble veins: a couple of pale hairlines per tile.
        const veins = 1 + Math.floor(hash01(seed + 3) * 2);
        for (let v = 0; v < veins; v += 1) {
          const angle = hash01(seed * 3 + v) * Math.PI;
          const length = tw * (0.3 + hash01(seed + v * 7) * 0.35);
          b.box(length, 0.003, 0.018, C.marbleVein, x + (hash01(seed + v) - 0.5) * tw * 0.3, 0, z + (hash01(seed + v + 9) - 0.5) * td * 0.3, {
            ry: angle,
            r: 0,
          });
        }
      }
    }
  }
  if (tier === 0) {
    // Oil stains where the car used to live.
    const stains = Math.max(3, Math.round((w * d) / 12));
    for (let i = 0; i < stains; i += 1) {
      const radius = 0.16 + hash01(i * 19 + 1) * 0.3;
      b.cyl(radius, 0.003, i % 3 === 0 ? darken(C.oil, 0.2) : C.oil, (hash01(i * 7 + 2) - 0.5) * (w - 1.2), 0, (hash01(i * 11 + 3) - 0.5) * (d - 1.2), {
        sx: 0.7 + hash01(i) * 0.7,
        sz: 0.6 + hash01(i + 4) * 0.5,
        ry: hash01(i * 3) * 3,
        seg: 12,
      });
    }
  }
};

/**
 * The office floor slab: `w` × `d`, centred, top surface at y = 0, with the
 * office's finish (oil-stained concrete → planks → carpet tiles → polished
 * concrete → dark marble with brass joints).
 */
export const createFloor = (w: number, d: number, office: OfficeIndex, look: LookId = "classic"): PropHandle => {
  const kit = new PropKit(`floor:${look}:${office}`);
  // The slab is the biggest shadow receiver in the scene and never needs to cast one itself.
  kit.ownModel((b) => drawFloor(b, w, d, office, look)).castShadow = false;
  return kit.finish({ w, d });
};

const drawGround = (b: ModelBuilder, w: number, d: number, office: OfficeIndex): void => {
  const tier = phaseTier(office);
  if (tier === 0) {
    // Suburban lawn: mown stripes with a few darker patches and flowers.
    b.box(w, GROUND_THICKNESS - 0.06, d, C.soil, 0, -GROUND_THICKNESS, 0, { r: 0 });
    const stripes = Math.max(2, Math.round(d / 1.6));
    const stripe = d / stripes;
    for (let i = 0; i < stripes; i += 1) {
      b.box(w, 0.06, stripe, i % 2 ? C.grass : mixColor(C.grass, C.grassDark, 0.45), 0, -0.06, -d / 2 + stripe * (i + 0.5), { r: 0 });
    }
    const tufts = Math.round((w * d) / 14);
    for (let i = 0; i < tufts; i += 1) {
      const x = (hash01(i * 13 + 1) - 0.5) * (w - 0.6);
      const z = (hash01(i * 29 + 2) - 0.5) * (d - 0.6);
      if (i % 4 === 0) b.ball(0.05, [C.white, C.yellow, C.pink][i % 3], x, 0, z, { sy: 0.7, seg: 6 });
      else b.cyl(0.3 + hash01(i) * 0.4, 0.003, C.grassDark, x, 0, z, { sx: 1.3, sz: 0.7, ry: hash01(i * 5) * 3, seg: 10 });
    }
    return;
  }
  // City paving.
  const tones = tier === 4 ? [0x9a9da3, 0x8f9298] : tier === 3 ? [0xcfcdc6, 0xc5c3bb] : [C.paving, C.pavingDark];
  b.box(w, GROUND_THICKNESS - 0.012, d, darken(tones[1], 0.25), 0, -GROUND_THICKNESS, 0, { r: 0 });
  const size = tier >= 3 ? 2.0 : 1.3;
  const nx = Math.max(1, Math.round(w / size));
  const nz = Math.max(1, Math.round(d / size));
  for (let ix = 0; ix < nx; ix += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      const color = hash01(ix * 31 + iz * 7) > 0.5 ? tones[0] : tones[1];
      b.box(w / nx - 0.02, 0.03, d / nz - 0.02, color, -w / 2 + (w / nx) * (ix + 0.5), -0.03, -d / 2 + (d / nz) * (iz + 0.5), { r: 0 });
    }
  }
};

/**
 * The tile of world the office stands on: `w` × `d`, centred, top at y = 0
 * (lawn for the garage, city paving later). Its material yields to coplanar
 * surfaces, so floors, roads and pads can sit flush on it without z-fighting.
 */
export const createGround = (w: number, d: number, office: OfficeIndex, look: LookId = "classic"): PropHandle => {
  const kit = new PropKit(`ground:${look}:${office}`);
  const geometry = kit.own(bakeModel(null, (b) => drawGround(b, w, d, office)));
  const mesh = modelMesh(geometry, vertexMat(0xffffff, true));
  mesh.castShadow = false;
  kit.add(mesh);
  return kit.finish({ w, d });
};

export interface RoadOptions {
  /** Road width across. Default 2.4. */
  width?: number;
  /** Add kerbs on both sides. Default true. */
  kerbs?: boolean;
}

/** A strip of street running along X (rotate it for a Z road): asphalt, dashes, kerbs. Sits on the ground. */
export const createRoad = (length: number, options: RoadOptions = {}): PropHandle => {
  const width = options.width ?? 2.4;
  const kerbs = options.kerbs ?? true;
  const kit = new PropKit("road");
  kit.ownModel((b) => {
    b.box(length, 0.02, width, C.asphalt, 0, 0, 0, { r: 0 });
    const dashes = Math.max(1, Math.floor(length / 1.6));
    for (let i = 0; i < dashes; i += 1) b.box(0.8, 0.004, 0.09, C.paper, -length / 2 + (length / dashes) * (i + 0.5), 0.02, 0, { r: 0 });
    if (kerbs) for (const sz of [-1, 1]) b.box(length, 0.07, 0.14, C.concrete, 0, 0, sz * (width / 2 + 0.07), { r: 0.012 });
  }).castShadow = false;
  return kit.finish({ w: length, d: width + (kerbs ? 0.28 : 0) });
};

/** Concrete driveway slab with expansion joints, `w` across and `d` long. Sits on the ground. */
export const createDriveway = (w: number, d: number): PropHandle => {
  const kit = new PropKit("driveway");
  kit.ownModel((b) => {
    const slabs = Math.max(1, Math.round(d / 1.5));
    for (let i = 0; i < slabs; i += 1) {
      b.box(w - 0.02, 0.025, d / slabs - 0.03, i % 2 ? C.concrete : 0xb4b5b4, 0, 0, -d / 2 + (d / slabs) * (i + 0.5), { r: 0 });
    }
    b.box(w, 0.012, d, C.concreteDark, 0, 0, 0, { r: 0 });
  }).castShadow = false;
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Walls
// ─────────────────────────────────────────────────────────────────────────────

export type WallStyle = "drywall" | "brick" | "plaster" | "glass" | "panel";

/** The wall finish that goes with each office, by furniture set and then by office (0 the garage … 4 the campus). */
export const WALL_STYLE_FOR_PHASE: Record<FurnitureSet, readonly WallStyle[]> = {
  classic: ["drywall", "brick", "plaster", "glass", "panel"],
  nineties: ["drywall", "brick", "plaster", "glass", "panel"],
  noughties: ["drywall", "brick", "plaster", "glass", "panel"],
  twenties: ["drywall", "brick", "plaster", "glass", "panel"],
};

/** The wall finish of an office in a look: its furniture set's. */
export const wallStyleFor = (office: OfficeIndex, look: LookId = "classic"): WallStyle =>
  WALL_STYLE_FOR_PHASE[furnitureOf(look)][phaseTier(office)];

export const WALL_THICKNESS = 0.16;
const WALL_CAP = 0x3b424c;

interface WallLook {
  face: number;
  back: number;
  base: number;
}

const WALL_LOOKS: Record<WallStyle, WallLook> = {
  drywall: { face: 0xddd5c2, back: 0xbcae93, base: C.pallet },
  brick: { face: C.brick, back: C.brickDark, base: C.charcoal },
  plaster: { face: C.cream, back: C.bone, base: C.grey },
  glass: { face: C.white, back: C.greyLight, base: C.greyDark },
  panel: { face: C.walnut, back: C.walnutDark, base: C.marble },
};

export interface WallOptions {
  /** Default 2.6 (spec scale guide). */
  height?: number;
  style?: WallStyle;
  /** Number of windows, spread evenly. Ignored by "glass" (which is all window). */
  windows?: number;
}

const WINDOW_W = 1.25;
const WINDOW_H = 1.15;
const WINDOW_SILL = 1.0;

/** Surface detail on the interior (+Z) face. */
const drawWallFinish = (b: ModelBuilder, style: WallStyle, x0: number, x1: number, y0: number, y1: number, face: number): void => {
  const span = x1 - x0;
  if (span < 0.05 || y1 - y0 < 0.05) return;
  const cx = (x0 + x1) / 2;
  const look = WALL_LOOKS[style];
  if (style === "brick") {
    const course = 0.17;
    const rows = Math.floor((y1 - y0) / course);
    for (let row = 0; row <= rows; row += 1) {
      const y = y0 + row * course;
      if (row > 0) b.box(span, 0.014, 0.006, C.mortar, cx, y - 0.007, face + 0.001, { r: 0 });
      if (row === rows) break;
      // A scatter of off-colour bricks reads as brickwork without drawing every brick.
      const bricks = Math.floor(span / 0.4);
      for (let i = 0; i < bricks; i += 1) {
        const roll = hash01(row * 53 + i * 17 + Math.round(x0 * 10));
        if (roll > 0.3) continue;
        const bx = x0 + 0.2 + i * 0.4 + (row % 2 ? 0.2 : 0);
        if (bx + 0.19 > x1) continue;
        b.box(0.36, course - 0.02, 0.006, roll < 0.15 ? lighten(look.face, 0.14) : darken(look.face, 0.14), bx, y + 0.008, face + 0.001, { r: 0 });
      }
    }
  } else if (style === "drywall") {
    // Taped seams between sheets.
    for (let x = Math.ceil(x0 / 1.2) * 1.2; x < x1 - 0.05; x += 1.2) {
      if (x - x0 < 0.05) continue;
      b.box(0.05, y1 - y0, 0.004, lighten(look.face, 0.25), x, y0, face + 0.001, { r: 0 });
    }
  } else if (style === "panel") {
    for (let x = Math.ceil(x0) + 0; x < x1 - 0.05; x += 1) {
      if (x - x0 < 0.05) continue;
      b.box(0.016, y1 - y0, 0.008, C.brass, x, y0, face + 0.002, { r: 0 });
    }
  }
};

const drawWall = (b: ModelBuilder, glass: ModelBuilder, length: number, height: number, style: WallStyle, windows: number): void => {
  const look = WALL_LOOKS[style];
  const t = WALL_THICKNESS;
  const face = t / 2;
  const skirting = 0.12;
  // Top cap: a dark line that says "this wall is cut away".
  b.box(length + 0.02, 0.05, t + 0.03, WALL_CAP, 0, height - 0.05, 0, { r: 0.012 });
  b.box(length, skirting, 0.03, look.base, 0, 0, face + 0.01, { r: 0.008 });

  if (style === "glass") {
    // Curtain wall: a low solid band, slim mullions, a transom, glass in between.
    const band = 0.42;
    b.box(length, band, t, look.face, 0, 0, 0, { r: 0 });
    const bays = Math.max(1, Math.round(length / 1.3));
    const bay = length / bays;
    for (let i = 0; i <= bays; i += 1) b.box(0.07, height - band - 0.05, t * 0.8, look.face, -length / 2 + i * bay + (i === 0 ? 0.035 : i === bays ? -0.035 : 0), band, 0, { r: 0.012 });
    b.box(length, 0.06, t * 0.8, look.face, 0, band + (height - band) * 0.62, 0, { r: 0.012 });
    glass.box(length - 0.08, height - band - 0.06, 0.03, 0xffffff, 0, band, 0, { r: 0 });
    return;
  }

  const count = Math.max(0, Math.min(windows, Math.floor((length - 0.5) / (WINDOW_W + 0.5))));
  const top = height - 0.05;
  if (count === 0) {
    b.box(length, top, t, look.face, 0, 0, 0, { r: 0 });
    drawWallFinish(b, style, -length / 2, length / 2, skirting, top, face);
    return;
  }
  // No CSG: build the wall as a band below the windows, a band above, and piers between.
  const sillY = WINDOW_SILL;
  const headY = Math.min(top - 0.2, WINDOW_SILL + WINDOW_H);
  b.box(length, sillY, t, look.face, 0, 0, 0, { r: 0 });
  b.box(length, top - headY, t, look.face, 0, headY, 0, { r: 0 });
  drawWallFinish(b, style, -length / 2, length / 2, skirting, sillY, face);
  drawWallFinish(b, style, -length / 2, length / 2, headY, top, face);
  const pitch = length / count;
  let cursor = -length / 2;
  for (let i = 0; i < count; i += 1) {
    const wx = -length / 2 + pitch * (i + 0.5);
    const left = wx - WINDOW_W / 2;
    b.box(left - cursor, headY - sillY, t, look.face, (cursor + left) / 2, sillY, 0, { r: 0 });
    drawWallFinish(b, style, cursor, left, sillY, headY, face);
    cursor = wx + WINDOW_W / 2;
    // Frame, sill, glazing bars.
    const trim = style === "panel" ? C.brass : C.white;
    b.box(WINDOW_W + 0.1, 0.05, t + 0.08, trim, wx, sillY - 0.03, 0.02, { r: 0.012 });
    b.box(WINDOW_W, 0.05, t * 0.7, trim, wx, headY - 0.05, 0, { r: 0 });
    for (const sx of [-1, 1]) b.box(0.05, headY - sillY, t * 0.7, trim, wx + sx * (WINDOW_W / 2 - 0.025), sillY, 0, { r: 0 });
    b.box(0.035, headY - sillY, 0.05, trim, wx, sillY, 0, { r: 0 });
    b.box(WINDOW_W, 0.035, 0.05, trim, wx, sillY + (headY - sillY) * 0.55, 0, { r: 0 });
    glass.box(WINDOW_W - 0.08, headY - sillY - 0.06, 0.02, 0xffffff, wx, sillY + 0.02, 0, { r: 0 });
  }
  b.box(length / 2 - cursor, headY - sillY, t, look.face, (cursor + length / 2) / 2, sillY, 0, { r: 0 });
  drawWallFinish(b, style, cursor, length / 2, sillY, headY, face);
};

/**
 * A straight wall segment `length` long, running along local X, centred on the
 * origin. The room side is +Z: the inner face is at z = +WALL_THICKNESS / 2, so
 * put the group WALL_THICKNESS / 2 outside the floor edge. For the −X wall,
 * rotate it by +π/2.
 */
export const createWall = (length: number, options: WallOptions = {}): PropHandle => {
  const height = options.height ?? SCALE.wall;
  const style = options.style ?? "plaster";
  const kit = new PropKit(`wall:${style}`);
  const solid = new ModelBuilder();
  const panes = new ModelBuilder();
  drawWall(solid, panes, length, height, style, options.windows ?? 0);
  kit.add(modelMesh(kit.own(solid.bake())));
  if (panes.indexCount > 0) {
    const glass = new THREE.Mesh(kit.own(panes.bake()), glassMat());
    glass.receiveShadow = false;
    kit.add(glass);
  }
  return kit.finish({ w: length, d: WALL_THICKNESS });
};

/** Square post for the corner where the two back walls meet. Same origin rule as walls (centre of its footprint). */
export const createCornerPost = (options: { height?: number; style?: WallStyle } = {}): PropHandle => {
  const height = options.height ?? SCALE.wall;
  const style = options.style ?? "plaster";
  const look = WALL_LOOKS[style];
  const kit = new PropKit("corner-post");
  kit.ownModel((b) => {
    const s = WALL_THICKNESS + 0.04;
    b.box(s, height - 0.05, s, style === "glass" ? look.face : look.back, 0, 0, 0, { r: 0.012 });
    b.box(s + 0.03, 0.05, s + 0.03, WALL_CAP, 0, height - 0.05, 0, { r: 0.012 });
  });
  return kit.finish({ w: WALL_THICKNESS + 0.04, d: WALL_THICKNESS + 0.04 });
};

export interface KerbOptions {
  /** Default 0.2 (the spec caps the open edges at 0.25). */
  height?: number;
  style?: WallStyle;
}

/** Low cut-away wall for the open +X / +Z edges, running along local X. */
export const createKerb = (length: number, options: KerbOptions = {}): PropHandle => {
  const height = Math.min(0.25, options.height ?? 0.2);
  const look = WALL_LOOKS[options.style ?? "plaster"];
  const kit = new PropKit("kerb");
  kit.ownModel((b) => {
    b.box(length, height - 0.03, WALL_THICKNESS, look.face, 0, 0, 0, { r: 0 });
    b.box(length + 0.02, 0.03, WALL_THICKNESS + 0.03, WALL_CAP, 0, height - 0.03, 0, { r: 0.01 });
  });
  return kit.finish({ w: length, d: WALL_THICKNESS });
};

// ─────────────────────────────────────────────────────────────────────────────
// Doors
// ─────────────────────────────────────────────────────────────────────────────

export interface DoorHandle extends PropHandle {
  /** 0 = shut, 1 = wide open (the leaf swings into the room, toward +Z). Eased toward in update(). */
  setOpen(amount: number): void;
  /** True while the leaf is still swinging to where setOpen sent it. */
  moving(): boolean;
}

const DOOR_W = 1.0;
const DOOR_H = 2.1;
export const DOOR_FOOTPRINT: PropFootprint = { w: 1.3, d: 0.2 };

/**
 * Free-standing door frame with a hinged leaf, styled per office. Front (+Z)
 * faces into the room.
 */
export const createDoor = (office: OfficeIndex = 2, look: LookId = "classic"): DoorHandle => {
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit(`door:${look}:${office}`);
  const frameColor = [C.pallet, theme.accents[1], C.greyDark, C.white, C.brass][tier];
  const double = tier === 4;

  kit.model(`door-frame:${look}:${office}`, (b) => {
    for (const sx of [-1, 1]) b.box(0.1, DOOR_H + 0.1, 0.18, frameColor, sx * (DOOR_W / 2 + 0.05), 0, 0, { r: 0.014 });
    b.box(DOOR_W + 0.2, 0.12, 0.18, frameColor, 0, DOOR_H, 0, { r: 0.014 });
    b.box(DOOR_W, 0.02, 0.2, tier === 0 ? C.concreteDark : C.charcoal, 0, 0, 0, { r: 0 });
    // Welcome mat on the room side.
    b.box(0.8, 0.014, 0.5, tier === 0 ? 0x8a6a45 : theme.accents[0], 0, 0, 0.4, { r: 0 });
    b.box(0.66, 0.016, 0.36, tier === 0 ? 0x9c7a52 : darken(theme.accents[0], 0.15), 0, 0, 0.4, { r: 0 });
  });

  const drawLeaf = (b: ModelBuilder, w: number): void => {
    // Drawn with the hinge on the origin, the leaf extending toward +X.
    const glassDoor = tier === 1 || tier >= 3;
    if (glassDoor) {
      const rail = tier === 1 ? theme.accents[1] : tier === 4 ? C.brass : C.chrome;
      b.box(w, 0.1, 0.05, rail, w / 2, 0.02, 0, { r: 0.012 });
      b.box(w, 0.08, 0.05, rail, w / 2, DOOR_H - 0.09, 0, { r: 0.012 });
      for (const x of [0.03, w - 0.03]) b.box(0.06, DOOR_H - 0.04, 0.05, rail, x, 0.02, 0, { r: 0.012 });
      b.box(0.03, 0.5, 0.05, tier === 4 ? C.brass : C.charcoal, w - 0.12, 0.85, 0.045, { r: 0.012 });
    } else {
      const wood = tier === 0 ? 0x6f8f7a : theme.woodDark;
      b.box(w, DOOR_H - 0.03, 0.05, wood, w / 2, 0.02, 0, { r: 0.012 });
      if (tier === 0) {
        // Two recessed panels and a little window.
        b.box(w - 0.24, 0.7, 0.012, darken(wood, 0.12), w / 2, 0.2, 0.026, { r: 0 });
        b.box(w - 0.24, 0.42, 0.012, 0xbfe0ec, w / 2, 1.5, 0.026, { r: 0 });
      } else {
        b.box(0.16, 1.2, 0.012, 0xbfe0ec, w - 0.26, 0.6, 0.026, { r: 0 });
      }
      b.ball(0.035, tier === 0 ? C.brass : C.chrome, w - 0.1, 0.98, 0.05, { seg: 8 });
    }
  };

  const leaves = (double ? [-1, 1] : [-1]).map((side) => {
    const w = double ? DOOR_W / 2 : DOOR_W;
    const pivot = new THREE.Group();
    pivot.position.set((side * DOOR_W) / 2, 0, 0);
    // The second leaf of a double door is the first one mirrored: hinge on the other jamb.
    pivot.scale.x = side === -1 ? 1 : -1;
    kit.add(pivot);
    kit.model(`door-leaf:${look}:${office}`, (b) => drawLeaf(b, w), pivot);
    if (tier === 1 || tier >= 3) {
      const pane = new THREE.Mesh(
        bakeModel(`door-glass:${look}:${office}`, (b) => b.box(w - 0.12, DOOR_H - 0.22, 0.02, 0xffffff, w / 2, 0.12, 0, { r: 0 })),
        glassMat()
      );
      pivot.add(pane);
    }
    return { pivot, side };
  });

  let target = 0;
  let open = 0;
  const apply = (): void => {
    for (const { pivot, side } of leaves) pivot.rotation.y = side * open * 1.75;
  };
  kit.onUpdate((dt) => {
    if (Math.abs(target - open) < 1e-4) return;
    open += (target - open) * (1 - Math.exp(-dt * 9));
    // The last sliver is taken in one step, so the door comes to rest exactly where it was sent.
    if (Math.abs(target - open) < 1e-3) open = target;
    apply();
  });
  return kit.finish(DOOR_FOOTPRINT, {
    setOpen: (amount: number) => {
      target = clamp01(amount);
    },
    moving: () => Math.abs(target - open) >= 1e-4,
  });
};

export interface GarageDoorOptions {
  /**
   * Cut-away version for a door that stands between the camera and the room:
   * the same posts, but the header is reduced to its drum so it hides as little
   * of the interior as possible. Default false.
   */
  slim?: boolean;
}

/**
 * Roll-up garage door shown raised: two posts, the header with the curtain
 * rolled into its drum, and a couple of slats still hanging. Runs along X; the
 * opening is `width` wide and clear to 2.1.
 */
export const createGarageDoor = (width = 3.2, options: GarageDoorOptions = {}): PropHandle => {
  const slim = options.slim ?? false;
  const kit = new PropKit("garage-door");
  kit.ownModel((b) => {
    const steel = C.galvanised;
    const frame = 0xcfc8b8;
    if (slim) {
      // Guide rails only, the drum resting on their tops.
      for (const sx of [-1, 1]) {
        b.box(0.1, 2.34, 0.12, frame, sx * (width / 2 + 0.05), 0, 0, { r: 0.014 });
        b.box(0.04, 2.2, 0.05, steel, sx * (width / 2 - 0.02), 0, 0.02, { r: 0 });
        b.box(0.16, 0.2, 0.16, frame, sx * (width / 2 + 0.05), 2.26, 0, { r: 0.02 });
      }
      b.cyl(0.085, width + 0.1, 0xe4e0d6, 0, 2.275, 0, { axis: "x", seg: 10 });
      b.box(width - 0.1, 0.06, 0.03, 0xd8d3c7, 0, 2.2, 0.05, { r: 0.008 });
    } else {
      for (const sx of [-1, 1]) {
        b.box(0.14, 2.5, 0.16, frame, sx * (width / 2 + 0.07), 0, 0, { r: 0.014 });
        b.box(0.05, 2.2, 0.06, steel, sx * (width / 2 - 0.03), 0, 0.02, { r: 0 });
      }
      b.box(width + 0.28, 0.2, 0.2, frame, 0, 2.5, 0, { r: 0.014 });
      // Drum + the last slats of the curtain.
      b.cyl(0.17, width - 0.04, 0xe4e0d6, 0, 2.2, -0.02, { axis: "x", seg: 12 });
      for (let i = 0; i < 3; i += 1) b.box(width - 0.08, 0.1, 0.035, i % 2 ? 0xe4e0d6 : 0xd8d3c7, 0, 2.02 - i * 0.105, 0.04, { r: 0.008 });
      b.box(0.3, 0.03, 0.05, C.charcoal, 0, 1.79, 0.07, { r: 0.008 });
    }
    // Pull cord.
    b.tube([width / 2 - 0.2, slim ? 2.2 : 1.8, 0.06], [width / 2 - 0.2, 1.35, 0.06], 0.008, C.red, { seg: 5 });
    b.ball(0.03, C.red, width / 2 - 0.2, 1.31, 0.06, { seg: 6 });
    // Threshold strip where the door comes down.
    if (slim) b.box(width, 0.012, 0.1, C.concreteDark, 0, 0, 0, { r: 0 });
  });
  return kit.finish({ w: width + 0.28, d: 0.3 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Rugs
// ─────────────────────────────────────────────────────────────────────────────

export interface RugOptions {
  color?: number;
  /** Second colour for the border / stripes. Defaults to a darker shade. */
  accent?: number;
  pattern?: "border" | "stripes" | "plain";
}

/** Flat rug with rounded corners. Lies on the floor (1.6 cm thick), never casts a shadow. */
export const createRug = (w: number, d: number, options: RugOptions = {}): PropHandle => {
  const color = options.color ?? C.teal;
  const accent = options.accent ?? darken(color, 0.22);
  const pattern = options.pattern ?? "border";
  const kit = new PropKit("rug");
  const mesh = kit.ownModel((b) => {
    const corner = Math.min(0.14, w / 6, d / 6);
    b.plate(roundedRect(w, d, corner), 0.012, pattern === "border" ? accent : color, 0, 0, 0);
    if (pattern === "border") {
      b.plate(roundedRect(w - 0.24, d - 0.24, corner * 0.6), 0.004, color, 0, 0.012, 0);
      b.plate(roundedRect(w - 0.5, d - 0.5, corner * 0.4), 0.002, lighten(color, 0.12), 0, 0.016, 0);
    } else if (pattern === "stripes") {
      const stripes = Math.max(2, Math.round(w / 0.5));
      for (let i = 0; i < stripes; i += 2) b.box(w / stripes, 0.004, d - 0.16, accent, -w / 2 + (w / stripes) * (i + 0.5), 0.012, 0, { r: 0 });
    }
  });
  mesh.castShadow = false;
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Lamps
// ─────────────────────────────────────────────────────────────────────────────

const drawPool: CanvasDraw = (ctx, w, h) => {
  const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.4)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
};

/**
 * A soft pool of light on the floor under a lamp — a fake that sells the dusk
 * mood without paying for real point lights. Fades in with setGlow.
 */
export const addLightPool = (kit: PropKit, radius: number, color: number, x = 0, z = 0, strength = 0.5): void => {
  const texture = canvasTexture("light-pool", 64, 64, drawPool);
  const material = kit.own(glowMat(color, { additive: true, opacity: 1, map: texture }).clone());
  material.opacity = 0;
  const pool = new THREE.Mesh(unitDisc(24), material);
  pool.rotation.x = -Math.PI / 2;
  pool.scale.setScalar(radius * 2);
  pool.position.set(x, 0.02, z);
  pool.visible = false;
  kit.add(pool);
  kit.onGlow((amount) => {
    // Without the gradient texture the disc has a hard edge, so keep it fainter.
    material.opacity = amount * strength * (texture ? 1 : 0.35);
    pool.visible = amount > 0.01;
  });
};

export type FloorLampStyle = "classic" | "arc" | "work";
export const FLOOR_LAMP_STYLES: readonly FloorLampStyle[] = ["classic", "arc", "work"];

export interface LampOptions {
  style?: FloorLampStyle;
  /** Shade colour (classic / arc). */
  shade?: number;
}

/**
 * Floor lamp. `setGlow(0..1)` lights the shade and fades in a pool of light.
 *  • classic: drum shade on a slim pole
 *  • arc: weighted base, long arc, dome hanging over the footprint centre
 *  • work: tripod site light (garage)
 */
export const createFloorLamp = (options: LampOptions = {}): PropHandle => {
  const style = options.style ?? "classic";
  const kit = new PropKit(`lamp:${style}`);
  if (style === "classic") {
    const shade = options.shade ?? C.cream;
    kit.model("lamp:classic", (b) => {
      b.cyl(0.16, 0.03, C.charcoal, 0, 0, 0, { seg: 14 });
      b.cyl(0.018, 1.25, C.brass, 0, 0.03, 0, { seg: 6 });
    });
    const lit = kit.emissive(shade, C.lampWarm, 0.15, 1.1);
    kit.add(shapeMesh(bakeModel("lamp:classic:shade", (b) => b.cyl(0.19, 0.3, 0xffffff, 0, 1.25, 0, { taper: 0.78, seg: 14 })), lit));
    addLightPool(kit, 1.5, C.lampWarm);
    return kit.finish({ w: 0.4, d: 0.4 });
  }
  if (style === "arc") {
    const shade = options.shade ?? C.chrome;
    kit.model("lamp:arc", (b) => {
      b.box(0.3, 0.12, 0.3, C.marbleLight, -0.7, 0, 0, { r: 0.02 });
      // The arc, approximated with five straight tubes.
      const points: Array<[number, number, number]> = [
        [-0.7, 0.12, 0],
        [-0.68, 1.1, 0],
        [-0.5, 1.62, 0],
        [-0.2, 1.84, 0],
        [0.0, 1.8, 0],
      ];
      for (let i = 0; i < points.length - 1; i += 1) b.tube(points[i], points[i + 1], 0.016, C.chrome, { seg: 6 });
      b.tube([0, 1.8, 0], [0, 1.66, 0], 0.008, C.charcoal, { seg: 5 });
    });
    const lit = kit.emissive(shade, C.lampWarm, 0.1, 0.9);
    kit.add(shapeMesh(bakeModel("lamp:arc:shade", (b) => b.ball(0.2, 0xffffff, 0, 1.46, 0, { sy: 0.55, seg: 14 })), lit));
    addLightPool(kit, 1.6, C.lampWarm);
    return kit.finish({ w: 1.7, d: 0.5 });
  }
  kit.model("lamp:work", (b) => {
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.tube([Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], [0, 0.95, 0], 0.018, C.yellow, { seg: 6 });
    }
    b.cyl(0.022, 0.5, C.charcoal, 0, 0.9, 0, { seg: 6 });
    b.box(0.34, 0.24, 0.1, C.yellow, 0, 1.36, 0, { r: 0.02, rx: -0.25 });
    b.box(0.4, 0.03, 0.04, C.charcoal, 0, 1.32, -0.03, { r: 0 });
  });
  const lens = kit.emissive(0xf3efe0, C.lampWarm, 0.25, 1.3);
  kit.add(shapeMesh(bakeModel("lamp:work:lens", (b) => b.box(0.28, 0.18, 0.02, 0xffffff, 0, 1.39, 0.052, { r: 0, rx: -0.25 })), lens));
  addLightPool(kit, 1.4, C.lampWarm, 0, 0.7);
  return kit.finish({ w: 0.7, d: 0.7 });
};

export interface PendantOptions {
  /** Height the cable hangs from (the cut-away ceiling line). Default 2.6. */
  ceiling?: number;
  /** Height of the bottom of the shade. Default 1.9. */
  drop?: number;
  shade?: number;
}

/**
 * Pendant lamp for a room with no ceiling: a little canopy disc at the ceiling
 * line, a cable and a dome shade. `setGlow` lights it and its floor pool.
 */
export const createPendantLamp = (options: PendantOptions = {}): PropHandle => {
  const ceiling = options.ceiling ?? SCALE.wall;
  const drop = options.drop ?? 1.9;
  const shade = options.shade ?? C.teal;
  const kit = new PropKit("pendant");
  kit.ownModel((b) => {
    b.cyl(0.07, 0.03, C.charcoal, 0, ceiling - 0.03, 0, { seg: 10 });
    b.tube([0, ceiling - 0.03, 0], [0, drop + 0.2, 0], 0.008, C.charcoal, { seg: 5 });
    b.lathe(
      [
        [0.03, 0.2],
        [0.06, 0.2],
        [0.2, 0.04],
        [0.21, 0],
        [0.19, 0],
        [0.05, 0.17],
      ],
      shade,
      0,
      drop,
      0,
      { seg: 14 }
    );
  });
  const bulb = kit.emissive(0xfff6dd, C.lampWarm, 0.3, 1.4);
  kit.add(shapeMesh(bakeModel("pendant:bulb", (b) => b.ball(0.07, 0xffffff, 0, 0, 0, { seg: 8 })), bulb)).position.y = drop + 0.01;
  addLightPool(kit, 1.3, C.lampWarm);
  return kit.finish({ w: 0.45, d: 0.45 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Signs + wall art
// ─────────────────────────────────────────────────────────────────────────────

export interface SignOptions {
  /** Plaque height. Width follows the text. Default 0.34. */
  height?: number;
  background?: number;
  color?: number;
  /** Glowing letters (the texture becomes an emissive map). */
  lit?: boolean;
}

const SIGN_FONT_SCALE = 0.56;
const SIGN_CHAR_WIDTH = 0.6;

const signWidth = (text: string, height: number): number => Math.max(height * 1.4, (text.length * SIGN_FONT_SCALE * SIGN_CHAR_WIDTH + 0.7) * height);

const drawSign =
  (text: string, background: number, color: number): CanvasDraw =>
  (ctx, w, h) => {
    ctx.fillStyle = cssColor(background);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cssColor(color);
    ctx.font = `600 ${Math.round(h * SIGN_FONT_SCALE)}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + h * 0.03, w * 0.92);
  };

/**
 * Wall plaque with text (company name, room names). Hangs with its centre at
 * the group origin's x, its bottom edge at y = 0 — position the group at the
 * height you want — and its back on z = 0. Falls back to a blank plaque with an
 * accent bar where canvases are unavailable.
 */
export const createSign = (text: string, options: SignOptions = {}): PropHandle => {
  const height = options.height ?? 0.34;
  const background = options.background ?? INK;
  const color = options.color ?? NEON;
  const width = signWidth(text, height);
  const kit = new PropKit("sign");
  kit.ownModel((b) => {
    b.box(width + 0.06, height + 0.06, 0.04, darken(background, 0.3), 0, -0.03, 0.02, { r: 0.012 });
    b.box(width, height, 0.012, background, 0, 0, 0.044, { r: 0 });
    b.box(width * 0.6, height * 0.12, 0.006, color, 0, height * 0.16, 0.05, { r: 0 });
  });
  const face = texturedPlane(`sign:${text}:${background}:${color}`, width, height, 240, drawSign(text, background, color), options.lit ? 0.85 : 0);
  if (face) {
    face.position.set(0, height / 2, 0.058);
    kit.add(face);
  }
  return kit.finish({ w: width + 0.06, d: 0.06 });
};

const drawNeon =
  (text: string, color: number): CanvasDraw =>
  (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = `600 ${Math.round(h * 0.6)}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Outer glow, then the bright tube core.
    ctx.shadowColor = cssColor(color);
    ctx.shadowBlur = h * 0.22;
    ctx.fillStyle = cssColor(color);
    ctx.fillText(text, w / 2, h / 2, w * 0.9);
    ctx.fillText(text, w / 2, h / 2, w * 0.9);
    ctx.shadowBlur = 0;
    ctx.fillStyle = cssColor(lighten(color, 0.7));
    ctx.fillText(text, w / 2, h / 2, w * 0.9);
  };

export interface NeonSignOptions {
  color?: number;
  /** Letter height. Default 0.5. */
  height?: number;
}

/**
 * The company name in neon on a dark backing board. Same placement rule as
 * createSign (bottom edge at y = 0, back at z = 0). `setGlow(0..1)` takes it
 * from "switched on in daylight" to full dusk blaze; update() adds a faint buzz.
 */
export const createNeonSign = (text: string, options: NeonSignOptions = {}): PropHandle => {
  const color = options.color ?? NEON;
  const height = options.height ?? 0.5;
  const label = text.trim() || "STARTUP";
  const width = signWidth(label, height);
  const kit = new PropKit("neon-sign");
  kit.ownModel((b) => {
    b.box(width + 0.1, height + 0.1, 0.05, INK, 0, -0.05, 0.025, { r: 0.016 });
    b.box(width + 0.14, 0.03, 0.06, STEEL, 0, -0.06, 0.03, { r: 0.008 });
    for (const sx of [-1, 1]) b.cyl(0.02, 0.04, STEEL, sx * (width / 2 - 0.05), height + 0.02, 0.03, { axis: "z", seg: 6 });
  });

  const texture = createDynamicTexture(Math.min(1024, Math.round(width * 220)), Math.round(height * 220), drawNeon(label, color));
  let material: THREE.MeshBasicMaterial | null = null;
  if (texture) {
    kit.own(texture);
    material = kit.own(new THREE.MeshBasicMaterial({ map: texture.texture, transparent: true, depthWrite: false, toneMapped: false }));
    const face = new THREE.Mesh(unitPlane(), material);
    face.scale.set(width, height, 1);
    face.position.set(0, height / 2, 0.058);
    kit.add(face);
  } else {
    // No canvas: a plain neon bar so the sign still reads as lit.
    const bar = new THREE.Mesh(
      bakeModel(null, (b) => b.box(width * 0.8, height * 0.3, 0.02, 0xffffff, 0, height * 0.35, 0.06, { r: 0.01 })),
      glowMat(color)
    );
    kit.own(bar.geometry);
    kit.add(bar);
  }
  const face = material;
  kit.tracksGlow();
  kit.onUpdate((_dt, elapsed) => {
    if (!face) return;
    // Day: dimmer and steady. Dusk: full brightness with the odd flicker.
    const buzz = Math.sin(elapsed * 47) * Math.sin(elapsed * 3.1) > 0.92 ? 0.75 : 1;
    face.opacity = (0.72 + kit.glowAmount * 0.28) * buzz;
  });
  return kit.finish({ w: width + 0.14, d: 0.07 });
};

/**
 * Framed abstract poster made of geometry (no textures, so it looks the same
 * everywhere). Placement as createSign: bottom edge at y = 0, back at z = 0.
 */
export const createWallArt = (variant = 0): PropHandle => {
  const v = ((variant % 4) + 4) % 4;
  const kit = new PropKit("wall-art");
  const w = v === 3 ? 1.2 : 0.7;
  const h = v === 3 ? 0.7 : 0.9;
  kit.model(`wall-art:${v}`, (b) => {
    b.box(w + 0.07, h + 0.07, 0.04, v % 2 ? C.oak : C.charcoal, 0, -0.035, 0.02, { r: 0.012 });
    b.box(w, h, 0.012, C.paper, 0, 0, 0.042, { r: 0 });
    const z = 0.05;
    if (v === 0) {
      // Rising sun over hills.
      b.cyl(0.2, 0.006, EMBER, 0, h * 0.42, z, { axis: "z", seg: 16 });
      b.box(w, h * 0.3, 0.008, C.teal, 0, 0, z + 0.002, { r: 0 });
      b.prism(
        [
          [-w / 2, 0],
          [-0.05, h * 0.36],
          [w * 0.2, 0],
        ],
        0.008,
        C.leafDark,
        0,
        h * 0.12,
        z + 0.006
      );
    } else if (v === 1) {
      // Colour blocks.
      b.box(w * 0.44, h * 0.5, 0.008, C.red, -w * 0.2, h * 0.42, z, { r: 0 });
      b.box(w * 0.36, h * 0.3, 0.008, C.blue, w * 0.24, h * 0.1, z, { r: 0 });
      b.box(w * 0.3, h * 0.24, 0.008, C.yellow, w * 0.26, h * 0.62, z, { r: 0 });
      b.box(w * 0.5, 0.03, 0.01, C.charcoal, -w * 0.12, h * 0.32, z + 0.002, { r: 0 });
    } else if (v === 2) {
      // Rocket.
      b.box(0.14, 0.36, 0.01, C.white, 0, h * 0.36, z, { r: 0 });
      b.prism(
        [
          [-0.07, 0],
          [0.07, 0],
          [0, 0.14],
        ],
        0.01,
        C.red,
        0,
        h * 0.36 + 0.36,
        z
      );
      for (const sx of [-1, 1]) b.box(0.07, 0.12, 0.01, C.red, sx * 0.1, h * 0.36, z, { rz: sx * 0.4, r: 0 });
      b.prism(
        [
          [-0.05, 0],
          [0.05, 0],
          [0, -0.18],
        ],
        0.01,
        EMBER,
        0,
        h * 0.36,
        z
      );
      b.cyl(0.035, 0.008, NEON, 0, h * 0.36 + 0.2, z + 0.004, { axis: "z", seg: 10 });
      for (const [sx, sy] of [
        [-0.22, 0.7],
        [0.2, 0.2],
        [0.24, 0.78],
        [-0.2, 0.26],
      ]) {
        b.box(0.03, 0.03, 0.008, C.yellow, sx, h * sy, z, { rz: 0.78, r: 0 });
      }
    } else {
      // Wide chart: the hockey stick everybody dreams of.
      const points = [0.12, 0.16, 0.14, 0.22, 0.3, 0.46, 0.74];
      points.forEach((p, i) => {
        if (i === 0) return;
        const x0 = -w / 2 + 0.12 + ((i - 1) * (w - 0.24)) / (points.length - 1);
        const x1 = -w / 2 + 0.12 + (i * (w - 0.24)) / (points.length - 1);
        b.strut([x0, h * points[i - 1], z], [x1, h * p, z], 0.028, i >= points.length - 2 ? EMBER : C.teal, { r: 0 });
      });
      b.box(w - 0.2, 0.014, 0.008, C.grey, 0, h * 0.09, z, { r: 0 });
    }
  });
  return kit.finish({ w: w + 0.07, d: 0.06 });
};
