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
  if (rules === undefined || company === undefined || career === undefined) throw new Error("an office scene needs a career game");

  const office = Math.min(whole(career.office), LAST_OFFICE, Math.max(0, rules.offices.length - 1)) as OfficeIndex;
  const { plan } = normalizePlan(game, companyId, draft ?? null, config);
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
    era: rules.eras.at(eraIndexOf(game.turn, rules))?.id ?? "",
    teams: { product, growth, recruiting },
    away: plan.raisePercent > 0 ? 1 : 0,
    leaving: plan.layoffs,
    arriving: whole(expectedHires),
    ending,
  };
};
