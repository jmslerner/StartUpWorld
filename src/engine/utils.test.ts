import { describe, it, expect } from "vitest";
import { clamp, parseAmount } from "./utils";

describe("clamp", () => {
  it("passes through value in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles min === max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it("handles exact boundaries", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("parseAmount", () => {
  it("parses plain number", () => {
    expect(parseAmount("500")).toBe(500);
  });

  it("parses k suffix", () => {
    expect(parseAmount("500k")).toBe(500_000);
  });

  it("parses m suffix", () => {
    expect(parseAmount("2.5m")).toBe(2_500_000);
  });

  it("strips dollar sign", () => {
    expect(parseAmount("$100")).toBe(100);
  });

  it("strips commas", () => {
    expect(parseAmount("$1,000")).toBe(1000);
  });

  it("handles combined formatting", () => {
    expect(parseAmount("$1.5m")).toBe(1_500_000);
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("$$")).toBeNull();
  });

  it("handles decimal without suffix", () => {
    expect(parseAmount("99.5")).toBe(99.5);
  });

  it("is case-insensitive", () => {
    expect(parseAmount("500K")).toBe(500_000);
    expect(parseAmount("2M")).toBe(2_000_000);
  });
});
