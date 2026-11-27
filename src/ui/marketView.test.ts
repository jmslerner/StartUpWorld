import { describe, expect, it } from "vitest";
import type { BeatKind, PlaybackBeat } from "../scene/yearPlayback";
import type { MarketCompany } from "../world/types/market";
import { count, money } from "./format";
import { marketCard, MARKET_WORDS, viewNow } from "./marketView";
import type { RivalRow } from "./viewModel";

const beat = (kind: BeatKind): PlaybackBeat => ({ kind, seconds: 1, count: 0, office: null });

describe("the view on screen", () => {
  it("shows the beat's view while a year plays, and the player's choice otherwise", () => {
    expect(viewNow("office", beat("market"))).toBe("market");
    expect(viewNow("market", beat("arrive"))).toBe("office");
    expect(viewNow("market", beat("year"))).toBe("office");
    expect(viewNow("market", beat("leave"))).toBe("office");
    expect(viewNow("market", beat("move"))).toBe("office");
    expect(viewNow("market", null)).toBe("market");
    expect(viewNow("office", null)).toBe("office");
  });
});

const base: MarketCompany = { seat: 1, name: "Tidewell", state: "rival", users: 1_200_000, height: 0.6, won: 0.25, listed: false, newcomer: false };

const row: RivalRow = {
  id: 1,
  name: "Tidewell",
  pitch: "A pitch",
  users: 1_200_000,
  usersChange: 100_000,
  headcount: 30,
  quality: 62.7,
  hype: 3.4,
  price: "standard",
  launched: true,
  valuation: 40_000_000,
  equity: 0.4,
  board: { founderSeats: 2, investorSeats: 1, control: "founders" },
  investorControlled: false,
  lastRaise: null,
  lastQuarter: null,
  out: null,
};

describe("a company's card in the market", () => {
  it("a rival's card says its public numbers", () => {
    const card = marketCard(base, row, 2_000_000);
    expect(card.title).toBe("Tidewell");
    expect(card.lines).toEqual([
      `${count(1_200_000)} users, ${count(800_000)} short of the bar`,
      "Won 25% of last year's new users",
      "Quality 62, hype 3, standard price",
      `Worth ${money(40_000_000)}`,
      "Private",
    ]);
  });

  it("a public company, a newcomer, the player and one at the bar say so", () => {
    expect(marketCard({ ...base, listed: true, users: 2_500_000 }, null, 2_000_000).lines).toEqual([
      `${count(2_500_000)} users, past the bar`,
      "Won 25% of last year's new users",
      "Public",
    ]);
    expect(marketCard({ ...base, users: 2_000_000 }, null, 2_000_000).lines[0]).toBe(`${count(2_000_000)} users, at the bar`);
    expect(marketCard({ ...base, newcomer: true }, null, 2_000_000).lines.at(-1)).toBe("New this year");
    expect(marketCard({ ...base, seat: 0, state: "player", name: "Acme" }, null, 2_000_000).title).toBe("Acme (you)");
  });

  it("a rival not live yet says so", () => {
    expect(marketCard(base, { ...row, launched: false }, 2_000_000).lines[2]).toBe("Quality 62 (not live), hype 3, standard price");
  });

  it("never says a period word of the race", () => {
    const all = [MARKET_WORDS.show, MARKET_WORDS.card, ...marketCard(base, row, 1).lines, ...marketCard(base, null, 1).lines].join(" ");
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
  });
});
