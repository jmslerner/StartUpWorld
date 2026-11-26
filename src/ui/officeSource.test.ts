import { describe, expect, it, vi } from "vitest";
import { beatScenes, yearPlayback } from "../scene/yearPlayback";
import { officeSceneFor } from "../scene/officeScene";
import { createGameStore } from "../state/gameStore";
import { PLAYER_ID } from "../state/player";
import { createOfficeSource } from "./officeSource";
import { planningView } from "./viewModel";

const career = () => {
  const store = createGameStore(null);
  store.getState().startCareer("Test", 1);
  return store;
};
/** Moves one person from Product to Recruiting in the plan being drafted. */
const moveToRecruiting = (store: ReturnType<typeof career>) => {
  const { allocation } = store.getState().draft!;
  store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, recruiting: allocation.recruiting + 1 } });
};
/** Ends the year shown and closes its report. */
const endYear = (store: ReturnType<typeof career>) => {
  store.getState().endQuarter();
  store.getState().closeReport();
};
/** A draft that hires: one person moved from Product to Recruiting. */
const hiring = (store: ReturnType<typeof career>) => {
  moveToRecruiting(store);
  const { game, draft, config } = store.getState();
  // The precondition: this year's plan wants hires. (The projection expects none in 1990 or 1991, the rivals' hype
  // outbidding the player's, yet the year does hire: the tests below check that on the year's report.)
  expect(planningView(game!, draft!, config).hiring.wanted).toBeGreaterThan(0);
};
/** The hires the plan being drafted expects. */
const expectedHires = (store: ReturnType<typeof career>) => {
  const { game, draft, config } = store.getState();
  return planningView(game!, draft!, config).hiring.expected;
};

describe("the office scene from the store", () => {
  it("shows the player's office for the plan being drafted, with the hires it expects", () => {
    const store = career();
    endYear(store);
    endYear(store);
    moveToRecruiting(store);
    const expected = expectedHires(store);
    expect(expected).toBeGreaterThan(0); // the precondition: 1992's plan expects hires (3 with seed 1)
    const { game, draft, config, seed } = store.getState();
    expect(createOfficeSource(store).get()).toEqual(
      officeSceneFor({
        game: game!,
        companyId: PLAYER_ID,
        config,
        seed: seed!,
        draft: draft!,
        expectedHires: expected,
      }),
    );
    expect(createOfficeSource(store).get().arriving).toBe(expected);
  });

  it("a change that changes nothing in the office keeps the same scene and tells nobody", () => {
    const store = career();
    const source = createOfficeSource(store);
    const told = vi.fn();
    source.subscribe(told);
    const before = source.get();
    store.getState().setDraft({ price: store.getState().draft!.price });
    expect(source.get()).toBe(before);
    expect(told).not.toHaveBeenCalled();
  });

  it("moving a person tells the listener once, with a new scene", () => {
    const store = career();
    const source = createOfficeSource(store);
    const told = vi.fn();
    source.subscribe(told);
    const { allocation } = store.getState().draft!;
    store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, growth: allocation.growth + 1 } });
    expect(told).toHaveBeenCalledTimes(1);
    expect(source.get().teams.growth).toBe(allocation.growth + 1);
  });

  it("while a year plays out the source shows its beats in turn, and next year's hires only at the end", () => {
    const store = career();
    endYear(store);
    hiring(store); // 1991 hires, and 1992's plan, the same people in Recruiting, expects hires too
    const source = createOfficeSource(store);
    const told = vi.fn();
    source.subscribe(told);
    const start = source.get();
    source.startPlay();
    store.getState().endQuarter();
    expect(source.get()).toBe(start);
    expect(told).not.toHaveBeenCalled();
    const playback = yearPlayback(store.getState().lastLog!.companies[PLAYER_ID]!, false);
    const hires = playback.beats.find((b) => b.kind === "arrive")?.count ?? 0;
    expect(hires).toBeGreaterThan(0); // the precondition: 1991 hired someone
    const expected = expectedHires(store);
    expect(expected).toBeGreaterThan(0); // the precondition: 1992's plan expects hires
    const { game, draft, config, seed } = store.getState();
    const next = officeSceneFor({
      game: game!,
      companyId: PLAYER_ID,
      config,
      seed: seed!,
      draft: draft!,
      expectedHires: expected,
    });
    playback.beats.forEach((_, i) => {
      source.showBeat(playback, i);
      expect(source.get()).toEqual(beatScenes(start, next, playback)[i]);
      if (playback.beats[i]!.kind === "arrive") expect(source.get().arriving).toBe(0); // the arrive beat: hires at their desks
    });
    expect(playback.beats.at(-1)!.kind).toBe("arrive");
    expect(source.get().arriving).toBe(0); // the last beat shown, the arrive beat: no one waiting yet
    source.showBeat(playback, null);
    expect([source.get(), source.playing]).toEqual([next, false]);
    expect(source.get().arriving).toBe(expected); // next year's hires, only now
  });

  it("a source made while a report is open is not playing (Review Focus 3)", () => {
    const store = career();
    store.getState().endQuarter();
    expect(store.getState().reportOpen).toBe(true);
    expect(createOfficeSource(store).playing).toBe(false);
  });

  it("a race has no office; a source that showed a career keeps its last scene after the game is left", () => {
    const race = createGameStore(null);
    race.getState().startGame("Test", 1);
    expect(() => createOfficeSource(race).get()).toThrow("the office needs a career in play");
    const store = career();
    const source = createOfficeSource(store);
    const last = source.get();
    store.getState().leave();
    expect(source.get()).toBe(last);
  });

  it("a store change while playing is shown once, when the playing stops; a beat out of range or while not playing stops it", () => {
    const store = career();
    hiring(store);
    const source = createOfficeSource(store);
    const told = vi.fn();
    source.subscribe(told);
    source.startPlay();
    store.getState().endQuarter();
    const playback = yearPlayback(store.getState().lastLog!.companies[PLAYER_ID]!, false);
    source.showBeat(playback, playback.beats.length - 1);
    const calls = told.mock.calls.length;
    const { allocation } = store.getState().draft!;
    store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, growth: allocation.growth + 1 } });
    expect(told).toHaveBeenCalledTimes(calls);
    source.showBeat(playback, playback.beats.length);
    expect(source.playing).toBe(false);
    expect(told).toHaveBeenCalledTimes(calls + 1);
    expect(source.get().teams.growth).toBe(allocation.growth + 1);
    source.showBeat(playback, 0);
    expect(source.playing).toBe(false);
    expect(told).toHaveBeenCalledTimes(calls + 1);
  });

  it("stops listening to the store when told to", () => {
    const store = career();
    const source = createOfficeSource(store);
    const told = vi.fn();
    source.subscribe(told)();
    store.getState().endQuarter();
    expect(told).not.toHaveBeenCalled();
  });
});
