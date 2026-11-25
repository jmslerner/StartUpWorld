import { describe, expect, it } from "vitest";
import { parseSimArgs } from "./args";

describe("the simulator's arguments", () => {
  it("default to the config's batch, not strict, nothing overridden", () => {
    expect(parseSimArgs([])).toEqual({ games: null, seed: null, strict: false, overrides: {} });
  });

  it("read the batch size, the first seed and any number of overrides", () => {
    expect(parseSimArgs(["games=200", "seed=5001", "set=ipo.users=300000", "set=baseline.price=budget", "set=churn.base=0.1"])).toEqual({
      games: 200,
      seed: 5001,
      strict: false,
      overrides: { "ipo.users": 300_000, "baseline.price": "budget", "churn.base": 0.1 },
    });
  });

  it("take strict as 1, true or yes, and 0, false or no", () => {
    for (const on of ["strict=1", "strict=true", "strict=yes", "strict"]) expect(parseSimArgs([on]).strict, on).toBe(true);
    for (const off of ["strict=0", "strict=false", "strict=no"]) expect(parseSimArgs([off]).strict, off).toBe(false);
    expect(() => parseSimArgs(["strict=maybe"])).toThrow(/strict=maybe/);
  });

  it("refuse an argument they do not know, rather than run without it", () => {
    expect(() => parseSimArgs(["gmaes=200"])).toThrow(/Unknown argument: gmaes=200/);
    expect(() => parseSimArgs(["--games", "200"])).toThrow(/Unknown argument: --games/);
    expect(() => parseSimArgs(["ipo.users=300000"])).toThrow(/Unknown argument: ipo\.users=300000/);
  });

  it("refuse a batch size or a seed that is not a whole number", () => {
    for (const bad of ["games=0", "games=-5", "games=2.5", "games=many", "games=", "seed=1.5", "seed=abc", "seed="]) {
      expect(() => parseSimArgs([bad]), bad).toThrow(new RegExp(bad.split("=")[0]));
    }
    expect(parseSimArgs(["seed=0"]).seed).toBe(0);
  });

  it("refuse an override without a path or without a value", () => {
    for (const bad of ["set=", "set=ipo.users", "set=ipo.users=", "set==5"]) expect(() => parseSimArgs([bad]), bad).toThrow(/set=path=value/);
  });
});
