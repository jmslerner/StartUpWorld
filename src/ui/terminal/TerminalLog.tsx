import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../../types/game";

interface TerminalLogProps {
  log: LogEntry[];
  isTyping?: boolean;
}

export const TerminalLog = ({ log, isTyping = false }: TerminalLogProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const pausedFollowRef = useRef(false);
  const [hasNew, setHasNew] = useState(false);

  const entryClass = (kind?: LogEntry["kind"]) => {
    if (kind === "error") return "text-ember";
    if (kind === "user") return "text-neon";
    if (kind === "event") return "text-mist";
    return "text-slate-100/90";
  };

  const distanceFromBottomPx = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  const isAtBottom = (el: HTMLDivElement) => {
    const thresholdPx = 24;
    return distanceFromBottomPx(el) <= thresholdPx;
  };

  const updateStickiness = () => {
    const el = containerRef.current;
    if (!el) return;

    const atBottom = isAtBottom(el);
    stickToBottomRef.current = atBottom;

    // If the user scrolls back to the bottom, resume follow.
    if (atBottom) {
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
    if (pausedFollowRef.current && isAtBottom(el)) {
      pausedFollowRef.current = false;
      setHasNew(false);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const shouldFollow = stickToBottomRef.current && !pausedFollowRef.current;
    if (!shouldFollow) {
      queueMicrotask(() => setHasNew(true));
      return;
    }
    el.scrollTop = el.scrollHeight;
    queueMicrotask(() => setHasNew(false));
  }, [log, isTyping]);

  const jumpToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    pausedFollowRef.current = false;
    setHasNew(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      {hasNew && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute right-3 top-3 z-10 rounded-lg bg-neon/10 px-2 py-1 text-xs font-semibold text-neon"
          title="Jump to latest output"
        >
          New messages
        </button>
      )}

      <div
        ref={containerRef}
        data-terminal-log
        className="terminal-scrollbar terminal-scanlines panel-surface h-full overscroll-contain overflow-y-auto rounded-b-xl rounded-t-none border-t-0 p-3 text-base leading-relaxed text-slate-100/90"
        style={{ overscrollBehavior: "contain" }}
        onScroll={updateStickiness}
        onWheel={(event) => {
          // If the user scrolls up (toward older output), pause auto-follow immediately.
          // This also catches cases where the page scrolls instead (scroll chaining).
          if (event.deltaY < 0) pauseFollow();
          else if (event.deltaY > 0) maybeResumeFollowAtBottom();
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
          // Finger moves down => intent to scroll up (toward older output).
          if (dy > 2) pauseFollow();
          // Finger moves up while already at bottom => intent to follow latest.
          if (dy < -2) maybeResumeFollowAtBottom();
        }}
      >
        {log.map((entry) => (
          <div key={entry.id} className={entryClass(entry.kind)}>
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
};
