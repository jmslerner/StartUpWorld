import type { Build, BuildSize, BuildType, Employee, GameState, QuirkId, ReceptionTier, TeamRole } from "../../types/game";
import { ROLE_FIT } from "../tycoon/constants";
import { craftScore, energyFactor, leadOf, roleFit, staffOf } from "../tycoon/roster";
import { phaseAtLeast } from "../assets";
import { computeTeamSize } from "../context";
import { STAGE_PERKS } from "../stagePerks";
import { successPenaltyFromStress } from "../stress";
import { clamp } from "../utils";
import {
  COFOUNDER_HANDS, COMPLETE_FLOOR, COWBOY_SPEED, CRAFTSPERSON_SPEED, CRUFT_RECEPTION, CRUNCH_QUALITY, CRUNCH_SPEED, CRUFT_WORDS,
  FOUNDER_FIT, FOUNDER_HANDS, FOUNDER_HANDS_HACKER, FOUNDER_HANDS_MAX_HEADS, GLUE_SPEED, HANDS_CRAFT, HANDS_CRAFT_BUILDER, LATE_PENALTY,
  LATE_STAFF_FALLBACK, LEAD_WEIGHT, LUCK_BASE, LUCK_POWDERKEG, LUCK_VOL, MOAT_WORDS, PACE_OUT, RAMP, RECEPTION_FLOP_BELOW, RECEPTION_M_MAX,
  RECEPTION_M_SPAN, RECEPTION_M_ZERO, RUSH_CRUFT_PER_UNIT, SCOPE_INFLATION, SCOPE_INFLATION_MAX_COUNT, SHIP_MIN_COMPLETE, SIZES, SLOTS, STRESS_RECEPTION_FACTOR,
  TEAMWORK_BASE, TEAMWORK_SPAN, TIER_AT, TYPES, WINDOW_SLACK,
} from "./constants";
import type { Forecast } from "./view";

// The build formulas (TYCOON-SPEC §5.4, §5.5). Pure, no RNG: everything here can be called from a view.

const EPS = 1e-9;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

// ── Where a build stands ──

/** Completeness C, 0..1. A release needs C >= SHIP_MIN_COMPLETE. */
export const completeness = (b: Build): number => (b.scope > 0 ? Math.min(1, b.progress / b.scope) : 0);
export const isBuilt = (b: Build): boolean => b.progress >= b.scope - EPS;
/** Whole percent built, floored (46.9% reads 46%). */
export const pct = (b: Build): number => Math.floor(completeness(b) * 100 + 1e-6);
export const isShippable = (b: Build): boolean => completeness(b) >= SHIP_MIN_COMPLETE - EPS;
export const weeksLate = (b: Build, week: number): number => Math.max(0, week - b.dueWeek);

// ── Catalogue gates ──

export const slotsFor = (state: GameState): number => SLOTS[state.companyPhase];
export const typeUnlocked = (state: GameState, type: BuildType): boolean => phaseAtLeast(state.companyPhase, TYPES[type].minPhase);
export const sizeUnlocked = (state: GameState, size: BuildSize): boolean => phaseAtLeast(state.companyPhase, SIZES[size].minPhase);

/** Scope at kickoff: each earlier release of the same type makes the next one 15% bigger (up to +90%). One decimal. */
export const scopeFor = (state: GameState, type: BuildType, size: BuildSize): number => {
  const shipped = state.product?.shippedByType[type] ?? 0;
  return round1(SIZES[size].scope * TYPES[type].scopeMult * (1 + SCOPE_INFLATION * Math.min(SCOPE_INFLATION_MAX_COUNT, shipped)));
};

export const cruftWord = (cruft: number): string => (CRUFT_WORDS.find(([below]) => cruft < below) ?? CRUFT_WORDS[CRUFT_WORDS.length - 1])[1];
export const moatWord = (moat: number): string => (MOAT_WORDS.find(([below]) => moat < below) ?? MOAT_WORDS[MOAT_WORDS.length - 1])[1];

// ── One week of work ──

const quirkSpeed = (quirk: QuirkId | null): number => (quirk === "cowboy" ? COWBOY_SPEED : quirk === "craftsperson" ? CRAFTSPERSON_SPEED : 1);

/** Points one person adds to `b` in the calendar week `workWeek` (half in the week they joined). Pass -1 for "no ramp". */
export const personPoints = (e: Employee, b: Build, workWeek: number): number =>
  (PACE_OUT[e.pace] ?? 0) * roleFit(b.type, e.role) * energyFactor(e.energy) * (e.joinedWeek === workWeek ? RAMP : 1) * quirkSpeed(e.quirk);

/** The founders pitch in on the OLDEST build, only while the company is small enough for that to be true. */
export const founderHands = (state: GameState, b: Build): number => {
  if (state.product?.active[0]?.id !== b.id) return 0;
  if (computeTeamSize(state) > FOUNDER_HANDS_MAX_HEADS) return 0;
  const founder = state.founder.archetype === "hacker" ? FOUNDER_HANDS_HACKER : FOUNDER_HANDS;
  const cofounder = state.cofounder.archetype ? COFOUNDER_HANDS[state.cofounder.archetype] : 0;
  return founder + cofounder;
};

export const handsCraft = (state: GameState): number => (state.cofounder.archetype === "builder" ? HANDS_CRAFT_BUILDER : HANDS_CRAFT);

export interface WeekOutput {
  points: number; // work points this week (teamwork, glue and crunch applied)
  quality: number; // the quality of this week's work, 0..100ish (crunch applied)
  lead: Employee | null;
  hands: number; // founders' hands counted in raw
  members: number; // staffed people with fit > 0
  /** Crunch actually bit: the flag is on AND someone staffed worked. The founders' hands alone are never crunched (ERRATA 68). */
  crunched: boolean;
}

/**
 * One week of work on one build for the calendar week `workWeek` (§5.4). Pure, no RNG.
 * `workWeek = -1` gives the steady state (nobody ramping): that is `teamQualityNow` and the ETA's `steady`.
 */
export const weekOutput = (state: GameState, b: Build, workWeek: number): WeekOutput => {
  const staff = staffOf(state, b.id).filter((e) => roleFit(b.type, e.role) > 0);
  const hands = founderHands(state, b);
  let staffPts = 0;
  let craftPts = 0;
  for (const e of staff) {
    const p = personPoints(e, b, workWeek);
    staffPts += p;
    craftPts += p * craftScore(e);
  }
  const raw = staffPts + hands;
  const lead = leadOf(state, b);
  const hc = handsCraft(state);
  const leadScore = lead ? craftScore(lead) : hc;
  // Crunch is something you do to people: with nobody staffed (the founders' hands alone) it buys nothing and costs nothing.
  const crunched = b.crunch && staffPts > 0;
  if (raw <= 0) return { points: 0, quality: leadScore, lead, hands, members: staff.length, crunched: false };
  const mean = (craftPts + hands * hc) / raw;
  const teamwork = TEAMWORK_BASE + TEAMWORK_SPAN * clamp(state.culture.cohesion / 100, 0, 1);
  const glue = staff.some((e) => e.quirk === "glue") ? GLUE_SPEED : 1;
  return {
    points: raw * teamwork * glue * (crunched ? CRUNCH_SPEED : 1),
    quality: (LEAD_WEIGHT * leadScore + (1 - LEAD_WEIGHT) * mean) * (crunched ? CRUNCH_QUALITY : 1),
    lead,
    hands,
    members: staff.length,
    crunched,
  };
};

/** What the current staff would produce, with no ramp and the build's current crunch flag (§5.4 `teamQualityNow`). */
export const teamQualityNow = (state: GameState, b: Build): number => weekOutput(state, b, -1).quality;

/** Weeks until built with today's team; null = never at this rate (nobody is producing points). */
export const etaWeeks = (state: GameState, b: Build): number | null => {
  const remaining = b.scope - b.progress;
  if (remaining <= EPS) return 0;
  const first = weekOutput(state, b, state.week).points;
  if (first >= remaining) return 1;
  const steady = weekOutput(state, b, -1).points;
  if (steady <= 0) return null;
  return 1 + Math.ceil((remaining - first) / steady - EPS);
};

/** A role with fit 1 for the type (every type has one): the "standard head" of the late-staff fallback. */
const standardRoleFor = (type: BuildType): TeamRole =>
  (Object.entries(ROLE_FIT[type]).find(([, fit]) => fit === 1)?.[0] as TeamRole | undefined) ?? "engineering";

/**
 * The ETA the due date is set from (§5.4). Without the fallback it is `etaWeeks`. With LATE_STAFF_FALLBACK it is
 * min(eta(staffed), eta(staffed + a standard 3/3, fit-1, rested head joining now in every empty seat)), null = +∞.
 */
export const kickoffEta = (state: GameState, b: Build): number | null => kickoffEtaWith(state, b, LATE_STAFF_FALLBACK);

/** `kickoffEta` with the fallback switch passed in (so both rules stay tested while the constant picks one). */
export const kickoffEtaWith = (state: GameState, b: Build, fallback: boolean): number | null => {
  const eta = etaWeeks(state, b);
  if (!fallback || !state.people) return eta;
  const empty = SIZES[b.size].seats - staffOf(state, b.id).length;
  if (empty <= 0) return eta;
  const role = standardRoleFor(b.type);
  const ghosts: Employee[] = Array.from({ length: empty }, (_, i) => ({
    id: `v${i + 1}`, name: "Standard Head", role, pace: 3, craft: 3, quirk: null, salary: 0, energy: 100, hiredWeek: state.week, shipped: 0,
    buildId: b.id, joinedWeek: state.week, engaged: true, offerDueWeek: 0, offerKind: null, leadOnNotice: null, retainedWeek: 0, ledWeek: 0,
  }));
  const padded = etaWeeks({ ...state, people: { ...state.people, roster: [...state.people.roster, ...ghosts] } }, b);
  if (eta === null) return padded;
  if (padded === null) return eta;
  return Math.min(eta, padded);
};

/** Weeks from kickoff to the due week: your own estimate x 1.25 plus a week, inside the size's window (eta null → the max). */
export const windowWeeks = (state: GameState, b: Build): number => {
  const cfg = SIZES[b.size];
  const eta = kickoffEta(state, b);
  if (eta === null) return cfg.windowMax;
  return clamp(Math.ceil(WINDOW_SLACK * eta - EPS) + 1, cfg.windowMin, cfg.windowMax);
};

// ── Reception (§5.5) ──

const founderFit = (state: GameState, type: BuildType): number => {
  const a = state.founder.archetype;
  return a ? FOUNDER_FIT[a][type] ?? 0 : 0;
};

/** Everything in the reception that does not depend on the build's own quality, lateness or luck. */
export const fitOf = (state: GameState, type: BuildType): number =>
  TYPES[type].fit[state.pricingModel] + TYPES[type].bonus + founderFit(state, type) + Math.round(100 * STAGE_PERKS[state.stage].shipSuccessBonus);

/** Founder stress off the reception: round(15 x successPenaltyFromStress) = 1..5. */
export const stressPenalty = (state: GameState): number => Math.round(STRESS_RECEPTION_FACTOR * successPenaltyFromStress(state));

/** Luck amplitude for a release of this type (the draw is signedUnit x this, rounded). */
export const luckAmplitude = (state: GameState, type: BuildType): number =>
  (LUCK_BASE + LUCK_VOL * clamp(state.volatility / 100, 0, 1)) * TYPES[type].luck * (state.cofounder.archetype === "powderkeg" ? LUCK_POWDERKEG : 1);

/** Quality of the work so far (before polish and cruft). With no work yet: what this team would produce. */
export const workQuality = (state: GameState, b: Build): number => (b.qPts > 0 ? b.qSum / b.qPts : teamQualityNow(state, b));

/** The build's quality, 0..100: work quality + polish − 0.15 x cruft, rounded. */
export const qualityOf = (state: GameState, b: Build): number =>
  clamp(Math.round(workQuality(state, b) + b.polish - CRUFT_RECEPTION * (state.product?.cruft ?? 0)), 0, 100);

/** How much of the quality a build at completeness `c` counts: 0.55 + 0.45 x C. */
export const completeFactor = (c: number): number => COMPLETE_FLOOR + (1 - COMPLETE_FLOOR) * c;

export const tierOf = (reception: number): ReceptionTier => {
  for (const [tier, min] of TIER_AT) if (reception >= min) return tier;
  return "flop";
};

/** What a reception pays: nothing for a flop, then 0.2x at 40 rising 0.2x per 10 points to 1.4x at 100. */
export const payMultiplier = (reception: number): number =>
  reception < RECEPTION_FLOP_BELOW ? 0 : clamp((reception - RECEPTION_M_ZERO) / RECEPTION_M_SPAN, 0, RECEPTION_M_MAX);

/**
 * The cruft a release shipped now adds for being unfinished (§5.5 `8 x units x (1 − C)`), one decimal; 0 when built and for
 * plumbing (plumbing pays cruft down instead). Printed next to `ship now` so the price of rushing is on screen (ERRATA 69).
 */
export const rushCruftOf = (b: Build): number =>
  TYPES[b.type].cruft < 0 ? 0 : round1(RUSH_CRUFT_PER_UNIT * b.units * (1 - completeness(b)));

/** Reception before luck, for a build shipped in `week` as it stands now (unrounded). */
export const receptionBase = (state: GameState, b: Build, week: number): number =>
  qualityOf(state, b) * completeFactor(completeness(b)) + fitOf(state, b.type) - LATE_PENALTY * weeksLate(b, week) - stressPenalty(state);

/**
 * The forecast (§5.5). Never draws. `now` = luck-free reception if shipped this week; `finished` = the remaining work done at
 * the current team's quality, C = 1, late by whatever the ETA says (eta null → as if it landed this week).
 */
export const forecastOf = (state: GameState, b: Build): Forecast => {
  const eta = etaWeeks(state, b);
  const now = clamp(Math.round(receptionBase(state, b, state.week)), 0, 100);
  const remaining = Math.max(0, b.scope - b.progress);
  const teamQuality = teamQualityNow(state, b);
  const denominator = b.qPts + remaining;
  const doneQuality = denominator > 0 ? (b.qSum + remaining * teamQuality) / denominator : teamQuality;
  const q = clamp(Math.round(doneQuality + b.polish - CRUFT_RECEPTION * (state.product?.cruft ?? 0)), 0, 100);
  const arrival = state.week + (eta ?? 0);
  const finished = clamp(Math.round(q + fitOf(state, b.type) - LATE_PENALTY * weeksLate(b, arrival) - stressPenalty(state)), 0, 100);
  return {
    shippable: isShippable(b),
    now,
    finished,
    spread: Math.round(luckAmplitude(state, b.type) / 2),
    eta,
    tierNow: tierOf(now),
    tierFinished: tierOf(finished),
    rushCruft: rushCruftOf(b),
  };
};

/** "ETA ~3w · due week 34 · ship now ≈ 62 ±6 · finished ≈ 69" (unfinished) or "due week 34 · ship now ≈ 68 ±7" (built). */
export const forecastText = (state: GameState, b: Build): string => {
  const f = forecastOf(state, b);
  const due = state.week > b.dueWeek ? `${state.week - b.dueWeek}w late` : `due week ${b.dueWeek}`;
  const now = `ship now ≈ ${f.now} ±${f.spread}${f.rushCruft > 0 ? ` (+${f.rushCruft} cruft for rushing)` : ""}`;
  if (isBuilt(b)) return `${due} · ${now}`;
  const eta = f.eta === null ? "ETA ?" : `ETA ~${f.eta}w`;
  const finished = f.eta === null ? "finished ≈ ? (nobody on it)" : `finished ≈ ${f.finished}`;
  return `${eta} · ${due} · ${f.shippable ? now : `not shippable until ${Math.round(SHIP_MIN_COMPLETE * 100)}%`} · ${finished}`;
};
