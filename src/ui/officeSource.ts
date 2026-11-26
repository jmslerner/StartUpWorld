/**
 * The store as the office's scene source: the player's office for the plan being drafted, with the hires it expects.
 *
 * The scene is rebuilt only when the game, the draft, the config or the seed changed, and a rebuilt scene equal to the
 * last one is the last one, so the world redraws only when something in the office changed. While a year plays out
 * the store's changes are not shown: the screen shows the year's beats one after another, then the new year.
 */

import type { StoreApi } from "zustand";
import type { CompanyId, GameState, Plan } from "../engine/index";
import { officeSceneFor, sameOfficeScene } from "../scene/officeScene";
import { beatScenes, type YearPlayback } from "../scene/yearPlayback";
import type { GameStore } from "../state/gameStore";
import { PLAYER_ID } from "../state/player";
import type { SceneSource } from "../world/mountWorld";
import type { OfficeScene } from "../world/types/scene";
import { planningView } from "./viewModel";

export interface OfficeSource extends SceneSource {
  /** Called just before the year ends: the scene shown now is kept as the year's start, and from now on the store's
   *  changes tell nobody and get() keeps returning the scene shown, until a beat is shown. */
  startPlay(): void;
  /** index: show beatScenes(start, the new year, playback)[index], telling listeners if it differs from the scene shown.
   *  null: stop playing and show the new year as it stands (with next year's expected hires), telling them once. */
  showBeat(playback: YearPlayback, index: number | null): void;
  readonly playing: boolean;
}

const NO_CAREER = "the office needs a career in play";

interface Inputs {
  readonly game: GameState | null;
  readonly draft: Plan | null;
  readonly config: GameStore["config"];
  readonly seed: number | null;
}

export const createOfficeSource = (store: StoreApi<GameStore>, companyId: CompanyId = PLAYER_ID): OfficeSource => {
  /** What the last scene was built from, by reference. */
  let inputs: Inputs | null = null;
  /** The last scene built from the store. */
  let built: OfficeScene | null = null;
  /** The scene the source shows: the store's, or a beat's while a year plays out. */
  let shown: OfficeScene | null = null;
  /** The scene shown when the year ended, while it plays out. */
  let start: OfficeScene | null = null;
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;

  /** The store's scene now, the same object while nothing in it changed. */
  const current = (): OfficeScene => {
    const { game, draft, config, seed } = store.getState();
    if (inputs !== null && built !== null && inputs.game === game && inputs.draft === draft && inputs.config === config && inputs.seed === seed) {
      return built;
    }
    if (game === null || seed === null || config.career === undefined || game.companies[companyId]?.career === undefined) {
      if (built !== null) return built;
      throw new Error(NO_CAREER);
    }
    const scene = officeSceneFor({
      game,
      companyId,
      config,
      seed,
      ...(draft !== null ? { draft, expectedHires: planningView(game, draft, config).hiring.expected } : {}),
    });
    inputs = { game, draft, config, seed };
    built = built !== null && sameOfficeScene(built, scene) ? built : scene;
    return built;
  };

  /** Shows `scene`, telling every listener when it is another object than the one shown. */
  const show = (scene: OfficeScene): void => {
    if (scene === shown) return;
    shown = scene;
    for (const listener of [...listeners]) listener();
  };

  const stop = (): void => {
    start = null;
    show(current());
  };

  return {
    get: () => {
      if (start === null || shown === null) shown = current();
      return shown;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (unsubscribe === null) {
        if (shown === null && store.getState().game !== null) {
          try {
            shown = current();
          } catch {
            // No career yet: nothing has been shown, so the first scene made is news.
          }
        }
        unsubscribe = store.subscribe(() => {
          if (start !== null) return;
          try {
            show(current());
          } catch {
            // A store with no career and no scene made yet: there is nothing to show.
          }
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribe !== null) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    startPlay: () => {
      if (start !== null) return;
      shown = current();
      start = shown;
    },
    showBeat: (playback, index) => {
      if (start === null) {
        stop();
        return;
      }
      const scene = index === null ? undefined : beatScenes(start, current(), playback)[index];
      if (scene === undefined) {
        stop();
        return;
      }
      if (shown === null || !sameOfficeScene(scene, shown)) show(scene);
    },
    get playing() {
      return start !== null;
    },
  };
};
