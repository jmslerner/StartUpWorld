import type { GameState } from "../types/game";
import type { EngineContext } from "./context";

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

  return hints.sort((a, b) => b.priority - a.priority);
};
