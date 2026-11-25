import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST } from "../engine/careerKit";
import { quarter, quartersLeft, runwayText, yearRunwayText, yearsLeft } from "./format";
import { wordsFor } from "./words";

describe("words for a year", () => {
  it("writes runway in years, cut to one decimal", () => {
    expect(yearRunwayText(null)).toBe("profitable");
    expect(yearRunwayText(0)).toBe("0 years");
    expect(yearRunwayText(1.04)).toBe("1.0 year");
    expect(yearRunwayText(1.96)).toBe("1.9 years");
    expect(yearRunwayText(3.46)).toBe("3.4 years");
    expect(yearRunwayText(41)).toBe("40+ years");
  });

  it("counts a climate's years", () => {
    expect(yearsLeft(1)).toBe("this year only");
    expect(yearsLeft(2)).toBe("this year and the next");
    expect(yearsLeft(4)).toBe("this year and 3 more");
  });

  it("gives the race its own words, unchanged", () => {
    const w = wordsFor(DESIGN);
    expect(w).toMatchObject({ career: false, period: "quarter", periods: "quarters", report: "Quarterly" });
    expect(w.short(1)).toBe("1 qtr");
    expect(w.short(3)).toBe("3 qtrs");
    expect(w.when(3)).toBe(quarter(3));
    expect(w.units(2)).toBe("2 turns");
    expect(w.units(1)).toBe("1 turn");
    expect(w.runway(2.5)).toBe(runwayText(2.5));
    expect(w.left(3)).toBe(quartersLeft(3));
  });

  it("gives a career its years", () => {
    const w = wordsFor(CAREER_TEST);
    expect(w).toMatchObject({ career: true, period: "year", periods: "years", report: "Annual" });
    expect(w.short(1)).toBe("1 yr");
    expect(w.short(3)).toBe("3 yrs");
    expect(w.when(1)).toBe("1990");
    expect(w.when(49)).toBe("2038");
    expect(w.units(2)).toBe("2 years");
    expect(w.units(1)).toBe("1 year");
    expect(w.runway(2.5)).toBe("2.5 years");
    expect(w.left(2)).toBe("this year and the next");
  });
});
