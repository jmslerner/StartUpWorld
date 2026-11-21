import type { GameState } from "../../types/game";
import { executeCommand } from "../commands";

// Dry-run for UI buttons (TYCOON-SPEC §9.1). preflight.ts imports commands.ts, so no production file under
// people/ or projects/ may import it (people -> commands -> people would be a cycle); their tests may.

export interface Preflight {
  allowed: boolean;
  reason: string | null;
  apCost: number;
  cashCost: number;
}

/**
 * Dry-runs a command (the engine is pure, so the input state is untouched) and reports ONLY whether it would be
 * refused, why (the first error line), and the AP and cash it would spend. Never expose anything else from the dry
 * run: for `ship <build>` the result contains the reception roll.
 */
export const preflight = (state: GameState, input: string): Preflight => {
  const r = executeCommand(state, input);
  const firstError = r.logs.find((l) => l.kind === "error");
  if (r.sound === undefined && firstError) {
    return { allowed: false, reason: firstError.text, apCost: 0, cashCost: 0 };
  }
  return { allowed: true, reason: null, apCost: Math.max(0, state.ap - r.state.ap), cashCost: Math.max(0, state.cash - r.state.cash) };
};
