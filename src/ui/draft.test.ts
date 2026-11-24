import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { defaultPlan } from "../engine/plan";
import { HUMAN, INCUMBENT, launchedCompany, newGame, withCompany } from "../engine/testKit";
import type { Company, Plan } from "../engine/types";
import { assignEveryone, peopleAvailable, setLayoffs, setRaise, stepDepartment, stepHireLimit, stepMarketing, unassigned } from "./draft";

const company = (patch: Partial<Company> = {}): Company => withCompany(newGame(), HUMAN, { headcount: 6, headcountAtLastClose: 6, ...patch }).companies[HUMAN];
const plan = (c: Company, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(c), allocation: { product: 3, growth: 2, recruiting: 1 }, ...patch });

describe("people available", () => {
  it("is the team, less layoffs, less the fundraiser", () => {
    const c = company();
    expect(peopleAvailable(c, plan(c))).toBe(6);
    expect(peopleAvailable(c, plan(c, { layoffs: 2 }))).toBe(4);
    expect(peopleAvailable(c, plan(c, { raisePercent: 20 }))).toBe(5);
    expect(peopleAvailable(c, plan(c, { layoffs: 2, raisePercent: 20 }))).toBe(3);
  });

  it("counts people without a department", () => {
    const c = company();
    expect(unassigned(c, plan(c))).toBe(0);
    expect(unassigned(c, plan(c, { allocation: { product: 2, growth: 1, recruiting: 0 } }))).toBe(3);
  });
});

describe("moving people between departments", () => {
  it("takes someone out of a department, leaving them unassigned", () => {
    const c = company();
    const next = stepDepartment(c, plan(c), "growth", -1);
    expect(next.allocation).toEqual({ product: 3, growth: 1, recruiting: 1 });
    expect(unassigned(c, next)).toBe(1);
  });

  it("adds an unassigned person to a department", () => {
    const c = company();
    const spare = plan(c, { allocation: { product: 3, growth: 1, recruiting: 1 } });
    expect(stepDepartment(c, spare, "recruiting", 1).allocation).toEqual({ product: 3, growth: 1, recruiting: 2 });
  });

  it("cannot add when everyone is assigned, or remove from an empty department", () => {
    const c = company();
    const full = plan(c);
    expect(stepDepartment(c, full, "product", 1)).toBe(full);
    const empty = plan(c, { allocation: { product: 3, growth: 0, recruiting: 3 } });
    expect(stepDepartment(c, empty, "growth", -1)).toBe(empty);
  });

  it("spreads unassigned people over the current split", () => {
    const c = company();
    const spare = plan(c, { allocation: { product: 2, growth: 1, recruiting: 0 } });
    expect(assignEveryone(c, spare).allocation).toEqual({ product: 4, growth: 2, recruiting: 0 });
    expect(unassigned(c, assignEveryone(c, spare))).toBe(0);
    expect(assignEveryone(c, plan(c))).toEqual(plan(c));
  });
});

describe("layoffs and raising", () => {
  it("shrinks the split when people are laid off", () => {
    const c = company();
    const next = setLayoffs(c, plan(c), 2);
    expect(next.layoffs).toBe(2);
    expect(next.allocation.product + next.allocation.growth + next.allocation.recruiting).toBe(4);
  });

  it("never lays off the last person, and never a negative number", () => {
    const c = company();
    expect(setLayoffs(c, plan(c), 99).layoffs).toBe(5);
    expect(setLayoffs(c, plan(c), -3).layoffs).toBe(0);
  });

  it("frees people again when layoffs are reduced: they come back unassigned", () => {
    const c = company();
    const cut = setLayoffs(c, plan(c), 3);
    const restored = setLayoffs(c, cut, 0);
    expect(restored.layoffs).toBe(0);
    expect(unassigned(c, restored)).toBe(3);
  });

  it("takes the fundraiser out of the split when a raise is switched on", () => {
    const c = company();
    const raising = setRaise(c, plan(c), 20);
    expect(raising.raisePercent).toBe(20);
    expect(raising.allocation.product + raising.allocation.growth + raising.allocation.recruiting).toBe(5);
    const back = setRaise(c, raising, 0);
    expect(back.raisePercent).toBe(0);
    expect(unassigned(c, back)).toBe(1);
  });

  it("keeps the split as it is when it already fits", () => {
    const c = company();
    const loose = plan(c, { allocation: { product: 2, growth: 2, recruiting: 0 } });
    expect(setRaise(c, loose, 10).allocation).toEqual({ product: 2, growth: 2, recruiting: 0 });
  });
});

describe("marketing and hiring steppers", () => {
  it("moves marketing in $25K steps between 0 and the largest spend", () => {
    const c = company();
    expect(stepMarketing(plan(c), 1, CONFIG).marketing).toBe(25_000);
    expect(stepMarketing(plan(c, { marketing: 50_000 }), -1, CONFIG).marketing).toBe(25_000);
    expect(stepMarketing(plan(c), -1, CONFIG).marketing).toBe(0);
    expect(stepMarketing(plan(c, { marketing: CONFIG.pull.maxMarketing }), 1, CONFIG).marketing).toBe(CONFIG.pull.maxMarketing);
    expect(stepMarketing(plan(c, { marketing: 50_000 }), 4, CONFIG).marketing).toBe(150_000);
  });

  it("lowers the hire limit from 'as many as possible' and raises it back", () => {
    const c = company();
    const base = plan(c);
    expect(base.hireLimit).toBeNull();
    // Capacity is 2 with one recruiter in a team of six.
    const one = stepHireLimit(base, -1, 2);
    expect(one.hireLimit).toBe(1);
    expect(stepHireLimit(one, -1, 2).hireLimit).toBe(0);
    expect(stepHireLimit(stepHireLimit(one, -1, 2), -1, 2).hireLimit).toBe(0);
    expect(stepHireLimit(one, 1, 2).hireLimit).toBeNull();
    expect(stepHireLimit(base, 1, 2).hireLimit).toBeNull();
  });
});

describe("with a real company", () => {
  it("handles the Incumbent's eight people the same way", () => {
    const c = launchedCompany(newGame(), INCUMBENT, { users: 10_000 }).companies[INCUMBENT];
    const base = defaultPlan(c);
    expect(unassigned(c, base)).toBe(0);
    const raising = setRaise(c, base, 30);
    expect(peopleAvailable(c, raising)).toBe(7);
    expect(unassigned(c, raising)).toBe(0);
  });
});
