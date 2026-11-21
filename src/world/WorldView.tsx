import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createWorldAudio, type WorldAudio } from "../audio/worldAudio";
import { useGameStore } from "../state/useGameStore";
import { useUiStore } from "../state/useUiStore";
import type { GameState } from "../types/game";
import { createWorld, inspectWorld, WorldUnsupportedError } from "./core/World";
import { deriveWorldEvents } from "./events";
import { buildWorldSnapshot } from "./snapshot";
import type { ActionSignal, InteractableTarget, WorldHandle, WorldSnapshot } from "./types";
import { detectQuality, hasFinePointer, prefersReducedMotion } from "./ui/environment";
import { describeTarget } from "./ui/inspector";
import { createStage, INITIAL_STAGE_STATE, type Stage } from "./ui/stage";
import { WorldOverlay } from "./ui/WorldOverlay";
import { createBubbleGate, createZoomStepper, hoverSounds, selectionSound, type SelectionSound } from "./ui/worldSounds";

const DEBUG_GLOBAL = "__startupWorld";

const CANVAS_LABEL =
  "A 3D view of your company's office. It is a visual companion: everything shown here, and every action in it, is also available from the terminal below.";

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
const mountWorld = (canvas: HTMLCanvasElement, viewport: HTMLElement, stage: Stage): (() => void) => {
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
  store.setState({ status: "running", handle });
  // Development builds expose the live world for scripted QA and debugging in the
  // console; `import.meta.env.DEV` is a compile-time false in production builds.
  if (import.meta.env.DEV) {
    Reflect.set(window, DEBUG_GLOBAL, { handle, stage, audio, game: useGameStore, inspect: () => inspectWorld(handle) });
  }

  // ── Size ──────────────────────────────────────────────────────────────────
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
  resizeObserver.observe(viewport);

  // ── Game state → world ────────────────────────────────────────────────────
  let previous: WorldSnapshot | null = null;
  // Whatever ran before this world existed is history, not something to animate.
  let lastSeq = useGameStore.getState().lastAction?.seq ?? 0;

  const push = (state: GameState, action: ActionSignal | null): void => {
    const next = buildWorldSnapshot(state);
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
  const stopGameSync = useGameStore.subscribe((next, prev) => {
    // The log and the command history change far more often than the game does.
    if (next.state === prev.state && next.lastAction === prev.lastAction) return;
    push(next.state, next.lastAction);
  });

  // ── Do not render what nobody can see ─────────────────────────────────────
  let onScreen = true;
  const syncPaused = (): void => handle.setPaused(document.hidden || !onScreen);
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
    syncPaused();
    // Scrolled out of sight: no diegetic sounds, and the room tone fades out (and back in).
    audio.setWorldVisible(onScreen);
  });
  intersectionObserver.observe(viewport);
  document.addEventListener("visibilitychange", syncPaused);
  syncPaused();

  return () => {
    document.removeEventListener("visibilitychange", syncPaused);
    intersectionObserver.disconnect();
    stopGameSync();
    resizeObserver.disconnect();
    // Always a full dispose: it also frees the shared prop caches, so a world
    // must never be kept alive across unmounts (StrictMode, the 3D toggle).
    if (import.meta.env.DEV) Reflect.deleteProperty(window, DEBUG_GLOBAL);
    // Queued world sounds are dropped, playing ones fade, and the bed fades out.
    audio.dispose();
    handle.dispose();
    anchor.set(null);
    store.setState(INITIAL_STAGE_STATE);
  };
};

export interface WorldViewProps {
  /**
   * Runs a terminal command on behalf of a click in the world (a card button,
   * "End week"). The shell supplies it so the world goes through exactly the
   * same path as its other buttons — it never talks to the engine itself.
   */
  runCommand: (input: string) => void;
}

interface WorldStageProps extends WorldViewProps {
  /** Throw this stage away and build a new one (new canvas, new GL context). */
  onReload: () => void;
}

const WorldStage = ({ runCommand, onReload }: WorldStageProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage] = useState(createStage);
  const [finePointer] = useState(hasFinePointer);
  const status = useStore(stage.store, (state) => state.status);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    return mountWorld(canvas, viewport, stage);
  }, [stage]);

  return (
    <div
      ref={viewportRef}
      data-world
      className="world-viewport relative h-full w-full overflow-hidden rounded-xl"
      // Any press inside the viewport counts as "the player has found the world".
      onPointerDownCapture={() => useUiStore.getState().dismissWorldHint()}
      onWheelCapture={() => useUiStore.getState().dismissWorldHint()}
    >
      {/* The world never takes keyboard focus: no tabIndex, and the interaction
          layer keeps mouse presses from moving focus off the terminal. */}
      <canvas ref={canvasRef} role="img" aria-label={CANVAS_LABEL} className="absolute inset-0 block h-full w-full" />

      {status === "running" || status === "context-lost" ? <WorldOverlay stage={stage} finePointer={finePointer} runCommand={runCommand} /> : null}

      {status === "context-lost" ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-ink/70 px-4" role="status">
          <div className="panel-surface flex max-w-sm flex-col items-center gap-2 rounded-xl px-4 py-3 text-center text-xs text-mist/80">
            <span>The 3D view lost its graphics context — the terminal has everything.</span>
            <button
              type="button"
              data-world-ui
              onClick={onReload}
              className="rounded-lg bg-neon/15 px-2.5 py-1 text-[0.7rem] font-semibold text-neon ring-1 ring-inset ring-neon/40 hover:bg-neon/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neon"
            >
              Reload 3D view
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The 3D view of the company. Default-exported so the shell can load it — and
 * three.js with it — lazily.
 *
 * Fills its parent; the shell decides how big that is. The stage is keyed so
 * "Reload 3D view" replaces the canvas element itself: a canvas whose WebGL
 * context was lost for good cannot be given a new one.
 */
const WorldView = ({ runCommand }: WorldViewProps) => {
  const [generation, setGeneration] = useState(0);
  return <WorldStage key={generation} runCommand={runCommand} onReload={() => setGeneration((value) => value + 1)} />;
};

export default WorldView;
