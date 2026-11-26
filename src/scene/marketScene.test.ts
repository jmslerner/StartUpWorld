import { describe, expect, it } from "vitest";
import { CAREER_TEST, newCareer, withCareerOf } from "../engine/careerKit";
import { resolve, withCompany } from "../engine/testKit";
import { rulesForTurn } from "../engine/index";
import { DESIGN } from "../config.design";
import { marketHeight, marketSceneFor, marketTop, MIN_HEIGHT, sameMarketScene } from "./marketScene";

const seed = 7;
const played = () => resolve(newCareer(), {}, 1, CAREER_TEST);

describe("the market", () => {
  it("sizes buildings by the square root of users, on one scale with the bar", () => {
    expect(marketTop(100, [10, 20, 200, 0])).toBe(200);
    expect(marketTop(100, [10, 20, 30, 0])).toBe(125);
    expect(marketTop(0, [0, 0, 0, 0])).toBe(1);
    expect(marketHeight(0, 125)).toBe(0);
    expect(marketHeight(1, 1_000_000)).toBe(MIN_HEIGHT);
    expect(marketHeight(125, 125)).toBe(1);
    expect(marketHeight(50, 200)).toBeCloseTo(0.5);
  });

  it("shows the four seats in order, the player first, with the year, the era and the bar", () => {
    const { state, log } = played();
    const scene = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    expect(scene.companies.map((c) => c.seat)).toEqual([0, 1, 2, 3]);
    expect(scene.companies.map((c) => c.state)).toEqual(["player", "rival", "rival", "rival"]);
    expect(scene.companies.map((c) => c.name)).toEqual(state.companies.map((c) => c.name));
    expect(scene.barUsers).toBe(rulesForTurn(CAREER_TEST, state.turn).ipo.users);
    const top = marketTop(scene.barUsers, state.companies.map((c) => c.users));
    expect(scene.bar).toBeCloseTo(Math.sqrt(scene.barUsers / top));
    expect(scene.pool).toBe(log.market.pool);
    expect(scene.runId).toBe(`${seed}:0:${state.companies[0].career!.founded}`);
  });

  it("gives each company its share of last year's new users, and none before a year was played", () => {
    const { state, log } = played();
    const scene = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    log.companies.forEach((report, seat) => {
      const won = report === null || log.market.pool === 0 ? 0 : report.users.won / log.market.pool;
      expect(scene.companies[seat].won).toBeCloseTo(won);
    });
    expect(marketSceneFor({ game: state, log: null, config: CAREER_TEST, seed }).companies.map((c) => c.won)).toEqual([0, 0, 0, 0]);
  });

  it("marks a public company, a newcomer, and leaves an out company an empty lot", () => {
    const { state, log } = played();
    let game = withCareerOf(state, 1, { listed: { turn: 1, valuation: 1, amount: 1 } });
    game = withCompany(game, 2, { out: { turn: 1, reason: "bankrupt", users: 0, headcount: 0 } });
    game = withCareerOf(game, 3, { founded: game.turn });
    const scene = marketSceneFor({ game, log, config: CAREER_TEST, seed });
    expect(scene.companies[1].listed).toBe(true);
    expect([scene.companies[2].state, scene.companies[2].height]).toEqual(["out", 0]);
    expect(scene.companies[3].newcomer).toBe(true);
    expect(scene.companies[0].newcomer).toBe(false);
  });

  it("reads only what is public about a rival", () => {
    const { state, log } = played();
    const before = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    const richer = withCompany(state, 2, { cash: state.companies[2].cash * 10 + 1 });
    expect(sameMarketScene(before, marketSceneFor({ game: richer, log, config: CAREER_TEST, seed }))).toBe(true);
  });

  it("is the same scene for the same inputs, and another for another year", () => {
    const { state, log } = played();
    const a = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    expect(sameMarketScene(a, marketSceneFor({ game: state, log, config: CAREER_TEST, seed }))).toBe(true);
    expect(sameMarketScene(a, marketSceneFor({ game: { ...state, turn: state.turn + 1 }, log, config: CAREER_TEST, seed }))).toBe(false);
  });

  it("needs a career", () => {
    const { state, log } = resolve(newCareer(), {}, 1, CAREER_TEST);
    expect(() => marketSceneFor({ game: state, log, config: DESIGN, seed })).toThrow();
  });
});
