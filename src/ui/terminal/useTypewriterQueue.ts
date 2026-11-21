import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogEntry } from "../../types/game";
import {
  advanceTo,
  completeAll,
  fastForward as fastForwardProgress,
  renderLog,
  typingTarget,
  type TypewriterProgress,
} from "./typewriter";

/**
 * WarGames-style typewriter for terminal output.
 *
 * All the logic lives in ./typewriter.ts: what is on screen is a pure function of
 * the log and `progress` (steps taken per entry id), so the log may change in any
 * way at any moment — lines appended mid-line, a whole new log at week's end,
 * `clear` — and still render correctly. This hook only holds `progress` and runs
 * one timer for the next step.
 *
 * - `user` lines and the intro render at once; everything before the newest
 *   `user` line renders whole (running a command finishes older output).
 * - Pacing tokens in the text: [[short]] / [[beat]] / [[long]] pauses,
 *   [[typefast]] / [[typeslow]] / [[typereset]] speeds.
 * - The log present when the terminal mounts (a reloaded save) is shown whole.
 */

export interface TypewriterQueueState {
  rendered: LogEntry[];
  isTyping: boolean;
  /** Finish the line being typed; the next pending line then starts. */
  fastForward: () => void;
  /** Finish everything in the log now. */
  flushAll: () => void;
}

export const useTypewriterQueue = (entries: LogEntry[]): TypewriterQueueState => {
  const [progress, setProgress] = useState<TypewriterProgress>(() => completeAll(entries));

  const target = useMemo(() => typingTarget(entries, progress), [entries, progress]);
  const rendered = useMemo(() => renderLog(entries, progress), [entries, progress]);

  const targetId = target?.id ?? null;
  const targetStep = target?.step ?? 0;
  const targetWait = target?.wait ?? 0;

  useEffect(() => {
    if (targetId === null) return;
    // The updater is idempotent (advance *to* a step), so a re-run effect or a
    // double-invoked updater never skips a character.
    const timer = window.setTimeout(() => {
      setProgress((current) => advanceTo(entries, current, targetId, targetStep + 1));
    }, targetWait);
    return () => window.clearTimeout(timer);
  }, [entries, targetId, targetStep, targetWait]);

  const fastForward = useCallback(() => setProgress((current) => fastForwardProgress(entries, current)), [entries]);
  const flushAll = useCallback(() => setProgress(completeAll(entries)), [entries]);

  return { rendered, isTyping: target !== null, fastForward, flushAll };
};
