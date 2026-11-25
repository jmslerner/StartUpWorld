import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { rulesForTurn } from "./career";
import { CAREER_TEST, atTurn, newCareer, outSince, withCareer, withCareerOf, withEras } from "./careerKit";
import { ENTRANT_PITCHES } from "./cast";
import { BLITZ, BOOT, HUMAN, INCUMBENT, launchedCompany, resolve, usersInSystem, withCompany } from "./testKit";
import type { DatedCard, GameState } from "./types";

/** Two eras, the second from 1995 (turn 6) with its own starting cash for a startup. */
const config = withEras(
  { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
  { id: "b", name: "B", firstYear: 1995, invented: false, values: { archetypes: { startup: { cash: 2 * DESIGN.archetypes.startup.cash } } } },
);

/** Turn 6 (1995), with seat 1 (the Blitzscaler) out since turn 5. */
const year6State: GameState = outSince(atTurn(newCareer(config), 6), BLITZ, 5);
const year6 = resolve(year6State, {}, 1, config);

/**
 * Turn 5, with seat 1 rescued in turn 3: 5 people on Product, $0 and 10,000 users whose revenue is far below its
 * salaries, so it ends the year below $0 and this time goes out.
 */
const year5StateWithSeat1Failing: GameState = withCareerOf(
  launchedCompany(atTurn(newCareer(config), 5), BLITZ, {
    headcount: 5,
    headcountAtLastClose: 5,
    cash: 0,
    users: 10_000,
    lastPlan: { ...newCareer(config).companies[BLITZ].lastPlan, allocation: { product: 5, growth: 0, recruiting: 0 }, marketing: 0 },
  }),
  BLITZ,
  { rescue: { turn: 3, reason: "bankrupt" } },
);

describe("rivals come and go", () => {
  it("two years after a rival goes out a new startup takes its seat", () => {
    expect(year6.log.entrants).toEqual([1]);
    const newcomer = year6.state.companies[1];
    expect(newcomer).toMatchObject({
      id: 1,
      out: null,
      archetype: "startup",
      headcount: 3,
      users: 0,
      quality: 0,
      launched: false,
      founderEquity: 1,
      founderSeats: 2,
      investorSeats: 0,
      lastRaise: null,
      lastQuarter: null,
      lastRevenue: null,
    });
    expect(newcomer.cash).toBe(rulesForTurn(config, 7).archetypes.startup.cash); // the entry year's starting cash
    expect(newcomer.cash).not.toBe(rulesForTurn(config, 1).archetypes.startup.cash);
    expect(newcomer.career).toEqual({ founded: 7, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false });
    const names = year6.state.companies.map((company) => company.name.toLowerCase());
    expect(new Set(names).size).toBe(4);
    expect(newcomer.name).not.toBe(year6State.companies[1].name);
  });

  it("and no sooner", () => {
    const result = resolve(year5StateWithSeat1Failing, {}, 1, config);
    expect(result.log.entrants).toEqual([]);
    expect(result.state.companies[1].out?.turn).toBe(5);
  });

  it("its style comes from the seed and is one of the three", () => {
    const styles = Array.from({ length: 60 }, (_, i) => resolve(year6State, {}, i + 1, config).state.companies[1].controller);
    expect(new Set(styles)).toEqual(new Set(["blitzscaler", "bootstrapper", "incumbent"]));
    expect(resolve(year6State, {}, 7, config).state.companies[1]).toEqual(resolve(year6State, {}, 7, config).state.companies[1]);
  });

  it("a newcomer that plays the Incumbent's style is still an ordinary startup", () => {
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find(
      (s) => resolve(year6State, {}, s, config).state.companies[1].controller === "incumbent",
    );
    expect(seed).toBeDefined();
    const newcomer = resolve(year6State, {}, seed ?? 0, config).state.companies[1];
    const startup = rulesForTurn(config, 7).archetypes.startup;
    expect(newcomer).toMatchObject({
      controller: "incumbent",
      archetype: "startup",
      cash: startup.cash,
      headcount: startup.headcount,
      users: startup.users,
      quality: startup.quality,
      hype: startup.hype,
      founderEquity: startup.founderEquity,
      investorSeats: startup.investorSeats,
    });
    expect(ENTRANT_PITCHES.incumbent).toContain(newcomer.pitch);
  });

  it.each(["human", "baseline"] as const)("a seat played by %s is never refilled", (controller) => {
    let state = withCompany(outSince(atTurn(newCareer(), 6), HUMAN, 5), HUMAN, { controller });
    for (let turn = 6; turn <= 15; turn++) {
      const result = resolve(state, {}, 1, CAREER_TEST);
      expect(result.log.entrants, `turn ${turn}`).not.toContain(HUMAN);
      state = result.state;
      expect(state.companies[HUMAN].out?.turn, `turn ${turn}`).toBe(5);
    }
    expect(state.turn).toBe(16);
  });

  it("there are always four seats, and the swap neither makes nor loses users", () => {
    expect(year6.state.companies.map((company) => company.id)).toEqual([0, 1, 2, 3]);
    expect(usersInSystem(year6.state)).toBe(usersInSystem(year6State) + year6.log.market.newUsers);
  });

  it("with every seat empty the market waits, and newcomers start it again (Review Focus 3)", () => {
    let year5 = atTurn(newCareer(), 6);
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) year5 = outSince(year5, id, 5);
    const year6Result = resolve(year5, {}, 1, CAREER_TEST);
    expect(year6Result.log.companies.every((report) => report === null)).toBe(true);
    expect(year6Result.log.entrants).toEqual([1, 2, 3]);
    const turn7 = year6Result.state;
    expect(turn7.companies.map((company) => company.out === null)).toEqual([false, true, true, true]);
    expect(new Set(turn7.companies.map((company) => company.name.toLowerCase())).size).toBe(4);
    expect(turn7.carryOverUsers).toBeGreaterThan(0);
  });

  it("a card for the entry year can hit the newcomer", () => {
    const spotlight: DatedCard = { year: 1996, id: "spotlight", name: "Spotlight", text: "…", target: { pick: "random" }, effects: [{ kind: "targetHype", delta: 5 }] };
    const dated = withCareer({ dated: [spotlight] });
    let state = outSince(atTurn(newCareer(dated), 6), BLITZ, 5);
    for (const id of [HUMAN, BOOT, INCUMBENT]) state = outSince(state, id, 6);
    const result = resolve(state, {}, 1, dated);
    expect(result.log.entrants).toEqual([1]);
    expect(result.state.event).toEqual({ cardId: "spotlight", targetId: 1 });
    expect(result.state.companies[1].hype).toBe(DESIGN.archetypes.startup.hype + 5);
  });

  it("a race log has no entrants", () => {
    expect(Object.keys(resolve(atTurn(newCareer(DESIGN), 2), {}, 1, DESIGN).log)).not.toContain("entrants");
  });
});
