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
  /** Stops hiring at this team size. */
  readonly teamCap: number;
  /** Recruits only while projected runway stays at or above this. */
  readonly hireRunway: number;
  /** Marketing options, as shares of cash on hand. */
  readonly marketingShares: readonly number[];
  /** Team mixes to consider: the Product share of everyone not recruiting. */
  readonly productShares: readonly number[];
  /** Turns ahead over which product and team growth are valued. */
  readonly horizon: number;
  readonly weights: CpuWeights;
}

export interface CpuConfig {
  /** Size of the random nudge added to each plan's score. */
  readonly noise: number;
  /** Score lost per point of board-firing risk. */
  readonly boardRiskPenalty: number;
  /** Lays people off only when runway is under this many turns (or to turn a profit for an IPO). */
  readonly layoffRunway: number;
  /** A company with almost no market share still values quality and team as if it had this much. */
  readonly minShareForGrowth: number;
  /** Score lost for a plan that leaves less than one turn of runway, scaled by how far short it is. */
  readonly shortRunwayPenalty: number;
  /** Marketing options on the last turn, as shares of cash on hand: there is no next quarter to save for. */
  readonly lastTurnMarketingShares: readonly number[];
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
