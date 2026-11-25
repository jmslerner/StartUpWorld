// The career's part of the plan: going public, the office move the year may bring, and the warnings only a career
// gives. Nothing here exists in a race.

import { boardPaused, listingBlocker, listingEffects, listingOf, rulesForTurn, yearOf } from "../engine";
import type { Projection } from "../engine/project";
import type { GameState, Plan, RulesConfig } from "../engine/types";
import { PLAYER_ID } from "../state/player";
import { officePhrase } from "./careerTimeline";
import { count, money, percent } from "./format";
import type { Warning, WarningLevel } from "./viewModel";

export interface ListingView {
  readonly blocked: "listed" | "users" | "profit" | null;
  /** Why it is not on offer; null when it is. */
  readonly blockedText: string | null;
  /** The year's bar in users. */
  readonly bar: number;
  readonly valuation: number;
  readonly amount: number;
  readonly equityAfter: number;
  readonly investorSeatsAfter: number;
  readonly hype: number;
  /** True only when chosen and on offer. */
  readonly selected: boolean;
  /** What it does, or what choosing it drops. */
  readonly text: string;
}

/** Going public as the plan offers it, by the year's rules; null in a race. */
export const listingView = (game: GameState, draft: Plan, config: RulesConfig): ListingView | null => {
  const self = game.companies[PLAYER_ID];
  const rules = rulesForTurn(config, game.turn);
  const career = rules.career;
  if (career === undefined || self.career === undefined) return null;
  const blocker = listingBlocker(self, game.turn, config);
  if (blocker === "unavailable") return null;
  const bar = rules.ipo.users;
  let blockedText: string | null = null;
  if (blocker === "users") blockedText = `Going public takes a year that closes with ${count(bar)} users and a profit. You have ${count(self.users)}.`;
  if (blocker === "profit") blockedText = `You have the users. Going public takes a year that closes with ${count(bar)} users and a profit.`;
  if (blocker === "listed" && self.career.listed !== null) blockedText = `Public since ${yearOf(self.career.listed.turn, career)}.`;
  const { valuation, amount } = listingOf(self, game.climate.multiplier, rules);
  const effects = listingEffects(self, rules);
  const selected = draft.goPublic === true && blocker === null;
  const text =
    `Sell ${career.listing.percent}% of the company for ${money(amount)}, at a ${money(valuation)} valuation. ` +
    `You keep ${percent(effects.equity)}, investors gain a board seat, and the company gains ${effects.hype} hype. ` +
    `From then on the company is worth ${percent(career.listing.premium - 1)} more, and it can no longer raise privately.` +
    (selected && draft.raisePercent > 0 ? " Going public drops this year's raise." : "");
  return {
    blocked: blocker,
    blockedText,
    bar,
    valuation,
    amount,
    equityAfter: effects.equity,
    investorSeatsAfter: effects.investorSeats,
    hype: effects.hype,
    selected,
    text,
  };
};

export interface OfficeMoveView {
  readonly from: string;
  readonly to: string;
  /** The move comes only if the team ends the year above this many people. */
  readonly capacity: number;
  /** The most it costs: the projection counts it in full. */
  readonly bill: number;
  readonly text: string;
}

/** The office move the projected year brings, if it brings one; null in a race. */
export const officeMoveView = (projection: Projection, config: RulesConfig): OfficeMoveView | null => {
  const move = projection.career?.office ?? null;
  const career = config.career;
  if (move === null || career === undefined) return null;
  const from = career.offices[move.from];
  const to = career.offices[move.to];
  return {
    from: from.name,
    to: to.name,
    capacity: from.capacity,
    bill: move.bill,
    text:
      `If the team ends the year above ${from.capacity}, you move from ${officePhrase(from.name, "your")} to ${officePhrase(to.name, "your")}: ` +
      `a one-off bill of up to ${money(move.bill)}, already counted in the costs.`,
  };
};

/** What the rescue leaves the founder, in words: "half your stake", or "40% of your stake". */
const keptStake = (equityKept: number): string => (equityKept === 0.5 ? "half your stake" : `${percent(equityKept)} of your stake`);

/** The warnings only a career gives, by the year's rules; none in a race. `planningView` sorts them with the rest. */
export const careerWarnings = (game: GameState, draft: Plan, projection: Projection, config: RulesConfig): Warning[] => {
  const self = game.companies[PLAYER_ID];
  const rules = rulesForTurn(config, game.turn);
  const career = rules.career;
  if (career === undefined || self.career === undefined) return [];
  const warnings: Warning[] = [];
  const warn = (level: WarningLevel, text: string): void => {
    warnings.push({ level, text });
  };
  const year = yearOf(game.turn, career);
  const rescued = self.career.rescue !== null;
  const rescue = `the company is rescued once: you keep ${keptStake(career.rescue.equityKept)} and investors take the board.`;

  if (projection.cash < 0) {
    warn(
      "danger",
      `This plan is expected to end ${year} at ${money(projection.cash)}. ` +
        (rescued ? "Below $0 your company is out, and your career ends." : `Below $0 ${rescue}`),
    );
  }
  if (projection.boardRisk > 0) {
    if (rescued) warn("danger", "You have used your one rescue: if your board fires you, your career ends.");
    else warn("note", `If your board fires you, ${rescue}`);
  }
  if (boardPaused(self, game.turn)) warn("note", "After the rescue your board does not vote this year.");

  const bar = rules.ipo.users;
  if (!self.career.qualified && self.career.listed === null && projection.users >= bar) {
    if (projection.profitable) warn("note", `Close ${year} with ${count(bar)} users and a profit, and you may go public next year.`);
    else {
      warn(
        "caution",
        `You have the users to go public, but not the profit: revenue ${money(projection.revenue)} against costs ${money(projection.costs.total)}. ` +
          `Close ${year} with a profit, and you may go public next year.`,
      );
    }
  }
  if (listingBlocker(self, game.turn, config) === null && draft.goPublic !== true) warn("note", "You may go public this year: see Go public in the plan.");

  const move = officeMoveView(projection, config);
  // The bill is already in the projection's costs, so the year-end cash is what is left after it.
  if (move !== null) warn(projection.cash < 0 ? "caution" : "note", move.text);

  if (game.turn >= rules.game.maxTurns) {
    warn("note", `Final year: after ${yearOf(rules.game.maxTurns, career)} the largest founder's stake (equity × valuation) wins.`);
  }
  return warnings;
};
