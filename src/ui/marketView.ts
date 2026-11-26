/**
 * The market view on the career screen, as plain values: which view is on screen, and what the card over a selected
 * company says. Pure; it reads only a company's public numbers.
 */

import type { PlaybackBeat } from "../scene/yearPlayback";
import type { MarketCompany, WorldViewKind } from "../world/types/market";
import { count, money, percent } from "./format";
import type { RivalRow } from "./viewModel";

/** The view on screen: a beat's while a year plays (the market beat's market, any other the office), else the choice. */
export const viewNow = (chosen: WorldViewKind, beat: PlaybackBeat | null): WorldViewKind =>
  beat === null ? chosen : beat.kind === "market" ? "market" : "office";

export interface MarketCardView {
  readonly title: string;
  readonly lines: readonly string[];
}

export const MARKET_WORDS: { readonly show: "Show in market"; readonly card: "Company in the market" } = {
  show: "Show in market",
  card: "Company in the market",
};

const usersLine = (users: number, barUsers: number): string => {
  if (users > barUsers) return `${count(users)} users, past the bar`;
  if (users === barUsers) return `${count(users)} users, at the bar`;
  return `${count(users)} users, ${count(barUsers - users)} short of the bar`;
};

/** A company's public numbers for the card over the market. `row` is the rival's row; null for the player. */
export const marketCard = (company: MarketCompany, row: RivalRow | null, barUsers: number): MarketCardView => {
  const rival =
    row === null
      ? []
      : [
          `Quality ${Math.floor(row.quality)}${row.launched ? "" : " (not live)"}, hype ${Math.floor(row.hype)}, ${row.price} price`,
          `Worth ${money(row.valuation)}`,
        ];
  return {
    title: company.state === "player" ? `${company.name} (you)` : company.name,
    lines: [
      usersLine(company.users, barUsers),
      `Won ${percent(company.won)} of last year's new users`,
      ...rival,
      company.listed ? "Public" : company.newcomer ? "New this year" : "Private",
    ],
  };
};
