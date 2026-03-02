import type { GameState } from "../types/game";
import { calcRunwayWeeks, calcNetBurn, roleComp } from "./economy";
import { clamp } from "./utils";

export interface EngineContext {
  runwayWeeks: number;
  usersGrowthRate: number; // vs last week
  mrrGrowthRate: number;
  burnIntensity: number; // burn / max(cash,1)
  teamSize: number;
  hiresThisWeek: number;
  nearBankruptcy: boolean;
  ltv: number; // lifetime value per user ($)
  cac: number; // cost to acquire a customer ($)
  ltvCacRatio: number; // LTV / CAC — VCs want > 3
  profitable: boolean;
}

export const computeTeamSize = (state: GameState): number =>
  Object.values(state.team).reduce((acc, n) => acc + n, 0);

export const computeContext = (state: GameState): EngineContext => {
  const runwayWeeks = calcRunwayWeeks(state);
  const usersGrowthRate = state.lastWeek.users > 0 ? (state.users - state.lastWeek.users) / state.lastWeek.users : 0;
  const mrrGrowthRate = state.lastWeek.mrr > 0 ? (state.mrr - state.lastWeek.mrr) / state.lastWeek.mrr : 0;
  const burnIntensity = state.cash > 0 ? state.burn / Math.max(1, state.cash) : 3;
  const teamSize = computeTeamSize(state);
  const hiresThisWeek = Math.max(0, teamSize - state.lastWeek.teamSize);
  const netBurn = calcNetBurn(state);

  // LTV = ARPU × avg lifetime months. Approximate monthly churn from weekly:
  // weekly churn ~= (users lost) / users. Monthly ~= weekly × 4.33.
  // avg lifetime months = 1 / monthly churn.
  const grossChurnRate = state.lastWeek.users > 0
    ? clamp(1 - (state.users / Math.max(1, state.lastWeek.users + Math.max(0, state.users - state.lastWeek.users))), 0.005, 0.5)
    : 0.05;
  const monthlyChurn = clamp(grossChurnRate * 4.33, 0.02, 1);
  const avgLifetimeMonths = 1 / monthlyChurn;
  const ltv = state.arpu * avgLifetimeMonths;

  // CAC = monthly GTM spend / monthly new users
  const gtmWeeklyCost = state.team.marketing * roleComp.marketing.salary + state.team.sales * roleComp.sales.salary;
  const grossAdds = Math.max(0, state.users - state.lastWeek.users + Math.round(state.lastWeek.users * grossChurnRate));
  const monthlyAdds = Math.max(1, grossAdds * 4.33);
  const monthlyCost = gtmWeeklyCost * 4.33;
  const cac = monthlyAdds > 0 ? monthlyCost / monthlyAdds : 999;

  const ltvCacRatio = cac > 0 ? ltv / cac : 0;

  return {
    runwayWeeks,
    usersGrowthRate: clamp(usersGrowthRate, -0.9, 2.0),
    mrrGrowthRate: clamp(mrrGrowthRate, -0.9, 2.0),
    burnIntensity: clamp(burnIntensity, 0, 3),
    teamSize,
    hiresThisWeek,
    nearBankruptcy: runwayWeeks <= 3 || state.cash < 0,
    ltv: Math.round(ltv),
    cac: Math.round(cac),
    ltvCacRatio: Math.round(ltvCacRatio * 10) / 10,
    profitable: netBurn <= 0,
  };
};
