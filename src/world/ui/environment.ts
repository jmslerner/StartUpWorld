/**
 * What kind of device the world is about to run on. Read once, when a world is
 * created; all three answers are fixed for the life of that world.
 */
import type { QualityLevel } from "../types";

/** Screens whose short side is below this are phones: small canvas, modest GPU. */
const SMALL_SCREEN_PX = 520;
/** At or below this many logical cores, assume an entry-level machine. */
const FEW_CORES = 4;

const matches = (query: string): boolean => {
  try {
    return window.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
};

/**
 * "low" drops shadows and caps the pixel ratio. Chosen for touch-first
 * devices, phone-sized screens and machines with few cores — the cases where a
 * steady frame rate matters more than soft shadows.
 */
export const detectQuality = (): QualityLevel => {
  const coarsePointer = matches("(pointer: coarse)");
  // The device's screen, not the window: a narrow browser window on a desktop still has a desktop GPU.
  const smallScreen = Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity) < SMALL_SCREEN_PX;
  const fewCores = (navigator.hardwareConcurrency ?? Infinity) <= FEW_CORES;
  return coarsePointer || smallScreen || fewCores ? "low" : "high";
};

export const prefersReducedMotion = (): boolean => matches("(prefers-reduced-motion: reduce)");

/** A mouse or trackpad is the primary pointer: hovering exists, so hover chips are worth drawing. */
export const hasFinePointer = (): boolean => matches("(hover: hover) and (pointer: fine)");
