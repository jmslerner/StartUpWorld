import { describe, expect, it } from "vitest";
import type { MarketCompany, MarketScene, MarketSeatState } from "../types";
import { BAR_RING, BUILDING_WIDTH, flowDots, MARKET_BUILDING_HEIGHT, marketFrame, marketLayout, marketMarks, PLAZA_HEIGHT } from "./marketLayout";

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

describe("the points the labels stand on", () => {
  it("each building still standing has its roof's centre and four corners; the bar its two ends on screen, left and right, and its first ring's back corner", () => {
    const layout = marketLayout(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0, 0.2), company(3, 0, 0, "out")], 0.4));
    const marks = marketMarks(layout);
    // A company with no users still stands (a stub of a building); one that went out does not.
    expect(marks.lots.map((lot) => lot.seat)).toEqual([0, 1, 2]);
    for (const mark of marks.lots) {
      const lot = layout.lots.find((each) => each.seat === mark.seat)!;
      expect(mark.centre).toEqual({ x: lot.x, y: PLAZA_HEIGHT + lot.height, z: lot.z });
      expect(mark.corners).toHaveLength(4);
      for (const corner of mark.corners) {
        expect(corner.y).toBe(PLAZA_HEIGHT + lot.height);
        expect(Math.abs(corner.x - lot.x)).toBeCloseTo(BUILDING_WIDTH / 2);
        expect(Math.abs(corner.z - lot.z)).toBeCloseTo(BUILDING_WIDTH / 2);
      }
    }
    const first = layout.lots[0];
    const last = layout.lots[3];
    // The camera looks from +X, +Z: the front-left corner of the first ring is the leftmost on screen, the back-right of the last the rightmost.
    expect(marks.bar).toEqual({
      left: { x: first.x - BAR_RING / 2, y: PLAZA_HEIGHT + layout.barY, z: first.z + BAR_RING / 2 },
      right: { x: last.x + BAR_RING / 2, y: PLAZA_HEIGHT + layout.barY, z: last.z - BAR_RING / 2 },
      top: { x: first.x - BAR_RING / 2, y: PLAZA_HEIGHT + layout.barY, z: first.z - BAR_RING / 2 },
    });
  });

  it("the bar's ring stands clear round a building, inside its lot", () => {
    expect(BAR_RING).toBeGreaterThan(BUILDING_WIDTH);
    expect(BAR_RING).toBeLessThan(marketLayout(scene([company(0, 0.2, 0.1)])).lots[0].width);
  });
});
