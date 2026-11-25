// The hiring step of a turn: candidates are handed out one at a time in hype order.

import type { CompanyId } from "./types";

export interface HypeRanked {
  readonly id: CompanyId;
  /** Start-of-turn hype. */
  readonly hype: number;
  /** A seeded random number that orders companies with equal hype. */
  readonly tieKey: number;
}

/** Highest hype first; equal hype by tie key; id as the last resort so the order is total. */
export const byHypeOrder = (a: HypeRanked, b: HypeRanked): number => b.hype - a.hype || a.tieKey - b.tieKey || a.id - b.id;

export interface HiringBid extends HypeRanked {
  /** How many people the company would take: its capacity, capped by its hire limit. */
  readonly wanted: number;
}

export interface HiringResult {
  /** Hires made, by company id (0 for a bidder that got nobody). */
  readonly hired: Readonly<Record<number, number>>;
  /** Company ids in the order candidates were handed out. */
  readonly picks: readonly CompanyId[];
}

export const handOutCandidates = (candidates: number, bids: readonly HiringBid[]): HiringResult => {
  const order = [...bids].sort(byHypeOrder);
  const hired: Record<number, number> = {};
  for (const bid of bids) hired[bid.id] = 0;
  const picks: CompanyId[] = [];
  let left = Math.max(0, Math.floor(candidates));
  let someonePicked = true;
  while (left > 0 && someonePicked) {
    someonePicked = false;
    for (const bid of order) {
      if (left === 0) break;
      if (hired[bid.id] >= bid.wanted) continue;
      hired[bid.id] += 1;
      picks.push(bid.id);
      left -= 1;
      someonePicked = true;
    }
  }
  return { hired, picks };
};
