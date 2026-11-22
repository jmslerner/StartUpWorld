/**
 * The imperative half of WorldView: create a world on a canvas, keep it fed
 * with the game state and sized to its viewport, and tear all of it down
 * again. Kept out of WorldView.tsx so that file exports only components.
 */
import { createWorldAudio, type WorldAudio } from "../audio/worldAudio";
import { useGameStore } from "../state/useGameStore";
import { useUiStore } from "../state/useUiStore";
import type { GameState } from "../types/game";
import { createWorld, inspectWorld, WorldUnsupportedError } from "./core/World";
import { deriveWorldEvents } from "./events";
import { buildWorldSnapshot } from "./snapshot";
import type { ActionSignal, InteractableTarget, WorldHandle, WorldSnapshot } from "./types";
import { detectQuality, prefersReducedMotion } from "./ui/environment";
import { describeTarget } from "./ui/inspector";
import { INITIAL_STAGE_STATE, type Stage } from "./ui/stage";
import { createBubbleGate, createZoomStepper, hoverSounds, selectionSound, type SelectionSound } from "./ui/worldSounds";

const DEBUG_GLOBAL = "__startupWorld";

const playSelection = (audio: WorldAudio, sound: SelectionSound | null): void => {
  if (sound === "open") audio.ui.open();
  else if (sound === "select") audio.ui.select();
  else if (sound === "close") audio.ui.close();
};

/**
 * Create a world on `canvas`, keep it fed with the game state and sized to
 * `viewport`, and return the function that tears all of it down again.
 *
 * Everything here is imperative on purpose: the three.js side is driven by
 * store subscriptions and DOM observers, never by React renders, so a frame is
 * never waiting on reconciliation and React never sees per-frame data.
 */
export const mountWorld = (canvas: HTMLCanvasElement, viewport: HTMLElement, stage: Stage): (() => void) => {
  const { store, anchor } = stage;

  // ── Sound ─────────────────────────────────────────────────────────────────
  // One WorldAudio per world, disposed with it (the shared engine stays). The people report
  // their own footsteps and chairs at the moments they happen, so the event-timed ones are left out.
  const audio = createWorldAudio({ omit: ["footsteps", "chair-sit"] });
  const zoomTicks = createZoomStepper();
  const bubbles = createBubbleGate();
  /** Would selecting this open an inspector card (so the click plays `open`, not `select`)? */
  const opensCard = (target: InteractableTarget): boolean =>
    describeTarget(target, useGameStore.getState().state, { hiddenCount: handle.hiddenCount(), gate: false }) !== null;

  let handle: WorldHandle;
  try {
    handle = createWorld(
      canvas,
      {
        onHover: (hit) => {
          if (hoverSounds(store.getState().hover?.target ?? null, hit?.target ?? null)) audio.ui.hover();
          store.setState({ hover: hit });
        },
        // The world has already highlighted the target itself; mirror it for the overlay.
        onSelect: (hit) => {
          const previous = store.getState().selected;
          const target = hit?.target ?? null;
          store.setState({ selected: target });
          anchor.set(hit?.screen ?? null);
          playSelection(audio, selectionSound(previous, target, target !== null && opensCard(target)));
        },
        onSelectedAnchorMove: (screen) => anchor.set(screen),
        onContextLost: () => store.setState({ status: "context-lost", hover: null }),
        onContextRestored: () => store.setState({ status: "running" }),
        onZoom: (factor) => {
          const tick = zoomTicks.step(factor, performance.now());
          if (tick !== 0) audio.ui.zoom(tick);
        },
      },
      {
        quality: detectQuality(),
        reducedMotion: prefersReducedMotion(),
        sound: {
          onFootsteps: (cue) => audio.play("footsteps", cue),
          onChairSit: (cue) => audio.play("chair-sit", cue),
          onBubble: (cue) => {
            if (bubbles.allow(performance.now())) audio.play("bubble-pop", cue);
          },
          onDusk: (amount) => audio.setDusk(amount),
        },
      }
    );
  } catch (error) {
    // No WebGL 2 is an expected situation. Anything else is a bug worth a log
    // line — but either way the game carries on in the terminal (and its stingers).
    audio.dispose();
    if (!(error instanceof WorldUnsupportedError)) console.error("[world] Could not start the 3D view.", error);
    store.setState({ status: "unsupported" });
    useUiStore.getState().setWorldUnsupported(true);
    return () => store.setState(INITIAL_STAGE_STATE);
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  // From here on each thing the mount creates registers how to undo it, and
  // `teardown` undoes them in reverse order: when the view unmounts, or at once
  // if a later step of the mount throws (a snapshot the world cannot take, an
  // observer that fails), so a failed mount never leaks the render loop, the
  // WebGL context, an observer or the sound bed.
  const undo: (() => void)[] = [];
  const teardown = (): void => {
    // Every step runs even if an earlier one throws; the first error is rethrown after.
    const failures: unknown[] = [];
    for (let step = undo.pop(); step; step = undo.pop()) {
      try {
        step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  };
  undo.push(() => {
    // Queued world sounds are dropped, playing ones fade, and the bed fades out.
    audio.dispose();
    // Always a full dispose: it also frees the shared prop caches, so a world
    // must never be kept alive across unmounts (StrictMode, the 3D toggle).
    handle.dispose();
    anchor.set(null);
    store.setState(INITIAL_STAGE_STATE);
  });

  try {
    store.setState({ status: "running", handle });
    // Development builds expose the live world for scripted QA and debugging in the
    // console; `import.meta.env.DEV` is a compile-time false in production builds.
    if (import.meta.env.DEV) {
      Reflect.set(window, DEBUG_GLOBAL, { handle, stage, audio, game: useGameStore, inspect: () => inspectWorld(handle) });
      undo.push(() => Reflect.deleteProperty(window, DEBUG_GLOBAL));
    }

    // ── Size ────────────────────────────────────────────────────────────────
    const applySize = (): void => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const current = store.getState().size;
      if (width <= 0 || height <= 0 || (width === current.width && height === current.height)) return;
      handle.resize(width, height);
      store.setState({ size: { width, height } });
    };
    applySize();
    const resizeObserver = new ResizeObserver(applySize);
    undo.push(() => resizeObserver.disconnect());
    resizeObserver.observe(viewport);

    // ── Game state → world ──────────────────────────────────────────────────
    let previous: WorldSnapshot | null = null;
    // Whatever ran before this world existed is history, not something to animate.
    let lastSeq = useGameStore.getState().lastAction?.seq ?? 0;
    // M3: the last GameState a snapshot was built from, and that snapshot. Store
    // updates carrying the same state reference (action-only notifications)
    // reuse it instead of rebuilding the whole projection; deriveWorldEvents
    // has a matching same-reference fast path, so behavior is unchanged.
    let builtForState: GameState | null = null;
    let builtSnapshot: WorldSnapshot | null = null;

    const push = (state: GameState, action: ActionSignal | null): void => {
      const next = state === builtForState && builtSnapshot ? builtSnapshot : buildWorldSnapshot(state);
      builtForState = state;
      builtSnapshot = next;
      // Each action is handed over once; a later, unrelated store update must not replay it.
      const fresh = action !== null && action.seq !== lastSeq ? action : null;
      if (action !== null) lastSeq = action.seq;
      // A new company: whatever was selected belonged to the old one.
      if (previous !== null && previous.runId !== next.runId) stage.select(null);
      const events = deriveWorldEvents(previous, next, fresh);
      // Before the world sees them: the crew's reaction bubbles must know a stinger is sounding.
      bubbles.noteEvents(events, performance.now());
      handle.setSnapshot(next, events);
      // The diegetic layer for the same events; with none it just follows the state (ambience, mood).
      audio.handleEvents(events, next);
      previous = next;
    };
    // First snapshot: no previous, so no events — the office is simply there
    // (this is also what restoring a saved game looks like).
    push(useGameStore.getState().state, null);
    undo.push(
      useGameStore.subscribe((next, prev) => {
        // The log and the command history change far more often than the game does.
        if (next.state === prev.state && next.lastAction === prev.lastAction) return;
        push(next.state, next.lastAction);
      })
    );

    // ── Do not render what nobody can see ───────────────────────────────────
    let onScreen = true;
    const syncPaused = (): void => handle.setPaused(document.hidden || !onScreen);
    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
      syncPaused();
      // Scrolled out of sight: no diegetic sounds, and the room tone fades out (and back in).
      audio.setWorldVisible(onScreen);
    });
    undo.push(() => intersectionObserver.disconnect());
    intersectionObserver.observe(viewport);
    document.addEventListener("visibilitychange", syncPaused);
    undo.push(() => document.removeEventListener("visibilitychange", syncPaused));
    syncPaused();
  } catch (error) {
    // Same outcome as a world that could not be created: logged, and the game
    // carries on in the terminal.
    try {
      teardown();
    } catch (cleanupError) {
      console.error("[world] Could not fully tear down the 3D view after a failed start.", cleanupError);
    }
    console.error("[world] Could not start the 3D view.", error);
    store.setState({ status: "unsupported" });
    useUiStore.getState().setWorldUnsupported(true);
    return () => store.setState(INITIAL_STAGE_STATE);
  }

  return teardown;
};

