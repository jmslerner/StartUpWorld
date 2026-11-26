import { describe, expect, it } from "vitest";
import { newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import type { Plan } from "../engine/types";
import { CARRY_WORDS, TEAM_NAMES, asDrawn, carryLine, carryStep, highlightFor, moveBetweenTeams } from "./officeMoves";

const draft = (product: number, growth: number, recruiting: number): Plan =>
  ({ ...defaultPlan(newCareer().companies[0]), allocation: { product, growth, recruiting } });

describe("officeMoves", () => {
  it("moves one person and changes nothing else", () => {
    expect(moveBetweenTeams(draft(2, 1, 1), "product", "recruiting")).toEqual({ allocation: { product: 1, growth: 1, recruiting: 2 } });
  });
  it("refuses a move from an empty team or onto the same team (Review Focus 4)", () => {
    expect(moveBetweenTeams(draft(0, 2, 1), "product", "growth")).toBeNull();
    expect(moveBetweenTeams(draft(2, 1, 1), "growth", "growth")).toBeNull();
  });
  it("picks up a working person, and only a working person", () => {
    const plan = draft(2, 1, 1);
    expect(carryStep(null, { team: "product", personId: "p0" }, plan)).toEqual({ carry: { team: "product", personId: "p0" }, move: null });
    for (const picked of [null, { team: null, personId: "p5" }, { team: "growth" as const, personId: null }])
      expect(carryStep(null, picked, plan)).toEqual({ carry: null, move: null });
  });
  it("sets them down on anyone of another team, or a desk of it", () => {
    const plan = draft(2, 1, 1); const carry = { team: "product" as const, personId: "p0" };
    expect(carryStep(carry, { team: "growth", personId: "p2" }, plan)).toEqual({ carry: null, move: { allocation: { product: 1, growth: 2, recruiting: 1 } } });
    expect(carryStep(carry, { team: "recruiting", personId: null }, plan).move).toEqual({ allocation: { product: 1, growth: 1, recruiting: 2 } });
  });
  it("puts back on empty space or on the same person, and swaps to another of the same team", () => {
    const plan = draft(2, 1, 1); const carry = { team: "product" as const, personId: "p0" };
    expect(carryStep(carry, null, plan)).toEqual({ carry: null, move: null });
    expect(carryStep(carry, { team: "product", personId: "p0" }, plan)).toEqual({ carry: null, move: null });
    expect(carryStep(carry, { team: "product", personId: "p1" }, plan)).toEqual({ carry: { team: "product", personId: "p1" }, move: null });
  });
  it("a pick the draft no longer allows moves nobody (Review Focus 4)", () => {
    expect(carryStep({ team: "product", personId: "p0" }, { team: "growth", personId: "p2" }, draft(0, 3, 1))).toEqual({ carry: null, move: null });
  });
  it("highlights the person carried, and nothing when nothing is (Review Focus 4)", () => {
    expect(highlightFor({ team: "product", personId: "p0" })).toEqual({ kind: "person", personId: "p0" });
    expect(highlightFor(null)).toBeNull();
  });
  it("the same person tapped again after a put-back is picked up again (Review Focus 4)", () => {
    const plan = draft(2, 1, 1); const p0 = { team: "product" as const, personId: "p0" };
    const first = carryStep(null, p0, plan); const back = carryStep(first.carry, p0, plan); const again = carryStep(back.carry, p0, plan);
    expect([first.carry, back.carry, again.carry]).toEqual([p0, null, p0]);
  });
  it("says what is being moved in plain words, none of them a period word of the race", () => {
    expect(carryLine("growth")).toBe("Move one Growth person to");
    expect(Object.values(TEAM_NAMES)).toEqual(["Product", "Growth", "Recruiting"]);
    const text = [...(["product", "growth", "recruiting"] as const).map(carryLine), ...Object.values(TEAM_NAMES), ...Object.values(CARRY_WORDS)].join("\n");
    expect(text).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i);
  });
  it("moves one of the people the office draws when the plan leaves some unassigned", () => {
    // A plan of 1/0/0 for four people is drawn as 4/0/0: one move takes one drawn person, not the whole team.
    const carry = { team: "product" as const, personId: "p0" };
    const drawn = asDrawn(draft(1, 0, 0), { product: 4, growth: 0, recruiting: 0 });
    expect(carryStep(carry, { team: "growth", personId: null }, drawn).move).toEqual({ allocation: { product: 3, growth: 1, recruiting: 0 } });
  });
  it("moves from a team the office draws though the plan has nobody in it", () => {
    const carry = { team: "growth" as const, personId: "p3" };
    const drawn = asDrawn(draft(0, 0, 0), { product: 2, growth: 2, recruiting: 0 });
    expect(carryStep(carry, { team: "recruiting", personId: null }, drawn).move).toEqual({ allocation: { product: 2, growth: 1, recruiting: 1 } });
  });
  it("keeps the rest of the plan as drafted", () => {
    const plan = { ...draft(1, 0, 0), layoffs: 1 };
    expect(asDrawn(plan, { product: 3, growth: 0, recruiting: 0 })).toEqual({ ...plan, allocation: { product: 3, growth: 0, recruiting: 0 } });
  });
});
