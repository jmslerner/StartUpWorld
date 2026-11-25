import { describe, expect, it } from "vitest";
import { byHypeOrder, handOutCandidates } from "./hiring";

describe("handOutCandidates", () => {
  it("hands out one candidate at a time, highest hype first", () => {
    const result = handOutCandidates(6, [
      { id: 0, hype: 10, tieKey: 0.5, wanted: 2 },
      { id: 1, hype: 30, tieKey: 0.5, wanted: 2 },
      { id: 3, hype: 20, tieKey: 0.5, wanted: 2 },
    ]);
    expect(result.picks).toEqual([1, 3, 0, 1, 3, 0]);
    expect(result.hired).toEqual({ 0: 2, 1: 2, 3: 2 });
  });

  it("leaves the lowest hype without when candidates run short", () => {
    const result = handOutCandidates(4, [
      { id: 0, hype: 10, tieKey: 0.1, wanted: 2 },
      { id: 1, hype: 30, tieKey: 0.1, wanted: 2 },
      { id: 3, hype: 20, tieKey: 0.1, wanted: 2 },
    ]);
    expect(result.picks).toEqual([1, 3, 0, 1]);
    expect(result.hired).toEqual({ 0: 1, 1: 2, 3: 1 });
  });

  it("never gives a company more than it wants, and leaves the rest unhired", () => {
    const result = handOutCandidates(10, [
      { id: 0, hype: 10, tieKey: 0.1, wanted: 1 },
      { id: 1, hype: 30, tieKey: 0.1, wanted: 3 },
    ]);
    expect(result.picks).toEqual([1, 0, 1, 1]);
    expect(result.hired).toEqual({ 0: 1, 1: 3 });
  });

  it("orders equal hype by the tie key", () => {
    const result = handOutCandidates(2, [
      { id: 0, hype: 10, tieKey: 0.9, wanted: 1 },
      { id: 1, hype: 10, tieKey: 0.2, wanted: 1 },
      { id: 2, hype: 10, tieKey: 0.5, wanted: 1 },
    ]);
    expect(result.picks).toEqual([1, 2]);
    expect(result.hired).toEqual({ 0: 0, 1: 1, 2: 1 });
  });

  it("does nothing with no candidates or no demand", () => {
    expect(handOutCandidates(0, [{ id: 0, hype: 10, tieKey: 0.1, wanted: 2 }])).toEqual({ picks: [], hired: { 0: 0 } });
    expect(handOutCandidates(5, [{ id: 0, hype: 10, tieKey: 0.1, wanted: 0 }])).toEqual({ picks: [], hired: { 0: 0 } });
    expect(handOutCandidates(5, [])).toEqual({ picks: [], hired: {} });
  });
});

describe("byHypeOrder", () => {
  it("sorts by hype, then tie key, then id", () => {
    const sorted = [
      { id: 2, hype: 10, tieKey: 0.3 },
      { id: 1, hype: 10, tieKey: 0.3 },
      { id: 0, hype: 10, tieKey: 0.1 },
      { id: 3, hype: 25, tieKey: 0.9 },
    ].sort(byHypeOrder);
    expect(sorted.map((x) => x.id)).toEqual([3, 0, 1, 2]);
  });
});
