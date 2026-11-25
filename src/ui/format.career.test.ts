import { afterEach, describe, expect, it } from "vitest";
import { money, moneyInBillions } from "./format";

describe("money in a career", () => {
  afterEach(() => moneyInBillions(false));

  it("reads $1B and more in billions", () => {
    moneyInBillions(true);
    expect(money(1_069_000_000)).toBe("$1.07B");
    expect(money(999_500_000)).toBe("$1.00B");
    expect(money(12_345_000_000)).toBe("$12.35B");
    expect(money(-2_500_000_000)).toBe("-$2.50B");
    expect(money(999_400_000)).toBe("$999M");
    expect(money(37_500_000)).toBe("$37.5M");
  });

  it("leaves the race's money as it was", () => {
    expect(money(1_069_000_000)).toBe("$1069M");
    moneyInBillions(true);
    moneyInBillions(false);
    expect(money(1_069_000_000)).toBe("$1069M");
  });
});
