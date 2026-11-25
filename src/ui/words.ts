// Every word for a period of play: the race counts quarters, a career counts years. Screens take their words from
// here so a career never says "quarter" or "turn".

import { yearOf } from "../engine/career";
import type { RulesConfig } from "../engine/types";
import { quarter, quartersLeft, runwayText, yearRunwayText, yearsLeft } from "./format";

export interface Words {
  readonly career: boolean;
  /** "quarter" or "year". */
  readonly period: string;
  /** "quarters" or "years". */
  readonly periods: string;
  /** "Quarterly" or "Annual". */
  readonly report: string;
  /** A turn by name: "Q3" or "1992". */
  readonly when: (turn: number) => string;
  /** A count of runway units: "2 turns" in the race, "2 years" in a career. */
  readonly units: (n: number) => string;
  /** A short count for tight spaces: "1 qtr", "3 qtrs" in the race; "1 yr", "3 yrs" in a career. */
  readonly short: (n: number) => string;
  readonly runway: (runway: number | null) => string;
  readonly left: (turnsLeft: number) => string;
}

const counted = (one: string, many: string) => (n: number): string => `${n} ${n === 1 ? one : many}`;

const RACE: Words = {
  career: false,
  period: "quarter",
  periods: "quarters",
  report: "Quarterly",
  when: quarter,
  units: counted("turn", "turns"),
  short: counted("qtr", "qtrs"),
  runway: runwayText,
  left: quartersLeft,
};

export const wordsFor = (config: RulesConfig): Words => {
  const career = config.career;
  if (career === undefined) return RACE;
  return {
    career: true,
    period: "year",
    periods: "years",
    report: "Annual",
    when: (turn) => String(yearOf(turn, career)),
    units: counted("year", "years"),
    short: counted("yr", "yrs"),
    runway: yearRunwayText,
    left: yearsLeft,
  };
};
