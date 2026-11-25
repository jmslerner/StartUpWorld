// The companies' names and pitches, and the draws that pick them: the race's cast at the start of a game
// (src/ai/names.ts), and in a career the newcomer that takes a seat a rival left. Every draw comes from one stream.

import { STREAM, nextIntInclusive, streamSeed } from "./rng";
import type { CareerRules, CompanyId, CpuKind, SeatSetup } from "./types";

export const NAME_STARTS: readonly string[] = ["Zorb", "Flim", "Quib", "Snaz", "Wobb", "Plonk", "Yonk", "Blip", "Fizz", "Mork", "Glim", "Vroom", "Snerk", "Twonk", "Dabb", "Krill"];
export const NAME_ENDS: readonly string[] = ["ly", "ify", "io", "ster", "hub", "eroo", "ology", "tastic", "base", "nest", "wise", "loop"];

/** A rival's line at the start of a race. The pitch hints at how the company will play. */
export const PITCHES: Readonly<Record<CpuKind, readonly string[]>> = {
  blitzscaler: [
    "Growth first. Everything else is a rounding error.",
    "Land every user before anyone else wakes up.",
    "We'll figure out the business model at a billion users.",
    "Cheaper than free, louder than everyone.",
    "Our burn rate is a feature.",
    "If you're not on a billboard, do you even exist?",
  ],
  bootstrapper: [
    "Profitable by design. No pitch deck required.",
    "A small team, a product people pay for.",
    "We answer to customers, not a cap table.",
    "Built slowly, built to last.",
    "Premium software for people who read the manual.",
    "No growth hacks. Just a better product.",
  ],
  incumbent: [
    "The name you already know.",
    "Trusted by ten thousand users since before you launched.",
    "Why switch? We'll have that feature next quarter.",
    "The safe choice, now with more engineers.",
    "We were here first, and we hire fast.",
    "Established. Funded. Watching you closely.",
  ],
};

/** A career's starting rivals' lines: the race's lists, but for the lines that speak of quarters. Same lengths, so the
 *  draws, and every name, are the race's. */
export const CAREER_PITCHES: Readonly<Record<CpuKind, readonly string[]>> = {
  ...PITCHES,
  incumbent: PITCHES.incumbent.map((line) =>
    line === "Why switch? We'll have that feature next quarter." ? "Why switch? We'll have that feature by next year." : line,
  ),
};

/** A newcomer's line: it hints at how the company will play, and claims no age, size or users, since it has none. */
export const ENTRANT_PITCHES: Readonly<Record<CpuKind, readonly string[]>> = {
  blitzscaler: [
    "Growth first. Everything else is a rounding error.",
    "Cheaper than free, louder than everyone.",
    "Our burn rate is a feature.",
    "New in town, and in a hurry.",
    "Move fast. Then move faster.",
  ],
  bootstrapper: [
    "Profitable by design. No pitch deck required.",
    "We answer to customers, not a cap table.",
    "Built slowly, built to last.",
    "Premium software for people who read the manual.",
    "No growth hacks. Just a better product.",
  ],
  incumbent: [
    "Patient money, careful hiring, no surprises.",
    "We hire first and ship when it's right.",
    "The safe choice from day one.",
    "Steady hands for an unsteady market.",
    "Why rush? We plan to be around for a while.",
  ],
};

/** Successive whole numbers from 0 to `max`, all from the one stream that starts at `streamSeed`. */
export const picker = (streamSeed: number): ((max: number) => number) => {
  let state = streamSeed;
  return (max: number): number => {
    const draw = nextIntInclusive(state, 0, max);
    state = draw.rng;
    return draw.value;
  };
};

/** A made-up name, a start then an end, drawn again while it is taken. `taken` holds lower-cased names. */
export const drawName = (pick: (max: number) => number, taken: ReadonlySet<string>): string => {
  let name = "";
  do {
    name = NAME_STARTS[pick(NAME_STARTS.length - 1)] + NAME_ENDS[pick(NAME_ENDS.length - 1)];
  } while (taken.has(name.toLowerCase()));
  return name;
};

/**
 * The newcomer that takes a seat for a turn: its style (one of `replacement.styles`), then its name, then its pitch,
 * drawn in that order from the seat's own stream. Whatever style it plays, it is a startup.
 */
export const drawEntrant = (seed: number, turn: number, seat: CompanyId, taken: ReadonlySet<string>, career: CareerRules): SeatSetup => {
  const pick = picker(streamSeed(seed, turn, STREAM.entrant, seat));
  const styles = career.replacement.styles;
  const style = styles[pick(styles.length - 1)];
  const name = drawName(pick, taken);
  const pitches = ENTRANT_PITCHES[style];
  return { controller: style, archetype: "startup", name, pitch: pitches[pick(pitches.length - 1)] };
};
