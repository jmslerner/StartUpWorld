import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { defaultPlan } from "../engine/plan";
import type { GameState, Plan } from "../engine/types";
import { PLAYER_ID, createGameStore, type StorageLike } from "./gameStore";
import { SAVE_KEY, SAVE_VERSION, parseSave } from "./save";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const NO_EVENTS = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const started = (storage: StorageLike | null = new MemoryStorage(), seed = 11) => {
  const store = createGameStore(storage, NO_EVENTS);
  store.getState().startGame("Acme", seed);
  return store;
};
const game = (store: ReturnType<typeof createGameStore>): GameState => store.getState().game!;

describe("game store", () => {
  it("starts with no game: the new-game screen", () => {
    const state = createGameStore(new MemoryStorage(), DESIGN).getState();
    expect(state.game).toBeNull();
    expect(state.draft).toBeNull();
    expect(state.lastLog).toBeNull();
  });

  it("starts a game with the player in seat 0 against three CPUs", () => {
    const store = started();
    const state = store.getState();
    expect(state.seed).toBe(11);
    expect(game(store).turn).toBe(1);
    expect(game(store).companies[PLAYER_ID]).toMatchObject({ controller: "human", name: "Acme" });
    expect(game(store).companies.slice(1).map((c) => c.controller).sort()).toEqual(["blitzscaler", "bootstrapper", "incumbent"]);
    expect(state.draft).toEqual(defaultPlan(game(store).companies[PLAYER_ID]));
    expect(state.reportOpen).toBe(false);
  });

  it("keeps the player's edits to the plan", () => {
    const store = started();
    store.getState().setDraft({ marketing: 50_000, price: "budget" });
    expect(store.getState().draft).toMatchObject({ marketing: 50_000, price: "budget", allocation: { product: 3, growth: 0, recruiting: 0 } });
  });

  it("ends the quarter: resolves the turn with the draft and the CPUs' plans, then opens the report", () => {
    const store = started();
    store.getState().setDraft({ allocation: { product: 2, growth: 0, recruiting: 1 }, marketing: 25_000 });
    store.getState().endQuarter();
    const state = store.getState();
    expect(game(store).turn).toBe(2);
    expect(state.lastLog?.turn).toBe(1);
    expect(state.lastLog?.companies[PLAYER_ID]?.plan).toMatchObject({ allocation: { product: 2, growth: 0, recruiting: 1 }, marketing: 25_000 });
    expect(state.lastLog?.companies[PLAYER_ID]?.costs.marketing).toBe(25_000);
    for (const report of state.lastLog!.companies) expect(report).not.toBeNull();
    expect(state.reportOpen).toBe(true);
  });

  it("makes last turn's split the default for the next plan, refitted to the new team", () => {
    const store = started();
    store.getState().setDraft({ allocation: { product: 2, growth: 0, recruiting: 1 }, marketing: 25_000, price: "premium" });
    store.getState().endQuarter();
    const company = game(store).companies[PLAYER_ID];
    expect(store.getState().draft).toEqual(defaultPlan(company));
    expect(store.getState().draft).toMatchObject({ marketing: 25_000, price: "premium", raisePercent: 0, poachTarget: null, layoffs: 0 });
    const split = store.getState().draft!.allocation;
    expect(split.product + split.growth + split.recruiting).toBe(company.headcount);
  });

  it("closes the report", () => {
    const store = started();
    store.getState().endQuarter();
    store.getState().closeReport();
    expect(store.getState().reportOpen).toBe(false);
    expect(store.getState().lastLog).not.toBeNull();
  });

  it("plays the same game for the same seed and plans", () => {
    const play = () => {
      const store = started(null, 5);
      for (let i = 0; i < 6; i++) store.getState().endQuarter();
      return game(store);
    };
    expect(play()).toEqual(play());
  });

  it("stops when the game is over or the player is out: ending the quarter then changes nothing", () => {
    const store = started();
    for (let i = 0; i < 40 && !store.getState().over; i++) store.getState().endQuarter();
    expect(store.getState().over).toBe(true);
    const frozen = store.getState().game;
    store.getState().endQuarter();
    expect(store.getState().game).toBe(frozen);
    const player = frozen!.companies[PLAYER_ID];
    expect(frozen!.outcome !== null || player.out !== null).toBe(true);
  });

  it("ends the player's game as soon as their company is out, even if rivals play on", () => {
    const store = started();
    // Spend far more than the company has: bankrupt at the end of the first quarter.
    store.getState().setDraft({ marketing: 5_000_000 });
    store.getState().endQuarter();
    expect(game(store).companies[PLAYER_ID].out?.reason).toBe("bankrupt");
    expect(game(store).outcome).toBeNull();
    expect(store.getState().over).toBe(true);
  });

  it("goes back to the new-game screen and forgets the game", () => {
    const storage = new MemoryStorage();
    const store = started(storage);
    store.getState().endQuarter();
    store.getState().abandon();
    expect(store.getState()).toMatchObject({ game: null, draft: null, lastLog: null, seed: null, over: false });
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });
});

describe("autosave", () => {
  it("writes nothing until a game starts", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, DESIGN);
    expect(storage.writes).toBe(0);
  });

  it("saves after every change, including edits to the plan in progress", () => {
    const storage = new MemoryStorage();
    const store = started(storage);
    const afterStart = storage.writes;
    expect(afterStart).toBeGreaterThan(0);
    store.getState().setDraft({ marketing: 75_000 });
    expect(storage.writes).toBeGreaterThan(afterStart);
    expect(parseSave(storage.getItem(SAVE_KEY))?.draft.marketing).toBe(75_000);
  });

  it("resumes mid-turn after a refresh: same game, same draft, same report", () => {
    const storage = new MemoryStorage();
    const first = started(storage, 21);
    first.getState().endQuarter();
    first.getState().endQuarter();
    first.getState().setDraft({ marketing: 100_000, price: "budget" });
    const before = first.getState();

    const second = createGameStore(storage, NO_EVENTS);
    const after = second.getState();
    expect(after.seed).toBe(21);
    expect(after.game).toEqual(before.game);
    expect(after.draft).toEqual(before.draft);
    expect(after.lastLog).toEqual(before.lastLog);
    expect(after.reportOpen).toBe(before.reportOpen);
    expect(after.over).toBe(false);

    // And it carries on exactly as the first would have.
    first.getState().endQuarter();
    second.getState().endQuarter();
    expect(second.getState().game).toEqual(first.getState().game);
  });

  it("resumes a finished game on its end screen", () => {
    const storage = new MemoryStorage();
    const first = started(storage);
    first.getState().setDraft({ marketing: 5_000_000 });
    first.getState().endQuarter();
    expect(createGameStore(storage, NO_EVENTS).getState().over).toBe(true);
  });

  it("starts fresh when the save cannot be used", () => {
    const good = new MemoryStorage();
    started(good);
    const raw = good.getItem(SAVE_KEY)!;
    const bad: (string | null)[] = [
      null,
      "",
      "not json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ ...JSON.parse(raw), version: SAVE_VERSION + 1 }),
      JSON.stringify({ ...JSON.parse(raw), version: "1" }),
      JSON.stringify({ ...JSON.parse(raw), seed: "abc" }),
      JSON.stringify({ ...JSON.parse(raw), game: null }),
      JSON.stringify({ ...JSON.parse(raw), game: { turn: 1, companies: [] } }),
      JSON.stringify({ ...JSON.parse(raw), game: { ...JSON.parse(raw).game, companies: JSON.parse(raw).game.companies.slice(0, 1) } }),
      JSON.stringify({ ...JSON.parse(raw), draft: { marketing: "lots" } }),
      raw.replace(/"cash":\d+/, '"cash":null'),
    ];
    for (const value of bad) {
      const storage = new MemoryStorage();
      if (value !== null) storage.setItem(SAVE_KEY, value);
      expect(createGameStore(storage, DESIGN).getState().game, String(value).slice(0, 60)).toBeNull();
    }
  });

  it("works without storage, and survives storage that throws", () => {
    const store = started(null);
    store.getState().endQuarter();
    expect(game(store).turn).toBe(2);

    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const guarded = createGameStore(broken, DESIGN);
    expect(() => guarded.getState().startGame("Acme", 3)).not.toThrow();
    expect(() => guarded.getState().endQuarter()).not.toThrow();
    expect(() => guarded.getState().abandon()).not.toThrow();
  });

  it("leaves the old game's storage keys alone", () => {
    const storage = new MemoryStorage();
    storage.setItem("startupworld:save", "old game");
    storage.setItem("startupworld:audio:v1", "{}");
    const store = started(storage);
    store.getState().abandon();
    expect(storage.getItem("startupworld:save")).toBe("old game");
    expect(storage.getItem("startupworld:audio:v1")).toBe("{}");
    expect(SAVE_KEY).not.toBe("startupworld:save");
  });

  it("sanitises a saved draft through the engine's own plan check", () => {
    const storage = new MemoryStorage();
    started(storage);
    const save = JSON.parse(storage.getItem(SAVE_KEY)!);
    const wild: Plan = { ...save.draft, layoffs: 99, marketing: 33_333, raisePercent: 30 };
    storage.setItem(SAVE_KEY, JSON.stringify({ ...save, draft: wild }));
    const draft = createGameStore(storage, DESIGN).getState().draft!;
    expect(draft.layoffs).toBe(2);
    expect(draft.marketing).toBe(25_000);
    expect(draft.raisePercent).toBe(0);
  });
});
