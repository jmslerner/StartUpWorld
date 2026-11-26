/**
 * The game's state as an office scene: the one thing the 3D office is given.
 *
 * This is the only file that knows both sides. It reads the rules engine, and from the world takes types only, so
 * the 3D code never loads with it. It is pure: the same input gives an equal scene.
 *
 * What is shown is the year about to be played. The people are those of the plan for that year, the draft being
 * edited or, without one, the company's last plan, always as the engine's own plan check resolves it for this
 * turn. So the three teams, the person away raising money and the people let go add up to the head count, whatever
 * the draft says.
 */

import { eraIndexOf, normalizePlan, yearOf } from "../engine/index";
import type { CompanyId, GameState, Plan, RulesConfig } from "../engine/index";
import type { OfficeIndex, OfficeScene } from "../world/types/scene";

export interface OfficeSceneInput {
  readonly game: GameState;
  readonly companyId: CompanyId;
  readonly config: RulesConfig;
  /** The game's seed. The store has it; the state does not. */
  readonly seed: number;
  /** The plan being drafted for the coming year. Without one, the company's last plan. */
  readonly draft?: Plan;
  /** Hires the projection expects for that plan. 0 without one. */
  readonly expectedHires?: number;
}

/** The world draws five offices, whatever the config lists. */
const LAST_OFFICE = 4;

const whole = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

export const officeSceneFor = ({ game, companyId, config, seed, draft, expectedHires }: OfficeSceneInput): OfficeScene => {
  const rules = config.career;
  const company: GameState["companies"][number] | undefined = game.companies[companyId];
  const career = company?.career;
  // A career without eras is no career: said here, in this builder's words, before the engine is asked anything.
  if (rules === undefined || rules.eras.length === 0 || company === undefined || career === undefined) {
    throw new Error("an office scene needs a career game");
  }

  const office = Math.min(whole(career.office), LAST_OFFICE, Math.max(0, rules.offices.length - 1)) as OfficeIndex;
  // A company that is out plans nothing: a draft left over for it is not read, so nobody of it is shown away or leaving.
  const { plan } = normalizePlan(game, companyId, company.out === null ? (draft ?? null) : null, config);
  const { product, growth, recruiting } = plan.allocation;

  let ending: OfficeScene["ending"] = null;
  if (game.outcome !== null) ending = game.outcome.winnerId === companyId ? "won" : "lost";
  else if (company.out !== null) ending = "lost";

  return {
    runId: `${seed}:${companyId}:${career.founded}`,
    seed,
    year: yearOf(game.turn, rules),
    office,
    capacity: rules.offices.at(office)?.capacity ?? 0,
    era: rules.eras[eraIndexOf(game.turn, rules)].id,
    teams: { product, growth, recruiting },
    away: plan.raisePercent > 0 ? 1 : 0,
    leaving: plan.layoffs,
    arriving: whole(expectedHires),
    ending,
  };
};

/** Two scenes are the same when every field is, the teams compared person by person. */
export const sameOfficeScene = (a: OfficeScene, b: OfficeScene): boolean =>
  a === b ||
  (a.runId === b.runId &&
    a.seed === b.seed &&
    a.year === b.year &&
    a.office === b.office &&
    a.capacity === b.capacity &&
    a.era === b.era &&
    a.teams.product === b.teams.product &&
    a.teams.growth === b.teams.growth &&
    a.teams.recruiting === b.teams.recruiting &&
    a.away === b.away &&
    a.leaving === b.leaving &&
    a.arriving === b.arriving &&
    a.ending === b.ending);
