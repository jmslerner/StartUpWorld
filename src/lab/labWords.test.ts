import { describe, expect, it } from "vitest";
import type { OfficeIndex } from "../world/types/scene";
import { DESKS } from "../world/office/layouts";
import type { LabStats } from "./lab";
import { figureLines, headCountLine, LAB_WORDS, OFFICE_NAMES, officeChoice } from "./labWords";

const stats = (over: Partial<LabStats> = {}): LabStats => ({
  drawCalls: 630, triangles: 123456, geometries: 9, textures: 4, figures: 50, hidden: 100, framesDrawn: 77, framesLastSecond: 0, status: "running", ...over,
});

describe("the lab's words", () => {
  it("has a plain word for everything, and no word twice", () => {
    const words = [...Object.values(LAB_WORDS), ...OFFICE_NAMES];
    for (const word of words) expect(word.trim().length).toBeGreaterThan(2);
    expect(new Set(words).size).toBe(words.length);
  });

  it("names every office the world can draw", () => {
    expect(OFFICE_NAMES).toHaveLength(DESKS.length);
    expect(([0, 1, 2, 3, 4] as OfficeIndex[]).map(officeChoice)).toEqual([
      "Garage (holds 4)",
      "Shared office (holds 9)",
      "Own office (holds 22)",
      "Full floor (holds 40)",
      "Campus (holds 150)",
    ]);
  });

  it("counts heads in plain words", () => {
    expect(headCountLine(24, 22)).toBe("24 people. This office holds 22.");
    expect(headCountLine(1, 4)).toBe("1 person. This office holds 4.");
    expect(headCountLine(0, 4)).toBe("0 people. This office holds 4.");
  });

  it("writes the renderer's figures, one to a line", () => {
    expect(figureLines(stats())).toEqual([
      "View: running",
      "Draw calls: 630",
      "Triangles: 123,456",
      "People drawn: 50",
      "People on the sign: 100",
      "Frames in the last second: 0",
    ]);
  });

  it("says in words how the view stands", () => {
    const said = (["starting", "running", "unsupported", "context-lost", "off", "failed"] as const).map((status) => figureLines(stats({ status }))[0]);
    expect(said).toEqual([
      "View: opening",
      "View: running",
      "View: cannot be shown on this device",
      "View: stopped drawing",
      "View: switched off",
      "View: failed",
    ]);
  });
});
