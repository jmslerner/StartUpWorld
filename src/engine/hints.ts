import type { GameState } from "../types/game";
import type { EngineContext } from "./context";
import { PRICING_MODELS } from "./pricing";

export interface Hint {
  text: string;
  priority: number;
}

export const generateHints = (state: GameState, ctx: EngineContext): Hint[] => {
  const hints: Hint[] = [];

  if (ctx.runwayWeeks <= 1) {
    hints.push({ text: "URGENT: Cash is almost gone. `raise` something. Now.", priority: 15 });
  } else if (ctx.runwayWeeks <= 4) {
    hints.push({ text: "Tip: Runway is low. Try `raise friends` or `raise vc <amount>` to extend it.", priority: 10 });
  }

  if (ctx.teamSize <= 1 && state.week >= 2) {
    hints.push({ text: "Tip: Your team is just you. `hire eng` to start building faster.", priority: 7 });
  }

  if (state.stress >= 70) {
    hints.push({ text: "Tip: Stress is dangerously high. Consider slowing down before burnout hits.", priority: 8 });
  }

  if (state.ap === 0) {
    hints.push({ text: "No AP left this week. Type `end` to close the week and refresh.", priority: 9 });
  }

  if (state.investors.pipeline.length === 0 && state.stage !== "garage" && state.week >= 4) {
    hints.push({ text: "Tip: No investors in your pipeline. `pitch` to build relationships before you need to raise.", priority: 6 });
  }

  if (state.week >= 3 && state.reputation <= 12) {
    hints.push({ text: "Tip: Reputation is low. `ship <feature>` to build credibility and attract users.", priority: 5 });
  }

  if (state.culture.morale <= 40) {
    hints.push({ text: "Tip: Morale is crashing. High stress and rapid hiring can erode culture.", priority: 6 });
  }

  const pm = PRICING_MODELS[state.pricingModel];
  if (state.pricingModel === "consumer" && ctx.usersGrowthRate < -0.05) {
    hints.push({ text: "Tip: Consumer churn is brutal. `ship` features to keep users.", priority: 5 });
  }
  if (state.pricingModel === "enterprise" && state.users < 20 && state.week >= 4) {
    hints.push({ text: "Tip: Enterprise is about big contracts, not user count. Focus on `ship` and ARPU.", priority: 4 });
  }
  if (state.arpu <= pm.arpuMin && state.week >= 3) {
    hints.push({ text: "Tip: ARPU is at the floor for your pricing model. Consider `pricing` to pivot.", priority: 4 });
  }

  // Stage unlock hints — nudge players toward newly available roles.
  if (state.stage === "seed" && state.team.data === 0 && state.week >= 4) {
    hints.push({ text: "Tip: New role unlocked: `hire data` to reduce churn with analytics.", priority: 4 });
  }
  if (state.stage === "series-a" && state.team.product === 0 && state.week >= 4) {
    hints.push({ text: "Tip: New role unlocked: `hire product` to ship faster.", priority: 4 });
  }
  if (state.stage === "growth" && state.team.executive === 0) {
    hints.push({ text: "Tip: `hire executive` to reduce overhead and boost pitch success.", priority: 4 });
  }

  // Board confidence hints
  if (state.board.members.length > 0) {
    const hostile = state.board.members.filter(m => m.confidence < 40).length;
    if (hostile >= 2) {
      hints.push({ text: "Warning: Multiple board members are hostile. Use `board dinner` or `board gift` to rebuild confidence.", priority: 9 });
    } else if (state.board.members.some(m => m.confidence < 30 && m.role !== "founder")) {
      hints.push({ text: "Tip: A board member's confidence is critically low. They may vote against you.", priority: 8 });
    }
  }

  return hints.sort((a, b) => b.priority - a.priority);
};
