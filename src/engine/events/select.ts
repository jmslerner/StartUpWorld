import type { GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { chance, pickWeightedIndex } from "../rng";
import { eventPool } from "./pool";
import type { EventDef } from "./types";

const EVENT_COOLDOWN_WEEKS = 7;
const EVENT_RECENT_PENALTY_COUNT = 10;
const EVENT_RECENT_PENALTY_MULT = 0.25;
const EVENT_HISTORY_MAX = 120;

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

  const history = s1.eventHistory;
  const recent = history.slice(0, EVENT_RECENT_PENALTY_COUNT);

  const lastSeenWeek = (id: string): number | null => {
    for (const h of history) {
      if (h.id === id) return h.week;
    }
    return null;
  };

  const passesCooldown = (id: string): boolean => {
    const last = lastSeenWeek(id);
    if (last === null) return true;
    return s1.week - last > EVENT_COOLDOWN_WEEKS;
  };

  const eligibleCooldown = eligible.filter((e) => passesCooldown(e.id));
  const finalEligible = eligibleCooldown.length > 0 ? eligibleCooldown : eligible;

  const weights = finalEligible.map((e) => {
    const w = e.weight(s1, ctx);
    if (!Number.isFinite(w) || w <= 0) return 0;
    const isRecent = recent.some((h) => h.id === e.id);
    return isRecent ? w * EVENT_RECENT_PENALTY_MULT : w;
  });

  const pick = pickWeightedIndex(s1.rng, weights);
  const s2 = { ...s1, rng: pick.rng };
  const idx = pick.value;
  if (idx === null) {
    return { state: s2, event: null };
  }

  const event = finalEligible[idx] ?? null;
  if (!event) {
    return { state: s2, event: null };
  }

  const nextHistory = [{ id: event.id, week: s2.week }, ...history].slice(0, EVENT_HISTORY_MAX);
  return { state: { ...s2, eventHistory: nextHistory }, event };
};
