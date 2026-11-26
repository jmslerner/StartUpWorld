import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { mountWorld, watchStage, type SceneSource, type WorldViewState } from "./mountWorld";
import { SHELL_WORDS } from "./ui/shellWords";
import { createStage } from "./ui/stage";
import type { InteractableTarget, WorldSoundListener } from "./types";
import { WorldUnavailableNote } from "./ui/WorldShell";
import "./world.css";

export interface WorldViewProps {
  /**
   * Where the scene to show comes from. The view shows `source.get()` and follows every change it is told of.
   * Keep it the same object from one render to the next: another source is another world.
   */
  source: SceneSource;
  /**
   * Told how the view stands whenever that changes: its status ("starting", "running", "unsupported",
   * "context-lost") and the live world while there is one, null otherwise. A listener starts from "starting" with
   * no world and is never left holding a world that is gone: it is told so when the view reloads or unmounts.
   * Optional; the lab page reads the renderer's figures through it.
   */
  onState?: (state: WorldViewState) => void;
  /**
   * Told of every tap, the same target twice included, with the stage's select (which sets the highlight and the
   * store together). A tap on nothing is null. Optional.
   */
  onTap?: (target: InteractableTarget | null, select: (target: InteractableTarget | null) => void) => void;
  /**
   * Told of the sounds only the world can time (footsteps, chairs). Optional. Keep it the same object from one
   * render to the next: each world reads it once, when it is made.
   */
  sound?: WorldSoundListener;
}

interface WorldStageProps extends WorldViewProps {
  /** Throw this stage away and build a new one (new canvas, new GL context). */
  onReload: () => void;
}

const WorldStageView = ({ source, onState, onTap, sound, onReload }: WorldStageProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage] = useState(createStage);
  const status = useStore(stage.store, (state) => state.status);

  // The listener of the moment, so that a new function on every render of the parent is not a new subscription.
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });
  useEffect(() => watchStage(stage, (state) => onStateRef.current?.(state)), [stage]);
  const onTapRef = useRef(onTap);
  useEffect(() => {
    onTapRef.current = onTap;
  });
  useEffect(() => stage.taps.subscribe((target) => onTapRef.current?.(target, stage.select)), [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    return mountWorld(canvas, viewport, stage, source, sound === undefined ? {} : { sound });
  }, [stage, source, sound]);

  return (
    <div ref={viewportRef} data-world className="world-viewport world-stage">
      {status === "unsupported" ? (
        <div className="world-stage-note">
          <WorldUnavailableNote />
        </div>
      ) : (
        // The world never takes keyboard focus: no tabIndex, and the interaction layer keeps mouse presses from
        // moving focus off whatever on the page has it.
        <canvas ref={canvasRef} role="img" aria-label={SHELL_WORDS.view} className="world-canvas" />
      )}

      {status === "context-lost" ? (
        <div className="world-lost" role="status">
          <div className="world-lost-card">
            <span>{SHELL_WORDS.lost}</span>
            <button type="button" data-world-ui onClick={onReload} className="world-reload">
              {SHELL_WORDS.reload}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The 3D view of the company's office. Default-exported so that whoever shows it can load it, and three.js with
 * it, lazily.
 *
 * It fills its parent; the page decides how big that is. The stage is keyed so that "Reload 3D view" replaces the
 * canvas element itself: a canvas whose WebGL context was lost for good cannot be given a new one. Everything that
 * could be tested is in ./mountWorld.ts; nothing here decides anything.
 */
const WorldView = ({ source, onState, onTap, sound }: WorldViewProps) => {
  const [generation, setGeneration] = useState(0);
  return (
    <WorldStageView
      key={generation}
      source={source}
      onState={onState}
      onTap={onTap}
      sound={sound}
      onReload={() => setGeneration((value) => value + 1)}
    />
  );
};

export default WorldView;
