import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, atTurn, newCareer, withCareer } from "./careerKit";
import { NEUTRAL_MODIFIERS, findCard } from "./events";
import { BOOT, BLITZ, HUMAN, INCUMBENT, launchedCompany, resolve, withCompany } from "./testKit";
import type { DatedCard, Plan } from "./types";

const SLUMP: DatedCard = {
  year: 1992,
  id: "slump",
  name: "Slump",
  text: "…",
  effects: [
    { kind: "fundingClimate", multiplier: 0.5, turns: 3 },
    { kind: "newUsers", multiplier: 0.7 },
    { kind: "candidates", extra: 4 },
  ],
};
const OUTAGE: DatedCard = {
  year: 1992,
  id: "outage",
  name: "Outage",
  text: "…",
  target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
  effects: [
    { kind: "targetUsers", fraction: 0.1 },
    { kind: "targetHype", delta: -10 },
  ],
};

const GROWTH: Partial<Plan> = { allocation: { product: 0, growth: 3, recruiting: 0 } };
const allOnGrowth = { [HUMAN]: GROWTH, [BLITZ]: GROWTH, [BOOT]: GROWTH };

describe("dated cards", () => {
  const dicey = withCareer({ dated: [SLUMP] }, { ...CAREER_TEST, events: { ...DESIGN.events, firstTurn: 2, chance: 1 } });

  it("a dated card is in force in its year, whatever the dice say", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(resolve(atTurn(newCareer(dicey), 2), {}, seed, dicey).log.nextEvent).toEqual({ cardId: "slump", targetId: null });
    }
  });

  it("years without one draw from the deck as before", () => {
    const ids = DESIGN.events.deck.map((card) => card.id);
    for (let seed = 1; seed <= 50; seed++) {
      const next = resolve(newCareer(dicey), {}, seed, dicey).log.nextEvent; // the card for 1991, drawn after 1990
      expect(ids).toContain(next?.cardId);
    }
  });

  it("a card may carry several effects; only the climate outlasts the year", () => {
    const config = withCareer({ dated: [SLUMP] });
    const y1992 = resolve(atTurn(newCareer(config), 2), {}, 1, config).state;
    expect(y1992.climate).toEqual({ multiplier: 0.5, turnsLeft: 3 });
    expect(y1992.modifiers).toEqual({ newUsers: 0.7, marketing: 1, extraCandidates: 4 });
    const y1993 = resolve(y1992, {}, 1, config).state;
    expect(y1993.climate).toEqual({ multiplier: 0.5, turnsLeft: 2 });
    expect(y1993.modifiers).toEqual(NEUTRAL_MODIFIERS);
  });

  it("the first year's card is dealt with the game", () => {
    const config = withCareer({ dated: [{ ...SLUMP, year: 1990 }] });
    const game = newCareer(config);
    expect(game.event).toEqual({ cardId: "slump", targetId: null });
    expect(game.climate).toEqual({ multiplier: 0.5, turnsLeft: 3 });
    expect(game.modifiers.newUsers).toBe(0.7);
  });

  it("fewer candidates never means a negative market (Review Focus 5)", () => {
    const config = withCareer({ dated: [{ year: 1991, id: "freeze", name: "Hiring freeze", text: "…", effects: [{ kind: "candidates", extra: -9 }] }] });
    const game = newCareer(config);
    const before = resolve(game, {}, 1, config).state; // 1991, with the card in force: 6 − 9 candidates
    expect(before.modifiers.extraCandidates).toBe(-9);
    const result = resolve(before, {}, 1, config);
    expect(result.log.hiring.candidates).toBe(0);
    expect(result.log.hiring.picks).toEqual([]);
  });

  it("a card that hits one company picks among those that qualify", () => {
    const config = withCareer({ dated: [OUTAGE] });
    // Seat 2 is launched with quality under 50 and users; the other startups never launch and the Incumbent is too good.
    const before = withCompany(launchedCompany(atTurn(newCareer(config), 2), BOOT, { quality: 30 }), INCUMBENT, { quality: 90 });
    for (let seed = 1; seed <= 20; seed++) {
      expect(resolve(before, allOnGrowth, seed, config).log.nextEvent).toEqual({ cardId: "outage", targetId: BOOT });
    }
  });

  it("when nobody qualifies the card still shows, and hits nobody (Review Focus 5)", () => {
    const config = withCareer({ dated: [OUTAGE] });
    // turn 2; the Incumbent's quality is 90, and the three startups put everyone on Growth, so none of them launches
    const before = withCompany(atTurn(newCareer(config), 2), INCUMBENT, { quality: 90 });
    const result = resolve(before, allOnGrowth, 1, config);
    expect(result.log.nextEvent).toEqual({ cardId: "outage", targetId: null });
    expect(result.state.companies.map((c) => [c.users, c.hype])).toEqual(
      result.log.companies.map((report) => [report!.users.end, report!.hype.end]),
    );
  });

  it("a dated card can be looked up like any other", () => {
    expect(findCard("slump", withCareer({ dated: [SLUMP] }))?.name).toBe("Slump");
  });
});
