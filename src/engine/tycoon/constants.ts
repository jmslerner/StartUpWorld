import type { BuildSize, BuildType, QuirkId, TeamRole } from "../../types/game";

// Shared tycoon constants: the `F` rows of TYCOON-SPEC §5.7. Leaf module (types only).
// People tuning lives in people/constants.ts (STAFF), build tuning in projects/constants.ts (PROJECTS).
//
// FROZEN (changing them breaks G3, determinism or the save format; BALANCE never touches them):
//   ROSTER_CAP, ROLE_ORDER, SKILL_SLOPE, JOB_AD_TEMPERAMENTS (every row sums to 6), ENERGY_FULL,
//   PEOPLE_SALT, PRODUCT_SALT, QUIRKS, PERSON_NAME_MAX, NAME_MAX.
// Every other value here may be retuned by BALANCE; after any change re-run E1 and E2 as well as E4.

// ── Roster ──
export const ROSTER_CAP = 120;
export const ROLE_ORDER: TeamRole[] = ["engineering", "design", "product", "data", "marketing", "sales", "ops", "hr", "legal", "executive"];
export const SKILL_SLOPE = 0.1; // value per point of (pace + craft) away from 6; the going rate uses the same slope
export const ENERGY_FULL = 60; // at or above this, energy costs nothing
export const ENERGY_FLOOR_FACTOR = 0.6; // output factor at energy 0
export const ATTENTION = 0.7; // share of the day job someone on a build still does (weekly growth/churn only)
export const SALARY_STEP = 50; // salaries round to $50

/** [pace, craft, weight]: every row sums to 6, so a job-ad hire is worth exactly one standard head. */
export const JOB_AD_TEMPERAMENTS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 3, 50],
  [4, 2, 20],
  [2, 4, 20],
  [5, 1, 5],
  [1, 5, 5],
];
export const JOB_AD_QUIRK_CHANCE = 0.25;
export const QUIRKS: QuirkId[] = ["cowboy", "craftsperson", "firefighter", "glue", "mercenary", "believer"];

// ── What a person's work is worth on a build ──
export const CRAFT_BASE = 10;
export const CRAFT_STEP = 15; // craftScore = 10 + 15 x craftLevel: 25 / 40 / 55 / 70 / 85 (100 for a craftsperson 5)
export const EXPERIENCE_BONUS = 3; // craftScore per credited release ...
export const EXPERIENCE_MAX = 5; // ... for the first five
export const LEAD_LOSS = 0.25; // share of progress (and of qSum / qPts) a departing lead takes along

// ── Energy (shared by the people week and the crunch rules) ──
export const ENERGY_CRUNCH_DRAIN = 15;
export const ENERGY_CRUNCH_DRAIN_FIREFIGHTER = 8;
export const ENERGY_CRUNCH_DRAIN_BELIEVER = 20;
export const BURNOUT_ENERGY = 30; // below this an engaged person hands in notice (no roll)

// ── Bounds shared with the normalizer ──
export const POLISH_MAX = 9;
export const SURPRISE_MAX = 3;
export const RELEASE_LOG_MAX = 12;
export const NAME_MAX = 24; // build display name and slug
export const PERSON_NAME_MAX = 40;
export const ACTIVE_BUILDS_MAX = 3; // the most slots any phase has; the normalizer keeps at most this many
export const CANDIDATE_POOL_MAX = 3; // the normalizer keeps at most this many candidates per role

// ── RNG stream salts (independent of state.rng) ──
export const PEOPLE_SALT = 0x85ebca6b;
export const PRODUCT_SALT = 0xc2b2ae35;

// ── Discovery: weeks in which a landed patch's first line mentions `build` (§4.9) ──
export const DISCOVERY_WEEKS = { from: 3, to: 12 } as const;

// ── Build vocabulary ──
export const BUILD_TYPES: BuildType[] = ["feature", "growth", "premium", "plumbing", "moonshot"];
export const BUILD_SIZES: BuildSize[] = ["s", "m", "l", "xl"];

/**
 * Who can work on what (§5.4). The single role-fit table: staffing, the lead rule and the views all read it.
 * A role missing from a type (and HR everywhere) has fit 0 and can never be staffed on that type.
 */
export const ROLE_FIT: Record<BuildType, Partial<Record<TeamRole, number>>> = {
  feature: { engineering: 1, design: 1, product: 0.8, data: 0.5 },
  growth: { marketing: 1, data: 1, product: 0.8, engineering: 0.6, design: 0.6, sales: 0.5 },
  premium: { sales: 1, engineering: 0.8, product: 0.8, legal: 0.8, executive: 0.6, ops: 0.5 },
  plumbing: { engineering: 1, ops: 1, data: 0.6, product: 0.4 },
  moonshot: { engineering: 1, data: 1, design: 0.6, product: 0.6 },
};
