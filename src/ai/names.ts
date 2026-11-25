// A new game's cast: the player's company plus three CPU startups with a made-up name and a
// one-line pitch each, drawn from the seed. The pitch hints at how the company will play.
// The pools and the draws live in src/engine/cast.ts, which a career's newcomers draw from too.

import { PITCHES, drawName, picker } from "../engine/cast";
import { STREAM, streamSeed } from "../engine/rng";
import type { CpuKind, GameSetup, SeatSetup } from "../engine/types";

export { PITCHES };

const CPU_KINDS: readonly CpuKind[] = ["blitzscaler", "bootstrapper", "incumbent"];
const DEFAULT_PLAYER_NAME = "Your Startup";

export const newGameSetup = (seed: number, playerName: string, playerController: "human" | "baseline" = "human"): GameSetup => {
  // Draws for a new game come from one stream, turn 0, so they never touch a turn's rolls.
  const pick = picker(streamSeed(seed, 0, STREAM.names));
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
    const name = drawName(pick, taken);
    taken.add(name.toLowerCase());
    const pitches = PITCHES[kind];
    seats.push({ controller: kind, archetype: kind === "incumbent" ? "incumbent" : "startup", name, pitch: pitches[pick(pitches.length - 1)] });
  }
  return { seats };
};
