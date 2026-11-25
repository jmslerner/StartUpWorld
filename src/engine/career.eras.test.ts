import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { eraIndexOf, marketTurn, rulesForTurn, turnOf, yearOf } from "./career";
import { CAREER_RULES, atTurn, newCareer, withEras } from "./careerKit";
import { findCard } from "./events";
import { newUsersForTurn } from "./formulas";
import { projectTurn } from "./project";
import { reportFor, resolve } from "./testKit";
import { viewFor } from "./view";

const TWO_ERAS = withEras(
  { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
  {
    id: "b",
    name: "B",
    firstYear: 1993,
    invented: false,
    values: {
      salary: 2 * DESIGN.salary,
      quality: { gainPerWork: 9 },
      raise: { options: [10] },
      market: { newUsersTurn1: 50_000, growthPerTurn: 0.5 },
      pull: { maxMarketing: 50_000 },
    },
  },
);
const play = (turn: number, patches = {}) => resolve(atTurn(newCareer(TWO_ERAS), turn), patches, 1, TWO_ERAS);

/** TWO_ERAS, with era "b" also drawing a card every year from a deck of one untargeted card. */
const configWithDeck = withEras(
  { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
  {
    id: "b",
    name: "B",
    firstYear: 1993,
    invented: false,
    values: {
      events: {
        firstTurn: 2,
        chance: 1,
        deck: [{ id: "only", name: "Only", text: "The one card.", weight: 1, effects: [{ kind: "newUsers", multiplier: 1 }] }],
      },
    },
  },
);
const playWithDeck = (turn: number) => resolve(atTurn(newCareer(configWithDeck), turn), {}, 1, configWithDeck);

describe("years", () => {
  it("turn 1 is 1990 and turn 49 is 2038", () => {
    expect([yearOf(1, CAREER_RULES), yearOf(49, CAREER_RULES), turnOf(2007, CAREER_RULES)]).toEqual([1990, 2038, 18]);
  });
  it("an era lasts until the next one starts", () => {
    expect([1, 3, 4, 49].map((turn) => eraIndexOf(turn, TWO_ERAS.career!))).toEqual([0, 0, 1, 1]);
  });
});

describe("the numbers of a year", () => {
  it("the race's config comes back as it is", () => {
    expect(rulesForTurn(DESIGN, 7)).toBe(DESIGN);
  });
  it("lays the era's values over the config", () => {
    const b = rulesForTurn(TWO_ERAS, 4);
    expect(b.salary).toBe(2 * DESIGN.salary);
    expect(b.quality).toEqual({ ...DESIGN.quality, gainPerWork: 9 }); // neighbours kept
    expect(b.raise.options).toEqual([10]); // lists replaced whole
    expect(b.hype).toEqual(DESIGN.hype);
    expect(rulesForTurn(TWO_ERAS, 3).salary).toBe(DESIGN.salary);
  });
  it("gives the same object for the same era, however it is asked", () => {
    const b = rulesForTurn(TWO_ERAS, 4);
    expect(rulesForTurn(TWO_ERAS, 30)).toBe(b);
    expect(rulesForTurn(b, 4)).toBe(b);
    expect(rulesForTurn(b, 2)).toBe(rulesForTurn(TWO_ERAS, 2));
  });
  it("does not change the config it was given", () => {
    const before = JSON.stringify(TWO_ERAS);
    rulesForTurn(TWO_ERAS, 4);
    expect(JSON.stringify(TWO_ERAS)).toBe(before);
  });
  it("counts the market from the era's first year", () => {
    expect([1, 3, 4, 6].map((turn) => marketTurn(TWO_ERAS, turn))).toEqual([1, 3, 1, 3]);
    expect(marketTurn(DESIGN, 6)).toBe(6);
  });
});

describe("a year is played on its era's numbers (Review Focus 2)", () => {
  it("pays the era's salary", () => {
    expect(reportFor(play(3), 0).costs.salaries).toBe(3 * DESIGN.salary);
    expect(reportFor(play(4), 0).costs.salaries).toBe(3 * 2 * DESIGN.salary);
  });
  it("brings the era's new users", () => {
    expect(play(3).log.market.newUsers).toBe(newUsersForTurn(3, 1, DESIGN));
    expect([play(4), play(6)].map((result) => result.log.market.newUsers)).toEqual([50_000, 112_500]); // 1993; 1995 after two years of 50% growth
  });
  it("checks a plan against the era's limits", () => {
    expect(reportFor(play(4, { 0: { marketing: 100_000 } }), 0).plan.marketing).toBe(50_000);
    expect(reportFor(play(3, { 0: { marketing: 100_000 } }), 0).plan.marketing).toBe(100_000);
  });
  it("the projection uses the numbers the turn uses", () => {
    const state = atTurn(newCareer(TWO_ERAS), 4);
    expect(projectTurn(viewFor(state, 0), null, TWO_ERAS).costs.salaries).toBe(reportFor(play(4), 0).costs.salaries);
    const poolAt = (turn: number) => projectTurn(viewFor(atTurn(newCareer(TWO_ERAS), turn), 0), null, TWO_ERAS).pool;
    expect(poolAt(6) - poolAt(4)).toBe(62_500); // the same state two years apart: only the era's new users differ
  });
  it("draws next year's card on next year's numbers", () => {
    expect(playWithDeck(3).log.nextEvent).toEqual({ cardId: "only", targetId: null }); // 1993's card, drawn after 1992
    expect(playWithDeck(1).log.nextEvent).toBeNull(); // 1991 is still era "a": chance 0
    expect(findCard("only", configWithDeck)?.id).toBe("only");
  });
});
