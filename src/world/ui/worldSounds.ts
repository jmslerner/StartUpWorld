/**
 * The small decisions between the 3D world and the sound library (src/audio), kept pure so
 * they can be tested in node. WorldView does the wiring:
 *
 *   • which UI sound a click in the world makes (open a card, select, close, or nothing);
 *   • when the pointer reaching something earns a hover tick;
 *   • how a stream of zoom changes (a wheel, a pinch, the + / − buttons) becomes zoom ticks;
 *   • when a thought bubble may pop audibly: never on top of a store stinger.
 */
import { STING_DELAY, STINGER_CLEARANCE, STING_LENGTH, STORE_STINGERS } from "../../audio/worldAudio";
import { sameTarget } from "../targets";
import type { InteractableTarget, WorldEvent } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Clicks and hover
// ─────────────────────────────────────────────────────────────────────────────

/** What a click in the world sounds like: matches WorldAudio.ui's open / select / close. */
export type SelectionSound = "open" | "select" | "close";

/**
 * The UI sound for a click that changed the selection from `previous` to `next`.
 *
 * `opensCard`: the new target has an inspector card to show (a click that opens a card plays
 * `open` and only that; one that selects without a card plays `select`). Clicking the selected
 * thing again, or empty floor with nothing selected, is silent.
 */
export const selectionSound = (
  previous: InteractableTarget | null,
  next: InteractableTarget | null,
  opensCard: boolean
): SelectionSound | null => {
  if (next === null) return previous === null ? null : "close";
  if (sameTarget(previous, next)) return null;
  return opensCard ? "open" : "select";
};

/** Does the pointer moving from `previous` onto `next` earn a hover tick? Only reaching something new. */
export const hoverSounds = (previous: InteractableTarget | null, next: InteractableTarget | null): boolean =>
  next !== null && !sameTarget(previous, next);

// ─────────────────────────────────────────────────────────────────────────────
// Zoom
// ─────────────────────────────────────────────────────────────────────────────

export const ZOOM_TICKS = {
  /** One tick per this much zoom travel (as a factor) within a gesture. */
  stepFactor: 1.15,
  /** A pause this long (ms) ends a gesture: the next change ticks at once. */
  gestureGapMs: 250,
} as const;

export interface ZoomStepper {
  /**
   * The zoom changed by `factor` (> 1 closer) at `nowMs`. Returns +1 / −1 when a zoom tick
   * should sound (in / out), 0 when not.
   */
  step(factor: number, nowMs: number): -1 | 0 | 1;
}

/**
 * Turns zoom changes into ticks that follow the travel, not the event rate: the first change of
 * a gesture (or a change of direction) ticks at once — a wheel notch, a button press — and a
 * long smooth trackpad pinch ticks once per ZOOM_TICKS.stepFactor of zoom, instead of on each of
 * its sixty events a second.
 */
export const createZoomStepper = (): ZoomStepper => {
  const stepLog = Math.log(ZOOM_TICKS.stepFactor);
  let direction: -1 | 1 | 0 = 0;
  let lastMs = Number.NEGATIVE_INFINITY;
  let travel = 0;
  return {
    step(factor, nowMs) {
      if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return 0;
      const amount = Math.log(factor);
      const dir: -1 | 1 = amount > 0 ? 1 : -1;
      const fresh = dir !== direction || nowMs - lastMs > ZOOM_TICKS.gestureGapMs;
      direction = dir;
      lastMs = nowMs;
      if (fresh) {
        travel = 0;
        return dir;
      }
      travel += Math.abs(amount);
      if (travel < stepLog) return 0;
      travel = 0;
      return dir;
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Bubble pops
// ─────────────────────────────────────────────────────────────────────────────

/** Bubble pops never come closer together than this (ms): a whole team reacting is a pop or two, not a burst. */
export const BUBBLE_SPACING_MS = 120;

export interface BubbleGate {
  /** A batch of world events arrived at `nowMs` (call it before the world sees them). */
  noteEvents(events: readonly WorldEvent[], nowMs: number): void;
  /** May a bubble pop be heard at `nowMs`? (Says yes at most once per BUBBLE_SPACING_MS.) */
  allow(nowMs: number): boolean;
}

/**
 * Bubbles are the crew reacting to what just happened, i.e. exactly when the store plays its
 * stinger. The pop has a little pitch to it, so it keeps out of the stinger's way the same way
 * the rest of the world layer does (worldAudio.ts, rules 2 and 3): nothing for STINGER_CLEARANCE
 * after a batch the store may answer with a stinger, and nothing under a game-over sting.
 */
export const createBubbleGate = (): BubbleGate => {
  let quietUntil = Number.NEGATIVE_INFINITY;
  let lastPop = Number.NEGATIVE_INFINITY;
  return {
    noteEvents(events, nowMs) {
      let quiet = 0;
      for (const event of events) {
        if (event.type === "game-over") quiet = Math.max(quiet, STING_DELAY + STING_LENGTH[event.ending] + STINGER_CLEARANCE);
        else if (STORE_STINGERS[event.type]?.when !== "never") quiet = Math.max(quiet, STINGER_CLEARANCE);
      }
      if (quiet > 0) quietUntil = Math.max(quietUntil, nowMs + quiet * 1000);
    },
    allow(nowMs) {
      if (nowMs < quietUntil || nowMs - lastPop < BUBBLE_SPACING_MS) return false;
      lastPop = nowMs;
      return true;
    },
  };
};
