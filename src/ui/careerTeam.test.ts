import { describe, expect, it } from "vitest";
import { newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, withCompany } from "../engine/testKit";
import type { Allocation, Plan } from "../engine/types";
import { setRaise, stepDepartment } from "./draft";
import { careerCanIncrease, careerStepDepartment, dropMove, moveNote, NO_MOVES, noteMove } from "./careerTeam";

const three = newCareer().companies[HUMAN];
const six = withCompany(newCareer(), HUMAN, { headcount: 6 }).companies[HUMAN];
const plan = (allocation: Allocation, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(three), allocation, ...patch });

describe("the career's + on a team", () => {
  it("with nobody free takes one person from the largest other team", () => {
    expect(careerStepDepartment(three, plan({ product: 3, growth: 0, recruiting: 0 }), "recruiting", 1)).toEqual({
      plan: plan({ product: 2, growth: 0, recruiting: 1 }),
      from: "product",
    });
    expect(careerStepDepartment(six, plan({ product: 1, growth: 3, recruiting: 2 }), "product", 1).from).toBe("growth");
  });

  it("breaks ties Product first, then Growth", () => {
    const four = withCompany(newCareer(), HUMAN, { headcount: 4 }).companies[HUMAN];
    expect(careerStepDepartment(four, plan({ product: 2, growth: 2, recruiting: 0 }), "recruiting", 1).from).toBe("product");
    expect(careerStepDepartment(four, plan({ product: 0, growth: 2, recruiting: 2 }), "product", 1).from).toBe("growth");
  });

  it("does what the race does when someone is free, and for −", () => {
    const free = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(careerStepDepartment(six, free, "growth", 1)).toEqual({ plan: stepDepartment(six, free, "growth", 1), from: null });
    const full = plan({ product: 2, growth: 0, recruiting: 1 });
    expect(careerStepDepartment(three, full, "recruiting", -1)).toEqual({ plan: stepDepartment(three, full, "recruiting", -1), from: null });
  });

  it("works in the owner's case: a raise takes one person, and + Recruiting still works", () => {
    const raising = setRaise(three, plan({ product: 3, growth: 0, recruiting: 0 }), 10);
    expect(raising.allocation).toEqual({ product: 2, growth: 0, recruiting: 0 });
    expect(careerCanIncrease(three, raising, "recruiting")).toBe(true);
    expect(careerStepDepartment(three, raising, "recruiting", 1)).toEqual({
      plan: { ...raising, allocation: { product: 1, growth: 0, recruiting: 1 } },
      from: "product",
    });
  });

  it("does nothing when everyone is already on that team", () => {
    const all = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(careerCanIncrease(three, all, "product")).toBe(false);
    expect(careerStepDepartment(three, all, "product", 1)).toEqual({ plan: all, from: null });
    expect(careerStepDepartment(three, all, "product", 1).plan).toBe(all);
  });

  it("leaves the race's stepDepartment refusing", () => {
    const all = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(stepDepartment(three, all, "recruiting", 1)).toBe(all);
  });
});

describe("where moved people came from", () => {
  it("says it in plain words, sources in team order", () => {
    const once = noteMove(NO_MOVES, "product", "recruiting");
    expect(moveNote(once, "recruiting")).toBe("1 moved from Product");
    expect(moveNote(once, "product")).toBeNull();
    const more = noteMove(noteMove(once, "growth", "recruiting"), "product", "recruiting");
    expect(moveNote(more, "recruiting")).toBe("2 moved from Product, 1 from Growth");
  });

  it("takes one back on −, from the source with the most", () => {
    const notes = noteMove(noteMove(noteMove(NO_MOVES, "product", "recruiting"), "product", "recruiting"), "growth", "recruiting");
    expect(moveNote(dropMove(notes, "recruiting"), "recruiting")).toBe("1 moved from Product, 1 from Growth");
    expect(moveNote(dropMove(dropMove(dropMove(notes, "recruiting"), "recruiting"), "recruiting"), "recruiting")).toBeNull();
    expect(dropMove(NO_MOVES, "growth")).toEqual(NO_MOVES);
  });
});
