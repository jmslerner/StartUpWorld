import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { CAREER_RULES, CAREER_TEST, atTurn, newCareer, withCareer, withCareerOf, withEras } from "../engine/careerKit";
import { DEPARTMENTS, normalizePlan, resolveTurn } from "../engine/index";
import type { CompanyId, GameState, Outcome, Plan } from "../engine/index";
import { createGame } from "../engine/setup";
import { newGame, onlyActive, planOf, withCompany, withState } from "../engine/testKit";
import { MAX_STAFF_DRAWN } from "../world/cast";
import { lookFor } from "../world/core/colors";
import { DESKS } from "../world/office/layouts";
import { TEAMS } from "../world/types/scene";
import { officeSceneFor, sameOfficeScene } from "./officeScene";
import type { OfficeSceneInput } from "./officeScene";

const sceneOf = (game: GameState, companyId: CompanyId, extra: Partial<OfficeSceneInput> = {}) =>
  officeSceneFor({ game, companyId, config: CAREER_TEST, seed: 7, ...extra });

const staffOf = (game: GameState, companyId: CompanyId, extra: Partial<OfficeSceneInput> = {}): number => {
  const s = sceneOf(game, companyId, extra);
  return s.teams.product + s.teams.growth + s.teams.recruiting + s.away + s.leaving;
};

/** A new career, and the state after each of five years played on everyone's default plan. */
const fiveYears = (): GameState[] => {
  const games = [newCareer()];
  for (let year = 0; year < 5; year++) {
    const game = games[games.length - 1];
    games.push(resolveTurn(game, game.companies.map(() => null), 11, CAREER_TEST).state);
  }
  return games;
};

/** Company 3 with eight people, launched and with the users a raise needs. */
const eightAllowedToRaise = (): GameState =>
  withCompany(newCareer(), 3, { headcount: 8, launched: true, users: 50_000, usersAtLastClose: 50_000, lastRaise: null });

const ended = (game: GameState, outcome: Outcome): GameState => withState(game, { outcome });

describe("the office scene of a company", () => {
  it("a new career opens in the garage, in 1990, with the team its last plan gave it", () => {
    const game = newCareer();
    expect(sceneOf(game, 0)).toEqual({
      runId: "7:0:1",
      seed: 7,
      year: 1990,
      office: 0,
      capacity: 4,
      era: "flat",
      teams: normalizePlan(game, 0, null, CAREER_TEST).plan.allocation,
      away: 0,
      leaving: 0,
      arriving: 0,
      ending: null,
    });
  });

  it("the people always add up to the head count", () => {
    const games = fiveYears();
    expect(games).toHaveLength(6);
    expect(games[5].turn).toBe(6);
    for (const game of games) {
      for (const company of game.companies) expect(staffOf(game, company.id)).toBe(company.headcount);
    }
    // The years were not all alike: somebody's team changed size.
    expect(games[5].companies.some((company, id) => company.headcount !== games[0].companies[id].headcount)).toBe(true);
  });

  it("shows a draft as the engine will play it", () => {
    const game = eightAllowedToRaise();
    const draft: Plan = planOf(game, 3, { raisePercent: 20, layoffs: 1 });
    const shown = sceneOf(game, 3, { draft });
    expect(shown).toMatchObject({ away: 1, leaving: 1 });
    expect(shown.teams).toEqual(normalizePlan(game, 3, draft, CAREER_TEST).plan.allocation);
    expect(shown.teams.product + shown.teams.growth + shown.teams.recruiting).toBe(6);

    // A draft whose teams do not add up is refitted, not shown as written.
    const lopsided: Plan = planOf(game, 3, { allocation: { product: 40, growth: 1, recruiting: 0 } });
    expect(sceneOf(game, 3, { draft: lopsided }).teams).not.toEqual(lopsided.allocation);
    expect(staffOf(game, 3, { draft: lopsided })).toBe(game.companies[3].headcount);
  });

  it("a draft the engine would refuse is shown as the engine would play it", () => {
    // Nobody may raise without users: the person stays at their desk.
    const noUsers = withCompany(eightAllowedToRaise(), 3, { users: 0, usersAtLastClose: 0 });
    expect(sceneOf(noUsers, 3, { draft: planOf(noUsers, 3, { raisePercent: 20 }) })).toMatchObject({ away: 0, leaving: 0 });
    // At least one person has to stay.
    const game = eightAllowedToRaise();
    const everyone = sceneOf(game, 3, { draft: planOf(game, 3, { layoffs: 99 }) });
    expect(everyone.leaving).toBe(7);
    expect(staffOf(game, 3, { draft: planOf(game, 3, { layoffs: 99 }) })).toBe(8);
  });

  it("without a draft the company's last plan is shown, fitted to the team it has now", () => {
    const grown = withCompany(newCareer(), 0, { headcount: 5 });
    expect(sceneOf(grown, 0).teams).toEqual(normalizePlan(grown, 0, null, CAREER_TEST).plan.allocation);
    expect(staffOf(grown, 0)).toBe(5);
  });

  it("the office and its size come from the company's career and the config's offices", () => {
    expect(sceneOf(withCareerOf(newCareer(), 0, { office: 3 }), 0)).toMatchObject({ office: 3, capacity: 40 });
    expect(sceneOf(withCareerOf(newCareer(), 0, { office: 9 }), 0)).toMatchObject({ office: 4, capacity: 150 });
    expect(sceneOf(withCareerOf(newCareer(), 0, { office: -2 }), 0)).toMatchObject({ office: 0, capacity: 4 });
    expect(sceneOf(withCareerOf(newCareer(), 0, { office: 1.7 }), 0)).toMatchObject({ office: 1, capacity: 9 });
  });

  it("a config with fewer offices than five never shows one it does not have", () => {
    const config = withCareer({ offices: CAREER_TEST.career!.offices.slice(0, 2) });
    const game = withCareerOf(newCareer(config), 0, { office: 4 });
    expect(officeSceneFor({ game, companyId: 0, config, seed: 7 })).toMatchObject({ office: 1, capacity: 9 });
  });

  it("a config with more offices than five stops at the fifth", () => {
    const config = withCareer({ offices: [...CAREER_TEST.career!.offices, { id: "tower", name: "Tower", capacity: 400 }] });
    expect(config.career!.offices).toHaveLength(6);
    const game = withCareerOf(newCareer(config), 0, { office: 5 });
    expect(officeSceneFor({ game, companyId: 0, config, seed: 7 })).toMatchObject({ office: 4, capacity: 150 });
  });

  it("names the era of the year", () => {
    const config = withEras(
      { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
      { id: "b", name: "B", firstYear: 1993, invented: false, values: {} },
    );
    const at = (turn: number) => officeSceneFor({ game: atTurn(newCareer(config), turn), companyId: 0, config, seed: 7 });
    expect([at(1).era, at(3).era, at(4).era, at(20).era]).toEqual(["a", "a", "b", "b"]);
    expect([at(3).year, at(4).year]).toEqual([1992, 1993]);
  });

  it("the run is the seed, the seat and the year the company was founded", () => {
    const game = withCareerOf(atTurn(newCareer(), 9), 2, { founded: 6 });
    expect(officeSceneFor({ game, companyId: 2, config: CAREER_TEST, seed: 4242 })).toMatchObject({ runId: "4242:2:6", seed: 4242, year: 1998 });
    expect(sceneOf(game, 1).runId).toBe("7:1:1");
  });

  it("expected hires are whole and never negative", () => {
    const arriving = [2.7, -1, undefined, Number.NaN, Number.POSITIVE_INFINITY].map(
      (expectedHires) => sceneOf(newCareer(), 0, { expectedHires }).arriving,
    );
    expect(arriving).toEqual([2, 0, 0, 0, 0]);
  });

  it("says how it ended", () => {
    const won = ended(newCareer(), { kind: "turnLimit", turn: 49, winnerId: 0 });
    expect([sceneOf(won, 0).ending, sceneOf(won, 1).ending]).toEqual(["won", "lost"]);

    const out = onlyActive(newCareer(), [1, 2, 3]);
    expect(sceneOf(out, 0)).toMatchObject({ ending: "lost", teams: { product: 0, growth: 0, recruiting: 0 }, away: 0, leaving: 0 });
    expect(sceneOf(out, 1).ending).toBeNull();

    const nobody = ended(onlyActive(newCareer(), []), { kind: "wipeout", turn: 49, winnerId: null });
    expect(sceneOf(nobody, 0).ending).toBe("lost");
  });

  it("a race game has no office scene", () => {
    expect(() => officeSceneFor({ game: newGame(), companyId: 0, config: DESIGN, seed: 7 })).toThrow("an office scene needs a career game");
    // A career's config over a race's state: the company has no career facts.
    expect(() => officeSceneFor({ game: newGame(), companyId: 0, config: CAREER_TEST, seed: 7 })).toThrow("an office scene needs a career game");
    // A career's state over a race's config: there are no career rules to read.
    expect(() => officeSceneFor({ game: newCareer(), companyId: 0, config: DESIGN, seed: 7 })).toThrow("an office scene needs a career game");
    for (const id of [12, -1]) expect(() => sceneOf(newCareer(), id)).toThrow("an office scene needs a career game");
  });

  it("a career with no eras has no office scene, and the engine is never asked", () => {
    const config = withEras();
    expect(config.career!.eras).toHaveLength(0);
    expect(() => officeSceneFor({ game: newCareer(), companyId: 0, config, seed: 7 })).toThrow("an office scene needs a career game");
  });

  it("a draft left for a company that is out is not read", () => {
    const live = eightAllowedToRaise();
    const draft: Plan = planOf(live, 3, { raisePercent: 20, layoffs: 1 });
    expect(sceneOf(live, 3, { draft })).toMatchObject({ away: 1, leaving: 1 });
    const out = withCompany(live, 3, { out: { turn: 1, reason: "bankrupt", users: 50_000, headcount: 8 } });
    expect(sceneOf(out, 3, { draft })).toEqual(sceneOf(out, 3));
    expect(sceneOf(out, 3, { draft })).toMatchObject({ away: 0, ending: "lost" });
  });

  it("the same input gives an equal scene, and the input is left as it was", () => {
    const game = newCareer();
    const before = JSON.stringify(game);
    expect(sceneOf(game, 0)).toEqual(sceneOf(game, 0));
    expect(JSON.stringify(game)).toBe(before);
  });

  // The world may not read the engine, so the two sides are checked against each other here.
  it("the world has a desk for everyone an office holds, up to the figures it draws", () => {
    expect(DESKS).toEqual(CAREER_RULES.offices.map((office) => Math.min(office.capacity, MAX_STAFF_DRAWN)));
  });

  it("the world's team names are the engine's departments", () => {
    expect([...TEAMS]).toEqual([...DEPARTMENTS]);
  });
});

describe("the look of each era", () => {
  it("every era of the shipped career has a look of its own, by decade", () => {
    for (const era of CAREER.career!.eras) expect(lookFor(era.id)).not.toBe("classic");
    // Turn 1 is 1990 (yearOf = firstYear + turn - 1).
    const lookIn = (year: number) =>
      lookFor(sceneOf(atTurn(createGame(newGameSetup(1, "Acme"), CAREER), year - 1990 + 1), 0, { config: CAREER }).era);
    expect([1990, 1999, 2000, 2021, 2022, 2038].map(lookIn)).toEqual(["nineties", "nineties", "noughties", "noughties", "twenties", "twenties"]);
  });
});

describe("two office scenes", () => {
  it("two scenes are the same when every field is", () => {
    const a = sceneOf(newCareer(), 0);
    expect(sameOfficeScene(a, { ...a, teams: { ...a.teams } })).toBe(true);
    for (const patch of [{ year: a.year + 1 }, { arriving: 1 }, { teams: { ...a.teams, growth: a.teams.growth + 1 } }, { ending: "lost" as const }])
      expect(sameOfficeScene(a, { ...a, ...patch })).toBe(false);
  });
});
