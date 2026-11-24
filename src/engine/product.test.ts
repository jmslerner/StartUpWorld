import { describe, expect, it } from "vitest";
import { BLITZ, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, reportFor, resolve, withCompany } from "./testKit";

describe("product quality in a turn", () => {
  it("launches a startup on turn 1 when all three people build", () => {
    const result = resolve(newGame());
    const report = reportFor(result, HUMAN);
    expect(report.quality.start).toBe(0);
    expect(report.quality.gain).toBeCloseTo(13.4394, 3);
    expect(report.quality.decay).toBe(2);
    expect(report.quality.end).toBeCloseTo(11.4394, 3);
    expect(report.quality.launchedNow).toBe(true);
    expect(result.state.companies[HUMAN].launched).toBe(true);
    expect(result.state.companies[HUMAN].quality).toBe(report.quality.end);
    expect(report.hype.launch).toBe(15);
  });

  it("takes two turns to launch with two of three people building", () => {
    const split = { [HUMAN]: { allocation: { product: 2, growth: 1, recruiting: 0 } } };
    const first = resolve(newGame(), split);
    expect(reportFor(first, HUMAN).quality.end).toBeCloseTo(6.9596, 3);
    expect(reportFor(first, HUMAN).quality.launchedNow).toBe(false);
    expect(first.state.companies[HUMAN].launched).toBe(false);
    const second = resolve(first.state, split);
    expect(reportFor(second, HUMAN).quality.end).toBeGreaterThanOrEqual(10);
    expect(reportFor(second, HUMAN).quality.launchedNow).toBe(true);
    expect(reportFor(second, HUMAN).hype.launch).toBe(15);
  });

  it("gives no users, churn or revenue before launch", () => {
    const result = resolve(newGame(), { [HUMAN]: { allocation: { product: 1, growth: 2, recruiting: 0 } } });
    const report = reportFor(result, HUMAN);
    expect(report.quality.launchedNow).toBe(false);
    expect(report.users).toMatchObject({ churned: 0, won: 0, end: 0, pull: 0, share: 0 });
    expect(report.revenue).toBe(0);
    expect(result.state.companies[HUMAN].lastPull).toBeNull();
  });

  it("tests the launch after the decay", () => {
    // Gain of 11 from quality 0 leaves 9 after the decay: not launched.
    const state = withCompany(newGame(), HUMAN, { quality: 0 });
    const twoAndABit = resolve(state, { [HUMAN]: { allocation: { product: 2, growth: 1, recruiting: 0 } } });
    expect(reportFor(twoAndABit, HUMAN).quality.gain).toBeLessThan(10);
    const almost = withCompany(newGame(), HUMAN, { quality: 3.5 });
    const result = resolve(almost, { [HUMAN]: { allocation: { product: 2, growth: 1, recruiting: 0 } } });
    // 3.5 + 8.96 × 0.965 = 12.15 before the decay, 10.15 after: launched.
    expect(reportFor(result, HUMAN).quality.end).toBeGreaterThanOrEqual(10);
    expect(reportFor(result, HUMAN).quality.launchedNow).toBe(true);
    const short = withCompany(newGame(), HUMAN, { quality: 3 });
    const shortResult = resolve(short, { [HUMAN]: { allocation: { product: 2, growth: 1, recruiting: 0 } } });
    // 3 + 8.96 × 0.97 = 11.69 before the decay, 9.69 after: not launched, although it passed 10 on the way.
    expect(reportFor(shortResult, HUMAN).quality.end).toBeLessThan(10);
    expect(reportFor(shortResult, HUMAN).quality.launchedNow).toBe(false);
  });

  it("loses 2 a turn with nobody building, and stops at 0", () => {
    const result = resolve(newGame(), { [INCUMBENT]: { allocation: { product: 0, growth: 8, recruiting: 0 } } });
    expect(reportFor(result, INCUMBENT).quality).toMatchObject({ start: 30, gain: 0, end: 28 });
    const low = withCompany(newGame(), HUMAN, { quality: 1 });
    expect(reportFor(resolve(low, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } }), HUMAN).quality.end).toBe(0);
  });

  it("keeps a product launched when its quality falls back under 10", () => {
    const state = launchedCompany(newGame(), HUMAN, { quality: 10.5, users: 2_000 });
    const result = resolve(state, { [HUMAN]: { allocation: { product: 0, growth: 3, recruiting: 0 } } });
    expect(reportFor(result, HUMAN).quality.end).toBe(8.5);
    expect(reportFor(result, HUMAN).quality.launchedNow).toBe(false);
    expect(result.state.companies[HUMAN].launched).toBe(true);
    expect(reportFor(result, HUMAN).users.won).toBeGreaterThan(0);
  });

  it("slows down as quality rises", () => {
    const low = reportFor(resolve(withCompany(newGame(), HUMAN, { quality: 20 })), HUMAN);
    const high = reportFor(resolve(withCompany(newGame(), HUMAN, { quality: 80 })), HUMAN);
    expect(high.quality.gain).toBeCloseTo(low.quality.gain / 4, 6);
  });
});

describe("the Incumbent's catch-up bonus", () => {
  const baseGain = reportFor(resolve(newGame()), INCUMBENT).quality.gain;

  it("is off while the Incumbent has the best product", () => {
    const report = reportFor(resolve(newGame()), INCUMBENT);
    expect(report.quality.catchUp).toBe(false);
  });

  it("adds 50% to its product output while a launched rival has a better product", () => {
    const state = launchedCompany(newGame(), HUMAN, { quality: 60 });
    const report = reportFor(resolve(state), INCUMBENT);
    expect(report.quality.catchUp).toBe(true);
    expect(report.quality.gain).toBeCloseTo(baseGain * 1.5, 6);
  });

  it("is off on a tie", () => {
    const state = launchedCompany(newGame(), HUMAN, { quality: 30 });
    expect(reportFor(resolve(state), INCUMBENT).quality.catchUp).toBe(false);
  });

  it("looks at start-of-turn quality, not at what rivals build this turn", () => {
    // The rival starts at 29 and ends above the Incumbent's 30, but the bonus is decided at the start.
    const state = launchedCompany(newGame(), HUMAN, { quality: 29 });
    const result = resolve(state);
    expect(reportFor(result, HUMAN).quality.end).toBeGreaterThan(30);
    expect(reportFor(result, INCUMBENT).quality.catchUp).toBe(false);
  });

  it("ignores rivals that are out or have not launched", () => {
    const unlaunched = withCompany(newGame(), HUMAN, { quality: 60, launched: false });
    expect(reportFor(resolve(unlaunched), INCUMBENT).quality.catchUp).toBe(false);
    const gone = onlyActive(launchedCompany(newGame(), HUMAN, { quality: 60 }), [BLITZ, INCUMBENT]);
    expect(reportFor(resolve(gone), INCUMBENT).quality.catchUp).toBe(false);
  });

  it("never applies to a startup", () => {
    const report = reportFor(resolve(newGame()), HUMAN);
    expect(report.quality.catchUp).toBe(false);
  });
});
