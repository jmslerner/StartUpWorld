import { afterEach, describe, expect, it, vi } from "vitest";
import { detectQuality, hasFinePointer, prefersReducedMotion } from "./environment";

const REDUCED = "(prefers-reduced-motion: reduce)";
const FINE = "(hover: hover) and (pointer: fine)";
const COARSE = "(pointer: coarse)";

interface Device {
  /** The media queries that match. */
  matching?: readonly string[];
  screen?: { width: number; height: number } | null;
  cores?: number;
  /** `matchMedia` is missing, or throws. */
  matchMedia?: "missing" | "throws";
}

/** A device as the three probes see it: `window.matchMedia`, `window.screen` and `navigator.hardwareConcurrency`. */
const device = ({ matching = [], screen = { width: 1920, height: 1080 }, cores = 8, matchMedia }: Device = {}): string[] => {
  const asked: string[] = [];
  const probe =
    matchMedia === "missing"
      ? undefined
      : (query: string): { matches: boolean } => {
          asked.push(query);
          if (matchMedia === "throws") throw new Error("no media queries here");
          return { matches: matching.includes(query) };
        };
  vi.stubGlobal("window", { matchMedia: probe, screen: screen ?? undefined });
  vi.stubGlobal("navigator", { hardwareConcurrency: cores });
  return asked;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the device the world is about to run on", () => {
  it("detects reduced motion, a fine pointer and the quality to start from", () => {
    const asked = device({ matching: [REDUCED, FINE] });
    expect(prefersReducedMotion()).toBe(true);
    expect(hasFinePointer()).toBe(true);
    expect(detectQuality()).toBe("high");
    expect(asked).toEqual([REDUCED, FINE, COARSE]);

    device();
    expect(prefersReducedMotion()).toBe(false);
    expect(hasFinePointer()).toBe(false);
    expect(detectQuality()).toBe("high");
  });

  it("starts low on a touch device, a phone-sized screen or a machine with few cores", () => {
    device({ matching: [COARSE] });
    expect(detectQuality()).toBe("low");

    // The screen's short side decides, whichever way the device is held.
    device({ screen: { width: 390, height: 844 } });
    expect(detectQuality()).toBe("low");
    device({ screen: { width: 844, height: 390 } });
    expect(detectQuality()).toBe("low");
    device({ screen: { width: 520, height: 900 } });
    expect(detectQuality()).toBe("high");
    device({ screen: { width: 519, height: 900 } });
    expect(detectQuality()).toBe("low");

    device({ cores: 4 });
    expect(detectQuality()).toBe("low");
    device({ cores: 5 });
    expect(detectQuality()).toBe("high");
  });

  it("answers no to every question, and starts high, when the browser will not say", () => {
    for (const matchMedia of ["missing", "throws"] as const) {
      device({ matchMedia, matching: [REDUCED, FINE, COARSE] });
      expect(prefersReducedMotion()).toBe(false);
      expect(hasFinePointer()).toBe(false);
      expect(detectQuality()).toBe("high");
    }
    // No screen and no core count to read: nothing says the device is small.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    expect(detectQuality()).toBe("high");
  });
});
