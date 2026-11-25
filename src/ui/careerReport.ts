// The career's part of the annual report: the year in brief, going public, a rescue, an office move, the board in a
// career's words, the newcomers and the rivals' career moves; and the rivals' careers for their panel. Nothing here
// exists in a race.

import { boardPaused, publicReport, rulesForTurn, yearOf } from "../engine";
import type { CompanyId, GameState, OutReason, RulesConfig, TurnLog } from "../engine/types";
import type { CareerRecord } from "../state/careerRecord";
import { PLAYER_ID } from "../state/player";
import { marksOf, officePhrase } from "./careerTimeline";
import { money, percent } from "./format";
import { marketingNote } from "./viewModel";

export interface CareerReportView {
  /** "Acme: 1995 annual report" */
  readonly title: string;
  /** The year in brief: this year's milestones, the player's first. */
  readonly summary: readonly string[];
  readonly listing: { readonly valuation: number; readonly amount: number; readonly equityAfter: number; readonly hype: number; readonly text: string } | null;
  readonly rescue: { readonly reason: OutReason; readonly cashBefore: number; readonly equityBefore: number; readonly equityAfter: number; readonly hype: number; readonly text: string } | null;
  readonly office: { readonly from: string; readonly to: string; readonly bill: number } | null;
  /** Quality the year's card took before the year was played. */
  readonly qualityLostToEvent: number;
  /** The board in a career's words, shown in place of the race's board lines; null leaves the race's lines. */
  readonly boardText: string | null;
  /** The one line the year's short summary leads with; null for a quiet year. */
  readonly headline: string | null;
  /** The year each seat's company went public, by seat; null for a private one. */
  readonly publicSince: readonly (number | null)[];
  readonly entrants: readonly { readonly name: string; readonly pitch: string; readonly year: number }[];
  /** Rivals going public, rescued or moving office, by name. */
  readonly moves: readonly string[];
  /** The player's plan notes, with the marketing note worded for its source. */
  readonly notes: readonly string[];
}

/** The year's report in a career's words; null in a race, or with no report for the player. */
export const careerReportView = (game: GameState, log: TurnLog, record: CareerRecord, config: RulesConfig): CareerReportView | null => {
  const rules = rulesForTurn(config, log.turn);
  const career = rules.career;
  const report = log.companies[PLAYER_ID];
  if (career === undefined || !report) return null;
  const self = game.companies[PLAYER_ID];
  const year = yearOf(log.turn, career);

  // This year's milestones, then the newcomers this year's close seats for the next.
  const thisYear = record.filter((milestone) => (milestone.kind === "rivalIn" ? milestone.turn === log.turn + 1 : milestone.turn === log.turn));
  const summary = marksOf(thisYear, config).map((mark) => mark.text);

  const facts = report.career;
  const listing =
    facts?.listing == null
      ? null
      : {
          valuation: facts.listing.valuation,
          amount: facts.listing.amount,
          equityAfter: report.equity,
          hype: facts.hype.listing,
          text: `You went public: sold ${career.listing.percent}% for ${money(facts.listing.amount)} at a ${money(facts.listing.valuation)} valuation. You now own ${percent(report.equity)}.`,
        };

  const rescueOf = (): CareerReportView["rescue"] => {
    const rescue = facts?.rescue;
    if (rescue == null) return null;
    const from = percent(rescue.equityBefore);
    const to = percent(report.equity);
    const text =
      rescue.reason === "bankrupt"
        ? `You ended the year below $0. Investors rescued the company: you went from ${from} to ${to}, they took the board, and cash was reset to ${money(report.cash.end)}. A second failure ends your career.`
        : `Your board voted to fire you. Investors rescued the company instead: you went from ${from} to ${to} and they took the board. A second failure ends your career.`;
    return { reason: rescue.reason, cashBefore: rescue.cashBefore, equityBefore: rescue.equityBefore, equityAfter: report.equity, hype: facts!.hype.rescue, text };
  };
  const rescue = rescueOf();

  const office =
    facts?.office == null
      ? null
      : { from: career.offices[facts.office.from].name, to: career.offices[facts.office.to].name, bill: facts.office.bill };

  let boardText: string | null = null;
  if (report.board?.fired && rescue !== null) boardText = "Your board voted to fire you, and this time the rescue kept you on.";
  else if (report.board?.fired && report.out === "fired") boardText = "Your board voted to fire you. You had used your one rescue: your career is over.";
  else if (boardPaused(self, log.turn)) boardText = "After the rescue your board did not vote this year.";

  // An office move leads a year that also launched the product: the first year often brings both.
  const moved = office === null ? null : (marksOf(thisYear, config).find((mark) => mark.kind === "office")?.text ?? null);
  const headline =
    (report.out !== null ? "Your company is out, and your career is over." : null) ??
    rescue?.text ??
    listing?.text ??
    boardText ??
    moved ??
    summary[0] ??
    null;

  const publicSince = game.companies.map((company) => (company.career?.listed ? yearOf(company.career.listed.turn, career) : null));

  const entrants = [...(log.entrants ?? [])]
    .sort((a, b) => a - b)
    .map((seat) => ({ name: game.companies[seat].name, pitch: game.companies[seat].pitch, year: yearOf(log.turn + 1, career) }));

  const moves: string[] = [];
  log.companies.forEach((rivalReport, seat) => {
    if (seat === PLAYER_ID || !rivalReport) return;
    const shown = publicReport(rivalReport).career;
    if (shown === undefined) return;
    const name = game.companies[seat].name;
    if (shown.listed) moves.push(`${name} went public.`);
    if (shown.rescued === "bankrupt") moves.push(`${name} was rescued after going bankrupt.`);
    if (shown.rescued === "fired") moves.push(`${name} was rescued after its board fired the founder.`);
    if (shown.movedTo !== null) moves.push(`${name} moved to ${officePhrase(career.offices[shown.movedTo].name, "its")}.`);
  });

  const proceeds = facts?.listing ? "listing" : report.raise ? "raise" : null;
  const notes = report.notes.map((note) => marketingNote(note, proceeds));

  return {
    title: `${self.name}: ${year} annual report`,
    summary,
    listing,
    rescue,
    office,
    qualityLostToEvent: facts?.qualityLostToEvent ?? 0,
    boardText,
    headline,
    publicSince,
    entrants,
    moves,
    notes,
  };
};

export interface RivalCareerRow {
  readonly id: CompanyId;
  readonly foundedYear: number;
  readonly newcomer: boolean;
  readonly office: string;
  readonly listedYear: number | null;
  readonly rescueYear: number | null;
  /** For a rival that is out: the year a new startup takes its seat. */
  readonly newcomerYear: number | null;
}

/** Each rival's career: founded, office, public since, rescued, and when a new startup takes an empty seat. [] in a race. */
export const rivalCareerRows = (game: GameState, config: RulesConfig): RivalCareerRow[] => {
  const rules = rulesForTurn(config, game.turn);
  const career = rules.career;
  if (career === undefined) return [];
  const rows: RivalCareerRow[] = [];
  for (const company of game.companies) {
    const facts = company.career;
    if (company.id === PLAYER_ID || facts === undefined) continue;
    const refilled = company.out === null ? null : company.out.turn + career.replacement.afterYears;
    rows.push({
      id: company.id,
      foundedYear: yearOf(facts.founded, career),
      newcomer: facts.founded > 1,
      office: career.offices[facts.office].name,
      listedYear: facts.listed === null ? null : yearOf(facts.listed.turn, career),
      rescueYear: facts.rescue === null ? null : yearOf(facts.rescue.turn, career),
      newcomerYear: refilled === null || refilled > rules.game.maxTurns ? null : yearOf(refilled, career),
    });
  }
  return rows;
};
