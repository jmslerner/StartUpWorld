import type { GameState } from "../types/game";
import { calcBurn } from "./economy";
import { computeContext } from "./context";
import { computeCompanyPhase } from "./progression";
import { calcValuation } from "./valuation";

export const refreshDerivedNoLog = (state: GameState): GameState => {
  const withBurn: GameState = { ...state, burn: calcBurn(state) };
  const ctx = computeContext(withBurn);
  const valuation = calcValuation(withBurn, ctx);
  const withValuation: GameState = { ...withBurn, valuation };
  const phase = computeCompanyPhase(withValuation, ctx);
  return phase === withValuation.companyPhase ? withValuation : { ...withValuation, companyPhase: phase };
};
