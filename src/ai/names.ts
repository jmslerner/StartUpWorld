// A new game's cast: the player's company plus three CPU startups with a made-up name and a
// one-line pitch each, drawn from the seed. The pitch hints at how the company will play.

import { STREAM, nextIntInclusive, streamSeed } from "../engine/rng";
import type { CpuKind, GameSetup, SeatSetup } from "../engine/types";

const NAME_STARTS = ["Zorb", "Flim", "Quib", "Snaz", "Wobb", "Plonk", "Yonk", "Blip", "Fizz", "Mork", "Glim", "Vroom", "Snerk", "Twonk", "Dabb", "Krill"];
const NAME_ENDS = ["ly", "ify", "io", "ster", "hub", "eroo", "ology", "tastic", "base", "nest", "wise", "loop"];

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

const CPU_KINDS: readonly CpuKind[] = ["blitzscaler", "bootstrapper", "incumbent"];
const DEFAULT_PLAYER_NAME = "Your Startup";

/** Draws for a new game come from one stream, turn 0, so they never touch a turn's rolls. */
const drawer = (seed: number) => {
  let state = streamSeed(seed, 0, STREAM.names);
  return (max: number): number => {
    const draw = nextIntInclusive(state, 0, max);
    state = draw.rng;
    return draw.value;
  };
};

export const newGameSetup = (seed: number, playerName: string, playerController: "human" | "baseline" = "human"): GameSetup => {
  const pick = drawer(seed);
  const player = playerName.trim() || DEFAULT_PLAYER_NAME;

  // Shuffle the seating so a rival's position on screen says nothing about its kind.
  const kinds = [...CPU_KINDS];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = pick(i);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }

  const taken = new Set([player.toLowerCase()]);
  const seats: SeatSetup[] = [{ controller: playerController, archetype: "startup", name: player, pitch: "Your startup." }];
  for (const kind of kinds) {
    let name = "";
    do {
      name = NAME_STARTS[pick(NAME_STARTS.length - 1)] + NAME_ENDS[pick(NAME_ENDS.length - 1)];
    } while (taken.has(name.toLowerCase()));
    taken.add(name.toLowerCase());
    const pitches = PITCHES[kind];
    seats.push({ controller: kind, archetype: kind === "incumbent" ? "incumbent" : "startup", name, pitch: pitches[pick(pitches.length - 1)] });
  }
  return { seats };
};
