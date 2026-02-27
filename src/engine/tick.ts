import type { GameState } from "../types/game";
import { clamp } from "./utils";
import { BASE_AP, calcBurn, calcRunwayWeeks } from "./economy";
import { signedUnit } from "./rng";
import { computeContext, computeTeamSize } from "./context";
import { applyWeeklyCulture } from "./culture";
import { applyCofounderWeeklyDrift, founderMods, isCofounderChosen, isFounderChosen } from "./founders";
import { calcVolatility, fatTailSigned, impactMultiplier } from "./volatility";
import { calcStress } from "./stress";
import { maybeSelectEvent } from "./events/select";
import { toPendingEvent } from "./events/types";
import { applyProgression } from "./progression";
import { evaluateEndings } from "./endings";
import { calcValuation } from "./valuation";

const growthRates = (state: GameState) => {
  const eng = state.team.engineering;
  const design = state.team.design;
  const mkt = state.team.marketing;
  const sales = state.team.sales;
  const ops = state.team.ops;
  const hr = state.team.hr;
  const legal = state.team.legal;

  const rep = clamp(state.reputation / 100, 0, 1);
  const morale = clamp(state.culture.morale / 100, 0, 1);

  const stress = clamp(state.stress / 100, 0, 1);

  // If GTM outpaces execution, you leak churn and miss growth.
  const execCapacity = eng + design + ops;
  const gtm = mkt + sales;
  const execGap = Math.max(0, gtm - execCapacity);
  const imbalanceGrowthPenalty = Math.min(0.05, execGap * 0.0025);
  const imbalanceChurnPenalty = Math.min(0.06, execGap * 0.002);

  // Baseline growth and churn; dramatic but bounded.
  const baseGrowth =
    0.015 +
    rep * 0.06 +
    eng * 0.0035 +
    ops * 0.002 +
    mkt * 0.006 +
    sales * 0.006 +
    morale * 0.01 +
    legal * 0.0015 -
    hr * 0.0015 -
    imbalanceGrowthPenalty;

  const baseChurn =
    0.02 +
    (1 - rep) * 0.02 +
    (1 - morale) * 0.03 +
    stress * 0.015 -
    legal * 0.0007 -
    ops * 0.0015 +
    imbalanceChurnPenalty;

  return {
    growth: clamp(baseGrowth - stress * 0.02, -0.05, 0.22),
    churn: clamp(baseChurn + stress * 0.02, 0.01, 0.18),
  };
};

export const endWeekTick = (state: GameState): { state: GameState; logs: string[] } => {
  if (state.gameOver) {
    return { state, logs: ["Game over. Refresh to start a new run (restart command coming soon)."] };
  }
  if (state.pendingEvent) {
    return { state, logs: ["Resolve the pending event first with `choose <n>`." ] };
  }
  if (!isFounderChosen(state)) {
    return { state, logs: ["Choose your founder archetype first: `founder visionary|hacker|sales-animal|philosopher`."] };
  }
  if (!isCofounderChosen(state)) {
    return { state, logs: ["Choose your cofounder first: `cofounder operator|builder|rainmaker|powderkeg`."] };
  }

  const logs: string[] = [];
  const pre = state;
  const mods = founderMods[pre.founder.archetype!];

  // Recompute burn from current org + stage.
  let s: GameState = { ...pre, burn: calcBurn(pre) };

  const cashAfterBurn = s.cash - s.burn;

  // Users/mrr dynamics
  const rates = growthRates(s);
  const vol = clamp(s.volatility / 100, 0, 1);
  const swing = signedUnit(s.rng);
  s = { ...s, rng: swing.rng };

  // Make volatility actually dangerous: fatten tails + amplify the swing.
  const swingFat = fatTailSigned(swing.value, s.volatility);
  const volImpact = impactMultiplier(s.volatility);

  // Amplification factor: modest when vol is low, explosive when vol is high.
  const swingAmp = (0.9 + vol * 1.1) * (1 + (volImpact - 1) * 0.85);

  const growth = clamp(rates.growth * (1 + swingFat * vol * 1.9 * swingAmp), -0.12, 0.8);
  const churnRate = clamp(rates.churn * (1 + (-swingFat) * vol * 1.15 * swingAmp), 0.006, 0.35);

  const grossAdds = Math.round(s.users * Math.max(0, growth));
  const churn = Math.round(s.users * churnRate);

  const nextUsers = Math.max(0, s.users + grossAdds - churn);
  const nextMrr = Math.max(0, Math.round(nextUsers * s.arpu));

  const next: GameState = {
    ...s,
    week: s.week + 1,
    ap: BASE_AP,
    cash: cashAfterBurn,
    users: nextUsers,
    mrr: nextMrr,
    lastWeek: {
      users: pre.users,
      mrr: pre.mrr,
      cash: pre.cash,
      teamSize: computeTeamSize(pre),
    },
  };

  // Compute context based on new state vs lastWeek.
  const ctx0 = computeContext(next);

  // Volatility responds to growth and burn intensity.
  const nextVolBase = calcVolatility(next, { growthRate: ctx0.usersGrowthRate, burnIntensity: ctx0.burnIntensity });
  const nextVol = clamp(
    Math.round(pre.volatility + (nextVolBase - pre.volatility) * mods.volatilitySensitivity),
    0,
    100
  );

  let s2: GameState = { ...next, volatility: nextVol, burn: calcBurn(next) };

  // Stress updates after burn recompute.
  const nextStressBase = calcStress(s2);
  const nextStress = clamp(Math.round(nextStressBase * mods.stressSensitivity), 0, 100);
  s2 = { ...s2, stress: nextStress };

  // Week "hit" and "win" signals drive culture + cofounder drift.
  const runway = calcRunwayWeeks(s2);
  const winBase = clamp(Math.max(0, ctx0.mrrGrowthRate) * 3 + Math.max(0, ctx0.usersGrowthRate) * 2, 0, 1);
  const hitBase = clamp((runway <= 3 ? 0.8 : 0) + (ctx0.usersGrowthRate < 0 ? 0.3 : 0) + (s2.stress >= 70 ? 0.4 : 0), 0, 1);

  const win = clamp(winBase * mods.cultureWinMult, 0, 1);
  const hit = clamp(hitBase * mods.cultureHitMult, 0, 1);

  s2 = applyWeeklyCulture(s2, { weekHit: hit, weekWin: win });
  s2 = applyCofounderWeeklyDrift(s2, { hit, win });

  // Refresh derived metrics that depend on this week's results.
  const ctx = computeContext(s2);
  s2 = { ...s2, valuation: calcValuation(s2, ctx) };

  // Phase progression logs
  const prog = applyProgression(s2, ctx);
  s2 = prog.state;

  logs.push("Week closed.");
  logs.push(`Cash -$${s.burn.toLocaleString()} burn. Cash now $${cashAfterBurn.toLocaleString()}.`);
  logs.push(`Users +${grossAdds} / -${churn} → ${nextUsers}. MRR $${nextMrr.toLocaleString()}.`);

  if (prog.logs.length) {
    logs.push(...prog.logs);
  }

  if (ctx.runwayWeeks <= 4) {
    logs.push(`Runway: ${ctx.runwayWeeks} weeks. Stress is rising.`);
  }

  // Select at most one narrative event.
  const pick = maybeSelectEvent(s2, ctx);
  s2 = pick.state;
  if (pick.event) {
    const pending = toPendingEvent(pick.event, s2, ctx);
    s2 = { ...s2, pendingEvent: pending };

    logs.push("");
    logs.push(`EVENT: ${pending.title}`);
    logs.push(pending.prompt);
    pending.choices.forEach((c, i) => logs.push(`${i + 1}) ${c.text}`));
    logs.push("Type `choose <n>`.");
  }

  // Endings check
  const end = evaluateEndings(s2, computeContext(s2));
  s2 = end.state;
  logs.push(...end.logs);

  return { state: s2, logs };
};
