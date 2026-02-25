import { useEffect, useRef } from "react";
import type { LogEntry } from "../../types/game";

interface TerminalLogProps {
  log: LogEntry[];
}

export const TerminalLog = ({ log }: TerminalLogProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const entryClass = (kind?: LogEntry["kind"]) => {
    if (kind === "error") return "text-ember";
    if (kind === "user") return "text-neon";
    if (kind === "event") return "text-mist";
    return "text-slate-100/90";
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div
      ref={containerRef}
      className="terminal-scrollbar panel-surface h-full overflow-y-auto rounded-xl p-3 text-sm leading-relaxed text-slate-100/90"
    >
      {log.map((entry) => (
        <div key={entry.id} className={entryClass(entry.kind)}>
          {entry.text}
        </div>
      ))}
    </div>
  );
};
