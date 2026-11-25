import { describe, expect, it } from "vitest";
import { CAREER_PITCHES, PITCHES } from "../engine/cast";
import { newGameSetup } from "./names";

const FORBIDDEN = /\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i;

describe("a career's starting rivals", () => {
  it("never speak of quarters, in any line a career can draw", () => {
    for (const lines of Object.values(CAREER_PITCHES)) for (const line of lines) expect(line).not.toMatch(FORBIDDEN);
    for (let seed = 1; seed <= 300; seed++) {
      for (const seat of newGameSetup(seed, "Acme", "human", CAREER_PITCHES).seats) expect(seat.pitch, `seed ${seed}`).not.toMatch(FORBIDDEN);
    }
  });

  it("draw the race's names, from lists of the race's lengths", () => {
    for (const kind of Object.keys(PITCHES) as (keyof typeof PITCHES)[]) expect(CAREER_PITCHES[kind]).toHaveLength(PITCHES[kind].length);
    for (let seed = 1; seed <= 50; seed++) {
      const names = (pitches?: typeof PITCHES) => newGameSetup(seed, "Acme", "human", pitches).seats.map((seat) => seat.name);
      expect(names(CAREER_PITCHES)).toEqual(names());
    }
    expect(newGameSetup(3, "Acme")).toEqual(newGameSetup(3, "Acme", "human", PITCHES));
  });
});
