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
/** A draft for 1990 that hires: one person moved from Product to Recruiting. */
const hiring = (store: ReturnType<typeof career>) => {
  const { allocation } = store.getState().draft!;
  store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, recruiting: allocation.recruiting + 1 } });
  const { game, draft, config } = store.getState();
  // The precondition: this year's plan wants hires. (The projection expects none in 1990, the rivals' hype outbidding
  // the player's, yet the year does hire: the test below checks that on the year's report.)
  expect(planningView(game!, draft!, config).hiring.wanted).toBeGreaterThan(0);
};

describe("the office scene from the store", () => {
  it("shows the player's office for the plan being drafted, with the hires it expects", () => {
    const store = career();
    const { game, draft, config, seed } = store.getState();
    expect(createOfficeSource(store).get()).toEqual(
      officeSceneFor({
        game: game!,
        companyId: PLAYER_ID,
        config,
        seed: seed!,
        draft: draft!,
        expectedHires: planningView(game!, draft!, config).hiring.expected,
      }),
    );
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
    hiring(store);
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
    expect(hires).toBeGreaterThan(0); // the precondition: 1990 hired someone
    const { game, draft, config, seed } = store.getState();
    const next = officeSceneFor({
      game: game!,
      companyId: PLAYER_ID,
      config,
      seed: seed!,
      draft: draft!,
      expectedHires: planningView(game!, draft!, config).hiring.expected,
    });
    playback.beats.forEach((_, i) => {
      source.showBeat(playback, i);
      expect(source.get()).toEqual(beatScenes(start, next, playback)[i]);
    });
    expect(source.get().arriving).toBe(0); // the arrive beat: hires at their desks
    source.showBeat(playback, null);
    expect([source.get(), source.playing]).toEqual([next, false]);
    expect(source.get().arriving).toBe(planningView(game!, draft!, config).hiring.expected);
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
