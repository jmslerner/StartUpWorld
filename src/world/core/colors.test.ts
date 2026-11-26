import { describe, expect, it } from "vitest";
import { TEAMS } from "../types";
import type { OfficeIndex } from "../types";
import { C, EMBER, FURNITURE_SETS, furnitureOf, LOOKS, lookFor, NEON, PHASE_THEMES, PHASES, phaseTier, ROLE_COLORS, themeFor } from "./colors";

const ERAS = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"] as const;

describe("looks", () => {
  it("each era of the career has a look of its own", () => {
    expect(ERAS.map(lookFor)).toEqual([...ERAS]);
    expect(LOOKS).toEqual(["classic", ...ERAS]);
  });
  it("an era nobody has heard of keeps the classic look", () => {
    expect(["flat", "", "constructor", "__proto__", "classic", "nineties"].map(lookFor)).toEqual(Array(6).fill("classic"));
  });
  it("eight looks sit on four furniture sets, the decade's, the invented future on its own", () => {
    expect(ERAS.map(furnitureOf)).toEqual(["nineties", "nineties", "noughties", "noughties", "noughties", "twenties", "future", "future"]);
    expect(furnitureOf("classic")).toBe("classic");
    expect(FURNITURE_SETS).toEqual(["classic", "nineties", "noughties", "twenties", "future"]);
  });
  it("every look has five themes, and no two looks dress the same office alike", () => {
    for (const office of PHASES) {
      const keys = LOOKS.map((look) => { const t = themeFor(office, look); return `${t.wood}:${t.panel}:${t.accents.join(",")}`; });
      expect(new Set(keys).size).toBe(LOOKS.length);
    }
  });
  it("the classic themes are as they were", () => {
    expect(PHASE_THEMES.classic).toEqual([
      { wood: C.plywood, woodDark: C.pallet, frame: C.galvanised, panel: C.cardboard, accents: [C.red, C.yellow, C.blue], glow: EMBER },
      { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.cream, accents: [C.teal, C.yellow, C.coral], glow: NEON },
      { wood: C.oak, woodDark: C.walnut, frame: C.steel, panel: C.greyLight, accents: [C.blue, C.teal, C.orange], glow: NEON },
      { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.white, accents: [C.purple, C.leaf, C.pink], glow: NEON },
      { wood: C.walnut, woodDark: C.walnutDark, frame: C.brass, panel: C.marble, accents: [C.burgundy, C.navy, C.brass], glow: EMBER },
    ]);
  });
});

describe("team colours", () => {
  it("each team has its own colour", () => {
    expect(new Set(TEAMS.map((team) => ROLE_COLORS[team])).size).toBe(3);
  });

  it("has a colour for the three teams and nobody else", () => {
    expect(Object.keys(ROLE_COLORS).sort()).toEqual([...TEAMS].sort());
    for (const team of TEAMS) {
      expect(Number.isInteger(ROLE_COLORS[team])).toBe(true);
      expect(ROLE_COLORS[team]).toBeGreaterThanOrEqual(0);
      expect(ROLE_COLORS[team]).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe("office themes", () => {
  it("every look has a theme for each of the five offices", () => {
    expect(PHASES).toEqual([0, 1, 2, 3, 4]);
    for (const look of LOOKS) {
      expect(PHASE_THEMES[look]).toHaveLength(PHASES.length);
      for (const office of PHASES) {
        const theme = themeFor(office, look);
        expect(theme).toBe(PHASE_THEMES[look][office]);
        expect(theme.accents).toHaveLength(3);
      }
      // No two offices of a look are finished alike.
      expect(new Set(PHASES.map((office) => JSON.stringify(themeFor(office, look)))).size).toBe(PHASES.length);
    }
  });

  it("the classic look is the old polish for each size of office: plywood in the garage, walnut and brass on the campus", () => {
    expect(themeFor(0, "classic")).toMatchObject({ wood: C.plywood, panel: C.cardboard });
    expect(themeFor(4, "classic")).toMatchObject({ wood: C.walnut, frame: C.brass });
  });

  it("an office out of range is dressed as the garage", () => {
    for (const odd of [9, -1, 2.5, Number.NaN]) {
      expect(themeFor(odd as OfficeIndex, "classic")).toBe(themeFor(0, "classic"));
      expect(phaseTier(odd as OfficeIndex)).toBe(0);
    }
    expect(PHASES.map(phaseTier)).toEqual([0, 1, 2, 3, 4]);
  });
});
