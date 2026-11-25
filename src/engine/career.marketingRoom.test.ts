import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer, qualify } from "./careerKit";
import { listingOf, rulesForTurn } from "./career";
import { marketingRoom, normalizePlan } from "./plan";
import { HUMAN, newGame, planOf, withCompany } from "./testKit";

describe("marketing room", () => {
  const rules = rulesForTurn(CAREER_TEST, 1);
  const step = rules.pull.marketingStep;

  it("is the cash in hand, never below $0, rounded down to a step", () => {
    const game = withCompany(newCareer(), HUMAN, { cash: 31_000 });
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN), 1, rules)).toBe(Math.floor(31_000 / step) * step);
    const broke = withCompany(newCareer(), HUMAN, { cash: -5_000 });
    expect(marketingRoom(broke.companies[HUMAN], planOf(broke, HUMAN), 1, rules)).toBe(0);
  });

  it("counts what going public brings", () => {
    const game = withCompany(qualify(newCareer(), HUMAN), HUMAN, { cash: 0 });
    const amount = listingOf(game.companies[HUMAN], 1, rules).amount;
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN, { goPublic: true }), 1, rules)).toBe(Math.floor(amount / step) * step);
  });

  it("is the limit the plan check applies", () => {
    const game = withCompany(newCareer(), HUMAN, { cash: 31_000 });
    const checked = normalizePlan(game, HUMAN, planOf(game, HUMAN, { marketing: 10 * step }), CAREER_TEST).plan;
    expect(checked.marketing).toBe(marketingRoom(game.companies[HUMAN], checked, 1, rules));
  });

  it("is null in a race", () => {
    const game = newGame();
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN), 1, DESIGN)).toBeNull();
  });
});
