import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { NEUTRAL_MODIFIERS } from "./events";
import { pullOf, valuationOf } from "./formulas";
import { HUMAN, launchedCompany, newGame, onlyActive, reportFor, resolve, withState } from "./testKit";
import type { RulesConfig } from "./types";

/** A config whose deck holds only the named cards and always draws one. */
const always = (...ids: string[]): RulesConfig => ({
  ...DESIGN,
  events: { ...DESIGN.events, chance: 1, deck: DESIGN.events.deck.filter((card) => ids.includes(card.id)) },
});
const NEVER: RulesConfig = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const turn2 = () => withState(newGame(), { turn: 2 });

describe("events in the flow of turns", () => {
  it("reveals nothing for turns 1 and 2", () => {
    const everything = { ...DESIGN, events: { ...DESIGN.events, chance: 1 } };
    const first = resolve(newGame(), {}, 1, everything);
    expect(first.state.turn).toBe(2);
    expect(first.state.event).toBeNull();
    expect(first.log.nextEvent).toBeNull();
    expect(first.log.event).toBeNull();
  });

  it("reveals turn 3's event in the state that turn 2 returns", () => {
    const result = resolve(turn2(), {}, 1, always("market-boom"));
    expect(result.state.turn).toBe(3);
    expect(result.state.event).toEqual({ cardId: "market-boom", targetId: null });
    expect(result.log.nextEvent).toEqual(result.state.event);
    expect(result.state.modifiers).toEqual({ ...NEUTRAL_MODIFIERS, newUsers: 1.5 });
  });

  it("market boom: new users ×1.5 in its turn only", () => {
    const revealed = resolve(turn2(), {}, 1, always("market-boom"));
    const boom = resolve(revealed.state, {}, 1, NEVER);
    expect(boom.log.event).toEqual({ cardId: "market-boom", targetId: null });
    expect(boom.log.market.newUsers).toBe(36_300);
    expect(boom.state.modifiers).toEqual(NEUTRAL_MODIFIERS);
    expect(boom.state.event).toBeNull();
    const after = resolve(boom.state, {}, 1, NEVER);
    expect(after.log.event).toBeNull();
    expect(after.log.market.newUsers).toBe(26_620);
  });

  it("talent glut: 4 extra candidates in its turn only", () => {
    const revealed = resolve(turn2(), {}, 1, always("talent-glut"));
    const glut = resolve(revealed.state, {}, 1, NEVER);
    expect(glut.log.hiring.candidates).toBe(10);
    expect(resolve(glut.state, {}, 1, NEVER).log.hiring.candidates).toBe(6);
  });

  it("ad prices spike: the marketing term of pull is halved in its turn only", () => {
    const revealed = resolve(turn2(), {}, 1, always("ad-prices-spike"));
    const spend = { [HUMAN]: { marketing: 100_000 } };
    const expected = (report: ReturnType<typeof reportFor>, marketingModifier: number) =>
      pullOf({ quality: report.quality.end, growthWork: report.work.growth, marketing: 100_000, tier: "standard", hype: report.hype.start, marketingModifier }, DESIGN);
    const spike = resolve(revealed.state, spend, 1, NEVER);
    expect(reportFor(spike, HUMAN).users.pull).toBeCloseTo(expected(reportFor(spike, HUMAN), 0.5), 9);
    const after = resolve(spike.state, spend, 1, NEVER);
    expect(reportFor(after, HUMAN).users.pull).toBeCloseTo(expected(reportFor(after, HUMAN), 1), 9);
    expect(reportFor(spike, HUMAN).costs.marketing).toBe(100_000);
  });

  it("viral moment: +20 hype before the turn starts, so it counts for that turn", () => {
    const revealed = resolve(turn2(), {}, 1, always("viral-moment"));
    const target = revealed.state.event!.targetId!;
    const before = reportFor(revealed, target).hype.end;
    expect(revealed.state.companies[target].hype).toBeCloseTo(Math.min(100, before + 20), 4);
    const next = resolve(revealed.state, {}, 1, NEVER);
    expect(reportFor(next, target).hype.start).toBe(revealed.state.companies[target].hype);
  });

  it("burnout: the target starts the turn one person down", () => {
    const revealed = resolve(turn2(), {}, 1, always("burnout"));
    const target = revealed.state.event!.targetId!;
    const closed = reportFor(revealed, target).headcount.end;
    expect(revealed.state.companies[target].headcount).toBe(closed - 1);
    expect(revealed.state.companies[target].headcountAtLastClose).toBe(closed);
    const next = resolve(revealed.state, {}, 1, NEVER);
    expect(reportFor(next, target).headcount).toMatchObject({ start: closed - 1, lostToEvent: 1 });
    expect(reportFor(next, target).costs.salaries).toBe((closed - 1) * 40_000);
    expect(next.state.companies[target].lastQuarter?.left).toBe(1);
  });

  it("security breach: 10% of the target's users go into the next pool", () => {
    const revealed = resolve(turn2(), {}, 1, always("security-breach"));
    const target = revealed.state.event!.targetId!;
    const closed = reportFor(revealed, target).users.end;
    const lost = Math.round(closed * 0.1);
    expect(lost).toBeGreaterThan(0);
    expect(revealed.state.companies[target].users).toBe(closed - lost);
    expect(revealed.state.companies[target].usersAtLastClose).toBe(closed);
    expect(revealed.state.carryOverUsers).toBe(lost);
    const next = resolve(revealed.state, {}, 1, NEVER);
    expect(next.log.market.carriedIn).toBe(lost);
    expect(reportFor(next, target).users).toMatchObject({ open: closed, lostToEvent: lost });
    expect(next.state.companies[target].lastQuarter).toMatchObject({ usersAtOpen: closed, usersLostToEvent: lost });
  });

  it("judges 'users fell' and the growth bonus against last quarter's close, so a breach counts", () => {
    // Closed last quarter on 10,000 users, lost half to a breach, wins 1,300 back alone in a market with no new users.
    const noNewUsers = { ...NEVER, market: { ...DESIGN.market, newUsersTurn1: 0 } };
    const breached = withState(
      onlyActive(launchedCompany(newGame(), HUMAN, { users: 5_000, usersAtLastClose: 10_000, investorSeats: 3, cash: 5_000_000 }), [HUMAN]),
      { carryOverUsers: 1_300 },
    );
    const report = reportFor(resolve(breached, {}, 1, noNewUsers), HUMAN);
    expect(report.users).toMatchObject({ open: 10_000, lostToEvent: 5_000, end: 6_300 });
    expect(report.board?.usersFell).toBe(true);
    expect(report.hype.growth).toBe(0);
  });
});

describe("funding climate", () => {
  it("lasts the stated number of turns, counting the one it is revealed for", () => {
    const revealed = resolve(turn2(), {}, 1, always("funding-winter"));
    expect(revealed.log.climateMultiplier).toBe(1);
    expect(revealed.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });
    const t3 = resolve(revealed.state, {}, 1, NEVER);
    expect(t3.log.climateMultiplier).toBe(0.6);
    expect(t3.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 2 });
    const t4 = resolve(t3.state, {}, 1, NEVER);
    expect(t4.log.climateMultiplier).toBe(0.6);
    expect(t4.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 1 });
    const t5 = resolve(t4.state, {}, 1, NEVER);
    expect(t5.log.climateMultiplier).toBe(0.6);
    expect(t5.state.climate).toEqual({ multiplier: 1, turnsLeft: 0 });
    const t6 = resolve(t5.state, {}, 1, NEVER);
    expect(t6.log.climateMultiplier).toBe(1);
  });

  it("is replaced by a new climate card", () => {
    const winter = withState(turn2(), { climate: { multiplier: 0.6, turnsLeft: 3 } });
    const result = resolve(winter, {}, 1, always("hot-market"));
    expect(result.state.climate).toEqual({ multiplier: 1.4, turnsLeft: 2 });
  });

  it("multiplies every valuation in its turns", () => {
    const winter = withState(launchedCompany(newGame(), HUMAN), { climate: { multiplier: 0.6, turnsLeft: 1 } });
    const result = resolve(winter, {}, 1, NEVER);
    const report = reportFor(result, HUMAN);
    expect(result.log.climateMultiplier).toBe(0.6);
    expect(report.valuation).toBe(valuationOf(report.users.end, report.hype.end, 0.6, DESIGN));
    expect(result.state.climate).toEqual({ multiplier: 1, turnsLeft: 0 });
  });
});
