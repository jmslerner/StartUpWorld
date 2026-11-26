/**
 * Reusable sub-assemblies drawn into a ModelBuilder: chairs, monitors, laptops,
 * plants and desk clutter. They are stamped into desks and stations so
 * the whole game shares one design language.
 *
 * Everything here is drawn at the builder's current transform; (x, y, z) place
 * the part's floor-centre origin unless noted.
 */
import { C, darken, lighten, NEON, SCALE } from "../../core/palette";
import type { ModelBuilder } from "../../core/palette";
import type { ScreenQuad } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Chairs — seat top at SEAT_Y, sitter faces +Z, backrest on −Z
// ─────────────────────────────────────────────────────────────────────────────

export type ChairStyle = "garage" | "hotdesk" | "standard" | "premium" | "executive";

/** Chair seat height (spec scale guide). Seated characters put their hips here. */
export const SEAT_Y = SCALE.seat;

const starBase = (b: ModelBuilder, frame: number, reach: number): void => {
  for (let i = 0; i < 5; i += 1) {
    b.at(0, 0, 0, (i / 5) * Math.PI * 2 + 0.31, () => {
      b.box(0.05, 0.03, reach, frame, 0, 0.05, reach / 2, { r: 0.012 });
      // Castor: a six-sided wheel is plenty at this size and a fifth of a sphere's triangles.
      b.cyl(0.034, 0.04, C.black, 0, 0, reach, { axis: "x", seg: 6 });
    });
  }
  b.cyl(0.05, 0.06, frame, 0, 0.04, 0);
};

export const drawChair = (b: ModelBuilder, style: ChairStyle, accent: number = C.teal): void => {
  switch (style) {
    case "garage": {
      // Folding metal chair: an X of tube legs, thin pressed seat and back, their pads in the accent colour.
      const frame = C.galvanised;
      const pad = accent;
      for (const sx of [-1, 1]) {
        b.strut([sx * 0.2, 0, 0.18], [sx * 0.2, 0.93, -0.21], 0.034, frame, { r: 0.01 });
        b.strut([sx * 0.2, 0, -0.2], [sx * 0.2, 0.43, 0.17], 0.034, frame, { r: 0.01 });
      }
      b.box(0.4, 0.025, 0.025, frame, 0, 0.15, 0.115, { r: 0 });
      b.box(0.4, 0.025, 0.025, frame, 0, 0.15, -0.075, { r: 0 });
      b.box(0.43, 0.035, 0.4, pad, 0, SEAT_Y - 0.035, 0.0, { r: 0.012 });
      b.box(0.43, 0.18, 0.03, pad, 0, 0.71, -0.165, { rx: -0.4, r: 0.012 });
      return;
    }
    case "hotdesk": {
      // Moulded shell on splayed wooden dowels.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          b.tube([sx * 0.2, 0, sz * 0.19], [sx * 0.14, 0.4, sz * 0.12], 0.022, C.oak, { taper: 1.25, seg: 8 });
        }
      }
      b.box(0.3, 0.03, 0.28, C.charcoal, 0, 0.375, 0);
      b.box(0.45, 0.055, 0.43, accent, 0, SEAT_Y - 0.055, 0, { r: 0.026 });
      b.box(0.43, 0.36, 0.05, accent, 0, 0.47, -0.205, { rx: -0.14, r: 0.024 });
      b.box(0.43, 0.07, 0.07, accent, 0, 0.41, -0.185, { r: 0.024 });
      return;
    }
    case "standard": {
      // Task chair: upholstery in the accent colour on a dark frame.
      const shell = C.charcoal;
      starBase(b, shell, 0.25);
      b.cyl(0.028, 0.27, C.chrome, 0, 0.09, 0, { seg: 8 });
      b.box(0.24, 0.035, 0.24, shell, 0, 0.345, 0);
      b.box(0.46, 0.04, 0.44, shell, 0, SEAT_Y - 0.085, 0.01, { r: 0.016 });
      b.box(0.45, 0.06, 0.43, accent, 0, SEAT_Y - 0.06, 0.01, { r: 0.028 });
      b.box(0.07, 0.3, 0.035, shell, 0, 0.36, -0.235, { rx: -0.1 });
      b.box(0.43, 0.4, 0.03, shell, 0, 0.56, -0.262, { rx: -0.1, r: 0.014 });
      b.box(0.41, 0.38, 0.05, accent, 0, 0.57, -0.232, { rx: -0.1, r: 0.024 });
      return;
    }
    case "premium": {
      // Ergonomic chair: white frame, coloured mesh back, headrest.
      starBase(b, C.white, 0.26);
      b.cyl(0.028, 0.27, C.chrome, 0, 0.09, 0, { seg: 8 });
      b.box(0.24, 0.035, 0.24, C.white, 0, 0.345, 0);
      b.box(0.46, 0.07, 0.44, C.greyLight, 0, SEAT_Y - 0.07, 0.01, { r: 0.03 });
      b.box(0.06, 0.62, 0.035, C.white, 0, 0.36, -0.25, { rx: -0.1 });
      b.box(0.42, 0.46, 0.045, accent, 0, 0.54, -0.235, { rx: -0.1, r: 0.022 });
      b.box(0.44, 0.05, 0.055, C.white, 0, 0.52, -0.225, { rx: -0.1, r: 0.02 });
      b.box(0.26, 0.11, 0.06, C.greyLight, 0, 1.0, -0.3, { rx: -0.1, r: 0.028 });
      for (const sx of [-1, 1]) {
        b.box(0.035, 0.2, 0.035, C.white, sx * 0.25, 0.4, -0.02);
        b.box(0.06, 0.03, 0.22, C.greyLight, sx * 0.25, 0.6, 0.0, { r: 0.012 });
      }
      return;
    }
    case "executive": {
      // High-back leather with brass base.
      const leather = C.leather;
      const seam = darken(leather, 0.25);
      starBase(b, C.brass, 0.27);
      b.cyl(0.03, 0.25, C.brass, 0, 0.09, 0, { seg: 8 });
      b.box(0.5, 0.11, 0.48, leather, 0, SEAT_Y - 0.11, 0.0, { r: 0.045 });
      b.box(0.5, 0.78, 0.1, leather, 0, 0.47, -0.25, { rx: -0.09, r: 0.045 });
      for (const sy of [0.72, 0.92, 1.1]) b.box(0.4, 0.012, 0.012, seam, 0, sy, -0.2 - (sy - 0.47) * 0.09, { r: 0 });
      for (const sx of [-1, 1]) {
        b.box(0.07, 0.2, 0.36, leather, sx * 0.265, 0.42, -0.04, { r: 0.03 });
        // Arm pads in the accent colour: the one part of this chair that says whose it is.
        b.box(0.07, 0.016, 0.3, accent, sx * 0.265, 0.612, -0.04, { r: 0.006 });
      }
      return;
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Monitors — the screen faces −Z in the spec's own frame (yaw 0), i.e. toward
// whoever sits at the desk. The glowing picture is a separate ScreenQuad.
// ─────────────────────────────────────────────────────────────────────────────

export type MonitorKind = "flat" | "wide" | "crt" | "laptop" | "glass";

export interface MonitorSpec {
  kind: MonitorKind;
  x: number;
  /** Height of the surface it stands on. */
  y: number;
  z: number;
  /** Extra yaw; 0 = screen faces −Z. */
  yaw?: number;
  shell?: number;
}

const MONITOR_SIZE: Record<MonitorKind, { w: number; h: number; lift: number }> = {
  flat: { w: 0.52, h: 0.32, lift: 0.13 },
  wide: { w: 0.78, h: 0.32, lift: 0.15 },
  crt: { w: 0.42, h: 0.34, lift: 0.04 },
  laptop: { w: 0.34, h: 0.22, lift: 0 },
  glass: { w: 0.56, h: 0.3, lift: 0.17 },
};

/** Depth of the glass pane of the invented future's screen. */
const GLASS_PANE = 0.012;

const LAPTOP_TILT = 0.3;

export const drawMonitor = (b: ModelBuilder, spec: MonitorSpec): void => {
  const size = MONITOR_SIZE[spec.kind];
  const shell = spec.shell ?? C.greyLight;
  b.at(spec.x, spec.y, spec.z, spec.yaw ?? 0, () => {
    switch (spec.kind) {
      case "flat":
      case "wide": {
        b.box(0.22, 0.02, 0.16, shell, 0, 0, 0.03, { r: 0.009 });
        b.box(0.05, size.lift + 0.08, 0.03, shell, 0, 0.018, 0.05);
        b.box(size.w, size.h, 0.042, C.black, 0, size.lift, 0, { r: 0.014 });
        // Shell on the back: what the camera sees when the desk faces it.
        b.box(size.w * 0.72, size.h * 0.6, 0.03, shell, 0, size.lift + size.h * 0.2, 0.03, { r: 0.012 });
        b.box(0.07, 0.07, 0.008, NEON, size.w * 0.22, size.lift + size.h * 0.52, 0.047, { r: 0 });
        return;
      }
      case "crt": {
        const beige = 0xdcd3bb;
        b.box(0.26, 0.04, 0.24, darken(beige, 0.15), 0, 0, 0.04, { r: 0.012 });
        b.box(size.w, size.h, 0.12, beige, 0, size.lift, -0.08, { r: 0.022 });
        // Tube housing tapering toward the back (the box is pitched so its "top" points +Z).
        b.box(size.w - 0.04, 0.3, size.h - 0.04, beige, 0, size.lift + 0.02, 0.12, { rx: Math.PI / 2, taper: 0.62, r: 0.03 });
        b.box(size.w - 0.07, size.h - 0.08, 0.012, C.black, 0, size.lift + 0.05, -0.142, { r: 0 });
        b.box(0.03, 0.018, 0.012, C.good, size.w / 2 - 0.05, size.lift + 0.016, -0.142, { r: 0 });
        return;
      }
      case "laptop": {
        b.box(size.w, 0.018, 0.23, shell, 0, 0, 0, { r: 0.007 });
        b.box(size.w - 0.06, 0.004, 0.1, C.charcoal, 0, 0.018, 0.02, { r: 0 });
        b.place(0, 0.016, 0.115, { rx: LAPTOP_TILT }, () => {
          b.box(size.w, size.h, 0.014, shell, 0, 0, 0, { r: 0.006 });
          b.box(0.06, 0.06, 0.004, lighten(shell, 0.5), 0, size.h * 0.4, 0.008, { r: 0 });
        });
        return;
      }
      case "glass": {
        // The invented future: a thin pane floating over a slim stand, held by nothing you can see but a pin.
        b.cyl(0.08, 0.012, shell, 0, 0, 0.04, { seg: 16 });
        b.cyl(0.012, size.lift - 0.03, shell, 0, 0.012, 0.04, { seg: 8 });
        b.ball(0.016, lighten(shell, 0.3), 0, size.lift - 0.02, 0.04, { seg: 8 });
        b.box(size.w, size.h, GLASS_PANE, C.glass, 0, size.lift, 0, { r: 0.004 });
        // A pale rim of light along the bottom edge, painted on.
        b.box(size.w - 0.04, 0.006, GLASS_PANE + 0.002, lighten(C.glass, 0.5), 0, size.lift + 0.004, 0, { r: 0 });
        return;
      }
    }
  });
};

/** The glowing rectangle that belongs on a monitor drawn with `drawMonitor`. */
export const monitorScreen = (spec: MonitorSpec): ScreenQuad => {
  const size = MONITOR_SIZE[spec.kind];
  const yaw = spec.yaw ?? 0;
  // Offset of the screen centre from the monitor origin, in the monitor's frame.
  let dy: number;
  let dz: number;
  let w: number;
  let h: number;
  let tilt = 0;
  switch (spec.kind) {
    case "crt":
      dy = size.lift + 0.05 + (size.h - 0.08) / 2;
      dz = -0.15;
      w = size.w - 0.11;
      h = size.h - 0.12;
      break;
    case "laptop":
      // Half-way up the lid, nudged off its inner face.
      dy = 0.016 + Math.cos(LAPTOP_TILT) * (size.h / 2) + Math.sin(LAPTOP_TILT) * 0.009;
      dz = 0.115 + Math.sin(LAPTOP_TILT) * (size.h / 2) - Math.cos(LAPTOP_TILT) * 0.009;
      w = size.w - 0.03;
      h = size.h - 0.03;
      tilt = LAPTOP_TILT;
      break;
    case "glass":
      dy = size.lift + size.h / 2;
      dz = -(GLASS_PANE / 2 + 0.002);
      w = size.w - 0.02;
      h = size.h - 0.02;
      break;
    default:
      dy = size.lift + size.h / 2;
      dz = -0.0225;
      w = size.w - 0.04;
      h = size.h - 0.04;
  }
  return {
    x: spec.x + Math.sin(yaw) * dz,
    y: spec.y + dy,
    z: spec.z + Math.cos(yaw) * dz,
    w,
    h,
    yaw: yaw + Math.PI,
    tilt,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Clutter
// ─────────────────────────────────────────────────────────────────────────────

export const drawKeyboard = (b: ModelBuilder, x: number, y: number, z: number, body: number = C.charcoal, keys: number = C.greyDark, w = 0.36): void => {
  b.box(w, 0.02, 0.12, body, x, y, z, { r: 0.007 });
  b.box(w - 0.03, 0.006, 0.09, keys, x, y + 0.02, z, { r: 0 });
};

export const drawMouse = (b: ModelBuilder, x: number, y: number, z: number, color: number = C.charcoal): void => {
  b.box(0.055, 0.028, 0.085, color, x, y, z, { r: 0.012 });
};

export const drawMug = (b: ModelBuilder, x: number, y: number, z: number, color: number = C.white, yaw = 0): void => {
  b.at(x, y, z, yaw, () => {
    b.cyl(0.04, 0.085, color, 0, 0, 0, { seg: 10 });
    b.cyl(0.032, 0.004, 0x5a3a26, 0, 0.083, 0, { seg: 10 });
    b.box(0.018, 0.05, 0.03, color, 0.05, 0.018, 0, { r: 0.006 });
  });
};

export const drawPaperCup = (b: ModelBuilder, x: number, y: number, z: number, sleeve: number = C.cardboardDark): void => {
  b.cyl(0.036, 0.1, C.paper, x, y, z, { taper: 1.25, seg: 10 });
  b.cyl(0.041, 0.04, sleeve, x, y + 0.03, z, { taper: 1.09, seg: 10 });
  b.cyl(0.047, 0.014, C.charcoal, x, y + 0.1, z, { seg: 10 });
};

export const drawCan = (b: ModelBuilder, x: number, y: number, z: number, color: number, tipped = false): void => {
  if (tipped) {
    b.cyl(0.03, 0.11, color, x, y, z, { axis: "x", seg: 8, ry: 0.5 });
    return;
  }
  b.cyl(0.03, 0.11, color, x, y, z, { seg: 8 });
  b.cyl(0.026, 0.006, C.chrome, x, y + 0.11, z, { seg: 8 });
};

/** A loose pile of paper, top sheet slightly askew. */
export const drawPaperStack = (b: ModelBuilder, x: number, y: number, z: number, yaw = 0, sheets = 3): void => {
  for (let i = 0; i < sheets; i += 1) {
    b.box(0.21, 0.012, 0.29, i % 2 === 0 ? C.paper : C.bone, x, y + i * 0.012, z, { ry: yaw + (i - 1) * 0.12, r: 0 });
  }
};

export const drawStickyNote = (b: ModelBuilder, x: number, y: number, z: number, color: number, yaw = 0): void => {
  b.box(0.075, 0.004, 0.075, color, x, y, z, { ry: yaw, r: 0 });
};

/** Row of book spines standing on a shelf, starting at x and running +X. Returns the x where it ended. */
export const drawBookRow = (b: ModelBuilder, x: number, y: number, z: number, count: number, seed: number, depth = 0.2): number => {
  const spines = [C.red, C.blue, C.yellow, C.teal, C.purple, C.cream, C.navy, C.orange, C.green, C.burgundy];
  let cursor = x;
  for (let i = 0; i < count; i += 1) {
    const k = (seed * 7 + i * 13) % spines.length;
    const thickness = 0.035 + ((seed + i * 5) % 4) * 0.012;
    const height = 0.2 + ((seed * 3 + i * 7) % 5) * 0.018;
    const lean = (seed + i) % 7 === 0 ? 0.16 : 0;
    b.box(thickness, height, depth * (0.8 + ((i + seed) % 3) * 0.08), spines[k], cursor + thickness / 2, y, z, { rz: -lean, r: 0.004 });
    cursor += thickness + 0.004 + lean * 0.12;
  }
  return cursor;
};

// ─────────────────────────────────────────────────────────────────────────────
// Plants
// ─────────────────────────────────────────────────────────────────────────────

export type PlantSize = "small" | "medium" | "large";

/** Round pot with a soil disc. Returns the soil height. */
export const drawPot = (b: ModelBuilder, x: number, y: number, z: number, radius: number, height: number, color: number): number => {
  b.lathe(
    [
      [radius * 0.72, 0],
      [radius * 0.72, 0.001],
      [radius, height * 0.86],
      [radius * 1.08, height * 0.86],
      [radius * 1.08, height],
      [radius * 0.9, height],
    ],
    color,
    x,
    y,
    z,
    { seg: radius < 0.08 ? 10 : 14 }
  );
  b.cyl(radius * 0.92, 0.01, C.soil, x, y + height - 0.02, z, { seg: radius < 0.08 ? 10 : 14 });
  return y + height - 0.01;
};

export const drawPlant = (b: ModelBuilder, size: PlantSize, x = 0, y = 0, z = 0, pot: number = C.terracotta, variant = 0): void => {
  if (size === "small") {
    // Desk succulent: a rosette of fat leaves.
    const soil = drawPot(b, x, y, z, 0.055, 0.075, pot);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + variant;
      b.blob(0.04, i % 2 ? C.leaf : C.leafLight, x + Math.cos(a) * 0.035, soil - 0.01, z + Math.sin(a) * 0.035, { detail: 0, sy: 1.5, sx: 0.7, sz: 0.7 });
    }
    b.blob(0.035, C.leafLight, x, soil, z, { detail: 0, sy: 1.8, sx: 0.7, sz: 0.7 });
    return;
  }
  if (size === "medium") {
    // Bushy floor plant.
    const soil = drawPot(b, x, y, z, 0.17, 0.3, pot);
    const greens = [C.leaf, C.leafLight, C.leafDark];
    const clumps: Array<[number, number, number, number]> = [
      [0, 0.02, 0, 0.2],
      [0.12, 0.16, 0.05, 0.17],
      [-0.11, 0.2, -0.06, 0.18],
      [0.03, 0.34, -0.09, 0.16],
      [-0.04, 0.4, 0.09, 0.15],
      [0.02, 0.56, 0, 0.13],
    ];
    clumps.forEach(([cx, cy, cz, radius], i) => {
      b.blob(radius, greens[(i + variant) % 3], x + cx, soil + cy - 0.04, z + cz, { detail: 1, ry: i * 1.3 });
    });
    return;
  }
  // Large: slim trunk with big paddle leaves.
  const soil = drawPot(b, x, y, z, 0.2, 0.36, pot);
  b.cyl(0.028, 0.95, C.trunk, x, soil, z, { taper: 0.7, seg: 6 });
  const leaves: Array<[number, number, number]> = [
    [0.0, 0.42, 0.55],
    [1.4, 0.56, 0.5],
    [2.7, 0.68, 0.6],
    [4.0, 0.8, 0.5],
    [5.2, 0.92, 0.55],
    [0.8, 1.04, 0.45],
    [3.3, 1.12, 0.4],
  ];
  leaves.forEach(([angle, height, droop], i) => {
    b.place(x, soil + height, z, { ry: angle + variant }, () => {
      b.blob(0.2, i % 2 ? C.leaf : C.leafDark, 0.19, -0.03, 0, { detail: 1, sy: 0.16, sz: 0.62, rz: -droop });
    });
  });
  b.blob(0.13, C.leafLight, x, soil + 1.02, z, { detail: 1, sy: 1.2, sx: 0.6, sz: 0.6 });
};
