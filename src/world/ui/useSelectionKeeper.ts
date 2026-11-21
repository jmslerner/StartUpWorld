import { useEffect } from "react";
import { playSound } from "../../audio/engine";
import type { InteractableTarget, WorldHandle } from "../types";
import type { Stage } from "./stage";

/**
 * How long a selected target may be missing from the scene before its card
 * gives up. Long enough to ride out an office rebuild (phase change, new run),
 * short enough that a card never points at nothing for a noticeable time.
 */
const VANISH_GRACE_MS = 450;

/**
 * Where the selection goes when its target has left the scene.
 *
 * An empty desk that just got filled hands over to the lowest free desk — the
 * one the next hire will take — so hiring three people is three clicks on the
 * same card. Anything else simply closes.
 */
const successorOf = (target: InteractableTarget, handle: WorldHandle): InteractableTarget | null => {
  if (target.kind !== "empty-desk") return null;
  // The world's own seating plan: free desks, lowest (the next hire's) first.
  for (const slotIndex of handle.freeDeskSlots()) {
    const candidate: InteractableTarget = { kind: "empty-desk", slotIndex };
    // A free desk the office has not (yet) put a clickable desk on cannot carry the card.
    if (handle.project(candidate) !== null) return candidate;
  }
  return null;
};

/**
 * Keeps the selection honest while a card is open:
 *   • the card has nothing to say any more (`describable` is false) → close;
 *   • the target left the scene for longer than a moment → move on or close;
 *   • Escape → close (with the UI close sound), unless the terminal used that key press itself.
 * The automatic closes and hand-overs are silent: only the player's own gestures make UI sounds.
 */
export const useSelectionKeeper = (stage: Stage, selected: InteractableTarget | null, describable: boolean): void => {
  useEffect(() => {
    if (selected && !describable) stage.select(null);
  }, [stage, selected, describable]);

  useEffect(() => {
    if (!selected) return;

    let timer: number | undefined;
    const giveUp = (): void => {
      timer = undefined;
      const { handle } = stage.store.getState();
      // No world (it is being torn down or reloaded): nothing to check against.
      if (!handle || handle.project(selected) !== null) return;
      stage.select(successorOf(selected, handle));
    };
    const watch = (anchor: unknown): void => {
      if (anchor === null) {
        if (timer === undefined) timer = window.setTimeout(giveUp, VANISH_GRACE_MS);
      } else if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    // The target may already be gone by the time the card mounts.
    watch(stage.anchor.get());
    const stopWatching = stage.anchor.subscribe(watch);
    return () => {
      stopWatching();
      window.clearTimeout(timer);
    };
  }, [stage, selected]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // The terminal handles Escape first (it dismisses its suggestion list and
      // marks the event handled). Only an unclaimed Escape closes the card.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      playSound("ui-close");
      stage.select(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, selected]);
};
