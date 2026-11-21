import type { MouseEvent } from "react";
import { playSound } from "../../audio/engine";
import { getEffectiveMaxAp } from "../../engine/economy";
import type { GameState } from "../../types/game";
import { titleCase } from "./format";
import { commandBlocker, DISABLED_REASONS } from "./inspector";

interface WorldHudProps {
  state: GameState;
  /** False once the player has interacted with the world for the first time. */
  showHint: boolean;
  /** Touch-first device: the hint talks about taps and pinches. */
  finePointer: boolean;
  /** Narrow viewport (a phone): the End week button drops its command echo to leave the chips room. */
  compact?: boolean;
  onEndWeek: () => void;
  onZoom: (factor: number) => void;
  onResetView: () => void;
}

const ZOOM_STEP = 1.25;

const CHIP = "rounded-lg border border-white/10 bg-ink/75 px-2 py-1 shadow-lg backdrop-blur-sm";
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neon";
const ICON_BUTTON = `pointer-events-auto grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-ink/75 text-sm text-mist shadow-lg backdrop-blur-sm transition-colors hover:bg-steel/70 hover:text-white ${FOCUS_RING}`;

/** Presses on world controls never pull keyboard focus out of the terminal. */
const keepTerminalFocus = (event: MouseEvent): void => event.preventDefault();

const ApPips = ({ ap, maxAp }: { ap: number; maxAp: number }) => {
  const total = Math.max(maxAp, ap, 0);
  const empty = ap <= 0;
  return (
    // The HUD layer ignores the pointer, so a `title` tooltip would never show: the name says it all.
    <span role="img" aria-label={`${ap} of ${maxAp} action points left this week`} className="flex items-center gap-1.5">
      <span aria-hidden className={empty ? "text-ember" : "text-mist/70"}>
        AP
      </span>
      <span aria-hidden className="flex items-center gap-1">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`h-2.5 w-2.5 rounded-[3px] ${
              index < ap ? "bg-neon shadow-[0_0_6px_rgba(125,211,252,0.7)]" : empty ? "bg-ember/25 ring-1 ring-inset ring-ember/50" : "bg-white/10"
            }`}
          />
        ))}
      </span>
    </span>
  );
};

/**
 * The world's own controls, drawn over the canvas. Everything here is a real
 * button with a name; the layer itself lets pointer events through to the
 * canvas, so dragging the office works right up to the edge of each control.
 */
export const WorldHud = ({ state, showHint, finePointer, compact = false, onEndWeek, onZoom, onResetView }: WorldHudProps) => {
  const endBlocker = commandBlocker(state, "end");
  const inSetup = endBlocker === DISABLED_REASONS.setup;
  const outOfAp = state.ap <= 0;
  // The nudge: the week is spent, the only useful thing left is to end it.
  const nudge = !endBlocker && outOfAp;

  return (
    <>
      {/* Read-only chips: not interactive (the layer ignores the pointer), so what they mean is in their text. */}
      <div
        className={`absolute left-2 top-2 flex flex-wrap items-center gap-1.5 text-[0.7rem] ${
          compact ? "max-w-[calc(100%-6.25rem)]" : "max-w-[calc(100%-8.5rem)]"
        }`}
      >
        <span className={`${CHIP} flex items-center gap-1.5 font-semibold text-white`}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ember" />
          <span className="sr-only">Company phase: </span>
          {titleCase(state.companyPhase)}
        </span>
        {inSetup ? (
          <span className={`${CHIP} text-mist/80`}>Setting up</span>
        ) : (
          <>
            <span className={`${CHIP} tabular-nums text-slate-100`}>Week {state.week}</span>
            <span className={CHIP}>
              <ApPips ap={state.ap} maxAp={getEffectiveMaxAp(state)} />
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        aria-disabled={endBlocker !== undefined}
        title={endBlocker ?? "Runs: end"}
        onMouseDown={keepTerminalFocus}
        onClick={() => {
          if (endBlocker) {
            playSound("ui-denied");
            return;
          }
          playSound("ui-press");
          onEndWeek();
        }}
        className={`pointer-events-auto absolute right-2 top-2 flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[0.7rem] font-semibold shadow-lg backdrop-blur-sm transition-colors ${FOCUS_RING} ${
          endBlocker
            ? "cursor-not-allowed border-white/10 bg-ink/75 text-mist/50"
            : nudge
              ? "world-pulse border-ember/60 bg-ember/20 text-amber-200 hover:bg-ember/30"
              : "border-white/10 bg-ink/75 text-slate-100 hover:bg-steel/70"
        }`}
      >
        End week
        {endBlocker ? <span className="sr-only"> ({endBlocker})</span> : null}
        {compact ? null : (
          <span aria-hidden className={`font-mono font-normal ${endBlocker ? "text-mist/40" : nudge ? "text-amber-200/70" : "text-neon/80"}`}>
            &gt; end
          </span>
        )}
      </button>

      <div className="absolute bottom-2 right-2 flex items-center gap-1">
        <button type="button" aria-label="Zoom out" title="Zoom out" onMouseDown={keepTerminalFocus} onClick={() => onZoom(1 / ZOOM_STEP)} className={ICON_BUTTON}>
          <span aria-hidden>−</span>
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onMouseDown={keepTerminalFocus} onClick={() => onZoom(ZOOM_STEP)} className={ICON_BUTTON}>
          <span aria-hidden>+</span>
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" onMouseDown={keepTerminalFocus} onClick={onResetView} className={ICON_BUTTON}>
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6V2.5H6M13.5 10v3.5H10M10 2.5h3.5V6M6 13.5H2.5V10" />
          </svg>
        </button>
      </div>

      {showHint ? (
        <div className={`${CHIP} absolute bottom-2 left-2 max-w-[calc(100%-7.5rem)] truncate text-[0.68rem] text-mist/80`}>
          {finePointer ? "Click anything · drag to pan · scroll to zoom" : "Tap anything · drag · pinch"}
        </div>
      ) : null}
    </>
  );
};
