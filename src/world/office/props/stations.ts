/**
 * Stations: eight fixed pieces of furniture. Every office has all eight, where its plan puts them; they grow and
 * smarten up with the company (garage scrappy → campus polished). The floor plans were drawn around them, which is
 * why they keep their places and their old names; nothing is done at a station, and none shows anything of the game.
 *
 * Each station is sized from STATION_SIZES in ../footprints (the floor plans'
 * single source of truth), so it always fits the rectangle the layout reserved.
 * Wall stations (ship, calendar, pricing) are thin boards whose backs reach
 * WALL_GAP behind their footprint, i.e. they hang on the wall the layout put
 * them against.
 */
import * as THREE from "three";
import type { LookId, OfficeIndex, StationKind } from "../../types";
import {
  bakeModel,
  C,
  createDynamicTexture,
  cssColor,
  darken,
  EMBER,
  glowMat,
  INK,
  lighten,
  mat,
  MIST,
  ModelBuilder,
  modelMesh,
  NEON,
  phaseTier,
  STEEL,
  themeFor,
  unitPlane,
  unitSphere,
  vertexMat,
} from "../../core/palette";
import type { CanvasDraw } from "../../core/palette";
import { STATION_SIZES, WALL_GAP } from "../footprints";
import { drawChair, drawMonitor, drawMug, drawPaperCup, drawPlant, SEAT_Y } from "./parts";
import type { ChairStyle } from "./parts";
import { createScreenSurface, hash01, PropKit, Pulse, screenQuads } from "./shared";
import type { PropFootprint, PropHandle } from "./shared";

export interface StationHandle extends PropHandle {
  readonly kind: StationKind;
  readonly office: OfficeIndex;
}

/** The floor rectangle a station fills, per office (mirrors STATION_SIZES as { w, d }). */
export const stationFootprint = (kind: StationKind, office: OfficeIndex): PropFootprint => {
  const size = STATION_SIZES[phaseTier(office)][kind];
  return { w: size.width, d: size.depth };
};

const allStationFootprints = (office: OfficeIndex): Record<StationKind, PropFootprint> => ({
  ship: stationFootprint("ship", office),
  launch: stationFootprint("launch", office),
  investors: stationFootprint("investors", office),
  boardroom: stationFootprint("boardroom", office),
  calendar: stationFootprint("calendar", office),
  coffee: stationFootprint("coffee", office),
  servers: stationFootprint("servers", office),
  pricing: stationFootprint("pricing", office),
});

/** By office (0 the garage … 4 the campus). */
export const STATION_FOOTPRINTS: readonly Record<StationKind, PropFootprint>[] = [
  allStationFootprints(0),
  allStationFootprints(1),
  allStationFootprints(2),
  allStationFootprints(3),
  allStationFootprints(4),
];

const NOTE_COLORS = [C.noteYellow, C.notePink, C.noteBlue, C.noteGreen, C.noteOrange];

/** Z of the wall face behind a wall-hung station (just clear of it, so nothing z-fights). */
const wallFaceZ = (depth: number): number => -depth / 2 - WALL_GAP + 0.004;

const _colorA = new THREE.Color();

// ─────────────────────────────────────────────────────────────────────────────
// ship — the product wall
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductWallHandle extends StationHandle {
  /** How many sticky notes the board can hold in this office. */
  readonly maxNotes: number;
  /** Show the first `count` sticky notes (clamped to 0..maxNotes). */
  setNoteCount(count: number): void;
  /** Flash the frame: "good" = a green glow and the notes jump, "bad" = a red flicker. */
  pulse(kind: "good" | "bad"): void;
}

const BOARD_BOTTOM = 0.82;
const BOARD_HEIGHT = 1.2;
const NOTE_ROWS = 4;

export const createProductWall = (office: OfficeIndex = 2, look: LookId = "classic"): ProductWallHandle => {
  const size = STATION_SIZES[phaseTier(office)].ship;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:ship");

  const width = size.width - 0.1;
  const wall = wallFaceZ(size.depth);
  const face = wall + 0.065;
  const columns = Math.max(3, Math.round(width / 0.8));
  const lane = (width - 0.14) / columns;
  const laneX = (column: number): number => -width / 2 + 0.07 + lane * (column + 0.5);

  const faceColor = [C.paper, 0xcfa873, C.white, 0xe3f1f5, C.marble][tier];
  const frameColor = [C.galvanised, C.oak, C.greyDark, C.chrome, C.brass][tier];
  const inkColor = tier === 4 ? C.marbleVein : tier === 3 ? 0xa9cbd6 : 0xb7bcc2;
  const headers = [MIST, EMBER, theme.accents[0], theme.accents[1], NEON, C.good];

  kit.model(`ship:${look}:${office}`, (b) => {
    // Board, hung slightly crooked in the garage.
    b.place(0, BOARD_BOTTOM, 0, { rz: tier === 0 ? 0.012 : 0 }, () => {
      b.box(width, BOARD_HEIGHT, face - wall, faceColor, 0, 0, (face + wall) / 2, { r: 0.012 });
      const rim = 0.045;
      b.box(width + rim, rim, face - wall + 0.02, frameColor, 0, -rim / 2, (face + wall) / 2 + 0.01, { r: 0.012 });
      b.box(width + rim, rim, face - wall + 0.02, frameColor, 0, BOARD_HEIGHT - rim / 2, (face + wall) / 2 + 0.01, { r: 0.012 });
      for (const sx of [-1, 1]) {
        b.box(rim, BOARD_HEIGHT, face - wall + 0.02, frameColor, (sx * width) / 2, 0, (face + wall) / 2 + 0.01, { r: 0.012 });
      }
      // Lanes: a header chip per column and hand-ruled dividers.
      for (let column = 0; column < columns; column += 1) {
        const header = column === columns - 1 ? C.good : headers[column % (headers.length - 1)];
        b.box(lane - 0.08, 0.075, 0.014, header, laneX(column), BOARD_HEIGHT - 0.17, face + 0.004, { r: 0 });
        if (column > 0) {
          const wobble = tier === 0 ? (hash01(column) - 0.5) * 0.05 : 0;
          b.box(0.012, BOARD_HEIGHT - 0.3, 0.006, inkColor, laneX(column) - lane / 2, 0.08, face + 0.002, { rz: wobble, r: 0 });
        }
      }
      // Marker tray.
      const tray = Math.min(width * 0.5, 1.4);
      b.box(tray, 0.03, size.depth / 2 - face + 0.02, frameColor, 0, -0.06, (size.depth / 2 + face) / 2, { r: 0.008 });
      [C.red, C.blue, C.green, C.black].forEach((marker, i) => {
        b.cyl(0.014, 0.11, marker, -tray / 2 + 0.14 + i * 0.13, -0.03, face + 0.045, { axis: "x", seg: 6 });
      });
      b.box(0.11, 0.035, 0.05, C.charcoal, tray / 2 - 0.14, -0.03, face + 0.045, { r: 0.008 });
      if (tier === 0) {
        // Duct tape holding one corner up.
        b.box(0.16, 0.05, 0.008, C.tape, -width / 2 + 0.05, BOARD_HEIGHT - 0.04, face + 0.02, { rz: 0.7, r: 0 });
      }
      if (tier >= 3) {
        // Stand-offs at the corners of the glass / stone panel.
        for (const sx of [-1, 1]) {
          for (const sy of [0.1, BOARD_HEIGHT - 0.1]) b.cyl(0.03, 0.03, frameColor, sx * (width / 2 - 0.1), sy - 0.03, face, { axis: "z", seg: 8 });
        }
      }
    });
  });

  // Sticky notes: one geometry, revealed with drawRange so any count is one draw call.
  const slots: Array<{ x: number; y: number; order: number; index: number }> = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < NOTE_ROWS; row += 1) {
      for (let k = 0; k < 2; k += 1) {
        const index = slots.length;
        slots.push({
          x: laneX(column) + (k - 0.5) * (lane * 0.46),
          y: BOARD_HEIGHT - 0.37 - row * 0.19,
          // Fill top rows first, columns in a shuffled order, so the board fills up organically.
          order: row * 10 + hash01(index * 31 + tier),
          index,
        });
      }
    }
  }
  slots.sort((a, b) => a.order - b.order);
  const maxNotes = slots.length;
  const noteSize = Math.min(0.155, lane * 0.4);
  let indicesPerNote = 0;
  const notesGeometry = kit.own(
    bakeModel(null, (b) => {
      b.place(0, BOARD_BOTTOM, 0, { rz: tier === 0 ? 0.012 : 0 }, () => {
        for (const slot of slots) {
          const before = b.indexCount;
          const tilt = (hash01(slot.index * 17 + 3) - 0.5) * 0.3;
          const dx = (hash01(slot.index * 5 + 1) - 0.5) * 0.03;
          const color = NOTE_COLORS[Math.floor(hash01(slot.index * 13 + 7) * NOTE_COLORS.length)];
          b.box(noteSize, noteSize, 0.012, color, slot.x + dx, slot.y, face + 0.008, { rz: tilt, r: 0 });
          b.box(noteSize * 0.6, 0.014, 0.004, darken(color, 0.45), slot.x + dx, slot.y + noteSize * 0.5, face + 0.016, { rz: tilt, r: 0 });
          indicesPerNote = b.indexCount - before;
        }
      });
    })
  );
  const notes = modelMesh(notesGeometry);
  notes.castShadow = false;
  kit.add(notes);

  // Glowing frame for the pulse.
  const idleColor = new THREE.Color(theme.glow);
  const frameMaterial = kit.own(mat(tier === 0 ? C.grey : frameColor, { emissive: theme.glow, emissiveIntensity: 0 }).clone());
  const tube = 0.028;
  const frame = new THREE.Mesh(
    bakeModel(`ship-frame:${look}:${office}`, (b) => {
      b.place(0, BOARD_BOTTOM, 0, { rz: tier === 0 ? 0.012 : 0 }, () => {
        const z = face + 0.02;
        b.box(width + 0.07, tube, tube, 0xffffff, 0, -0.05, z, { r: 0.01 });
        b.box(width + 0.07, tube, tube, 0xffffff, 0, BOARD_HEIGHT + 0.022, z, { r: 0.01 });
        for (const sx of [-1, 1]) b.box(tube, BOARD_HEIGHT + 0.1, tube, 0xffffff, sx * (width / 2 + 0.035), -0.05, z, { r: 0.01 });
      });
    }),
    frameMaterial
  );
  kit.add(frame);

  const flash = new Pulse(0.9);
  let flashKind: "good" | "bad" = "good";
  // A few notes up, so the board is not bare.
  let noteCount = Math.round(maxNotes * 0.4);
  const applyNotes = (): void => notesGeometry.setDrawRange(0, noteCount * indicesPerNote);
  applyNotes();

  kit.onUpdate((dt, elapsed) => {
    const p = flash.step(dt);
    const flicker = flashKind === "bad" && Math.sin(elapsed * 55) > 0 ? 0.25 : 1;
    frameMaterial.emissive.copy(idleColor).lerp(_colorA.setHex(flashKind === "good" ? C.good : C.alarm), Math.min(1, p * 2));
    frameMaterial.emissiveIntensity = kit.glowAmount * 0.55 + p * 1.6 * flicker;
    // A good pulse makes the notes jump off the board and the frame swell for a moment.
    const hop = flashKind === "good" ? Math.sin(Math.min(1, p) * Math.PI) * 0.03 : 0;
    notes.position.z = hop;
    frame.scale.setScalar(1 + hop * 0.5);
  });
  kit.tracksGlow();

  return kit.finish(stationFootprint("ship", office), {
    kind: "ship" as const,
    office,
    maxNotes,
    setNoteCount: (count: number) => {
      noteCount = Math.max(0, Math.min(maxNotes, Math.round(count)));
      applyNotes();
    },
    pulse: (kind: "good" | "bad") => {
      flashKind = kind;
      flash.trigger();
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// launch — the growth corner
// ─────────────────────────────────────────────────────────────────────────────

export interface GrowthCornerHandle extends StationHandle {
  /** The chart lights up and the megaphone blares. */
  flash(): void;
}

/** A megaphone whose mouth points along +Z, origin at the back of its grip. */
const drawMegaphone = (b: ModelBuilder, scale: number, body: number, trim: number): void => {
  b.place(0, 0, 0, { rx: Math.PI / 2, scale }, () => {
    // Drawn standing up (mouth +Y), then pitched forward by the rotation above.
    b.lathe(
      [
        [0.05, 0],
        [0.055, 0.1],
        [0.06, 0.12],
        [0.2, 0.46],
        [0.215, 0.47],
        [0.215, 0.5],
        [0.19, 0.5],
      ],
      body,
      0,
      0,
      0,
      { seg: 16 }
    );
    b.cyl(0.062, 0.1, trim, 0, -0.1, 0, { seg: 10 });
    b.cyl(0.19, 0.012, C.charcoal, 0, 0.42, 0, { seg: 16 });
    b.torus(0.21, 0.02, trim, 0, 0.47, 0, { seg: 16 });
  });
  // Pistol grip.
  b.box(0.05 * scale, 0.16 * scale, 0.06 * scale, C.charcoal, 0, -0.19 * scale, 0.06 * scale, { r: 0.012, rx: -0.2 });
};

export const createGrowthCorner = (office: OfficeIndex = 2, look: LookId = "classic"): GrowthCornerHandle => {
  const size = STATION_SIZES[phaseTier(office)].launch;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:launch");

  // Layout: a chart board on the left, the megaphone on the right.
  const hornZone = Math.min(0.55, size.width * 0.38);
  const boardW = size.width - hornZone - 0.08;
  const boardX = -size.width / 2 + 0.04 + boardW / 2;
  const hornX = size.width / 2 - hornZone / 2;
  const boardH = [0.62, 0.72, 0.85, 1.0, 1.1][tier];
  const boardY = [0.78, 0.85, 1.05, 1.1, 1.15][tier];
  const boardZ = -size.depth / 2 + 0.16;
  const led = tier >= 3;
  const boardColor = [C.cardboard, C.paper, C.white, C.black, C.black][tier];
  const postColor = [C.pallet, theme.accents[1], theme.frame, C.white, C.brass][tier];
  const hornScale = [0.8, 0.9, 1, 1.1, 1.2][tier];
  const hornY = [0.62, 1.05, 1.15, 1.25, 1.3][tier];

  kit.model(`launch:${look}:${office}`, (b) => {
    // Chart board on legs.
    if (tier === 0) {
      // Cardboard sign nailed to a stake.
      b.strut([boardX, 0, boardZ], [boardX + 0.02, boardY + boardH * 0.7, boardZ], 0.05, postColor);
      b.box(0.3, 0.05, 0.3, darken(postColor, 0.1), boardX, 0, boardZ, { r: 0.01 });
    } else if (tier === 1) {
      // Flip-chart easel.
      for (const sx of [-1, 1]) b.strut([boardX + sx * boardW * 0.42, 0, boardZ + 0.14], [boardX + sx * boardW * 0.3, boardY + boardH, boardZ], 0.04, postColor);
      b.strut([boardX, 0, boardZ - 0.12], [boardX, boardY + boardH * 0.9, boardZ - 0.01], 0.04, postColor);
    } else {
      for (const sx of [-1, 1]) {
        b.box(0.07, boardY + boardH * 0.5, 0.07, postColor, boardX + sx * (boardW / 2 - 0.12), 0, boardZ - 0.02, { r: 0.014 });
        b.box(0.2, 0.035, 0.28, postColor, boardX + sx * (boardW / 2 - 0.12), 0, boardZ + 0.02, { r: 0.012 });
      }
    }
    b.box(boardW, boardH, 0.045, boardColor, boardX, boardY, boardZ, { r: 0.014, rz: tier === 0 ? -0.03 : 0 });
    if (tier >= 2) {
      const rim = tier === 4 ? C.brass : tier === 3 ? C.white : theme.frame;
      b.box(boardW + 0.05, 0.04, 0.06, rim, boardX, boardY + boardH - 0.02, boardZ, { r: 0.012 });
      b.box(boardW + 0.05, 0.04, 0.06, rim, boardX, boardY - 0.02, boardZ, { r: 0.012 });
    }
    // Megaphone support.
    if (tier === 0) {
      // Parked on an upturned crate.
      b.box(hornZone - 0.06, hornY - 0.26, 0.4, C.pallet, hornX, 0, 0.02, { r: 0.012 });
      for (const sy of [0.08, 0.2]) b.box(hornZone - 0.04, 0.03, 0.42, darken(C.pallet, 0.15), hornX, sy, 0.02, { r: 0 });
    } else {
      // Tripod / stand.
      const stand = tier === 4 ? C.brass : tier >= 3 ? C.chrome : C.charcoal;
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        b.tube([hornX + Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [hornX, hornY * 0.55, 0], 0.016, stand, { seg: 6 });
      }
      b.cyl(0.022, hornY * 0.5 - 0.1, stand, hornX, hornY * 0.5, 0, { seg: 8 });
    }
    b.place(hornX, hornY, -0.12, { rx: -0.35 }, () => drawMegaphone(b, hornScale, tier === 4 ? C.brass : C.red, C.white));
  });

  // The chart itself: bars that glow on a flash (and at dusk on LED boards).
  const barMaterial = kit.own(vertexMat().clone());
  barMaterial.emissive.setHex(theme.glow);
  barMaterial.emissiveIntensity = 0;
  const heights = [0.26, 0.4, 0.34, 0.58, 0.8];
  const bars = new THREE.Mesh(
    bakeModel(`launch-bars:${look}:${office}`, (b) => {
      const usable = boardW - 0.16;
      const pitch = usable / heights.length;
      heights.forEach((value, i) => {
        const color = led ? (i === heights.length - 1 ? EMBER : NEON) : i === heights.length - 1 ? EMBER : theme.accents[i % 3];
        b.box(pitch * 0.62, value * (boardH - 0.18), 0.05, color, boardX - usable / 2 + pitch * (i + 0.5), boardY + 0.07, boardZ + 0.04, {
          r: 0.012,
        });
      });
      // Arrow climbing over the bars.
      const y0 = boardY + 0.07;
      const span = boardH - 0.18;
      const arrow = led ? C.good : C.charcoal;
      b.strut([boardX - usable * 0.42, y0 + span * 0.42, boardZ + 0.07], [boardX + usable * 0.22, y0 + span * 0.92, boardZ + 0.07], 0.03, arrow, { r: 0 });
      b.prism(
        [
          [0, 0.07],
          [-0.07, -0.05],
          [0.07, -0.05],
        ],
        0.03,
        arrow,
        boardX + usable * 0.25,
        y0 + span * 0.95,
        boardZ + 0.07,
        { rz: -0.9 }
      );
    }),
    barMaterial
  );
  bars.castShadow = true;
  kit.add(bars);

  // Sound rings that fly out of the megaphone on flash().
  const mouth = new THREE.Group();
  mouth.position.set(hornX, hornY, -0.12);
  mouth.rotation.x = -0.35;
  kit.add(mouth);
  const ringGeometry = bakeModel("launch-ring", (b) => b.torus(0.2, 0.018, 0xffffff, 0, -0.018, 0, { axis: "z", seg: 20 }));
  const rings = [0, 1, 2].map(() => {
    const ring = new THREE.Mesh(ringGeometry, glowMat(lighten(EMBER, 0.25)));
    ring.visible = false;
    mouth.add(ring);
    return ring;
  });

  const flash = new Pulse(1.1);
  kit.onUpdate((dt) => {
    const p = flash.step(dt);
    barMaterial.emissiveIntensity = (led ? 0.35 + kit.glowAmount * 0.5 : 0) + p * 0.9;
    bars.position.y = Math.sin(Math.min(1, p) * Math.PI) * 0.04;
    rings.forEach((ring, i) => {
      // Each ring leaves a beat after the previous one and grows as it travels.
      const travel = 1 - p - i * 0.18;
      const alive = p > 0 && travel > 0 && travel < 0.7;
      ring.visible = alive;
      if (!alive) return;
      const k = travel / 0.7;
      ring.position.z = (0.5 + k * 0.9) * hornScale;
      ring.scale.setScalar((1 + k * 1.3) * hornScale * (1 - k * k * 0.3));
    });
  });
  kit.tracksGlow();

  return kit.finish(stationFootprint("launch", office), {
    kind: "launch" as const,
    office,
    flash: () => flash.trigger(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// investors — the investor line
// ─────────────────────────────────────────────────────────────────────────────

export interface InvestorLineHandle extends StationHandle {
  /** The phone is ringing: the handset rattles and the call light blinks. */
  ring(on: boolean): void;
}

/** Chunky desk phone, front toward +Z. The handset is separate so it can rattle. */
const drawPhoneBody = (b: ModelBuilder, color: number): void => {
  b.box(0.3, 0.07, 0.24, color, 0, 0, 0, { r: 0.03, taperZ: 0.85 });
  b.box(0.3, 0.05, 0.1, color, 0, 0.05, -0.07, { r: 0.022 });
  // Keypad.
  for (let i = 0; i < 9; i += 1) {
    b.box(0.03, 0.012, 0.03, C.paper, -0.045 + (i % 3) * 0.045, 0.07, 0.01 + Math.floor(i / 3) * 0.042, { r: 0 });
  }
  // Curly cord.
  b.torus(0.03, 0.01, C.charcoal, -0.19, 0, 0.0, { seg: 8 });
  b.torus(0.03, 0.01, C.charcoal, -0.21, 0, 0.06, { seg: 8 });
};

const drawHandset = (b: ModelBuilder, color: number): void => {
  b.box(0.36, 0.045, 0.07, color, 0, 0.03, 0, { r: 0.02 });
  for (const sx of [-1, 1]) b.box(0.09, 0.07, 0.09, color, sx * 0.14, 0, 0, { r: 0.03 });
};

const drawPiggyBank = (b: ModelBuilder, x: number, y: number, z: number, yaw: number): void => {
  const pink = 0xf5a3b5;
  b.at(x, y, z, yaw, () => {
    b.ball(0.11, pink, 0, 0.035, 0, { sx: 1.25, sy: 0.95, seg: 12 });
    b.cyl(0.04, 0.05, lighten(pink, 0.2), 0.14, 0.085, 0, { axis: "x", seg: 8 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.cyl(0.026, 0.06, darken(pink, 0.1), sx * 0.07, 0, sz * 0.055, { seg: 6 });
    }
    for (const sz of [-1, 1]) b.box(0.04, 0.05, 0.02, darken(pink, 0.1), 0.07, 0.21, sz * 0.05, { rx: sz * 0.3, r: 0.008 });
    b.box(0.07, 0.01, 0.018, C.charcoal, -0.01, 0.238, 0, { r: 0 });
    b.cyl(0.035, 0.012, C.brass, -0.01, 0.235, 0, { axis: "z", seg: 10 });
  });
};

export const createInvestorLine = (office: OfficeIndex = 2, look: LookId = "classic"): InvestorLineHandle => {
  const size = STATION_SIZES[phaseTier(office)].investors;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:investors");
  const { width, depth } = size;

  /** Where the phone sits (its handset and call light are animated). */
  const phoneAt = new THREE.Vector3();
  let screen: ReturnType<typeof createScreenSurface> | null = null;

  if (tier === 0) {
    // A red phone and a piggy bank on a bar stool by the wall.
    phoneAt.set(-0.06, 0.74, -0.02);
    kit.model(`investors:${look}:garage`, (b) => {
      b.cyl(0.24, 0.045, C.pallet, 0, 0.695, 0, { seg: 14 });
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        b.tube([Math.cos(a) * 0.23, 0, Math.sin(a) * 0.23], [Math.cos(a) * 0.13, 0.7, Math.sin(a) * 0.13], 0.022, C.galvanised, { seg: 6 });
      }
      b.torus(0.19, 0.014, C.galvanised, 0, 0.26, 0, { seg: 14 });
      b.at(phoneAt.x, phoneAt.y, phoneAt.z, 0.25, () => drawPhoneBody(b, C.red));
      drawPiggyBank(b, 0.22, 0, 0.16, -0.6);
      // Sticky note with an investor's number.
      b.box(0.09, 0.004, 0.09, C.noteYellow, 0.14, 0.74, -0.12, { ry: 0.3, r: 0 });
      b.box(0.03, 0.34, 0.03, C.pallet, -0.02, 0.7, -depth / 2 + 0.02, { r: 0 });
    });
  } else if (tier <= 2) {
    // Phone booth pod: a quiet box with a glass door.
    const w = width - 0.06;
    const d = depth - 0.06;
    const h = 2.1;
    const shell = tier === 1 ? theme.accents[0] : C.white;
    const lining = tier === 1 ? C.cream : theme.accents[0];
    phoneAt.set(0, 1.0, -d / 2 + 0.2);
    kit.model(`investors:${look}:${office}`, (b) => {
      b.box(w, 0.06, d, C.charcoal, 0, 0, 0, { r: 0.014 });
      b.box(w, 0.1, d, shell, 0, h - 0.1, 0, { r: 0.03 });
      b.box(w, h - 0.16, 0.06, shell, 0, 0.06, -d / 2 + 0.03, { r: 0.012 });
      b.box(w - 0.1, h - 0.3, 0.02, lining, 0, 0.12, -d / 2 + 0.07, { r: 0 });
      // Side walls with a window slot; front corner posts.
      for (const sx of [-1, 1]) {
        b.box(0.06, 0.95, d, shell, sx * (w / 2 - 0.03), 0.06, 0, { r: 0.012 });
        b.box(0.06, 0.25, d, shell, sx * (w / 2 - 0.03), h - 0.35, 0, { r: 0.012 });
        b.box(0.06, h - 0.16, 0.07, shell, sx * (w / 2 - 0.03), 0.06, d / 2 - 0.035, { r: 0.012 });
        b.box(0.06, h - 0.16, 0.07, shell, sx * (w / 2 - 0.03), 0.06, -d / 2 + 0.035, { r: 0.012 });
      }
      // Shelf with the phone, and a perch.
      b.box(w - 0.16, 0.04, 0.26, theme.wood, 0, 0.96, -d / 2 + 0.2, { r: 0.012 });
      b.at(phoneAt.x, phoneAt.y, phoneAt.z, 0, () => drawPhoneBody(b, C.charcoal));
      b.cyl(0.15, 0.06, lining, 0, 0.5, 0.02, { seg: 12 });
      b.cyl(0.03, 0.46, C.charcoal, 0, 0.06, 0.02, { seg: 8 });
    });
    // Glass: door + side windows, one mesh.
    const glass = new THREE.Mesh(
      bakeModel(`investors-glass:${look}:${office}`, (b) => {
        b.box(w - 0.14, h - 0.24, 0.02, 0xffffff, 0, 0.08, d / 2 - 0.03, { r: 0 });
        for (const sx of [-1, 1]) b.box(0.02, h - 1.36, d - 0.14, 0xffffff, sx * (w / 2 - 0.03), 1.01, 0, { r: 0 });
      }),
      mat(C.glass, { transparent: true, opacity: 0.3, depthWrite: false })
    );
    kit.add(glass);
  } else {
    // Pitch podium in front of a presentation screen.
    const brass = tier === 4;
    const body = brass ? C.walnut : C.white;
    const trim = brass ? C.brass : theme.accents[0];
    const screenW = width - 0.3;
    const screenH = screenW * 0.6;
    const screenY = 1.05;
    const screenZ = -depth / 2 + 0.1;
    phoneAt.set(width / 2 - 0.42, 1.08, 0.2);
    const podiumX = width / 2 - 0.42;
    kit.model(`investors:${look}:${office}`, (b) => {
      // Carpet runner.
      b.box(width - 0.06, 0.012, depth - 0.06, brass ? C.burgundy : theme.accents[0], 0, 0, 0, { r: 0 });
      b.box(width - 0.16, 0.014, depth - 0.16, brass ? darken(C.burgundy, 0.15) : lighten(theme.accents[0], 0.15), 0, 0, 0, { r: 0 });
      // Screen on a stand.
      b.box(0.5, 0.035, 0.3, C.charcoal, -0.15, 0.012, screenZ + 0.04, { r: 0.012 });
      b.box(0.07, screenY, 0.05, C.charcoal, -0.15, 0.03, screenZ, { r: 0.012 });
      b.box(screenW, screenH, 0.05, C.black, -0.15, screenY, screenZ + 0.03, { r: 0.016 });
      b.box(screenW + 0.04, 0.03, 0.06, trim, -0.15, screenY - 0.03, screenZ + 0.03, { r: 0.01 });
      // Lectern.
      b.box(0.5, 0.06, 0.42, darken(body, 0.2), podiumX, 0.012, 0.2, { r: 0.014 });
      b.box(0.42, 0.96, 0.34, body, podiumX, 0.07, 0.2, { r: 0.02, taper: 1.12 });
      b.box(0.52, 0.045, 0.42, brass ? C.walnutDark : theme.wood, podiumX, 1.03, 0.2, { r: 0.012, rx: 0.16 });
      b.box(0.3, 0.3, 0.012, trim, podiumX, 0.5, 0.385, { r: 0 });
      // Gooseneck microphone.
      b.tube([podiumX - 0.14, 1.07, 0.1], [podiumX - 0.1, 1.3, 0.2], 0.01, C.charcoal, { seg: 6 });
      b.ball(0.03, C.charcoal, podiumX - 0.1, 1.28, 0.2, { seg: 8 });
      if (brass) {
        // Velvet-rope stanchion.
        b.cyl(0.07, 0.02, C.brass, -width / 2 + 0.16, 0.012, depth / 2 - 0.16, { seg: 10 });
        b.cyl(0.018, 0.8, C.brass, -width / 2 + 0.16, 0.03, depth / 2 - 0.16, { seg: 8 });
        b.ball(0.035, C.brass, -width / 2 + 0.16, 0.81, depth / 2 - 0.16, { seg: 8 });
      }
    });
    screen = createScreenSurface("deck");
    kit.own(screen.material);
    const quad = { x: -0.15, y: screenY + screenH / 2, z: screenZ + 0.057, w: screenW - 0.06, h: screenH - 0.06 };
    kit.add(new THREE.Mesh(screenQuads(`investors:${look}:${office}`, [quad]), screen.material));
  }

  // The part that rattles when the line rings: a handset, or on the podiums a conference puck.
  const puck = tier >= 3;
  const restY = phoneAt.y + (puck ? 0 : 0.1);
  const handsetPivot = new THREE.Group();
  handsetPivot.position.set(phoneAt.x, restY, phoneAt.z + (puck ? 0 : -0.07));
  handsetPivot.rotation.y = tier === 0 ? 0.25 : 0;
  kit.add(handsetPivot);
  kit.model(
    `investors-handset:${tier === 0 ? "red" : puck ? "puck" : "dark"}`,
    (b) => {
      if (puck) {
        b.cyl(0.07, 0.03, C.charcoal, 0, 0, 0, { seg: 12 });
        for (let i = 0; i < 3; i += 1) b.at(0, 0, 0, (i / 3) * Math.PI * 2, () => b.box(0.05, 0.022, 0.12, C.charcoal, 0, 0, 0.08, { r: 0.01 }));
      } else {
        drawHandset(b, tier === 0 ? C.red : C.charcoal);
      }
    },
    handsetPivot
  );

  const lampMaterial = kit.own(mat(C.charcoal, { emissive: C.good, emissiveIntensity: 0 }).clone());
  const lamp = new THREE.Mesh(unitSphere(10), lampMaterial);
  lamp.scale.setScalar(0.06);
  lamp.position.set(phoneAt.x + 0.11, phoneAt.y + (puck ? 0.04 : 0.1), phoneAt.z + 0.06);
  kit.add(lamp);

  let ringing = false;
  kit.onUpdate((_dt, elapsed) => {
    if (!ringing) return;
    // Two short bursts per cycle, like a real ringer.
    const cycle = elapsed % 1.4;
    const burst = cycle < 0.35 || (cycle > 0.5 && cycle < 0.85);
    handsetPivot.rotation.z = burst ? Math.sin(elapsed * 60) * 0.12 : 0;
    handsetPivot.position.y = restY + (burst ? Math.abs(Math.sin(elapsed * 45)) * 0.018 : 0);
    lampMaterial.emissiveIntensity = burst ? 1.6 : 0.2;
    lamp.scale.setScalar(burst ? 0.085 : 0.06);
  });
  kit.onGlow((amount) => screen?.setGlow(amount));

  return kit.finish(stationFootprint("investors", office), {
    kind: "investors" as const,
    office,
    ring: (on: boolean) => {
      ringing = on;
      if (!on) {
        handsetPivot.rotation.z = 0;
        handsetPivot.position.y = restY;
        lampMaterial.emissiveIntensity = 0;
        lamp.scale.setScalar(0.06);
      }
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// boardroom — the board table
// ─────────────────────────────────────────────────────────────────────────────

const drawPizzaBox = (b: ModelBuilder, x: number, y: number, z: number, yaw: number, open: boolean): void => {
  b.at(x, y, z, yaw, () => {
    b.box(0.32, 0.035, 0.32, C.cardboard, 0, 0, 0, { r: 0.006 });
    if (!open) {
      b.cyl(0.07, 0.004, C.red, 0, 0.035, 0, { seg: 10 });
      return;
    }
    b.cyl(0.13, 0.012, 0xf2c75c, 0, 0.03, 0, { seg: 12 });
    [
      [0.05, 0.03],
      [-0.06, 0.04],
      [0.0, -0.07],
      [-0.04, -0.03],
    ].forEach(([px, pz]) => b.cyl(0.022, 0.006, C.red, px, 0.04, pz, { seg: 6 }));
    b.box(0.32, 0.3, 0.012, C.cardboardDark, 0, 0.03, -0.16, { rx: -0.35, r: 0 });
  });
};

/** Chairs tucked along both long sides and the two ends of a table centred on the origin. */
const drawChairsAround = (b: ModelBuilder, style: ChairStyle, tableW: number, tableD: number, perSide: number, ends: boolean, accents: readonly number[]): void => {
  let n = 0;
  const tuck = tableD / 2 + 0.1;
  for (let i = 0; i < perSide; i += 1) {
    const x = perSide === 1 ? 0 : -tableW / 2 + 0.38 + (i * (tableW - 0.76)) / (perSide - 1);
    b.at(x, 0, tuck, Math.PI, () => drawChair(b, style, accents[n % accents.length]));
    n += 1;
    b.at(x, 0, -tuck, 0, () => drawChair(b, style, accents[n % accents.length]));
    n += 1;
  }
  if (!ends) return;
  const reach = tableW / 2 + 0.12;
  b.at(reach, 0, 0, -Math.PI / 2, () => drawChair(b, style, accents[n % accents.length]));
  b.at(-reach, 0, 0, Math.PI / 2, () => drawChair(b, style, accents[(n + 1) % accents.length]));
};

export const createBoardTable = (office: OfficeIndex = 2, look: LookId = "classic"): StationHandle => {
  const size = STATION_SIZES[phaseTier(office)].boardroom;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:boardroom");
  const { width, depth } = size;
  const top = 0.74;

  kit.model(`boardroom:${look}:${office}`, (b) => {
    if (tier === 0) {
      // Folding table, last night's pizza, two camping stools.
      const tw = width - 0.5;
      const td = depth - 0.16;
      b.box(tw, 0.04, td, C.greyLight, 0, top - 0.04, 0, { r: 0.012 });
      b.box(tw - 0.04, 0.02, td - 0.04, C.grey, 0, top - 0.055, 0, { r: 0 });
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) b.strut([sx * (tw / 2 - 0.08), 0, sz * (td / 2 - 0.05)], [sx * (tw / 2 - 0.2), top - 0.05, sz * (td / 2 - 0.05)], 0.03, C.galvanised, { r: 0 });
        b.box(0.03, 0.03, td - 0.1, C.galvanised, sx * (tw / 2 - 0.1), 0.12, 0, { r: 0 });
        // Stool.
        const stoolX = sx * (width / 2 - 0.13);
        b.cyl(0.12, 0.04, sx > 0 ? C.blue : C.red, stoolX, SEAT_Y - 0.04, 0, { seg: 10 });
        for (let i = 0; i < 3; i += 1) {
          const a = (i / 3) * Math.PI * 2 + 0.4;
          b.tube([stoolX + Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12], [stoolX + Math.cos(a) * 0.05, SEAT_Y - 0.04, Math.sin(a) * 0.05], 0.014, C.galvanised, { seg: 6 });
        }
      }
      drawPizzaBox(b, -0.2, top, 0.02, 0.2, true);
      drawPizzaBox(b, 0.22, top, -0.05, -0.15, false);
      drawPizzaBox(b, 0.23, top + 0.035, -0.04, 0.3, false);
      for (const [cx, cz] of [
        [0.05, 0.2],
        [-0.38, -0.2],
        [0.36, 0.22],
      ]) {
        b.cyl(0.035, 0.09, C.red, cx, top, cz, { taper: 1.25, seg: 8 });
      }
      return;
    }

    const chair: ChairStyle = (["garage", "hotdesk", "standard", "premium", "executive"] as const)[tier];
    const perSide = [0, 1, 2, 3, 4][tier];
    const ends = tier !== 1;
    const tw = ends ? width - 1.02 : width - 0.4;
    const td = depth - (tier === 1 ? 1.0 : 0.94);
    const wood = tier === 4 ? C.walnut : tier === 2 ? C.white : theme.wood;
    const leg = tier === 4 ? C.walnutDark : theme.frame;

    if (tier === 1) {
      // Café table with a stool at each end.
      const d = Math.max(0.5, depth - 0.3);
      b.box(tw - 0.5, 0.04, d, wood, 0, top - 0.04, 0, { r: 0.02 });
      b.cyl(0.05, top - 0.07, leg, 0, 0.03, 0, { seg: 10 });
      b.cyl(0.24, 0.03, leg, 0, 0, 0, { seg: 14 });
      for (const sx of [-1, 1]) b.at(sx * (width / 2 - 0.26), 0, 0, (-sx * Math.PI) / 2, () => drawChair(b, "hotdesk", theme.accents[sx > 0 ? 0 : 2]));
      drawMonitor(b, { kind: "laptop", x: -0.12, y: top, z: 0.02, yaw: Math.PI / 2, shell: C.chrome });
      drawPaperCup(b, 0.2, top, 0.12);
      drawPaperCup(b, 0.14, top, -0.14, theme.accents[1]);
      drawPlant(b, "small", 0.32, top, -0.04, C.white);
      return;
    }

    // Proper meeting table.
    b.box(tw, 0.055, td, wood, 0, top - 0.055, 0, { r: tier >= 3 ? 0.027 : 0.016 });
    if (tier === 4) b.box(tw - 0.3, 0.006, td - 0.3, C.brass, 0, top, 0, { r: 0 });
    if (tier === 4) b.box(tw - 0.34, 0.008, td - 0.34, wood, 0, top, 0, { r: 0 });
    for (const sx of [-1, 1]) {
      b.box(0.1, top - 0.06, td * 0.5, leg, sx * (tw / 2 - 0.4), 0, 0, { r: 0.016 });
      b.box(0.14, 0.03, td * 0.7, leg, sx * (tw / 2 - 0.4), 0, 0, { r: 0.012 });
    }
    b.box(tw - 0.8, 0.08, 0.05, leg, 0, top - 0.2, 0, { r: 0.012 });
    drawChairsAround(b, chair, tw, td, perSide, ends, tier === 4 ? [C.leather] : theme.accents);

    // On the table: conference phone, pads, drinks.
    b.cyl(0.09, 0.025, C.charcoal, 0, top, 0, { seg: 12 });
    for (let i = 0; i < 3; i += 1) b.at(0, top, 0, (i / 3) * Math.PI * 2 + 0.3, () => b.box(0.055, 0.02, 0.15, C.charcoal, 0, 0, 0.1, { r: 0.01 }));
    for (let i = 0; i < perSide; i += 1) {
      const x = -tw / 2 + 0.38 + (i * (tw - 0.76)) / Math.max(1, perSide - 1);
      b.box(0.16, 0.01, 0.22, C.paper, x, top, td / 2 - 0.19, { ry: 0.08 * (i % 2 ? 1 : -1), r: 0 });
      b.box(0.16, 0.01, 0.22, i % 2 ? C.paper : C.noteYellow, x, top, -td / 2 + 0.19, { ry: 0.1 * (i % 2 ? -1 : 1), r: 0 });
      if (tier >= 3) b.cyl(0.03, 0.08, 0xd9eef5, x + 0.16, top, td / 2 - 0.2, { seg: 8 });
      else drawMug(b, x + 0.16, top, -td / 2 + 0.2, C.white, i);
    }
    if (tier >= 3) {
      drawPlant(b, "small", tw / 2 - 0.5, top, 0, tier === 4 ? C.brass : C.white, 1);
      drawPlant(b, "small", -tw / 2 + 0.5, top, 0, tier === 4 ? C.brass : C.white, 2);
    }
  });

  return kit.finish(stationFootprint("boardroom", office), { kind: "boardroom" as const, office });
};

// ─────────────────────────────────────────────────────────────────────────────
// calendar — the wall calendar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The page of the pad: a month of days with today marked, drawn without a word or a number, so it is right in any
 * year and says nothing of the game.
 */
const drawMonthPage =
  (digital: boolean, header: number): CanvasDraw =>
  (ctx, w, h) => {
    ctx.fillStyle = cssColor(digital ? INK : C.paper);
    ctx.fillRect(0, 0, w, h);
    if (digital) {
      ctx.strokeStyle = cssColor(STEEL);
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    ctx.fillStyle = cssColor(digital ? MIST : header);
    ctx.fillRect(digital ? w * 0.12 : 0, digital ? h * 0.1 : 0, digital ? w * 0.76 : w, h * (digital ? 0.08 : 0.26));
    const columns = 7;
    const rows = 4;
    const cell = (w * 0.84) / columns;
    const top = h * 0.36;
    const pitch = (h * 0.58) / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const today = row === 1 && column === 3;
        ctx.fillStyle = cssColor(today ? (digital ? NEON : header) : digital ? STEEL : C.greyLight);
        ctx.fillRect(w * 0.08 + column * cell + cell * 0.14, top + row * pitch + pitch * 0.14, cell * 0.72, pitch * 0.72);
      }
    }
  };

export const createWallCalendar = (office: OfficeIndex = 2, look: LookId = "classic"): StationHandle => {
  const size = STATION_SIZES[phaseTier(office)].calendar;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:calendar");
  const digital = tier >= 3;
  const wall = wallFaceZ(size.depth);
  const pageW = Math.min(0.66, size.width - 0.2);
  const pageH = pageW * 1.2;
  const pageY = 1.1;
  const pageZ = wall + 0.075;
  const header = tier === 0 ? C.red : theme.accents[0];
  const backing = [C.cardboard, theme.accents[1], C.white, C.white, C.brass][tier];

  kit.model(`calendar:${look}:${office}`, (b) => {
    // Backing board on the wall.
    b.box(pageW + 0.12, pageH + 0.16, 0.035, backing, 0, pageY - 0.07, wall + 0.018, { r: 0.012 });
    if (digital) {
      b.box(pageW + 0.04, pageH + 0.04, 0.04, C.black, 0, pageY - 0.02, wall + 0.05, { r: 0.012 });
    } else {
      // A fat pad of pages, the top one drawn by the texture (or this fallback).
      b.box(pageW, pageH, 0.04, C.bone, 0, pageY, wall + 0.05, { r: 0.004 });
      b.box(pageW, pageH * 0.3, 0.006, header, 0, pageY + pageH * 0.7, pageZ - 0.004, { r: 0 });
      b.box(pageW * 0.3, pageH * 0.28, 0.006, C.charcoal, 0, pageY + pageH * 0.18, pageZ - 0.004, { r: 0 });
      // Binder rings.
      for (let i = 0; i < 5; i += 1) b.torus(0.022, 0.007, C.charcoal, -pageW / 2 + 0.07 + (i * (pageW - 0.14)) / 4, pageY + pageH - 0.035, pageZ - 0.01, { axis: "x", seg: 8 });
    }
    if (tier === 0) b.ball(0.02, C.galvanised, 0, pageY + pageH + 0.05, wall + 0.04, { seg: 6 });
    if (size.width >= 1.0) {
      // Room to spare: a row of day-dots beside the page.
      for (let i = 0; i < 5; i += 1) {
        b.box(0.06, 0.06, 0.012, i === 0 ? header : C.greyLight, pageW / 2 + 0.14, pageY + pageH - 0.12 - i * 0.14, wall + 0.012, { r: 0 });
      }
    }
  });

  const texture = createDynamicTexture(128, 154, drawMonthPage(digital, header));
  if (texture) {
    kit.own(texture);
    const material = kit.own(
      digital
        ? new THREE.MeshLambertMaterial({ color: 0x555555, map: texture.texture, emissive: 0xffffff, emissiveMap: texture.texture, emissiveIntensity: 0.8 })
        : new THREE.MeshLambertMaterial({ map: texture.texture })
    );
    const page = new THREE.Mesh(unitPlane(), material);
    page.scale.set(pageW - (digital ? 0.02 : 0), pageH - (digital ? 0.02 : 0), 1);
    page.position.set(0, pageY + pageH / 2, pageZ + (digital ? 0.0 : 0.002));
    kit.add(page);
    if (digital) {
      kit.onGlow((amount) => {
        material.emissiveIntensity = 0.8 + amount * 0.35;
      });
    }
  }

  return kit.finish(stationFootprint("calendar", office), { kind: "calendar" as const, office });
};

// ─────────────────────────────────────────────────────────────────────────────
// coffee — the coffee machine
// ─────────────────────────────────────────────────────────────────────────────

const COUNTER_TOP = 0.9;

/** Drip filter machine with a glass jug. Front +Z. Returns nothing; steam rises at (x, y + 0.34, z + 0.05). */
const drawDripMachine = (b: ModelBuilder, x: number, y: number, z: number): void => {
  b.box(0.26, 0.04, 0.3, C.charcoal, x, y, z, { r: 0.012 });
  b.box(0.26, 0.36, 0.1, C.charcoal, x, y, z - 0.1, { r: 0.016 });
  b.box(0.26, 0.11, 0.3, C.charcoal, x, y + 0.27, z, { r: 0.02 });
  b.cyl(0.085, 0.14, 0x6a4630, x, y + 0.045, z + 0.045, { seg: 10 });
  b.cyl(0.09, 0.02, 0xd9eef5, x, y + 0.185, z + 0.045, { seg: 10 });
  b.box(0.02, 0.09, 0.05, C.charcoal, x + 0.1, y + 0.08, z + 0.045, { r: 0 });
  b.box(0.03, 0.03, 0.012, C.alarm, x - 0.08, y + 0.31, z + 0.151, { r: 0 });
};

/** Bean-to-cup office machine. */
const drawBeanMachine = (b: ModelBuilder, x: number, y: number, z: number, shell: number): void => {
  b.box(0.36, 0.5, 0.36, shell, x, y, z, { r: 0.024 });
  b.box(0.3, 0.2, 0.02, C.black, x, y + 0.08, z + 0.176, { r: 0 });
  b.box(0.3, 0.02, 0.1, C.greyDark, x, y + 0.06, z + 0.21, { r: 0 });
  b.box(0.14, 0.09, 0.02, C.screenDim, x, y + 0.35, z + 0.176, { r: 0 });
  b.cyl(0.11, 0.12, 0x5a3a26, x, y + 0.5, z - 0.04, { seg: 10 });
  b.cyl(0.115, 0.02, C.charcoal, x, y + 0.62, z - 0.04, { seg: 10 });
  drawMug(b, x, y + 0.08, z + 0.22, C.white, 0.5);
};

/** Chrome two-group espresso machine. */
const drawEspressoMachine = (b: ModelBuilder, x: number, y: number, z: number, w: number, shell: number): void => {
  b.box(w, 0.07, 0.38, C.charcoal, x, y, z, { r: 0.012 });
  b.box(w, 0.2, 0.2, shell, x, y + 0.07, z - 0.09, { r: 0.02 });
  b.box(w, 0.13, 0.4, shell, x, y + 0.26, z, { r: 0.03 });
  b.box(w - 0.04, 0.01, 0.34, C.charcoal, x, y + 0.39, z, { r: 0 });
  const groups = w > 0.6 ? 3 : 2;
  for (let i = 0; i < groups; i += 1) {
    const gx = x - w / 2 + (w / groups) * (i + 0.5);
    b.cyl(0.04, 0.05, C.charcoal, gx, y + 0.21, z + 0.1, { seg: 8 });
    b.box(0.022, 0.022, 0.16, C.black, gx, y + 0.205, z + 0.2, { r: 0 });
    b.cyl(0.032, 0.05, C.white, gx, y + 0.07, z + 0.1, { seg: 8 });
    b.cyl(0.03, 0.045, C.white, gx - 0.07 + i * 0.03, y + 0.4, z - 0.05, { seg: 8 });
    b.cyl(0.03, 0.045, C.white, gx + 0.04, y + 0.4, z + 0.04, { seg: 8 });
  }
  // Steam wand and pressure dial.
  b.tube([x + w / 2 - 0.03, y + 0.3, z + 0.14], [x + w / 2 + 0.03, y + 0.1, z + 0.2], 0.01, C.chrome, { seg: 6 });
  b.cyl(0.035, 0.012, C.paper, x - w / 2 + 0.08, y + 0.29, z + 0.201, { axis: "z", seg: 10 });
};

const drawGrinder = (b: ModelBuilder, x: number, y: number, z: number, shell: number): void => {
  b.box(0.16, 0.26, 0.2, shell, x, y, z, { r: 0.02 });
  b.cyl(0.07, 0.16, 0x5a3a26, x, y + 0.26, z, { taper: 1.35, seg: 10 });
  b.cyl(0.098, 0.015, C.charcoal, x, y + 0.42, z, { seg: 10 });
};

export const createCoffeeMachine = (office: OfficeIndex = 2, look: LookId = "classic"): StationHandle => {
  const size = STATION_SIZES[phaseTier(office)].coffee;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:coffee");
  const { width, depth } = size;
  const w = width - 0.06;
  const d = depth - 0.06;
  const espresso = tier >= 3;
  // Machine placement is worked out here, not in the (cached) model callback, because the steam needs it too.
  const machineW = espresso ? Math.min(0.9, w * 0.45) : 0;
  const machineX = espresso ? -w / 2 + machineW / 2 + 0.12 : tier === 0 ? -0.12 : -w / 2 + 0.3;
  /** Where the steam rises from. */
  const steamAt = espresso
    ? new THREE.Vector3(machineX, COUNTER_TOP + 0.5, 0.02)
    : tier === 0
      ? new THREE.Vector3(machineX, COUNTER_TOP + 0.27, 0.02)
      : new THREE.Vector3(machineX, COUNTER_TOP + 0.22, 0.2);

  kit.model(`coffee:${look}:${office}`, (b) => {
    if (tier === 0) {
      // A plank across two milk crates.
      for (const sx of [-1, 1]) {
        for (const level of [0, 0.42]) {
          const crate = sx > 0 ? C.blue : C.red;
          b.box(0.34, 0.4, d - 0.08, crate, sx * (w / 2 - 0.18), level, 0, { r: 0.016 });
          b.box(0.26, 0.1, d - 0.06, darken(crate, 0.35), sx * (w / 2 - 0.18), level + 0.08, 0, { r: 0 });
          b.box(0.26, 0.1, d - 0.06, darken(crate, 0.35), sx * (w / 2 - 0.18), level + 0.23, 0, { r: 0 });
        }
      }
      b.box(w, 0.045, d, C.plywood, 0, COUNTER_TOP - 0.045, 0, { r: 0.008 });
    } else {
      // Cabinet with doors and a worktop.
      const body = tier === 4 ? C.marble : theme.panel;
      const worktop = tier === 4 ? C.marbleLight : tier === 2 ? C.greyDark : theme.wood;
      b.box(w - 0.04, 0.08, d - 0.08, C.charcoal, 0, 0, -0.02, { r: 0 });
      b.box(w, COUNTER_TOP - 0.13, d - 0.03, body, 0, 0.08, -0.015, { r: 0.014 });
      b.box(w + 0.02, 0.05, d + 0.02, worktop, 0, COUNTER_TOP - 0.05, 0, { r: 0.014 });
      const doors = Math.max(2, Math.round(w / 0.5));
      for (let i = 0; i < doors; i += 1) {
        const dx = -w / 2 + (w / doors) * (i + 0.5);
        const door = tier === 4 ? C.marbleLight : tier === 1 ? theme.accents[i % 3] : lighten(body, 0.25);
        b.box(w / doors - 0.04, COUNTER_TOP - 0.22, 0.014, door, dx, 0.12, d / 2 - 0.024, { r: 0 });
        b.box(0.02, 0.12, 0.02, tier === 4 ? C.brass : C.greyDark, dx + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.07), 0.5, d / 2 - 0.01, { r: 0 });
      }
      if (tier === 4) b.box(w + 0.03, 0.014, d + 0.03, C.brass, 0, COUNTER_TOP - 0.065, 0, { r: 0 });
    }

    // The machine, and whatever else fits along the counter.
    const shell = tier === 4 ? C.brass : C.chrome;
    if (espresso) {
      drawEspressoMachine(b, machineX, COUNTER_TOP, -0.03, machineW, shell);
      if (w > 1.0) drawGrinder(b, machineX + machineW / 2 + 0.16, COUNTER_TOP, -0.06, shell);
      if (w > 2.0) drawGrinder(b, machineX + machineW / 2 + 0.36, COUNTER_TOP, -0.06, shell);
    } else if (tier === 0) {
      drawDripMachine(b, machineX, COUNTER_TOP, -0.04);
    } else {
      drawBeanMachine(b, machineX, COUNTER_TOP, -0.03, tier === 1 ? C.white : C.charcoal);
    }

    // Mugs, and extras as the counter gets longer.
    const right = w / 2 - 0.14;
    if (tier === 0) {
      drawMug(b, 0.2, COUNTER_TOP, 0.08, C.yellow, 0.4);
      drawMug(b, 0.3, COUNTER_TOP, -0.08, C.white, 2.1);
      b.cyl(0.05, 0.12, 0xd9eef5, 0.14, COUNTER_TOP, -0.12, { seg: 8 });
      b.cyl(0.052, 0.02, C.red, 0.14, COUNTER_TOP + 0.12, -0.12, { seg: 8 });
    } else {
      // Mug tree / cup stacks.
      for (let i = 0; i < Math.min(4, Math.floor(w / 0.5)); i += 1) {
        const stack = 2 + ((i * 7) % 3);
        for (let k = 0; k < stack; k += 1) b.cyl(0.035, 0.05, tier === 1 ? theme.accents[(i + k) % 3] : C.white, right - i * 0.1, COUNTER_TOP + k * 0.04, 0.1 - (i % 2) * 0.16, { seg: 8, taper: 1.15 });
      }
      if (w > 1.3) {
        // Pastry dome.
        const px = right - 0.55;
        b.cyl(0.14, 0.02, C.white, px, COUNTER_TOP, 0, { seg: 14 });
        b.ball(0.06, 0xd89a52, px - 0.04, COUNTER_TOP + 0.02, 0.02, { sy: 0.6, seg: 8 });
        b.ball(0.055, 0xc98442, px + 0.05, COUNTER_TOP + 0.02, -0.03, { sy: 0.6, seg: 8 });
      }
      if (w > 1.7) {
        // Sink with a tap.
        const sx = right - 1.0;
        b.box(0.3, 0.01, 0.26, C.chrome, sx, COUNTER_TOP, 0.02, { r: 0 });
        b.box(0.24, 0.008, 0.2, C.greyDark, sx, COUNTER_TOP + 0.006, 0.02, { r: 0 });
        b.tube([sx, COUNTER_TOP, -0.13], [sx, COUNTER_TOP + 0.2, -0.13], 0.012, C.chrome, { seg: 6 });
        b.tube([sx, COUNTER_TOP + 0.2, -0.13], [sx, COUNTER_TOP + 0.17, -0.02], 0.012, C.chrome, { seg: 6 });
      }
      if (tier >= 3) drawPlant(b, "small", right + 0.02, COUNTER_TOP, -0.16, tier === 4 ? C.brass : C.white, 1);
    }
  });

  // Steam: three puffs that swell as they rise, then shrink away (scale only, so they share a material).
  // Unlit: lit steam would go grey on its shaded side.
  const steamMaterial = glowMat(0xffffff, { opacity: 0.7 });
  const puffs = [0, 1, 2].map(() => {
    const puff = new THREE.Mesh(unitSphere(8), steamMaterial);
    puff.scale.setScalar(0);
    kit.add(puff);
    return puff;
  });
  kit.onUpdate((_dt, elapsed) => {
    puffs.forEach((puff, i) => {
      const life = (elapsed * 0.45 + i / puffs.length) % 1;
      const swell = Math.sin(life * Math.PI);
      puff.position.set(steamAt.x + Math.sin(elapsed * 1.3 + i * 2.1) * 0.03 * life, steamAt.y + life * 0.42, steamAt.z + Math.cos(elapsed * 1.1 + i) * 0.02);
      puff.scale.setScalar(0.03 + swell * 0.11);
      puff.visible = life > 0.04;
    });
  });

  return kit.finish(stationFootprint("coffee", office), { kind: "coffee" as const, office });
};

// ─────────────────────────────────────────────────────────────────────────────
// servers — the server rack
// ─────────────────────────────────────────────────────────────────────────────


interface Led {
  x: number;
  y: number;
  z: number;
}

const GARAGE_SHELF_Y = 0.78;
const rackHeight = (tier: number): number => (tier === 1 ? 1.3 : 1.95);

/** Draws the servers of an office; when `leds` is given, also records where every status LED sits. */
const drawServers = (b: ModelBuilder, office: OfficeIndex, look: LookId, leds: Led[] | null): void => {
  const { width, depth } = STATION_SIZES[phaseTier(office)].servers;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  if (tier === 0) {
    // A beige tower under a plank shelf, with the router on top.
    for (const sx of [-1, 1]) {
      b.box(0.05, GARAGE_SHELF_Y, depth - 0.1, C.pallet, sx * (width / 2 - 0.06), 0, 0, { r: 0.01 });
    }
    b.box(width - 0.04, 0.045, depth - 0.06, C.plywood, 0, GARAGE_SHELF_Y, 0, { r: 0.008 });
    const beige = 0xdcd3bb;
    b.box(0.22, 0.48, depth - 0.2, beige, -0.08, 0, 0, { r: 0.016 });
    b.box(0.17, 0.035, 0.012, C.charcoal, -0.08, 0.38, depth / 2 - 0.096, { r: 0 });
    b.box(0.17, 0.035, 0.012, C.charcoal, -0.08, 0.32, depth / 2 - 0.096, { r: 0 });
    b.box(0.17, 0.1, 0.012, darken(beige, 0.12), -0.08, 0.06, depth / 2 - 0.096, { r: 0 });
    // Desk fan keeping it alive.
    b.cyl(0.1, 0.03, C.greyDark, 0.2, 0.12, 0.05, { axis: "z", seg: 12 });
    b.torus(0.1, 0.012, C.charcoal, 0.2, 0.1, 0.05, { axis: "z", seg: 12 });
    b.box(0.1, 0.03, 0.1, C.charcoal, 0.2, 0, 0.05, { r: 0.01 });
    b.box(0.02, 0.1, 0.02, C.charcoal, 0.2, 0.02, 0.03, { r: 0 });
    // Router with antennas.
    const top = GARAGE_SHELF_Y + 0.045;
    b.box(0.3, 0.05, 0.2, C.black, 0.04, top, 0, { r: 0.016 });
    for (const sx of [-1, 1]) b.tube([0.04 + sx * 0.12, top + 0.04, -0.08], [0.04 + sx * 0.16, top + 0.3, -0.1], 0.012, C.black, { seg: 6 });
    // Cable spaghetti.
    b.tube([0.04, top + 0.02, -0.1], [-0.08, 0.5, -0.16], 0.01, C.blue, { seg: 5 });
    b.tube([0.1, top + 0.02, -0.1], [0.24, 0.02, -0.14], 0.01, C.yellow, { seg: 5 });
    if (leds) {
      for (let i = 0; i < 5; i += 1) leds.push({ x: -0.06 + i * 0.05, y: top + 0.018, z: 0.101 });
      leds.push({ x: -0.14, y: 0.24, z: depth / 2 - 0.094 });
    }
    return;
  }

  const count = tier;
  const rackW = (width - 0.1) / count;
  const rackH = rackHeight(tier);
  const rackD = depth - 0.12;
  const shell = tier === 4 ? 0x3a4250 : 0x4b5563;
  const trim = tier === 4 ? C.brass : tier === 3 ? theme.glow : C.greyDark;
  for (let r = 0; r < count; r += 1) {
    const x = -width / 2 + 0.05 + rackW * (r + 0.5);
    b.box(rackW - 0.03, rackH, rackD, shell, x, 0.04, -0.02, { r: 0.016 });
    b.box(rackW - 0.01, 0.04, rackD + 0.02, C.black, x, 0, -0.02, { r: 0 });
    b.box(rackW - 0.09, rackH - 0.1, 0.01, C.black, x, 0.09, rackD / 2 - 0.02, { r: 0 });
    b.box(rackW - 0.02, 0.035, rackD + 0.01, trim, x, rackH + 0.03, -0.02, { r: 0.01 });
    // Server units: dark bars with a pale handle, each with two or three LEDs.
    const units = Math.floor((rackH - 0.2) / 0.16);
    const front = rackD / 2 - 0.02;
    for (let u = 0; u < units; u += 1) {
      const y = 0.14 + u * 0.16;
      const blank = hash01(r * 37 + u * 11 + tier) < 0.16;
      b.box(rackW - 0.12, 0.11, 0.014, blank ? C.black : u % 3 === 0 ? 0x2a313b : C.charcoal, x, y, front + 0.004, { r: 0 });
      if (blank) continue;
      b.box(0.05, 0.02, 0.02, C.grey, x + rackW / 2 - 0.11, y + 0.045, front + 0.012, { r: 0 });
      if (!leds) continue;
      leds.push({ x: x - rackW / 2 + 0.1, y: y + 0.045, z: front + 0.014 });
      leds.push({ x: x - rackW / 2 + 0.15, y: y + 0.045, z: front + 0.014 });
      if (hash01(r * 5 + u * 3) > 0.5) leds.push({ x: x - rackW / 2 + 0.2, y: y + 0.045, z: front + 0.014 });
    }
  }
  if (tier === 1) {
    // Small cabinet: a UPS and a patch of cables on top.
    b.box(0.3, 0.14, 0.26, C.greyDark, 0.02, rackH + 0.065, 0, { r: 0.014 });
    b.tube([0.1, rackH + 0.2, -0.05], [0.25, rackH + 0.07, -0.2], 0.012, C.yellow, { seg: 5 });
  }
  if (tier >= 3) {
    // Overhead cable tray tying the row together.
    b.box(width - 0.2, 0.05, 0.3, C.greyDark, 0, rackH + 0.17, -0.06, { r: 0.01 });
    for (let r = 0; r < count; r += 1) b.box(0.06, 0.12, 0.06, C.greyDark, -width / 2 + 0.05 + rackW * (r + 0.5), rackH + 0.06, -0.06, { r: 0 });
    for (const [i, cable] of [C.blue, C.yellow, C.red].entries()) b.box(width - 0.3, 0.025, 0.04, cable, 0, rackH + 0.22, -0.14 + i * 0.08, { r: 0.01 });
  }
};

export const createServerRack = (office: OfficeIndex = 2, look: LookId = "classic"): StationHandle => {
  const tier = phaseTier(office);
  const kit = new PropKit("station:servers");
  const ledSize = tier === 0 ? 0.026 : 0.022;

  kit.model(`servers:${look}:${office}`, (b) => drawServers(b, office, look, null));

  // LEDs in four groups, each one mesh, toggled to make the blink pattern.
  const groupColors = [C.good, NEON, C.good, EMBER];
  const groups = groupColors.map((color, g) => {
    const mesh = new THREE.Mesh(
      bakeModel(`servers-leds:${look}:${office}:${g}`, (b) => {
        // Re-run the drawing into a scratch builder purely to learn where the LEDs are.
        const leds: Led[] = [];
        drawServers(new ModelBuilder(), office, look, leds);
        leds.forEach((led, i) => {
          const mine = g === 3 ? i % 9 === 4 : i % 9 !== 4 && i % 3 === g;
          if (mine) b.box(ledSize, ledSize, 0.01, 0xffffff, led.x, led.y - ledSize / 2, led.z, { r: 0 });
        });
      }),
      glowMat(g === 3 ? color : lighten(color, 0.2))
    );
    kit.add(mesh);
    return mesh;
  });

  // A steady, unhurried flicker: the rack is furniture, and shows nothing of how the company is doing.
  const load = 0.3;
  kit.onUpdate((_dt, elapsed) => {
    const rate = 1.5 + load * 9;
    groups.forEach((mesh, g) => {
      // Each group flickers on its own beat; busier racks blink faster and stay lit longer.
      const beat = Math.floor(elapsed * rate * (0.7 + g * 0.23) + g * 1.7);
      const lit = hash01(beat * 13 + g * 101) < 0.45 + load * 0.4;
      // The fourth group is the amber warnings: never lit on a rack at rest.
      mesh.visible = g !== 3 && (g === 0 || lit);
    });
  });

  return kit.finish(stationFootprint("servers", office), { kind: "servers" as const, office });
};

// ─────────────────────────────────────────────────────────────────────────────
// pricing — the price board: three cards on the wall, each with a coin more than the last
// ─────────────────────────────────────────────────────────────────────────────

export const createPricingBoard = (office: OfficeIndex = 2, look: LookId = "classic"): StationHandle => {
  const size = STATION_SIZES[phaseTier(office)].pricing;
  const tier = phaseTier(office);
  const theme = themeFor(office, look);
  const kit = new PropKit("station:pricing");
  const wall = wallFaceZ(size.depth);
  const boardW = size.width - 0.06;
  const boardH = 0.98;
  const boardY = 0.98;
  const boardZ = wall + 0.045;
  const gap = Math.min(0.07, boardW * 0.05);
  const cardW = (boardW - gap * 4) / 3;
  const cardHeights = [0.5, 0.64, 0.78];
  const cardColor = tier === 0 ? C.paper : tier === 4 ? C.marbleLight : C.white;
  const tierColors = [C.good, NEON, EMBER];
  const backing = [C.plywood, C.cream, C.greyLight, C.white, C.marble][tier];
  const cardX = (i: number): number => -boardW / 2 + gap + cardW / 2 + i * (cardW + gap);
  const coin = Math.min(0.075, cardW * 0.22);

  kit.model(`pricing:${look}:${office}`, (b) => {
    b.box(boardW, boardH, 0.04, backing, 0, boardY, wall + 0.02, { r: 0.012 });
    if (tier >= 2) {
      const rim = tier === 4 ? C.brass : tier === 3 ? C.chrome : theme.frame;
      b.box(boardW + 0.04, 0.035, 0.055, rim, 0, boardY + boardH - 0.015, wall + 0.027, { r: 0.01 });
      b.box(boardW + 0.04, 0.035, 0.055, rim, 0, boardY - 0.02, wall + 0.027, { r: 0.01 });
    }
    if (tier === 0) {
      // Nailed-up plank: two visible nail heads.
      for (const sx of [-1, 1]) b.cyl(0.014, 0.01, C.galvanised, sx * (boardW / 2 - 0.05), boardY + boardH - 0.07, wall + 0.04, { axis: "z", seg: 6 });
    }
  });

  // The three cards, as one model.
  kit.model(`pricing-cards:${look}:${office}`, (b) => {
    cardHeights.forEach((h, i) => {
      b.place(cardX(i), boardY + 0.07, boardZ, {}, () => {
        b.box(cardW, h, 0.03, cardColor, 0, 0, 0.015, { r: 0.012, rz: tier === 0 ? (i - 1) * 0.03 : 0 });
        b.box(cardW, 0.09, 0.034, tierColors[i], 0, h - 0.09, 0.017, { r: 0.012 });
        // One, two or three coins: no text needed.
        for (let k = 0; k <= i; k += 1) {
          const cx = (k - i / 2) * coin * 1.5;
          b.cyl(coin, 0.02, C.brass, cx, h * 0.42 - coin + (k % 2) * 0.02, 0.03, { axis: "z", seg: 12 });
          b.cyl(coin * 0.62, 0.006, lighten(C.brass, 0.3), cx, h * 0.42 - coin * 0.62 + (k % 2) * 0.02, 0.043, { axis: "z", seg: 10 });
        }
        // Feature lines.
        for (let line = 0; line <= i; line += 1) b.box(cardW * 0.6, 0.02, 0.006, tier === 4 ? C.marbleVein : C.grey, 0, 0.06 + line * 0.05, 0.031, { r: 0 });
      });
    });
  });

  return kit.finish(stationFootprint("pricing", office), { kind: "pricing" as const, office });
};

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export interface StationHandles {
  ship: ProductWallHandle;
  launch: GrowthCornerHandle;
  investors: InvestorLineHandle;
  boardroom: StationHandle;
  calendar: StationHandle;
  coffee: StationHandle;
  servers: StationHandle;
  pricing: StationHandle;
}

const STATION_FACTORIES: { [K in StationKind]: (office: OfficeIndex, look: LookId) => StationHandles[K] } = {
  ship: createProductWall,
  launch: createGrowthCorner,
  investors: createInvestorLine,
  boardroom: createBoardTable,
  calendar: createWallCalendar,
  coffee: createCoffeeMachine,
  servers: createServerRack,
  pricing: createPricingBoard,
};

/** Build the station of `kind` for an office in a look, with its specific handle type. */
export const createStation = <K extends StationKind>(kind: K, office: OfficeIndex, look: LookId = "classic"): StationHandles[K] =>
  STATION_FACTORIES[kind](office, look);
