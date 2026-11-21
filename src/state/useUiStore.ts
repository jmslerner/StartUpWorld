import { create } from "zustand";

/**
 * UI-only state shared between the terminal and the 3D world. Nothing in here
 * is game state: it never reaches the engine or the save file.
 */

const WORLD_ENABLED_KEY = "startupworld:world:enabled";
const WORLD_HINT_KEY = "startupworld:world:hint-seen";

/** localStorage can throw (private browsing, blocked storage, no window in tests). */
const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
};

const writeFlag = (key: string, value: boolean): void => {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // The preference simply lasts for this session.
  }
};

/**
 * A request to put text into the terminal input. `nonce` makes two requests for
 * the same text distinct, so clicking "Ship a feature…" twice refocuses twice.
 */
export interface PrefillRequest {
  text: string;
  nonce: number;
}

interface UiStore {
  /** Latest terminal prefill request; TerminalInput consumes it via `subscribe`. */
  prefill: PrefillRequest | null;
  /** Put `text` in the terminal input, focus it and place the caret at the end. */
  requestPrefill: (text: string) => void;

  /** The player's "3D" toggle. Persisted. */
  worldEnabled: boolean;
  toggleWorld: () => void;

  /**
   * The 3D view tried to start and could not (no WebGL 2). Session-only, so a
   * reload retries. The shell uses it to give the space back to the terminal.
   */
  worldUnsupported: boolean;
  setWorldUnsupported: (unsupported: boolean) => void;

  /** The "click anything · drag to pan" hint has done its job. Persisted. */
  worldHintSeen: boolean;
  dismissWorldHint: () => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  prefill: null,
  requestPrefill: (text) => set((current) => ({ prefill: { text, nonce: (current.prefill?.nonce ?? 0) + 1 } })),

  worldEnabled: readFlag(WORLD_ENABLED_KEY, true),
  toggleWorld: () => {
    const worldEnabled = !get().worldEnabled;
    writeFlag(WORLD_ENABLED_KEY, worldEnabled);
    set({ worldEnabled });
  },

  worldUnsupported: false,
  setWorldUnsupported: (worldUnsupported) => {
    if (get().worldUnsupported !== worldUnsupported) set({ worldUnsupported });
  },

  worldHintSeen: readFlag(WORLD_HINT_KEY, false),
  dismissWorldHint: () => {
    if (get().worldHintSeen) return;
    writeFlag(WORLD_HINT_KEY, true);
    set({ worldHintSeen: true });
  },
}));
