// The career's own rules, as pure functions. They apply only to a config that has a `career` block; the race's
// config has none. The rules are recorded in docs/career-rules.md.

import type { ActiveEvent, CareerRules, DatedCard, EventCard, EventEffect, RulesConfig } from "./types";

/** The calendar year a turn is played in: turn 1 is the career's first year. */
export const yearOf = (turn: number, career: CareerRules): number => career.firstYear + turn - 1;

/** The turn a calendar year is played in. */
export const turnOf = (year: number, career: CareerRules): number => year - career.firstYear + 1;

/** The era a turn falls in: the last one to have started by that year. */
export const eraIndexOf = (turn: number, career: CareerRules): number => {
  const year = yearOf(turn, career);
  let index = 0;
  for (const [i, era] of career.eras.entries()) if (era.firstYear <= year) index = i;
  return index;
};

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `values` laid over `base`: plain objects are merged key by key, lists and other leaves replaced. Neither is changed. */
const overlay = (base: unknown, values: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(values)) return values;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) merged[key] = overlay(base[key], value);
  return merged;
};

/** Each config's numbers for each of its eras, by era index, made once. */
const erasOf = new WeakMap<RulesConfig, RulesConfig[]>();
/** The config each of those was made from, so one can be handed back in place of the config. */
const configOf = new WeakMap<RulesConfig, RulesConfig>();

/**
 * The numbers in force on a turn: the config itself without a career; with one, the config with the turn's era's
 * values laid over it, keeping `career`. The same object for every turn of an era, and it may be passed back in
 * place of the config.
 */
export const rulesForTurn = <C extends RulesConfig>(config: C, turn: number): C => {
  const game = configOf.get(config) ?? config;
  const career = game.career;
  if (career === undefined) return config;
  const index = eraIndexOf(turn, career);
  let eras = erasOf.get(game);
  if (eras === undefined) {
    eras = [];
    erasOf.set(game, eras);
  }
  if (eras[index] === undefined) {
    const rules = { ...(overlay(game, career.eras[index].values) as RulesConfig), career };
    eras[index] = rules;
    configOf.set(rules, game);
  }
  return eras[index] as C;
};

/** The turn the market curve is read at: the turn itself in a race, the year's place in its era in a career. */
export const marketTurn = (config: RulesConfig, turn: number): number => {
  const career = config.career;
  if (career === undefined) return turn;
  return yearOf(turn, career) - career.eras[eraIndexOf(turn, career)].firstYear + 1;
};

/** The card dated to a turn's year, or null: always null without a career. */
export const datedCardFor = (turn: number, config: RulesConfig): DatedCard | null => {
  const career = config.career;
  if (career === undefined) return null;
  const year = yearOf(turn, career);
  return career.dated.find((card) => card.year === year) ?? null;
};

/** A card by id: in the config's deck, in the deck of any of a career's eras, or among a career's dated cards. */
export const findCard = (cardId: string, config: RulesConfig): Omit<EventCard, "weight"> | undefined =>
  [config.events.deck, ...(config.career?.eras ?? []).map((era) => era.values.events?.deck ?? []), config.career?.dated ?? []]
    .flat()
    .find((card) => card.id === cardId);

type QualityCeiling = Extract<EventEffect, { kind: "qualityCeiling" }>;

/** A card's ceiling on quality, if it has one. */
const ceilingOf = (card: Omit<EventCard, "weight"> | null | undefined): QualityCeiling | undefined =>
  card?.effects.find((effect): effect is QualityCeiling => effect.kind === "qualityCeiling");

/**
 * The ceiling that holds through a year, or null: that of the year's card when its `turns` is 1. A ceiling with
 * `turns` 0 is a cut made once, as the year opens, and holds nothing after. Always null without a career.
 */
export const heldCeiling = (event: ActiveEvent | null, config: RulesConfig): number | null => {
  if (config.career === undefined || event === null) return null;
  const ceiling = ceilingOf(findCard(event.cardId, config));
  return ceiling !== undefined && ceiling.turns === 1 ? ceiling.ceiling : null;
};

/** A platform shift on its way: its card, its year, how many years off it is, and its ceiling on quality. */
export interface ShiftNotice {
  readonly cardId: string;
  readonly year: number;
  readonly yearsAway: number;
  readonly ceiling: number;
}

/**
 * The first dated card with a ceiling on quality in the `shiftNoticeYears` years after a turn's, or null. A shift
 * is not announced in its own year. Always null without a career.
 */
export const upcomingShift = (turn: number, config: RulesConfig): ShiftNotice | null => {
  const career = config.career;
  if (career === undefined) return null;
  for (let yearsAway = 1; yearsAway <= career.shiftNoticeYears; yearsAway++) {
    const card = datedCardFor(turn + yearsAway, config);
    const ceiling = ceilingOf(card);
    if (card !== null && ceiling !== undefined) return { cardId: card.id, year: card.year, yearsAway, ceiling: ceiling.ceiling };
  }
  return null;
};

/** The office for a team of this size: the smallest that holds it, or the last one when none does. */
export const officeFor = (headcount: number, career: CareerRules): number => {
  const smallest = career.offices.findIndex((office) => office.capacity >= headcount);
  return smallest === -1 ? career.offices.length - 1 : smallest;
};
