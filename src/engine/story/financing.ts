// Story rounds (the unicorn offer, the rescue and the bridge): booked exactly like a closed `raise` round in
// investors.ts (debt repaid first, cap table diluted at post-money, totalRaised and lastRound updated), minus the stage
// change and the board seats a stage change brings. A Series A+ round gets its interlude, like a `raise` round at the same
// stage (the interludes are narrative labels and count rounds, not stage changes). Like `raise`, a story round never
// exceeds the stage's hard cap.
import type { GameState } from "../../types/game";
import { stageRaiseCaps } from "../investors";
import { clamp } from "../utils";
import { usd } from "./effects";
import { countSeriesRound, isSeriesRound } from "./interludes";

export const closeStoryRound = (s0: GameState, offered: number, preMoney: number, investorName: string): { state: GameState; lines: string[] } => {
  const amount = Math.min(offered, stageRaiseCaps[s0.stage].hardCap);
  const postMoney = preMoney + amount;
  const dilutionPct = postMoney > 0 ? clamp(amount / postMoney, 0.01, 0.6) : 0.15;
  const debtBefore = Math.max(0, s0.debtOutstanding);
  const repaid = Math.min(amount, debtBefore);
  const debtAfter = debtBefore - repaid;
  const debtService = debtBefore > 0 ? Math.round(Math.max(0, s0.debtService) * (debtAfter / debtBefore)) : 0;
  let s: GameState = {
    ...s0,
    cash: s0.cash + amount - repaid,
    debtOutstanding: debtAfter,
    debtService,
    capTable: {
      founderPct: clamp(s0.capTable.founderPct * (1 - dilutionPct), 0, 1),
      investorPct: clamp(s0.capTable.investorPct * (1 - dilutionPct) + dilutionPct, 0, 1),
    },
    totalRaised: s0.totalRaised + amount,
    lastRound: { week: s0.week, stage: s0.stage, investorName, amount, preMoney, postMoney, dilutionPct },
  };
  const lines = [
    `Round closed with ${investorName}: ${usd(amount)} at ${usd(preMoney)} pre. Dilution ${Math.round(dilutionPct * 100)}%. Founder ownership ${Math.round(s.capTable.founderPct * 100)}%.`,
    repaid > 0 ? `Cash +${usd(amount - repaid)} (debt repaid: -${usd(repaid)}).` : `Cash +${usd(amount)}.`,
  ];
  if (isSeriesRound(s.stage)) {
    const r = countSeriesRound(s);
    s = r.state;
    lines.push(...r.lines);
  }
  return { state: s, lines };
};

/**
 * Moves part of the founder's stake to the investors without new money: what a participating preference does to a
 * founder's share of the proceeds. `share` is the fraction of the founder's stake that moves.
 */
export const preferenceHaircut = (s: GameState, share: number): { state: GameState; line: string } => {
  const moved = s.capTable.founderPct * share;
  const state: GameState = {
    ...s,
    capTable: { founderPct: clamp(s.capTable.founderPct - moved, 0, 1), investorPct: clamp(s.capTable.investorPct + moved, 0, 1) },
  };
  return { state, line: `Founder ownership ${Math.round(s.capTable.founderPct * 100)}% → ${Math.round(state.capTable.founderPct * 100)}%.` };
};
