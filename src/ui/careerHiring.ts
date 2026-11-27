import { peopleCap, rulesForTurn } from "../engine/career";
import type { GameState, Plan, RulesConfig } from "../engine/types";
import { viewFor } from "../engine/view";
import { PLAYER_ID } from "../state/player";
import { money } from "./format";
import type { PlanningView } from "./viewModel";

export interface CareerHiringView {
  /** One line under the teams: nobody recruiting, or the last office full; null when there is nothing to say. */
  readonly teamLine: string | null;
  /** The "Hire at most" row's fine print after its limit note. */
  readonly hireText: string;
}

const candidates = (n: number): string => `${n} ${n === 1 ? "candidate" : "candidates"}`;

/** The career's hiring words for this plan; null in a race. */
export const careerHiringView = (game: GameState, draft: Plan, view: PlanningView, config: RulesConfig): CareerHiringView | null => {
  const rules = rulesForTurn(config, game.turn);
  const career = rules.career;
  if (career === undefined) return null;
  const self = game.companies[PLAYER_ID];
  const { candidates: cand, wanted, expected, capacity, fee } = view.hiring;
  const best = Math.min(wanted, cand);
  // Candidates go one at a time, most hype first, and a rival wins a tie against the player.
  const ahead = viewFor(game, PLAYER_ID).rivals.filter((rival) => rival.out === null && rival.hype >= self.hype).length;

  let teamLine: string | null = null;
  if (self.headcount - draft.layoffs >= peopleCap(career)) {
    const last = career.offices[career.offices.length - 1];
    teamLine = `Your ${last.name.toLowerCase()} is full: nobody more can join.`;
  } else if (draft.allocation.recruiting === 0) {
    teamLine = cand > 0 ? `Nobody is recruiting. Put one person on Recruiting to hire: ${candidates(cand)} this year.` : "Nobody is recruiting, and nobody is looking for work this year.";
  } else if (capacity === 0) {
    teamLine = "Recruiting finds nobody this year: put more people on it.";
  }

  const cost = `${money(fee)} fee each now, then ${money(rules.salary)} a year in salary. Hires join next year. `;
  let outlook: string;
  if (cand === 0) outlook = "Nobody is looking for work this year: expect no hires.";
  else if (draft.hireLimit === 0) outlook = "Hire at most is 0: nobody joins.";
  else if (expected >= best) outlook = `${candidates(cand)} this year: expect ${expected}.`;
  else {
    const order = ahead === 0 ? "you pick first" : ahead === 1 ? "1 rival picks before you" : `${ahead} rivals pick before you`;
    const least = expected === 0 ? "none for sure" : `at least ${expected}`;
    outlook = `${candidates(cand)} this year, handed out one at a time with the most hype first; ${order}. Expect ${least}, and up to ${best} if rivals hire fewer.`;
  }
  const broke = view.projection.cash < 0 ? " This plan already ends the year below $0." : "";
  return { teamLine, hireText: `${cost}${outlook}${broke}` };
};
