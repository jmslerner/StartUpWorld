import type { CompanyPhase, GameState } from "../types/game";
import type { EngineContext } from "./context";

export const computeCompanyPhase = (state: GameState, ctx: EngineContext): CompanyPhase => {
  // Fantasy progression separate from funding stage.
  if (state.mrr >= 250_000 && state.stage === "growth" && ctx.teamSize >= 25) return "public";
  if (state.mrr >= 80_000 && state.users >= 20_000 && state.stage !== "garage") return "unicorn";
  if (state.mrr >= 10_000 || state.users >= 2_500 || ctx.teamSize >= 10) return "office";
  if (state.users >= 250 || ctx.teamSize >= 4) return "coworking";
  return "garage";
};

export const applyProgression = (state: GameState, ctx: EngineContext): { state: GameState; logs: string[] } => {
  const next = computeCompanyPhase(state, ctx);
  if (next === state.companyPhase) {
    return { state, logs: [] };
  }
  return {
    state: { ...state, companyPhase: next },
    logs: [`Phase shift: ${state.companyPhase} → ${next}.`],
  };
};
