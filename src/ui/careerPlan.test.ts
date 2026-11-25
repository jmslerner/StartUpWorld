import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, newCareer, qualify, withCareerOf } from "../engine/careerKit";
import { listingOf, rulesForTurn } from "../engine";
import { defaultPlan } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { HUMAN, withCompany } from "../engine/testKit";
import { viewFor } from "../engine/view";
import type { GameState, Plan } from "../engine/types";
import { count, money } from "./format";
import { listingView, officeMoveView } from "./careerPlan";
import { planningView } from "./viewModel";

const draftOf = (game: GameState, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(game.companies[HUMAN]), ...patch });
const texts = (game: GameState, draft: Plan) => planningView(game, draft, CAREER_TEST).warnings.map((w) => w.text);
const bar = rulesForTurn(CAREER_TEST, 1).ipo.users;

describe("going public in the plan", () => {
  it("offers the exact amount the year will bring", () => {
    const game = qualify(newCareer(), HUMAN);
    const view = listingView(game, draftOf(game, { goPublic: true }), CAREER_TEST)!;
    const expected = listingOf(game.companies[HUMAN], game.climate.multiplier, rulesForTurn(CAREER_TEST, 1));
    expect(view).toMatchObject({ blocked: null, blockedText: null, selected: true, amount: expected.amount, valuation: expected.valuation, equityAfter: 0.8, hype: 20 });
    expect(view.investorSeatsAfter).toBe(game.companies[HUMAN].investorSeats + 1);
    expect(projectTurn(viewFor(game, HUMAN), draftOf(game, { goPublic: true }), CAREER_TEST).career?.listing?.amount).toBe(view.amount);
    expect(view.text).toBe(`Sell 20% of the company for ${money(expected.amount)}, at a ${money(expected.valuation)} valuation. You keep 80%, investors gain a board seat, and the company gains 20 hype. From then on the company is worth 25% more, and it can no longer raise privately.`);
  });

  it("says why it is not on offer", () => {
    const fresh = newCareer();
    expect(listingView(fresh, draftOf(fresh), CAREER_TEST)).toMatchObject({ blocked: "users", blockedText: `Going public takes a year that closes with ${count(bar)} users and a profit. You have 0.` });
    const atBar = withCompany(newCareer(), HUMAN, { users: bar });
    expect(listingView(atBar, draftOf(atBar), CAREER_TEST)?.blockedText).toBe(`You have the users. Going public takes a year that closes with ${count(bar)} users and a profit.`);
    const listed = atTurn(withCareerOf(newCareer(), HUMAN, { listed: { turn: 23, valuation: 1, amount: 1 } }), 30);
    expect(listingView(listed, draftOf(listed), CAREER_TEST)).toMatchObject({ blocked: "listed", blockedText: "Public since 2012." });
  });

  it("shows a saved choice that is no longer on offer as not chosen, with the reason", () => {
    const fresh = newCareer();
    expect(listingView(fresh, draftOf(fresh, { goPublic: true }), CAREER_TEST)).toMatchObject({ selected: false, blocked: "users" });
  });

  it("says that it drops a raise chosen with it", () => {
    const game = qualify(newCareer(), HUMAN);
    expect(listingView(game, draftOf(game, { goPublic: true, raisePercent: 10 }), CAREER_TEST)!.text).toMatch(/ Going public drops this year's raise\.$/);
  });
});

describe("the career's warnings", () => {
  it("names the rescue before it is used and the end after", () => {
    const broke = withCompany(newCareer(), HUMAN, { cash: 1_000 });
    expect(texts(broke, draftOf(broke)).join(" ")).toMatch(/Below \$0 the company is rescued once: you keep half your stake and investors take the board\./);
    const used = withCareerOf(broke, HUMAN, { rescue: { turn: 1, reason: "bankrupt" } });
    expect(texts(atTurn(used, 3), draftOf(used)).join(" ")).toMatch(/Below \$0 your company is out, and your career ends\./);
  });

  it("gives one warning about $0, first, and never says bankrupt", () => {
    const broke = withCompany(newCareer(), HUMAN, { cash: 1_000 });
    const warnings = planningView(broke, draftOf(broke), CAREER_TEST).warnings;
    expect(warnings.filter((w) => w.level === "danger" && w.text.includes("$0"))).toHaveLength(1);
    expect(warnings[0].text).toMatch(/rescued once/);
    expect(warnings.map((w) => w.text).join(" ")).not.toMatch(/you go bankrupt/);
  });

  it("says the board sits out the year after a rescue", () => {
    const rescued = atTurn(withCareerOf(newCareer(), HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5);
    expect(texts(rescued, draftOf(rescued))).toContain("After the rescue your board does not vote this year.");
  });

  it("shows a coming office move and its bill, and the final year", () => {
    const growing = withCompany(newCareer(), HUMAN, { headcount: 4, headcountAtLastClose: 4 });
    const draft = draftOf(growing, { allocation: { product: 1, growth: 0, recruiting: 3 }, hireLimit: null });
    const projection = projectTurn(viewFor(growing, HUMAN), draft, CAREER_TEST);
    const move = officeMoveView(projection, CAREER_TEST);
    expect(move).toMatchObject({ from: "Garage", to: "Shared office", capacity: CAREER_TEST.career!.offices[0].capacity, bill: projection.career?.office?.bill });
    expect(texts(growing, draft)).toContain(move!.text);
    const last = atTurn(newCareer(), 49);
    expect(texts(last, draftOf(last))).toContain("Final year: after 2038 the largest founder's stake (equity × valuation) wins.");
  });

  it("does not count the moving bill twice: a plan that ends the year above $0 gets a note, not a caution", () => {
    const growing = withCompany(newCareer(), HUMAN, { headcount: 4, headcountAtLastClose: 4 });
    const draft = draftOf(growing, { allocation: { product: 1, growth: 0, recruiting: 3 }, hireLimit: null });
    const first = projectTurn(viewFor(growing, HUMAN), draft, CAREER_TEST);
    const bill = first.career!.office!.bill;
    // The cash that leaves half the bill at the year's end, the bill already counted in the costs.
    const tight = withCompany(growing, HUMAN, { cash: growing.companies[HUMAN].cash - first.cash + bill / 2 });
    const projection = projectTurn(viewFor(tight, HUMAN), draft, CAREER_TEST);
    expect(projection.career?.office).not.toBeNull();
    expect(projection.cash).toBeGreaterThan(0);
    expect(projection.cash).toBeLessThan(bill);
    const move = officeMoveView(projection, CAREER_TEST)!;
    expect(planningView(tight, draft, CAREER_TEST).warnings.find((w) => w.text === move.text)?.level).toBe("note");
  });

  it("tells a company at the bar how to qualify, and one that has qualified that it may list", () => {
    const qualified = qualify(newCareer(), HUMAN);
    expect(texts(qualified, draftOf(qualified))).toContain("You may go public this year: see Go public in the plan.");
    expect(texts(qualified, draftOf(qualified, { goPublic: true }))).not.toContain("You may go public this year: see Go public in the plan.");
  });
});
