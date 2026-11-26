import { describe, expect, it, vi } from "vitest";
import type { BeatKind } from "../scene/yearPlayback";
import type { StageStatus } from "../world/ui/stage";
import {
  OFFICE_WORDS,
  availabilityOf,
  beatLine,
  canDrawOffice,
  canPlayOut,
  canSwitch,
  firstAvailability,
  nextAvailability,
  officeCellHeight,
  officeLayoutFor,
  playingLine,
  readOfficePreference,
  reloadOffered,
  writeOfficePreference,
} from "./officeView";
import type { OfficeAvailability } from "./officeView";

const storage = (value: string | null) => ({ getItem: () => value, setItem: vi.fn() });
const AVAILABILITIES = ["unknown", "running", "context-lost", "unsupported", "failed"] as const;

describe("officeView", () => {
  it("the switch is on unless it was turned off, and blocked storage reads as on (Review Focus 5)", () => {
    expect([readOfficePreference(storage(null)), readOfficePreference(storage("on")), readOfficePreference(storage("off")), readOfficePreference(null)]).toEqual([true, true, false, true]);
    expect(readOfficePreference({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
  });
  it("writes its own key, and a full disk throws nothing (Review Focus 5)", () => {
    const s = storage(null); writeOfficePreference(s, false); expect(s.setItem).toHaveBeenCalledWith("startupworld:office:v1", "off");
    expect(() => writeOfficePreference({ setItem: () => { throw new Error("full"); } }, true)).not.toThrow();
  });
  it("3D only in a career, switched on, in a desktop window, on a device drawing it (Review Focus 2)", () => {
    const at = (career: boolean, preference: boolean, availability: OfficeAvailability, wide = true) => officeLayoutFor({ career, preference, availability, wide });
    expect(at(false, true, "running")).toBe("2d");
    expect(at(true, false, "running")).toBe("2d");
    expect(at(true, true, "running", false)).toBe("2d");
    expect(AVAILABILITIES.map((a) => at(true, true, a))).toEqual(["3d", "3d", "2d", "2d", "2d"]);
  });
  it("once lost, the office stays lost: the 'starting' of an unmount is not news (Review Focus 2)", () => {
    const run = (statuses: StageStatus[], from: OfficeAvailability = "unknown") => statuses.reduce(nextAvailability, from);
    expect(run(["starting", "unsupported", "starting"])).toBe("unsupported");
    expect(run(["starting", "running", "context-lost", "starting", "running"])).toBe("context-lost");
    expect(run(["starting", "running"], "failed")).toBe("failed");
    expect(run(["starting", "running", "starting"])).toBe("unknown");
    expect(run(["running"], "unknown")).toBe("running");
  });
  it("a device without WebGL 2 starts in 2D, before anything is loaded; a probe that throws says no", () => {
    const canvas = (gl: unknown) => () => ({ getContext: () => gl });
    const lose = vi.fn();
    expect(canDrawOffice(canvas({ getExtension: () => ({ loseContext: lose }) }))).toBe(true);
    expect(lose).toHaveBeenCalledTimes(1);
    expect(canDrawOffice(canvas(null))).toBe(false);
    expect(canDrawOffice(() => null)).toBe(false);
    expect(canDrawOffice(() => { throw new Error("no canvas"); })).toBe(false);
    expect([firstAvailability(true), firstAvailability(false)]).toEqual(["unknown", "unsupported"]);
  });
  it("a year plays out only in a running 3D office, and never under reduced motion", () => {
    expect(canPlayOut({ layout: "3d", availability: "running", reducedMotion: false })).toBe(true);
    for (const input of [{ layout: "2d" as const, availability: "running" as const, reducedMotion: false },
      { layout: "3d" as const, availability: "context-lost" as const, reducedMotion: false }, { layout: "3d" as const, availability: "unknown" as const, reducedMotion: false },
      { layout: "3d" as const, availability: "running" as const, reducedMotion: true }]) expect(canPlayOut(input)).toBe(false);
  });
  it("the switch is offered unless the device or the window cannot draw the office; a lost one offers a reload", () => {
    expect(AVAILABILITIES.map((a) => canSwitch(a, true))).toEqual([true, true, true, false, false]);
    expect(AVAILABILITIES.map((a) => canSwitch(a, false))).toEqual([false, false, false, false, false]);
    expect(AVAILABILITIES.map(reloadOffered)).toEqual([false, false, true, false, false]);
    expect((["starting", "running", "context-lost", "unsupported"] as const).map(availabilityOf)).toEqual(["unknown", "running", "context-lost", "unsupported"]);
  });
  it("the office ends above the bottom bar, and is never smaller than 360 px", () => {
    expect(officeCellHeight({ viewport: 800, top: 150, bar: 60 })).toBe(578);
    expect(officeCellHeight({ viewport: 600, top: 300, bar: 60 })).toBe(360);
  });
  it("says each beat in plain words", () => {
    const names = ["Garage", "Shared office", "Own office", "Full floor", "Campus"];  const beat = (kind: BeatKind, count: number, office: number | null = null) => beatLine({ kind, seconds: 1, count, office }, names);
    expect([beat("leave", 1), beat("leave", 3), beat("arrive", 1), beat("arrive", 4), beat("move", 0, 1), beat("year", 0)]).toEqual(
      ["One person leaves", "3 people leave", "One hire walks in", "4 hires walk in", "The company moves to a bigger place: Shared office", "A quiet year"]);
    expect(beat("move", 0, 7)).toBe("The company moves to a bigger place");   // an office with no name given
    expect(playingLine(1994)).toBe("1994 plays out");
  });
  it("no word of the office is a period word of the race", () => {
    const names = ["Garage", "Shared office", "Own office", "Full floor", "Campus"];
    const beats = (["leave", "move", "arrive", "year"] as const).flatMap((kind) =>
      [0, 1, 2, 4].map((n) => beatLine({ kind, seconds: 1, count: kind === "move" ? 0 : n, office: kind === "move" ? n : null }, names)));
    const text = [...Object.values(OFFICE_WORDS), playingLine(1990), ...beats].join("\n");
    expect(text).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i);
  });
});
