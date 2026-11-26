import { describe, expect, it } from "vitest";
import type { MarketCompany, MarketScene, MarketSeatState } from "../types";
import { flowDots, MARKET_BUILDING_HEIGHT, marketFrame, marketLayout } from "./marketLayout";

const company = (seat: number, height: number, won: number, state: MarketSeatState = seat === 0 ? "player" : "rival"): MarketCompany =>
  ({ seat, name: `C${seat}`, state, users: Math.round(height * 100), height, won, listed: false, newcomer: false });
const scene = (companies: MarketCompany[], bar = 0.5): MarketScene =>
  ({ runId: "r", year: 2000, era: "bust", barUsers: 100, bar, pool: 100, companies });

describe("the market's layout", () => {
  it("stands four lots in a row, the player's first, none overlapping, all inside the bounds", () => {
    const layout = marketLayout(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0, 0, "out")]));
    expect(layout.lots.map((lot) => lot.seat)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < 4; i++) expect(layout.lots[i].x - layout.lots[i - 1].x).toBeGreaterThan((layout.lots[i].width + layout.lots[i - 1].width) / 2);
    for (const lot of layout.lots) {
      expect(lot.x - lot.width / 2).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(lot.x + lot.width / 2).toBeLessThanOrEqual(layout.bounds.maxX);
    }
    expect(layout.lots.map((lot) => lot.height)).toEqual([0.2, 1, 0.5, 0].map((h) => h * MARKET_BUILDING_HEIGHT));
    expect(layout.barY).toBeCloseTo(0.5 * MARKET_BUILDING_HEIGHT);
    expect(layout.source.z).toBeGreaterThan(Math.max(...layout.lots.map((lot) => lot.z)));
  });

  it("shares the dots by what each company won", () => {
    expect(flowDots([0.5, 0.25, 0.25, 0], 48)).toEqual([24, 12, 12, 0]);
    expect(flowDots([1 / 3, 1 / 3, 1 / 3, 0], 48)).toEqual([16, 16, 16, 0]);
    expect(flowDots([0.3, 0.3, 0.2, 0.1], 10)).toEqual([3, 3, 2, 1]);
    expect(flowDots([0, 0, 0, 0], 48)).toEqual([0, 0, 0, 0]);
  });

  it("frames the whole row, the tallest building and the source on a shot centred inside the bounds", () => {
    const layout = marketLayout(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0, 0, "out")]));
    const frame = marketFrame(layout);
    expect(frame.target.x).toBeGreaterThan(layout.bounds.minX);
    expect(frame.target.x).toBeLessThan(layout.bounds.maxX);
    expect(frame.target.z).toBeGreaterThan(layout.bounds.minZ);
    expect(frame.target.z).toBeLessThan(layout.bounds.maxZ);
    expect(frame.width).toBeGreaterThan(4 * 3.2);
    expect(frame.height).toBeGreaterThan(MARKET_BUILDING_HEIGHT * Math.cos(Math.atan(Math.SQRT1_2)));
  });
});
