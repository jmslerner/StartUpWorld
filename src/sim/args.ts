// What `npm run sim` was asked to do. Anything it does not understand is an error: a mistyped
// argument that is quietly ignored gives a report for a run nobody asked for.

export interface SimArgs {
  /** Games to play; null = the config's own batch size. */
  readonly games: number | null;
  /** Seed of the first game; null = the config's own. */
  readonly seed: number | null;
  /** Exit with an error when a balance target fails. */
  readonly strict: boolean;
  /** Config numbers changed for this run only, by dotted path. */
  readonly overrides: Readonly<Record<string, number | string>>;
  /** Play careers instead of races. Present only for mode=career: the race's arguments have no such key. */
  readonly mode?: "career";
}

export const USAGE = "Usage: npm run sim -- [mode=race|mode=career] [games=1000] [seed=1] [set=path=value ...] [strict=1]";

const YES = ["1", "true", "yes"];
const NO = ["0", "false", "no"];

const wholeNumber = (name: string, text: string, min: number): number => {
  const value = text.trim() === "" ? Number.NaN : Number(text);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name}=${text} is not a whole number${min > 0 ? ` of ${min} or more` : ""}`);
  return value;
};

export const parseSimArgs = (argv: readonly string[]): SimArgs => {
  let games: number | null = null;
  let seed: number | null = null;
  let strict = false;
  let career = false;
  const overrides: Record<string, number | string> = {};

  for (const arg of argv) {
    const cut = arg.indexOf("=");
    const key = cut === -1 ? arg : arg.slice(0, cut);
    const value = cut === -1 ? null : arg.slice(cut + 1);
    if (key === "games" && value !== null) {
      games = wholeNumber("games", value, 1);
    } else if (key === "seed" && value !== null) {
      seed = wholeNumber("seed", value, 0);
    } else if (key === "strict") {
      if (value !== null && !YES.includes(value) && !NO.includes(value)) throw new Error(`strict=${value} is neither yes nor no: use strict=1 or strict=0`);
      strict = value === null || YES.includes(value);
    } else if (key === "mode" && value !== null) {
      if (value !== "race" && value !== "career") throw new Error(`mode=${value} is not a mode: use mode=race or mode=career`);
      career = value === "career";
    } else if (key === "set" && value !== null) {
      const at = value.indexOf("=");
      const path = at === -1 ? "" : value.slice(0, at);
      const text = at === -1 ? "" : value.slice(at + 1);
      if (path === "" || text === "") throw new Error(`${arg} should read set=path=value, for example set=ipo.users=300000`);
      overrides[path] = Number.isFinite(Number(text)) ? Number(text) : text;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return career ? { games, seed, strict, overrides, mode: "career" } : { games, seed, strict, overrides };
};
