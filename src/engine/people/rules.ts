import type { Build, Employee, GameState, TeamRole } from "../../types/game";
import {
  ENERGY_CRUNCH_DRAIN, ENERGY_CRUNCH_DRAIN_BELIEVER, ENERGY_CRUNCH_DRAIN_FIREFIGHTER, ROLE_ORDER,
} from "../tycoon/constants";
import { roleComp } from "../tycoon/comp";
import { findEmployee, leadLossBuild, leadOf, payrollDelta, round50, wantOf } from "../tycoon/roster";
import { ASSET_CATALOG } from "../assets";
import { clamp } from "../utils";
import {
  DEPART_COHESION, DEPART_MORALE, ENERGY_RECOVERY, ENERGY_RECOVERY_ASSET_FACTOR, ENERGY_RECOVERY_ASSET_MAX, ENERGY_RECOVERY_HR,
  ENERGY_WORDS, FIRE_COHESION, FIRE_COHESION_CAP, FIRE_HR_FACTOR, FIRE_MORALE, FIRE_MORALE_CAP, FIRE_PER_EXTRA, GLUE_DEPART_COHESION,
  HR_MIN_HEADS, OFFER_BASE, OFFER_HR_MULT, OFFER_IMMUNITY_WEEKS, OFFER_LED_BONUS, OFFER_LED_WEEKS, OFFER_MERCENARY_MULT, OFFER_MIN_TENURE,
  OFFER_NOTICE_WEEKS, OFFER_NOTICE_WEEKS_HR, OFFER_OPERATOR_MULT, OFFER_PER_SKILL, OFFER_TIRED_BONUS, OFFER_TIRED_ENERGY,
  RETAIN_BONUS_WEEKS, RETAIN_MIN_RAISE, RETAIN_RAISE, SEVERANCE_WEEKS,
} from "./constants";
import type { EnergyWord } from "./view";

// The people formulas of TYCOON-SPEC §5.3, as small pure functions. No RNG, no state changes.
// Shared by the commands, the weekly step and the view selectors so every surface prints the same numbers.

/** At least one whole HR head: résumés are vetted, notice is three weeks, fallout halves, recruiters get less far. */
export const hasHr = (state: GameState): boolean => wantOf(state.team.hr) >= HR_MIN_HEADS;

export const energyWordOf = (energy: number): EnergyWord => {
  for (const band of ENERGY_WORDS) if (energy >= band.min) return band.word;
  return "burnt out";
};

/** Weeks of notice an outside offer or a burnout gives. */
export const noticeWeeks = (state: GameState): number => (hasHr(state) ? OFFER_NOTICE_WEEKS_HR : OFFER_NOTICE_WEEKS);

/** `retain`: two weeks of current pay, up front. */
export const retainBonus = (e: Pick<Employee, "salary">): number => RETAIN_BONUS_WEEKS * e.salary;
/** `retain`: the new salary, a permanent 10% raise rounded to $50, never less than +$50. */
export const retainSalary = (e: Pick<Employee, "salary">): number => Math.max(e.salary + RETAIN_MIN_RAISE, round50(e.salary * (1 + RETAIN_RAISE)));
/** `fire`: two weeks of this person's pay. */
export const severanceOf = (salary: number): number => SEVERANCE_WEEKS * salary;

/**
 * Weekly chance that a recruiter gets through to this person (before the per-tick cap). 0 for anyone the player never
 * worked with, anyone already holding notice, believers, the first month, and twelve weeks after a retain.
 */
export const offerChance = (state: GameState, e: Employee): number => {
  if (!e.engaged || e.offerDueWeek > 0 || e.quirk === "believer") return 0;
  if (state.week - e.hiredWeek < OFFER_MIN_TENURE) return 0;
  if (e.retainedWeek > 0 && state.week - e.retainedWeek <= OFFER_IMMUNITY_WEEKS) return 0;
  let p = OFFER_BASE + OFFER_PER_SKILL * Math.max(0, e.pace + e.craft - 6);
  if (e.ledWeek > 0 && state.week - e.ledWeek <= OFFER_LED_WEEKS) p += OFFER_LED_BONUS;
  if (e.energy < OFFER_TIRED_ENERGY) p += OFFER_TIRED_BONUS;
  if (e.quirk === "mercenary") p *= OFFER_MERCENARY_MULT;
  if (hasHr(state)) p *= OFFER_HR_MULT;
  if (state.cofounder.archetype === "operator") p *= OFFER_OPERATOR_MULT;
  return p;
};

/** What a crunch week takes out of this person. */
export const crunchDrain = (e: Pick<Employee, "quirk">): number =>
  e.quirk === "firefighter" ? ENERGY_CRUNCH_DRAIN_FIREFIGHTER : e.quirk === "believer" ? ENERGY_CRUNCH_DRAIN_BELIEVER : ENERGY_CRUNCH_DRAIN;

/** What a week without crunch gives back: 5, +2 with HR, + round(0.5 x Σ asset moraleBoost) capped at 3. */
export const energyRecovery = (state: GameState): number => {
  const boost = (state.assets ?? []).reduce((acc, a) => acc + (ASSET_CATALOG[a.id]?.effects.moraleBoost ?? 0), 0);
  return ENERGY_RECOVERY + (hasHr(state) ? ENERGY_RECOVERY_HR : 0) + Math.min(ENERGY_RECOVERY_ASSET_MAX, Math.round(boost * ENERGY_RECOVERY_ASSET_FACTOR));
};

/** Layoff fallout for `count` people (§4.5): morale and cohesion points to subtract. */
export const fireFallout = (count: number, withHr: boolean): { morale: number; cohesion: number } => {
  const half = withHr ? FIRE_HR_FACTOR : 1;
  const extra = FIRE_PER_EXTRA * (count - 1);
  return {
    morale: Math.max(1, Math.round(Math.min(FIRE_MORALE_CAP, FIRE_MORALE + extra) * half)),
    cohesion: Math.max(1, Math.round(Math.min(FIRE_COHESION_CAP, FIRE_COHESION + extra) * half)),
  };
};

/** A resignation (§5.3): morale -2, cohesion -1, glue -3. */
export const departFallout = (e: Pick<Employee, "quirk">): { morale: number; cohesion: number } => ({
  morale: DEPART_MORALE,
  cohesion: e.quirk === "glue" ? GLUE_DEPART_COHESION : DEPART_COHESION,
});

/** Subtracts morale and cohesion, clamped 0..100. */
export const hurtCulture = (state: GameState, hit: { morale: number; cohesion: number }): GameState => ({
  ...state,
  culture: {
    ...state.culture,
    cohesion: clamp(state.culture.cohesion - hit.cohesion, 0, 100),
    morale: clamp(state.culture.morale - hit.morale, 0, 100),
  },
});

/** Payroll as `team` prints it: every head at the standard salary, plus what the named people really earn. */
export const totalPayroll = (state: GameState): number =>
  ROLE_ORDER.reduce((acc, role) => acc + headsOf(state, role) * roleComp[role].salary, 0) + payrollDelta(state);

/** Headcount of a role including fractions (`hire ux 1.5`), ignoring junk values. */
export const headsOf = (state: GameState, role: TeamRole): number => {
  const x = state.team[role];
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export const firstName = (e: Pick<Employee, "name">): string => e.name.split(" ")[0];

/** The shortest handle that names this person in a command: their first name if it is unambiguous, else their id. */
export const handleOf = (state: GameState, e: Employee): string => {
  const first = firstName(e).toLowerCase();
  const found = findEmployee(state, first);
  return found.ok && found.employee.id === e.id ? first : e.id;
};

/** The build a departure of `e` would cost a quarter of (the notice build, else the build they lead now). */
export const buildAtRisk = (state: GameState, e: Employee): Build | null => leadLossBuild(state, e);

/** Active build by id (null when it is gone). */
export const buildById = (state: GameState, id: string | null): Build | null =>
  id === null ? null : (state.product?.active ?? []).find((b) => b.id === id) ?? null;

/** True when the person is the lead of the build they are staffed on. */
export const isLeadNow = (state: GameState, e: Employee): boolean => {
  const b = buildById(state, e.buildId);
  return b !== null && leadOf(state, b)?.id === e.id;
};
