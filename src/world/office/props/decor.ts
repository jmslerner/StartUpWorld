/**
 * Décor: everything that makes the office feel lived in but is not a station —
 * plants, storage, lounge furniture, garage clutter, toys for the bigger offices
 * and the street furniture / skyline around the building.
 *
 * All fixed shapes: geometry comes from the shared cache, so a hundred plants
 * cost one upload. Fronts face +Z.
 */
import * as THREE from "three";
import type { LookId, OfficeIndex } from "../../types";
import {
  bakeModel,
  C,
  createDynamicTexture,
  cssColor,
  darken,
  desaturate,
  EMBER,
  glassMat,
  glowMat,
  LABEL_FONT,
  lighten,
  mixColor,
  ModelBuilder,
  NEON,
  phaseTier,
  themeFor,
  starPoints,
  unitPlane,
} from "../../core/palette";
import type { CanvasDraw } from "../../core/palette";
import { addLightPool } from "./building";
import { drawBookRow, drawChair, drawMonitor, drawMug, drawPaperStack, drawPlant, monitorScreen } from "./parts";
import type { PlantSize } from "./parts";
import { createScreenSurface, hash01, PropKit, screenQuads, shapeMesh } from "./shared";
import type { PropHandle } from "./shared";

const hex = (color: number): string => color.toString(16);

// ─────────────────────────────────────────────────────────────────────────────
// Plants
// ─────────────────────────────────────────────────────────────────────────────

export const PLANT_SIZES: readonly PlantSize[] = ["small", "medium", "large"];

export interface PlantOptions {
  pot?: number;
  /** Rotates / recolours the foliage so a row of plants is not identical. */
  variant?: number;
}

/** Potted plant: "small" for desks and shelves, "medium" bushy floor plant, "large" tall statement plant. */
export const createPlant = (size: PlantSize = "medium", options: PlantOptions = {}): PropHandle => {
  const pot = options.pot ?? (size === "small" ? C.white : C.terracotta);
  const variant = Math.abs(options.variant ?? 0) % 4;
  const kit = new PropKit(`plant:${size}`);
  kit.model(`plant:${size}:${hex(pot)}:${variant}`, (b) => drawPlant(b, size, 0, 0, 0, pot, variant));
  const extent = size === "small" ? 0.22 : size === "medium" ? 0.55 : 0.8;
  return kit.finish({ w: extent, d: extent });
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

/** Open bookshelf, 0.95 wide × 1.85 tall, in the office's wood. */
export const createBookshelf = (office: OfficeIndex = 2, look: LookId = "classic"): PropHandle => {
  const theme = themeFor(office, look);
  const tier = phaseTier(office);
  const kit = new PropKit("bookshelf");
  kit.model(`bookshelf:${look}:${office}`, (b) => {
    const w = 0.95;
    const h = 1.85;
    const d = 0.34;
    const wood = tier === 2 ? C.white : theme.wood;
    const back = tier === 2 ? C.greyLight : theme.woodDark;
    b.box(w, h, 0.03, back, 0, 0, -d / 2 + 0.015, { r: 0 });
    for (const sx of [-1, 1]) b.box(0.045, h, d, wood, sx * (w / 2 - 0.0225), 0, 0, { r: 0.01 });
    const shelves = 5;
    for (let i = 0; i <= shelves; i += 1) {
      const y = i === 0 ? 0.04 : (i * (h - 0.04)) / shelves;
      b.box(w - 0.05, 0.04, d - 0.02, wood, 0, y - (i === shelves ? 0.04 : 0), 0.005, { r: 0.008 });
    }
    const pitch = (h - 0.04) / shelves;
    for (let i = 0; i < shelves; i += 1) {
      const y = (i === 0 ? 0.08 : i * pitch + 0.04) - (i === 0 ? 0 : 0);
      const left = -w / 2 + 0.06;
      switch (i) {
        case 0:
          // Box files.
          for (let k = 0; k < 4; k += 1) b.box(0.1, 0.27, 0.26, [C.navy, C.charcoal, C.red, C.navy][k], left + 0.06 + k * 0.115, y, 0.02, { r: 0.008 });
          drawPaperStack(b, 0.27, y, 0.02, 0.1, 4);
          break;
        case 1:
          drawBookRow(b, left, y, 0.02, 9, 3 + tier);
          break;
        case 2: {
          const end = drawBookRow(b, left, y, 0.02, 5, 11 + tier);
          drawPlant(b, "small", Math.min(0.3, end + 0.2), y, 0.04, C.white, 1);
          break;
        }
        case 3:
          // Trophy and a framed photo.
          drawBookRow(b, left + 0.34, y, 0.02, 6, 7 + tier);
          b.box(0.16, 0.2, 0.02, C.oak, left + 0.12, y, 0.0, { rx: -0.15, r: 0.004 });
          b.box(0.12, 0.15, 0.006, 0x9fd4ee, left + 0.12, y + 0.022, 0.012, { rx: -0.15, r: 0 });
          break;
        default:
          drawBookRow(b, left + 0.2, y, 0.02, 4, 19 + tier);
          b.box(0.22, 0.14, 0.24, C.cardboard, 0.28, y, 0.02, { r: 0.008 });
          break;
      }
    }
    drawPlant(b, "small", -0.2, h, 0, C.terracotta, 2);
    b.box(0.3, 0.12, 0.22, C.cardboard, 0.2, h, 0, { ry: 0.2, r: 0.008 });
  });
  return kit.finish({ w: 0.95, d: 0.34 });
};

/** Metal filing cabinet with something left on top. */
export const createFilingCabinet = (options: { drawers?: number; color?: number } = {}): PropHandle => {
  const drawers = Math.max(2, Math.min(4, options.drawers ?? 3));
  const color = options.color ?? 0x8fa097;
  const kit = new PropKit("filing-cabinet");
  kit.model(`filing-cabinet:${drawers}:${hex(color)}`, (b) => {
    const w = 0.46;
    const d = 0.6;
    const h = drawers * 0.34 + 0.06;
    b.box(w, h, d, color, 0, 0, 0, { r: 0.016 });
    b.box(w - 0.02, 0.03, d - 0.02, darken(color, 0.3), 0, 0, 0, { r: 0 });
    for (let i = 0; i < drawers; i += 1) {
      const y = 0.05 + i * 0.34;
      b.box(w - 0.06, 0.3, 0.016, lighten(color, 0.12), 0, y, d / 2 - 0.002, { r: 0.006 });
      b.box(0.16, 0.025, 0.03, C.chrome, 0, y + 0.19, d / 2 + 0.012, { r: 0.008 });
      b.box(0.1, 0.05, 0.008, C.paper, 0, y + 0.09, d / 2 + 0.008, { r: 0 });
    }
    drawPlant(b, "small", -0.1, h, -0.1, C.white, 3);
    drawPaperStack(b, 0.08, h, 0.1, 0.25, 3);
  });
  return kit.finish({ w: 0.46, d: 0.6 });
};

/** Pile of moving boxes — the garage's storage system. Three arrangements. */
export const createCardboardBoxes = (variant = 0): PropHandle => {
  const v = ((variant % 3) + 3) % 3;
  const kit = new PropKit("boxes");
  kit.model(`boxes:${v}`, (b) => {
    const carton = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, open = false): void => {
      b.at(x, y, z, yaw, () => {
        b.box(w, h, d, C.cardboard, 0, 0, 0, { r: 0.008 });
        b.box(0.07, 0.006, d + 0.004, C.tape, 0, h, 0, { r: 0 });
        b.box(0.07, h * 0.3, 0.006, C.tape, 0, h * 0.7, d / 2 + 0.001, { r: 0 });
        if (open) {
          for (const sx of [-1, 1]) b.box(w / 2, 0.012, d, C.cardboardDark, sx * (w / 2 + w / 4 - 0.03), h - 0.06, 0, { rz: sx * -0.9, r: 0 });
          b.box(w - 0.06, 0.02, d - 0.06, C.paper, 0, h - 0.06, 0, { r: 0 });
        } else {
          b.box(w * 0.4, h * 0.22, 0.006, C.red, w * 0.18, h * 0.2, d / 2 + 0.001, { r: 0 });
        }
      });
    };
    if (v === 0) {
      carton(-0.05, 0, 0, 0.56, 0.44, 0.5, 0.1);
      carton(0.0, 0.44, 0.02, 0.44, 0.36, 0.4, -0.25);
      carton(0.48, 0, 0.14, 0.36, 0.3, 0.34, 0.5, true);
    } else if (v === 1) {
      carton(0, 0, 0, 0.6, 0.4, 0.46, -0.08, true);
      carton(-0.5, 0, 0.1, 0.34, 0.34, 0.34, 0.3);
    } else {
      carton(-0.22, 0, 0, 0.44, 0.42, 0.44, 0.05);
      carton(0.26, 0, -0.02, 0.44, 0.42, 0.44, -0.06);
      carton(0.02, 0.42, 0, 0.5, 0.36, 0.42, 0.2);
      carton(0.06, 0.78, 0.02, 0.32, 0.26, 0.3, -0.3);
    }
  });
  return kit.finish({ w: 1.0, d: 0.6 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Soft seating
// ─────────────────────────────────────────────────────────────────────────────

const drawCouch = (b: ModelBuilder, seats: number, color: number): void => {
  const w = seats * 0.62 + 0.36;
  const shade = darken(color, 0.14);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(0.035, 0.1, C.walnutDark, sx * (w / 2 - 0.1), 0, sz * 0.3, { taper: 1.3, seg: 6 });
  }
  b.box(w, 0.2, 0.84, shade, 0, 0.1, 0, { r: 0.05 });
  b.box(w - 0.3, 0.52, 0.2, shade, 0, 0.26, -0.32, { r: 0.07, rx: -0.12 });
  for (const sx of [-1, 1]) b.box(0.2, 0.36, 0.84, color, sx * (w / 2 - 0.1), 0.26, 0, { r: 0.08, round: 2 });
  for (let i = 0; i < seats; i += 1) {
    const x = -((seats - 1) * 0.62) / 2 + i * 0.62;
    b.box(0.6, 0.15, 0.58, color, x, 0.29, 0.09, { r: 0.06, round: 2 });
    b.box(0.58, 0.36, 0.18, color, x, 0.42, -0.24, { r: 0.07, round: 2, rx: -0.14 });
  }
};

/** Chunky couch, 2 or 3 seats. Seat at ≈ 0.44. */
export const createCouch = (options: { seats?: 2 | 3; color?: number } = {}): PropHandle => {
  const seats = options.seats ?? 2;
  const color = options.color ?? C.teal;
  const kit = new PropKit("couch");
  kit.model(`couch:${seats}:${hex(color)}`, (b) => {
    drawCouch(b, seats, color);
    // A throw cushion in a clashing colour, because offices.
    b.box(0.3, 0.3, 0.12, color === C.yellow ? C.coral : C.yellow, -((seats - 1) * 0.62) / 2 - 0.06, 0.44, 0.02, { r: 0.05, round: 2, rx: -0.3, rz: 0.2 });
  });
  return kit.finish({ w: seats * 0.62 + 0.36, d: 0.84 });
};

/** Low table with the usual coffee-table debris. */
export const createCoffeeTable = (office: OfficeIndex = 2, look: LookId = "classic"): PropHandle => {
  const theme = themeFor(office, look);
  const tier = phaseTier(office);
  const kit = new PropKit("coffee-table");
  kit.model(`coffee-table:${look}:${office}`, (b) => {
    const top = 0.4;
    if (tier === 0) {
      // A pallet on bricks.
      for (const sz of [-1, 0, 1]) b.box(1.0, 0.09, 0.09, C.pallet, 0, 0.12, sz * 0.24, { r: 0.008 });
      for (let i = 0; i < 6; i += 1) b.box(0.15, 0.03, 0.6, i % 2 ? C.pallet : C.plywood, -0.42 + i * 0.168, 0.21, 0, { r: 0 });
      for (const sx of [-1, 1]) b.box(0.2, 0.12, 0.44, C.brick, sx * 0.34, 0, 0, { r: 0.008 });
      drawMug(b, 0.24, 0.24, 0.1, C.yellow, 0.7);
      b.box(0.3, 0.035, 0.3, C.cardboard, -0.2, 0.24, 0, { ry: 0.3, r: 0.006 });
      return;
    }
    b.box(1.0, 0.045, 0.55, theme.wood, 0, top - 0.045, 0, { r: 0.022 });
    b.box(0.86, 0.02, 0.42, theme.woodDark, 0, 0.14, 0, { r: 0.008 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.tube([sx * 0.46, 0, sz * 0.24], [sx * 0.4, top - 0.04, sz * 0.2], 0.018, tier === 4 ? C.brass : C.charcoal, { seg: 6 });
    }
    b.box(0.22, 0.012, 0.3, theme.accents[0], -0.24, top, 0.02, { ry: 0.2, r: 0 });
    b.box(0.22, 0.012, 0.3, C.paper, -0.2, top + 0.012, 0.0, { ry: -0.1, r: 0 });
    drawMug(b, 0.3, top, -0.1, C.white, 2.4);
    drawPlant(b, "small", 0.1, top, 0.12, tier === 4 ? C.brass : C.white, 2);
    b.box(0.2, 0.012, 0.28, C.navy, 0.2, 0.16, 0, { ry: 0.3, r: 0 });
  });
  return kit.finish({ w: 1.0, d: 0.55 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Office staples
// ─────────────────────────────────────────────────────────────────────────────

/** Water cooler. The gossip hub. */
export const createWaterCooler = (): PropHandle => {
  const kit = new PropKit("water-cooler");
  kit.model("water-cooler", (b) => {
    b.box(0.34, 0.95, 0.34, C.white, 0, 0, 0, { r: 0.03 });
    b.box(0.3, 0.26, 0.04, C.greyLight, 0, 0.5, 0.16, { r: 0.008 });
    b.box(0.24, 0.02, 0.1, C.grey, 0, 0.5, 0.2, { r: 0 });
    b.box(0.045, 0.05, 0.05, C.blue, -0.06, 0.7, 0.19, { r: 0.01 });
    b.box(0.045, 0.05, 0.05, C.red, 0.06, 0.7, 0.19, { r: 0.01 });
    // Upturned bottle.
    b.cyl(0.06, 0.07, 0x9fd4ee, 0, 0.95, 0, { seg: 10 });
    b.lathe(
      [
        [0.06, 0],
        [0.15, 0.08],
        [0.15, 0.36],
        [0.13, 0.4],
        [0.001, 0.4],
      ],
      0x9fd4ee,
      0,
      1.02,
      0,
      { seg: 14 }
    );
    b.cyl(0.152, 0.02, lighten(0x9fd4ee, 0.35), 0, 1.24, 0, { seg: 14 });
    // Cup tube on the side.
    b.cyl(0.04, 0.3, C.paper, 0.2, 0.52, 0.02, { seg: 8 });
    b.cyl(0.045, 0.03, C.grey, 0.2, 0.5, 0.02, { seg: 8 });
  });
  return kit.finish({ w: 0.45, d: 0.4 });
};

/** Whiteboard on castors, mid-brainstorm. */
export const createWhiteboard = (): PropHandle => {
  const kit = new PropKit("whiteboard");
  kit.model("whiteboard", (b) => {
    const w = 1.5;
    const h = 1.0;
    const y = 0.82;
    for (const sx of [-1, 1]) {
      b.box(0.05, y + h + 0.06, 0.05, C.greyLight, sx * (w / 2 + 0.03), 0.07, 0, { r: 0.012 });
      b.box(0.06, 0.04, 0.5, C.greyLight, sx * (w / 2 + 0.03), 0.06, 0, { r: 0.012 });
      for (const sz of [-1, 1]) b.ball(0.035, C.black, sx * (w / 2 + 0.03), 0, sz * 0.22, { seg: 8 });
    }
    b.box(w, 0.04, 0.04, C.greyLight, 0, 0.36, 0, { r: 0.01 });
    b.box(w + 0.02, h + 0.04, 0.035, C.greyLight, 0, y - 0.02, 0, { r: 0.012 });
    b.box(w - 0.04, h - 0.04, 0.012, C.paper, 0, y + 0.02, 0.018, { r: 0 });
    b.box(w * 0.5, 0.025, 0.07, C.greyLight, 0, y - 0.03, 0.05, { r: 0.008 });
    b.cyl(0.013, 0.1, C.red, -0.15, y - 0.005, 0.06, { axis: "x", seg: 6 });
    b.cyl(0.013, 0.1, C.blue, 0.05, y - 0.005, 0.06, { axis: "x", seg: 6 });
    const z = 0.026;
    // A funnel diagram: three boxes joined by arrows, and an over-optimistic curve.
    const boxes: Array<[number, number, number]> = [
      [-0.5, 0.62, C.blue],
      [-0.5, 0.36, C.blue],
      [-0.5, 0.1, C.red],
    ];
    for (const [bx, by, color] of boxes) {
      b.box(0.3, 0.016, 0.004, color, bx, y + by + 0.14, z, { r: 0 });
      b.box(0.3, 0.016, 0.004, color, bx, y + by, z, { r: 0 });
      for (const sx of [-1, 1]) b.box(0.016, 0.156, 0.004, color, bx + sx * 0.142, y + by, z, { r: 0 });
    }
    b.box(0.014, 0.1, 0.004, C.charcoal, -0.5, y + 0.52, z, { r: 0 });
    b.box(0.014, 0.1, 0.004, C.charcoal, -0.5, y + 0.26, z, { r: 0 });
    const curve = [0.12, 0.15, 0.2, 0.3, 0.5, 0.82];
    for (let i = 1; i < curve.length; i += 1) {
      b.strut([-0.1 + (i - 1) * 0.14, y + curve[i - 1], z], [-0.1 + i * 0.14, y + curve[i], z], 0.016, C.green, { r: 0 });
    }
    b.box(0.76, 0.012, 0.004, C.charcoal, 0.26, y + 0.1, z, { r: 0 });
    b.box(0.012, 0.76, 0.004, C.charcoal, -0.12, y + 0.1, z, { r: 0 });
    b.box(0.075, 0.075, 0.006, C.noteYellow, 0.5, y + 0.3, z, { rz: 0.1, r: 0 });
    b.box(0.075, 0.075, 0.006, C.notePink, 0.58, y + 0.2, z, { rz: -0.15, r: 0 });
  });
  return kit.finish({ w: 1.62, d: 0.5 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Garage
// ─────────────────────────────────────────────────────────────────────────────

/** Somebody's old hatchback, parked where the office now is. Front toward +Z. 1.75 wide × 3.7 long. */
export const createParkedCar = (options: { color?: number } = {}): PropHandle => {
  const color = options.color ?? 0x6aa9a0;
  const kit = new PropKit("car");
  kit.model(`car:${hex(color)}`, (b) => {
    const glass = 0x39485a;
    const trim = 0x4a5059;
    // Body: a low hull and a tapered cabin.
    b.box(1.7, 0.52, 3.7, color, 0, 0.26, 0, { r: 0.16, round: 2 });
    b.box(1.56, 0.5, 2.0, color, 0, 0.74, -0.3, { r: 0.14, round: 2, taper: 0.84 });
    // Glasshouse.
    b.box(1.34, 0.3, 0.03, glass, 0, 0.84, 0.68, { rx: -0.42, r: 0 });
    b.box(1.3, 0.28, 0.03, glass, 0, 0.84, -1.27, { rx: 0.4, r: 0 });
    for (const sx of [-1, 1]) {
      b.box(0.03, 0.26, 0.78, glass, sx * 0.752, 0.86, 0.14, { rz: sx * 0.11, r: 0 });
      b.box(0.03, 0.26, 0.7, glass, sx * 0.752, 0.86, -0.7, { rz: sx * 0.11, r: 0 });
      // Wheels with pale hubcaps, and arches.
      for (const sz of [-1, 1]) {
        b.cyl(0.32, 0.24, C.black, sx * 0.78, 0, sz * 1.15, { axis: "x", seg: 14 });
        b.cyl(0.17, 0.26, C.greyLight, sx * 0.78, 0.15, sz * 1.15, { axis: "x", seg: 10 });
      }
      b.box(0.1, 0.07, 0.14, color, sx * 0.9, 0.78, 0.62, { r: 0.02 });
      b.box(0.03, 0.03, 0.14, trim, sx * 0.86, 0.6, 0.06, { r: 0 });
    }
    // Bumpers, lights, plates.
    b.box(1.66, 0.14, 0.14, trim, 0, 0.26, 1.83, { r: 0.04 });
    b.box(1.66, 0.14, 0.14, trim, 0, 0.26, -1.83, { r: 0.04 });
    for (const sx of [-1, 1]) {
      b.cyl(0.11, 0.05, 0xfff3c4, sx * 0.58, 0.5, 1.82, { axis: "z", seg: 10 });
      b.box(0.24, 0.1, 0.04, C.red, sx * 0.6, 0.58, -1.84, { r: 0.012 });
    }
    b.box(0.6, 0.12, 0.03, trim, 0, 0.5, 1.845, { r: 0 });
    b.box(0.34, 0.1, 0.02, C.paper, 0, 0.3, 1.9, { r: 0 });
    b.box(0.34, 0.1, 0.02, C.paper, 0, 0.44, -1.86, { r: 0 });
    // Roof rack with a surfboard: somebody's other plan.
    for (const sz of [-0.9, 0.2]) b.box(1.4, 0.03, 0.04, trim, 0, 1.26, sz, { r: 0 });
    b.box(0.46, 0.05, 2.1, C.yellow, 0.1, 1.29, -0.35, { r: 0.022 });
    b.box(0.06, 0.052, 2.0, C.coral, 0.1, 1.29, -0.35, { r: 0 });
  });
  return kit.finish({ w: 1.9, d: 3.8 });
};

/** Commuter bike on its kickstand. Front wheel toward +Z. */
export const createBicycle = (options: { color?: number } = {}): PropHandle => {
  const color = options.color ?? C.red;
  const kit = new PropKit("bicycle");
  kit.model(`bicycle:${hex(color)}`, (b) => {
    b.place(0, 0, 0, { rz: -0.1 }, () => {
      const r = 0.31;
      for (const z of [-0.5, 0.52]) {
        b.torus(r, 0.028, C.black, 0, 0, z, { axis: "x", seg: 18 });
        b.cyl(0.035, 0.05, C.chrome, 0, r - 0.007, z, { axis: "x", seg: 6 });
        for (let i = 0; i < 4; i += 1) {
          const a = (i / 4) * Math.PI;
          b.tube([0, r + 0.028 - Math.cos(a) * r, z - Math.sin(a) * r], [0, r + 0.028 + Math.cos(a) * r, z + Math.sin(a) * r], 0.006, C.chrome, { seg: 4 });
        }
      }
      const hub = r + 0.028;
      const seat: [number, number, number] = [0, 0.82, -0.2];
      const crank: [number, number, number] = [0, 0.3, -0.02];
      const head: [number, number, number] = [0, 0.84, 0.38];
      b.tube([0, hub, -0.5], seat, 0.018, color, { seg: 6 });
      b.tube([0, hub, -0.5], crank, 0.018, color, { seg: 6 });
      b.tube(crank, seat, 0.02, color, { seg: 6 });
      b.tube(crank, head, 0.022, color, { seg: 6 });
      b.tube(seat, head, 0.02, color, { seg: 6 });
      b.tube(head, [0, hub, 0.52], 0.018, C.chrome, { seg: 6 });
      b.tube(head, [0, 0.98, 0.34], 0.016, C.chrome, { seg: 6 });
      b.cyl(0.014, 0.46, C.charcoal, 0, 0.966, 0.34, { axis: "x", seg: 6 });
      b.box(0.11, 0.045, 0.24, C.leatherDark, 0, 0.86, -0.24, { r: 0.02 });
      b.tube(seat, [0, 0.88, -0.22], 0.014, C.chrome, { seg: 6 });
      b.cyl(0.085, 0.012, C.chrome, 0.03, 0.215, -0.02, { axis: "x", seg: 10 });
      b.box(0.1, 0.02, 0.06, C.charcoal, 0.1, 0.2, -0.02, { r: 0 });
      // Kickstand.
      b.tube([-0.02, 0.28, -0.2], [-0.2, 0, -0.26], 0.012, C.chrome, { seg: 5 });
    });
  });
  return kit.finish({ w: 0.6, d: 1.75 });
};

/** Wall-hung tool pegboard with the outline of the wrench somebody never put back. Bottom of the board at y = 1.0. */
export const createPegboard = (): PropHandle => {
  const kit = new PropKit("pegboard");
  kit.model("pegboard", (b) => {
    const w = 1.4;
    const h = 0.9;
    const y = 1.0;
    const z = 0.035;
    b.box(w, h, 0.03, 0xc7b08a, 0, y, 0.015, { r: 0.006 });
    b.box(w + 0.04, 0.04, 0.045, C.pallet, 0, y - 0.02, 0.02, { r: 0 });
    b.box(w + 0.04, 0.04, 0.045, C.pallet, 0, y + h - 0.02, 0.02, { r: 0 });
    // Peg holes.
    for (let ix = 0; ix < 9; ix += 1) {
      for (let iy = 0; iy < 5; iy += 1) b.box(0.016, 0.016, 0.004, darken(0xc7b08a, 0.3), -w / 2 + 0.14 + ix * 0.14, y + 0.12 + iy * 0.16, 0.03, { r: 0 });
    }
    // Hammer.
    b.strut([-0.52, y + 0.2, z], [-0.52, y + 0.66, z], 0.03, C.oak, { r: 0.008 });
    b.box(0.16, 0.06, 0.05, C.greyDark, -0.52, y + 0.64, z, { r: 0.012 });
    // Saw.
    b.prism(
      [
        [0, 0],
        [0.42, 0.05],
        [0.42, 0.1],
        [0, 0.16],
      ],
      0.012,
      C.chrome,
      -0.36,
      y + 0.52,
      z
    );
    b.box(0.12, 0.2, 0.03, C.oak, -0.38, y + 0.5, z, { r: 0.016 });
    // Screwdrivers.
    [C.red, C.yellow, C.blue].forEach((handle, i) => {
      b.cyl(0.022, 0.12, handle, 0.14 + i * 0.1, y + 0.56, z, { seg: 6 });
      b.cyl(0.008, 0.16, C.chrome, 0.14 + i * 0.1, y + 0.4, z, { seg: 5 });
    });
    // Wrench… and the painted outline of its missing twin.
    b.strut([0.5, y + 0.42, z], [0.5, y + 0.76, z], 0.03, C.chrome, { r: 0 });
    b.torus(0.04, 0.014, C.chrome, 0.5, y + 0.76, z, { axis: "z", arc: Math.PI * 1.5, seg: 8 });
    b.box(0.04, 0.34, 0.004, darken(0xc7b08a, 0.22), 0.62, y + 0.42, 0.031, { r: 0 });
    // Tape rolls and a spirit level.
    b.torus(0.06, 0.03, C.grey, -0.14, y + 0.1, z + 0.02, { axis: "z", seg: 10 });
    b.torus(0.05, 0.026, C.yellow, 0.04, y + 0.12, z + 0.02, { axis: "z", seg: 10 });
    b.box(0.5, 0.05, 0.03, C.yellow, 0.4, y + 0.16, z, { r: 0.008 });
    b.box(0.07, 0.03, 0.034, 0x9fe6c0, 0.4, y + 0.17, z, { r: 0 });
  });
  return kit.finish({ w: 1.44, d: 0.1 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Perks
// ─────────────────────────────────────────────────────────────────────────────

/** Ping-pong table, mid-rally. 2.2 × 1.25. */
export const createPingPongTable = (): PropHandle => {
  const kit = new PropKit("ping-pong");
  kit.model("ping-pong", (b) => {
    const w = 2.2;
    const d = 1.25;
    const top = 0.76;
    const felt = 0x2f8073;
    b.box(w, 0.045, d, felt, 0, top - 0.045, 0, { r: 0.012 });
    for (const sz of [-1, 1]) b.box(w, 0.004, 0.03, C.paper, 0, top, sz * (d / 2 - 0.015), { r: 0 });
    for (const sx of [-1, 1]) b.box(0.03, 0.004, d, C.paper, sx * (w / 2 - 0.015), top, 0, { r: 0 });
    b.box(w, 0.004, 0.02, C.paper, 0, top, 0, { r: 0 });
    // Net.
    b.box(0.014, 0.14, d + 0.12, C.paper, 0, top, 0, { r: 0 });
    for (const sz of [-1, 1]) b.box(0.03, 0.18, 0.03, C.charcoal, 0, top - 0.03, sz * (d / 2 + 0.06), { r: 0 });
    // Folding undercarriage.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.strut([sx * 0.8, 0.05, sz * 0.46], [sx * 0.6, top - 0.05, sz * 0.46], 0.05, C.charcoal, { r: 0.01 });
      b.box(0.05, 0.05, 1.0, C.charcoal, sx * 0.8, 0.05, 0, { r: 0.01 });
      for (const sz of [-1, 1]) b.ball(0.04, C.black, sx * 0.8, 0, sz * 0.5, { seg: 8 });
    }
    b.box(1.3, 0.05, 0.05, C.charcoal, 0, 0.3, 0, { r: 0.01 });
    // Paddles and ball.
    const paddle = (x: number, z: number, yaw: number, face: number): void => {
      b.at(x, top, z, yaw, () => {
        b.cyl(0.085, 0.016, face, 0, 0, 0, { seg: 12 });
        b.box(0.03, 0.016, 0.1, C.oak, 0, 0, 0.12, { r: 0 });
      });
    };
    paddle(-0.7, 0.2, 0.6, C.red);
    paddle(0.74, -0.3, 2.4, C.blue);
    b.ball(0.022, C.orange, 0.3, top, 0.12, { seg: 8 });
  });
  return kit.finish({ w: 2.2, d: 1.37 });
};

/** Arcade cabinet with a lit screen and marquee. `setGlow` brightens both. */
export const createArcadeCabinet = (options: { color?: number } = {}): PropHandle => {
  const color = options.color ?? C.purple;
  const kit = new PropKit("arcade");
  const w = 0.68;
  kit.model(`arcade:${hex(color)}`, (b) => {
    // Side profile (Z forward, Y up), extruded across the width.
    const profile: Array<readonly [number, number]> = [
      [-0.36, 0],
      [0.3, 0],
      [0.3, 0.86],
      [0.4, 0.92],
      [0.4, 1.0],
      [0.14, 1.12],
      [0.06, 1.52],
      [0.3, 1.58],
      [0.3, 1.82],
      [-0.36, 1.82],
    ];
    for (const sx of [-1, 1]) {
      b.prism(profile, 0.04, color, sx * (w / 2 - 0.02), 0, 0, { ry: -Math.PI / 2 });
      b.prism(
        [
          [-0.3, 0.3],
          [0.24, 0.5],
          [0.24, 0.6],
          [-0.3, 0.4],
        ],
        0.006,
        EMBER,
        sx * (w / 2 + 0.002),
        0,
        0,
        { ry: -Math.PI / 2 }
      );
    }
    const inner = w - 0.08;
    b.box(inner, 0.86, 0.62, darken(color, 0.45), 0, 0, -0.03, { r: 0 });
    b.box(inner, 0.96, 0.4, C.black, 0, 0.86, -0.16, { r: 0 });
    // Control panel with stick and buttons.
    b.box(inner, 0.05, 0.3, C.charcoal, 0, 0.93, 0.25, { rx: 0.22, r: 0 });
    b.cyl(0.012, 0.09, C.chrome, -0.16, 0.98, 0.24, { seg: 6 });
    b.ball(0.035, C.red, -0.16, 1.05, 0.24, { seg: 8 });
    [C.yellow, C.blue, C.good].forEach((button, i) => b.cyl(0.028, 0.02, button, 0.02 + i * 0.09, 0.975 - i * 0.004, 0.26 + (i % 2) * 0.04, { seg: 8 }));
    // Coin door.
    b.box(0.3, 0.36, 0.02, C.charcoal, 0, 0.26, 0.29, { r: 0.008 });
    b.box(0.04, 0.08, 0.01, EMBER, -0.06, 0.42, 0.302, { r: 0 });
    b.box(0.04, 0.08, 0.01, EMBER, 0.06, 0.42, 0.302, { r: 0 });
    b.box(inner, 0.04, 0.06, C.chrome, 0, 0.86, 0.33, { r: 0.01 });
  });
  const screen = createScreenSurface("arcade");
  kit.own(screen.material);
  kit.add(new THREE.Mesh(screenQuads("arcade", [{ x: 0, y: 1.32, z: 0.108, w: w - 0.16, h: 0.36, tilt: 0.2 }]), screen.material));
  const marquee = kit.emissive(lighten(color, 0.3), NEON, 0.55, 1.3);
  kit.add(shapeMesh(bakeModel("arcade:marquee", (b) => b.box(w - 0.1, 0.2, 0.02, 0xffffff, 0, 1.6, 0.29, { r: 0 })), marquee, false));
  kit.onGlow((amount) => screen.setGlow(amount));
  return kit.finish({ w: 0.72, d: 0.8 });
};

/** Vending machine: lit window of snacks, keypad, pickup flap. `setGlow` lights the window. */
export const createVendingMachine = (options: { color?: number } = {}): PropHandle => {
  const color = options.color ?? C.red;
  const kit = new PropKit("vending");
  const w = 0.92;
  const d = 0.74;
  const h = 1.85;
  const windowW = w * 0.62;
  const windowX = -w / 2 + 0.07 + windowW / 2;
  // The showcase is a real recess: a back box plus a front frame, so the snacks sit inside it.
  const recess = 0.16;
  kit.model(`vending:${hex(color)}`, (b) => {
    const front = d / 2;
    const frameZ = front - recess / 2;
    b.box(w, h, d - recess, color, 0, 0, -recess / 2, { r: 0.03 });
    b.box(w - 0.06, 0.08, d - 0.04, C.black, 0, 0, 0, { r: 0 });
    const windowBottom = 0.46;
    const windowTop = h - 0.2;
    b.box(w, windowBottom, recess, color, 0, 0, frameZ, { r: 0.02 });
    b.box(w, h - windowTop, recess, color, 0, windowTop, frameZ, { r: 0.02 });
    b.box(windowX - windowW / 2 + w / 2, windowTop - windowBottom, recess, color, (-w / 2 + windowX - windowW / 2) / 2, windowBottom, frameZ, { r: 0 });
    const columnLeft = windowX + windowW / 2;
    b.box(w / 2 - columnLeft, windowTop - windowBottom, recess, color, (columnLeft + w / 2) / 2, windowBottom, frameZ, { r: 0 });
    // Shelves of snacks.
    const rows = 5;
    const pitch = (windowTop - windowBottom) / rows;
    for (let row = 0; row < rows; row += 1) {
      const y = windowBottom + row * pitch;
      b.box(windowW, 0.02, recess - 0.03, C.greyDark, windowX, y, frameZ, { r: 0 });
      const columns = 4;
      for (let column = 0; column < columns; column += 1) {
        const x = windowX - windowW / 2 + (windowW / columns) * (column + 0.5);
        const seed = row * 7 + column * 13;
        const item = [C.yellow, C.blue, C.orange, C.green, C.purple, C.paper, C.pink][seed % 7];
        if (row < 2) b.cyl(0.04, 0.14, item, x, y + 0.02, frameZ + 0.01, { seg: 8 });
        else b.box(0.1, 0.16, 0.05, item, x, y + 0.02, frameZ + 0.01, { r: 0.012, rz: (hash01(seed) - 0.5) * 0.15 });
      }
    }
    // Controls column.
    const cx = (columnLeft + w / 2) / 2;
    b.box(0.2, 0.86, 0.02, C.charcoal, cx, 0.62, front, { r: 0.008 });
    b.box(0.14, 0.09, 0.012, 0x9fe6c0, cx, 1.32, front + 0.01, { r: 0 });
    for (let i = 0; i < 9; i += 1) b.box(0.03, 0.03, 0.012, C.greyLight, cx - 0.045 + (i % 3) * 0.045, 1.06 + Math.floor(i / 3) * 0.045, front + 0.01, { r: 0 });
    b.box(0.07, 0.02, 0.012, C.black, cx, 0.95, front + 0.01, { r: 0 });
    b.box(0.1, 0.1, 0.014, C.chrome, cx, 0.74, front + 0.01, { r: 0.008 });
    // Pickup flap.
    b.box(windowW, 0.2, 0.02, C.charcoal, windowX, 0.14, front, { r: 0.008 });
    b.box(windowW - 0.1, 0.12, 0.01, C.black, windowX, 0.18, front + 0.01, { r: 0 });
  });
  const back = kit.emissive(0xdfeef2, 0xffffff, 0.35, 0.95);
  kit.add(
    shapeMesh(
      bakeModel("vending:window", (b) => b.box(windowW, h - 0.66, 0.02, 0xffffff, windowX, 0.46, d / 2 - recess - 0.01, { r: 0 })),
      back,
      false
    )
  );
  const header = kit.emissive(lighten(color, 0.5), 0xffffff, 0.3, 0.9);
  kit.add(shapeMesh(bakeModel("vending:header", (b) => b.box(w - 0.12, 0.1, 0.02, 0xffffff, 0, h - 0.12, d / 2, { r: 0 })), header, false));
  return kit.finish({ w, d });
};

/** Display case of trophies and awards — for when there is something to show off. */
export const createTrophyShelf = (): PropHandle => {
  const kit = new PropKit("trophy-shelf");
  kit.model("trophy-shelf", (b) => {
    const w = 1.1;
    const h = 1.55;
    const d = 0.36;
    b.box(w, 0.5, d, C.walnutDark, 0, 0, 0, { r: 0.014 });
    b.box(w - 0.1, 0.36, 0.014, C.walnut, 0, 0.07, d / 2, { r: 0 });
    b.ball(0.018, C.brass, 0, 0.26, d / 2 + 0.014, { seg: 6 });
    b.box(w, h - 0.5, 0.03, C.walnutDark, 0, 0.5, -d / 2 + 0.015, { r: 0 });
    for (const sx of [-1, 1]) b.box(0.04, h - 0.5, d, C.walnut, sx * (w / 2 - 0.02), 0.5, 0, { r: 0.008 });
    for (const y of [0.5, 0.98, h - 0.04]) b.box(w, 0.04, d, C.walnut, 0, y, 0, { r: 0.008 });
    const cup = (x: number, y: number, s: number, metal: number): void => {
      b.box(0.12 * s, 0.05 * s, 0.12 * s, C.black, x, y, 0, { r: 0.006 });
      b.lathe(
        [
          [0.03, 0],
          [0.012, 0.03],
          [0.012, 0.08],
          [0.07, 0.14],
          [0.085, 0.24],
          [0.075, 0.24],
        ],
        metal,
        x,
        y + 0.05 * s,
        0,
        { seg: 10 }
      );
      for (const sx of [-1, 1]) b.torus(0.03, 0.008, metal, x + sx * 0.085, y + 0.05 * s + 0.15, 0, { axis: "z", seg: 8 });
    };
    cup(-0.32, 0.54, 1, C.brass);
    cup(0.0, 0.54, 1.2, C.brass);
    cup(0.32, 0.54, 1, C.chrome);
    // Upper shelf: a star award, a plaque, a medal.
    b.box(0.14, 0.04, 0.1, C.black, -0.3, 1.02, 0, { r: 0.006 });
    b.prism(starPoints(0.1, 0.045, 5), 0.03, C.brass, -0.3, 1.18, 0);
    b.box(0.26, 0.2, 0.03, C.walnut, 0.06, 1.02, -0.02, { rx: -0.2, r: 0.006 });
    b.box(0.2, 0.14, 0.01, C.brass, 0.06, 1.05, 0.0, { rx: -0.2, r: 0 });
    b.cyl(0.05, 0.012, C.brass, 0.36, 1.1, 0, { axis: "z", seg: 10 });
    b.box(0.05, 0.1, 0.006, C.red, 0.36, 1.2, -0.004, { r: 0 });
    b.box(0.5, 0.012, 0.3, C.burgundy, 0, 1.55, 0, { r: 0 });
  });
  return kit.finish({ w: 1.1, d: 0.36 });
};

const drawTicker =
  (symbol: string): CanvasDraw =>
  (ctx, w, h) => {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    ctx.font = `600 ${Math.round(h * 0.62)}px ${LABEL_FONT}`;
    ctx.textBaseline = "middle";
    const quotes: Array<[string, string, boolean]> = [
      [symbol, "128.40", true],
      ["CASH", "41.07", false],
      [symbol, "+3.2%", true],
      ["BURN", "9.99", false],
      ["HYPE", "77.70", true],
    ];
    let x = 12;
    for (const [name, value, up] of quotes) {
      ctx.fillStyle = cssColor(NEON);
      ctx.fillText(name, x, h / 2 + 2);
      x += ctx.measureText(name).width + 10;
      ctx.fillStyle = up ? "#4ade80" : "#f87171";
      ctx.fillText(`${up ? "▲" : "▼"}${value}`, x, h / 2 + 2);
      x += ctx.measureText(`▲${value}`).width + 34;
    }
  };

/** Scrolling LED stock ticker on a pair of posts (public-company bragging rights). 2.8 wide, 2.5 tall. */
export const createStockTicker = (options: { symbol?: string } = {}): PropHandle => {
  const symbol = (options.symbol ?? "SUW").slice(0, 5).toUpperCase();
  const kit = new PropKit("ticker");
  const w = 2.8;
  const y = 2.0;
  const h = 0.34;
  kit.model("ticker", (b) => {
    for (const sx of [-1, 1]) {
      b.box(0.1, y + h, 0.1, C.brass, sx * (w / 2 - 0.2), 0, 0, { r: 0.016 });
      b.box(0.3, 0.05, 0.3, C.marble, sx * (w / 2 - 0.2), 0, 0, { r: 0.012 });
    }
    b.box(w, h + 0.1, 0.14, C.black, 0, y - 0.05, 0, { r: 0.02 });
    b.box(w + 0.04, 0.03, 0.16, C.brass, 0, y + h + 0.04, 0, { r: 0.008 });
    b.box(w + 0.04, 0.03, 0.16, C.brass, 0, y - 0.07, 0, { r: 0.008 });
  });
  const texture = createDynamicTexture(1024, 64, drawTicker(symbol));
  if (texture) {
    kit.own(texture);
    texture.texture.wrapS = THREE.RepeatWrapping;
    // Show a third of the strip at a time so the letters keep their proportions.
    texture.texture.repeat.set(0.5, 1);
    const material = kit.own(new THREE.MeshBasicMaterial({ map: texture.texture, toneMapped: false }));
    const strip = new THREE.Mesh(unitPlane(), material);
    strip.scale.set(w - 0.08, h, 1);
    strip.position.set(0, y + h / 2, 0.072);
    kit.add(strip);
    kit.onUpdate((dt) => {
      texture.texture.offset.x = (texture.texture.offset.x + dt * 0.09) % 1;
    });
  } else {
    // No canvas: static green / red blocks so the board still reads as a ticker.
    kit.add(
      shapeMesh(
        bakeModel("ticker:fallback", (b) => {
          for (let i = 0; i < 9; i += 1) b.box(0.2, h * 0.5, 0.01, i % 3 === 1 ? C.alarm : C.good, -w / 2 + 0.24 + i * 0.29, y + h * 0.25, 0.075, { r: 0 });
        }),
        glowMat(0xffffff, { vertexColors: true }),
        false
      )
    );
  }
  return kit.finish({ w, d: 0.3 });
};

/** Reception desk with a lit logo band (the lobbies of the full floor and the campus). */
export const createReceptionDesk = (office: OfficeIndex = 3, look: LookId = "classic"): PropHandle => {
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const marble = tier >= 4;
  const kit = new PropKit("reception");
  const w = 2.3;
  kit.model(`reception:${look}:${office}`, (b) => {
    const front = marble ? C.marble : C.white;
    const top = marble ? C.marbleLight : theme.wood;
    // High visitor counter in front, working surface behind it.
    b.box(w, 1.06, 0.3, front, 0, 0, 0.26, { r: 0.03 });
    b.box(w + 0.06, 0.05, 0.4, top, 0, 1.06, 0.24, { r: 0.016 });
    for (const sx of [-1, 1]) b.box(0.3, 1.06, 0.8, front, sx * (w / 2 - 0.15), 0, 0.0, { r: 0.03 });
    b.box(w - 0.5, 0.04, 0.56, theme.wood, 0, 0.72, -0.1, { r: 0.012 });
    // Slatted front.
    const slats = 14;
    for (let i = 0; i < slats; i += 1) b.box(0.05, 0.56, 0.02, marble ? C.brass : theme.woodDark, -w / 2 + 0.45 + (i * (w - 0.9)) / (slats - 1), 0.1, 0.415, { r: 0 });
    drawMonitor(b, { kind: "flat", x: -0.4, y: 0.76, z: -0.05, yaw: Math.PI, shell: C.white });
    b.box(0.34, 0.02, 0.12, C.white, -0.4, 0.76, -0.24, { r: 0.006 });
    // Flowers, bell, visitor tablet.
    b.cyl(0.07, 0.18, marble ? C.brass : 0x9fd4ee, 0.78, 1.11, 0.24, { taper: 1.3, seg: 10 });
    [C.pink, C.yellow, C.coral, C.pink].forEach((bloom, i) => b.ball(0.06, bloom, 0.78 + Math.cos(i * 1.7) * 0.07, 1.34 + (i % 2) * 0.05, 0.24 + Math.sin(i * 1.7) * 0.07, { seg: 6 }));
    b.cyl(0.05, 0.04, C.brass, 0.3, 1.11, 0.28, { seg: 10 });
    b.ball(0.015, C.brass, 0.3, 1.15, 0.28, { seg: 6 });
    b.box(0.2, 0.26, 0.016, C.black, -0.75, 1.11, 0.26, { rx: -0.35, r: 0.006 });
    drawChair(b, tier >= 4 ? "executive" : "premium", theme.accents[0]);
  });
  const screen = createScreenSurface("sheet");
  kit.own(screen.material);
  kit.add(new THREE.Mesh(screenQuads("reception", [monitorScreen({ kind: "flat", x: -0.4, y: 0.76, z: -0.05, yaw: Math.PI })]), screen.material));
  const band = kit.emissive(marble ? C.brass : lighten(theme.glow, 0.2), theme.glow, 0.5, 1.2);
  kit.add(shapeMesh(bakeModel("reception:band", (b) => b.box(w - 0.7, 0.07, 0.02, 0xffffff, 0, 0.8, 0.42, { r: 0 })), band, false));
  kit.onGlow((amount) => screen.setGlow(amount));
  return kit.finish({ w: w + 0.06, d: 0.9 });
};

/** Glass meeting pod with a table for two. 2.4 × 2.0 footprint, door gap on +Z. */
export const createMeetingPod = (office: OfficeIndex = 3, look: LookId = "classic"): PropHandle => {
  const theme = themeFor(office, look);
  const tier = phaseTier(office);
  const kit = new PropKit("meeting-pod");
  const w = 2.4;
  const d = 2.0;
  const h = 2.2;
  const frame = tier >= 4 ? C.brass : tier === 3 ? C.white : C.charcoal;
  kit.model(`meeting-pod:${look}:${office}`, (b) => {
    b.box(w, 0.06, d, theme.woodDark, 0, 0, 0, { r: 0.014 });
    b.box(w - 0.3, 0.012, d - 0.3, theme.accents[0], 0, 0.06, 0, { r: 0 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(0.08, h - 0.06, 0.08, frame, sx * (w / 2 - 0.04), 0.06, sz * (d / 2 - 0.04), { r: 0.014 });
      b.box(0.08, 0.08, d, frame, sx * (w / 2 - 0.04), h - 0.08, 0, { r: 0.014 });
    }
    for (const sz of [-1, 1]) b.box(w, 0.08, 0.08, frame, 0, h - 0.08, sz * (d / 2 - 0.04), { r: 0.014 });
    // Open slatted roof: enough to read as a room, not enough to hide who is inside.
    for (let i = 1; i < 6; i += 1) b.box(0.04, 0.05, d - 0.1, frame, -w / 2 + (i * w) / 6, h - 0.06, 0, { r: 0 });
    // Door posts on the +Z side.
    for (const sx of [-1, 1]) b.box(0.05, h - 0.14, 0.05, frame, sx * 0.5, 0.06, d / 2 - 0.04, { r: 0 });
    // Table and two chairs.
    b.cyl(0.42, 0.04, theme.wood, 0, 0.7, -0.1, { seg: 18 });
    b.cyl(0.04, 0.64, frame, 0, 0.06, -0.1, { seg: 8 });
    b.cyl(0.24, 0.03, frame, 0, 0.06, -0.1, { seg: 12 });
    b.at(-0.72, 0.06, -0.1, Math.PI / 2, () => drawChair(b, "hotdesk", theme.accents[1]));
    b.at(0.72, 0.06, -0.1, -Math.PI / 2, () => drawChair(b, "hotdesk", theme.accents[2]));
    drawMonitor(b, { kind: "laptop", x: -0.12, y: 0.74, z: -0.1, yaw: Math.PI / 2, shell: C.chrome });
    drawMug(b, 0.18, 0.74, 0.0, C.white, 1);
    // Screen on the back wall.
    b.box(1.0, 0.6, 0.05, C.black, 0, 1.1, -d / 2 + 0.1, { r: 0.014 });
  });
  const screen = createScreenSurface("chart");
  kit.own(screen.material);
  kit.add(new THREE.Mesh(screenQuads("meeting-pod", [{ x: 0, y: 1.4, z: -d / 2 + 0.128, w: 0.92, h: 0.52 }]), screen.material));
  kit.onGlow((amount) => screen.setGlow(amount));
  const glass = new THREE.Mesh(
    bakeModel("meeting-pod:glass", (b) => {
      b.box(w - 0.16, h - 0.2, 0.02, 0xffffff, 0, 0.08, -d / 2 + 0.04, { r: 0 });
      for (const sx of [-1, 1]) {
        b.box(0.02, h - 0.2, d - 0.16, 0xffffff, sx * (w / 2 - 0.04), 0.08, 0, { r: 0 });
        b.box(w / 2 - 0.6, h - 0.2, 0.02, 0xffffff, sx * (w / 4 + 0.22), 0.08, d / 2 - 0.04, { r: 0 });
      }
    }),
    glassMat(C.glass, 0.22)
  );
  kit.add(glass);
  return kit.finish({ w, d });
};

// ─────────────────────────────────────────────────────────────────────────────
// Outdoors
// ─────────────────────────────────────────────────────────────────────────────

export const TREE_VARIANTS = 3;

/** Low-poly tree: 0 = round crown, 1 = tall poplar, 2 = conifer. ≈ 3–4 tall. */
export const createTree = (variant = 0): PropHandle => {
  const v = ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
  const kit = new PropKit("tree");
  kit.model(`tree:${v}`, (b) => {
    if (v === 0) {
      b.cyl(0.14, 1.3, C.trunk, 0, 0, 0, { taper: 0.7, seg: 7 });
      b.blob(0.85, C.leaf, 0, 1.0, 0, { detail: 1 });
      b.blob(0.62, C.leafLight, 0.45, 1.75, 0.2, { detail: 1, ry: 1 });
      b.blob(0.6, C.leafDark, -0.42, 1.55, -0.25, { detail: 1, ry: 2 });
      b.blob(0.5, C.leafLight, -0.05, 2.25, 0.0, { detail: 1, ry: 3 });
    } else if (v === 1) {
      b.cyl(0.11, 1.0, C.trunk, 0, 0, 0, { taper: 0.75, seg: 7 });
      b.blob(0.52, C.leafDark, 0, 0.8, 0, { detail: 1, sy: 1.3 });
      b.blob(0.46, C.leaf, 0.05, 1.7, 0.03, { detail: 1, sy: 1.4, ry: 1 });
      b.blob(0.34, C.leafLight, -0.03, 2.75, 0, { detail: 1, sy: 1.5, ry: 2 });
    } else {
      b.cyl(0.12, 0.7, C.trunk, 0, 0, 0, { taper: 0.8, seg: 7 });
      const green = [C.leafDark, mixColor(C.leafDark, C.leaf, 0.5), C.leaf];
      [
        [0.95, 0.55, 1.2],
        [0.74, 1.3, 1.1],
        [0.52, 2.0, 1.0],
      ].forEach(([radius, y, height], i) => b.cyl(radius, height, green[i], 0, y, 0, { taper: 0.05, seg: 8, flat: true, ry: i * 0.4 }));
    }
  });
  return kit.finish({ w: 1.7, d: 1.7 });
};

/** Hedge-height bush; variant 1 is in flower. */
export const createBush = (variant = 0): PropHandle => {
  const v = ((variant % 2) + 2) % 2;
  const kit = new PropKit("bush");
  kit.model(`bush:${v}`, (b) => {
    b.blob(0.42, C.leaf, 0, 0, 0, { detail: 1, sy: 0.8 });
    b.blob(0.34, C.leafDark, 0.36, 0, 0.1, { detail: 1, sy: 0.8, ry: 1 });
    b.blob(0.3, C.leafLight, -0.32, 0, -0.08, { detail: 1, sy: 0.85, ry: 2 });
    if (v === 1) {
      for (let i = 0; i < 7; i += 1) {
        const a = i * 2.4;
        b.ball(0.05, i % 2 ? C.pink : C.paper, Math.cos(a) * 0.3, 0.45 + (i % 3) * 0.08, Math.sin(a) * 0.26, { seg: 6 });
      }
    }
  });
  return kit.finish({ w: 1.1, d: 0.8 });
};

/** Street lamp: `setGlow(0..1)` lights the lantern and its pool on the pavement. 3.4 tall. */
export const createStreetLamp = (): PropHandle => {
  const kit = new PropKit("street-lamp");
  kit.model("street-lamp", (b) => {
    const iron = 0x56606c;
    b.cyl(0.14, 0.1, iron, 0, 0, 0, { taper: 0.7, seg: 10 });
    b.cyl(0.055, 3.1, iron, 0, 0.1, 0, { taper: 0.7, seg: 8 });
    b.tube([0, 3.15, 0], [0, 3.3, 0.5], 0.035, iron, { seg: 6 });
    b.box(0.26, 0.08, 0.42, iron, 0, 3.26, 0.6, { r: 0.02 });
  });
  const lantern = kit.emissive(0xf3efe0, C.lampWarm, 0.1, 1.4);
  kit.add(shapeMesh(bakeModel("street-lamp:lantern", (b) => b.box(0.18, 0.05, 0.3, 0xffffff, 0, 3.21, 0.6, { r: 0.012 })), lantern, false));
  addLightPool(kit, 2.2, C.lampWarm, 0, 0.6, 0.6);
  return kit.finish({ w: 0.4, d: 1.0 });
};

/** Park bench: timber slats on cast-iron ends. */
export const createBench = (): PropHandle => {
  const kit = new PropKit("bench");
  kit.model("bench", (b) => {
    const w = 1.5;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.12);
      b.strut([x, 0, 0.2], [x, 0.44, 0.18], 0.05, C.charcoal, { r: 0.012 });
      b.strut([x, 0, -0.22], [x, 0.9, -0.3], 0.05, C.charcoal, { r: 0.012 });
      b.box(0.05, 0.04, 0.46, C.charcoal, x, 0.4, -0.02, { r: 0.01 });
      b.box(0.06, 0.035, 0.34, C.charcoal, x, 0.6, 0.0, { r: 0.012 });
    }
    for (let i = 0; i < 4; i += 1) b.box(w, 0.03, 0.09, i % 2 ? C.oak : darken(C.oak, 0.08), 0, 0.44, -0.18 + i * 0.115, { r: 0.008 });
    for (let i = 0; i < 3; i += 1) b.box(w, 0.09, 0.03, i % 2 ? darken(C.oak, 0.08) : C.oak, 0, 0.56 + i * 0.115, -0.25 - i * 0.012, { rx: -0.1, r: 0.008 });
  });
  return kit.finish({ w: 1.5, d: 0.6 });
};

export const BACKGROUND_BUILDING_VARIANTS = 4;

export interface BackgroundBuildingOptions {
  /** Overall size scale. Default 1. */
  scale?: number;
}

/** [x, y, z, width, height] of a window that lights up at dusk. */
type LitWindow = [number, number, number, number, number];

const BUILDING_SPECS = [
  { w: 3.2, d: 3.0, h: 9, body: 0x7f8b99, floors: 8 },
  { w: 3.6, d: 3.4, h: 7, body: 0x8a8f9c, floors: 6 },
  { w: 6.0, d: 3.4, h: 3.6, body: 0x9a968f, floors: 3 },
  { w: 4.4, d: 3.6, h: 4.6, body: desaturate(C.brick, 0.45), floors: 3 },
] as const;

/** Draws building `v`; when `lit` is given, also records which windows glow at dusk. */
const drawBackgroundBuilding = (b: ModelBuilder, v: number, lit: LitWindow[] | null): void => {
  const { w, d, h, body, floors } = BUILDING_SPECS[v];
  const pane = mixColor(body, 0x2b3a4c, 0.6);
  const tower = (tw: number, td: number, y0: number, th: number, rows: number, seed: number): void => {
    b.box(tw, th, td, body, 0, y0, 0, { r: 0.03 });
    b.box(tw + 0.1, 0.12, td + 0.1, darken(body, 0.2), 0, y0 + th, 0, { r: 0.02 });
    const columns = Math.max(2, Math.round(tw / 0.8));
    for (let row = 0; row < rows; row += 1) {
      const y = y0 + 0.25 + (row * (th - 0.9)) / Math.max(1, rows - 1);
      for (let column = 0; column < columns; column += 1) {
        const x = -tw / 2 + (tw / columns) * (column + 0.5);
        b.box(tw / columns - 0.2, 0.5, 0.03, pane, x, y, td / 2 + 0.005, { r: 0 });
        if (lit && hash01(seed + row * 17 + column * 5) > 0.55) lit.push([x, y, td / 2 + 0.025, tw / columns - 0.2, 0.5]);
      }
      // The +X side gets a plain band of glazing per floor.
      b.box(0.03, 0.5, td - 0.4, pane, tw / 2 + 0.005, y, 0, { r: 0 });
    }
  };
  if (v === 1) {
    tower(w, d, 0, h * 0.55, Math.ceil(floors / 2), 3);
    tower(w * 0.7, d * 0.7, h * 0.55 + 0.12, h * 0.45, Math.floor(floors / 2), 9);
    b.cyl(0.04, 1.6, C.charcoal, 0, h + 0.24, 0, { seg: 5 });
    b.ball(0.07, C.alarm, 0, h + 1.84, 0, { seg: 6 });
  } else {
    tower(w, d, 0, h, floors, v * 11);
  }
  if (v === 0) {
    b.box(0.8, 0.5, 0.8, darken(body, 0.2), -0.6, h + 0.12, -0.4, { r: 0.02 });
  } else if (v === 2) {
    for (const x of [-1.6, 0.4, 1.9]) b.box(0.9, 0.4, 0.7, darken(body, 0.15), x, h + 0.12, -0.5, { r: 0.03 });
  } else if (v === 3) {
    // Water tank on stilts.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.tube([0.8 + sx * 0.4, h + 0.12, sz * 0.4], [0.8 + sx * 0.3, h + 1.1, sz * 0.3], 0.03, C.charcoal, { seg: 5 });
    }
    b.cyl(0.5, 0.9, C.pallet, 0.8, h + 1.1, 0, { seg: 12 });
    b.cyl(0.54, 0.4, darken(C.pallet, 0.25), 0.8, h + 2.0, 0, { taper: 0.05, seg: 12 });
  }
};

/**
 * Simple block for skyline hints behind the office: 0 = slab tower, 1 =
 * stepped tower with a mast, 2 = low wide block, 3 = brick warehouse with a
 * water tank. Deliberately greyed so they recede. `setGlow` lights some windows.
 */
export const createBackgroundBuilding = (variant = 0, options: BackgroundBuildingOptions = {}): PropHandle => {
  const v = ((variant % BACKGROUND_BUILDING_VARIANTS) + BACKGROUND_BUILDING_VARIANTS) % BACKGROUND_BUILDING_VARIANTS;
  const scale = options.scale ?? 1;
  const spec = BUILDING_SPECS[v];
  const kit = new PropKit("background-building");
  kit.model(`background-building:${v}`, (b) => drawBackgroundBuilding(b, v, null));
  const windows = kit.emissive(0x8b93a0, C.lampWarm, 0, 1.25);
  kit.add(
    shapeMesh(
      bakeModel(`background-building:${v}:lit`, (b) => {
        // Re-run the drawing into a scratch builder purely to learn where the lit windows are.
        const lit: LitWindow[] = [];
        drawBackgroundBuilding(new ModelBuilder(), v, lit);
        for (const [x, y, z, pw, ph] of lit) b.box(pw, ph, 0.012, 0xffffff, x, y, z, { r: 0 });
      }),
      windows,
      false
    )
  );
  kit.group.scale.setScalar(scale);
  return kit.finish({ w: spec.w * scale, d: spec.d * scale });
};
