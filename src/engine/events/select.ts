import type { GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { chance, pickWeightedIndex } from "../rng";
import { eventPool } from "./pool";
import type { EventDef } from "./types";

export interface EventSelection {
  state: GameState;
  event: EventDef | null;
}

export const maybeSelectEvent = (state: GameState, ctx: EngineContext): EventSelection => {
  // Don’t stack events; resolve one at a time.
  if (state.pendingEvent || state.gameOver) {
    return { state, event: null };
  }

  // Event cadence: more volatile companies attract more chaos.
  const base = 0.28 + (state.volatility / 100) * 0.38 + (ctx.nearBankruptcy ? 0.12 : 0);
  const roll = chance(state.rng, base);
  const s1 = { ...state, rng: roll.rng };
  if (!roll.value) {
    return { state: s1, event: null };
  }

  const eligible = eventPool.filter((e) => e.when(s1, ctx));
  if (eligible.length === 0) {
    return { state: s1, event: null };
  }

  const weights = eligible.map((e) => e.weight(s1, ctx));
  const pick = pickWeightedIndex(s1.rng, weights);
  const s2 = { ...s1, rng: pick.rng };
  const idx = pick.value;
  if (idx === null) {
    return { state: s2, event: null };
  }
  return { state: s2, event: eligible[idx] ?? null };
};
