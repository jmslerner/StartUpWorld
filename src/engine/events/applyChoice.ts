import type { GameState } from "../../types/game";
import type { EngineContext } from "../context";
import { eventPool } from "./pool";
import { impactMultiplier } from "../volatility";

export const applyPendingEventChoice = (
  state: GameState,
  ctx: EngineContext,
  choiceIndex: number
): { state: GameState; logs: string[] } => {
  if (!state.pendingEvent) {
    return { state, logs: ["No pending event."] };
  }

  const def = eventPool.find((e) => e.id === state.pendingEvent?.id);
  if (!def) {
    return {
      state: { ...state, pendingEvent: null },
      logs: ["Event data missing. Clearing pending event."],
    };
  }

  const idx = choiceIndex - 1;
  const choice = def.choices[idx];
  if (!choice) {
    return { state, logs: [`Invalid choice. Pick 1-${def.choices.length}.`] };
  }

  const volMult = impactMultiplier(state.volatility);
  const result = choice.apply({ ...state, pendingEvent: null }, ctx);

  if (volMult >= 1.15) {
    return {
      state: result.state,
      logs: [...result.logs, `(Volatility x${volMult.toFixed(2)} amplified the fallout.)`],
    };
  }

  return result;
};
