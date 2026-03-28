import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../types/game";

/**
 * WarGames-style typewriter queue for terminal output.
 *
 * - Consumes full LogEntry objects (engine can keep returning strings; UI wraps).
 * - Types non-user entries one at a time; user entries render instantly.
 * - Supports invisible pause/speed tokens embedded in text:
 *   [[short]] (200ms), [[beat]] (450ms), [[long]] (800ms)
 *   [[typefast]], [[typeslow]], [[typereset]]
 */

type SpeedMode = "base" | "fast" | "slow";

type Op =
  | { kind: "char"; ch: string }
  | { kind: "pause"; ms: number }
  | { kind: "speed"; mode: SpeedMode };

const TOKEN_RE = /\[\[(short|beat|long|typefast|typeslow|typereset)\]\]/g;

const randInt = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min + 1));

const isPunctShort = (ch: string) => ch === "," || ch === ";" || ch === ":";
const isPunctLong = (ch: string) => ch === "." || ch === "!" || ch === "?";

const speedScale = (mode: SpeedMode) => (mode === "fast" ? 0.65 : mode === "slow" ? 1.55 : 1);

const delayForChar = (ch: string, mode: SpeedMode): number => {
  const scale = speedScale(mode);

  // Base cadence.
  const baseChar = randInt(22, 35);
  const space = randInt(8, 15);

  // Punctuation pauses.
  const pauseShort = randInt(80, 140);
  const pauseLong = randInt(180, 260);
  const pauseNewline = randInt(220, 420);

  if (ch === "\n") return Math.round(pauseNewline * scale);

  let d = ch === " " ? space : baseChar;
  if (isPunctShort(ch)) d += pauseShort;
  if (isPunctLong(ch)) d += pauseLong;

  return Math.max(0, Math.round(d * scale));
};

const stripTokens = (text: string): string => text.replaceAll(TOKEN_RE, "");

const chooseChunkCount = (visibleLen: number): number => {
  if (visibleLen <= 180) return 1;
  // Pick 2–4 chunks; scale up gently with length.
  const ideal = Math.round(visibleLen / 140);
  const noisy = ideal + (Math.random() < 0.35 ? 1 : 0);
  return Math.min(4, Math.max(2, noisy));
};

const findBreakpoint = (text: string, target: number): number => {
  const n = text.length;
  const t = Math.min(n - 1, Math.max(1, target));

  // Prefer newline boundaries, then spaces.
  for (let radius = 0; radius <= 28; radius += 1) {
    const left = t - radius;
    const right = t + radius;

    if (left > 0 && (text[left] === "\n" || text[left] === " ")) return left;
    if (right < n && (text[right] === "\n" || text[right] === " ")) return right;
  }

  return t;
};

const computeChunkBreaks = (visibleText: string): number[] => {
  const len = visibleText.length;
  const chunks = chooseChunkCount(len);
  if (chunks === 1) return [];

  const breaks: number[] = [];
  for (let i = 1; i < chunks; i += 1) {
    const target = Math.round((len * i) / chunks);
    const bp = findBreakpoint(visibleText, target);
    if (bp > 0 && bp < len) breaks.push(bp);
  }

  // Ensure strictly increasing and unique.
  return [...new Set(breaks)].sort((a, b) => a - b);
};

const parseOps = (raw: string): { ops: Op[]; finalText: string } => {
  const finalText = stripTokens(raw);
  const chunkBreaks = computeChunkBreaks(finalText);

  const ops: Op[] = [];
  let visibleCount = 0;
  let nextBreakIdx = 0;

  const pushChar = (ch: string) => {
    ops.push({ kind: "char", ch });
    visibleCount += 1;

    if (nextBreakIdx < chunkBreaks.length && visibleCount >= chunkBreaks[nextBreakIdx]!) {
      // Brief pause between chunks to avoid a slow wall of text.
      ops.push({ kind: "pause", ms: randInt(170, 320) });
      nextBreakIdx += 1;
    }
  };

  let lastIdx = 0;
  for (const match of raw.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    const token = match[1] ?? "";

    const before = raw.slice(lastIdx, idx);
    for (const ch of before) pushChar(ch);

    if (token === "short") ops.push({ kind: "pause", ms: 200 });
    else if (token === "beat") ops.push({ kind: "pause", ms: 450 });
    else if (token === "long") ops.push({ kind: "pause", ms: 800 });
    else if (token === "typefast") ops.push({ kind: "speed", mode: "fast" });
    else if (token === "typeslow") ops.push({ kind: "speed", mode: "slow" });
    else if (token === "typereset") ops.push({ kind: "speed", mode: "base" });

    lastIdx = idx + match[0].length;
  }

  const rest = raw.slice(lastIdx);
  for (const ch of rest) pushChar(ch);

  return { ops, finalText };
};

const isPrefixById = (a: LogEntry[], b: LogEntry[]): boolean => {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
};

const shouldRenderImmediately = (entries: LogEntry[]): boolean =>
  entries.length > 0 && entries.every((entry) => entry.kind === "user" || entry.id.startsWith("intro-"));

export interface TypewriterQueueState {
  rendered: LogEntry[];
  isTyping: boolean;
  fastForward: () => void;
}

export const useTypewriterQueue = (entries: LogEntry[]): TypewriterQueueState => {
  const prevEntriesRef = useRef<LogEntry[]>([]);

  // Index of the currently typing entry.
  const [typingIndex, setTypingIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  // Rendered text per entry (by index).
  const [renderedText, setRenderedText] = useState<string[]>([]);

  // Current message typing state.
  const opsRef = useRef<Op[]>([]);
  const opIdxRef = useRef(0);
  const speedModeRef = useRef<SpeedMode>("base");
  const finalTextRef = useRef<string>("");
  const timeoutRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Reset or extend queue based on incoming entries.
  useEffect(() => {
    const prev = prevEntriesRef.current;
    const renderImmediately = shouldRenderImmediately(entries);

    const resetNeeded = !isPrefixById(prev, entries);
    if (resetNeeded) {
      clearTimer();
      prevEntriesRef.current = entries;
      queueMicrotask(() => {
        setTypingIndex(0);
        setIsTyping(false);
        setRenderedText(
          entries.map((e) => {
            if (e.kind === "user") return e.text;
            return renderImmediately ? stripTokens(e.text) : "";
          })
        );
      });
      return;
    }

    // Prefix matches: extend renderedText for new entries.
    if (entries.length !== prev.length) {
      prevEntriesRef.current = entries;
      queueMicrotask(() => {
        setRenderedText((cur) => {
          const next = cur.slice(0, entries.length);
          for (let i = cur.length; i < entries.length; i += 1) {
            const e = entries[i];
            next[i] =
              e?.kind === "user"
                ? e?.text ?? ""
                : renderImmediately
                  ? stripTokens(e?.text ?? "")
                  : "";
          }
          return next;
        });
      });
    }
  }, [entries]);

  // Find next entry that needs typing.
  useEffect(() => {
    if (shouldRenderImmediately(entries)) {
      queueMicrotask(() => setIsTyping(false));
      return;
    }

    const nextIdx = (() => {
      // The terminal renders newest entries at the top, so we type the newest
      // pending system line first. This makes fresh output feel complete faster
      // instead of filling in from the bottom.
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i];
        if (!e) continue;
        if (e.kind === "user") continue;
        const full = stripTokens(e.text);
        const current = renderedText[i] ?? "";
        if (current.length < full.length) return i;
      }
      return null;
    })();

    if (nextIdx === null) {
      queueMicrotask(() => setIsTyping(false));
      return;
    }

    // If we were typing something else, switch.
    if (typingIndex !== nextIdx || !isTyping) {
      queueMicrotask(() => {
        setTypingIndex(nextIdx);
        setIsTyping(true);
      });

      const e = entries[nextIdx]!;
      const parsed = parseOps(e.text);
      opsRef.current = parsed.ops;
      finalTextRef.current = parsed.finalText;
      opIdxRef.current = 0;
      speedModeRef.current = "base";
    }
  }, [entries, isTyping, renderedText, typingIndex]);

  // Drive the typing loop (one op at a time).
  useEffect(() => {
    if (!isTyping) return;
    const entry = entries[typingIndex];
    if (!entry || entry.kind === "user") return;

    clearTimer();

    const step = () => {
      const ops = opsRef.current;
      const op = ops[opIdxRef.current];

      // Done with this entry.
      if (!op) {
        setRenderedText((cur) => {
          const next = cur.slice();
          next[typingIndex] = finalTextRef.current;
          return next;
        });
        setIsTyping(false);
        return;
      }

      opIdxRef.current += 1;

      if (op.kind === "speed") {
        speedModeRef.current = op.mode;
        timeoutRef.current = window.setTimeout(step, 0);
        return;
      }

      if (op.kind === "pause") {
        timeoutRef.current = window.setTimeout(step, op.ms);
        return;
      }

      // Character.
      setRenderedText((cur) => {
        const next = cur.slice();
        next[typingIndex] = (next[typingIndex] ?? "") + op.ch;
        return next;
      });

      const ms = delayForChar(op.ch, speedModeRef.current);
      timeoutRef.current = window.setTimeout(step, ms);
    };

    timeoutRef.current = window.setTimeout(step, 0);

    return () => {
      clearTimer();
    };
  }, [entries, isTyping, typingIndex]);

  const fastForward = () => {
    if (!isTyping) return;
    clearTimer();

    setRenderedText((cur) => {
      const next = cur.slice();
      next[typingIndex] = finalTextRef.current;
      return next;
    });

    // After a fast-forward we let the "find next entry" effect pick up the next queued message.
    setIsTyping(false);
  };

  const rendered = useMemo<LogEntry[]>(() =>
    entries.map((e, i) => ({ ...e, text: renderedText[i] ?? (e.kind === "user" ? e.text : "") })),
  [entries, renderedText]
  );

  return { rendered, isTyping, fastForward };
};
