// The one game store the app runs on, and the hook the screens read it with.

import { useStore } from "zustand";
import { createGameStore, type GameStore, type StorageLike } from "./gameStore";

/** The browser's storage, or null where it is blocked: the game still plays, it just is not saved. */
export const browserStorage = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const gameStore = createGameStore(browserStorage());

/** Select state straight from the store (a stored value or an action), never a freshly built object. */
export const useGame = <T>(selector: (state: GameStore) => T): T => useStore(gameStore, selector);
