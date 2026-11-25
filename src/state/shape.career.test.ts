import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { HUMAN, newGame, planOf, reportFor, resolve } from "../engine/testKit";
import { isGame, isPlan, isTurnLog } from "./shape";

/** As a save comes back from storage: plain JSON that shares nothing with the game it was made from. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** A saved career game, loosely typed: just enough structure to reach in and damage it. */
interface Draft {
  wave?: unknown;
  companies: { career?: Record<string, unknown> }[];
}

/** The career facts of the company in seat 1, there to be damaged. */
const careerFacts = (game: Draft): Record<string, unknown> => {
  const career = game.companies[1].career;
  if (career === undefined) throw new Error("the company in seat 1 has no career facts");
  return career;
};

describe("is this a career game", () => {
  it("accepts a career game and the log of its first year", () => {
    const { state, log } = resolve(newCareer(), {}, 1, CAREER_TEST);
    expect(isGame(saved(newCareer()), CAREER_TEST)).toBe(true);
    expect(isGame(saved(state), CAREER_TEST)).toBe(true);
    expect(isTurnLog(saved(log), 4)).toBe(true);
  });

  it.each<[string, (game: Draft) => void]>([
    ["a company without its career facts", (game) => { delete game.companies[1].career; }],
    ["an office the config does not have", (game) => { careerFacts(game).office = 5; }],
    ["a founding turn that is not a whole number", (game) => { careerFacts(game).founded = 1.5; }],
    ["a rescue for an unknown reason", (game) => { careerFacts(game).rescue = { turn: 3, reason: "merged" }; }],
    ["a listing without its amount", (game) => { careerFacts(game).listed = { turn: 3, valuation: 1 }; }],
    ["a game without its wave of new users", (game) => { delete game.wave; }],
  ])("rejects %s", (_name, damage) => {
    const game = saved(newCareer()) as Draft;
    damage(game);
    expect(isGame(game, CAREER_TEST)).toBe(false);
  });

  it("accepts a company that has moved office, gone public and been rescued", () => {
    const game = saved(newCareer()) as Draft;
    Object.assign(careerFacts(game), {
      office: 4,
      listed: { turn: 3, valuation: 2_000_000, amount: 400_000 },
      rescue: { turn: 5, reason: "fired" },
      qualityAtLastClose: 62.5,
      qualified: true,
    });
    expect(isGame(game, CAREER_TEST)).toBe(true);
  });

  it("still accepts a race game against the race's config", () => {
    expect(isGame(saved(newGame()), DESIGN)).toBe(true);
  });

  it("does not take a race game for a career", () => {
    expect(isGame(saved(newGame()), CAREER_TEST)).toBe(false);
  });

  it("a plan may say whether to go public, as a boolean only", () => {
    const somePlan = planOf(newCareer(), HUMAN);
    expect(isPlan({ ...somePlan, goPublic: true })).toBe(true);
    expect(isPlan(somePlan)).toBe(true);
    expect(isPlan({ ...somePlan, goPublic: "yes" })).toBe(false);
  });
});

describe("is this the log of a career's year", () => {
  const firstYear = resolve(newCareer(), {}, 1, CAREER_TEST);
  const { log } = firstYear;

  /** The log with something added to the report of the company in seat 1. */
  const withReport = (patch: Record<string, unknown>): unknown =>
    saved({ ...log, companies: log.companies.map((report, seat) => (seat === 1 && report !== null ? { ...report, ...patch } : report)) });

  /** A career report in which nothing happened, with some lines replaced. */
  const careerLines = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    listing: null,
    rescue: null,
    office: null,
    hype: { listing: 0, rescue: 0 },
    qualityLostToEvent: 0,
    ...patch,
  });

  it("may name the seats that newcomers take, and only seats there are", () => {
    expect(isTurnLog(saved({ ...log, entrants: [] }), 4)).toBe(true);
    expect(isTurnLog(saved({ ...log, entrants: [1, 3] }), 4)).toBe(true);
    expect(isTurnLog(saved({ ...log, entrants: [4] }), 4)).toBe(false);
    expect(isTurnLog(saved({ ...log, entrants: 1 }), 4)).toBe(false);
  });

  it("may count a moving bill among a company's costs, as a number only", () => {
    const { costs } = reportFor(firstYear, 1);
    expect(isTurnLog(withReport({ costs: { ...costs, moving: 60_000 } }), 4)).toBe(true);
    expect(isTurnLog(withReport({ costs: { ...costs, moving: "60000" } }), 4)).toBe(false);
  });

  it("may carry a company's career report", () => {
    expect(isTurnLog(withReport({ career: careerLines() }), 4)).toBe(true);
    const eventful = careerLines({
      listing: { valuation: 2_000_000, amount: 400_000 },
      rescue: { reason: "bankrupt", cashBefore: -50_000, equityBefore: 0.8 },
      office: { from: 0, to: 1, bill: 60_000 },
      hype: { listing: 20, rescue: -10 },
      qualityLostToEvent: 12.5,
    });
    expect(isTurnLog(withReport({ career: eventful }), 4)).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a listing without its amount", { listing: { valuation: 2_000_000 } }],
    ["a rescue for an unknown reason", { rescue: { reason: "merged", cashBefore: -50_000, equityBefore: 0.8 } }],
    ["a move to an office that is not a whole number", { office: { from: 0, to: 1.5, bill: 60_000 } }],
    ["hype without its rescue line", { hype: { listing: 20 } }],
    ["a quality loss that is not a number", { qualityLostToEvent: null }],
  ])("rejects a career report with %s", (_name, patch) => {
    expect(isTurnLog(withReport({ career: careerLines(patch) }), 4)).toBe(false);
  });
});
