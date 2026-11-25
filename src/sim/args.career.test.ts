import { expect, it } from "vitest";
import { parseSimArgs } from "./args";

it("mode=career asks for the career", () => {
  expect(parseSimArgs(["mode=career", "games=50"])).toEqual({ games: 50, seed: null, strict: false, overrides: {}, mode: "career" });
});

it("the race is the default, and says nothing about a mode", () => {
  expect("mode" in parseSimArgs([])).toBe(false);
  expect("mode" in parseSimArgs(["mode=race"])).toBe(false);
});

it("any other mode is an error", () => {
  expect(() => parseSimArgs(["mode=campaign"])).toThrow("mode=campaign is not a mode: use mode=race or mode=career");
});
