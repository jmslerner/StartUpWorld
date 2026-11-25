// The app's state: the game in progress, the plan being edited and last quarter's report.
// All rules live in the engine; this file only moves the game along and keeps it saved.

import { createStore, type StoreApi } from "zustand/vanilla";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CONFIG, type GameConfig } from "../config";
import { defaultPlan } from "../engine/plan";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { GameState, Plan, TurnLog } from "../engine/types";
import { PLAYER_ID } from "./player";
import { SAVE_KEY, parseSave, serializeSave } from "./save";

export { PLAYER_ID };


export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameStore {
  readonly seed: number | null;
  /** null = no game in progress: the new-game screen. */
  readonly game: GameState | null;
  /** The plan being edited for the coming quarter. */
  readonly draft: Plan | null;
  readonly lastLog: TurnLog | null;
  readonly reportOpen: boolean;
  /** The player's game has ended: someone won, or their own company is out. */
  readonly over: boolean;
  /** What went wrong ending a quarter, if anything did. The app shows its crash screen for it. */
  readonly failure: Error | null;
  startGame(name: string, seed: number): void;
  setDraft(patch: Partial<Plan>): void;
  endQuarter(): void;
  closeReport(): void;
  /** Show last quarter's report again. */
  openReport(): void;
  /** Drop the game and go back to the new-game screen. */
  abandon(): void;
}

const isOver = (game: GameState | null): boolean => game !== null && (game.outcome !== null || game.companies[PLAYER_ID].out !== null);

export const createGameStore = (storage: StorageLike | null, config: GameConfig = CONFIG): StoreApi<GameStore> => {
  // Read the save once, synchronously, before anything renders or writes.
  let saved = null;
  try {
    saved = storage ? parseSave(storage.getItem(SAVE_KEY), config) : null;
  } catch {
    saved = null;
  }

  const store = createStore<GameStore>()((set, get) => ({
    seed: saved?.seed ?? null,
    game: saved?.game ?? null,
    draft: saved?.draft ?? null,
    lastLog: saved?.lastLog ?? null,
    reportOpen: saved?.reportOpen ?? false,
    over: isOver(saved?.game ?? null),
    failure: null,

    startGame: (name, seed) => {
      const game = createGame(newGameSetup(seed, name), config);
      set({ seed, game, draft: defaultPlan(game.companies[PLAYER_ID]), lastLog: null, reportOpen: false, over: false, failure: null });
    },

    setDraft: (patch) => {
      const { draft } = get();
      if (draft !== null) set({ draft: { ...draft, ...patch } });
    },

    endQuarter: () => {
      const { game, draft, seed, over } = get();
      if (game === null || draft === null || seed === null || over) return;
      const human: (Plan | null)[] = game.companies.map((company) => (company.id === PLAYER_ID ? draft : null));
      let result;
      try {
        result = resolveTurn(game, choosePlans(game, seed, config, human), seed, config);
      } catch (error) {
        // Thrown from a click, an error would reach nobody and leave a button that does nothing.
        set({ failure: error instanceof Error ? error : new Error(String(error)) });
        return;
      }
      set({
        game: result.state,
        // Default: last turn's split, refitted to the team the player now has.
        draft: defaultPlan(result.state.companies[PLAYER_ID]),
        lastLog: result.log,
        reportOpen: true,
        over: isOver(result.state),
      });
    },

    closeReport: () => set({ reportOpen: false }),

    openReport: () => {
      if (get().lastLog !== null) set({ reportOpen: true });
    },

    abandon: () => set({ seed: null, game: null, draft: null, lastLog: null, reportOpen: false, over: false, failure: null }),
  }));

  if (storage) {
    store.subscribe((state) => {
      try {
        if (state.game === null || state.draft === null || state.seed === null) storage.removeItem(SAVE_KEY);
        else storage.setItem(SAVE_KEY, serializeSave({ seed: state.seed, game: state.game, draft: state.draft, lastLog: state.lastLog, reportOpen: state.reportOpen }));
      } catch {
        // Private mode or a full disk: the game goes on, it just is not saved.
      }
    });
  }
  return store;
};
