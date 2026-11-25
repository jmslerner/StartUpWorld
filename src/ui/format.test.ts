import { describe, expect, it } from "vitest";
import { count, money, percent, quarter, quartersLeft, runwayText, signed } from "./format";

describe("money", () => {
  it("shortens to K and M", () => {
    expect(money(0)).toBe("$0");
    expect(money(950)).toBe("$950");
    expect(money(25_000)).toBe("$25K");
    expect(money(419_600)).toBe("$420K");
    expect(money(999_499)).toBe("$999K");
    expect(money(999_500)).toBe("$1.00M");
    expect(money(1_234_000)).toBe("$1.23M");
    expect(money(37_500_000)).toBe("$37.5M");
    expect(money(250_000_000)).toBe("$250M");
  });

  it("puts the minus sign before the dollar sign", () => {
    expect(money(-20_000)).toBe("-$20K");
    expect(money(-1_500_000)).toBe("-$1.50M");
  });
});

describe("count", () => {
  it("writes small numbers in full and shortens large ones", () => {
    expect(count(0)).toBe("0");
    expect(count(950)).toBe("950");
    expect(count(9_950)).toBe("9,950");
    expect(count(12_400)).toBe("12.4K");
    expect(count(250_000)).toBe("250K");
    expect(count(1_150_000)).toBe("1.15M");
  });

  it("never rounds up to a figure that has not been reached", () => {
    // 329,600 users are not the 330K it takes to go public.
    expect(count(329_600)).toBe("329K");
    expect(count(329_999)).toBe("329K");
    expect(count(330_000)).toBe("330K");
    expect(count(12_449)).toBe("12.4K");
    expect(count(12_499)).toBe("12.4K");
    expect(count(99_999)).toBe("99.9K");
    expect(count(999_999)).toBe("999K");
    expect(count(1_159_999)).toBe("1.15M");
    expect(count(-12_499)).toBe("-12.4K");
  });
});

describe("signed", () => {
  it("always shows the direction, and nothing for zero", () => {
    expect(signed(2_100, count)).toBe("+2,100");
    expect(signed(-350, count)).toBe("-350");
    expect(signed(0, count)).toBe("0");
    expect(signed(-20_000, money)).toBe("-$20K");
    expect(signed(360_000, money)).toBe("+$360K");
  });
});

describe("percent, quarter, runway", () => {
  it("formats shares as whole percentages", () => {
    expect(percent(0.64)).toBe("64%");
    expect(percent(1)).toBe("100%");
    expect(percent(0.343)).toBe("34%");
    expect(percent(0.055, 1)).toBe("5.5%");
  });

  it("names a turn as a quarter", () => {
    expect(quarter(1)).toBe("Q1");
    expect(quarter(20)).toBe("Q20");
  });

  it("describes runway in turns, or as profitable", () => {
    expect(runwayText(null)).toBe("profitable");
    expect(runwayText(3.52)).toBe("3.5 turns");
    expect(runwayText(1)).toBe("1.0 turn");
    expect(runwayText(0.4)).toBe("0.4 turns");
    expect(runwayText(42.7)).toBe("40+ turns");
    expect(runwayText(-2)).toBe("0 turns");
  });

  it("never rounds runway up across the two turns the board looks at", () => {
    expect(runwayText(1.96)).toBe("1.9 turns");
    expect(runwayText(1.999)).toBe("1.9 turns");
    expect(runwayText(2)).toBe("2.0 turns");
    expect(runwayText(0.99)).toBe("0.9 turns");
  });

  it("says how long a funding climate still lasts, counting the quarter under way", () => {
    expect(quartersLeft(1)).toBe("this quarter only");
    expect(quartersLeft(2)).toBe("this quarter and the next");
    expect(quartersLeft(3)).toBe("this quarter and 2 more");
  });
});
