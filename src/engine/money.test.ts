import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { effectiveWork, valuationOf } from "./formulas";
import { HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, reportFor, resolve, withCompany, withState } from "./testKit";

describe("a quarter's books", () => {
  // One company alone in the market, so every number can be checked by hand:
  // 5 people (2 Product, 2 Growth, 1 Recruiting), quality 50, 10,000 users, $50K marketing, Standard price.
  const solo = withState(
    onlyActive(launchedCompany(newGame(), HUMAN, { headcount: 5, headcountAtLastClose: 5, cash: 400_000, hype: 20 }), [HUMAN]),
    { turn: 3 },
  );
  const result = resolve(solo, { [HUMAN]: { allocation: { product: 2, growth: 2, recruiting: 1 }, marketing: 50_000 } });
  const report = reportFor(result, HUMAN);

  it("does the work of 5 ^ 0.9 people, split by department", () => {
    const work = effectiveWork(5, 0.9);
    expect(report.work.effective).toBe(work);
    expect(report.work.product).toBeCloseTo((work * 2) / 5, 9);
    expect(report.work.growth).toBeCloseTo((work * 2) / 5, 9);
    expect(report.work.recruiting).toBeCloseTo(work / 5, 9);
  });

  it("raises quality by 5 × product work × (1 − 50/100), less 2", () => {
    expect(report.quality.end).toBeCloseTo(50 + 5 * ((effectiveWork(5, 0.9) * 2) / 5) * 0.5 - 2, 3);
  });

  it("churns 12% − 0.08 × quality of its users, and wins the whole pool back", () => {
    expect(report.users.churned).toBe(782);
    expect(result.log.market).toEqual({ newUsers: 24_200, carriedIn: 0, churned: 782, pool: 24_982, carriedOut: 0 });
    expect(report.users).toMatchObject({ open: 10_000, lostToEvent: 0, churned: 782, won: 24_982, end: 34_200, share: 1 });
  });

  it("earns $3 a user on end-of-turn users", () => {
    expect(report.revenue).toBe(102_600);
  });

  it("pays salaries, marketing and hiring fees", () => {
    expect(report.hiring.hired).toBe(2);
    expect(report.costs).toEqual({ salaries: 200_000, marketing: 50_000, hiring: 20_000, poaching: 0, severance: 0, total: 270_000 });
  });

  it("ends with cash = start − costs + revenue", () => {
    expect(report.cash).toEqual({ start: 400_000, end: 232_600 });
    expect(result.state.companies[HUMAN].cash).toBe(232_600);
  });

  it("is unprofitable, with runway = cash ÷ (costs − revenue)", () => {
    expect(report.profitable).toBe(false);
    expect(report.runway).toBeCloseTo(232_600 / 167_400, 9);
  });

  it("keeps the quarter's totals for next turn's runway", () => {
    expect(result.state.companies[HUMAN]).toMatchObject({ lastRevenue: 102_600, lastCosts: 270_000 });
  });

  it("gains 5 hype for growing 25% or more, after the 20% decay", () => {
    expect(report.hype).toMatchObject({ start: 20, growth: 5, end: 21 });
  });

  it("values the company on end-of-turn users and hype", () => {
    expect(report.valuation).toBe(valuationOf(34_200, 21, 1, CONFIG));
    expect(report.equity).toBe(1);
  });

  it("is profitable with no runway limit when revenue covers costs", () => {
    const rich = withCompany(solo, HUMAN, { users: 100_000, usersAtLastClose: 100_000 });
    const good = reportFor(resolve(rich), HUMAN);
    expect(good.revenue).toBeGreaterThanOrEqual(good.costs.total);
    expect(good.profitable).toBe(true);
    expect(good.runway).toBeNull();
  });

  it("counts a quarter that exactly breaks even as profitable", () => {
    // One person ($40,000 salary) on Budget ($2), alone in a market with no new users, so users stay put.
    const lone = (users: number) =>
      reportFor(
        resolve(
          onlyActive(launchedCompany(newGame(), HUMAN, { headcount: 1, headcountAtLastClose: 1, users, usersAtLastClose: users }), [HUMAN]),
          { [HUMAN]: { price: "budget" } },
          1,
          { ...CONFIG, market: { ...CONFIG.market, newUsersTurn1: 0 } },
        ),
        HUMAN,
      );
    expect(lone(19_999)).toMatchObject({ revenue: 39_998, profitable: false });
    expect(lone(20_000)).toMatchObject({ revenue: 40_000, profitable: true, runway: null });
    expect(lone(20_000).costs.total).toBe(40_000);
  });

  it("prices each tier at its own rate", () => {
    const priced = (price: "budget" | "standard" | "premium") => reportFor(resolve(solo, { [HUMAN]: { price } }), HUMAN);
    expect(priced("budget").revenue).toBe(priced("budget").users.end * 2);
    expect(priced("standard").revenue).toBe(priced("standard").users.end * 3);
    expect(priced("premium").revenue).toBe(priced("premium").users.end * 5);
  });
});

describe("raising", () => {
  const ready = launchedCompany(newGame(), HUMAN, { users: 10_000, hype: 20, cash: 100_000 });
  const raise = (percent: number) => resolve(ready, { [HUMAN]: { raisePercent: percent, allocation: { product: 2, growth: 0, recruiting: 0 } } });

  it("is priced on start-of-turn users and hype: valuation × percent", () => {
    for (const percent of [10, 20, 30]) {
      expect(reportFor(raise(percent), HUMAN).raise).toEqual({ percent, valuation: 1_800_000, amount: 18_000 * percent });
    }
  });

  it("lands in cash the same turn, and the fundraiser is still paid", () => {
    const report = reportFor(raise(20), HUMAN);
    expect(report.costs.salaries).toBe(120_000);
    expect(report.cash.end).toBe(100_000 + 360_000 - report.costs.total + report.revenue);
  });

  it("multiplies founder equity by (1 − percent) and adds an investor seat", () => {
    const first = raise(20);
    expect(first.state.companies[HUMAN]).toMatchObject({ founderEquity: 0.8, founderSeats: 2, investorSeats: 1 });
    expect(first.state.companies[HUMAN].lastRaise).toEqual({ turn: 1, percent: 20, amount: 360_000 });
    const later = withState(first.state, { turn: 4 });
    const second = resolve(later, { [HUMAN]: { raisePercent: 20 } });
    expect(second.state.companies[HUMAN].founderEquity).toBeCloseTo(0.64, 9);
    expect(second.state.companies[HUMAN].investorSeats).toBe(2);
  });

  it("dilutes the Incumbent from 60%", () => {
    const result = resolve(newGame(), { [INCUMBENT]: { raisePercent: 30 } });
    expect(result.state.companies[INCUMBENT].founderEquity).toBeCloseTo(0.42, 9);
    expect(result.state.companies[INCUMBENT].investorSeats).toBe(2);
  });

  it("adds 10 hype when it closes", () => {
    expect(reportFor(raise(10), HUMAN).hype.raise).toBe(10);
    expect(reportFor(resolve(ready), HUMAN).hype.raise).toBe(0);
  });

  it("takes one person off other work that turn", () => {
    const report = reportFor(raise(20), HUMAN);
    const work = effectiveWork(3, 0.9);
    expect(report.work.effective).toBe(work);
    expect(report.work.product).toBeCloseTo((work * 2) / 3, 9);
    expect(report.work.product + report.work.growth + report.work.recruiting).toBeCloseTo((work * 2) / 3, 9);
  });

  it("is worth 40% less in a funding winter and 40% more in a hot market", () => {
    const winter = withState(ready, { climate: { multiplier: 0.6, turnsLeft: 2 } });
    expect(reportFor(resolve(winter, { [HUMAN]: { raisePercent: 20 } }), HUMAN).raise).toEqual({ percent: 20, valuation: 1_080_000, amount: 216_000 });
    const hot = withState(ready, { climate: { multiplier: 1.4, turnsLeft: 1 } });
    expect(reportFor(resolve(hot, { [HUMAN]: { raisePercent: 20 } }), HUMAN).raise).toEqual({ percent: 20, valuation: 2_520_000, amount: 504_000 });
  });

  it("is not revenue: an unprofitable quarter stays unprofitable", () => {
    const report = reportFor(raise(30), HUMAN);
    expect(report.cash.end).toBeGreaterThan(report.cash.start);
    expect(report.revenue).toBeLessThan(report.costs.total);
    expect(report.profitable).toBe(false);
  });

  it("blocks the next two turns", () => {
    const first = raise(10);
    const turn2 = resolve(first.state, { [HUMAN]: { raisePercent: 10 } });
    expect(reportFor(turn2, HUMAN).raise).toBeNull();
    const turn3 = resolve(turn2.state, { [HUMAN]: { raisePercent: 10 } });
    expect(reportFor(turn3, HUMAN).raise).toBeNull();
    const turn4 = resolve(turn3.state, { [HUMAN]: { raisePercent: 10 } });
    expect(reportFor(turn4, HUMAN).raise?.percent).toBe(10);
  });
});

describe("hype in a turn", () => {
  it("gives +5 only when users grew 25% over last quarter's close", () => {
    const growth = (users: number) => {
      const state = withState(onlyActive(launchedCompany(newGame(), HUMAN, { users, usersAtLastClose: users, headcount: 1, headcountAtLastClose: 1 }), [HUMAN]), { turn: 1 });
      return reportFor(resolve(state), HUMAN);
    };
    // Alone in the market the company ends with its users plus the 20,000 new ones.
    expect(growth(80_000).users.end).toBe(100_000);
    expect(growth(80_000).hype.growth).toBe(5);
    expect(growth(80_001).hype.growth).toBe(0);
  });

  it("gives no growth bonus to a company that had no users at the last close", () => {
    const report = reportFor(resolve(newGame()), HUMAN);
    expect(report.users.end).toBeGreaterThan(0);
    expect(report.hype.growth).toBe(0);
  });

  it("stays within 0–100", () => {
    const hot = withCompany(newGame(), HUMAN, { hype: 100, headcount: 4, headcountAtLastClose: 4 });
    expect(reportFor(resolve(hot), HUMAN).hype.end).toBe(95);
    // With the design's numbers a turn cannot push hype past 100, so switch the decay off to test the cap.
    const top = launchedCompany(newGame(), HUMAN, { hype: 100 });
    const noDecay = { ...CONFIG, hype: { ...CONFIG.hype, decay: 0 } };
    expect(reportFor(resolve(top, { [HUMAN]: { raisePercent: 10 } }, 1, noDecay), HUMAN).hype.end).toBe(100);
    const cold = withCompany(newGame(), HUMAN, { hype: 5, headcount: 4, headcountAtLastClose: 4 });
    const report = reportFor(resolve(cold, { [HUMAN]: { layoffs: 1, allocation: { product: 0, growth: 3, recruiting: 0 } } }), HUMAN);
    expect(report.hype).toMatchObject({ start: 5, layoffs: -10, end: 0 });
  });
});
