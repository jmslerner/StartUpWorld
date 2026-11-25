// The end of a career, worked out for the end screen: how the career ended, the companies still in ranked by
// founder's stake as the engine ranks them (public ones marked as public), the rivals that went out and whose seat a
// newcomer took, and the career's milestones on the timeline. Nothing here exists in a race.

import { closingValuation, founderStake, rulesForTurn, valuationOf, yearOf } from "../engine";
import type { GameState, OutReason, RulesConfig } from "../engine/types";
import type { CareerRecord } from "../state/careerRecord";
import { PLAYER_ID } from "../state/player";
import { marksOf, type TimelineMark } from "./careerTimeline";
import { money } from "./format";
import type { GameEndSound } from "./sound";
import { TYPE_LABEL, type Standing } from "./viewModel";

export type CareerEndKind = "stake-win" | "stake-loss" | "bankrupt" | "fired";
export interface GoneCompany {
  readonly name: string;
  readonly foundedYear: number;
  readonly outYear: number;
  readonly reason: OutReason;
}
/** A standing with its public mark (C5: a public company is marked as public everywhere it appears). */
export interface CareerStanding extends Standing {
  readonly publicSince: number | null;
}
export interface CareerEndView {
  readonly kind: CareerEndKind;
  readonly won: boolean;
  readonly sound: GameEndSound;
  /** The year the player's career ended in. */
  readonly year: number;
  readonly title: string;
  readonly text: string;
  /** Companies in the game at the end, the winner first, then by founder's stake; those out at the end follow, latest first. */
  readonly standings: readonly CareerStanding[];
  /** Rivals that went out and whose seat a newcomer took: no longer in the game, so not in the standings. */
  readonly gone: readonly GoneCompany[];
  readonly marks: readonly TimelineMark[];
}

const SOUND: Record<CareerEndKind, GameEndSound> = {
  "stake-win": "win",
  "stake-loss": "loss",
  bankrupt: "bankrupt",
  fired: "fired",
};

/** null while the player is in and the career has no outcome, and always in a race. */
export const careerEndView = (game: GameState, record: CareerRecord, config: RulesConfig): CareerEndView | null => {
  const rules = rulesForTurn(config, game.turn);
  const career = rules.career;
  if (career === undefined) return null;
  const self = game.companies[PLAYER_ID];
  const outcome = game.outcome;
  if (self.out === null && outcome === null) return null;

  const standings: CareerStanding[] = game.companies
    .map((company) => {
      // What the engine ranks by: the closing valuation, with the listing premium for a public company.
      const valuation =
        company.out === null ? closingValuation(valuationOf(company.users, company.hype, game.climate.multiplier, rules), company, false, rules) : 0;
      const listed = company.career?.listed ?? null;
      return {
        id: company.id,
        name: company.name,
        pitch: company.pitch,
        you: company.id === PLAYER_ID,
        winner: outcome !== null && outcome.winnerId === company.id,
        type: TYPE_LABEL[company.controller],
        users: company.out?.users ?? company.users,
        valuation,
        equity: company.founderEquity,
        stake: founderStake(company.founderEquity, valuation),
        out: company.out,
        publicSince: listed === null ? null : yearOf(listed.turn, career),
      };
    })
    .sort((a, b) => {
      if (a.winner !== b.winner) return a.winner ? -1 : 1;
      if (a.out === null && b.out === null) return b.stake - a.stake || b.valuation - a.valuation || a.id - b.id;
      if (a.out !== null && b.out !== null) return b.out.turn - a.out.turn || a.id - b.id;
      return a.out === null ? -1 : 1;
    });

  const gone: GoneCompany[] = [];
  for (const milestone of record) {
    if (milestone.kind !== "rivalOut") continue;
    const now = game.companies[milestone.seat]?.career?.founded;
    if (now === undefined || now <= milestone.founded) continue;
    gone.push({ name: milestone.name, foundedYear: yearOf(milestone.founded, career), outYear: yearOf(milestone.turn, career), reason: milestone.reason });
  }

  const you = standings.find((standing) => standing.you);
  const winner = standings.find((standing) => standing.winner);
  const year = yearOf(self.out?.turn ?? outcome?.turn ?? game.turn, career);
  const lastYear = yearOf(rules.game.maxTurns, career);
  const rescue = self.career?.rescue ?? null;
  const rescueYear = rescue === null ? year : yearOf(rescue.turn, career);

  let kind: CareerEndKind;
  if (self.out !== null) kind = self.out.reason;
  else kind = outcome?.winnerId === PLAYER_ID ? "stake-win" : "stake-loss";

  const rival = winner?.name ?? "A rival";
  const stake = money(you?.stake ?? 0);
  const copy: Record<CareerEndKind, { title: string; text: string }> = {
    "stake-win": {
      title: "You finished on top.",
      text: `After ${lastYear}, your founder's stake, ${stake}, is the largest.`,
    },
    "stake-loss": {
      title: `${rival} finished on top.`,
      text: `After ${lastYear}, ${rival}'s founder holds ${money(winner?.stake ?? 0)}; your stake is ${stake}.`,
    },
    bankrupt: {
      title: `${self.name} ran out of cash again.`,
      text: `You ended ${year} below $0 for the second time. Your one rescue was in ${rescueYear}, so your career is over.`,
    },
    fired: {
      title: "Your board fired you again.",
      text: `Investors held your board, and ${year} was a bad year. Your one rescue was in ${rescueYear}, so your career is over.`,
    },
  };

  return {
    kind,
    won: kind === "stake-win",
    sound: SOUND[kind],
    year,
    title: copy[kind].title,
    text: copy[kind].text,
    standings,
    gone,
    marks: marksOf(record, config),
  };
};
