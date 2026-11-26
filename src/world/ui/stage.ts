/**
 * Per-mount state of one 3D stage: the bridge between the imperative world
 * (three.js callbacks, a render loop) and the React overlay drawn on top of it.
 *
 * It is a tiny vanilla store rather than component state for two reasons:
 *   • the world's callbacks and the mount effect write to it from outside
 *     React's render flow, which is exactly what an external store is for;
 *   • overlay pieces subscribe to just the slice they draw, so a hover change
 *     re-renders the tooltip and nothing else.
 *
 * The selected target's screen position is deliberately NOT in the store: it
 * changes every frame while the camera moves, and the card follows it by
 * writing a CSS transform directly (see AnchorChannel).
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { InteractableHit, InteractableTarget, ScreenPoint, WorldHandle } from "../types";

export type StageStatus = "starting" | "running" | "unsupported" | "context-lost";

export interface StageSize {
  width: number;
  height: number;
}

export interface StageState {
  status: StageStatus;
  /** The live world, or null before it is created / after it is disposed. */
  handle: WorldHandle | null;
  hover: InteractableHit | null;
  selected: InteractableTarget | null;
  /** CSS size of the viewport (and of the canvas, which fills it). */
  size: StageSize;
}

/** Latest projected anchor of the selected target, pushed without going through React. */
export interface AnchorChannel {
  get(): ScreenPoint | null;
  set(point: ScreenPoint | null): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: (point: ScreenPoint | null) => void): () => void;
}

/**
 * Every tap on the view, the same target twice included, and a tap on nothing (null). The store's `selected` cannot
 * tell this: a target tapped again leaves it as it was.
 */
export interface TapChannel {
  tell(target: InteractableTarget | null): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: (target: InteractableTarget | null) => void): () => void;
}

export interface WorldStage {
  store: StoreApi<StageState>;
  anchor: AnchorChannel;
  /** Told of every tap the world reports, after the store has been updated. A reset keeps its listeners. */
  taps: TapChannel;
  /**
   * Select a target (or clear the selection with null) from the React side:
   * updates the store, the world's highlight and the anchor in one step.
   */
  select(target: InteractableTarget | null): void;
  /**
   * Back to the starting state, with no anchor: what a mount does when its world is torn down, so that the next
   * world on this stage starts from nothing. Listeners stay subscribed and are told.
   */
  reset(): void;
}

const createAnchorChannel = (): AnchorChannel => {
  let current: ScreenPoint | null = null;
  const listeners = new Set<(point: ScreenPoint | null) => void>();
  return {
    get: () => current,
    set: (point) => {
      current = point;
      for (const listener of listeners) listener(point);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const createTapChannel = (): TapChannel => {
  const listeners = new Set<(target: InteractableTarget | null) => void>();
  return {
    tell: (target) => {
      for (const listener of [...listeners]) {
        try {
          listener(target);
        } catch (error) {
          // One listener's failure must not keep the tap from the others, nor reach the world's pointer handling.
          console.error("[world] A tap listener failed.", error);
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const INITIAL_STAGE_STATE: StageState = Object.freeze({
  status: "starting",
  handle: null,
  hover: null,
  selected: null,
  size: Object.freeze({ width: 0, height: 0 }),
});

export const createStage = (): WorldStage => {
  const store = createStore<StageState>(() => INITIAL_STAGE_STATE);
  const anchor = createAnchorChannel();
  const taps = createTapChannel();
  return {
    store,
    anchor,
    taps,
    select: (target) => {
      const { handle } = store.getState();
      handle?.setSelected(target);
      store.setState({ selected: target });
      anchor.set(target && handle ? handle.project(target) : null);
    },
    reset: () => {
      anchor.set(null);
      store.setState(INITIAL_STAGE_STATE, true);
    },
  };
};
