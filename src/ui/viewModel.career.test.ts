import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, qualify, withCareerOf } from "../engine/careerKit";
import { closingValuation, rulesForTurn, valuationOf } from "../engine";
import { defaultPlan } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { createGame } from "../engine/setup";
import { HUMAN, launchedCompany, withCompany } from "../engine/testKit";
import { viewFor } from "../engine/view";
import type { GameState, Plan } from "../engine/types";
import { marketingNote, planningView, resourceView, rivalsView } from "./viewModel";

const real = (turn: number): GameState => atTurn(createGame(newGameSetup(1, "Acme"), CAREER), turn);
const draftOf = (game: GameState, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(game.companies[HUMAN]), ...patch });

describe("the view model reads the year's numbers", () => {
  it("shows the listing bar of the year's era", () => {
    expect(resourceView(real(1), CAREER).ipoUsers).toBe(rulesForTurn(CAREER, 1).ipo.users);
    expect(resourceView(real(6), CAREER).ipoUsers).toBe(rulesForTurn(CAREER, 6).ipo.users);
    expect(rulesForTurn(CAREER, 6).ipo.users).not.toBe(rulesForTurn(CAREER, 1).ipo.users);
  });

  it("prices a raise exactly as the engine will pay it", () => {
    const game = launchedCompany(real(20), HUMAN, { users: rulesForTurn(CAREER, 20).raise.minUsers, hype: 30 });
    const option = planningView(game, draftOf(game), CAREER).raise.options[0];
    const projection = projectTurn(viewFor(game, HUMAN), draftOf(game, { raisePercent: option.percent }), CAREER);
    expect(option.amount).toBe(projection.raise?.amount);
  });

  it("asks the year's hiring fee", () => {
    // 2001 is in the bust era, which sets its own fee; the base CAREER fee differs.
    expect(rulesForTurn(CAREER, 12).hiring.fee).not.toBe(CAREER.hiring.fee);
    expect(planningView(real(12), draftOf(real(12)), CAREER).hiring.fee).toBe(rulesForTurn(CAREER, 12).hiring.fee);
  });

  it("values a public company with the listing premium", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 100_000, hype: 40 }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    const rules = rulesForTurn(CAREER_TEST, 1);
    const plain = valuationOf(100_000, 40, listed.climate.multiplier, rules);
    expect(resourceView(listed, CAREER_TEST).valuation).toBe(closingValuation(plain, listed.companies[HUMAN], false, rules));
    expect(resourceView(listed, CAREER_TEST).valuation).toBeGreaterThan(plain);
    const rivalListed = withCareerOf(launchedCompany(listed, 1, { users: 100_000 }), 1, { listed: { turn: 1, valuation: 1, amount: 1 } });
    const rivalPlain = valuationOf(rivalListed.companies[1].users, rivalListed.companies[1].hype, 1, rules);
    expect(rivalsView(rivalListed, CAREER_TEST)[0].valuation).toBe(closingValuation(rivalPlain, rivalListed.companies[1], false, rules));
    expect(rivalsView(rivalListed, CAREER_TEST)[0].valuation).toBeGreaterThan(rivalPlain);
  });

  it("explains a raise a public company cannot make", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 100_000 }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    expect(planningView(listed, draftOf(listed), CAREER_TEST).raise).toMatchObject({ blocked: "public", blockedText: "A public company cannot raise privately." });
  });

  it("never says a career company is on course to list, that it ends the game, or that $0 is bankruptcy", () => {
    const game = withCompany(qualify(newCareer(), HUMAN), HUMAN, { cash: 1_000 });
    const texts = planningView(game, draftOf(game), CAREER_TEST).warnings.map((warning) => warning.text).join(" ");
    expect(texts).not.toMatch(/quarter|turns?\b|On course to go public|could go public this|you go bankrupt/i);
  });

  it("never tells a public company it has the users to go public", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 10 * rulesForTurn(CAREER_TEST, 1).ipo.users }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    expect(planningView(listed, draftOf(listed), CAREER_TEST).warnings.map((w) => w.text).join(" ")).not.toMatch(/to go public/);
  });

  it("gives no close call in the year the board sits out", () => {
    const rescued = atTurn(withCareerOf(withCompany(newCareer(), HUMAN, { investorSeats: 3, users: 5_000, usersAtLastClose: 50_000, launched: true, quality: 40 }), HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5);
    expect(planningView(rescued, draftOf(rescued), CAREER_TEST).warnings.map((w) => w.text).join(" ")).not.toMatch(/Close call|board fires you/);
  });

  it("stops hiring and poaching at the campus", () => {
    const full = withCareerOf(withCompany(newCareer(), HUMAN, { headcount: 150, headcountAtLastClose: 150 }), HUMAN, { office: 4 });
    const view = planningView(full, draftOf(full), CAREER_TEST);
    expect(view.hiring.capacity).toBe(0);
    expect(view.poach.options.every((option) => !option.allowed && option.reason === "Your campus is full: nobody more can join.")).toBe(true);
  });

  it("caps the marketing control at the cash in hand", () => {
    const poor = withCompany(newCareer(), HUMAN, { cash: 30_000 });
    const step = rulesForTurn(CAREER_TEST, 1).pull.marketingStep;
    expect(planningView(poor, draftOf(poor), CAREER_TEST).marketing.max).toBe(Math.floor(30_000 / step) * step);
  });
});

describe("the marketing note", () => {
  const note = "Marketing set to $40,000: it cannot exceed the cash in hand.";
  it("says where the extra room came from", () => {
    expect(marketingNote(note, "raise")).toBe("Marketing set to $40,000: it cannot exceed the cash in hand plus what the raise brings.");
    expect(marketingNote(note, "listing")).toBe("Marketing set to $40,000: it cannot exceed the cash in hand plus what going public brings.");
    expect(marketingNote(note, null)).toBe(note);
    expect(marketingNote("Raise dropped: it needs 5,000 users.", "raise")).toBe("Raise dropped: it needs 5,000 users.");
  });
});
