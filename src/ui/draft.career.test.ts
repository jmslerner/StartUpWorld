import { describe, expect, it } from "vitest";
import { newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import { peopleAvailable, setGoPublic, setRaise } from "./draft";

describe("going public in the draft", () => {
  const game = withCompany(newCareer(), HUMAN, { headcount: 6 });
  const company = game.companies[HUMAN];
  const plan = defaultPlan(company);

  it("choosing it drops a raise and gives the raiser back", () => {
    const raising = setRaise(company, plan, 20);
    expect(peopleAvailable(company, raising)).toBe(5);
    const listing = setGoPublic(company, raising, true);
    expect(listing).toMatchObject({ goPublic: true, raisePercent: 0 });
    expect(peopleAvailable(company, listing)).toBe(6);
  });

  it("choosing a raise drops going public", () => {
    expect(setRaise(company, setGoPublic(company, plan, true), 10)).toMatchObject({ goPublic: false, raisePercent: 10 });
  });

  it("a race plan never gains the key", () => {
    const race = newGame().companies[HUMAN];
    expect("goPublic" in setRaise(race, defaultPlan(race), 20)).toBe(false);
  });
});
