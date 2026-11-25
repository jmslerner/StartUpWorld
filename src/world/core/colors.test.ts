import { describe, expect, it } from "vitest";
import { TEAMS } from "../types";
import type { OfficeIndex } from "../types";
import { C, LOOKS, lookFor, PHASE_THEMES, PHASES, phaseTier, ROLE_COLORS, themeFor } from "./colors";

describe("looks", () => {
  it("every era has a look", () => {
    expect(["dial-up", "ambient", "anything"].map(lookFor)).toEqual(["classic", "classic", "classic"]);
  });

  it("an era nobody has heard of, or none at all, still has one", () => {
    expect(["flat", "", "constructor", "__proto__", "classic"].map(lookFor)).toEqual(Array(5).fill("classic"));
    for (const era of ["flat", ""]) expect(LOOKS).toContain(lookFor(era));
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
