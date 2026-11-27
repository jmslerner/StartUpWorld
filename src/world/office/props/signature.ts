/**
 * Signature props: the few things that say which era an office is in at a glance. Each look other than classic
 * has three (the two invented eras props of their own, nothing borrowed); the office's dressing (../dressing.ts) stands them in for some of its plain décor.
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
  | "scooter"
  | "dot-printer"
  | "pinball"
  | "box-stack"
  | "charging-kiosk"
  | "drinks-fridge"
  | "compute-cabinet"
  | "robot-dock"
  | "holo-table"
  | "home-robot"
  | "glasses-stand"
  | "light-column";

/**
 * Each era's three props, in the order they claim a spot; the first is the one that names the era, and no two eras
 * share a first.
 */
export const SIGNATURE_PROPS: Readonly<Record<Exclude<LookId, "classic">, readonly SignatureKind[]>> = {
  "dial-up": ["fax-machine", "dot-printer", "tube-tv"],
  "gold-rush": ["software-shelf", "pinball", "tube-tv"],
  bust: ["box-stack", "fax-machine", "flat-tv"],
  phones: ["charging-kiosk", "flat-tv", "beanbag"],
  "cheap-money": ["foosball", "drinks-fridge", "scooter"],
  "winter-ai": ["compute-cabinet", "plant-wall", "ring-light"],
  agents: ["robot-dock", "holo-table", "plant-wall"],
  ambient: ["home-robot", "glasses-stand", "light-column"],
};

/** The least footprint each prop needs (width across its facing, depth). */
export const SIGNATURE_SIZES: Readonly<Record<SignatureKind, FootprintSize>> = {
  "fax-machine": { width: 0.4, depth: 0.4 },
  "software-shelf": { width: 0.8, depth: 0.3 },
  "tube-tv": { width: 0.6, depth: 0.5 },
  "flat-tv": { width: 0.7, depth: 0.3 },
  beanbag: { width: 0.45, depth: 0.45 },
  foosball: { width: 0.8, depth: 0.5 },
  "plant-wall": { width: 0.9, depth: 0.3 },
  "ring-light": { width: 0.4, depth: 0.4 },
  scooter: { width: 0.7, depth: 0.3 },
  "dot-printer": { width: 0.5, depth: 0.4 },
  pinball: { width: 0.45, depth: 0.45 },
  "box-stack": { width: 0.5, depth: 0.4 },
  "charging-kiosk": { width: 0.4, depth: 0.4 },
  "drinks-fridge": { width: 0.45, depth: 0.45 },
  "compute-cabinet": { width: 0.6, depth: 0.5 },
  "robot-dock": { width: 0.45, depth: 0.45 },
  "holo-table": { width: 0.8, depth: 0.5 },
  "home-robot": { width: 0.45, depth: 0.45 },
  "glasses-stand": { width: 0.4, depth: 0.4 },
  "light-column": { width: 0.4, depth: 0.4 },
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

/** A dot-matrix printer on a little wheeled trolley, a fold of perforated paper feeding in below and out on top. */
const drawDotPrinter: Draw = (b, w, d) => {
  const tw = Math.min(w, 0.6) - 0.04;
  const td = Math.min(d, 0.5) - 0.04;
  // The trolley: four posts on castors, a shelf low down with the paper box, a top for the printer.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.025, 0.6, 0.025, C.greyDark, sx * (tw / 2 - 0.02), 0.05, sz * (td / 2 - 0.02), { r: 0 });
    b.ball(0.025, C.black, sx * (tw / 2 - 0.02), 0, sz * (td / 2 - 0.02), { seg: 6 });
  }
  b.box(tw, 0.025, td, C.greyDark, 0, 0.14, 0, { r: 0.004 });
  b.box(tw, 0.025, td, C.greyDark, 0, 0.62, 0, { r: 0.004 });
  b.box(tw * 0.8, 0.1, td * 0.8, C.cardboard, 0, 0.165, 0, { r: 0.004 });
  b.box(tw * 0.74, 0.012, td * 0.7, C.paper, 0, 0.265, 0, { r: 0 });
  // The printer: a wide, low body, a darker lid over the platen, a knob on the side.
  const pw = tw - 0.04;
  const pd = Math.min(td - 0.06, 0.3);
  b.box(pw, 0.12, pd, C.bone, 0, 0.645, 0.02, { r: 0.015 });
  b.box(pw * 0.8, 0.03, pd * 0.45, C.greyLight, 0, 0.765, 0.02 - pd * 0.1, { r: 0.008 });
  b.box(pw * 0.9, 0.012, 0.01, C.charcoal, 0, 0.72, 0.02 + pd / 2, { r: 0 });
  b.box(0.04, 0.012, 0.02, C.good, pw / 2 - 0.05, 0.765, 0.02 + pd / 2 - 0.03, { r: 0 });
  b.cyl(0.03, 0.02, C.charcoal, pw / 2 + 0.005, 0.7, 0.02, { axis: "x", seg: 10 });
  // Paper: a few printed sheets fanned up out of the back, the fold hanging down from the trolley top.
  for (let i = 0; i < 3; i += 1) b.box(pw * 0.72, 0.004, 0.09, C.paper, 0, 0.8 + i * 0.02, 0.02 - pd / 2 - 0.02 + i * 0.01, { r: 0, rx: -0.9 + i * 0.12 });
  b.box(pw * 0.72, 0.34, 0.006, C.paper, 0, 0.29, td / 2 - 0.01, { r: 0 });
  for (let i = 0; i < 5; i += 1) b.box(pw * 0.72, 0.004, 0.008, C.greyLight, 0, 0.32 + i * 0.06, td / 2 - 0.006, { r: 0 });
};

/** An upright pinball cabinet: a sloping glass playfield of coloured bumpers on legs, a tall backbox behind. */
const drawPinball: Draw = (b, w, d, variant) => {
  const cw = Math.min(w, 0.6) - 0.04;
  const cd = Math.min(d, 0.6) - 0.04;
  const body = [C.purple, C.red, C.navy][variant % 3];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.035, 0.62, 0.035, C.chrome, sx * (cw / 2 - 0.025), 0, sz * (cd / 2 - 0.025), { r: 0 });
  // The table: a box whose top slopes up toward the back.
  b.box(cw, 0.22, cd, body, 0, 0.6, 0, { r: 0.01 });
  b.place(0, 0.84, 0, { rx: 0.12 }, () => {
    b.box(cw - 0.03, 0.01, cd - 0.03, C.charcoal, 0, -0.005, 0, { r: 0 });
    // Bumpers and lanes in loud colours, all plain boxes.
    const bumpers: Array<[number, number, number]> = [
      [-cw * 0.2, -cd * 0.2, C.yellow],
      [cw * 0.2, -cd * 0.2, C.teal],
      [0, -cd * 0.05, C.pink],
      [-cw * 0.25, cd * 0.15, C.orange],
      [cw * 0.25, cd * 0.15, C.green],
    ];
    for (const [x, z, colour] of bumpers) b.box(0.05, 0.03, 0.05, colour, x, 0.005, z, { r: 0.006 });
    b.box(0.07, 0.012, 0.016, C.white, -0.05, 0.005, cd / 2 - 0.07, { r: 0, ry: 0.4 });
    b.box(0.07, 0.012, 0.016, C.white, 0.05, 0.005, cd / 2 - 0.07, { r: 0, ry: -0.4 });
  });
  // Side rails, the coin door at the front and the tall backbox.
  b.box(cw * 0.4, 0.12, 0.01, darken(body, 0.25), 0, 0.64, cd / 2 - 0.004, { r: 0 });
  b.box(0.05, 0.03, 0.01, C.brass, 0, 0.7, cd / 2 + 0.002, { r: 0 });
  const bd = 0.1;
  b.box(cw, 0.6, bd, body, 0, 0.84, -cd / 2 + bd / 2, { r: 0.012 });
  b.box(cw - 0.06, 0.4, 0.008, lighten(body, 0.25), 0, 0.96, -cd / 2 + bd + 0.004, { r: 0 });
  for (let i = 0; i < 4; i += 1) b.box(0.05, 0.05, 0.008, [C.yellow, C.pink, C.teal, C.orange][i], -cw * 0.3 + i * cw * 0.2, 1.24, -cd / 2 + bd + 0.008, { r: 0 });
};

/** Moving boxes stacked and taped shut, ready to go. */
const drawBoxStack: Draw = (b, w, d, variant) => {
  const bw = Math.min(w, 0.6) - 0.04;
  const bd = Math.min(d, 0.5) - 0.04;
  const layers: Array<[number, number, number, number]> = [
    // width, depth, height, offset across
    [bw, bd, 0.34, 0],
    [bw * 0.86, bd * 0.9, 0.3, (variant % 2 === 0 ? 1 : -1) * bw * 0.04],
    [bw * 0.62, bd * 0.75, 0.24, (variant % 2 === 0 ? -1 : 1) * bw * 0.08],
  ];
  let y = 0;
  layers.forEach(([lw, ld, lh, x], i) => {
    const colour = i % 2 === 0 ? C.cardboard : C.cardboardDark;
    b.box(lw, lh, ld, colour, x, y, 0, { r: 0.006, ry: (i - 1) * 0.05 });
    // Tape over the top seam and down the front.
    b.box(0.06, 0.004, ld + 0.002, C.tape, x, y + lh, 0, { r: 0, ry: (i - 1) * 0.05 });
    b.box(0.06, lh * 0.5, 0.004, C.tape, x, y + lh * 0.5, ld / 2, { r: 0 });
    y += lh;
  });
};

/** A free-standing kiosk of charging slots, a phone or two docked in it, cables looping out. */
const drawChargingKiosk: Draw = (b, w, d) => {
  const kw = Math.min(w, 0.5) - 0.06;
  const kd = Math.min(d, 0.5) - 0.06;
  b.box(kw + 0.02, 0.04, kd + 0.02, C.charcoal, 0, 0, 0, { r: 0.01 });
  b.box(kw * 0.5, 0.7, kd * 0.5, C.greyLight, 0, 0.04, 0, { r: 0.02 });
  // The head: a block with rows of slots on the front.
  b.box(kw, 0.5, kd, C.white, 0, 0.74, 0, { r: 0.03 });
  b.box(kw - 0.04, 0.06, 0.01, C.teal, 0, 1.18, kd / 2 - 0.003, { r: 0 });
  const cols = 3;
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < cols; col += 1) {
    const x = -kw / 2 + 0.05 + (col * (kw - 0.1)) / (cols - 1);
    const y = 0.8 + row * 0.12;
    b.box(0.06, 0.09, 0.012, C.greyDark, x, y, kd / 2 - 0.004, { r: 0 });
    if ((row + col) % 3 === 0) b.box(0.045, 0.08, 0.012, C.black, x, y + 0.02, kd / 2 + 0.002, { r: 0.006 });
    b.box(0.012, 0.012, 0.012, (row + col) % 2 === 0 ? C.good : C.yellow, x + 0.022, y + 0.005, kd / 2 + 0.001, { r: 0 });
  }
  // Two cables looping down the front from the head.
  b.tube([-kw * 0.3, 0.76, kd / 2 - 0.01], [-kw * 0.2, 0.5, kd / 2 - 0.02], 0.006, C.black, { seg: 5 });
  b.tube([kw * 0.3, 0.76, kd / 2 - 0.01], [kw * 0.15, 0.45, kd / 2 - 0.02], 0.006, C.black, { seg: 5 });
};

/** A tall glass-fronted fridge of drinks, bottles and cans on bright shelves. */
const drawDrinksFridge: Draw = (b, w, d, variant) => {
  const fw = Math.min(w, 0.6) - 0.04;
  const fd = Math.min(d, 0.6) - 0.04;
  const h = 1.7;
  const shell = [C.white, C.greyDark, C.red][variant % 3];
  b.box(fw, h, fd, shell, 0, 0, 0, { r: 0.015 });
  b.box(fw - 0.06, h - 0.3, 0.01, C.charcoal, 0, 0.18, fd / 2 - 0.004, { r: 0 });
  const drinks = [C.red, C.orange, C.green, C.blue, C.yellow, C.purple, C.teal];
  const shelves = 4;
  for (let s = 0; s < shelves; s += 1) {
    const y = 0.22 + s * 0.33;
    b.box(fw - 0.08, 0.012, 0.012, C.chrome, 0, y, fd / 2 - 0.006, { r: 0 });
    for (let i = 0; i < 5; i += 1) {
      const colour = drinks[(i + s * 2 + variant) % drinks.length];
      const tall = s % 2 === 0 ? 0.2 : 0.12;
      b.box(0.045, tall, 0.012, colour, -fw / 2 + 0.08 + (i * (fw - 0.16)) / 4, y + 0.015, fd / 2 - 0.004, { r: 0.004 });
    }
  }
  // Glass over it all, a handle, and a lit band at the top.
  b.box(fw - 0.04, h - 0.26, 0.008, C.glass, 0, 0.16, fd / 2 + 0.006, { r: 0 });
  b.box(0.02, 0.4, 0.02, C.chrome, fw / 2 - 0.05, 0.7, fd / 2 + 0.006, { r: 0 });
  b.box(fw - 0.04, 0.08, 0.01, C.lampWarm, 0, h - 0.11, fd / 2 + 0.006, { r: 0 });
  b.box(fw - 0.02, 0.12, 0.02, darken(shell, 0.3), 0, 0.02, fd / 2 - 0.004, { r: 0 });
};

/** A cabinet of compute boards behind a mesh door, a row of status lights painted along each board. */
const drawComputeCabinet: Draw = (b, w, d) => {
  const cw = Math.min(w, 0.7) - 0.04;
  const cd = Math.min(d, 0.6) - 0.04;
  const h = 1.75;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.04, 0.02, 0.04, C.black, sx * (cw / 2 - 0.04), 0, sz * (cd / 2 - 0.04), { r: 0 });
  b.box(cw, h - 0.02, cd, C.charcoal, 0, 0.02, 0, { r: 0.012 });
  b.box(cw - 0.04, h - 0.1, 0.01, C.black, 0, 0.06, cd / 2 - 0.004, { r: 0 });
  const boards = 9;
  for (let i = 0; i < boards; i += 1) {
    const y = 0.12 + i * 0.17;
    b.box(cw - 0.1, 0.12, 0.014, C.greyDark, 0, y, cd / 2 + 0.002, { r: 0.004 });
    b.box(cw - 0.22, 0.03, 0.006, C.green, -0.04, y + 0.06, cd / 2 + 0.01, { r: 0 });
    for (let l = 0; l < 4; l += 1) b.box(0.016, 0.016, 0.006, l === 3 && i % 4 === 1 ? C.alarm : C.good, cw / 2 - 0.12 + l * 0.024, y + 0.05, cd / 2 + 0.01, { r: 0 });
  }
  // A vented top.
  for (let i = 0; i < 4; i += 1) b.box(cw - 0.08, 0.008, 0.03, C.greyDark, 0, h, -cd / 2 + 0.08 + i * ((cd - 0.16) / 3), { r: 0 });
};

/** A low charging dock with two small wheeled robots parked on its pads, one plugged in, one about to be. */
const drawRobotDock: Draw = (b, w, d, variant) => {
  const dw = Math.min(w, 0.6) - 0.04;
  const dd = Math.min(d, 0.6) - 0.04;
  const body = [C.white, C.greyLight, C.bone][variant % 3];
  // The dock: a slab with a raised back that carries the charging lights.
  b.box(dw, 0.04, dd, C.charcoal, 0, 0, 0, { r: 0.012 });
  b.box(dw, 0.22, 0.06, body, 0, 0.04, -dd / 2 + 0.03, { r: 0.02 });
  for (const sx of [-1, 1]) {
    b.box(dw * 0.36, 0.006, dd * 0.6, C.mint, sx * dw * 0.24, 0.04, 0.03, { r: 0 });
    b.box(0.04, 0.02, 0.008, C.good, sx * dw * 0.24, 0.18, -dd / 2 + 0.064, { r: 0 });
  }
  // Two robots: a squat rounded body on wheels, a dark visor with two painted eyes.
  const r = Math.min(dw * 0.16, dd * 0.22);
  for (const sx of [-1, 1]) {
    const x = sx * dw * 0.24;
    const z = sx > 0 ? 0.0 : 0.04;
    for (const wz of [-1, 1]) b.cyl(0.022, 0.016, C.black, x - r * 0.7, 0.062, z + wz * r * 0.5, { axis: "x", seg: 8 });
    for (const wz of [-1, 1]) b.cyl(0.022, 0.016, C.black, x + r * 0.7, 0.062, z + wz * r * 0.5, { axis: "x", seg: 8 });
    b.ball(r, body, x, 0.06 + r * 0.9, z, { sy: 0.8, seg: 12 });
    b.box(r * 1.1, r * 0.4, 0.01, C.screenOff, x, 0.06 + r * 0.95, z + r * 0.92, { r: 0.006 });
    for (const ex of [-1, 1]) b.box(0.014, 0.014, 0.004, C.mint, x + ex * r * 0.25, 0.06 + r * 1.1, z + r * 0.92 + 0.006, { r: 0 });
  }
};

/** A round table with a softly lit top, two thin panels of light hanging over it on fine posts. */
const drawHoloTable: Draw = (b, w, d) => {
  const radius = Math.min(w, d) / 2 - 0.02;
  const top = 0.74;
  // A single pedestal on a disc foot.
  b.cyl(radius * 0.55, 0.03, C.charcoal, 0, 0, 0, { seg: 20 });
  b.cyl(0.05, top - 0.07, C.white, 0, 0.03, 0, { seg: 10 });
  // The top: an ellipse as wide as the spot, a pale ring of light set into its edge.
  const sx = (w / 2 - 0.02) / radius;
  b.cyl(radius, 0.04, C.white, 0, top - 0.04, 0, { seg: 24, sx });
  b.cyl(radius * 0.95, 0.004, C.mint, 0, top, 0, { seg: 24, sx });
  b.cyl(radius * 0.88, 0.007, C.glass, 0, top, 0, { seg: 24, sx });
  // Two floating panels, painted bright, held by posts as fine as wire.
  const panels: Array<[number, number]> = [
    [-radius * sx * 0.4, -0.25],
    [radius * sx * 0.4, 0.25],
  ];
  for (const [x, yaw] of panels) {
    b.cyl(0.004, 0.18, C.chrome, x, top, 0, { seg: 4 });
    b.place(x, top + 0.18, 0, { ry: yaw }, () => {
      b.box(radius * 0.7, radius * 0.45, 0.006, C.glass, 0, 0, 0, { r: 0 });
      b.box(radius * 0.5, 0.012, 0.008, C.mint, 0, radius * 0.3, 0, { r: 0 });
      b.box(radius * 0.36, 0.012, 0.008, C.lavender, -radius * 0.07, radius * 0.18, 0, { r: 0 });
    });
  }
};

/** A short, rounded home robot: a soft body on a wheeled base, a round head with a face of two painted eyes. */
const drawHomeRobot: Draw = (b, w, d, variant) => {
  const radius = Math.min(w, d) / 2 - 0.03;
  const body = [C.cream, C.white, C.sand][variant % 3];
  b.cyl(radius, 0.06, C.charcoal, 0, 0, 0, { seg: 16 });
  b.lathe(
    [
      [radius * 0.85, 0.06],
      [radius * 0.95, 0.2],
      [radius * 0.85, 0.4],
      [radius * 0.6, 0.5],
      [0.001, 0.52],
    ],
    body,
    0,
    0,
    0,
    { seg: 16 }
  );
  b.box(radius * 0.8, 0.02, 0.01, C.lavender, 0, 0.3, radius * 0.92, { r: 0 });
  // The head, set a little forward, its face a dark band with two soft eyes.
  const head = radius * 0.62;
  b.ball(head, body, 0, 0.52 + head * 0.8, radius * 0.06, { seg: 14 });
  b.box(head * 1.3, head * 0.55, 0.012, C.screenOff, 0, 0.52 + head * 0.55, radius * 0.06 + head * 0.9, { r: 0.01 });
  for (const ex of [-1, 1]) b.ball(0.016, C.lavender, ex * head * 0.3, 0.52 + head * 0.82, radius * 0.06 + head * 0.96, { seg: 6 });
  // Two small arms folded at its sides.
  for (const sx of [-1, 1]) b.box(0.03, 0.14, 0.05, darken(body, 0.08), sx * radius * 0.92, 0.2, 0, { r: 0.012, rz: sx * 0.15 });
};

/** A slim stand of hooks, pairs of glasses hanging on it in soft colours. */
const drawGlassesStand: Draw = (b, w, d, variant) => {
  const spread = Math.min(w, d) / 2 - 0.04;
  const h = 1.45;
  b.cyl(spread, 0.03, C.charcoal, 0, 0, 0, { seg: 16 });
  b.cyl(0.018, h - 0.03, C.white, 0, 0.03, 0, { seg: 8 });
  b.ball(0.03, C.white, 0, h, 0, { seg: 8 });
  const frames = [C.violet, C.black, C.lavender, C.pink, C.teal, C.charcoal];
  // Four arms round the post, a pair of glasses hanging on each, their lenses faintly tinted.
  for (let i = 0; i < 4; i += 1) {
    const yaw = (i * Math.PI) / 2 + Math.PI / 4;
    const y = 0.75 + (i % 2) * 0.32;
    const reach = spread - 0.04;
    const ax = Math.sin(yaw) * reach;
    const az = Math.cos(yaw) * reach;
    b.tube([0, y + 0.04, 0], [ax, y, az], 0.006, C.chrome, { seg: 4 });
    b.place(ax, y - 0.05, az, { ry: yaw }, () => {
      const frame = frames[(i + variant) % frames.length];
      for (const lx of [-1, 1]) {
        b.box(0.05, 0.035, 0.006, frame, lx * 0.032, 0, 0, { r: 0.006 });
        b.box(0.04, 0.026, 0.008, lighten(C.lavender, 0.4), lx * 0.032, 0.0045, 0, { r: 0 });
      }
      b.box(0.016, 0.006, 0.006, frame, 0, 0.028, 0, { r: 0 });
    });
  }
};

/** A column of soft rings of light stacked up a slim pole: painted bright, not lit. */
const drawLightColumn: Draw = (b, w, d, variant) => {
  const base = Math.min(w, d) / 2 - 0.03;
  const tints = [
    [C.lavender, C.violet],
    [C.glass, C.mint],
    [C.pink, C.lavender],
  ][variant % 3];
  b.cyl(base, 0.04, C.bone, 0, 0, 0, { seg: 18 });
  b.cyl(0.014, 1.6, C.white, 0, 0.04, 0, { seg: 8 });
  const rings = 6;
  for (let i = 0; i < rings; i += 1) {
    const t = i / (rings - 1);
    const radius = base * (0.55 + 0.35 * Math.sin(t * Math.PI));
    b.torus(radius, 0.018, i % 2 === 0 ? tints[0] : tints[1], 0, 0.3 + t * 1.2, 0, { seg: 20 });
  }
  b.ball(0.05, lighten(tints[0], 0.4), 0, 1.66, 0, { seg: 10 });
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
  "dot-printer": drawDotPrinter,
  pinball: drawPinball,
  "box-stack": drawBoxStack,
  "charging-kiosk": drawChargingKiosk,
  "drinks-fridge": drawDrinksFridge,
  "compute-cabinet": drawComputeCabinet,
  "robot-dock": drawRobotDock,
  "holo-table": drawHoloTable,
  "home-robot": drawHomeRobot,
  "glasses-stand": drawGlassesStand,
  "light-column": drawLightColumn,
};

const key = (value: number): string => (Math.round(value * 1000) / 1000).toFixed(3);

/** Build a signature prop to fill `size` (width across its facing, depth along it). */
export const createSignatureProp = (kind: SignatureKind, size: FootprintSize, variant: number): PropHandle => {
  const v = Number.isInteger(variant) ? Math.abs(variant) % 12 : 0;
  const kit = new PropKit(`signature:${kind}`);
  kit.model(`signature:${kind}:${key(size.width)}:${key(size.depth)}:${v}`, (b) => DRAW[kind](b, size.width, size.depth, v));
  return kit.finish({ w: size.width, d: size.depth });
};
