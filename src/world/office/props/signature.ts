/**
 * Signature props: the few things that say which era an office is in at a glance. Each look other than classic
 * has three; the office's dressing (../dressing.ts) stands them in for some of its plain décor.
 *
 * Every prop is built to fill the floor area it is given (`size`: width across its facing, depth along it), front
 * +Z, standing on y = 0, and never reaches past that area. None writes a word, and none is shaped after any real
 * product: a box with a dark face is a television, nothing more.
 */
import type { LookId } from "../../types";
import { C, darken, lighten } from "../../core/palette";
import type { ModelBuilder } from "../../core/palette";
import type { FootprintSize } from "../footprints";
import { PropKit } from "./shared";
import type { PropHandle } from "./shared";

export type SignatureKind =
  | "fax-machine"
  | "software-shelf"
  | "tube-tv"
  | "flat-tv"
  | "beanbag"
  | "foosball"
  | "plant-wall"
  | "ring-light"
  | "scooter";

const NINETIES: readonly SignatureKind[] = ["fax-machine", "software-shelf", "tube-tv"];
const NOUGHTIES: readonly SignatureKind[] = ["flat-tv", "beanbag", "foosball"];
const TWENTIES: readonly SignatureKind[] = ["plant-wall", "ring-light", "scooter"];

/**
 * Each era's three props, in the order they claim a spot. For now each era borrows its decade's row; the eras get
 * rows of their own when their props are built.
 */
export const SIGNATURE_PROPS: Readonly<Record<Exclude<LookId, "classic">, readonly SignatureKind[]>> = {
  "dial-up": NINETIES,
  "gold-rush": NINETIES,
  bust: NOUGHTIES,
  phones: NOUGHTIES,
  "cheap-money": NOUGHTIES,
  "winter-ai": TWENTIES,
  agents: TWENTIES,
  ambient: TWENTIES,
};

/** The least footprint each prop needs (width across its facing, depth). */
export const SIGNATURE_SIZES: Readonly<Record<SignatureKind, FootprintSize>> = {
  "fax-machine": { width: 0.4, depth: 0.4 },
  "software-shelf": { width: 0.9, depth: 0.3 },
  "tube-tv": { width: 0.6, depth: 0.5 },
  "flat-tv": { width: 0.7, depth: 0.3 },
  beanbag: { width: 0.45, depth: 0.45 },
  foosball: { width: 0.9, depth: 0.55 },
  "plant-wall": { width: 0.9, depth: 0.3 },
  "ring-light": { width: 0.4, depth: 0.4 },
  scooter: { width: 0.7, depth: 0.3 },
};

type Draw = (b: ModelBuilder, w: number, d: number, variant: number) => void;

/** A low cabinet with a fax machine on it, a sheet curling out of the front. */
const drawFax: Draw = (b, w, d) => {
  const cw = Math.min(w, 0.5) - 0.02;
  const cd = Math.min(d, 0.5) - 0.02;
  b.box(cw, 0.66, cd, C.greyLight, 0, 0, 0, { r: 0.012 });
  b.box(cw - 0.06, 0.24, 0.012, lighten(C.greyLight, 0.15), 0, 0.33, cd / 2 - 0.006, { r: 0.004 });
  b.box(0.1, 0.02, 0.02, C.chrome, 0, 0.5, cd / 2 - 0.012, { r: 0 });
  const fw = Math.min(cw - 0.04, 0.34);
  const fd = Math.min(cd - 0.04, 0.3);
  // Body, keypad, handset and the paper tray at the back.
  b.box(fw, 0.11, fd, C.bone, 0, 0.66, 0, { r: 0.02 });
  b.box(fw * 0.35, 0.012, fd * 0.45, C.greyDark, fw * 0.22, 0.77, fd * 0.12, { r: 0 });
  b.box(0.06, 0.04, fd * 0.8, C.charcoal, -fw / 2 + 0.05, 0.77, 0, { r: 0.015 });
  b.box(fw * 0.7, 0.012, 0.1, C.paper, fw * 0.05, 0.8, -fd / 2 + 0.06, { r: 0, rx: -0.6 });
  b.box(fw * 0.5, 0.006, 0.08, C.paper, fw * 0.1, 0.7, fd / 2 - 0.045, { r: 0, rx: 0.25 });
};

/** A shelf of boxed software in loud colours, as shops sold it. */
const drawSoftwareShelf: Draw = (b, w, d, variant) => {
  const sw = w - 0.02;
  const sd = d - 0.02;
  const h = 1.3;
  const wood = [C.oak, C.birch, C.walnut][variant % 3];
  for (const sx of [-1, 1]) b.box(0.03, h, sd, wood, sx * (sw / 2 - 0.015), 0, 0, { r: 0 });
  b.box(sw, 0.03, sd, wood, 0, h - 0.03, 0, { r: 0 });
  b.box(sw - 0.06, h - 0.06, 0.012, darken(wood, 0.2), 0, 0.03, -sd / 2 + 0.006, { r: 0 });
  const colours = [C.red, C.yellow, C.blue, C.purple, C.teal, C.orange, C.green, C.pink];
  const shelves = [0.06, 0.46, 0.86];
  shelves.forEach((y, row) => {
    b.box(sw - 0.06, 0.025, sd - 0.02, wood, 0, y - 0.025, 0, { r: 0 });
    const inner = sw - 0.1;
    const count = Math.max(3, Math.floor(inner / 0.11));
    const pitch = inner / count;
    for (let i = 0; i < count; i += 1) {
      const colour = colours[(i * 3 + row * 5 + variant) % colours.length];
      const tall = 0.26 + ((i + row) % 3) * 0.03;
      b.box(pitch * 0.8, tall, sd * 0.7, colour, -inner / 2 + pitch * (i + 0.5), y, 0, { r: 0.004 });
      b.box(pitch * 0.5, 0.05, 0.004, C.white, -inner / 2 + pitch * (i + 0.5), y + tall * 0.6, sd * 0.35 + 0.002, { r: 0 });
    }
  });
};

/** A deep, grey television with a bulging back, on a wheeled cart. */
const drawTubeTv: Draw = (b, w, d) => {
  const cw = Math.min(w, 0.8) - 0.04;
  const cd = Math.min(d, 0.6) - 0.04;
  // The cart: two shelves on four posts, castors below.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.03, 0.62, 0.03, C.charcoal, sx * (cw / 2 - 0.03), 0.06, sz * (cd / 2 - 0.03), { r: 0 });
    b.ball(0.03, C.black, sx * (cw / 2 - 0.03), 0, sz * (cd / 2 - 0.03), { seg: 6 });
  }
  b.box(cw, 0.03, cd, C.greyDark, 0, 0.18, 0, { r: 0.006 });
  b.box(cw, 0.03, cd, C.greyDark, 0, 0.65, 0, { r: 0.006 });
  b.box(cw * 0.5, 0.08, cd * 0.7, C.black, 0, 0.21, 0, { r: 0.008 });
  // The set: a deep body, a narrower tube behind it, a dark rounded screen in a bezel.
  const tw = Math.min(cw - 0.02, 0.56);
  const td = Math.min(cd - 0.02, 0.48);
  b.box(tw, 0.44, td * 0.6, C.greyLight, 0, 0.68, td / 2 - td * 0.3, { r: 0.03 });
  b.box(tw * 0.7, 0.34, td * 0.4, C.grey, 0, 0.72, -td / 2 + td * 0.2, { r: 0.04 });
  b.box(tw * 0.76, 0.32, 0.012, C.screenOff, -tw * 0.06, 0.74, td / 2 - 0.006, { r: 0.03 });
  for (let i = 0; i < 2; i += 1) b.cyl(0.018, 0.012, C.charcoal, tw * 0.4, 0.8 - i * 0.08, td / 2 - 0.006, { axis: "z", seg: 8 });
  // Rabbit-ear aerial.
  b.tube([0, 1.12, -td * 0.1], [-tw * 0.3, 1.38, -td * 0.1], 0.006, C.chrome, { seg: 5 });
  b.tube([0, 1.12, -td * 0.1], [tw * 0.3, 1.36, -td * 0.1], 0.006, C.chrome, { seg: 5 });
  b.box(0.08, 0.03, 0.06, C.charcoal, 0, 1.12, -td * 0.1, { r: 0.01 });
};

/** A thin, wide screen on a low black stand. */
const drawFlatTv: Draw = (b, w, d, variant) => {
  const sw = Math.min(w, 1.2) - 0.02;
  const sd = d - 0.02;
  const stand = [C.black, C.walnutDark, C.greyDark][variant % 3];
  b.box(sw, 0.42, sd, stand, 0, 0, 0, { r: 0.012 });
  b.box(sw - 0.08, 0.14, 0.01, darken(stand, 0.3), 0, 0.14, sd / 2 - 0.005, { r: 0 });
  b.box(0.2, 0.03, sd * 0.5, C.charcoal, 0, 0.42, 0, { r: 0.006 });
  b.box(0.04, 0.1, 0.03, C.charcoal, 0, 0.45, 0, { r: 0 });
  const pw = sw - 0.04;
  const ph = pw * 0.56;
  b.box(pw, ph, 0.04, C.black, 0, 0.52, 0, { r: 0.012 });
  b.box(pw - 0.04, ph - 0.04, 0.006, C.screenDim, 0, 0.54, 0.021, { r: 0 });
  b.box(0.02, 0.02, 0.006, C.good, pw / 2 - 0.04, 0.53, 0.021, { r: 0 });
};

/** A slumped bean bag. */
const drawBeanbag: Draw = (b, w, d, variant) => {
  const radius = Math.min(w, d) / 2 - 0.02;
  const colour = [C.orange, C.purple, C.teal, C.red][variant % 4];
  b.lathe(
    [
      [radius * 0.7, 0],
      [radius * 0.98, 0.08],
      [radius, 0.2],
      [radius * 0.85, 0.36],
      [radius * 0.5, 0.46],
      [0.001, 0.48],
    ],
    colour,
    0,
    0,
    0,
    { seg: 14 }
  );
  b.ball(radius * 0.55, lighten(colour, 0.12), 0, 0.3, radius * 0.25, { sy: 0.5, seg: 10 });
};

/** A table football game: a green pitch in a wooden box, rods across it with handles out front and back. */
const drawFoosball: Draw = (b, w, d) => {
  const tw = Math.min(w, 1.2) - 0.04;
  const td = Math.min(d - 0.18, 0.7);
  const top = 0.82;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.06, top - 0.18, 0.06, C.walnutDark, sx * (tw / 2 - 0.06), 0, sz * (td / 2 - 0.06), { r: 0.008 });
  b.box(tw, 0.18, td, C.walnut, 0, top - 0.18, 0, { r: 0.012 });
  b.box(tw - 0.06, 0.012, td - 0.06, C.grass, 0, top - 0.04, 0, { r: 0 });
  b.box(0.012, 0.004, td - 0.08, C.white, 0, top - 0.028, 0, { r: 0 });
  const rods = 6;
  const half = d / 2 - 0.02;
  for (let i = 0; i < rods; i += 1) {
    const x = -tw / 2 + 0.1 + (i * (tw - 0.2)) / (rods - 1);
    const out = i % 2 === 0 ? 1 : -1;
    b.tube([x, top + 0.02, -half + 0.012], [x, top + 0.02, half - 0.012], 0.008, C.chrome, { seg: 5 });
    b.cyl(0.018, 0.08, C.black, x, top + 0.002, out * (half - 0.045), { axis: "z", seg: 8 });
    // Two little players on each rod, in the colour of their side.
    for (const pz of [-0.08, 0.08]) b.box(0.03, 0.08, 0.03, i < 3 ? C.red : C.blue, x, top - 0.04, pz, { r: 0.006 });
  }
};

/** A wall of planting on a long planter: green, shaggy, watered by a thin pipe along the top. */
const drawPlantWall: Draw = (b, w, d, variant) => {
  const pw = Math.min(w, 1.4) - 0.02;
  const pd = d - 0.02;
  b.box(pw, 0.3, pd, C.charcoal, 0, 0, 0, { r: 0.012 });
  b.box(pw - 0.04, 0.02, pd - 0.04, C.soil, 0, 0.29, 0, { r: 0 });
  const panelD = Math.min(0.08, pd * 0.4);
  const panelZ = -pd / 2 + panelD / 2;
  b.box(pw, 1.5, panelD, C.walnutDark, 0, 0.3, panelZ, { r: 0.01 });
  b.tube([-pw / 2 + 0.02, 1.78, panelZ], [pw / 2 - 0.02, 1.78, panelZ], 0.012, C.galvanised, { seg: 6 });
  const greens = [C.leaf, C.leafLight, C.leafDark, C.grass];
  const leafR = Math.min(0.09, (pd - panelD) / 2 - 0.005);
  const columns = Math.max(3, Math.floor(pw / 0.16));
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = -pw / 2 + leafR + ((pw - 2 * leafR) * (col + (row % 2) * 0.5)) / columns;
      if (x > pw / 2 - leafR) continue;
      b.blob(leafR, greens[(row * 7 + col * 3 + variant) % greens.length], x, 0.32 + row * 0.17, panelZ + panelD / 2 + leafR * 0.6, { detail: 0, sz: 0.6 });
    }
  }
};

/** A ring light on a tripod, a phone held in the middle of it. */
const drawRingLight: Draw = (b, w, d) => {
  const spread = Math.min(w, d) / 2 - 0.03;
  for (let i = 0; i < 3; i += 1) {
    const angle = (i * Math.PI * 2) / 3 + Math.PI / 2;
    b.tube([Math.cos(angle) * spread, 0.01, Math.sin(angle) * spread], [0, 0.5, 0], 0.01, C.charcoal, { seg: 5 });
  }
  b.cyl(0.016, 0.95, C.charcoal, 0, 0.48, 0, { seg: 8 });
  const radius = Math.min(0.17, Math.min(w, d) / 2 - 0.04);
  b.torus(radius, 0.022, C.white, 0, 1.43 - radius, 0, { axis: "z", seg: 20 });
  b.box(0.012, radius * 2 - 0.04, 0.012, C.charcoal, 0, 1.45 - radius * 2 + 0.02, -0.02, { r: 0 });
  b.box(0.07, 0.13, 0.012, C.black, 0, 1.45 - radius - 0.065, 0.0, { r: 0.008 });
};

/** A kick scooter with small wheels, folded open and leaning on nothing. */
const drawScooter: Draw = (b, w, d, variant) => {
  const length = Math.min(w, 0.9) - 0.04;
  const wheel = 0.06;
  const colour = [C.teal, C.red, C.yellow, C.purple][variant % 4];
  for (const sx of [-1, 1]) {
    b.cyl(wheel, 0.03, C.black, sx * (length / 2 - wheel), 0, 0, { axis: "z", seg: 10 });
    b.cyl(wheel * 0.5, 0.034, C.greyLight, sx * (length / 2 - wheel), wheel * 0.5, 0, { axis: "z", seg: 8 });
  }
  b.box(length - wheel * 3, 0.03, 0.12, colour, -wheel * 0.3, wheel + 0.01, 0, { r: 0.01 });
  b.box(length - wheel * 3 - 0.04, 0.006, 0.09, C.charcoal, -wheel * 0.3, wheel + 0.04, 0, { r: 0 });
  const stemX = length / 2 - wheel;
  b.tube([stemX, wheel, 0], [stemX - 0.08, 0.86, 0], 0.016, C.chrome, { seg: 6 });
  const bar = Math.min(d / 2 - 0.03, 0.22);
  b.tube([stemX - 0.08, 0.86, -bar], [stemX - 0.08, 0.86, bar], 0.014, C.chrome, { seg: 6 });
  for (const sz of [-1, 1]) b.tube([stemX - 0.08, 0.86, sz * (bar - 0.06)], [stemX - 0.08, 0.86, sz * (bar - 0.005)], 0.02, C.black, { seg: 6 });
};

const DRAW: Record<SignatureKind, Draw> = {
  "fax-machine": drawFax,
  "software-shelf": drawSoftwareShelf,
  "tube-tv": drawTubeTv,
  "flat-tv": drawFlatTv,
  beanbag: drawBeanbag,
  foosball: drawFoosball,
  "plant-wall": drawPlantWall,
  "ring-light": drawRingLight,
  scooter: drawScooter,
};

const key = (value: number): string => (Math.round(value * 1000) / 1000).toFixed(3);

/** Build a signature prop to fill `size` (width across its facing, depth along it). */
export const createSignatureProp = (kind: SignatureKind, size: FootprintSize, variant: number): PropHandle => {
  const v = Number.isInteger(variant) ? Math.abs(variant) % 12 : 0;
  const kit = new PropKit(`signature:${kind}`);
  kit.model(`signature:${kind}:${key(size.width)}:${key(size.depth)}:${v}`, (b) => DRAW[kind](b, size.width, size.depth, v));
  return kit.finish({ w: size.width, d: size.depth });
};
