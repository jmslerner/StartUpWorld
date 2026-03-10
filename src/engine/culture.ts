import type { GameState } from "../types/game";
import { clamp } from "./utils";

// ── Culture drift constants ──
const MAX_HIRING_COHESION_HIT = 10;
const HIRING_HIT_BASE = 2;
const HIRING_HIT_PER_HEAD = 2;
const HIRING_MORALE_FRACTION = 0.4;   // morale takes this fraction of cohesion hit

const COHESION_WIN_SCALE = 3;
const COHESION_HIT_SCALE = 6;
const MORALE_WIN_SCALE = 5;
const MORALE_HIT_SCALE = 10;

export const applyHiringCohesionHit = (state: GameState, hiresThisAction: number): GameState => {
  if (hiresThisAction <= 1) {
    return state;
  }
  const hit = Math.min(MAX_HIRING_COHESION_HIT, HIRING_HIT_BASE + hiresThisAction * HIRING_HIT_PER_HEAD);
  return {
    ...state,
    culture: {
      ...state.culture,
      cohesion: clamp(state.culture.cohesion - hit, 0, 100),
      morale: clamp(state.culture.morale - Math.round(hit * HIRING_MORALE_FRACTION), 0, 100),
    },
  };
};

export const applyWeeklyCulture = (state: GameState, opts: { weekHit: number; weekWin: number }): GameState => {
  // weekHit/weekWin are 0..1-ish.
  const cohesionDelta = Math.round(opts.weekWin * COHESION_WIN_SCALE - opts.weekHit * COHESION_HIT_SCALE);
  const moraleDelta = Math.round(opts.weekWin * MORALE_WIN_SCALE - opts.weekHit * MORALE_HIT_SCALE);

  return {
    ...state,
    culture: {
      cohesion: clamp(state.culture.cohesion + cohesionDelta, 0, 100),
      morale: clamp(state.culture.morale + moraleDelta, 0, 100),
    },
  };
};
