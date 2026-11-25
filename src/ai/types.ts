// Numbers that shape how the computer players and the simulator's baseline bot decide.
// The values live in src/config.ts with every other number.

import type { CpuKind, PriceTier } from "../engine/types";

/** How much a CPU cares about each outcome of a plan, one quarter ahead. */
export interface CpuWeights {
  /** Users won this quarter, as a share of the pool. */
  readonly users: number;
  /** Product quality gained, valued over the horizon. */
  readonly quality: number;
  /** Team growth, valued over the horizon. */
  readonly team: number;
  /** Runway, saturating: runway ÷ (runway + runwayHalf). */
  readonly runway: number;
  readonly runwayHalf: number;
  /** Hype at the end of the quarter, per 100 points. */
  readonly hype: number;
  /** Founder equity kept. */
  readonly equity: number;
}

/** A CPU's fixed habits (what makes it readable) and its weights. */
export interface CpuPersonality {
  /** The price tier it always charges. */
  readonly price: PriceTier;
  readonly raise: {
    /** "eligible": raises the moment the rules allow. "runway": only once runway is under `runway` turns. */
    readonly when: "eligible" | "runway";
    readonly runway: number;
    /** The sizes it will consider, in percent. */
    readonly percents: readonly number[];
  };
  /** Attempts a poach whenever projected runway stays at or above this; null = never poaches. */
  readonly poachRunway: number | null;
  /** Stops recruiting at this team size. People it poaches come on top. */
  readonly teamCap: number;
  /** Recruits only while projected runway stays at or above this. */
  readonly hireRunway: number;
  /** Marketing options, as shares of cash on hand. */
  readonly marketingShares: readonly number[];
  /** Team mixes to consider: the Product share of everyone not recruiting. */
  readonly productShares: readonly number[];
  /** Turns ahead over which product and team growth are valued. */
  readonly horizon: number;
  /** How much it fears its board: score lost per point of firing risk. Low = reckless once investors hold the seats. */
  readonly boardRiskPenalty: number;
  readonly weights: CpuWeights;
}

export interface CpuConfig {
  /** Size of the random nudge added to each plan's score. */
  readonly noise: number;
  /** Lays people off only when runway is under this many turns (or to turn a profit for an IPO). */
  readonly layoffRunway: number;
  /** A company with almost no market share still values quality and team as if it had this much. */
  readonly minShareForGrowth: number;
  /** Score lost for a plan that leaves less than `shortRunwayTurns` of runway, scaled by how far short it is. */
  readonly shortRunwayPenalty: number;
  readonly shortRunwayTurns: number;
  /** Marketing options on the last turn, as shares of cash on hand: there is no next quarter to save for. */
  readonly lastTurnMarketingShares: readonly number[];
  /** Layoffs it weighs when pushing for a profitable quarter at the IPO bar. */
  readonly ipoPushLayoffs: readonly number[];
  /** Layoffs it weighs when short of cash: these head counts, then these shares of the team (1 = everyone but one). */
  readonly troubleLayoffs: { readonly counts: readonly number[]; readonly shares: readonly number[] };
  /**
   * Recruiters it weighs: `few`, or `many` once at least `manyFrom` people are free to assign; and, when `shares` is
   * set, these shares of the people free to assign as well. The race's config does not set it.
   */
  readonly recruiters: {
    readonly few: readonly number[];
    readonly many: readonly number[];
    readonly manyFrom: number;
    readonly shares?: readonly number[];
  };
  /** How much of the value it gives product quality over its horizon it also gives a bigger team. */
  readonly teamGrowthShare: number;
  /** Score of a plan projected to end below $0, less a point per $1M of shortfall: under every plan that survives. */
  readonly bankruptScore: number;
  /** The IPO push: the prize for a quarter that wins, and what deficits and lost users cost on the way. */
  readonly ipo: { readonly win: number; readonly deficit: number; readonly nextDeficit: number; readonly usersShortfall: number };
  readonly personalities: Readonly<Record<CpuKind, CpuPersonality>>;
}

/** The simulator's stand-in for a new player. */
export interface BaselineConfig {
  /** Team split after launch, as fractions. Before launch everyone builds. */
  readonly split: { readonly product: number; readonly growth: number; readonly recruiting: number };
  readonly price: PriceTier;
  readonly raisePercent: number;
  /** Raises when runway drops under this many turns. */
  readonly raiseRunway: number;
  /** Hires only while it keeps this many turns of runway. */
  readonly hireRunway: number;
  readonly marketing: number;
}

/** What `npm run sim` checks. Shares are 0–1. */
export interface BalanceTargets {
  readonly maxCpuWinShare: number;
  readonly baselineWinShare: readonly [number, number];
  readonly medianTurns: readonly [number, number];
  readonly ipoShare: readonly [number, number];
}

export interface SimConfig {
  readonly games: number;
  readonly firstSeed: number;
  readonly targets: BalanceTargets;
}

/** What the career's simulator checks. Shares are 0–1. */
export interface CareerTargets {
  readonly maxCpuWinShare: number;
  readonly baselineWinShare: readonly [number, number];
  /** Careers in which the baseline bot ends early, by failing twice. */
  readonly baselineOutShare: readonly [number, number];
  readonly baselineListedShare: readonly [number, number];
  /** The leader of `leaderYear` wins in less than this share of careers. */
  readonly leaderHoldsBelow: number;
}

export interface CareerSimConfig {
  readonly careers: number;
  readonly firstSeed: number;
  /** The year whose leader is checked against `leaderHoldsBelow`. */
  readonly leaderYear: number;
  /** The years the simulator reports on. */
  readonly checkpointYears: readonly number[];
  /** The year a pilot starts spending past its means, to see whether a deliberate rescue pays. */
  readonly overspendYear: number;
  /** How far a pilot may beat the baseline bot before it is reported as a loophole. */
  readonly loopholeMargin: number;
  readonly targets: CareerTargets;
}
