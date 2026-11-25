// The app's state: the game in progress, the plan being edited and last year's or quarter's report.
// All rules live in the engine; this file only moves the game along and keeps it saved.
//
// Two modes, two saves: the race under SAVE_KEY, the career under CAREER_SAVE_KEY. One game is in play
// at a time, and each mode writes and removes only its own key, so a save of the other mode stays on
// disk for the first screen to offer.

import { createStore, type StoreApi } from "zustand/vanilla";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CAREER, CONFIG, type PlayConfig } from "../config";
import { CAREER_PITCHES } from "../engine/cast";
import { defaultPlan } from "../engine/plan";
import { resolveTurn } from "../engine/resolveTurn";
import { createGame } from "../engine/setup";
import type { GameState, Plan, TurnLog } from "../engine/types";
import { milestonesOf, type CareerRecord } from "./careerRecord";
import { CAREER_SAVE_KEY, parseCareerSave, serializeCareerSave, type SavedCareer } from "./careerSave";
import { PLAYER_ID } from "./player";
import { SAVE_KEY, parseSave, serializeSave } from "./save";

export { PLAYER_ID };

export type Mode = "race" | "career";


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
  /** Drop the game, delete its save and go back to the new-game screen. */
  abandon(): void;
  /** null with no game; otherwise the mode the game in progress is played in. */
  readonly mode: Mode | null;
  /** The config of the game in progress; the race's when there is none. */
  readonly config: PlayConfig;
  readonly configs: { readonly race: PlayConfig; readonly career: PlayConfig };
  /** The career's milestones by year; [] in a race. */
  readonly record: CareerRecord;
  /** The turn of a save on disk the first screen can resume, by mode; null for none, and always null for the mode in play. */
  readonly resumable: { readonly race: number | null; readonly career: number | null };
  /** The mode the first screen preselects: Career on a fresh first screen, else the mode just left. */
  readonly preferred: Mode;
  startCareer(name: string, seed: number): void;
  /** Load that mode's save and play it; a save that no longer parses is removed and its `resumable` set to null. */
  resume(mode: Mode): void;
  /** Back to the first screen, keeping the game's save to resume later. `abandon` is the one that deletes it. */
  leave(): void;
}

const isOver = (game: GameState | null): boolean => game !== null && (game.outcome !== null || game.companies[PLAYER_ID].out !== null);

const KEYS: Readonly<Record<Mode, string>> = { race: SAVE_KEY, career: CAREER_SAVE_KEY };

type Resumable = GameStore["resumable"];

/** No game in play: the new-game screen. */
const NO_GAME = { seed: null, game: null, draft: null, lastLog: null, reportOpen: false, over: false, failure: null, mode: null, record: [] } as const;

export const createGameStore = (storage: StorageLike | null, config: PlayConfig = CONFIG, careerConfig: PlayConfig = CAREER): StoreApi<GameStore> => {
  const configs = { race: config, career: careerConfig } as const;

  const readKey = (mode: Mode): string | null => {
    try {
      return storage ? storage.getItem(KEYS[mode]) : null;
    } catch {
      return null;
    }
  };
  const removeKey = (mode: Mode): void => {
    try {
      storage?.removeItem(KEYS[mode]);
    } catch {
      // Storage is blocked: there is nothing more to do.
    }
  };
  /** That mode's save as the store plays it: a race's with an empty record. */
  const load = (mode: Mode): SavedCareer | null => {
    const raw = readKey(mode);
    if (mode === "career") return parseCareerSave(raw, careerConfig);
    const race = parseSave(raw, config);
    return race && { ...race, record: [] };
  };
  /** The state that plays a save. */
  const playing = (mode: Mode, saved: SavedCareer) => ({ ...saved, over: isOver(saved.game), failure: null, mode, config: configs[mode] });

  // Read both saves once, synchronously, before anything renders or writes.
  const race = load("race");
  const careerPresent = readKey("career") !== null;
  const career = load("career");
  // A career save this build refuses is removed now, so it is not offered again.
  if (careerPresent && career === null) removeKey("career");
  const only = race !== null && career === null ? "race" : career !== null && race === null ? "career" : null;
  const initial =
    only === "race" ? playing("race", race!) : only === "career" ? playing("career", career!) : { ...NO_GAME, config };
  const resumable: Resumable = {
    race: race !== null && only !== "race" ? race.game.turn : null,
    career: career !== null && only !== "career" ? career.game.turn : null,
  };

  const store = createStore<GameStore>()((set, get) => {
    /** What the first screen can resume once the game in play makes way for one of `next`'s mode (or none). */
    const resumableAfter = (next: Mode | null): Resumable => {
      const { mode, game, resumable } = get();
      const kept = mode !== null && game !== null && mode !== next ? { ...resumable, [mode]: game.turn } : resumable;
      return next === null ? kept : { ...kept, [next]: null };
    };

    const start = (mode: Mode, name: string, seed: number) => {
      const game =
        mode === "career" ? createGame(newGameSetup(seed, name, "human", CAREER_PITCHES), careerConfig) : createGame(newGameSetup(seed, name), config);
      set({
        seed,
        game,
        draft: defaultPlan(game.companies[PLAYER_ID]),
        lastLog: null,
        reportOpen: false,
        over: false,
        failure: null,
        mode,
        config: configs[mode],
        record: [],
        resumable: resumableAfter(mode),
      });
    };

    return {
      ...initial,
      configs,
      resumable,
      preferred: "career",

      startGame: (name, seed) => start("race", name, seed),

      startCareer: (name, seed) => start("career", name, seed),

      setDraft: (patch) => {
        const { draft } = get();
        if (draft !== null) set({ draft: { ...draft, ...patch } });
      },

      endQuarter: () => {
        const { game, draft, seed, over, mode, config: active, record } = get();
        if (game === null || draft === null || seed === null || over) return;
        const human: (Plan | null)[] = game.companies.map((company) => (company.id === PLAYER_ID ? draft : null));
        let result;
        try {
          result = resolveTurn(game, choosePlans(game, seed, active, human), seed, active);
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
          // A career's first failure is a rescue and leaves the player in: over only on the second, or after the last year.
          over: isOver(result.state),
          record: mode === "career" ? [...record, ...milestonesOf(game, result.log, result.state)] : record,
        });
      },

      closeReport: () => set({ reportOpen: false }),

      openReport: () => {
        if (get().lastLog !== null) set({ reportOpen: true });
      },

      abandon: () => {
        const { mode, preferred } = get();
        if (mode !== null) removeKey(mode);
        set({ ...NO_GAME, config, preferred: mode ?? preferred });
      },

      leave: () => {
        const { mode, preferred } = get();
        set({ ...NO_GAME, config, preferred: mode ?? preferred, resumable: resumableAfter(null) });
      },

      resume: (mode) => {
        const saved = load(mode);
        if (saved === null) {
          removeKey(mode);
          set({ resumable: { ...get().resumable, [mode]: null } });
          return;
        }
        set({ ...playing(mode, saved), resumable: resumableAfter(mode) });
      },
    };
  });

  if (storage) {
    store.subscribe((state) => {
      // With no game in play nothing is written or removed: abandon removes its own key, and a save of the other mode stays.
      if (state.game === null || state.draft === null || state.seed === null || state.mode === null) return;
      try {
        const save = { seed: state.seed, game: state.game, draft: state.draft, lastLog: state.lastLog, reportOpen: state.reportOpen };
        if (state.mode === "career") storage.setItem(CAREER_SAVE_KEY, serializeCareerSave({ ...save, record: state.record }));
        else storage.setItem(SAVE_KEY, serializeSave(save));
      } catch {
        // Private mode or a full disk: the game goes on, it just is not saved.
      }
    });
  }
  return store;
};
