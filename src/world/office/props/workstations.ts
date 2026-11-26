/**
 * Workstations: desks (five tiers, garage → executive) and chairs.
 *
 * Desk frame of reference (differs from other props — it follows the seat):
 * the desk group is rotated to the SEAT's facing, so in desk-local space the
 * person sits at z = −0.55 looking toward +Z and the monitor stands on the far
 * (+Z) side of the top with its screen facing back toward −Z.
 */
import * as THREE from "three";
import { bakeModel, C, darken, furnitureOf, modelMesh, phaseTier, SCALE } from "../../core/palette";
import type { ColorFilter, ModelBuilder } from "../../core/palette";
import type { FurnitureSet, LookId, OfficeIndex, Team } from "../../types";
import { CHAIR_SIZE, DESK_SIZE } from "../footprints";
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
import type { ChairStyle, MonitorKind, MonitorSpec } from "./parts";
import { createScreenSurface, PropKit, screenQuads } from "./shared";
import type { PropFootprint, PropHandle, ScreenKind } from "./shared";

export type DeskStyle = "garage" | "hotdesk" | "standard" | "premium" | "executive";
export const DESK_STYLES: readonly DeskStyle[] = ["garage", "hotdesk", "standard", "premium", "executive"];

/**
 * The desk and chair of each office, by furniture set and then by office (0 the garage … 4 the campus). This is where an
 * era gets its own furniture: the "garage" desk is already a 1990s one (plywood, a beige tower, a tube monitor).
 */
export const DESK_STYLE_FOR_PHASE: Record<FurnitureSet, readonly DeskStyle[]> = {
  classic: ["garage", "hotdesk", "standard", "premium", "executive"],
  // The buildings are the plans; the looks dress them: the same desk bodies, another computer on them.
  nineties: ["garage", "hotdesk", "standard", "premium", "executive"],
  noughties: ["garage", "hotdesk", "standard", "premium", "executive"],
  twenties: ["garage", "hotdesk", "standard", "premium", "executive"],
};

/** The desk and chair style of an office in a look: its furniture set's. */
export const deskStyleFor = (office: OfficeIndex, look: LookId = "classic"): DeskStyle =>
  DESK_STYLE_FOR_PHASE[furnitureOf(look)][phaseTier(office)];

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

/** What each team typically has on screen — pass to `createDesk({ screen })` / `setScreen`. */
export const SCREEN_FOR_TEAM: Record<Team, ScreenKind> = {
  product: "code",
  growth: "chart",
  recruiting: "sheet",
};

/** What the screen of a desk no team has shows. */
export const SCREEN_FOR_NOBODY: ScreenKind = "code";

/** Number of distinct clutter arrangements per style (pick with `variant`). */
export const DESK_VARIANTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Desk bodies
// ─────────────────────────────────────────────────────────────────────────────

const TOP = DESK_TOP_Y;

/** The computer each desk style has in the classic look: the old one, office by office. */
const CLASSIC_MONITORS: Record<DeskStyle, MonitorKind> = {
  garage: "crt",
  hotdesk: "laptop",
  standard: "flat",
  premium: "wide",
  executive: "flat",
};

/**
 * The computer on a desk of a style in a furniture set: a tube monitor on every desk of the nineties, flat screens
 * (wide on the two best desks) in the noughties, a laptop on every desk of the twenties.
 */
export const monitorFor = (style: DeskStyle, set: FurnitureSet): MonitorKind => {
  switch (set) {
    case "classic":
      return CLASSIC_MONITORS[style];
    case "nineties":
      return "crt";
    case "noughties":
      return style === "premium" || style === "executive" ? "wide" : "flat";
    case "twenties":
      return "laptop";
  }
};

/** The casing of each style's computer, whatever kind it is: it matches the desk. */
const MONITOR_SHELL: Record<DeskStyle, number | undefined> = {
  garage: undefined,
  hotdesk: C.chrome,
  standard: C.greyLight,
  premium: C.white,
  executive: C.brass,
};

/** Where a computer of each kind stands on the top: a tube sits back and to one side, a laptop near the edge. */
const deskMonitors = (style: DeskStyle, look: LookId): MonitorSpec[] => {
  const kind = monitorFor(style, furnitureOf(look));
  const shell = MONITOR_SHELL[style];
  const withShell = (spec: MonitorSpec): MonitorSpec => (shell === undefined ? spec : { ...spec, shell });
  switch (kind) {
    case "crt":
      return [withShell({ kind, x: 0.1, y: TOP, z: 0.1 })];
    case "laptop":
      // The hot desk's wedge stand lifts it to eye level.
      return [withShell({ kind, x: 0, y: style === "hotdesk" ? TOP + 0.07 : TOP, z: 0.03 })];
    case "flat":
      return [withShell({ kind, x: 0, y: TOP, z: style === "executive" ? 0.17 : 0.15 })];
    case "wide":
      return [withShell({ kind, x: 0, y: TOP, z: style === "executive" ? 0.17 : 0.15 })];
  }
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

/**
 * Keyboard + mouse: stays on the desk when it is vacant. So does the mat under them, which is in the desk's accent
 * colour in every style: seen from above, it is what says whose desk this is.
 */
const drawHardware = (b: ModelBuilder, style: DeskStyle, accent: number): void => {
  switch (style) {
    case "garage":
      b.box(0.24, 0.004, 0.2, accent, 0.38, TOP, -0.19, { r: 0 });
      drawKeyboard(b, 0.08, TOP, -0.2, 0xdcd3bb, 0xbfb59c, 0.4);
      drawMouse(b, 0.38, TOP + 0.004, -0.19, 0xdcd3bb);
      return;
    case "hotdesk":
      // Wedge stand that lifts the laptop to eye level.
      b.box(0.3, 0.07, 0.2, C.white, 0, TOP, 0.05, { r: 0.012, taperZ: 0.9 });
      b.box(0.2, 0.004, 0.18, accent, 0.26, TOP, -0.19, { r: 0 });
      drawKeyboard(b, 0, TOP, -0.2, C.white, C.greyLight, 0.3);
      drawMouse(b, 0.26, TOP + 0.004, -0.19, C.white);
      return;
    case "standard":
      b.box(0.72, 0.004, 0.24, accent, 0.1, TOP, -0.19, { r: 0 });
      drawKeyboard(b, -0.02, TOP + 0.004, -0.2);
      drawMouse(b, 0.34, TOP + 0.004, -0.19);
      return;
    case "premium":
      b.box(0.82, 0.006, 0.3, accent, 0, TOP, -0.15, { r: 0 });
      drawKeyboard(b, -0.04, TOP + 0.006, -0.2, C.white, C.greyLight, 0.3);
      drawMouse(b, 0.26, TOP + 0.006, -0.19, C.white);
      return;
    case "executive":
      b.box(0.62, 0.008, 0.34, accent, 0, TOP, -0.13, { r: 0 });
      b.box(0.64, 0.004, 0.36, C.brass, 0, TOP, -0.13, { r: 0 });
      drawKeyboard(b, 0, TOP + 0.008, -0.2, C.black, C.charcoal, 0.34);
      drawMouse(b, 0.26, TOP + 0.008, -0.19, C.black);
      return;
  }
};

/** Personal mess — only on occupied desks. `variant` shuffles it so rows of desks do not look cloned. */
const drawClutter = (b: ModelBuilder, style: DeskStyle, accent: number, variant: number): void => {
  const v = ((variant % DESK_VARIANTS) + DESK_VARIANTS) % DESK_VARIANTS;
  const notes = [C.noteYellow, C.notePink, C.noteBlue];
  switch (style) {
    case "garage": {
      // Pizza box, energy drinks, duct tape.
      b.box(0.3, 0.035, 0.3, C.cardboard, -0.4, TOP, -0.06 + v * 0.04, { ry: 0.25 - v * 0.2, r: 0.006 });
      b.cyl(0.07, 0.004, C.red, -0.4, TOP + 0.035, -0.06 + v * 0.04, { seg: 10 });
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
      drawPlant(b, "small", -0.54, TOP, 0.22, C.white, v);
      // Headphones on a stand.
      b.cyl(0.05, 0.012, C.white, 0.54, TOP, -0.02, { seg: 10 });
      b.cyl(0.012, 0.2, C.white, 0.54, TOP, -0.02, { seg: 6 });
      b.torus(0.065, 0.016, C.charcoal, 0.54, TOP + 0.14, -0.02, { axis: "z", arc: Math.PI, seg: 8 });
      for (const sx of [-1, 1]) b.cyl(0.04, 0.035, accent, 0.54 + sx * 0.07, TOP + 0.13, -0.02, { axis: "x", seg: 8 });
      drawMug(b, -0.5, TOP, -0.14, [C.white, accent, C.charcoal][v], 2.2);
      // Phone on a charging puck.
      b.cyl(0.045, 0.008, C.white, -0.3, TOP + 0.006, -0.02, { seg: 10 });
      b.box(0.065, 0.008, 0.13, C.black, -0.3, TOP + 0.014, -0.02, { ry: 0.3, r: 0 });
      return;
    }
    case "executive": {
      // Banker's lamp, nameplate, pen stand, folio.
      const lampX = -0.46;
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
      b.box(0.22, 0.02, 0.3, C.leatherDark, 0.46, TOP, -0.08, { ry: -0.2 + v * 0.15, r: 0.006 });
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

const drawDesk = (b: ModelBuilder, style: DeskStyle, look: LookId, accent: number, occupied: boolean, variant: number): void => {
  if (!occupied) b.setColorFilter(vacantFilter);
  drawBody(b, style, accent);
  for (const monitor of deskMonitors(style, look)) drawMonitor(b, monitor);
  drawHardware(b, style, accent);
  if (occupied) drawClutter(b, style, accent, variant);
  b.setColorFilter(null);
};

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskOptions {
  style: DeskStyle;
  /** What the monitor shows. Default "code". */
  screen?: ScreenKind;
  /** Trestle / trim colour: the colour of the team the desk belongs to. Defaults per style. */
  accent?: number;
  /** Clutter arrangement (any integer; e.g. the desk slot index). */
  variant?: number;
  /** Start vacant. Default occupied. */
  occupied?: boolean;
  /** The office's look: which decade's computer stands on the desk. Default "classic". */
  look?: LookId;
}

export interface DeskHandle extends PropHandle {
  readonly style: DeskStyle;
  /** Vacant = screen off, personal clutter gone, slightly desaturated. */
  setOccupied(occupied: boolean): void;
  /** 0 = daylight, 1 = dusk. Same as setGlow. */
  setScreenGlow(amount: number): void;
  /** Swap the picture on the monitor (what the desk's team works on). */
  setScreen(kind: ScreenKind): void;
}

export const createDesk = (options: DeskOptions): DeskHandle => {
  const { style } = options;
  const look = options.look ?? "classic";
  const monitor = monitorFor(style, furnitureOf(look));
  const accent = options.accent ?? DESK_ACCENT[style];
  const variant = (((options.variant ?? 0) % DESK_VARIANTS) + DESK_VARIANTS) % DESK_VARIANTS;
  const kit = new PropKit(`desk:${style}`);

  const geometryFor = (occupied: boolean): THREE.BufferGeometry =>
    bakeModel(`desk:${style}:${monitor}:${accent.toString(16)}:${occupied ? `busy${variant}` : "vacant"}`, (b) =>
      drawDesk(b, style, look, accent, occupied, variant)
    );

  const body = kit.add(modelMesh(geometryFor(true)));
  const screen = createScreenSurface(options.screen ?? "code");
  kit.own(screen.material);
  const screens = new THREE.Mesh(screenQuads(`desk:${style}:${monitor}`, deskMonitors(style, look).map(monitorScreen)), screen.material);
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
