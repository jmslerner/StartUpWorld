/**
 * Workstations: desks (five tiers, garage → executive), chairs, the floating
 * "+" marker for vacant desks and the beanbag overflow spot.
 *
 * Desk frame of reference (differs from other props — it follows the seat):
 * the desk group is rotated to the SEAT's facing, so in desk-local space the
 * person sits at z = −0.55 looking toward +Z and the monitor stands on the far
 * (+Z) side of the top with its screen facing back toward −Z.
 */
import * as THREE from "three";
import type { CompanyPhase, TeamRole } from "../../../types/game";
import { bakeModel, C, darken, glowMat, lighten, modelMesh, NEON, SCALE, SLATE } from "../../core/palette";
import type { ColorFilter, ModelBuilder } from "../../core/palette";
import { CHAIR_SIZE, DESK_SIZE, OVERFLOW_SIZE } from "../footprints";
import {
  drawCan,
  drawChair,
  drawKeyboard,
  drawMonitor,
  drawMouse,
  drawMug,
  drawPaperCup,
  drawPaperStack,
  drawPlant,
  drawStickyNote,
  monitorScreen,
} from "./parts";
import type { ChairStyle, MonitorSpec } from "./parts";
import { createScreenSurface, PropKit, screenQuads, shapeMesh } from "./shared";
import type { PropFootprint, PropHandle, ScreenKind } from "./shared";

export type DeskStyle = "garage" | "hotdesk" | "standard" | "premium" | "executive";
export const DESK_STYLES: readonly DeskStyle[] = ["garage", "hotdesk", "standard", "premium", "executive"];

/** Suggested staff desk / chair tier per company phase. */
export const DESK_STYLE_FOR_PHASE: Record<CompanyPhase, DeskStyle> = {
  garage: "garage",
  coworking: "hotdesk",
  office: "standard",
  unicorn: "premium",
  public: "executive",
};

export const DESK_FOOTPRINT: PropFootprint = { w: DESK_SIZE.width, d: DESK_SIZE.depth };
export const DESK_TOP_Y = SCALE.deskTop;
export const CHAIR_FOOTPRINT: PropFootprint = { w: CHAIR_SIZE.width, d: CHAIR_SIZE.depth };

const DESK_ACCENT: Record<DeskStyle, number> = {
  garage: C.red,
  hotdesk: C.teal,
  standard: C.blue,
  premium: C.purple,
  executive: C.burgundy,
};

/** What each role (and the founders) typically has on screen — pass to `createDesk({ screen })` / `setScreen`. */
export const SCREEN_FOR_ROLE: Record<TeamRole | "founder" | "cofounder", ScreenKind> = {
  founder: "terminal",
  cofounder: "deck",
  engineering: "code",
  design: "design",
  product: "deck",
  data: "chart",
  marketing: "chart",
  sales: "sheet",
  ops: "sheet",
  hr: "sheet",
  legal: "sheet",
  executive: "deck",
};

/** Number of distinct clutter arrangements per style (pick with `variant`). */
export const DESK_VARIANTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Desk bodies
// ─────────────────────────────────────────────────────────────────────────────

const TOP = DESK_TOP_Y;

const deskMonitors = (style: DeskStyle, upgraded: boolean): MonitorSpec[] => {
  switch (style) {
    case "garage":
      return upgraded
        ? [
            { kind: "crt", x: 0.24, y: TOP, z: 0.1, yaw: 0.25 },
            { kind: "flat", x: -0.3, y: TOP, z: 0.16, yaw: -0.25, shell: C.charcoal },
          ]
        : [{ kind: "crt", x: 0.1, y: TOP, z: 0.1 }];
    case "hotdesk":
      return upgraded
        ? [
            { kind: "laptop", x: -0.24, y: TOP + 0.07, z: 0.02, yaw: -0.3, shell: C.chrome },
            { kind: "flat", x: 0.28, y: TOP, z: 0.16, yaw: 0.22, shell: C.white },
          ]
        : [{ kind: "laptop", x: 0, y: TOP + 0.07, z: 0.03, shell: C.chrome }];
    case "standard":
      return upgraded
        ? [
            { kind: "flat", x: -0.27, y: TOP, z: 0.15, yaw: -0.2, shell: C.greyLight },
            { kind: "flat", x: 0.27, y: TOP, z: 0.15, yaw: 0.2, shell: C.greyLight },
          ]
        : [{ kind: "flat", x: 0, y: TOP, z: 0.15, shell: C.greyLight }];
    case "premium":
      return upgraded
        ? [
            { kind: "wide", x: 0.1, y: TOP, z: 0.15, shell: C.white },
            { kind: "laptop", x: -0.42, y: TOP, z: 0.02, yaw: -0.45, shell: C.chrome },
          ]
        : [{ kind: "wide", x: 0, y: TOP, z: 0.15, shell: C.white }];
    case "executive":
      return upgraded
        ? [
            { kind: "flat", x: -0.05, y: TOP, z: 0.17, shell: C.brass },
            { kind: "laptop", x: 0.41, y: TOP, z: 0.0, yaw: 0.45, shell: C.charcoal },
          ]
        : [{ kind: "flat", x: 0, y: TOP, z: 0.17, shell: C.brass }];
  }
};

/** The visible mark of the "office upgrade": a neon accent strip under the back edge of the top. */
const drawUpgradeStrip = (b: ModelBuilder): void => {
  b.box(1.1, 0.02, 0.02, NEON, 0, TOP - 0.075, 0.3, { r: 0 });
};

const drawBody = (b: ModelBuilder, style: DeskStyle, accent: number): void => {
  switch (style) {
    case "garage": {
      // A sheet of plywood across two sawhorses.
      b.box(1.3, 0.05, 0.65, C.plywood, 0, TOP - 0.05, 0, { r: 0.008 });
      b.box(1.304, 0.012, 0.654, darken(C.plywood, 0.18), 0, TOP - 0.032, 0, { r: 0 });
      for (const sx of [-1, 1]) {
        const x = sx * 0.45;
        b.box(0.08, 0.06, 0.6, C.pallet, x, TOP - 0.11, 0, { r: 0.01 });
        for (const sz of [-1, 1]) {
          b.strut([x - 0.12, 0, sz * 0.25], [x - 0.012, TOP - 0.1, sz * 0.25], 0.046, C.pallet);
          b.strut([x + 0.12, 0, sz * 0.25], [x + 0.012, TOP - 0.1, sz * 0.25], 0.046, C.pallet);
        }
        b.box(0.03, 0.035, 0.5, darken(C.pallet, 0.12), x, 0.26, 0, { r: 0 });
      }
      // Beige tower PC parked underneath, clear of the sitter's legs.
      const beige = 0xdcd3bb;
      b.box(0.19, 0.42, 0.34, beige, 0.27, 0, 0.16, { r: 0.014 });
      b.box(0.15, 0.03, 0.01, C.charcoal, 0.27, 0.33, -0.014, { r: 0 });
      b.box(0.15, 0.03, 0.01, C.charcoal, 0.27, 0.27, -0.014, { r: 0 });
      b.box(0.03, 0.03, 0.01, C.good, 0.22, 0.2, -0.014, { r: 0 });
      return;
    }
    case "hotdesk": {
      // Pale birch top on painted A-frame trestles.
      b.box(1.3, 0.04, 0.65, C.birch, 0, TOP - 0.04, 0, { r: 0.016 });
      for (const sx of [-1, 1]) {
        const x = sx * 0.5;
        for (const sz of [-1, 1]) b.strut([x, 0, sz * 0.26], [x, TOP - 0.05, sz * 0.07], 0.048, accent);
        b.box(0.04, 0.04, 0.34, accent, x, 0.28, 0, { r: 0.01 });
        b.box(0.07, 0.03, 0.46, accent, x, TOP - 0.07, 0, { r: 0.01 });
      }
      b.box(0.98, 0.035, 0.03, accent, 0, 0.285, 0, { r: 0.008 });
      return;
    }
    case "standard": {
      // White laminate on slab legs with a drawer pedestal.
      b.box(1.3, 0.04, 0.65, C.white, 0, TOP - 0.04, 0, { r: 0.012 });
      for (const sx of [-1, 1]) {
        b.box(0.045, TOP - 0.04, 0.54, C.steel, sx * 0.6, 0, 0, { r: 0.012 });
        b.box(0.075, 0.028, 0.62, C.greyDark, sx * 0.6, 0, 0, { r: 0.01 });
      }
      b.box(1.16, 0.3, 0.022, C.greyLight, 0, 0.34, 0.25, { r: 0.006 });
      b.box(0.34, 0.56, 0.48, C.greyLight, 0.39, 0.03, 0.03, { r: 0.012 });
      for (let i = 0; i < 3; i += 1) {
        b.box(0.3, 0.16, 0.012, C.white, 0.39, 0.05 + i * 0.18, -0.214, { r: 0 });
        b.box(0.11, 0.018, 0.016, C.greyDark, 0.39, 0.15 + i * 0.18, -0.226, { r: 0 });
      }
      return;
    }
    case "premium": {
      // Thick oak top on white sit-stand legs.
      b.box(1.3, 0.05, 0.65, C.oak, 0, TOP - 0.05, 0, { r: 0.022 });
      for (const sx of [-1, 1]) {
        b.box(0.08, 0.035, 0.6, C.white, sx * 0.52, 0, 0, { r: 0.014 });
        b.box(0.09, 0.36, 0.11, C.white, sx * 0.52, 0.035, 0.04, { r: 0.014 });
        b.box(0.065, 0.3, 0.085, C.chrome, sx * 0.52, 0.38, 0.04, { r: 0.01 });
      }
      b.box(1.04, 0.04, 0.07, C.white, 0, TOP - 0.09, 0.04, { r: 0.01 });
      b.box(0.86, 0.06, 0.1, C.charcoal, 0, TOP - 0.15, 0.24, { r: 0.012 });
      b.box(0.1, 0.022, 0.05, C.charcoal, 0.5, TOP - 0.072, -0.29, { r: 0 });
      b.box(0.03, 0.01, 0.02, accent, 0.5, TOP - 0.068, -0.318, { r: 0 });
      return;
    }
    case "executive": {
      // Dark walnut partner's desk with brass inlay.
      b.box(1.3, 0.06, 0.65, C.walnut, 0, TOP - 0.06, 0, { r: 0.02 });
      b.box(1.308, 0.014, 0.658, C.brass, 0, TOP - 0.04, 0, { r: 0 });
      for (const sx of [-1, 1]) {
        b.box(0.34, 0.02, 0.58, C.black, sx * 0.46, 0, 0, { r: 0 });
        b.box(0.36, TOP - 0.08, 0.6, C.walnutDark, sx * 0.46, 0.02, 0, { r: 0.014 });
        for (let i = 0; i < 3; i += 1) {
          b.box(0.3, 0.17, 0.012, C.walnut, sx * 0.46, 0.06 + i * 0.195, -0.304, { r: 0 });
          b.ball(0.016, C.brass, sx * 0.46, 0.13 + i * 0.195, -0.318);
        }
      }
      b.box(0.58, 0.5, 0.03, C.walnut, 0, 0.14, 0.27, { r: 0.008 });
      b.box(0.5, 0.014, 0.008, C.brass, 0, 0.5, 0.288, { r: 0 });
      b.box(0.5, 0.014, 0.008, C.brass, 0, 0.26, 0.288, { r: 0 });
      return;
    }
  }
};

/** Keyboard + mouse: stays on the desk when it is vacant. */
const drawHardware = (b: ModelBuilder, style: DeskStyle): void => {
  switch (style) {
    case "garage":
      drawKeyboard(b, 0.08, TOP, -0.2, 0xdcd3bb, 0xbfb59c, 0.4);
      drawMouse(b, 0.38, TOP, -0.19, 0xdcd3bb);
      return;
    case "hotdesk":
      // Wedge stand that lifts the laptop to eye level.
      b.box(0.3, 0.07, 0.2, C.white, 0, TOP, 0.05, { r: 0.012, taperZ: 0.9 });
      drawKeyboard(b, 0, TOP, -0.2, C.white, C.greyLight, 0.3);
      drawMouse(b, 0.26, TOP, -0.19, C.white);
      return;
    case "standard":
      b.box(0.22, 0.004, 0.18, C.charcoal, 0.34, TOP, -0.19, { r: 0 });
      drawKeyboard(b, -0.02, TOP, -0.2);
      drawMouse(b, 0.34, TOP + 0.004, -0.19);
      return;
    case "premium":
      b.box(0.82, 0.006, 0.3, C.charcoal, 0, TOP, -0.15, { r: 0 });
      drawKeyboard(b, -0.04, TOP + 0.006, -0.2, C.white, C.greyLight, 0.3);
      drawMouse(b, 0.26, TOP + 0.006, -0.19, C.white);
      return;
    case "executive":
      b.box(0.62, 0.008, 0.34, C.burgundy, 0, TOP, -0.13, { r: 0 });
      b.box(0.64, 0.004, 0.36, C.brass, 0, TOP, -0.13, { r: 0 });
      drawKeyboard(b, 0, TOP + 0.008, -0.2, C.black, C.charcoal, 0.34);
      drawMouse(b, 0.26, TOP + 0.008, -0.19, C.black);
      return;
  }
};

/** Personal mess — only on occupied desks. `variant` shuffles it so rows of desks do not look cloned. */
const drawClutter = (b: ModelBuilder, style: DeskStyle, accent: number, upgraded: boolean, variant: number): void => {
  const v = ((variant % DESK_VARIANTS) + DESK_VARIANTS) % DESK_VARIANTS;
  const notes = [C.noteYellow, C.notePink, C.noteBlue];
  switch (style) {
    case "garage": {
      // Pizza box, energy drinks, duct tape.
      if (!upgraded) {
        b.box(0.3, 0.035, 0.3, C.cardboard, -0.4, TOP, -0.06 + v * 0.04, { ry: 0.25 - v * 0.2, r: 0.006 });
        b.cyl(0.07, 0.004, C.red, -0.4, TOP + 0.035, -0.06 + v * 0.04, { seg: 10 });
      }
      drawCan(b, -0.52 + v * 0.03, TOP, 0.2, 0x79c046);
      drawCan(b, -0.34, TOP, 0.24, C.chrome, v !== 1);
      if (v === 2) drawCan(b, 0.5, TOP, 0.22, 0x79c046);
      drawMug(b, 0.52, TOP, 0.0, v === 0 ? C.white : C.yellow, 0.6);
      b.box(0.22, 0.004, 0.055, C.grey, 0.5, TOP, -0.27, { ry: 0.15, r: 0 });
      drawStickyNote(b, -0.15, TOP, -0.25, notes[v], 0.2);
      return;
    }
    case "hotdesk": {
      drawPaperCup(b, 0.44, TOP, 0.02 - v * 0.05);
      b.box(0.18, 0.016, 0.25, v === 1 ? C.coral : C.yellow, -0.44, TOP, -0.1, { ry: 0.2 - v * 0.15, r: 0.004 });
      b.box(0.014, 0.012, 0.15, C.charcoal, -0.3, TOP, -0.1, { ry: 0.6, r: 0 });
      if (v !== 2) drawPlant(b, "small", 0.52, TOP, 0.22, C.white, v);
      // Backpack slumped against the trestle.
      b.box(0.3, 0.36, 0.17, v === 0 ? C.navy : v === 1 ? C.coral : C.charcoal, -0.3, 0, 0.2, { r: 0.06, rx: -0.12 });
      b.box(0.2, 0.14, 0.03, darken(accent, 0.2), -0.3, 0.06, 0.1, { r: 0.012, rx: -0.12 });
      drawStickyNote(b, 0.3, TOP, -0.26, notes[v], -0.2);
      return;
    }
    case "standard": {
      drawMug(b, -0.48, TOP, -0.12 + v * 0.06, [accent, C.yellow, C.coral][v], 2.4);
      drawPaperStack(b, v === 1 ? -0.44 : 0.46, TOP, v === 1 ? 0.14 : 0.12, 0.15, 2 + v);
      if (v !== 1) drawPlant(b, "small", -0.54, TOP, 0.22, C.white, v);
      // Pen cup + photo frame.
      b.cyl(0.035, 0.09, C.charcoal, 0.56, TOP, -0.12, { seg: 8 });
      b.box(0.012, 0.07, 0.012, C.red, 0.55, TOP + 0.06, -0.12, { rz: 0.2, r: 0 });
      b.box(0.012, 0.07, 0.012, C.blue, 0.57, TOP + 0.06, -0.11, { rz: -0.15, r: 0 });
      if (v === 0) b.box(0.12, 0.1, 0.014, C.oak, -0.36, TOP, 0.22, { rx: 0.2, ry: 0.3, r: 0.004 });
      drawStickyNote(b, -0.26, TOP, -0.26, notes[v], 0.15);
      drawStickyNote(b, -0.17, TOP, -0.27, notes[(v + 1) % 3], -0.1);
      return;
    }
    case "premium": {
      drawPlant(b, "small", upgraded ? 0.56 : -0.54, TOP, 0.22, C.white, v);
      // Headphones on a stand.
      if (!upgraded || v !== 0) {
        b.cyl(0.05, 0.012, C.white, 0.54, TOP, -0.02, { seg: 10 });
        b.cyl(0.012, 0.2, C.white, 0.54, TOP, -0.02, { seg: 6 });
        b.torus(0.065, 0.016, C.charcoal, 0.54, TOP + 0.14, -0.02, { axis: "z", arc: Math.PI, seg: 8 });
        for (const sx of [-1, 1]) b.cyl(0.04, 0.035, accent, 0.54 + sx * 0.07, TOP + 0.13, -0.02, { axis: "x", seg: 8 });
      }
      drawMug(b, upgraded ? 0.5 : -0.5, TOP, -0.14, [C.white, accent, C.charcoal][v], 2.2);
      // Phone on a charging puck.
      b.cyl(0.045, 0.008, C.white, -0.3, TOP + 0.006, -0.02, { seg: 10 });
      b.box(0.065, 0.008, 0.13, C.black, -0.3, TOP + 0.014, -0.02, { ry: 0.3, r: 0 });
      return;
    }
    case "executive": {
      // Banker's lamp, nameplate, pen stand, folio.
      const lampX = upgraded ? -0.5 : -0.46;
      b.cyl(0.065, 0.02, C.brass, lampX, TOP, 0.14, { seg: 12 });
      b.cyl(0.013, 0.2, C.brass, lampX, TOP + 0.02, 0.14, { seg: 6 });
      b.cyl(0.055, 0.24, 0x2f7d55, lampX, TOP + 0.19, 0.14, { axis: "x", seg: 10 });
      b.box(0.2, 0.012, 0.03, C.lampWarm, lampX, TOP + 0.186, 0.14, { r: 0 });
      b.prism(
        [
          [-0.03, 0],
          [0.03, 0],
          [0, 0.05],
        ],
        0.2,
        C.brass,
        0.36,
        TOP,
        0.25,
        { ry: Math.PI / 2 }
      );
      if (!upgraded) b.box(0.22, 0.02, 0.3, C.leatherDark, 0.46, TOP, -0.08, { ry: -0.2 + v * 0.15, r: 0.006 });
      b.cyl(0.03, 0.07, C.black, -0.5, TOP, -0.14, { seg: 8 });
      b.box(0.01, 0.1, 0.01, C.brass, -0.5, TOP + 0.04, -0.14, { rz: 0.2, r: 0 });
      if (v !== 2) drawMug(b, 0.5, TOP, 0.2, C.white, 0.9);
      return;
    }
  }
};

/** Vacant desks read as "nobody's": greyer and a touch paler. */
const vacantFilter: ColorFilter = (color) => {
  const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const pale = 0.06;
  color.r += (grey - color.r) * 0.45 + pale;
  color.g += (grey - color.g) * 0.45 + pale;
  color.b += (grey - color.b) * 0.45 + pale;
};

const drawDesk = (b: ModelBuilder, style: DeskStyle, accent: number, upgraded: boolean, occupied: boolean, variant: number): void => {
  if (!occupied) b.setColorFilter(vacantFilter);
  drawBody(b, style, accent);
  if (upgraded) drawUpgradeStrip(b);
  for (const monitor of deskMonitors(style, upgraded)) drawMonitor(b, monitor);
  drawHardware(b, style);
  if (occupied) drawClutter(b, style, accent, upgraded, variant);
  b.setColorFilter(null);
};

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskOptions {
  style: DeskStyle;
  /** Office-upgrade asset owned: second screen + neon under-glow. */
  upgraded?: boolean;
  /** What the monitor shows. Default "code". */
  screen?: ScreenKind;
  /** Trestle / trim colour. Defaults per style. */
  accent?: number;
  /** Clutter arrangement (any integer; e.g. the desk slot index). */
  variant?: number;
  /** Start vacant. Default occupied. */
  occupied?: boolean;
}

export interface DeskHandle extends PropHandle {
  readonly style: DeskStyle;
  /** Vacant = screen off, personal clutter gone, slightly desaturated. */
  setOccupied(occupied: boolean): void;
  /** 0 = daylight, 1 = dusk. Same as setGlow. */
  setScreenGlow(amount: number): void;
  /** Swap the picture on the monitor (role flavour). */
  setScreen(kind: ScreenKind): void;
}

export const createDesk = (options: DeskOptions): DeskHandle => {
  const { style } = options;
  const upgraded = options.upgraded ?? false;
  const accent = options.accent ?? DESK_ACCENT[style];
  const variant = (((options.variant ?? 0) % DESK_VARIANTS) + DESK_VARIANTS) % DESK_VARIANTS;
  const kit = new PropKit(`desk:${style}`);

  const shapeKey = `${style}:${upgraded ? "up" : "base"}`;
  const geometryFor = (occupied: boolean): THREE.BufferGeometry =>
    bakeModel(`desk:${shapeKey}:${accent.toString(16)}:${occupied ? `busy${variant}` : "vacant"}`, (b) =>
      drawDesk(b, style, accent, upgraded, occupied, variant)
    );

  const body = kit.add(modelMesh(geometryFor(true)));
  const screen = createScreenSurface(options.screen ?? "code");
  kit.own(screen.material);
  const screens = new THREE.Mesh(screenQuads(`desk:${shapeKey}`, deskMonitors(style, upgraded).map(monitorScreen)), screen.material);
  kit.add(screens);

  const setScreenGlow = (amount: number): void => screen.setGlow(amount);
  kit.onGlow(setScreenGlow);

  const setOccupied = (occupied: boolean): void => {
    body.geometry = geometryFor(occupied);
    screen.setOn(occupied);
  };
  if (options.occupied === false) setOccupied(false);

  return kit.finish(DESK_FOOTPRINT, {
    style,
    setOccupied,
    setScreenGlow,
    setScreen: (kind: ScreenKind) => screen.setKind(kind),
  });
};

export interface ChairOptions {
  style: ChairStyle;
  /** Shell / mesh colour for the styles that have one. */
  accent?: number;
}

/**
 * A chair on its own so the people system can swivel it or push it back.
 * Origin on the floor under the seat centre; the sitter faces +Z; seat top at
 * SEAT_Y (0.45).
 */
export const createChair = (options: ChairOptions): PropHandle => {
  const accent = options.accent ?? DESK_ACCENT[options.style];
  const kit = new PropKit(`chair:${options.style}`);
  kit.model(`chair:${options.style}:${accent.toString(16)}`, (b) => drawChair(b, options.style, accent));
  return kit.finish(CHAIR_FOOTPRINT);
};

export interface VacantMarkerOptions {
  /** Height of the badge centre above the floor. Default 1.35. */
  height?: number;
}

/** The fixed isometric camera's compass angle (spec §6): markers turn to face it. */
const CAMERA_AZIMUTH = Math.PI / 4;

/**
 * Floating "+" coin that says "hire someone here". It keeps its face toward
 * the fixed camera whatever its parent's rotation (so it can simply be added
 * to a rotated desk group), and bobs, sways and pulses to catch the eye.
 */
export const createVacantMarker = (options: VacantMarkerOptions = {}): PropHandle => {
  const height = options.height ?? 1.35;
  const kit = new PropKit("vacant-marker");
  const coin = new THREE.Group();
  coin.position.y = height;
  // Lean back a little so the face also tilts up toward the elevated camera.
  coin.rotation.order = "YXZ";
  coin.rotation.x = -0.35;
  coin.rotation.y = CAMERA_AZIMUTH;
  kit.add(coin);

  const disc = kit.model(
    "vacant-marker:disc",
    (b) => {
      b.cyl(0.16, 0.05, SLATE, 0, -0.16, 0, { axis: "z", seg: 20 });
    },
    coin
  );
  disc.castShadow = false;
  disc.receiveShadow = false;
  coin.add(
    shapeMesh(
      bakeModel("vacant-marker:glow", (b) => {
        b.torus(0.16, 0.022, NEON, 0, -0.182, 0, { axis: "z", seg: 20 });
        b.box(0.18, 0.052, 0.075, NEON, 0, -0.026, 0, { r: 0.012 });
        b.box(0.052, 0.18, 0.075, NEON, 0, -0.09, 0, { r: 0.012 });
      }),
      glowMat(lighten(NEON, 0.15)),
      false
    )
  );

  kit.onUpdate((_dt, elapsed) => {
    // World yaw of whatever we are attached to, read off its matrix (one frame stale at worst).
    const m = kit.group.matrixWorld.elements;
    const parentYaw = Math.atan2(m[8], m[10]);
    coin.rotation.y = CAMERA_AZIMUTH - parentYaw + Math.sin(elapsed * 1.6) * 0.3;
    coin.position.y = height + Math.sin(elapsed * 2.2) * 0.05;
    coin.scale.setScalar(1 + Math.sin(elapsed * 4.4) * 0.07);
  });
  return kit.finish({ w: 0.4, d: 0.4 });
};

/** Height of the beanbag's seat dip; "floor-sit" characters put their hips here. */
export const FLOOR_SEAT_Y = SCALE.floorSeat;
export const OVERFLOW_FOOTPRINT: PropFootprint = { w: OVERFLOW_SIZE.width, d: OVERFLOW_SIZE.depth };

const BEANBAG_COLORS = [C.coral, C.teal, C.yellow, C.purple, C.blue, C.pink];

export interface OverflowSpotOptions {
  /** Beanbag colour; defaults to a colour picked by `variant`. */
  color?: number;
  variant?: number;
}

export interface OverflowSpotHandle extends PropHandle {
  /** Occupied hides the laptop left on the beanbag (the sitter has their own on their lap). */
  setOccupied(occupied: boolean): void;
}

/** Beanbag for people who do not fit at a desk. The sitter faces +Z, hips at FLOOR_SEAT_Y. */
export const createOverflowSpot = (options: OverflowSpotOptions = {}): OverflowSpotHandle => {
  const variant = Math.abs(options.variant ?? 0);
  const color = options.color ?? BEANBAG_COLORS[variant % BEANBAG_COLORS.length];
  const kit = new PropKit("overflow-spot");
  const radius = Math.min(OVERFLOW_SIZE.width, OVERFLOW_SIZE.depth) / 2;
  kit.model(`beanbag:${color.toString(16)}`, (b) => {
    const shade = darken(color, 0.14);
    b.ball(radius, color, 0, 0, 0.02, { sy: 0.5, seg: 16 });
    // Slumped back-rest lobe, a seam and the button on top.
    b.ball(radius * 0.74, color, 0, 0.1, -0.13, { sy: 0.86, sz: 0.76, seg: 14 });
    b.torus(radius * 0.95, 0.012, shade, 0, 0.12, 0.02, { seg: 20 });
    b.ball(0.03, shade, 0, 0.52, -0.13, { seg: 6 });
  });
  const laptop = kit.model("beanbag:laptop", (b) => {
    b.box(0.3, 0.022, 0.21, C.chrome, 0.02, 0.33, 0.12, { rx: 0.2, ry: 0.3, r: 0.008 });
    b.box(0.06, 0.004, 0.06, lighten(C.chrome, 0.5), 0.02, 0.352, 0.12, { rx: 0.2, ry: 0.3, r: 0 });
  });
  return kit.finish(OVERFLOW_FOOTPRINT, {
    setOccupied: (occupied: boolean) => {
      laptop.visible = !occupied;
    },
  });
};
