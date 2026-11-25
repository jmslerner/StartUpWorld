// The market step of a turn: launched companies lose their churn, then the pool is split by pull.
// Users are conserved exactly: what the companies hold afterwards plus what is carried out equals
// what they held before plus the new users plus what was carried in.

import { splitByWeights } from "./formulas";
import type { CompanyId } from "./types";

/** One launched company's inputs. */
export interface MarketEntry {
  readonly id: CompanyId;
  readonly users: number;
  readonly churnRate: number;
  readonly pull: number;
}

export interface MarketShare {
  readonly id: CompanyId;
  readonly churned: number;
  readonly won: number;
  /** Users after the split. */
  readonly users: number;
  /** Share of the pool, 0–1. */
  readonly share: number;
}

export interface MarketResult {
  readonly newUsers: number;
  readonly carriedIn: number;
  /** Everyone's churned users. */
  readonly churned: number;
  readonly pool: number;
  /** Left unclaimed because nobody had any pull; it waits for the next turn. */
  readonly carriedOut: number;
  /** In the order the entries were given. */
  readonly companies: readonly MarketShare[];
}

export const resolveMarket = (entries: readonly MarketEntry[], newUsers: number, carriedIn: number): MarketResult => {
  const churnedBy = entries.map((entry) => Math.min(entry.users, Math.round(entry.users * entry.churnRate)));
  const churned = churnedBy.reduce((a, b) => a + b, 0);
  const pool = newUsers + churned + carriedIn;
  const wonBy = splitByWeights(pool, entries.map((entry) => entry.pull));
  const handedOut = wonBy.reduce((a, b) => a + b, 0);
  return {
    newUsers,
    carriedIn,
    churned,
    pool,
    carriedOut: pool - handedOut,
    companies: entries.map((entry, i) => ({
      id: entry.id,
      churned: churnedBy[i],
      won: wonBy[i],
      users: entry.users - churnedBy[i] + wonBy[i],
      share: pool > 0 ? wonBy[i] / pool : 0,
    })),
  };
};
