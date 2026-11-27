import { describe, expect, it } from "vitest";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { careerHelp } from "./careerHelp";

describe("how to play a career", () => {
  const help = careerHelp(CAREER);
  const all = help.map((section) => `${section.title} ${section.text}`).join(" ");

  it("has its sections in order", () => {
    expect(help.map((section) => section.title)).toEqual(["The goal", "One year at a time", "Eras and history", "Product, Growth, Recruiting", "Cash and raising money", "Going public", "Offices", "One rescue", "Rivals come and go", "The 3D office", "The market", "Sound"]);
  });

  it("explains the office: where it shows, moving people, the year playing out, and what happens without it", () => {
    const text = help.find((s) => s.title === "The 3D office")!.text;
    for (const words of ["1024", "3D office", "Keep them", "Escape", "Skip", "Reload 3D view", "reduced motion", "2D"]) expect(text).toContain(words);
  });

  it("explains the market: buildings by users, the bar, the year's new users, selecting a company", () => {
    const text = help.find((s) => s.title === "The market")!.text;
    for (const words of ["Market", "users", "bar", "public", "Show in market", "Yours is the first, on the left"]) expect(text).toContain(words);
  });

  it("says how + moves people and who gets the candidates", () => {
    const text = help.find((s) => s.title === "Product, Growth, Recruiting")!.text;
    for (const words of ["Press +", "largest other team", "most hype", "start next year"]) expect(text).toContain(words);
  });

  it("says what makes a sound and where to turn it off", () => {
    expect(help.find((s) => s.title === "Sound")!.text).toContain("Sound menu");
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
