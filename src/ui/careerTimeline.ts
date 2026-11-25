// The career's timeline and the year's status, worked out for the screens: the eras from the first year to the
// last, the dated cards whose year has come, the platform shift announced ahead, the career's milestones by year,
// and the line that says which year it is and where the company stands. Nothing here exists in a race.

import { boardPaused, datedCardFor, eraIndexOf, findCard, rulesForTurn, upcomingShift, yearOf } from "../engine";
import type { ActiveEvent, DatedCard, GameState, RulesConfig } from "../engine/types";
import type { CareerRecord, Milestone } from "../state/careerRecord";
import { PLAYER_ID } from "../state/player";
import { money } from "./format";

export interface TimelineEra {
  readonly id: string;
  readonly name: string;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly invented: boolean;
  readonly current: boolean;
}
export interface TimelineCard {
  readonly year: number;
  readonly name: string;
  readonly shift: boolean;
}
export interface TimelineMark {
  readonly year: number;
  readonly kind: Milestone["kind"];
  readonly yours: boolean;
  readonly text: string;
}
export interface ShiftView {
  readonly name: string;
  readonly year: number;
  readonly yearsAway: number;
  readonly ceiling: number;
  readonly text: string;
}
export interface TimelineView {
  readonly year: number;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly era: TimelineEra;
  readonly eras: readonly TimelineEra[];
  /** The last year of history; later years are invented. */
  readonly historyEnds: number;
  /** Dated cards of past years and this one. Future cards stay hidden, but for the shift's notice. */
  readonly cards: readonly TimelineCard[];
  readonly shift: ShiftView | null;
  readonly marks: readonly TimelineMark[];
}

/** An office in a sentence: "Own office" → "your own office" / "its own office"; any other → "the shared office". */
export const officePhrase = (name: string, whose: "your" | "its"): string =>
  name === "Own office" ? `${whose} own office` : `the ${name.toLowerCase()}`;

/** A dated card that caps quality: a platform shift, as `upcomingShift` reads it. */
const isShift = (card: DatedCard): boolean => card.effects.some((effect) => effect.kind === "qualityCeiling");

const YOURS: ReadonlySet<Milestone["kind"]> = new Set(["launch", "office", "listed", "rescued", "out"]);

/** The reason of the rescue before an "out", so the out says "a second time" only when it was the same failure. */
const markText = (milestone: Milestone, config: RulesConfig, rescued: (Milestone & { kind: "rescued" }) | null): string => {
  switch (milestone.kind) {
    case "launch":
      return "Product launched";
    case "office": {
      const office = config.career?.offices[milestone.to];
      return `Moved to ${officePhrase(office?.name ?? "", "your")}`;
    }
    case "listed":
      return `Went public, raising ${money(milestone.amount)}`;
    case "rescued":
      return milestone.reason === "bankrupt" ? "Rescued from bankruptcy" : "Rescued when the board fired you";
    case "out":
      if (rescued === null) return milestone.reason === "bankrupt" ? "Out: bankrupt" : "Out: fired";
      if (rescued.reason === milestone.reason) return milestone.reason === "bankrupt" ? "Out: bankrupt a second time" : "Out: fired a second time";
      return milestone.reason === "bankrupt" ? "Out: bankrupt, after the rescue when the board fired you" : "Out: fired, after the rescue from bankruptcy";
    case "rivalOut":
      return milestone.reason === "bankrupt" ? `${milestone.name} went bankrupt` : `${milestone.name}'s founder was fired`;
    case "rivalIn":
      return `${milestone.name} entered`;
  }
};

/** The career's milestones by year, in the record's order. Empty in a race. */
export const marksOf = (record: CareerRecord, config: RulesConfig): TimelineMark[] => {
  const career = config.career;
  if (career === undefined) return [];
  let rescued: (Milestone & { kind: "rescued" }) | null = null;
  return record.map((milestone) => {
    const mark = { year: yearOf(milestone.turn, career), kind: milestone.kind, yours: YOURS.has(milestone.kind), text: markText(milestone, config, rescued) };
    if (milestone.kind === "rescued") rescued = milestone;
    return mark;
  });
};

/** The whole career on one line: its eras, the dated cards so far, the shift ahead and the milestones. Null in a race. */
export const timelineView = (game: GameState, record: CareerRecord, config: RulesConfig): TimelineView | null => {
  const career = config.career;
  if (career === undefined) return null;
  const year = yearOf(game.turn, career);
  const lastYear = yearOf(config.game.maxTurns, career);
  const currentIndex = eraIndexOf(game.turn, career);
  const eras: TimelineEra[] = career.eras.map((era, index) => ({
    id: era.id,
    name: era.name,
    firstYear: era.firstYear,
    lastYear: index + 1 < career.eras.length ? career.eras[index + 1].firstYear - 1 : lastYear,
    invented: era.invented,
    current: index === currentIndex,
  }));
  const firstInvented = career.eras.find((era) => era.invented);
  const cards = career.dated
    .filter((card) => card.year <= year)
    .map((card) => ({ year: card.year, name: card.name, shift: isShift(card) }));
  const notice = upcomingShift(game.turn, config);
  const shiftName = notice === null ? "" : (findCard(notice.cardId, config)?.name ?? "");
  const shift: ShiftView | null =
    notice === null
      ? null
      : {
          name: shiftName,
          year: notice.year,
          yearsAway: notice.yearsAway,
          ceiling: notice.ceiling,
          text: `A platform shift comes in ${notice.year} (${shiftName}), ${notice.yearsAway === 1 ? "next year" : `in ${notice.yearsAway} years`}: that year no product keeps more than quality ${notice.ceiling}.`,
        };
  return {
    year,
    firstYear: career.firstYear,
    lastYear,
    era: eras[currentIndex],
    eras,
    historyEnds: firstInvented === undefined ? lastYear : firstInvented.firstYear - 1,
    cards,
    shift,
    marks: marksOf(record, config),
  };
};

export interface CareerStatusView {
  /** "2021 · year 32 of 49" */
  readonly heading: string;
  readonly eraName: string;
  readonly invented: boolean;
  readonly office: { readonly name: string; readonly capacity: number; readonly headcount: number };
  readonly nextOffice: { readonly name: string; readonly capacity: number } | null;
  readonly listedYear: number | null;
  readonly rescueYear: number | null;
  readonly boardPaused: boolean;
}

/** The year's status: which year, which era, the office and the next one, and what the company has used up. Null in a race. */
export const careerStatusView = (game: GameState, config: RulesConfig): CareerStatusView | null => {
  const career = rulesForTurn(config, game.turn).career;
  if (career === undefined) return null;
  const self = game.companies[PLAYER_ID];
  const officeIndex = self.career?.office ?? 0;
  const office = career.offices[officeIndex];
  const next = career.offices[officeIndex + 1];
  const era = career.eras[eraIndexOf(game.turn, career)];
  const listed = self.career?.listed ?? null;
  const rescue = self.career?.rescue ?? null;
  return {
    heading: `${yearOf(game.turn, career)} · year ${game.turn} of ${config.game.maxTurns}`,
    eraName: era.name,
    invented: era.invented,
    office: { name: office.name, capacity: office.capacity, headcount: self.headcount },
    nextOffice: next === undefined ? null : { name: next.name, capacity: next.capacity },
    listedYear: listed === null ? null : yearOf(listed.turn, career),
    rescueYear: rescue === null ? null : yearOf(rescue.turn, career),
    boardPaused: boardPaused(self, game.turn),
  };
};

/** The year a card in force is dated to, or null for a random draw (and always in a race). */
export const datedYear = (event: ActiveEvent | null, turn: number, config: RulesConfig): number | null => {
  if (event === null) return null;
  const card = datedCardFor(turn, config);
  return card !== null && card.id === event.cardId ? card.year : null;
};
