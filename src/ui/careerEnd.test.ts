import { describe, expect, it } from "vitest";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, withCareerOf } from "../engine/careerKit";
import { createGame, defaultPlan, resolveTurn } from "../engine";
import { BOOT, HUMAN, resolve, withCompany } from "../engine/testKit";
import type { GameState, TurnLog } from "../engine/types";
import { milestonesOf, type CareerRecord } from "../state/careerRecord";
import { careerEndView } from "./careerEnd";

/** A whole career as the store plays it: the player's plan is the default plan every year. */
const wholeCareer = (seed: number): { game: GameState; log: TurnLog; record: CareerRecord } => {
  let game = createGame(newGameSetup(seed, "Acme"), CAREER);
  let log: TurnLog | null = null;
  let record: CareerRecord = [];
  while (game.outcome === null && game.companies[HUMAN].out === null) {
    const human = game.companies.map((company) => (company.id === HUMAN ? defaultPlan(company) : null));
    const result = resolveTurn(game, choosePlans(game, seed, CAREER, human), seed, CAREER);
    record = [...record, ...milestonesOf(game, result.log, result.state)];
    game = result.state;
    log = result.log;
  }
  return { game, log: log!, record };
};

describe("the end of a career", () => {
  it("ranks by founder's stake exactly as the engine chose the winner", () => {
    const { game, log, record } = wholeCareer(1);
    const view = careerEndView(game, record, CAREER)!;
    expect(view.year).toBe(2038);
    expect(view.standings[0].id).toBe(game.outcome!.winnerId);
    for (const standing of view.standings.filter((each) => each.out === null)) expect(standing.valuation).toBe(log.companies[standing.id]!.valuation);
    expect(view.kind).toBe(game.outcome!.winnerId === HUMAN ? "stake-win" : "stake-loss");
    expect(view.text).toMatch(/^After 2038, /);
    expect(view.marks.length).toBe(record.length);
    for (const standing of view.standings) {
      const listed = game.companies[standing.id].career?.listed ?? null;
      expect(standing.publicSince).toBe(listed === null ? null : listed.turn + 1989);
    }
  });

  it("ends the career at a second failure, after the rescue", () => {
    const again = withCareerOf(withCompany(atTurn(newCareer(), 12), HUMAN, { cash: 1_000 }), HUMAN, { rescue: { turn: 4, reason: "bankrupt" } });
    const { state } = resolve(again, {}, 1, CAREER_TEST);
    expect(careerEndView(state, [], CAREER_TEST)).toMatchObject({
      kind: "bankrupt",
      won: false,
      sound: "bankrupt",
      year: 2001,
      title: "Acme ran out of cash again.",
      text: "You ended 2001 below $0 for the second time. Your one rescue was in 1993, so your career is over.",
    });
  });

  it("names both failures when the rescue was for the other reason", () => {
    const outAt = (reason: "bankrupt" | "fired", rescued: "bankrupt" | "fired"): GameState =>
      withCareerOf(withCompany(atTurn(newCareer(), 13), HUMAN, { out: { turn: 12, reason, users: 0, headcount: 0 } }), HUMAN, { rescue: { turn: 4, reason: rescued } });
    const fired = careerEndView(outAt("fired", "bankrupt"), [], CAREER_TEST)!;
    expect(fired).toMatchObject({ kind: "fired", year: 2001, title: "Your board fired you." });
    expect(fired.text).toBe("Investors held your board, and 2001 was a bad year. Your one rescue, from running out of cash in 1993, is spent, so your career is over.");
    const bankrupt = careerEndView(outAt("bankrupt", "fired"), [], CAREER_TEST)!;
    expect(bankrupt).toMatchObject({ kind: "bankrupt", year: 2001, title: "Acme ran out of cash." });
    expect(bankrupt.text).toBe("You ended 2001 below $0. Your one rescue, when your board fired you in 1993, is spent, so your career is over.");
    const firedTwice = careerEndView(outAt("fired", "fired"), [], CAREER_TEST)!;
    expect(firedTwice.title).toBe("Your board fired you again.");
    for (const view of [fired, bankrupt]) expect(`${view.title} ${view.text}`).not.toMatch(/again|second time/);
  });

  it("lists a rival whose seat was taken by a newcomer, by its own name", () => {
    const record: CareerRecord = [{ kind: "rivalOut", turn: 8, seat: BOOT, name: "Oakline", founded: 1, reason: "fired" }];
    const replaced = withCareerOf(withCompany(newCareer(), BOOT, { name: "Newco" }), BOOT, { founded: 10 });
    const ended = withCareerOf(withCompany(atTurn(replaced, 12), HUMAN, { cash: 1_000 }), HUMAN, { rescue: { turn: 4, reason: "bankrupt" } });
    const { state } = resolve(ended, {}, 1, CAREER_TEST);
    const view = careerEndView(state, record, CAREER_TEST)!;
    expect(view.gone).toEqual([{ name: "Oakline", foundedYear: 1990, outYear: 1997, reason: "fired" }]);
    expect(view.standings.map((standing) => standing.name)).toContain("Newco");
    expect(view.standings.map((standing) => standing.name)).not.toContain("Oakline");
  });

  it("is null while the career goes on", () => {
    expect(careerEndView(newCareer(), [], CAREER_TEST)).toBeNull();
  });
});
