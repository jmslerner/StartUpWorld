import type {
  BuildSize, BuildType, CofounderArchetype, CompanyPhase, FounderArchetype, PricingModel, ReceptionTier,
} from "../../types/game";

// Build tuning: the `P` rows of TYCOON-SPEC §5.7. Leaf module (types only).
// BALANCE may change VALUES here after hand-over; nobody renames them. Role fit is NOT here: ROLE_FIT in
// tycoon/constants.ts is the single role-fit table (staffing, the lead rule and the views all read it).
// Shared bounds (POLISH_MAX, SURPRISE_MAX, RELEASE_LOG_MAX, NAME_MAX, ACTIVE_BUILDS_MAX) and the energy rules live in
// tycoon/constants.ts as well.

// ── Who does the work (§5.4 "one week of work") ──

/** Points per week by pace 1..5 (index 0 unused). A standard 3 moves one point a week. */
export const PACE_OUT = [0, 0.6, 0.8, 1.0, 1.2, 1.4];
/** The founder's own hands on the oldest build while the company is small (hacker: 0.75). The founders are most of a garage team. */
export const FOUNDER_HANDS = 0.4;
export const FOUNDER_HANDS_HACKER = 0.75;
/** The cofounder's hands, by archetype: the builder codes, the rainmaker mostly takes calls. */
export const COFOUNDER_HANDS: Record<CofounderArchetype, number> = { operator: 0.4, builder: 0.75, rainmaker: 0.2, powderkeg: 0.5 };
/** The craft score of the founders' hands (a builder cofounder raises it). */
export const HANDS_CRAFT = 55;
export const HANDS_CRAFT_BUILDER = 65;
/** Above this headcount the founders stop pitching in: no zero-staff progress in a real company (jury probe). */
export const FOUNDER_HANDS_MAX_HEADS = 10;
/** Share of a week's quality set by the lead alone: one star moves a release about a tier. */
export const LEAD_WEIGHT = 0.5;
/** Output in the week someone joins a build: re-staffing is never free. */
export const RAMP = 0.5;
/** Crunch: x1.5 output, that week's quality x0.9, +1 cruft per week worked. A one- or two-week push is about neutral; the habit costs. */
export const CRUNCH_SPEED = 1.5;
export const CRUNCH_QUALITY = 0.9;
export const CRUNCH_CRUFT = 1;
/** Quirk speeds: glue lifts the whole build (once per build), cowboys rush, craftspeople fuss. */
export const GLUE_SPEED = 1.1;
export const COWBOY_SPEED = 1.25;
export const CRAFTSPERSON_SPEED = 0.9;
/** Cohesion's second job: 0.85x build output at cohesion 0, 1.15x at 100. */
export const TEAMWORK_BASE = 0.85;
export const TEAMWORK_SPAN = 0.3;

// ── Polish, surprises, scope ──

/** At most 3 polish points a week, each costing 5% of the scope in spare points: fast for small builds, slow for big ones (cap: POLISH_MAX). */
export const POLISH_WEEK_MAX = 3;
export const POLISH_COST = 0.05;
/** A surprise adds 15% of the base scope; a product person on the build halves the odds, an operator cofounder trims them. */
export const SURPRISE_SCOPE = 0.15;
export const SURPRISE_PM_MULT = 0.5;
export const SURPRISE_OPERATOR_MULT = 0.8;
/** Each earlier release of the same type makes the next one 15% bigger (counted up to 6): fixes S-spam; mixing types beats repeating. */
export const SCOPE_INFLATION = 0.15;
export const SCOPE_INFLATION_MAX_COUNT = 6;
/** Releasable from 60% built. */
export const SHIP_MIN_COMPLETE = 0.6;
/** Due date = your own estimate x 1.25, plus a week (clamped to the size's window). */
export const WINDOW_SLACK = 1.25;
/** Reception lost per week shipped after the due week. */
export const LATE_PENALTY = 3;
/**
 * The prepared fallback for the understaffed-kickoff exploit (§5.4 "known soft spot", T7 `late-staff`).
 * false = the due date uses the ETA of the team actually staffed at kickoff (the spec's rule).
 * true  = eta = min(eta(staffed team), eta(staffed team + a standard 3/3, fit-1, rested head in every empty seat)).
 * BALANCE flips it (a value change) only if the T7 late-staff probe fails. A full-seat kickoff gets the same date either way.
 */
export const LATE_STAFF_FALLBACK = false;

// ── Slots and the catalogue ──

/** Build slots by phase, checked at kickoff only (a phase that drops never cancels a running build). */
export const SLOTS: Record<CompanyPhase, number> = { garage: 1, coworking: 1, office: 2, unicorn: 3, public: 3 };

export interface SizeConfig {
  label: string;
  blurb: string;
  scope: number; // points at kickoff before type multiplier and inflation
  units: number; // impact units: every per-release payoff scales with them
  kickoff: number; // one-off cash at kickoff
  seats: number; // a hard cap on who can be staffed
  minPhase: CompanyPhase;
  surprise: number; // weekly surprise chance while unfinished
  windowMin: number; // due window bounds, in weeks after kickoff
  windowMax: number;
  weight: number; // scales every side effect (morale, cohesion, board, trust, flop reputation, cancel morale)
}
/** §5.4 size table. Bigger bets pay more, take longer and collect more surprises. */
export const SIZES: Record<BuildSize, SizeConfig> = {
  s: { label: "S", blurb: "a weekend, allegedly", scope: 5, units: 1, kickoff: 500, seats: 2, minPhase: "garage", surprise: 0.08, windowMin: 3, windowMax: 6, weight: 0.5 },
  m: { label: "M", blurb: "a sprint or three", scope: 12, units: 2.5, kickoff: 2000, seats: 3, minPhase: "garage", surprise: 0.12, windowMin: 4, windowMax: 9, weight: 1 },
  l: { label: "L", blurb: "a quarter, on the slide", scope: 28, units: 5, kickoff: 8000, seats: 5, minPhase: "coworking", surprise: 0.16, windowMin: 6, windowMax: 13, weight: 1.5 },
  xl: { label: "XL", blurb: "a reorg with a launch date", scope: 64, units: 10, kickoff: 30000, seats: 7, minPhase: "office", surprise: 0.2, windowMin: 9, windowMax: 18, weight: 2 },
};

export interface TypeConfig {
  label: string;
  minPhase: CompanyPhase;
  scopeMult: number; // multiplies the size's scope
  rep: number; // reputation per unit x m
  usersFlat: number; // users per unit x m
  usersPct: number; // share of current users per unit x m
  arpuPct: number; // ARPU share per unit x m (x headroom; premium also x PREMIUM_ARPU_BY_PRICING)
  moat: number; // moat per unit x m
  vcRep: number; // VC reputation per unit x m
  bonus: number; // flat reception
  luck: number; // multiplies the luck amplitude
  fit: Record<PricingModel, number>; // reception by pricing model
  cruft: number; // extra cruft per unit on release; negative = pays cruft down, x (0.5 + m) x completed units
  volatility: number; // flat volatility change on release
}
/** §5.4 type table (no role fit: see ROLE_FIT in tycoon/constants.ts). */
export const TYPES: Record<BuildType, TypeConfig> = {
  feature: {
    label: "Feature", minPhase: "garage", scopeMult: 1, rep: 4.5, usersFlat: 40, usersPct: 0.025, arpuPct: 0.02, moat: 2, vcRep: 0,
    bonus: 0, luck: 1, fit: { consumer: 1, prosumer: 2, enterprise: 0 }, cruft: 0, volatility: 0,
  },
  growth: {
    label: "Growth loop", minPhase: "garage", scopeMult: 1, rep: 0.5, usersFlat: 80, usersPct: 0.055, arpuPct: 0, moat: 0.5, vcRep: 0,
    bonus: 3, luck: 1, fit: { consumer: 5, prosumer: 1, enterprise: -5 }, cruft: 0.5, volatility: 0,
  },
  premium: {
    label: "Premium tier", minPhase: "coworking", scopeMult: 1, rep: 1, usersFlat: 0, usersPct: 0, arpuPct: 0.04, moat: 1.5, vcRep: 0.5,
    bonus: 0, luck: 0.8, fit: { consumer: -6, prosumer: 1, enterprise: 4 }, cruft: 0, volatility: 0,
  },
  plumbing: {
    label: "Plumbing", minPhase: "garage", scopeMult: 1, rep: 0.5, usersFlat: 0, usersPct: 0, arpuPct: 0, moat: 1.5, vcRep: 0,
    bonus: 3, luck: 0.5, fit: { consumer: 0, prosumer: 0, enterprise: 1 }, cruft: -4, volatility: 0,
  },
  moonshot: {
    label: "Moonshot", minPhase: "office", scopeMult: 1.5, rep: 4.5, usersFlat: 40, usersPct: 0.035, arpuPct: 0.03, moat: 3, vcRep: 1,
    bonus: 0, luck: 2, fit: { consumer: 0, prosumer: 0, enterprise: 0 }, cruft: 0.5, volatility: 3,
  },
};
/** Premium's ARPU gain by pricing model: consumers barely pay for tiers; enterprise is already the strongest legacy line, so no extra. */
export const PREMIUM_ARPU_BY_PRICING: Record<PricingModel, number> = { consumer: 0.5, prosumer: 1, enterprise: 1 };

// ── Reception (§5.5) ──

/** Quality counts COMPLETE_FLOOR + (1 − COMPLETE_FLOOR) x completeness: a 60% build counts 0.82. */
export const COMPLETE_FLOOR = 0.55;
/** Founder archetype bonus to reception by type (philosopher +1 on everything). */
export const FOUNDER_FIT: Record<FounderArchetype, Partial<Record<BuildType, number>>> = {
  hacker: { feature: 4, plumbing: 4 },
  visionary: { moonshot: 4 },
  "sales-animal": { premium: 4, growth: 2 },
  philosopher: { feature: 1, growth: 1, premium: 1, plumbing: 1, moonshot: 1 },
};
/** x successPenaltyFromStress (0.05..0.35) → 1..5 reception lost to founder stress. */
export const STRESS_RECEPTION_FACTOR = 15;
/** Luck amplitude: ±8 calm to ±20 at volatility 100, x type luck, x1.5 with a powderkeg cofounder. */
export const LUCK_BASE = 8;
export const LUCK_VOL = 12;
export const LUCK_POWDERKEG = 1.5;
/** Payoff multiplier m: 0 under 40 (a flop pays nothing), else (R − 30) / 50, capped at 1.4: 40 → 0.2, 80 → 1.0, 100 → 1.4. */
export const RECEPTION_FLOP_BELOW = 40;
export const RECEPTION_M_ZERO = 30;
export const RECEPTION_M_SPAN = 50;
export const RECEPTION_M_MAX = 1.4;
/** Tier thresholds, best first. A standard team that finishes on time lands SOLID. */
export const TIER_AT: ReadonlyArray<readonly [ReceptionTier, number]> = [["breakout", 85], ["solid", 60], ["shrug", 40], ["flop", 0]];

// ── Payoff caps (per release: no release lifts a ceiling) ──

export const REP_CAP = 25;
export const USERS_PCT_CAP = 0.5;
export const ARPU_PCT_CAP = 0.35;
export const VC_REP_CAP = 6;

// ── Cruft and moat (§5.6) ──

/** Release cruft: 3 x units x (1 − quality/100) for low quality, 8 x units x (1 − completeness) for rushing. */
export const CRUFT_PER_UNIT = 3;
export const RUSH_CRUFT_PER_UNIT = 8;
/** Reception lost per point of cruft (inside quality). */
export const CRUFT_RECEPTION = 0.15;
/** Weekly churn added per point of cruft: cruft 50 → +1 pp a week. */
export const CRUFT_CHURN = 0.0002;
/** Share of weekly churn removed per point of moat, capped at 25% (moat 50+). */
export const MOAT_CHURN = 0.005;
export const MOAT_CHURN_CAP = 0.25;
/** Moat decays 3% a tick, even with nothing in flight: a lead has to be kept. */
export const MOAT_DECAY = 0.03;
/** The first landed patch each week pays down 1 cruft: the patch gets a job without dominating plumbing. */
export const HOTFIX_CRUFT = 1;

/** Side effects by tier, x size weight and rounded: small-build spam cannot farm morale or the board. `rep` is the flop sting (x weight). */
export const TIER_SIDE: Record<ReceptionTier, { morale: number; cohesion: number; board: number; trust: number; rep: number }> = {
  breakout: { morale: 4, cohesion: 2, board: 3, trust: 2, rep: 0 },
  solid: { morale: 2, cohesion: 1, board: 1, trust: 1, rep: 0 },
  shrug: { morale: 0, cohesion: 0, board: 0, trust: 0, rep: 0 },
  flop: { morale: -3, cohesion: -1, board: -2, trust: -1, rep: -2 },
};

/** `build cancel`: morale −max(1, round(2 x size weight)) (S −1, M −2, L −3, XL −4). Kickoff is not refunded. */
export const CANCEL_MORALE = 2;

// ── Words and names ──

/** Near-miss guard on `ship` (§4.8): Levenshtein <= 2 (<= 1 for slugs of 4 characters or fewer), or a 3+ character prefix. */
export const NEAR_MISS_DIST = 2;
export const NEAR_MISS_DIST_SHORT = 1;
export const NEAR_MISS_SHORT_LEN = 4;
export const NEAR_MISS_PREFIX = 3;

/** Board words (§4.6), shared with the views and the 3D bands: [upper bound (exclusive), word], last entry catches the rest. */
export const CRUFT_WORDS: ReadonlyArray<readonly [number, string]> = [[15, "tidy"], [35, "lived-in"], [60, "held together with tape"], [Infinity, "structural tape"]];
export const MOAT_WORDS: ReadonlyArray<readonly [number, string]> = [[10, "a puddle"], [25, "a respectable ditch"], [50, "an actual moat"], [Infinity, "a moat with alligators"]];

/** Slugs a build may not take (§4.6.1); type, size and role tokens and the id pattern are refused as well. */
export const RESERVED_NAMES = ["on", "off", "all", "auto", "start", "new", "crunch", "cancel", "cut", "ship", "list", "help"];
/** Codenames for `build <type>` without a name; index drawn from product.rng. */
export const CODENAMES = ["Atlas", "Kale", "Tuesday", "Plan B", "Northstar", "Halo", "Lighthouse", "Sandwich", "Phoenix", "Blue Sky", "Yak", "Keystone"];
