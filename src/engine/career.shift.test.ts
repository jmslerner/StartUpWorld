import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import type { GameConfig } from "../config";
import { heldCeiling, upcomingShift } from "./career";
import { CAREER_TEST, atTurn, careerOf, newCareer, withCareer } from "./careerKit";
import { applyEvent } from "./events";
import { newUsersForTurn } from "./formulas";
import { projectTurn } from "./project";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, newGame, onlyActive, reportFor, resolve, withCompany, withState } from "./testKit";
import type { DatedCard, GameState, Plan } from "./types";
import { viewFor } from "./view";

const WAVE = { kind: "userWave", multiplier: 1.5, turns: 3 } as const;
const SHIFT: DatedCard = {
  year: 1995,
  id: "shift",
  name: "Shift",
  text: "…",
  effects: [{ kind: "qualityCeiling", ceiling: 30, turns: 1 }, WAVE],
};
const config = withCareer({ dated: [SHIFT] });
/** The same shift, with its ceiling cut once as the year opens. */
const cutOnceConfig = withCareer({ dated: [{ ...SHIFT, effects: [{ kind: "qualityCeiling", ceiling: 30, turns: 0 }, WAVE] }] });

const RICH = 10_000_000;
const TEN_ON_PRODUCT: Partial<Plan> = { allocation: { product: 10, growth: 0, recruiting: 0 } };
const TEN_ON_GROWTH: Partial<Plan> = { allocation: { product: 0, growth: 10, recruiting: 0 } };
const THREE_ON_GROWTH: Partial<Plan> = { allocation: { product: 0, growth: 3, recruiting: 0 } };

/**
 * 1994 to 1996 around the shift. Seats 0 and 2 have ten people each and money enough. In 1994 seat 0 works on
 * Product from 90 and seat 2 puts everyone on Growth, so it closes at 20; seat 1 has not launched, sits at 8 and
 * builds nothing. In 1995 both seat 0 and seat 2 have all ten on Product; 1996 is played on the same plans.
 */
const aroundTheShift = (played: GameConfig) => {
  let before = atTurn(newCareer(played), 5);
  before = launchedCompany(before, HUMAN, { quality: 90, headcount: 10, headcountAtLastClose: 10, cash: RICH });
  before = withCompany(before, BLITZ, { quality: 8, cash: RICH });
  before = launchedCompany(before, BOOT, { quality: 22, headcount: 10, headcountAtLastClose: 10, cash: RICH });
  const played1994 = resolve(before, { [HUMAN]: TEN_ON_PRODUCT, [BLITZ]: THREE_ON_GROWTH, [BOOT]: TEN_ON_GROWTH }, 1, played);
  const y1995 = played1994.state;
  const played1995 = resolve(y1995, { [BOOT]: TEN_ON_PRODUCT }, 1, played);
  const played1996 = resolve(played1995.state, {}, 1, played);
  return { played1994, y1995, played1995, played1996 };
};

/** 1994 played on the default plans of a new career, then 1995 to 1998 one after another. */
const yearByYear = (played: GameConfig) => {
  const results = [resolve(atTurn(newCareer(played), 5), {}, 1, played)];
  for (let year = 1995; year <= 1998; year++) results.push(resolve(results[results.length - 1].state, {}, 1, played));
  const [played1994, played1995, played1996, played1997, played1998] = results;
  return { y1995: played1994.state, played1995, played1996, played1997, played1998 };
};

describe("a platform shift", () => {
  it("cuts every product down to the ceiling and leaves lower ones alone", () => {
    let state = withCompany(newCareer(config), HUMAN, { quality: 90, launched: true });
    state = withCompany(state, BLITZ, { quality: 35, launched: true, out: { turn: 4, reason: "bankrupt", users: 0, headcount: 0 } });
    state = withCompany(state, BOOT, { quality: 20, launched: true });
    state = withCompany(state, INCUMBENT, { quality: 8, launched: false });
    const after = applyEvent(state, { cardId: "shift", targetId: null }, config);
    expect(after.companies.map((c) => c.quality)).toEqual([30, 35, 20, 8]);
    expect(after.companies.map((c) => c.launched)).toEqual([true, true, true, false]); // launch is permanent
  });

  it("holds through its year: Product work lifts a product up to the ceiling, and not past it", () => {
    const { played1995, played1996 } = aroundTheShift(config);
    expect(reportFor(played1995, HUMAN).quality).toMatchObject({ start: 30, end: 30 });
    expect(reportFor(played1995, BOOT).quality).toMatchObject({ start: 20, end: 30 });
    expect(reportFor(played1996, HUMAN).quality.end).toBeGreaterThan(30); // free again the year after
  });

  it("the projection holds the ceiling as the turn does", () => {
    const { y1995 } = aroundTheShift(config);
    expect(projectTurn(viewFor(y1995, HUMAN), null, config).quality).toBe(30);
  });

  it("with `turns` 0 the cut is made once, as the year opens, and that year's Product work builds on it", () => {
    const cutOnce = aroundTheShift(cutOnceConfig);
    expect(reportFor(cutOnce.played1995, HUMAN).quality.start).toBe(30);
    expect(reportFor(cutOnce.played1995, HUMAN).quality.end).toBeGreaterThan(30);
    expect(projectTurn(viewFor(cutOnce.y1995, HUMAN), null, cutOnceConfig).quality).toBe(reportFor(cutOnce.played1995, HUMAN).quality.end);
    expect(heldCeiling(cutOnce.y1995.event, cutOnceConfig)).toBeNull();
    expect(heldCeiling(aroundTheShift(config).y1995.event, config)).toBe(30);
    expect(heldCeiling(null, config)).toBeNull();
  });

  it("a leader and a newcomer restart level, and win the same share that year", () => {
    // Seats 0 and 1 are launched with no users, the same team, hype and plan, and differ only in quality.
    let before = onlyActive(atTurn(newCareer(config), 5), [HUMAN, BLITZ]);
    before = launchedCompany(before, HUMAN, { quality: 90, users: 0, cash: RICH });
    before = launchedCompany(before, BLITZ, { quality: 35, users: 0, cash: RICH });
    // 1994 brings no new users, so both open 1995 with none; 1995 opens with 10,000 waiting in the pool.
    before = withState(before, { modifiers: { ...before.modifiers, newUsers: 0 } });
    const y1995 = withState(resolve(before, {}, 1, config).state, { carryOverUsers: 10_000 });
    expect(y1995.companies.slice(0, 2).map((c) => c.quality)).toEqual([30, 30]);
    const played1995 = resolve(y1995, {}, 1, config);
    expect(reportFor(played1995, HUMAN).users.won).toBeGreaterThan(0);
    expect(Math.abs(reportFor(played1995, HUMAN).users.won - reportFor(played1995, BLITZ).users.won)).toBeLessThanOrEqual(1);
  });

  it("brings more new users for the years the card says, and then no more", () => {
    const { y1995, played1995, played1996, played1997, played1998 } = yearByYear(config);
    expect(y1995.wave).toEqual({ multiplier: 1.5, turnsLeft: 3 });
    expect([played1995, played1996, played1997, played1998].map((result) => result.log.market.newUsers)).toEqual(
      [1.5, 1.5, 1.5, 1].map((times, i) => newUsersForTurn(6 + i, times, CAREER_TEST)),
    );
    expect(played1997.state.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
  });

  it("a shift dated in the first year sets its wave with the game", () => {
    expect(newCareer(withCareer({ dated: [{ ...SHIFT, year: 1990 }] })).wave).toEqual({ multiplier: 1.5, turnsLeft: 3 });
  });

  it("a new wave replaces one still running", () => {
    const again: DatedCard = { year: 1996, id: "again", name: "Again", text: "…", effects: [{ kind: "userWave", multiplier: 2, turns: 2 }] };
    const { played1995 } = yearByYear(withCareer({ dated: [SHIFT, again] }));
    expect(played1995.state.wave).toEqual({ multiplier: 2, turnsLeft: 2 });
  });

  it("a card's one-year change in new users multiplies with a running wave", () => {
    const slow: DatedCard = { year: 1996, id: "slow", name: "Slow", text: "…", effects: [{ kind: "newUsers", multiplier: 0.8 }] };
    const { played1996 } = yearByYear(withCareer({ dated: [SHIFT, slow] }));
    expect(played1996.log.market.newUsers).toBe(newUsersForTurn(7, 0.8 * 1.5, CAREER_TEST));
  });

  it("the projection counts the wave", () => {
    const { y1995 } = yearByYear(config);
    const atRest = { ...y1995, wave: { multiplier: 1, turnsLeft: 0 } };
    expect(projectTurn(viewFor(y1995, HUMAN), null, config).pool - projectTurn(viewFor(atRest, HUMAN), null, config).pool).toBe(
      newUsersForTurn(6, 1.5, CAREER_TEST) - newUsersForTurn(6, 1, CAREER_TEST),
    );
  });

  it("in the shift year a plan's projection still knows its rivals (Review Focus 2)", () => {
    // Four launched companies with users and money enough play 1991 to 1994 on their default plans; 1995 is the shift.
    let state: GameState = atTurn(newCareer(config), 2);
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) state = launchedCompany(state, id, { cash: RICH });
    for (let year = 1991; year <= 1994; year++) state = resolve(state, {}, 1, config).state;
    const y1995 = state;
    const played1995 = resolve(y1995, {}, 1, config);
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) {
      const projected = projectTurn(viewFor(y1995, id), null, config).share;
      expect(Math.abs(projected - reportFor(played1995, id).users.share)).toBeLessThan(0.05);
    }
  });

  it("the annual report says what the shift took", () => {
    const { played1994, y1995, played1995 } = aroundTheShift(config);
    // Closing the books keeps the quality each company closed the year with, before the next year's card.
    expect(careerOf(y1995, HUMAN).qualityAtLastClose).toBe(reportFor(played1994, HUMAN).quality.end);
    expect(careerOf(y1995, HUMAN).qualityAtLastClose).toBeGreaterThan(90);
    expect(reportFor(played1995, HUMAN).career?.qualityLostToEvent).toBe(careerOf(y1995, HUMAN).qualityAtLastClose - 30);
    expect(reportFor(played1995, BOOT).career?.qualityLostToEvent).toBe(0);
    expect(reportFor(played1995, BOOT).career).toEqual({
      listing: null,
      rescue: null,
      office: null,
      hype: { listing: 0, rescue: 0 },
      qualityLostToEvent: 0,
    });
    expect("career" in reportFor(resolve(newGame(), {}, 1, DESIGN), HUMAN)).toBe(false);
  });

  it("is announced two years ahead, and not in its own year", () => {
    expect([3, 4, 5, 6].map((turn) => upcomingShift(turn, config))).toEqual([
      null,
      { cardId: "shift", year: 1995, yearsAway: 2, ceiling: 30 },
      { cardId: "shift", year: 1995, yearsAway: 1, ceiling: 30 },
      null,
    ]);
    expect(upcomingShift(4, DESIGN)).toBeNull();
  });

  it("a product that has not launched is not launched by a shift, nor set back (Review Focus 5)", () => {
    const { played1994, y1995 } = aroundTheShift(config);
    expect(reportFor(played1994, BLITZ).quality).toMatchObject({ start: 8, end: 6, launchedNow: false });
    expect(y1995.companies[BLITZ]).toMatchObject({ quality: 6, launched: false });
  });
});
