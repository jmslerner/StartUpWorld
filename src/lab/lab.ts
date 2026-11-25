/**
 * The lab page's own small store: the scene being shown, the page's switches, and what the 3D view last said of
 * itself. It is also the view's scene source and what the browser checks reach through `window.__officeLab`.
 *
 * Nothing of the game is in here, neither its state nor its store, and no three.js: from the world this file takes
 * types only, so the page can be on screen before the world's code has loaded.
 */
import type { SceneSource, WorldViewState } from "../world/mountWorld";
import type { WorldHandle, WorldStats } from "../world/types/handle";
import type { OfficeIndex, OfficeScene } from "../world/types/scene";
import type { StageStatus } from "../world/ui/stage";
import { editScene, endYear, labOptionsFromQuery, queryFromLab, sameScene, sceneFromQuery, type SceneEdit } from "./labScene";

/**
 * How the view stands: what the view itself reports, and two things only the page knows: "off" while the page
 * does not show the view at all, and "failed" when the view's code could not load or broke while drawing.
 */
export type LabStatus = StageStatus | "off" | "failed";

export interface LabState {
  readonly scene: OfficeScene;
  /** The office follows the head count (true), or stays the one chosen (false). */
  readonly fitOffice: boolean;
  /** The controls are on the page. */
  readonly panelOpen: boolean;
  /** The view is kept drawing, for looking at idle movement. */
  readonly keepAwake: boolean;
  /** The page shows the 3D view. */
  readonly shown: boolean;
  readonly status: LabStatus;
}

/** The renderer's figures, with the two the page adds. Every number is 0 before a world has existed. */
export interface LabStats extends WorldStats {
  readonly status: LabStatus;
  /** Frames drawn in the last second, as far as the page's samples go back. */
  readonly framesLastSecond: number;
}

/** What `window.__officeLab` gives the browser checks. */
export interface OfficeLabApi {
  /** Resolves when the view first runs, or first says that it cannot ("unsupported", "failed"). */
  readonly ready: Promise<void>;
  /** Show this scene, exactly as given. The office in it is kept, whatever the head count. */
  setScene(scene: OfficeScene): void;
  /** The scene being shown. */
  scene(): OfficeScene;
  /** The figures of the live world; once it is taken down, those of the last world there was. */
  stats(): LabStats;
  /** Take the live world's graphics context away, and give it back. Nothing happens without a live world. */
  loseContext(): void;
  restoreContext(): void;
  /** Put the view on the page. Resolves once it runs or says that it cannot. */
  mount(): Promise<void>;
  /** Take the view off the page. Resolves once its world is torn down. */
  unmount(): Promise<void>;
}

export interface Lab {
  /** The view's scene source: one object for as long as the lab lives. */
  readonly source: SceneSource;
  readonly api: OfficeLabApi;
  getState(): LabState;
  /** Told after every change of the state. Returns its undoing. */
  subscribe(listener: () => void): () => void;
  edit(edit: SceneEdit): void;
  /** Force an office, or let the head count decide ("fit"). */
  setOffice(office: OfficeIndex | "fit"): void;
  endYear(): void;
  /** Back to the scene the page was opened with. */
  reset(): void;
  setScene(scene: OfficeScene): void;
  setKeepAwake(on: boolean): void;
  setPanelOpen(open: boolean): void;
  setShown(shown: boolean): void;
  /** What the view reports through its `onState`. */
  viewState(view: WorldViewState): void;
  /** The view's code did not load, or broke while drawing. */
  viewFailed(): void;
  /** Note how many frames the world has drawn by now. The page calls it a few times a second. */
  sample(): void;
  stats(): LabStats;
  /** The page's address for its state: the scene, then what else differs from the usual. */
  query(): string;
}

export interface FrameSample {
  readonly at: number;
  readonly frames: number;
}

const SECOND = 1000;
/** Samples older than this are dropped. */
const KEPT = 2 * SECOND;
const NO_STATS: WorldStats = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0, figures: 0, hidden: 0, framesDrawn: 0 };
const LISTENER_FAILED = "[lab] A listener of the lab failed; the others were still told.";

/**
 * Frames drawn in the second before `now`, given the count `current` and earlier samples in the order they were
 * taken: counted from the newest sample that is at least a second old, or from the oldest while none is.
 */
export const framesSince = (samples: readonly FrameSample[], now: number, current: number): number => {
  if (samples.length === 0) return 0;
  let from = samples[0];
  for (const sample of samples) {
    if (sample.at <= now - SECOND) from = sample;
  }
  return Math.max(0, current - from.frames);
};

/** The view has said something final for now: it runs, or it cannot. */
const settled = (status: LabStatus): boolean => status !== "starting" && status !== "off";

/**
 * A lab for the page opened at `query`. `now` is the page's clock in milliseconds; it is only used to count the
 * frames of the last second.
 */
export const createLab = (query: string, now: () => number): Lab => {
  const options = labOptionsFromQuery(query);
  const opened = editScene(sceneFromQuery(query), {}, options.fitOffice);

  let state: LabState = { scene: opened, fitOffice: options.fitOffice, panelOpen: options.panelOpen, keepAwake: false, shown: true, status: "starting" };
  const listeners = new Set<() => void>();
  /** The live world, and the last one there was: its figures can still be read once it is torn down. */
  let handle: WorldHandle | null = null;
  let lastHandle: WorldHandle | null = null;
  let samples: FrameSample[] = [];

  const set = (patch: Partial<LabState>): void => {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof LabState)[]).every((key) => next[key] === state[key])) return;
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(LISTENER_FAILED, error);
      }
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    // Each subscription is its own entry, so the same function given twice is told twice and undone one at a time.
    const entry = (): void => listener();
    listeners.add(entry);
    return () => void listeners.delete(entry);
  };

  /** Resolves as soon as the state passes `test`: now, or after some change. */
  const when = (test: (state: LabState) => boolean): Promise<void> =>
    new Promise((resolve) => {
      if (test(state)) return resolve();
      const stop = subscribe(() => {
        if (!test(state)) return;
        stop();
        resolve();
      });
    });

  const stats = (): LabStats => {
    const world = (handle ?? lastHandle)?.stats() ?? NO_STATS;
    // Samples are dropped whenever the world goes or changes, so a world that is gone counts no frames.
    return { ...world, status: state.status, framesLastSecond: framesSince(samples, now(), world.framesDrawn) };
  };

  const setShown = (shown: boolean): void => {
    if (shown === state.shown) return;
    // Taken down with a world still up, the view says so itself in a moment (see viewState). With none, nobody will.
    set(shown ? { shown, status: "starting" } : { shown, status: handle ? state.status : "off" });
  };

  const setScene = (scene: OfficeScene): void => set({ scene: { ...scene }, fitOffice: false });

  // Asked from the first moment, so that a view which is up before anyone looks is not missed.
  const ready = when((current) => settled(current.status));

  return {
    source: { get: () => state.scene, subscribe },
    getState: () => state,
    subscribe,
    edit: (edit) => {
      const next = editScene(state.scene, edit, state.fitOffice);
      // The same numbers typed again are no change: the view is not woken for them.
      if (!sameScene(next, state.scene)) set({ scene: next });
    },
    setOffice: (office) =>
      set(office === "fit" ? { fitOffice: true, scene: editScene(state.scene, {}, true) } : { fitOffice: false, scene: editScene(state.scene, { office }, false) }),
    endYear: () => set({ scene: endYear(state.scene) }),
    reset: () => set({ scene: { ...opened }, fitOffice: options.fitOffice }),
    setScene,
    setKeepAwake: (on) => {
      if (on === state.keepAwake) return;
      handle?.setKeepAwake(on);
      set({ keepAwake: on });
    },
    setPanelOpen: (open) => set({ panelOpen: open }),
    setShown,
    viewState: (view) => {
      if (view.handle !== handle) {
        handle = view.handle;
        // A new world counts its frames from nothing.
        samples = [];
        if (handle) {
          lastHandle = handle;
          if (state.keepAwake) handle.setKeepAwake(true);
        }
      }
      // A view that is being taken down goes back to "starting, no world": for the page that is "off", and for a
      // view that failed it is still "failed" (its error boundary may say so before or after the view goes).
      if (!view.handle && !state.shown) set({ status: "off" });
      else if (!view.handle && state.status === "failed") return;
      else set({ status: view.status });
    },
    viewFailed: () => {
      handle = null;
      samples = [];
      set({ status: "failed" });
    },
    sample: () => {
      if (!handle) return;
      const at = now();
      samples = [...samples.filter((sample) => sample.at > at - KEPT), { at, frames: handle.stats().framesDrawn }];
    },
    stats,
    query: () => queryFromLab(state.scene, state),
    api: {
      ready,
      setScene,
      scene: () => state.scene,
      stats,
      loseContext: () => handle?.loseContext(),
      restoreContext: () => handle?.restoreContext(),
      mount: () => {
        setShown(true);
        return when((current) => current.shown && settled(current.status));
      },
      unmount: () => {
        setShown(false);
        return when((current) => !current.shown && current.status === "off");
      },
    },
  };
};

/**
 * Keep an address in step with the lab: `write` is given the lab's query at once and after every change that
 * shows in it. A `write` that throws (a browser may refuse an address changed too often) is left at that.
 * Returns its undoing.
 */
export const followAddress = (lab: Lab, write: (query: string) => void): (() => void) => {
  let written: string | null = null;
  const follow = (): void => {
    const query = lab.query();
    if (query === written) return;
    written = query;
    try {
      write(query);
    } catch {
      // The address is a convenience; the lab does not depend on it.
    }
  };
  follow();
  return lab.subscribe(follow);
};
