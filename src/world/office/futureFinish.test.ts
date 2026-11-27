import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { C, colorDistance, EMBER, fittingsFor, labOf, LOOKS, NEON, PHASE_THEMES, PHASES, themeFor } from "../core/palette";
import type { LookId } from "../types";
import { createDoor, createWall, wallColorFor, wallLookFor } from "./props/building";
import { STATION_KINDS } from "./footprints";
import { createCoffeeTable, createMeetingPod, createReceptionDesk, createStockTicker, createTrophyShelf } from "./props/decor";
import { createStation } from "./props/stations";
import { createChair, createDesk, DESK_STYLES, deskTopFor } from "./props/workstations";

/**
 * Design §10.2: the agents and ambient years (2027 on) are an invented future, and must read as the future in the
 * full floor and the campus too: light, non-wood finishes and a cool glow, not the walnut, brass and leather the
 * campus has in the years before.
 */
const FUTURE: readonly LookId[] = ["agents", "ambient"];
const PAST = LOOKS.filter((look) => !FUTURE.includes(look));
/** The woods and the warm old metal and leather of the campus. */
const WOODS = [C.plywood, C.birch, C.oak, C.walnut, C.walnutDark, C.pallet];
const OLD_FITTINGS = [C.walnut, C.walnutDark, C.brass, C.pallet, C.leather];
/** A colour distance (CIE 1976 ΔE) at which two finishes read as different materials at a glance. */
const AT_A_GLANCE = 12;
const hex = (n: number): string => `0x${n.toString(16).padStart(6, "0")}`;

/** How many corners of the meshes under `root` are painted exactly this colour. */
const painted = (root: THREE.Object3D, color: number): number => {
  let count = 0;
  const scratch = new THREE.Color();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const colour = mesh.isMesh ? mesh.geometry.getAttribute("color") : undefined;
    if (!colour) return;
    for (let i = 0; i < colour.count; i += 1) if (scratch.setRGB(colour.getX(i), colour.getY(i), colour.getZ(i)).getHex() === color) count += 1;
  });
  return count;
};
const oldFittingsIn = (root: THREE.Object3D): string[] => OLD_FITTINGS.filter((color) => painted(root, color) > 0).map(hex);

describe("the campus's wall panelling", () => {
  it("takes its colour from the look: in the campus it differs at a glance between every past era and each future era", () => {
    const close: string[] = [];
    for (const past of PAST) {
      for (const future of FUTURE) {
        const gap = colorDistance(wallColorFor(4, past), wallColorFor(4, future));
        if (gap < AT_A_GLANCE) close.push(`${past} vs ${future}: ΔE ${gap.toFixed(1)}`);
      }
    }
    expect(close).toEqual([]);
    // And not by paint alone: the panels under the paint are light and no wood, so the campus wall reads light.
    for (const future of FUTURE) {
      for (const wood of WOODS) expect(colorDistance(fittingsFor(future).panel, wood), `${future} panel vs ${hex(wood)}`).toBeGreaterThanOrEqual(AT_A_GLANCE);
      expect(labOf(wallColorFor(4, future))[0], `${future} campus wall ${hex(wallColorFor(4, future))}`).toBeGreaterThanOrEqual(78);
    }
  });

  it("keeps the walnut and brass of the classic and past looks exactly as it was", () => {
    const panels = Object.fromEntries(PAST.map((look) => { const w = wallLookFor("panel", look); return [look, [w.face, w.back, w.base, w.trim].map(hex).join(" ")]; }));
    expect(panels).toEqual({
      classic: "0x80523a 0x573829 0x383c47 0xd8ab4c",
      "dial-up": "0xb19372 0x8c775d 0x383c47 0xd8ab4c",
      "gold-rush": "0xb9914e 0x94753e 0x383c47 0xd8ab4c",
      bust: "0x97867e 0x766c68 0x383c47 0xd8ab4c",
      phones: "0x97969e 0x767982 0x383c47 0xd8ab4c",
      "cheap-money": "0xbd8268 0x966855 0x383c47 0xd8ab4c",
      "winter-ai": "0x91976e 0x717a59 0x383c47 0xd8ab4c",
    });
    expect(fittingsFor("classic")).toEqual({ panel: C.walnut, panelDark: C.walnutDark, casework: C.walnutDark, caseFront: C.walnut, metal: C.brass, upholstery: C.leather, legs: C.pallet });
    for (const look of PAST) expect(fittingsFor(look), look).toEqual(fittingsFor("classic"));
  });

  it("in a future era has no walnut or brass on the panelled wall, its windows or the campus's door", () => {
    for (const look of FUTURE) {
      expect(oldFittingsIn(createWall(6, { style: "panel", windows: 2, look }).group), `${look} wall`).toEqual([]);
      expect(oldFittingsIn(createDoor(4, look).group), `${look} door`).toEqual([]);
    }
    expect(painted(createWall(6, { style: "panel", windows: 2 }).group, C.brass)).toBeGreaterThan(0);
    expect(painted(createDoor(4).group, C.brass)).toBeGreaterThan(0);
  });
});

describe("the future's furniture", () => {
  it("has desks with no wood, brass or leather fittings, and desk tops that read as no wood, in every office", () => {
    for (const look of FUTURE) {
      for (const style of DESK_STYLES) {
        for (const occupied of [true, false]) {
          expect(oldFittingsIn(createDesk({ style, look, occupied }).group), `${look} ${style} desk${occupied ? "" : " (vacant)"}`).toEqual([]);
        }
        expect(oldFittingsIn(createChair({ style, look }).group), `${look} ${style} chair`).toEqual([]);
        const top = deskTopFor(style, look);
        for (const wood of WOODS) expect(colorDistance(top, wood), `${look} ${style} top ${hex(top)} vs ${hex(wood)}`).toBeGreaterThanOrEqual(AT_A_GLANCE);
      }
    }
  });

  it("keeps the executive desk's walnut and brass, and the executive chair's leather, in the classic and past looks", () => {
    for (const look of PAST) {
      const desk = createDesk({ style: "executive", look }).group;
      expect([C.walnut, C.walnutDark, C.brass].map((color) => painted(desk, color) > 0), look).toEqual([true, true, true]);
      expect(painted(createChair({ style: "executive", look }).group, C.leather), look).toBeGreaterThan(0);
    }
  });

  it("keeps the past looks' desk tops exactly as they were", () => {
    const tops = Object.fromEntries(PAST.map((look) => [look, DESK_STYLES.map((style) => hex(deskTopFor(style, look))).join(" ")]));
    expect(tops).toEqual({
      classic: "0xdcb785 0xecd5ae 0xf6f2e9 0xcf9e66 0x80523a",
      "dial-up": "0xd9c5a3 0xdeceaf 0xe1d7c1 0xd5be9a 0xbea78d",
      "gold-rush": "0xc07452 0xc57d5e 0xc88670 0xbc6c49 0xa4563b",
      bust: "0xb7aea2 0xbcb7ae 0xbfc0c0 0xb3a698 0x9b908b",
      phones: "0xf1e7d8 0xf6f0e5 0xf9f8f6 0xeddfcf 0xd5c8c2",
      "cheap-money": "0xa37652 0xa77f5e 0xaa8870 0x9f6e49 0x87583b",
      "winter-ai": "0xcacda7 0xcfd6b4 0xd2dec5 0xc6c59e 0xaeae91",
    });
  });
});

describe("the future's campus", () => {
  it("has stations, a reception, a meeting pod, a coffee table, a ticker and a trophy case with no walnut, brass or leather", () => {
    for (const look of FUTURE) {
      for (const office of [3, 4] as const) {
        for (const kind of STATION_KINDS) expect(oldFittingsIn(createStation(kind, office, look).group), `${look} office ${office} ${kind}`).toEqual([]);
        expect(oldFittingsIn(createReceptionDesk(office, look).group), `${look} office ${office} reception`).toEqual([]);
        expect(oldFittingsIn(createMeetingPod(office, look).group), `${look} office ${office} meeting pod`).toEqual([]);
        expect(oldFittingsIn(createCoffeeTable(office, look).group), `${look} office ${office} coffee table`).toEqual([]);
      }
      expect(oldFittingsIn(createStockTicker({ look }).group), `${look} ticker`).toEqual([]);
      // The trophies stay gold; their case is no walnut.
      const shelf = createTrophyShelf({ look }).group;
      expect([C.walnut, C.walnutDark].map((color) => painted(shelf, color)), `${look} trophy case`).toEqual([0, 0]);
    }
  });

  it("keeps the campus's brass in the classic look", () => {
    expect(painted(createStation("boardroom", 4).group, C.walnut)).toBeGreaterThan(0);
    expect(painted(createReceptionDesk(4).group, C.brass)).toBeGreaterThan(0);
    expect(painted(createStockTicker().group, C.brass)).toBeGreaterThan(0);
    expect(painted(createTrophyShelf().group, C.walnut)).toBeGreaterThan(0);
  });
});

describe("the future's themes", () => {
  it("glow cool in every office, with no wood tones and no brass or copper frames", () => {
    for (const look of FUTURE) {
      for (const office of PHASES) {
        const theme = themeFor(office, look);
        expect(theme.glow, `${look} office ${office}`).toBe(NEON);
        expect([C.brass, C.copper], `${look} office ${office}`).not.toContain(theme.frame);
        expect(theme.accents, `${look} office ${office}`).not.toContain(C.brass);
        for (const finish of [theme.wood, theme.woodDark]) {
          for (const wood of WOODS) expect(colorDistance(finish, wood), `${look} office ${office} ${hex(finish)} vs ${hex(wood)}`).toBeGreaterThanOrEqual(AT_A_GLANCE);
        }
      }
    }
  });

  it("leave the classic and past themes exactly as they were", () => {
    const pinned = Object.fromEntries(
      PAST.map((look) => [look, PHASE_THEMES[look].map((t) => [t.wood, t.woodDark, t.frame, t.panel, ...t.accents, t.glow].map((n) => n.toString(16).padStart(6, "0")).join(" "))])
    );
    expect(pinned).toEqual({
      classic: ["dcb785 b78f5f b0b6bb caa675 e4574a f4c544 4f8fdc f59e0b", "ecd5ae cf9e66 f6f2e9 f0e6d2 36b3a6 f4c544 f2795d 7dd3fc", "cf9e66 80523a 8d98a5 cdd2d8 4f8fdc 36b3a6 f28a3c 7dd3fc", "ecd5ae cf9e66 f6f2e9 f6f2e9 8b70d6 4fa16b f28db2 7dd3fc", "80523a 573829 d8ab4c 383c47 7c2a35 303f5e d8ab4c f59e0b"],
      "dial-up": ["b78f5f ad8959 9aa3ad e3d8c4 36b3a6 8b70d6 f4c544 f59e0b", "cf9e66 b78f5f 9aa3ad f0e6d2 303f5e 36b3a6 f2795d f59e0b", "cf9e66 80523a 5d6773 e3d8c4 7c2a35 36b3a6 f4c544 7dd3fc", "ecd5ae cf9e66 9aa3ad f0e6d2 303f5e 7c2a35 36b3a6 7dd3fc", "80523a 573829 d8ab4c e3d8c4 303f5e 7c2a35 5fb46b f59e0b"],
      "gold-rush": ["b78f5f ad8959 9aa3ad e3d8c4 e4574a f4c544 4f8fdc f59e0b", "cf9e66 b78f5f 9aa3ad f0e6d2 4f8fdc e4574a f4c544 f59e0b", "cf9e66 80523a 5d6773 e3d8c4 f4c544 4f8fdc e4574a 7dd3fc", "ecd5ae cf9e66 9aa3ad f0e6d2 e4574a 4f8fdc 5fb46b 7dd3fc", "80523a 573829 d8ab4c e3d8c4 4f8fdc f4c544 e4574a f59e0b"],
      bust: ["ecd5ae dcb785 8d98a5 cdd2d8 f28a3c 4f8fdc 4fa16b 7dd3fc", "dcb785 cf9e66 8d98a5 f6f2e9 f28a3c 80ca7c 4f8fdc 7dd3fc", "ecd5ae cf9e66 8d98a5 f6f2e9 4f8fdc f28a3c 80ca7c 7dd3fc", "cf9e66 80523a d5dce4 cdd2d8 4f8fdc f28db2 f28a3c 7dd3fc", "cf9e66 80523a 8d98a5 363c45 f28a3c 4f8fdc d5dce4 7dd3fc"],
      phones: ["ecd5ae dcb785 c0c6cf f6f2e9 4f8fdc c0c6cf 20242a 7dd3fc", "dcb785 ecd5ae c0c6cf f6f2e9 20242a 4f8fdc c0c6cf 7dd3fc", "ecd5ae cf9e66 d5dce4 f6f2e9 c0c6cf 4f8fdc 20242a 7dd3fc", "ecd5ae cf9e66 d5dce4 fbf9f1 4f8fdc 20242a f28db2 7dd3fc", "cf9e66 80523a c0c6cf f6f2e9 20242a c0c6cf 4f8fdc 7dd3fc"],
      "cheap-money": ["cf9e66 80523a 20242a f0e6d2 f2795d f4c544 36b3a6 f59e0b", "cf9e66 80523a c67a4a f0e6d2 f2795d 36b3a6 f4c544 7dd3fc", "80523a 573829 20242a f0e6d2 f2795d 4fa16b f4c544 7dd3fc", "cf9e66 80523a c67a4a e3d8c4 f2795d 303f5e 80ca7c 7dd3fc", "80523a 573829 d8ab4c f0e6d2 f2795d 7c2a35 4fa16b f59e0b"],
      "winter-ai": ["ecd5ae dcb785 f6f2e9 e3d8c4 4fa16b 36b3a6 f4c544 7dd3fc", "ecd5ae cf9e66 363c45 f6f2e9 4fa16b 36b3a6 f2795d 7dd3fc", "ecd5ae cf9e66 f6f2e9 cdd2d8 36b3a6 4fa16b f28db2 7dd3fc", "dcb785 cf9e66 f6f2e9 f6f2e9 2f7e56 36b3a6 f4c544 7dd3fc", "cf9e66 80523a 20242a f6f2e9 4fa16b 36b3a6 d8ab4c f59e0b"],
    });
    expect(EMBER).toBe(0xf59e0b);
  });
});
