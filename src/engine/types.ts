// Shapes shared by the rules engine, the CPU planner, the simulator and the UI.
// Everything here is plain JSON: no classes, no Map/Set, no undefined, no Infinity.
// The rules themselves are described in docs/turn-based-design.md.

/** Index into GameState.companies. */
export type CompanyId = number;

/** Decides starting stats, the coordination-drag exponent and the catch-up bonus. */
export type Archetype = "startup" | "incumbent";

/** Who makes a company's plans. The engine never branches on this; it is only a label. */
export type Controller = "human" | "baseline" | "blitzscaler" | "bootstrapper" | "incumbent";
export type CpuKind = "blitzscaler" | "bootstrapper" | "incumbent";

export type PriceTier = "budget" | "standard" | "premium";
export type Department = "product" | "growth" | "recruiting";
export type OutReason = "bankrupt" | "fired";
export type EndingKind = "ipo" | "lastStanding" | "turnLimit" | "wipeout";

export const DEPARTMENTS: readonly Department[] = ["product", "growth", "recruiting"];
export const PRICE_TIERS: readonly PriceTier[] = ["budget", "standard", "premium"];

// ── Plans ──

/** Whole people per department. */
export interface Allocation {
  readonly product: number;
  readonly growth: number;
  readonly recruiting: number;
}

/** One company's decisions for one turn. */
export interface Plan {
  /** Must add up to the people available for work: headcount − layoffs − 1 if raising. */
  readonly allocation: Allocation;
  /** Dollars this turn, a multiple of the marketing step. */
  readonly marketing: number;
  readonly price: PriceTier;
  /** Percent of the company sold this turn; 0 = no raise. */
  readonly raisePercent: number;
  readonly poachTarget: CompanyId | null;
  readonly layoffs: number;
  /** Hire at most this many; null = up to recruiting capacity. */
  readonly hireLimit: number | null;
  /** Career only: take the company public this year. A race plan has no such key. */
  readonly goPublic?: boolean;
}

/** By company id. null = repeat that company's last plan. Entries for companies that are out are ignored. */
export type PlanSet = readonly (Plan | null)[];

// ── Companies ──

export interface LastRaise {
  readonly turn: number;
  readonly percent: number;
  readonly amount: number;
}

/** What everyone can see about a company's latest quarter. */
export interface QuarterStats {
  /** Quality and hype as that quarter started (hype after its event): what the rivals panel showed then. */
  readonly qualityAtOpen: number;
  readonly hypeAtOpen: number;
  /** Users at the previous close, before that quarter's event. */
  readonly usersAtOpen: number;
  readonly usersLostToEvent: number;
  readonly usersChurned: number;
  readonly usersWon: number;
  /** People who joined: hires plus successful poaches. */
  readonly joined: number;
  /** People who left: layoffs, lost to a poach, burnout. */
  readonly left: number;
}

export interface Exit {
  readonly turn: number;
  readonly reason: OutReason;
  /** What the company had when it went out. */
  readonly users: number;
  readonly headcount: number;
}

/** What rivals (and the rivals panel) may know about a company. */
export interface PublicCompany {
  readonly id: CompanyId;
  readonly name: string;
  readonly pitch: string;
  readonly users: number;
  readonly headcount: number;
  /** 0–100. */
  readonly hype: number;
  /** 0–100. */
  readonly quality: number;
  readonly launched: boolean;
  readonly price: PriceTier;
  /** 0–1. */
  readonly founderEquity: number;
  readonly founderSeats: number;
  readonly investorSeats: number;
  readonly lastRaise: LastRaise | null;
  /** null until the company has played a quarter. */
  readonly lastQuarter: QuarterStats | null;
  /** Set once the company is bankrupt or its founder is fired; its users and headcount are then 0. */
  readonly out: Exit | null;
  /** Career only: where the company stands in its career. A race company has no such key. */
  readonly career?: PublicCareer;
}

/** The full record; only its owner may read the fields added here. */
export interface Company extends PublicCompany {
  readonly archetype: Archetype;
  readonly controller: Controller;
  readonly cash: number;
  /** The last plan as resolved: the default for the next one. */
  readonly lastPlan: Plan;
  /** Users and headcount when the last quarter closed, before the next turn's event touched them. */
  readonly usersAtLastClose: number;
  readonly headcountAtLastClose: number;
  /** Latest quarter's totals, for runway. null until a quarter has been played. */
  readonly lastRevenue: number | null;
  readonly lastCosts: number | null;
  /** Pull in the latest market, for estimating rivals. null until launched. */
  readonly lastPull: number | null;
  /** Career only: the public career facts, plus bookkeeping that never leaves the company. */
  readonly career?: CompanyCareer;
}

// ── Game ──

export interface Climate {
  /** Multiplies every valuation. 1 = normal. */
  readonly multiplier: number;
  /** Turns it still applies to, counting the current one. 0 = normal climate. */
  readonly turnsLeft: number;
}

/** This-turn-only effects of the current event. Neutral values: 1, 1, 0. */
export interface TurnModifiers {
  readonly newUsers: number;
  readonly marketing: number;
  readonly extraCandidates: number;
}

export interface ActiveEvent {
  readonly cardId: string;
  readonly targetId: CompanyId | null;
}

export interface Outcome {
  readonly kind: EndingKind;
  readonly turn: number;
  /** null only for a wipeout. */
  readonly winnerId: CompanyId | null;
}

export interface GameState {
  /** The turn about to be planned and resolved (1-based). Stays on the final turn once the game is over. */
  readonly turn: number;
  readonly companies: readonly Company[];
  /** Users waiting to join the next market split: exits, breach losses, an unclaimed pool. */
  readonly carryOverUsers: number;
  /** People freed by companies that went out last turn; they join this turn's candidates. */
  readonly freedPeople: number;
  readonly climate: Climate;
  /** The event revealed for `turn`, instant effects already applied. */
  readonly event: ActiveEvent | null;
  readonly modifiers: TurnModifiers;
  readonly outcome: Outcome | null;
  /** Career only, and then always there: the wave of new users in force. At rest it is { multiplier: 1, turnsLeft: 0 }. */
  readonly wave?: Wave;
}

export interface SeatSetup {
  readonly controller: Controller;
  readonly archetype: Archetype;
  readonly name: string;
  readonly pitch: string;
}

export interface GameSetup {
  readonly seats: readonly SeatSetup[];
}

/** What one company may look at when planning: itself in full, rivals in public. */
export interface CompanyView {
  readonly turn: number;
  readonly self: Company;
  /** Every other company, including those that are out. */
  readonly rivals: readonly PublicCompany[];
  readonly climate: Climate;
  readonly event: ActiveEvent | null;
  readonly modifiers: TurnModifiers;
  readonly carryOverUsers: number;
  readonly freedPeople: number;
  /** Career only: the wave of new users in force, as in the state. */
  readonly wave?: Wave;
}

// ── Turn log ──

export interface CostBreakdown {
  readonly salaries: number;
  readonly marketing: number;
  readonly hiring: number;
  readonly poaching: number;
  readonly severance: number;
  readonly total: number;
  /** Career only: the one-off bill for moving to a bigger office. Counted in `total`. */
  readonly moving?: number;
}

/** Everything that happened to one company in one turn. Private to that company; see PublicReport. */
export interface CompanyReport {
  readonly companyId: CompanyId;
  /** The plan as resolved, after fix-ups. */
  readonly plan: Plan;
  /** What was fixed up or dropped, in plain words. */
  readonly notes: readonly string[];
  readonly headcount: {
    /** At the start of the turn, after the event. */
    readonly start: number;
    readonly lostToEvent: number;
    readonly laidOff: number;
    readonly hired: number;
    readonly poachedIn: number;
    readonly poachedOut: number;
    /** What the company starts next turn with. */
    readonly end: number;
  };
  readonly work: { readonly effective: number; readonly product: number; readonly growth: number; readonly recruiting: number };
  readonly quality: {
    readonly start: number;
    readonly gain: number;
    readonly decay: number;
    readonly end: number;
    readonly catchUp: boolean;
    readonly launchedNow: boolean;
  };
  readonly users: {
    /** Last quarter's close. */
    readonly open: number;
    readonly lostToEvent: number;
    readonly churned: number;
    readonly won: number;
    readonly end: number;
    readonly pull: number;
    /** Share of this turn's pool, 0–1. */
    readonly share: number;
  };
  readonly revenue: number;
  readonly costs: CostBreakdown;
  readonly raise: { readonly percent: number; readonly valuation: number; readonly amount: number } | null;
  readonly cash: { readonly start: number; readonly end: number };
  readonly profitable: boolean;
  /** Turns of cash left at this quarter's burn; null when the quarter was profitable. */
  readonly runway: number | null;
  readonly hype: {
    readonly start: number;
    readonly end: number;
    readonly launch: number;
    readonly raise: number;
    readonly growth: number;
    readonly layoffs: number;
  };
  readonly poach: { readonly targetId: CompanyId; readonly chance: number; readonly success: boolean } | null;
  readonly hiring: { readonly capacity: number; readonly wanted: number; readonly hired: number };
  /** null while founders control the board. */
  readonly board: { readonly usersFell: boolean; readonly lowRunway: boolean; readonly fired: boolean } | null;
  /** End-of-turn valuation. */
  readonly valuation: number;
  readonly equity: number;
  /** Set when the company went out this turn. */
  readonly out: OutReason | null;
  /** Career only: what the year meant for the company's career. A race report has no such key. */
  readonly career?: CareerReport;
}

/** The part of a rival's report everyone can see. */
export interface PublicReport {
  readonly companyId: CompanyId;
  readonly price: PriceTier;
  readonly headcount: CompanyReport["headcount"];
  readonly quality: { readonly start: number; readonly end: number; readonly launchedNow: boolean };
  readonly users: { readonly open: number; readonly lostToEvent: number; readonly churned: number; readonly won: number; readonly end: number };
  readonly raise: CompanyReport["raise"];
  readonly hype: { readonly start: number; readonly end: number };
  readonly poach: { readonly targetId: CompanyId; readonly success: boolean } | null;
  readonly boardFired: boolean;
  readonly valuation: number;
  readonly equity: number;
  readonly out: OutReason | null;
  /** Career only: whether it went public this year, what it was rescued from if it was, and the office it moved to if it moved. */
  readonly career?: { readonly listed: boolean; readonly rescued: OutReason | null; readonly movedTo: number | null };
}

export interface TurnLog {
  readonly turn: number;
  /** The event in force this turn. */
  readonly event: ActiveEvent | null;
  readonly climateMultiplier: number;
  readonly market: {
    readonly newUsers: number;
    readonly carriedIn: number;
    readonly churned: number;
    readonly pool: number;
    /** Users waiting for the next market: the unclaimed part of the pool plus those released by companies that went out. */
    readonly carriedOut: number;
  };
  readonly hiring: {
    readonly candidates: number;
    /** Company ids in the order candidates were handed out. */
    readonly picks: readonly CompanyId[];
  };
  /** By company id; null for a company that was already out. */
  readonly companies: readonly (CompanyReport | null)[];
  /** The event revealed for next turn, if the game goes on. */
  readonly nextEvent: ActiveEvent | null;
  readonly outcome: Outcome | null;
  /** Career only: the seats a new company takes for next year. */
  readonly entrants?: readonly CompanyId[];
}

// ── Events ──

/** Who an event card hits. Cards with no eligible company are left out of the draw. */
export interface TargetRule {
  readonly pick: "random" | "highestQuality";
  readonly launched?: boolean;
  readonly qualityBelow?: number;
  readonly minUsers?: number;
  readonly minHeadcount?: number;
}

export type EventEffect =
  | { readonly kind: "fundingClimate"; readonly multiplier: number; readonly turns: number }
  | { readonly kind: "newUsers"; readonly multiplier: number }
  | { readonly kind: "marketingEffect"; readonly multiplier: number }
  | { readonly kind: "candidates"; readonly extra: number }
  | { readonly kind: "targetHype"; readonly delta: number }
  | { readonly kind: "targetHeadcount"; readonly delta: number }
  | { readonly kind: "targetUsers"; readonly fraction: number }
  // A career's platform shift is these two on one card: no product keeps more quality than the ceiling, and
  // new users are multiplied for that many turns. With `turns` 1 the ceiling holds through the card's year; with 0
  // it is a cut made once, as the year opens.
  | { readonly kind: "qualityCeiling"; readonly ceiling: number; readonly turns: number }
  | { readonly kind: "userWave"; readonly multiplier: number; readonly turns: number };

export const EVENT_EFFECT_KINDS: readonly EventEffect["kind"][] = [
  "fundingClimate",
  "newUsers",
  "marketingEffect",
  "candidates",
  "targetHype",
  "targetHeadcount",
  "targetUsers",
  "qualityCeiling",
  "userWave",
];

/** One card of the event deck. Adding a card that uses the effects above needs no code. */
export interface EventCard {
  readonly id: string;
  readonly name: string;
  /** One line for the event banner. */
  readonly text: string;
  readonly weight: number;
  /** Required by the target* effects. */
  readonly target?: TargetRule;
  readonly effects: readonly EventEffect[];
}

// ── Rule numbers (values live in src/config.ts) ──

export interface ArchetypeConfig {
  readonly cash: number;
  readonly headcount: number;
  readonly users: number;
  readonly quality: number;
  readonly hype: number;
  readonly founderEquity: number;
  readonly founderSeats: number;
  readonly investorSeats: number;
  /** Effective work = headcount ^ this. */
  readonly workExponent: number;
  /** Product output multiplier while trailing the quality leader. 1 = none. */
  readonly catchUpMultiplier: number;
  /** Team split a new company starts with (the default for its first plan). */
  readonly allocation: Allocation;
}

export interface PriceTierConfig {
  /** Dollars per user per quarter. */
  readonly price: number;
  readonly pullFactor: number;
  /** Added to the churn rate, as a fraction (0.04 = +4 points). */
  readonly churnDelta: number;
}

export interface RulesConfig {
  readonly game: { readonly maxTurns: number };
  readonly ipo: { readonly users: number };
  readonly archetypes: Readonly<Record<Archetype, ArchetypeConfig>>;
  readonly salary: number;
  readonly quality: { readonly gainPerWork: number; readonly decay: number; readonly launchAt: number };
  readonly market: { readonly newUsersTurn1: number; readonly growthPerTurn: number };
  readonly pull: {
    readonly growthCoefficient: number;
    readonly marketingCoefficient: number;
    readonly marketingStep: number;
    readonly maxMarketing: number;
  };
  readonly priceTiers: Readonly<Record<PriceTier, PriceTierConfig>>;
  readonly churn: { readonly base: number; readonly perQualityPoint: number; readonly min: number };
  readonly hiring: { readonly candidatesPerTurn: number; readonly capacityPerWork: number; readonly fee: number };
  readonly raise: { readonly minUsers: number; readonly cooldownTurns: number; readonly options: readonly number[] };
  readonly valuation: { readonly perUser: number };
  readonly board: { readonly fireChance: number; readonly runwayTurns: number };
  readonly poach: {
    readonly cost: number;
    readonly baseChance: number;
    readonly chancePerHypePoint: number;
    readonly minChance: number;
    readonly maxChance: number;
    readonly minTargetHeadcount: number;
  };
  readonly layoff: { readonly severance: number; readonly hype: number };
  readonly hype: {
    readonly decay: number;
    readonly launch: number;
    readonly raise: number;
    readonly growth: number;
    readonly growthThreshold: number;
  };
  readonly events: { readonly firstTurn: number; readonly chance: number; readonly deck: readonly EventCard[] };
  /** Guesses the one-quarter projection falls back on when it has nothing better. */
  readonly projection: {
    /** A launched rival's pull ≈ quality × this × price factor × (1 + hype/100), until a quarter of results says otherwise. */
    readonly rivalPullGuess: number;
    /** How many candidates each rival is assumed to want this turn. */
    readonly rivalHireGuess: number;
    /** The cautious case: this share fewer new users than expected. A warning that says "could" is worked out from it. */
    readonly cautiousShortfall: number;
  };
  /** The switch: a config with this block is played as a career. The race's config has none. */
  readonly career?: CareerRules;
}

// ── The career ──
// The second way to play, on the same engine: one company's whole life, a turn a year. Its rules are recorded in
// docs/career-rules.md. Everything it adds to a plan, a company, a state, a report or a log is an optional member
// above, marked "Career only". A race never creates one: there the key is absent, not present and empty.

/** Some of T's numbers; whatever is left out keeps the value underneath. Lists are replaced whole. */
export type Overlay<T> = T extends readonly unknown[] ? T : T extends object ? { readonly [K in keyof T]?: Overlay<T[K]> } : T;

/** One size of office, from the garage to the campus. */
export interface OfficeConfig {
  readonly id: string;
  readonly name: string;
  /** The most people it holds. */
  readonly capacity: number;
}

/** An era's own values for any number of the config. `cpu` and `baseline` are read by src/ai only. */
export type EraValues = Overlay<Omit<RulesConfig, "game" | "career">> & { readonly cpu?: object; readonly baseline?: object };

export interface EraConfig {
  readonly id: string;
  readonly name: string;
  /** The calendar year the era starts in. It lasts until the next era starts. */
  readonly firstYear: number;
  /** False for history, true for the imagined future: the timeline marks where history ends. */
  readonly invented: boolean;
  /** `market` counts from the era's first year: `newUsersTurn1` arrive in that year. */
  readonly values: EraValues;
}

/** A card with a fixed year. It replaces that year's random draw. */
export interface DatedCard extends Omit<EventCard, "weight"> {
  readonly year: number;
}

/** The career's own rule numbers: the block of the config that switches the career on. */
export interface CareerRules {
  /** The calendar year of turn 1. Every turn is one year. */
  readonly firstYear: number;
  /** Listed in order of `firstYear`, which `eraIndexOf` relies on. */
  readonly eras: readonly EraConfig[];
  readonly dated: readonly DatedCard[];
  /** How many years ahead a platform shift is announced. */
  readonly shiftNoticeYears: number;
  /**
   * Going public. `percent` of the company is sold; from then on it is worth `premium` times a private company
   * with the same users and hype; it gains `hype` that year, and investors gain `investorSeats` board seats.
   */
  readonly listing: { readonly percent: number; readonly premium: number; readonly hype: number; readonly investorSeats: number };
  /**
   * A company's one rescue. The founder keeps `equityKept` of their share, investors gain `investorSeats` board
   * seats (more if it takes more to outnumber the founders), hype changes by `hype`, and cash below $0 is reset
   * to `salaryYears` years of salaries.
   */
  readonly rescue: { readonly equityKept: number; readonly investorSeats: number; readonly hype: number; readonly salaryYears: number };
  /** A rival that goes out is replaced `afterYears` years later by a new startup that plays one of `styles`. */
  readonly replacement: { readonly afterYears: number; readonly styles: readonly CpuKind[] };
  /** Smallest first. The last one cannot be outgrown. */
  readonly offices: readonly OfficeConfig[];
  /** The one-off bill for moving to a bigger office: this many years of salary for everyone who moves. */
  readonly moving: { readonly salaryYears: number };
}

/** A company's going public: the turn, the valuation it sold at and the cash that came in. */
export interface Listing {
  readonly turn: number;
  readonly valuation: number;
  readonly amount: number;
}

/** A company's one rescue: the turn, and what it was rescued from. */
export interface Rescue {
  readonly turn: number;
  readonly reason: OutReason;
}

/** What everyone can see of a company's career. */
export interface PublicCareer {
  /** The turn the company entered the game: 1 for the first four. */
  readonly founded: number;
  /** Index into `career.offices`. It only goes up. */
  readonly office: number;
  readonly listed: Listing | null;
  readonly rescue: Rescue | null;
  /** Quality when the last year closed, before the next year's card touched it. Public since it closed. */
  readonly qualityAtLastClose: number;
}

export interface CompanyCareer extends PublicCareer {
  /** True once the company has closed a year at that year's bar with a profit. From then on it may go public. */
  readonly qualified: boolean;
}

/** More (or fewer) new users for some years: what a platform shift brings. Shaped like the funding climate. */
export interface Wave {
  readonly multiplier: number;
  readonly turnsLeft: number;
}

/** A company's career in one year's report. */
export interface CareerReport {
  /** Set in the year the company goes public. */
  readonly listing: { readonly valuation: number; readonly amount: number } | null;
  /** Set in the year the company is rescued: from what, and its cash and founder equity before the rescue. */
  readonly rescue: { readonly reason: OutReason; readonly cashBefore: number; readonly equityBefore: number } | null;
  /** Set in a year the company moves office: indexes into `career.offices`, and the moving bill. */
  readonly office: { readonly from: number; readonly to: number; readonly bill: number } | null;
  /** The year's change in hype from going public and from a rescue; 0 for whichever did not happen. */
  readonly hype: { readonly listing: number; readonly rescue: number };
  /** Quality taken by the year's card before the year was played: what a platform shift costs. */
  readonly qualityLostToEvent: number;
}
