// Guards the race: whole games, played by the baseline bot against the three CPUs, are reduced to a short
// digest of their final state and every turn's log, so a change of one character anywhere fails the test.
// The career mode is built on the same engine and must never alter the race.
// To re-record on purpose (only when the race is meant to change): run this file, copy the digests the failure
// prints into the two constants below, and say why in the commit.

import { describe, expect, it } from "vitest";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CONFIG, type GameConfig } from "../config";
import { DESIGN } from "../config.design";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { TurnLog } from "../engine/types";

const RECORDED_CONFIG = ["352881c9", "7bec6bdc", "5361e1ca", "49e5b4b7", "c918f955", "28c8c4d6", "a8654ef9", "84221d88", "fee41339", "19aaf6f6", "2e6ecfda", "07fb5228"];
const RECORDED_DESIGN = ["5e71db35", "c13dd7cc", "7980b414", "4afc7c73", "f0be30d7", "606a138d", "15b947c1", "80464405", "0785a93a", "32fe095e", "b35ec94d", "65e68daf"];

const digest = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

const play = (seed: number, config: GameConfig): string => {
  let state = createGame(newGameSetup(seed, "Golden", "baseline"), config);
  const logs: TurnLog[] = [];
  while (state.outcome === null) {
    const result = resolveTurn(state, choosePlans(state, seed, config), seed, config);
    logs.push(result.log);
    state = result.state;
  }
  return digest(JSON.stringify({ state, logs }));
};

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe("the race, as recorded before the career was built", () => {
  it("plays seeds 1 to 12 exactly as before on the shipped numbers", () => {
    expect(SEEDS.map((seed) => play(seed, CONFIG))).toEqual(RECORDED_CONFIG);
  });

  it("plays seeds 1 to 12 exactly as before on the design's numbers", () => {
    expect(SEEDS.map((seed) => play(seed, DESIGN))).toEqual(RECORDED_DESIGN);
  });
});
