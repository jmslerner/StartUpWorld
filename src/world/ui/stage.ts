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

export interface Stage {
  store: StoreApi<StageState>;
  anchor: AnchorChannel;
  /**
   * Select a target (or clear the selection with null) from the React side:
   * updates the store, the world's highlight and the anchor in one step.
   */
  select(target: InteractableTarget | null): void;
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

export const INITIAL_STAGE_STATE: StageState = {
  status: "starting",
  handle: null,
  hover: null,
  selected: null,
  size: { width: 0, height: 0 },
};

export const createStage = (): Stage => {
  const store = createStore<StageState>(() => INITIAL_STAGE_STATE);
  const anchor = createAnchorChannel();
  return {
    store,
    anchor,
    select: (target) => {
      const { handle } = store.getState();
      handle?.setSelected(target);
      store.setState({ selected: target });
      anchor.set(target && handle ? handle.project(target) : null);
    },
  };
};
