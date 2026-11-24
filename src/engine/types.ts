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
}

// ── Turn log ──

export interface CostBreakdown {
  readonly salaries: number;
  readonly marketing: number;
  readonly hiring: number;
  readonly poaching: number;
  readonly severance: number;
  readonly total: number;
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
  | { readonly kind: "targetUsers"; readonly fraction: number };

export const EVENT_EFFECT_KINDS: readonly EventEffect["kind"][] = [
  "fundingClimate",
  "newUsers",
  "marketingEffect",
  "candidates",
  "targetHype",
  "targetHeadcount",
  "targetUsers",
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
}
