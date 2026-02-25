import type { GameState } from "../types/game";
import type { EngineContext } from "./context";

export const evaluateEndings = (state: GameState, ctx: EngineContext): { state: GameState; logs: string[] } => {
  if (state.gameOver) {
    return { state, logs: [] };
  }

  // Hard bankruptcy if you're deeply underwater.
  if (state.cash < -state.burn * 2) {
    return {
      state: {
        ...state,
        gameOver: { ending: "bankruptcy", week: state.week, headline: "Bankruptcy. The company is a cautionary tale." },
      },
      logs: ["Your account hits negative. Vendors stop answering.", "Ending unlocked: Bankruptcy."],
    };
  }

  // Soft “Zombie SaaS” ending if you stagnate forever.
  if (state.week >= 40 && ctx.mrrGrowthRate < 0.01 && state.mrr >= 8_000 && state.mrr <= 40_000) {
    return {
      state: {
        ...state,
        gameOver: { ending: "zombie-saas", week: state.week, headline: "Zombie SaaS. You built a job in a hoodie." },
      },
      logs: ["The product keeps running. The story stops moving.", "Ending unlocked: Zombie SaaS."],
    };
  }

  return { state, logs: [] };
};
