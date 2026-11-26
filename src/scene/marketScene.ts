/**
 * The game's state as a market scene: the four companies as buildings sized by their users, the share of last
 * year's new users each one won, and the bar for going public on the same scale.
 *
 * Like the office scene, this reads the rules engine and takes only types from the world. Every company, the
 * player's included, is read through `publicCompany`, and every report of the log through `publicReport`, so a
 * rival's books and plans cannot reach the market. It is pure: the same input gives an equal scene.
 */

import { eraIndexOf, publicCompany, publicReport, rulesForTurn, yearOf } from "../engine/index";
import type { GameState, RulesConfig, TurnLog } from "../engine/index";
import type { MarketCompany, MarketScene } from "../world/types/market";

export interface MarketSceneInput {
  readonly game: GameState;
  /** The year just played; null before any year was. */
  readonly log: TurnLog | null;
  readonly config: RulesConfig;
  /** The game's seed. The store has it; the state does not. */
  readonly seed: number;
}

/** The lowest building a company with any users gets, so a small company stays visible. */
export const MIN_HEIGHT = 0.04;

/** The users at the top of the market's scale: a quarter above the bar, or the most users if more, and never 0. */
export const marketTop = (barUsers: number, users: readonly number[]): number =>
  Math.max(1.25 * Math.max(0, barUsers), ...users.map((count) => (Number.isFinite(count) ? count : 0)), 1);

/** A building's height on that scale: the square root of its share of the top. */
export const marketHeight = (users: number, top: number): number =>
  !(users > 0) || !(top > 0) ? 0 : Math.max(MIN_HEIGHT, Math.sqrt(users / top));

/** The player's seat. */
const PLAYER = 0;

export const marketSceneFor = ({ game, log, config, seed }: MarketSceneInput): MarketScene => {
  const rules = config.career;
  const player = game.companies[PLAYER] as GameState["companies"][number] | undefined;
  if (rules === undefined || rules.eras.length === 0 || player?.career === undefined) {
    throw new Error("a market scene needs a career game");
  }

  const shown = game.companies.map(publicCompany);
  const reports = log === null ? [] : log.companies.map((report) => (report === null ? null : publicReport(report)));
  const pool = log === null ? 0 : Math.max(0, log.market.pool);
  const barUsers = rulesForTurn(config, game.turn).ipo.users;
  const top = marketTop(barUsers, shown.map((company) => (company.out === null ? company.users : 0)));

  const companies = shown.map((company, seat): MarketCompany => {
    const out = company.out !== null;
    const won = reports.at(seat)?.users.won ?? 0;
    const founded = company.career?.founded ?? 1;
    return {
      seat,
      name: company.name,
      state: out ? "out" : seat === PLAYER ? "player" : "rival",
      users: out ? 0 : company.users,
      height: out ? 0 : marketHeight(company.users, top),
      won: pool > 0 ? Math.min(1, Math.max(0, won / pool)) : 0,
      listed: (company.career?.listed ?? null) !== null,
      newcomer: founded === game.turn && founded > 1,
    };
  });

  return {
    runId: `${seed}:${PLAYER}:${player.career.founded}`,
    year: yearOf(game.turn, rules),
    era: rules.eras[eraIndexOf(game.turn, rules)].id,
    barUsers,
    bar: marketHeight(barUsers, top),
    pool,
    companies,
  };
};

const sameCompany = (a: MarketCompany, b: MarketCompany): boolean =>
  a.seat === b.seat &&
  a.name === b.name &&
  a.state === b.state &&
  a.users === b.users &&
  a.height === b.height &&
  a.won === b.won &&
  a.listed === b.listed &&
  a.newcomer === b.newcomer;

/** Two scenes are the same when every field is, the companies compared field by field. */
export const sameMarketScene = (a: MarketScene, b: MarketScene): boolean =>
  a === b ||
  (a.runId === b.runId &&
    a.year === b.year &&
    a.era === b.era &&
    a.barUsers === b.barUsers &&
    a.bar === b.bar &&
    a.pool === b.pool &&
    a.companies.length === b.companies.length &&
    a.companies.every((company, index) => sameCompany(company, b.companies[index])));
