import type { LogEntry } from "../../types/game";
import { TYPEWRITER_TOKEN_RE } from "./tokens";

/**
 * The pure core of the terminal's WarGames-style typewriter.
 *
 * What the log shows is a pure function of two things: the log entries, and how
 * far typing has got (`TypewriterProgress`: steps taken per entry id). Nothing
 * else is remembered — no "line currently being typed", no per-index buffers —
 * so any change to the log at any moment renders correctly: entries appended
 * mid-line, a whole new log at week's end, `clear`, a reload, React re-running
 * effects. The hook in useTypewriterQueue.ts only owns a timer that takes the
 * next step.
 *
 * Rules:
 * - `user` entries (the echoed "> command") and `intro-*` entries are shown whole at once.
 * - Everything before the newest `user` entry is shown whole: once the player has
 *   run another command, the output of the previous one is old news. This is what
 *   makes a click-run command mid-typing safe without any special handling.
 * - Of the rest, the newest entry that is not finished types first (the log is
 *   drawn newest-on-top, so lines fill in from the top down).
 *
 * Pacing comes from a per-entry plan (`planFor`): one wait before each character,
 * plus a final wait after the last one (the line "settles" before the next starts).
 * The plan's randomness is seeded from the entry, so it is the same every time.
 * Pacing tokens embedded in the text: [[short]] 200 ms, [[beat]] 450 ms,
 * [[long]] 800 ms; [[typefast]] / [[typeslow]] / [[typereset]] change speed.
 */

/** Steps taken per entry id. An entry missing from it has taken none. */
export type TypewriterProgress = Readonly<Record<string, number>>;

/** Marks an entry as fully typed and settled. */
export const DONE = Number.POSITIVE_INFINITY;

export interface TypePlan {
  /** The text once fully typed: the entry's text with the pacing tokens removed. */
  text: string;
  /**
   * `ends[k]` is how much of `text` (in UTF-16 units) shows after `k + 1` steps.
   * One step per character; a character outside the BMP (an emoji) is one step,
   * never half a surrogate pair.
   */
  ends: readonly number[];
  /**
   * `waits[k]` is how long to wait before step `k`. Step `k < ends.length` shows
   * one more character; step `ends.length` settles the line. Length `ends.length + 1`.
   */
  waits: readonly number[];
}

export interface TypingTarget {
  id: string;
  /** Index of the entry in the log. */
  index: number;
  /** Steps the entry has taken so far: the next step is this one. */
  step: number;
  /** Milliseconds to wait before taking that step. */
  wait: number;
}

type SpeedMode = "base" | "fast" | "slow";

type Op =
  | { kind: "char"; ch: string }
  | { kind: "pause"; ms: number }
  | { kind: "speed"; mode: SpeedMode };

type Rng = () => number;

/** FNV-1a, 32-bit. */
const hashString = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32: a small, good-enough seeded PRNG in [0, 1). */
const seededRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randInt = (rng: Rng, min: number, max: number): number => Math.floor(min + rng() * (max - min + 1));

const isPunctShort = (ch: string) => ch === "," || ch === ";" || ch === ":";
const isPunctLong = (ch: string) => ch === "." || ch === "!" || ch === "?";

const speedScale = (mode: SpeedMode) => (mode === "fast" ? 0.65 : mode === "slow" ? 1.55 : 1);

/** How long to linger after typing `ch`. */
const delayAfterChar = (rng: Rng, ch: string, mode: SpeedMode): number => {
  const scale = speedScale(mode);

  // Base cadence.
  const baseChar = randInt(rng, 22, 35);
  const space = randInt(rng, 8, 15);

  // Punctuation pauses.
  const pauseShort = randInt(rng, 80, 140);
  const pauseLong = randInt(rng, 180, 260);
  const pauseNewline = randInt(rng, 220, 420);

  if (ch === "\n") return Math.round(pauseNewline * scale);

  let d = ch === " " ? space : baseChar;
  if (isPunctShort(ch)) d += pauseShort;
  if (isPunctLong(ch)) d += pauseLong;

  return Math.max(0, Math.round(d * scale));
};

/** `text` without pacing tokens (exactly; no whitespace clean-up, so offsets line up with the plan). */
export const stripPacingTokens = (text: string): string => text.replaceAll(TYPEWRITER_TOKEN_RE, "");

const chooseChunkCount = (rng: Rng, visibleLen: number): number => {
  if (visibleLen <= 180) return 1;
  // Pick 2–4 chunks; scale up gently with length.
  const ideal = Math.round(visibleLen / 140);
  const noisy = ideal + (rng() < 0.35 ? 1 : 0);
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

const computeChunkBreaks = (rng: Rng, visibleText: string): number[] => {
  const len = visibleText.length;
  const chunks = chooseChunkCount(rng, len);
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

const parseOps = (rng: Rng, raw: string, finalText: string): Op[] => {
  const chunkBreaks = computeChunkBreaks(rng, finalText);

  const ops: Op[] = [];
  let visibleCount = 0;
  let nextBreakIdx = 0;

  const pushChar = (ch: string) => {
    ops.push({ kind: "char", ch });
    visibleCount += ch.length;

    if (nextBreakIdx < chunkBreaks.length && visibleCount >= chunkBreaks[nextBreakIdx]!) {
      // Brief pause between chunks to avoid a slow wall of text.
      ops.push({ kind: "pause", ms: randInt(rng, 170, 320) });
      nextBreakIdx += 1;
    }
  };

  let lastIdx = 0;
  for (const match of raw.matchAll(TYPEWRITER_TOKEN_RE)) {
    const idx = match.index ?? 0;
    const token = match[1] ?? "";

    for (const ch of raw.slice(lastIdx, idx)) pushChar(ch);

    if (token === "short") ops.push({ kind: "pause", ms: 200 });
    else if (token === "beat") ops.push({ kind: "pause", ms: 450 });
    else if (token === "long") ops.push({ kind: "pause", ms: 800 });
    else if (token === "typefast") ops.push({ kind: "speed", mode: "fast" });
    else if (token === "typeslow") ops.push({ kind: "speed", mode: "slow" });
    else if (token === "typereset") ops.push({ kind: "speed", mode: "base" });

    lastIdx = idx + match[0].length;
  }
  for (const ch of raw.slice(lastIdx)) pushChar(ch);

  return ops;
};

const buildPlan = (entry: LogEntry): TypePlan => {
  const text = stripPacingTokens(entry.text);
  const rng = seededRng(hashString(`${entry.id}\u0000${entry.text}`));
  const ops = parseOps(rng, entry.text, text);

  const ends: number[] = [];
  const waits: number[] = [];
  let pending = 0;
  let offset = 0;
  let mode: SpeedMode = "base";
  for (const op of ops) {
    if (op.kind === "speed") mode = op.mode;
    else if (op.kind === "pause") pending += op.ms;
    else {
      waits.push(pending);
      offset += op.ch.length;
      ends.push(offset);
      pending = delayAfterChar(rng, op.ch, mode);
    }
  }
  waits.push(pending); // settle
  return { text, ends, waits };
};

// Plans are pure functions of the entry; the cache only saves recomputing them on
// every rendered character. Keyed by the entry object, so dropped entries are collected.
const planCache = new WeakMap<LogEntry, TypePlan>();

/** The deterministic typing plan for an entry. */
export const planFor = (entry: LogEntry): TypePlan => {
  let plan = planCache.get(entry);
  if (!plan) {
    plan = buildPlan(entry);
    planCache.set(entry, plan);
  }
  return plan;
};

/** Shown whole at once, never typed. */
export const isInstant = (entry: LogEntry): boolean => entry.kind === "user" || entry.id.startsWith("intro-");

/** Index of the newest `user` entry, or -1. Entries at or before it are shown whole. */
const lastUserIndex = (entries: readonly LogEntry[]): number => {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.kind === "user") return i;
  }
  return -1;
};

const stepsTaken = (progress: TypewriterProgress, id: string): number => {
  const steps = progress[id];
  return steps === undefined || Number.isNaN(steps) ? 0 : Math.max(0, steps);
};

/** The entry to type next and how long to wait before its next step; null when nothing is typing. */
export const typingTarget = (entries: readonly LogEntry[], progress: TypewriterProgress): TypingTarget | null => {
  const firstTyped = lastUserIndex(entries) + 1;
  for (let i = entries.length - 1; i >= firstTyped; i -= 1) {
    const entry = entries[i]!;
    if (isInstant(entry)) continue;
    const plan = planFor(entry);
    const step = stepsTaken(progress, entry.id);
    if (step < plan.waits.length) return { id: entry.id, index: i, step, wait: plan.waits[step]! };
  }
  return null;
};

/** The log as it should be on screen right now. Entries keep their id and kind; only `text` is cut. */
export const renderLog = (entries: readonly LogEntry[], progress: TypewriterProgress): LogEntry[] => {
  const firstTyped = lastUserIndex(entries) + 1;
  return entries.map((entry, i) => {
    if (entry.kind === "user") return entry;
    const plan = planFor(entry);
    const steps = isInstant(entry) || i < firstTyped ? DONE : stepsTaken(progress, entry.id);
    const text = steps >= plan.ends.length ? plan.text : steps <= 0 ? "" : plan.text.slice(0, plan.ends[steps - 1]);
    return text === entry.text ? entry : { ...entry, text };
  });
};

/** Keeps only the ids still in the log, so progress never outgrows it. */
const pruned = (entries: readonly LogEntry[], progress: TypewriterProgress): Record<string, number> => {
  const next: Record<string, number> = {};
  for (const entry of entries) {
    const steps = progress[entry.id];
    if (steps !== undefined) next[entry.id] = steps;
  }
  return next;
};

/**
 * Entry `id` has now taken `toStep` steps. Idempotent (applying it twice, as a
 * StrictMode double-invoked state updater does, changes nothing more) and never
 * moves an entry backwards.
 */
export const advanceTo = (
  entries: readonly LogEntry[],
  progress: TypewriterProgress,
  id: string,
  toStep: number
): TypewriterProgress => {
  const next = pruned(entries, progress);
  if (entries.some((entry) => entry.id === id)) next[id] = Math.max(stepsTaken(progress, id), toStep);
  return next;
};

/** Every entry in the log typed and settled: the initial state (a reloaded save is not re-typed), and "flush all". */
export const completeAll = (entries: readonly LogEntry[]): TypewriterProgress => {
  const next: Record<string, number> = {};
  for (const entry of entries) next[entry.id] = DONE;
  return next;
};

/** Finishes the line being typed (Enter while typing); the next pending line then starts. */
export const fastForward = (entries: readonly LogEntry[], progress: TypewriterProgress): TypewriterProgress => {
  const target = typingTarget(entries, progress);
  return target ? advanceTo(entries, progress, target.id, DONE) : progress;
};
