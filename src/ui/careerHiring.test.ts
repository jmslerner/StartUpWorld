import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { createGame } from "../engine/setup";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import type { Allocation, GameState, Plan, RulesConfig } from "../engine/types";
import { careerHiringView } from "./careerHiring";
import { planningView } from "./viewModel";

const real = (): GameState => createGame(newGameSetup(1, "Acme"), CAREER);
const words = (game: GameState, allocation: Allocation, patch: Partial<Plan> = {}, config: RulesConfig = CAREER) => {
  const draft = { ...defaultPlan(game.companies[HUMAN]), allocation, ...patch };
  return careerHiringView(game, draft, planningView(game, draft, config), config);
};
const one = { product: 2, growth: 0, recruiting: 1 };

describe("the career's hiring words", () => {
  it("says how to hire when nobody is recruiting", () => {
    expect(words(real(), { product: 3, growth: 0, recruiting: 0 })?.teamLine).toBe("Nobody is recruiting. Put one person on Recruiting to hire: 2 candidates this year.");
  });

  it("explains an expectation of none: the order, the rivals ahead, the most it can be, and when hires join", () => {
    expect(words(real(), one)).toEqual({
      teamLine: null,
      hireText:
        "$20K fee each now, then $50K a year in salary. Hires join next year. " +
        "Up to 2 of 2 candidates could join, handed out most hype first; 3 rivals pick before you, so none is certain.",
    });
  });

  it("says at least what it can, when the player picks first", () => {
    expect(words(withCompany(real(), HUMAN, { hype: 30 }), one)?.hireText).toMatch(/ At least 1 joins, up to 2 of 2 candidates, handed out most hype first; you pick first\.$/);
  });

  it("gives a plain number when every hire wanted is expected", () => {
    expect(words(newCareer(), one, {}, CAREER_TEST)?.hireText).toBe("$10K fee each now, then $40K a year in salary. Hires join next year. 6 candidates this year: expect 2.");
  });

  it("names a hire limit of 0, a full campus, and a plan that already ends below $0", () => {
    expect(words(real(), one, { hireLimit: 0 })?.hireText).toMatch(/Hire at most is 0: nobody joins\.$/);
    const full = withCompany(real(), HUMAN, { headcount: 150, headcountAtLastClose: 150 });
    expect(words(full, { product: 140, growth: 5, recruiting: 5 })?.teamLine).toBe("Your campus is full: nobody more can join.");
    expect(words(withCompany(real(), HUMAN, { cash: 1_000 }), one)?.hireText).toMatch(/ This plan already ends the year below \$0\.$/);
  });

  it("speaks in years, and says nothing in a race", () => {
    const all = JSON.stringify([words(real(), one), words(real(), { product: 3, growth: 0, recruiting: 0 })]);
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    const race = newGame();
    const draft = defaultPlan(race.companies[HUMAN]);
    expect(careerHiringView(race, draft, planningView(race, draft, DESIGN), DESIGN)).toBeNull();
  });
});
