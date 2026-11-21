import type { QuirkId } from "../../types/game";

// People tuning: the `S` rows of TYCOON-SPEC §5.7. Leaf module (types only).
// BALANCE may change any VALUE here after hand-over; nobody renames a constant. Shared roster numbers
// (ROSTER_CAP, SKILL_SLOPE, ENERGY_FULL, BURNOUT_ENERGY, the crunch drains, LEAD_LOSS, QUIRKS, ...) live in tycoon/constants.ts.

// ── Candidates (`recruit <role>`, §4.3, §5.3) ──

/** Three faces per role per week: enough to choose, few enough to read in a terminal. */
export const CANDIDATES_PER_ROLE = 3;
/** Weights for a stat of 1..5. Mean 2.85; a 5 is a 5% event per stat, so a 5/5 is a genuine find. */
export const CANDIDATE_STAT_WEIGHTS = [10, 26, 38, 21, 5];
/** Talent pull: reputation counts up to 0.6 of the pull at reputation 100 ("people want to work here"). */
export const TALENT_PULL_REP = 0.6;
/** Talent pull per whole HR head, for at most TALENT_PULL_HR_MAX heads: HR finally earns its keep. */
export const TALENT_PULL_HR = 0.15;
export const TALENT_PULL_HR_MAX = 2;
/** The visionary founder is a talent magnet. */
export const TALENT_PULL_VISIONARY = 0.1;
/** The rainmaker cofounder knows everybody. */
export const TALENT_PULL_RAINMAKER = 0.1;
/** x talentPull: the chance that ONE stat of a candidate comes in a point higher (a company people want to join). */
export const TALENT_BONUS_CHANCE = 0.5;
/** Market candidates are more colourful than job ads (0.25, tycoon/constants). */
export const CANDIDATE_QUIRK_CHANCE = 0.4;
/** Résumé inflation without HR: +0 / +1 / +2 on one stat (capped at 5). The gamble HR removes. */
export const RESUME_INFLATION_WEIGHTS = [40, 40, 20];
/** Whole HR heads needed to vet résumés, and for every other "with HR" rule (notice, fallout, offers, recovery). */
export const HR_MIN_HEADS = 1;
/** Asks land between 0.92x and 1.12x the going rate for the CLAIMED stats: bargains and premiums. */
export const ASK_MIN = 0.92;
export const ASK_SPAN = 0.2;
/** Mercenaries ask 10% more, believers 10% less. */
export const QUIRK_ASK: Record<QuirkId, number> = { cowboy: 1, craftsperson: 1, firefighter: 1, glue: 1, mercenary: 1.1, believer: 0.9 };

// ── Outside offers and notice (tick N2, §5.3) ──

/** Average people almost never get calls ... */
export const OFFER_BASE = 0.002;
/** ... plus 0.6 points per point of pace + craft above 6: a 5/5 hears from a recruiter about 2.6% of weeks. */
export const OFFER_PER_SKILL = 0.006;
/** Leading a SOLID-or-better release makes you visible: ~40% chance of an offer over the next six weeks. */
export const OFFER_LED_BONUS = 0.08;
export const OFFER_LED_WEEKS = 6;
/** Tired people (energy under 50) take the call. */
export const OFFER_TIRED_BONUS = 0.04;
export const OFFER_TIRED_ENERGY = 50;
/** Recruiters have mercenaries on speed dial. */
export const OFFER_MERCENARY_MULT = 2;
/** Keeping people is HR's job. */
export const OFFER_HR_MULT = 0.6;
/** ... and the operator cofounder's. */
export const OFFER_OPERATOR_MULT = 0.8;
/** No offers in the first month. */
export const OFFER_MIN_TENURE = 4;
/** A retain buys a quarter of quiet. */
export const OFFER_IMMUNITY_WEEKS = 12;
/** At most 1 + floor(roster / 12) new notices per tick: no mass walk-outs, no chore. */
export const OFFERS_PER_TICK_DIVISOR = 12;
/** Two `end`s of warning; HR negotiates a third. */
export const OFFER_NOTICE_WEEKS = 2;
export const OFFER_NOTICE_WEEKS_HR = 3;

// ── Retain, fire, departures (§4.4, §4.5, §5.3) ──

/** A known, deterministic price: two weeks' pay now ... */
export const RETAIN_BONUS_WEEKS = 2;
/** ... and a permanent 10% raise (rounded to $50), at least RETAIN_MIN_RAISE. */
export const RETAIN_RAISE = 0.1;
export const RETAIN_MIN_RAISE = 50;
/** Retained people take the week they were owed: energy back to at least 60. */
export const RETAIN_ENERGY_FLOOR = 60;
/** Two weeks' severance per person: makes hire/fire loops a strict loss. */
export const SEVERANCE_WEEKS = 2;
/** Layoff fallout: morale -3 and cohesion -2 for one person, +2 each per extra person, capped at 12 / 10; HR halves it (min 1). */
export const FIRE_MORALE = 3;
export const FIRE_COHESION = 2;
export const FIRE_PER_EXTRA = 2;
export const FIRE_MORALE_CAP = 12;
export const FIRE_COHESION_CAP = 10;
export const FIRE_HR_FACTOR = 0.5;
/** A layoff of 3+ moves activist and old-guard directors +2 confidence and cheerleaders -2. */
export const LAYOFF_BOARD_MIN = 3;
export const LAYOFF_BOARD_DELTA = 2;
/** A resignation is felt: morale -2, cohesion -1; losing glue is felt more (cohesion -3). */
export const DEPART_MORALE = 2;
export const DEPART_COHESION = 1;
export const GLUE_DEPART_COHESION = 3;

// ── Energy (tick N2, §5.3) ──

/** Weekly recovery for everyone who did not crunch: 5, +2 with HR ... */
export const ENERGY_RECOVERY = 5;
export const ENERGY_RECOVERY_HR = 2;
/** ... plus round(0.5 x Σ asset moraleBoost), at most +3 (office upgrade +1, lounge +2, yacht +3). */
export const ENERGY_RECOVERY_ASSET_FACTOR = 0.5;
export const ENERGY_RECOVERY_ASSET_MAX = 3;

/** Card and `team` words, highest band first; the 3D bands use the same thresholds. */
export const ENERGY_WORDS = [
  { min: 85, word: "fresh" },
  { min: 60, word: "fine" },
  { min: 45, word: "tired" },
  { min: 30, word: "running on fumes" },
  { min: Number.NEGATIVE_INFINITY, word: "burnt out" },
] as const;
/** "Tired" for `status` and the `team` sort: below the "fine" band. */
export const TIRED_BELOW = 60;
/** The priority-8 hint fires for people on a crunching build in the "running on fumes" band (30..44). */
export const FUMES_FROM = 30;
export const FUMES_BELOW = 45;

// ── Attention budget ──

/** At most three people lines a week in `end`, then "(+N more people news ...)". */
export const MAX_PEOPLE_LINES = 3;
/** `team` shows twelve rows; `team all` shows everyone. */
export const TEAM_LIST_MAX = 12;
/** Default number of people `rosterForWorld` returns (the 3D office's visible characters). */
export const WORLD_ROSTER_LIMIT = 64;
