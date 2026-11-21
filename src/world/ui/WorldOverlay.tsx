import { useMemo } from "react";
import { useStore } from "zustand";
import { useGameStore } from "../../state/useGameStore";
import { useUiStore } from "../../state/useUiStore";
import { targetKey } from "../targets";
import { HoverTooltip } from "./HoverTooltip";
import { describeTarget } from "./inspector";
import { InspectorPanel } from "./InspectorPanel";
import type { Stage } from "./stage";
import { useSelectionKeeper } from "./useSelectionKeeper";
import { WorldHud } from "./WorldHud";

interface WorldOverlayProps {
  stage: Stage;
  /** Mouse / trackpad present: show hover chips and the mouse wording of the hint. */
  finePointer: boolean;
  /** Runs a terminal command for a button press. */
  runCommand: (input: string) => void;
}

/** Below this viewport width the inspector docks as a bottom sheet instead of floating. */
const DOCK_BELOW_PX = 640;

/**
 * Everything HTML that is drawn over the 3D canvas: the world HUD, the hover
 * chip and the inspector card.
 *
 * The layer itself ignores the pointer (`pointer-events: none`) so the canvas
 * underneath keeps receiving drags, wheels and taps; only the controls opt back in.
 * `data-world-ui` lets the shell tell these controls apart from the rest of the
 * page (they are operated by keyboard like any button, not treated as typing).
 */
export const WorldOverlay = ({ stage, finePointer, runCommand }: WorldOverlayProps) => {
  const state = useGameStore((store) => store.state);
  const requestPrefill = useUiStore((store) => store.requestPrefill);
  const hintSeen = useUiStore((store) => store.worldHintSeen);
  const selected = useStore(stage.store, (stageState) => stageState.selected);
  const docked = useStore(stage.store, (stageState) => stageState.size.width < DOCK_BELOW_PX);

  const handle = useStore(stage.store, (stageState) => stageState.handle);
  // Re-derived on every game-state change, so an open card is always live. React renders
  // after the store's listeners have run — the world's among them — so its read-outs agree.
  const card = useMemo(
    () => (selected ? describeTarget(selected, state, { hiddenCount: handle?.hiddenCount() }) : null),
    [selected, state, handle]
  );
  useSelectionKeeper(stage, selected, card !== null);

  return (
    <div data-world-ui className="pointer-events-none absolute inset-0 select-none">
      <WorldHud
        state={state}
        showHint={!hintSeen}
        finePointer={finePointer}
        compact={docked}
        onEndWeek={() => runCommand("end")}
        onZoom={(factor) => stage.store.getState().handle?.zoomBy(factor)}
        onResetView={() => stage.store.getState().handle?.resetCamera()}
      />

      {finePointer ? <HoverTooltip stage={stage} /> : null}

      {selected && card ? (
        <InspectorPanel
          // A new target is a new card: replay the pop-in and place it from scratch.
          key={targetKey(selected)}
          stage={stage}
          target={selected}
          card={card}
          docked={docked}
          // The card stays open after a command so the same button can be pressed again.
          onRun={runCommand}
          onPrefill={(command) => {
            requestPrefill(command);
            // The player's attention moves to the terminal to finish the command.
            stage.select(null);
          }}
          onClose={() => stage.select(null)}
        />
      ) : null}
    </div>
  );
};
