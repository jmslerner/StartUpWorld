/**
 * The imperative half of WorldView: create a world on a canvas, keep it fed with scenes and sized to its viewport,
 * and tear all of it down again. Kept out of WorldView.tsx so that file holds only components, and so that all of
 * this can be tested (tests run on `.ts` files only).
 *
 * Everything here is imperative on purpose: the three.js side is driven by a subscription and DOM observers, never
 * by React renders, so a frame is never waiting on reconciliation and React never sees per-frame data.
 */
import { createWorld, inspectWorld, WorldUnsupportedError } from "./core/World";
import type { OfficeScene, WorldHandle } from "./types";
import { detectQuality, hasFinePointer, prefersReducedMotion } from "./ui/environment";
import { INITIAL_STAGE_STATE, type StageStatus, type WorldStage } from "./ui/stage";

/** Where the scenes come from: the one being shown now, and word of each change. `subscribe` returns its undoing. */
export interface SceneSource {
  get(): OfficeScene;
  subscribe(listener: () => void): () => void;
}

/** What somebody outside the view may know of it: how it stands, and the world itself while there is one. */
export interface WorldViewState {
  readonly status: StageStatus;
  /** The live world, or null before there is one, when there cannot be one, and once it is torn down. */
  readonly handle: WorldHandle | null;
}

const DEBUG_GLOBAL = "__startupWorld";
const START_FAILED = "[world] Could not start the 3D view.";
const TEARDOWN_FAILED = "[world] A step of taking the 3D view down failed; the rest was still done.";
const SCENE_FAILED = "[world] The 3D view could not show a scene; it keeps the one it has.";
const SECOND_WORLD =
  "[world] A 3D view was mounted while another was still up. Only one can exist at a time, so the earlier one was taken down.";

/**
 * The teardown of the mount whose world is alive, if one is. Only one world may exist at a time: the art kit's
 * caches belong to the module, and a world that is disposed empties them under any other.
 */
let liveTeardown: (() => void) | null = null;

/**
 * Create a world on `canvas`, keep it showing `source`'s scene and sized to `viewport`, and return the function
 * that tears all of it down again. The teardown may be called any number of times and never throws: every step of
 * it runs even when an earlier one fails (the failure is logged), and afterwards no listener, timer, observer or
 * frame request of this mount is left, and `stage` is back to its starting state.
 *
 * It never throws either. A device that cannot draw the world (no WebGL 2) leaves the stage's status at
 * "unsupported"; so does any other failure to start, after a line for the console.
 *
 * Mounting while an earlier mount's world is still alive takes that one down first, with a warning.
 */
export const mountWorld = (canvas: HTMLCanvasElement, viewport: HTMLElement, stage: WorldStage, source: SceneSource): (() => void) => {
  if (liveTeardown) {
    console.warn(SECOND_WORLD);
    liveTeardown();
  }

  const { store, anchor } = stage;
  /** False once this mount is torn down: whatever its world still reports after that is dropped. */
  let mounted = true;

  let handle: WorldHandle;
  try {
    // The device is read here, when a world is about to be made, and never when this module loads.
    const quality = detectQuality();
    const reducedMotion = prefersReducedMotion();
    // A finger has no hover: on a touch screen the last thing touched would stay marked as pointed at.
    const hovers = hasFinePointer();
    handle = createWorld(
      canvas,
      {
        onHover: (hit) => {
          if (mounted && hovers) store.setState({ hover: hit });
        },
        // The world has already highlighted the target itself; mirror it for whatever is drawn over the view.
        onSelect: (hit) => {
          if (!mounted) return;
          store.setState({ selected: hit?.target ?? null });
          anchor.set(hit?.screen ?? null);
        },
        onSelectedAnchorMove: (screen) => {
          if (mounted) anchor.set(screen);
        },
        onContextLost: () => {
          if (mounted) store.setState({ status: "context-lost", hover: null });
        },
        onContextRestored: () => {
          if (mounted) store.setState({ status: "running" });
        },
      },
      { quality, reducedMotion }
    );
  } catch (error) {
    // No WebGL 2 is an expected situation. Anything else is a bug worth a line; either way the page carries on.
    if (!(error instanceof WorldUnsupportedError)) console.error(START_FAILED, error);
    store.setState({ status: "unsupported" });
    return () => stage.reset();
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  // From here on each thing the mount creates registers how to undo it, and `teardown` undoes them in reverse
  // order: when the view unmounts, or at once if a later step of the mount throws (a scene the world cannot take,
  // an observer that fails), so a failed mount never leaks the render loop, the WebGL context or an observer.
  const undo: (() => void)[] = [];
  const teardown = (): void => {
    mounted = false;
    if (liveTeardown === teardown) liveTeardown = null;
    // Every step runs even if an earlier one throws. Popping makes a second call find nothing to do.
    for (let step = undo.pop(); step; step = undo.pop()) {
      try {
        step();
      } catch (error) {
        console.error(TEARDOWN_FAILED, error);
      }
    }
  };
  liveTeardown = teardown;
  // Registered first, so it runs last: the stage goes back to its starting state whatever else happened.
  undo.push(() => stage.reset());
  // Always a full dispose: it also frees the shared prop caches, so a world must never be kept alive across
  // unmounts (StrictMode, a reload after a lost context).
  undo.push(() => handle.dispose());

  try {
    store.setState({ status: "running", handle });
    // Development builds expose the live world for scripted checks and for the console; `import.meta.env.DEV` is a
    // compile-time false in production builds.
    if (import.meta.env.DEV) {
      Reflect.set(window, DEBUG_GLOBAL, { handle, stage, inspect: () => inspectWorld(handle) });
      undo.push(() => Reflect.deleteProperty(window, DEBUG_GLOBAL));
    }

    // ── Size ────────────────────────────────────────────────────────────────
    const applySize = (): void => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const current = store.getState().size;
      // A view sized to nothing (hidden, collapsed) keeps the size it had; so does one told its size again.
      if (!(width > 0) || !(height > 0) || (width === current.width && height === current.height)) return;
      handle.resize(width, height);
      store.setState({ size: { width, height } });
    };
    applySize();
    const resizeObserver = new ResizeObserver(applySize);
    undo.push(() => resizeObserver.disconnect());
    resizeObserver.observe(viewport);

    // ── Scenes → world ──────────────────────────────────────────────────────
    let shown: OfficeScene | null = null;
    const show = (): void => {
      const scene = source.get();
      // Word of a change with the very same scene is no change.
      if (scene === shown) return;
      // Another company: whatever was selected belonged to the old one.
      if (shown !== null && shown.runId !== scene.runId) stage.select(null);
      shown = scene;
      handle.setScene(scene);
    };
    // The first scene: nothing came before it, so the office is simply there.
    show();
    undo.push(
      source.subscribe(() => {
        if (!mounted) return;
        try {
          show();
        } catch (error) {
          // Whoever changed the scene is not to be thrown at for what the view could not do with it.
          console.error(SCENE_FAILED, error);
        }
      })
    );

    // ── Do not draw what nobody can see ─────────────────────────────────────
    let onScreen = true;
    const syncPaused = (): void => handle.setPaused(document.hidden || !onScreen);
    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
      syncPaused();
    });
    undo.push(() => intersectionObserver.disconnect());
    intersectionObserver.observe(viewport);
    document.addEventListener("visibilitychange", syncPaused);
    undo.push(() => document.removeEventListener("visibilitychange", syncPaused));
    syncPaused();
  } catch (error) {
    // Same outcome as a world that could not be created: logged, and the page carries on without the view.
    teardown();
    console.error(START_FAILED, error);
    store.setState({ status: "unsupported" });
    return () => stage.reset();
  }

  return teardown;
};

const sameState = (a: WorldViewState, b: WorldViewState): boolean => a.status === b.status && a.handle === b.handle;

/**
 * Tell `listener` how a stage's view stands, each time its status or its world changes. A listener starts from
 * "starting, no world" (INITIAL_STAGE_STATE) and is told at once only if the stage is already somewhere else.
 * The function returned stops the telling; if the listener was last told anything other than "starting, no world"
 * it is told that first, so nobody is left holding a world that may be gone.
 */
export const watchStage = (stage: WorldStage, listener: (state: WorldViewState) => void): (() => void) => {
  const nothing: WorldViewState = { status: INITIAL_STAGE_STATE.status, handle: INITIAL_STAGE_STATE.handle };
  let told = nothing;
  let watching = true;
  const tell = (state: WorldViewState): void => {
    if (sameState(state, told)) return;
    told = state;
    listener(state);
  };
  const read = (): WorldViewState => {
    const { status, handle } = stage.store.getState();
    return { status, handle };
  };
  tell(read());
  const unsubscribe = stage.store.subscribe(() => {
    if (watching) tell(read());
  });
  return () => {
    if (!watching) return;
    watching = false;
    unsubscribe();
    tell(nothing);
  };
};
