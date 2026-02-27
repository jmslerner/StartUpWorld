import { useLayoutEffect, useRef, useState } from "react";
import type { LogEntry } from "../../types/game";

interface TerminalLogProps {
  log: LogEntry[];
  isTyping?: boolean;
}

export const TerminalLog = ({ log, isTyping = false }: TerminalLogProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToTopRef = useRef(true);
  const pausedFollowRef = useRef(false);
  const [hasNew, setHasNew] = useState(false);
  const prevScrollHeightRef = useRef<number | null>(null);

  const entryClass = (kind?: LogEntry["kind"]) => {
    if (kind === "error") return "text-ember";
    if (kind === "user") return "text-neon";
    if (kind === "event") return "text-mist";
    return "text-slate-100/90";
  };

  const isAtTop = (el: HTMLDivElement) => {
    const thresholdPx = 24;
    return el.scrollTop <= thresholdPx;
  };

  const updateStickiness = () => {
    const el = containerRef.current;
    if (!el) return;

    const atTop = isAtTop(el);
    stickToTopRef.current = atTop;

    // If the user scrolls back to the top (latest output), resume follow.
    if (atTop) {
      pausedFollowRef.current = false;
      setHasNew(false);
    }
  };

  const pauseFollow = () => {
    pausedFollowRef.current = true;
  };

  const maybeResumeFollowAtBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    if (pausedFollowRef.current && isAtTop(el)) {
      pausedFollowRef.current = false;
      setHasNew(false);
    }
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const shouldFollow = stickToTopRef.current && !pausedFollowRef.current;
    const prevScrollHeight = prevScrollHeightRef.current;
    const nextScrollHeight = el.scrollHeight;
    const deltaHeight = prevScrollHeight === null ? 0 : nextScrollHeight - prevScrollHeight;

    if (!shouldFollow) {
      // Keep the user's view anchored when new output prepends at the top.
      if (deltaHeight > 0) {
        el.scrollTop += deltaHeight;
      }
      prevScrollHeightRef.current = nextScrollHeight;
      queueMicrotask(() => setHasNew(true));
      return;
    }

    // Follow latest output at the top.
    el.scrollTop = 0;
    prevScrollHeightRef.current = nextScrollHeight;
    queueMicrotask(() => setHasNew(false));
  }, [log, isTyping]);

  const jumpToTop = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
    stickToTopRef.current = true;
    pausedFollowRef.current = false;
    setHasNew(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      {hasNew && (
        <button
          type="button"
          onClick={jumpToTop}
          className="absolute right-3 top-3 z-10 rounded-lg bg-neon/10 px-2 py-1 text-xs font-semibold text-neon"
          title="Jump to latest output"
        >
          New messages
        </button>
      )}

      <div
        ref={containerRef}
        data-terminal-log
        className="terminal-scrollbar terminal-scanlines panel-surface h-full touch-pan-y overscroll-contain overflow-y-auto rounded-b-xl rounded-t-none border-t-0 p-3 text-base leading-relaxed text-slate-100/90"
        style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
        onScroll={updateStickiness}
        onWheel={(event) => {
          // Newest output is at the top; scrolling down means reading older output.
          // Pause follow immediately on downward scroll intent.
          // This also catches cases where the page scrolls instead (scroll chaining).
          if (event.deltaY > 0) pauseFollow();
          else if (event.deltaY < 0) maybeResumeFollowAtBottom();
        }}
        onTouchStart={(event) => {
          const y = event.touches[0]?.clientY;
          if (y === undefined) return;
          (event.currentTarget as HTMLDivElement).dataset.touchStartY = String(y);
        }}
        onTouchMove={(event) => {
          const start = Number((event.currentTarget as HTMLDivElement).dataset.touchStartY ?? "NaN");
          const y = event.touches[0]?.clientY;
          if (!Number.isFinite(start) || y === undefined) return;

          const dy = y - start;
          // Finger moves up => intent to scroll down (toward older output).
          if (dy < -2) pauseFollow();
          // Finger moves down while already at top => intent to follow latest.
          if (dy > 2) maybeResumeFollowAtBottom();
        }}
      >
        {[...log].reverse().map((entry) => (
          <div key={entry.id} className={entryClass(entry.kind)}>
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
};
