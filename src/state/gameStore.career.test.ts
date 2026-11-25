import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, atTurn, newCareer, withCareerOf } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, withCompany } from "../engine/testKit";
import type { GameState } from "../engine/types";
import { milestonesOf } from "./careerRecord";
import { CAREER_SAVE_KEY, parseCareerSave, serializeCareerSave } from "./careerSave";
import { createGameStore, type StorageLike } from "./gameStore";
import { SAVE_KEY } from "./save";

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

const RACE = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const store = (storage: StorageLike) => createGameStore(storage, RACE, CAREER_TEST);

describe("the store plays a career", () => {
  it("starts a career in its own mode, config and key", () => {
    const storage = new MemoryStorage();
    const s = store(storage);
    s.getState().startCareer("Acme", 7);
    expect(s.getState()).toMatchObject({ mode: "career", seed: 7, record: [], over: false });
    expect(s.getState().config).toBe(CAREER_TEST);
    expect(s.getState().game?.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
    expect(storage.getItem(CAREER_SAVE_KEY)).not.toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBeNull();
  });

  it("adds each year's milestones to the record and saves them", () => {
    const storage = new MemoryStorage();
    const s = store(storage);
    s.getState().startCareer("Acme", 7);
    const before = s.getState().game!;
    s.getState().endQuarter();
    const { game, lastLog, record } = s.getState();
    expect(record).toEqual(milestonesOf(before, lastLog!, game!));
    expect(parseCareerSave(storage.getItem(CAREER_SAVE_KEY), CAREER_TEST)?.record).toEqual(record);
  });

  it("resumes a career after a reload, with its record", () => {
    const storage = new MemoryStorage();
    const first = store(storage);
    first.getState().startCareer("Acme", 7);
    first.getState().endQuarter();
    const second = store(storage).getState();
    expect(second.mode).toBe("career");
    expect(second.game).toEqual(first.getState().game);
    expect(second.record).toEqual(first.getState().record);
  });

  it("a rescued player plays on; a second failure ends the career, and stays ended after a reload", () => {
    const storage = new MemoryStorage();
    const broke = withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 });
    const write = (game: GameState) =>
      storage.setItem(CAREER_SAVE_KEY, serializeCareerSave({ seed: 3, game, draft: defaultPlan(game.companies[HUMAN]), lastLog: null, reportOpen: false, record: [] }));
    write(broke);
    const rescued = store(storage);
    rescued.getState().endQuarter();
    expect(rescued.getState().over).toBe(false);
    expect(rescued.getState().record).toContainEqual({ kind: "rescued", turn: 4, reason: "bankrupt" });
    write(withCareerOf(broke, HUMAN, { rescue: { turn: 2, reason: "bankrupt" } }));
    const ended = store(storage);
    ended.getState().endQuarter();
    expect(ended.getState()).toMatchObject({ over: true, reportOpen: true });
    expect(store(storage).getState()).toMatchObject({ mode: "career", over: true });
  });
});

describe("two saves, one game in play", () => {
  it("resumes a race saved by the previous build exactly as it was, and writes no career save", () => {
    const storage = new MemoryStorage();
    const race = createGameStore(storage, RACE);
    race.getState().startGame("Acme", 11);
    race.getState().endQuarter();
    const raw = storage.getItem(SAVE_KEY);
    const resumed = store(storage).getState();
    expect(resumed).toMatchObject({ mode: "race", record: [] });
    expect(resumed.config).toBe(RACE);
    expect(resumed.game).toEqual(race.getState().game);
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
    expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
  });

  it("a broken career save leaves a race save to load", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, RACE).getState().startGame("Acme", 11);
    storage.setItem(CAREER_SAVE_KEY, "{ not json");
    expect(store(storage).getState().mode).toBe("race");
  });

  it("keeps both saves: leaving a career for a race leaves the career's save as it was", () => {
    const storage = new MemoryStorage();
    const s = store(storage);
    s.getState().startCareer("Acme", 7);
    s.getState().endQuarter();
    const kept = storage.getItem(CAREER_SAVE_KEY);
    s.getState().leave();
    expect(s.getState()).toMatchObject({ mode: null, game: null, resumable: { race: null, career: { turn: 2, over: false } }, preferred: "career" });
    s.getState().startGame("Acme", 11);
    s.getState().endQuarter();
    expect(storage.getItem(CAREER_SAVE_KEY)).toBe(kept);
    s.getState().abandon();
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(storage.getItem(CAREER_SAVE_KEY)).toBe(kept);
    expect(s.getState()).toMatchObject({ mode: null, game: null, record: [], resumable: { race: null, career: { turn: 2, over: false } }, preferred: "race" });
    expect(s.getState().config).toBe(RACE);
  });

  it("abandoning a career removes its save only", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, RACE).getState().startGame("Acme", 11);
    const raw = storage.getItem(SAVE_KEY);
    const s = store(storage);
    s.getState().leave();
    s.getState().startCareer("Acme", 7);
    s.getState().abandon();
    expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
  });

  it("with both saves on disk, opens on the first screen and resumes the one chosen", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, RACE).getState().startGame("Acme", 11);
    const career = store(new MemoryStorage());
    career.getState().startCareer("Acme", 7);
    career.getState().endQuarter();
    storage.setItem(
      CAREER_SAVE_KEY,
      serializeCareerSave({ seed: 7, game: career.getState().game!, draft: career.getState().draft!, lastLog: null, reportOpen: false, record: career.getState().record }),
    );
    const s = store(storage);
    expect(s.getState()).toMatchObject({ mode: null, game: null, resumable: { race: 1, career: { turn: 2, over: false } } });
    s.getState().resume("career");
    expect(s.getState()).toMatchObject({ mode: "career", resumable: { race: 1, career: null } });
    expect(s.getState().game).toEqual(career.getState().game);
  });

  it("offers a finished career by the year it ended, not as one to resume", () => {
    const storage = new MemoryStorage();
    createGameStore(storage, RACE).getState().startGame("Acme", 11);
    const career = store(new MemoryStorage());
    career.getState().startCareer("Acme", 7);
    career.getState().endQuarter();
    const live = career.getState().game!;
    // Out in the first year: the engine has already moved the state on to the next.
    const ended = withCompany(atTurn(live, 13), HUMAN, { out: { turn: 12, reason: "fired", users: 0, headcount: 0 } });
    storage.setItem(CAREER_SAVE_KEY, serializeCareerSave({ seed: 7, game: ended, draft: career.getState().draft!, lastLog: null, reportOpen: false, record: [] }));
    const s = store(storage);
    expect(s.getState()).toMatchObject({ mode: null, resumable: { race: 1, career: { turn: 12, over: true } } });
    s.getState().resume("career");
    expect(s.getState()).toMatchObject({ mode: "career", over: true });
    s.getState().leave();
    expect(s.getState().resumable.career).toEqual({ turn: 12, over: true });
  });

  it("removes a career save it refuses, and preselects Career", () => {
    const storage = new MemoryStorage();
    storage.setItem(CAREER_SAVE_KEY, "{ not json");
    expect(store(storage).getState()).toMatchObject({ mode: null, preferred: "career" });
    expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
  });

  it("preselects the mode just left", () => {
    const s = store(new MemoryStorage());
    // A fresh first screen preselects Career (the owner's decision, 25 November 2026).
    expect(s.getState().preferred).toBe("career");
    s.getState().startCareer("Acme", 7);
    s.getState().abandon();
    expect(s.getState().preferred).toBe("career");
    s.getState().startGame("Acme", 11);
    s.getState().abandon();
    expect(s.getState().preferred).toBe("race");
  });
});
