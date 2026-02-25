import type { GameState } from "../types/game";
import { clamp } from "./utils";

export const applyHiringCohesionHit = (state: GameState, hiresThisAction: number): GameState => {
  if (hiresThisAction <= 1) {
    return state;
  }
  const hit = Math.min(10, 2 + hiresThisAction * 2);
  return {
    ...state,
    culture: {
      ...state.culture,
      cohesion: clamp(state.culture.cohesion - hit, 0, 100),
      morale: clamp(state.culture.morale - Math.round(hit * 0.4), 0, 100),
    },
  };
};

export const applyWeeklyCulture = (state: GameState, opts: { weekHit: number; weekWin: number }): GameState => {
  // weekHit/weekWin are 0..1-ish.
  const cohesionDelta = Math.round(opts.weekWin * 3 - opts.weekHit * 6);
  const moraleDelta = Math.round(opts.weekWin * 5 - opts.weekHit * 10);

  return {
    ...state,
    culture: {
      cohesion: clamp(state.culture.cohesion + cohesionDelta, 0, 100),
      morale: clamp(state.culture.morale + moraleDelta, 0, 100),
    },
  };
};
