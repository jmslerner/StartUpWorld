import { describe, expect, it } from "vitest";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { careerHelp } from "./careerHelp";

describe("how to play a career", () => {
  const help = careerHelp(CAREER);
  const all = help.map((section) => `${section.title} ${section.text}`).join(" ");

  it("has its sections in order", () => {
    expect(help.map((section) => section.title)).toEqual(["The goal", "One year at a time", "Eras and history", "Product, Growth, Recruiting", "Cash and raising money", "Going public", "Offices", "One rescue", "Rivals come and go"]);
  });

  it("speaks in years, never turns or quarters", () => {
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    expect(help[0].text).toContain("1990");
    expect(help[0].text).toContain("2038");
  });

  it("takes its numbers from the config", () => {
    const sizes = CAREER.career.offices.map((office) => `${office.name} ${office.capacity}`).join(", ");
    expect(help.find((s) => s.title === "Offices")!.text).toContain(sizes);
    expect(help.find((s) => s.title === "Going public")!.text).toMatch(/20%.*25%/);
    expect(help.find((s) => s.title === "One rescue")!.text).toContain("half");
  });

  it("is empty for a race", () => {
    expect(careerHelp(DESIGN)).toEqual([]);
  });
});
