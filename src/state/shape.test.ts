import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import type { Company, GameState, Plan, TurnLog } from "../engine/types";
import { createGameStore } from "./gameStore";
import { isGame, isPlan, isTurnLog } from "./shape";

/** A real game three quarters in and the log of its latest quarter, as they come back from JSON. */
const played = (): { game: GameState; log: TurnLog } => {
  const store = createGameStore(null, DESIGN);
  store.getState().startGame("Acme", 11);
  for (let i = 0; i < 3; i++) store.getState().endQuarter();
  const { game, lastLog } = store.getState();
  return JSON.parse(JSON.stringify({ game, log: lastLog })) as { game: GameState; log: TurnLog };
};

const withCompany = (game: GameState, seat: number, patch: Record<string, unknown>): unknown => ({
  ...game,
  companies: game.companies.map((company, index) => (index === seat ? { ...company, ...patch } : company)),
});

describe("is this a game", () => {
  const { game, log } = played();

  it("accepts a real game", () => {
    expect(isGame(game, DESIGN)).toBe(true);
  });

  it("wants every company in its own seat, and the player in the first", () => {
    expect(isGame(withCompany(game, 2, { id: 1 }), DESIGN)).toBe(false);
    expect(isGame({ ...game, companies: [...game.companies].reverse() }, DESIGN)).toBe(false);
    expect(isGame(withCompany(game, 0, { controller: "blitzscaler" }), DESIGN)).toBe(false);
    expect(isGame({ ...game, companies: game.companies.slice(0, 1) }, DESIGN)).toBe(false);
  });

  it("knows the names the game uses and no others", () => {
    const unknown: [number, Partial<Record<keyof Company, unknown>>][] = [
      [1, { archetype: "conglomerate" }],
      [1, { archetype: "toString" }],
      [2, { controller: "wizard" }],
      [3, { price: "free" }],
      [1, { out: { turn: 2, reason: "bored", users: 0, headcount: 0 } }],
    ];
    for (const [seat, patch] of unknown) expect(isGame(withCompany(game, seat, patch), DESIGN), JSON.stringify(patch)).toBe(false);
    expect(isGame({ ...game, outcome: { kind: "draw", turn: 3, winnerId: null } }, DESIGN)).toBe(false);
    expect(isGame({ ...game, outcome: { kind: "ipo", turn: 3, winnerId: 1 } }, DESIGN)).toBe(true);
  });

  it("holds its numbers to what a game can contain", () => {
    const impossible: Partial<Record<keyof Company, unknown[]>> = {
      users: [-1, 0.5],
      headcount: [-1, 2.5],
      hype: [-1, 101],
      quality: [-0.5, 100.5],
      founderEquity: [-0.1, 1.1],
      founderSeats: [-1, 1.5],
      investorSeats: [-1, 0.5],
      usersAtLastClose: [-1, 0.5],
      headcountAtLastClose: [-1, 0.5],
      cash: [Number.NaN, Number.POSITIVE_INFINITY, "500000"],
    };
    for (const [field, values] of Object.entries(impossible)) {
      for (const value of values) expect(isGame(withCompany(game, 1, { [field]: value }), DESIGN), `${field} = ${String(value)}`).toBe(false);
    }
    // Being in debt is possible: that is how a company goes bankrupt.
    expect(isGame(withCompany(game, 1, { cash: -250_000 }), DESIGN)).toBe(true);
    expect(isGame({ ...game, turn: 0 }, DESIGN)).toBe(false);
    expect(isGame({ ...game, turn: DESIGN.game.maxTurns + 1 }, DESIGN)).toBe(false);
    expect(isGame({ ...game, turn: DESIGN.game.maxTurns }, DESIGN)).toBe(true);
  });

  it("points events and winners at companies that exist", () => {
    expect(isGame({ ...game, event: { cardId: "viral-moment", targetId: 3 } }, DESIGN)).toBe(true);
    expect(isGame({ ...game, event: { cardId: "viral-moment", targetId: 4 } }, DESIGN)).toBe(false);
    expect(isGame({ ...game, outcome: { kind: "ipo", turn: 3, winnerId: 9 } }, DESIGN)).toBe(false);
  });

  it("wants every field of a plan", () => {
    const plan: Plan = game.companies[0].lastPlan;
    expect(isPlan(plan)).toBe(true);
    for (const field of Object.keys(plan)) {
      const rest = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== field));
      expect(isPlan(rest), `without ${field}`).toBe(false);
    }
    expect(isPlan({ ...plan, hireLimit: "2" })).toBe(false);
    expect(isPlan({ ...plan, hireLimit: 2, poachTarget: 1 })).toBe(true);
  });

  it("wants one report, or none, for each company, in seat order", () => {
    expect(isTurnLog(log, 4)).toBe(true);
    expect(isTurnLog({ ...log, companies: log.companies.slice(0, 3) }, 4)).toBe(false);
    expect(isTurnLog({ ...log, companies: [...log.companies, null] }, 4)).toBe(false);
    expect(isTurnLog({ ...log, companies: [log.companies[1], log.companies[0], log.companies[2], log.companies[3]] }, 4)).toBe(false);
    expect(isTurnLog({ ...log, companies: [log.companies[0], null, log.companies[2], log.companies[3]] }, 4)).toBe(true);
    expect(isTurnLog(null, 4)).toBe(false);
  });
});
