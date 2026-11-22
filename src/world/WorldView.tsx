import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useUiStore } from "../state/useUiStore";
import { mountWorld } from "./mountWorld";
import { hasFinePointer } from "./ui/environment";
import { createStage } from "./ui/stage";
import { WorldOverlay } from "./ui/WorldOverlay";

const CANVAS_LABEL =
  "A 3D view of your company's office. It is a visual companion: everything shown here, and every action in it, is also available from the terminal below.";

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
