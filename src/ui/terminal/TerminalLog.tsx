import { useEffect, useRef } from "react";
import type { LogEntry } from "../../types/game";

interface TerminalLogProps {
  log: LogEntry[];
}

export const TerminalLog = ({ log }: TerminalLogProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const entryClass = (kind?: LogEntry["kind"]) => {
    if (kind === "error") return "text-ember";
    if (kind === "user") return "text-neon";
    if (kind === "event") return "text-mist";
    return "text-slate-100/90";
  };

  const updateStickiness = () => {
    const el = containerRef.current;
    if (!el) return;
    const thresholdPx = 24;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= thresholdPx;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div
      ref={containerRef}
      data-terminal-log
      className="terminal-scrollbar terminal-scanlines panel-surface min-h-0 flex-1 overflow-y-auto rounded-b-xl rounded-t-none border-t-0 p-3 text-base leading-relaxed text-slate-100/90"
      onScroll={updateStickiness}
    >
      {log.map((entry) => (
        <div key={entry.id} className={entryClass(entry.kind)}>
          {entry.text}
        </div>
      ))}
    </div>
  );
};
