import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { defaultPlan } from "./plan";
import { createGame } from "./setup";
import { BLITZ, BOOT, FOUR_SEATS, HUMAN, INCUMBENT, newGame } from "./testKit";
import { publicCompany, viewFor } from "./view";

describe("createGame", () => {
  it("gives the three startups the design's starting state", () => {
    const state = newGame();
    for (const id of [HUMAN, BLITZ, BOOT]) {
      const c = state.companies[id];
      expect(c).toMatchObject({
        id,
        archetype: "startup",
        cash: 500_000,
        headcount: 3,
        users: 0,
        quality: 0,
        hype: 10,
        founderEquity: 1,
        founderSeats: 2,
        investorSeats: 0,
        launched: false,
        out: null,
      });
    }
  });

  it("gives the Incumbent its head start, already launched", () => {
    expect(newGame().companies[INCUMBENT]).toMatchObject({
      archetype: "incumbent",
      cash: 3_000_000,
      headcount: 8,
      users: 10_000,
      quality: 30,
      hype: 20,
      founderEquity: 0.6,
      founderSeats: 2,
      investorSeats: 1,
      launched: true,
    });
  });

  it("keeps names, pitches and controllers from the setup", () => {
    const state = newGame();
    expect(state.companies.map((c) => c.name)).toEqual(["Acme", "Zipp", "Oakline", "Nimbus"]);
    expect(state.companies.map((c) => c.controller)).toEqual(["human", "blitzscaler", "bootstrapper", "incumbent"]);
    expect(state.companies[BLITZ].pitch).toBe("Growth at all costs.");
  });

  it("starts on turn 1 with no event, a normal climate and nothing carried over", () => {
    const state = newGame();
    expect(state.turn).toBe(1);
    expect(state.event).toBeNull();
    expect(state.climate).toEqual({ multiplier: 1, turnsLeft: 0 });
    expect(state.modifiers).toEqual({ newUsers: 1, marketing: 1, extraCandidates: 0 });
    expect(state.carryOverUsers).toBe(0);
    expect(state.freedPeople).toBe(0);
    expect(state.outcome).toBeNull();
  });

  it("starts every company on Standard with no history", () => {
    for (const c of newGame().companies) {
      expect(c.price).toBe("standard");
      expect(c.lastRaise).toBeNull();
      expect(c.lastQuarter).toBeNull();
      expect(c.lastRevenue).toBeNull();
      expect(c.lastCosts).toBeNull();
      expect(c.usersAtLastClose).toBe(c.users);
      expect(c.headcountAtLastClose).toBe(c.headcount);
    }
  });

  it("makes the archetype's team split the first default plan", () => {
    const state = newGame();
    expect(defaultPlan(state.companies[HUMAN])).toEqual({
      allocation: { product: 3, growth: 0, recruiting: 0 },
      marketing: 0,
      price: "standard",
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
      hireLimit: null,
    });
    expect(defaultPlan(state.companies[INCUMBENT]).allocation).toEqual({ product: 5, growth: 2, recruiting: 1 });
  });

  it("is pure: the same setup gives an equal state that survives a JSON round trip", () => {
    const a = createGame(FOUR_SEATS, DESIGN);
    const b = createGame(FOUR_SEATS, DESIGN);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("refuses a game with fewer than two companies", () => {
    expect(() => createGame({ seats: FOUR_SEATS.seats.slice(0, 1) }, DESIGN)).toThrow();
  });
});

describe("views", () => {
  it("shows a rival only what is public", () => {
    const state = newGame();
    const shown = publicCompany(state.companies[INCUMBENT]);
    expect(Object.keys(shown).sort()).toEqual(
      [
        "founderEquity",
        "founderSeats",
        "headcount",
        "hype",
        "id",
        "investorSeats",
        "lastQuarter",
        "lastRaise",
        "launched",
        "name",
        "out",
        "pitch",
        "price",
        "quality",
        "users",
      ].sort(),
    );
    expect("cash" in shown).toBe(false);
    expect("lastPlan" in shown).toBe(false);
    expect("controller" in shown).toBe(false);
  });

  it("gives a company itself in full and every rival in public", () => {
    const state = newGame();
    const view = viewFor(state, HUMAN);
    expect(view.self).toBe(state.companies[HUMAN]);
    expect(view.rivals.map((r) => r.id)).toEqual([BLITZ, BOOT, INCUMBENT]);
    for (const rival of view.rivals) expect("cash" in rival).toBe(false);
    expect(view.turn).toBe(1);
    expect(view.climate).toEqual(state.climate);
    expect(view.modifiers).toEqual(state.modifiers);
  });
});
