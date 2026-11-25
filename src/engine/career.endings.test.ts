import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, atTurn, newCareer } from "./careerKit";
import { BLITZ, BOOT, HUMAN, launchedCompany, onlyActive, reportFor, resolve, withCompany, withState } from "./testKit";
import type { CompanyId, GameState } from "./types";

/** The last year of a career with only these seats in the game (0 and 1 unless named), and no new users arriving to be split. */
const lastYear = (seats: readonly CompanyId[] = [HUMAN, BLITZ]): GameState => {
  const state = atTurn(onlyActive(newCareer(), seats), CAREER_TEST.game.maxTurns);
  return withState(state, { modifiers: { ...state.modifiers, newUsers: 0 } });
};

describe("how a career ends", () => {
  it("reaching the bar with a profit ends nothing", () => {
    // Seat 0: launched, 300,000 users (the bar is 250,000), revenue above its costs.
    const rich = launchedCompany(newCareer(), HUMAN, { users: 300_000, quality: 80 });
    const result = resolve(rich, {}, 1, CAREER_TEST);
    expect(reportFor(result, HUMAN).users.end).toBeGreaterThanOrEqual(CAREER_TEST.ipo.users);
    expect(reportFor(result, HUMAN).profitable).toBe(true);
    expect(result.log.outcome).toBeNull();
    expect(result.state.turn).toBe(rich.turn + 1);
    expect(resolve(rich, {}, 1, DESIGN).log.outcome?.kind).toBe("ipo"); // the same state in the race
  });

  it("a career goes on with one company left, and with none (Review Focus 3)", () => {
    expect(resolve(onlyActive(newCareer(), [HUMAN]), {}, 1, CAREER_TEST).log.outcome).toBeNull();
    const empty = resolve(onlyActive(newCareer(), []), {}, 1, CAREER_TEST);
    expect(empty.log.outcome).toBeNull();
    expect(empty.log.companies).toEqual([null, null, null, null]);
    expect(empty.state.carryOverUsers).toBe(empty.log.market.pool); // the year's users wait
  });

  it("after the last year the largest founder's stake wins", () => {
    // Turn 49; seats 2 and 3 are out; seat 0: 100,000 users, equity 1; seat 1: 300,000 users, equity 0.2; the same
    // hype, quality and plan; modifiers.newUsers is 0, so no new users arrive to be split.
    let final = launchedCompany(lastYear(), HUMAN, { users: 100_000, founderEquity: 1 });
    final = launchedCompany(final, BLITZ, { users: 300_000, founderEquity: 0.2 });
    const result = resolve(final, {}, 1, CAREER_TEST);
    expect(reportFor(result, BLITZ).valuation).toBeGreaterThan(reportFor(result, HUMAN).valuation);
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: 0 });
    expect(result.state.turn).toBe(49);
  });

  it("level stakes go to the higher valuation, then to the lower seat", () => {
    // Two founders who own nothing: both stakes are 0, and seat 1 is worth more.
    let unowned = launchedCompany(lastYear(), HUMAN, { users: 10_000, founderEquity: 0 });
    unowned = launchedCompany(unowned, BLITZ, { users: 50_000, founderEquity: 0 });
    const byValuation = resolve(unowned, {}, 1, CAREER_TEST);
    expect(reportFor(byValuation, BLITZ).valuation).toBeGreaterThan(reportFor(byValuation, HUMAN).valuation);
    expect(byValuation.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BLITZ });

    // Seats 1 and 2 alike in every way: the same stake and the same valuation, so the lower seat wins.
    const twins = launchedCompany(launchedCompany(lastYear([BLITZ, BOOT]), BLITZ, { users: 40_000 }), BOOT, { users: 40_000 });
    const bySeat = resolve(twins, {}, 1, CAREER_TEST);
    expect(reportFor(bySeat, BOOT).valuation).toBe(reportFor(bySeat, BLITZ).valuation);
    expect(reportFor(bySeat, BOOT).equity).toBe(reportFor(bySeat, BLITZ).equity);
    expect(bySeat.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BLITZ });
  });

  it("a company that is out cannot win", () => {
    // Seat 0 holds by far the largest stake, but its cash runs out in the last year.
    let broke = launchedCompany(lastYear(), HUMAN, { users: 200_000, founderEquity: 1, cash: -10_000_000 });
    broke = launchedCompany(broke, BLITZ, { users: 10_000, founderEquity: 0.5 });
    const result = resolve(broke, {}, 1, CAREER_TEST);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BLITZ });

    // Seat 0 went out in an earlier year, still owning everything it had.
    const earlier = withCompany(broke, HUMAN, { cash: 10_000_000, out: { turn: 30, reason: "bankrupt", users: 200_000, headcount: 3 } });
    expect(resolve(earlier, {}, 1, CAREER_TEST).log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: BLITZ });
  });

  it("with nobody left after the last year there is no winner (Review Focus 3)", () => {
    expect(resolve(atTurn(onlyActive(newCareer(), []), 49), {}, 1, CAREER_TEST).log.outcome).toEqual({ kind: "wipeout", turn: 49, winnerId: null });
  });
});
