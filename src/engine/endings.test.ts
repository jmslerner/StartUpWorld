import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { founderStake } from "./formulas";
import { STREAM, firstFloat } from "./rng";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, reportFor, resolve, seedWhere, usersInSystem, withCompany, withState } from "./testKit";
import type { Company, GameState } from "./types";

const IDLE = { product: 0, growth: 3, recruiting: 0 };
const NO_EVENTS = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const RECRUIT = { product: 2, growth: 0, recruiting: 1 };

describe("bankruptcy", () => {
  it("takes out a company that ends the turn below $0", () => {
    const state = withCompany(newGame(), HUMAN, { cash: 100_000 });
    const result = resolve(state, { [HUMAN]: { allocation: IDLE } });
    expect(reportFor(result, HUMAN).cash.end).toBe(-20_000);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(result.state.companies[HUMAN]).toMatchObject({ users: 0, headcount: 0, out: { turn: 1, reason: "bankrupt", users: 0, headcount: 3 } });
    expect(result.state.outcome).toBeNull();
  });

  it("logs the users it releases as carried out: what one turn carries out, the next carries in", () => {
    const state = launchedCompany(newGame(NO_EVENTS), HUMAN, { users: 12_000, cash: -500_000 });
    const first = resolve(state, { [HUMAN]: { allocation: IDLE } }, 1, NO_EVENTS);
    expect(first.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    expect(first.state.carryOverUsers).toBeGreaterThan(0);
    expect(first.log.market.carriedOut).toBe(first.state.carryOverUsers);
    const second = resolve(first.state, {}, 1, NO_EVENTS);
    expect(second.log.market.carriedIn).toBe(first.log.market.carriedOut);
  });

  it("lets a company that ends on exactly $0 survive", () => {
    const state = withCompany(newGame(), HUMAN, { cash: 120_000 });
    const result = resolve(state, { [HUMAN]: { allocation: IDLE } });
    expect(reportFor(result, HUMAN).cash.end).toBe(0);
    expect(result.state.companies[HUMAN].out).toBeNull();
  });

  it("releases its users to next turn's pool and its people to next turn's candidates", () => {
    const state = launchedCompany(newGame(), HUMAN, { cash: 0 });
    const first = resolve(state);
    const report = reportFor(first, HUMAN);
    expect(report.out).toBe("bankrupt");
    expect(report.users.end).toBeGreaterThan(0);
    expect(first.state.companies[HUMAN].out).toMatchObject({ users: report.users.end, headcount: 3 });
    expect(first.state.carryOverUsers).toBe(report.users.end);
    expect(first.state.freedPeople).toBe(3);
    expect(usersInSystem(first.state)).toBe(usersInSystem(state) + first.log.market.newUsers);

    const second = resolve(first.state, {}, 1, NO_EVENTS);
    expect(second.log.market.carriedIn).toBe(report.users.end);
    expect(second.log.hiring.candidates).toBe(6 + 3);
    expect(second.log.companies[HUMAN]).toBeNull();
    expect(second.state.carryOverUsers).toBe(0);
    expect(second.state.freedPeople).toBe(0);
    expect(usersInSystem(second.state)).toBe(usersInSystem(first.state) + second.log.market.newUsers);
  });

  it("frees the people it hired that turn along with everyone else", () => {
    const state = withCompany(newGame(), HUMAN, { cash: 0 });
    const result = resolve(state, { [HUMAN]: { allocation: RECRUIT } });
    expect(reportFor(result, HUMAN).hiring.hired).toBe(2);
    expect(result.state.freedPeople).toBe(5);
  });
});

describe("IPO", () => {
  const giant = (patch: Partial<Company> = {}): GameState => launchedCompany(newGame(), HUMAN, { users: 300_000, quality: 90, cash: 2_000_000, ...patch });

  it("goes to a company with 250K users and a profitable quarter", () => {
    const result = resolve(giant());
    const report = reportFor(result, HUMAN);
    expect(report.users.end).toBeGreaterThanOrEqual(250_000);
    expect(report.profitable).toBe(true);
    expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: HUMAN });
  });

  it("needs the profit: 250K users on a losing quarter is not enough", () => {
    const result = resolve(giant({ headcount: 30, headcountAtLastClose: 30 }));
    const report = reportFor(result, HUMAN);
    expect(report.users.end).toBeGreaterThanOrEqual(250_000);
    expect(report.profitable).toBe(false);
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(2);
  });

  it("needs the users: a profitable quarter under 250K is not enough", () => {
    const result = resolve(giant({ users: 200_000, usersAtLastClose: 200_000 }));
    const report = reportFor(result, HUMAN);
    expect(report.profitable).toBe(true);
    expect(report.users.end).toBeLessThan(250_000);
    expect(result.state.outcome).toBeNull();
  });

  it("does not count raise proceeds as profit", () => {
    const result = resolve(giant({ headcount: 30, headcountAtLastClose: 30 }), { [HUMAN]: { raisePercent: 30 } });
    expect(reportFor(result, HUMAN).raise?.amount).toBeGreaterThan(10_000_000);
    expect(reportFor(result, HUMAN).profitable).toBe(false);
    expect(result.state.outcome).toBeNull();
  });

  it("breaks a same-turn tie on valuation", () => {
    const state = launchedCompany(giant({ hype: 10 }), BLITZ, { users: 300_000, quality: 90, cash: 2_000_000, hype: 60 });
    const result = resolve(state);
    const human = reportFor(result, HUMAN);
    const blitz = reportFor(result, BLITZ);
    for (const report of [human, blitz]) {
      expect(report.users.end).toBeGreaterThanOrEqual(250_000);
      expect(report.profitable).toBe(true);
    }
    expect(blitz.valuation).toBeGreaterThan(human.valuation);
    expect(result.state.outcome).toEqual({ kind: "ipo", turn: 1, winnerId: BLITZ });
  });

  it("wins on the last turn ahead of the founder-stake ranking", () => {
    const state = withState(giant({ founderEquity: 0.05 }), { turn: 20 });
    expect(resolve(state).state.outcome).toEqual({ kind: "ipo", turn: 20, winnerId: HUMAN });
  });

  it("ends the game there: no next turn and no next event", () => {
    const result = resolve(withState(giant(), { turn: 7 }), {}, 1, { ...DESIGN, events: { ...DESIGN.events, chance: 1 } });
    expect(result.state.turn).toBe(7);
    expect(result.log.nextEvent).toBeNull();
    expect(result.log.outcome?.kind).toBe("ipo");
  });
});

describe("the board", () => {
  const boardRoll = (seed: number, id = HUMAN, turn = 1) => firstFloat(seed, turn, STREAM.board, id);
  /** A launched company with no product and no pull: it only loses users. */
  const shrinking = (patch: Partial<Company> = {}): GameState =>
    launchedCompany(newGame(), HUMAN, { quality: 0, users: 50_000, cash: 5_000_000, investorSeats: 3, ...patch });
  const idle = { [HUMAN]: { allocation: IDLE } };

  it("fires the founder after a bad quarter exactly when the roll is under 30%", () => {
    let fired = 0;
    const seeds = 300;
    for (let seed = 1; seed <= seeds; seed++) {
      const result = resolve(shrinking(), idle, seed);
      const report = reportFor(result, HUMAN);
      expect(report.board).toMatchObject({ usersFell: true, lowRunway: false });
      expect(report.board?.fired, `seed ${seed}`).toBe(boardRoll(seed) < 0.3);
      expect(result.state.companies[HUMAN].out?.reason ?? null).toBe(report.board?.fired ? "fired" : null);
      if (report.board?.fired) fired++;
    }
    expect(fired / seeds).toBeGreaterThan(0.22);
    expect(fired / seeds).toBeLessThan(0.38);
  });

  it("follows the configured chance: always at 100%, never at 0%", () => {
    const always = { ...DESIGN, board: { ...DESIGN.board, fireChance: 1 } };
    const never = { ...DESIGN, board: { ...DESIGN.board, fireChance: 0 } };
    for (let seed = 1; seed <= 40; seed++) {
      expect(reportFor(resolve(shrinking(), idle, seed, always), HUMAN).board?.fired).toBe(true);
      expect(reportFor(resolve(shrinking(), idle, seed, never), HUMAN).board?.fired).toBe(false);
    }
  });

  it("cannot fire while founders hold as many seats as investors", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const result = resolve(shrinking({ investorSeats: 2 }), idle, seed);
      expect(reportFor(result, HUMAN).board).toBeNull();
      expect(result.state.companies[HUMAN].out).toBeNull();
    }
  });

  it("leaves the founder alone after a good quarter", () => {
    const healthy = launchedCompany(newGame(), HUMAN, { quality: 60, cash: 5_000_000, investorSeats: 3 });
    for (let seed = 1; seed <= 60; seed++) {
      const result = resolve(healthy, {}, seed);
      expect(reportFor(result, HUMAN).board).toEqual({ usersFell: false, lowRunway: false, fired: false });
      expect(result.state.companies[HUMAN].out).toBeNull();
    }
  });

  it("counts runway under 2 turns as a bad quarter even when users grew", () => {
    const tight = launchedCompany(newGame(), HUMAN, { quality: 60, cash: 150_000, investorSeats: 3 });
    const firing = seedWhere((seed) => boardRoll(seed) < 0.3);
    const sparing = seedWhere((seed) => boardRoll(seed) >= 0.3);
    const fired = resolve(tight, {}, firing);
    const report = reportFor(fired, HUMAN);
    expect(report.users.end).toBeGreaterThan(report.users.open);
    expect(report.runway).not.toBeNull();
    expect(report.runway!).toBeLessThan(2);
    expect(report.cash.end).toBeGreaterThan(0);
    expect(report.board).toEqual({ usersFell: false, lowRunway: true, fired: true });
    expect(reportFor(resolve(tight, {}, sparing), HUMAN).board).toEqual({ usersFell: false, lowRunway: true, fired: false });
  });

  it("counts the seat added by this turn's raise", () => {
    const level = shrinking({ investorSeats: 2 });
    const result = resolve(level, { [HUMAN]: { raisePercent: 10, allocation: { product: 0, growth: 2, recruiting: 0 } } });
    expect(result.log.companies[HUMAN]?.board).not.toBeNull();
    expect(reportFor(result, HUMAN).board?.usersFell).toBe(true);
  });

  it("gives the Incumbent one safe raise: the second hands the board to investors", () => {
    const first = resolve(newGame(), { [INCUMBENT]: { raisePercent: 10 } });
    expect(first.state.companies[INCUMBENT]).toMatchObject({ founderSeats: 2, investorSeats: 2 });
    expect(reportFor(first, INCUMBENT).board).toBeNull();
    const second = resolve(withState(first.state, { turn: 4 }), { [INCUMBENT]: { raisePercent: 10 } });
    expect(second.state.companies[INCUMBENT].investorSeats).toBe(3);
    expect(reportFor(second, INCUMBENT).board).not.toBeNull();
  });

  it("shuts a fired founder's company down like a bankrupt one", () => {
    const state = shrinking();
    const firing = seedWhere((seed) => boardRoll(seed) < 0.3);
    const result = resolve(state, idle, firing);
    const report = reportFor(result, HUMAN);
    expect(report.out).toBe("fired");
    expect(report.cash.end).toBeGreaterThan(0);
    expect(result.state.companies[HUMAN]).toMatchObject({ users: 0, headcount: 0, out: { turn: 1, reason: "fired", users: report.users.end, headcount: 3 } });
    expect(result.state.carryOverUsers).toBe(report.users.end);
    expect(result.state.freedPeople).toBe(3);
    expect(usersInSystem(result.state)).toBe(usersInSystem(state) + result.log.market.newUsers);
  });

  it("does not vote on a company that just went bankrupt", () => {
    const firing = seedWhere((seed) => boardRoll(seed) < 0.3);
    const result = resolve(shrinking({ cash: -1_000_000 }), idle, firing);
    expect(reportFor(result, HUMAN).out).toBe("bankrupt");
    expect(reportFor(result, HUMAN).board?.fired ?? false).toBe(false);
  });

  it("rolls separately for each company", () => {
    const both = launchedCompany(shrinking(), BLITZ, { quality: 0, users: 50_000, cash: 5_000_000, investorSeats: 3 });
    const plans = { [HUMAN]: { allocation: IDLE }, [BLITZ]: { allocation: IDLE } };
    const seed = seedWhere((s) => boardRoll(s, HUMAN) < 0.3 && boardRoll(s, BLITZ) >= 0.3);
    const result = resolve(both, plans, seed);
    expect(reportFor(result, HUMAN).board?.fired).toBe(true);
    expect(reportFor(result, BLITZ).board?.fired).toBe(false);
  });
});

describe("last one standing", () => {
  it("wins when every other company is out", () => {
    const state = withCompany(onlyActive(newGame(), [HUMAN, BLITZ]), BLITZ, { cash: 0 });
    const result = resolve(state, { [BLITZ]: { allocation: IDLE } });
    expect(result.state.companies[BLITZ].out?.reason).toBe("bankrupt");
    expect(result.state.outcome).toEqual({ kind: "lastStanding", turn: 1, winnerId: HUMAN });
    expect(result.state.turn).toBe(1);
  });

  it("is nobody when the last companies go out in the same turn", () => {
    let state = onlyActive(newGame(), [HUMAN, BLITZ]);
    state = withCompany(withCompany(state, HUMAN, { cash: 0 }), BLITZ, { cash: 0 });
    const result = resolve(state, { [HUMAN]: { allocation: IDLE }, [BLITZ]: { allocation: IDLE } });
    expect(result.state.outcome).toEqual({ kind: "wipeout", turn: 1, winnerId: null });
  });

  it("does not end the game while two companies remain", () => {
    const state = withCompany(onlyActive(newGame(), [HUMAN, BLITZ, INCUMBENT]), BLITZ, { cash: 0 });
    const result = resolve(state, { [BLITZ]: { allocation: IDLE } });
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(2);
  });
});

describe("turn 20", () => {
  const lateGame = (): GameState => {
    let state = withState(newGame(), { turn: 20 });
    state = launchedCompany(state, HUMAN, { users: 90_000, founderEquity: 1, cash: 3_000_000 });
    state = launchedCompany(state, BLITZ, { users: 200_000, founderEquity: 0.343, cash: 3_000_000, investorSeats: 0 });
    state = launchedCompany(state, BOOT, { users: 60_000, founderEquity: 1, cash: 3_000_000 });
    return launchedCompany(state, INCUMBENT, { users: 120_000, founderEquity: 0.42, cash: 3_000_000, investorSeats: 2 });
  };

  it("gives the game to the highest founder stake (equity × valuation)", () => {
    const result = resolve(lateGame());
    const stakes = [HUMAN, BLITZ, BOOT, INCUMBENT].map((id) => founderStake(reportFor(result, id).equity, reportFor(result, id).valuation));
    const best = stakes.indexOf(Math.max(...stakes));
    expect(result.state.outcome).toEqual({ kind: "turnLimit", turn: 20, winnerId: best });
    expect(result.state.turn).toBe(20);
    // 100% of a small company beats a third of a large one here.
    expect(best).toBe(HUMAN);
    expect(reportFor(result, BLITZ).valuation).toBeGreaterThan(reportFor(result, HUMAN).valuation);
  });

  it("does not apply before turn 20", () => {
    const result = resolve(withState(lateGame(), { turn: 19 }));
    expect(result.state.outcome).toBeNull();
    expect(result.state.turn).toBe(20);
  });

  it("only ranks companies still in the game", () => {
    const state = withCompany(lateGame(), HUMAN, { cash: -5_000_000 });
    const result = resolve(state);
    expect(result.state.companies[HUMAN].out?.reason).toBe("bankrupt");
    expect(result.state.outcome?.kind).toBe("turnLimit");
    expect(result.state.outcome?.winnerId).not.toBe(HUMAN);
  });
});
