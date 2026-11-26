import { describe, expect, it } from "vitest";
import { digitSegments } from "./digits";

describe("digitSegments", () => {
  it("draws the ten digits on seven segments", () => {
    const lit = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => digitSegments(d).filter(Boolean).length);
    expect(lit).toEqual([6, 2, 5, 5, 4, 5, 6, 3, 7, 6]);
    expect(digitSegments(1)).toEqual([false, true, true, false, false, false, false]);
  });

  it("draws nothing for what is not a digit", () => {
    for (const d of [-1, 10, 1.5, Number.NaN]) expect(digitSegments(d)).toEqual([]);
  });
});
