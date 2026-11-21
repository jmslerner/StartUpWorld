import { describe, expect, it } from "vitest";
import { STINGER_CLEARANCE, STING_DELAY, STING_LENGTH } from "../../audio/worldAudio";
import type { InteractableTarget } from "../types";
import { BUBBLE_SPACING_MS, ZOOM_TICKS, createBubbleGate, createZoomStepper, hoverSounds, selectionSound } from "./worldSounds";

const desk: InteractableTarget = { kind: "empty-desk", slotIndex: 2 };
const sameDesk: InteractableTarget = { kind: "empty-desk", slotIndex: 2 };
const otherDesk: InteractableTarget = { kind: "empty-desk", slotIndex: 3 };
const door: InteractableTarget = { kind: "door" };

describe("selectionSound: what a click in the world sounds like", () => {
  it("opens a card with `open` only, and selects without a card with `select`", () => {
    expect(selectionSound(null, desk, true)).toBe("open");
    expect(selectionSound(null, door, false)).toBe("select");
  });

  it("moving the selection to something else opens its card", () => {
    expect(selectionSound(desk, otherDesk, true)).toBe("open");
    expect(selectionSound(desk, door, false)).toBe("select");
  });

  it("clicking the selected thing again is silent (the card simply stays)", () => {
    // A fresh object for the same target, as the world hands over on every click.
    expect(selectionSound(desk, sameDesk, true)).toBeNull();
  });

  it("clicking empty floor closes an open card, and is silent when nothing was selected", () => {
    expect(selectionSound(desk, null, false)).toBe("close");
    expect(selectionSound(null, null, false)).toBeNull();
  });
});

describe("hoverSounds", () => {
  it("ticks when the pointer reaches something new, not while it stays or leaves", () => {
    expect(hoverSounds(null, desk)).toBe(true);
    expect(hoverSounds(desk, otherDesk)).toBe(true);
    expect(hoverSounds(desk, sameDesk)).toBe(false);
    expect(hoverSounds(desk, null)).toBe(false);
    expect(hoverSounds(null, null)).toBe(false);
  });
});

describe("createZoomStepper", () => {
  const WHEEL_NOTCH = Math.exp(100 * 0.0016); // what Interaction applies for one 100 px notch
  const BUTTON = 1.25; // WorldHud's ZOOM_STEP

  it("ticks at once for the first change of a gesture, in its direction", () => {
    expect(createZoomStepper().step(BUTTON, 0)).toBe(1);
    expect(createZoomStepper().step(1 / BUTTON, 0)).toBe(-1);
  });

  it("ticks for every wheel notch and every button press, however quick", () => {
    const zoom = createZoomStepper();
    const ticks = [0, 40, 80, 120].map((ms) => zoom.step(WHEEL_NOTCH, ms));
    expect(ticks).toEqual([1, 1, 1, 1]);
    const buttons = createZoomStepper();
    expect([0, 100, 200].map((ms) => buttons.step(1 / BUTTON, ms))).toEqual([-1, -1, -1]);
  });

  it("ticks a smooth trackpad pinch by zoom travel, not by event rate", () => {
    const zoom = createZoomStepper();
    // 60 events a second for one second, doubling the zoom in all.
    const perEvent = 2 ** (1 / 60);
    let ticks = 0;
    for (let i = 0; i < 60; i += 1) if (zoom.step(perEvent, i * 16.7) !== 0) ticks += 1;
    const expected = 1 + Math.floor(Math.log(2) / Math.log(ZOOM_TICKS.stepFactor));
    expect(ticks).toBeGreaterThanOrEqual(expected - 1);
    expect(ticks).toBeLessThanOrEqual(expected);
  });

  it("starts a new gesture after a pause or on a change of direction", () => {
    const zoom = createZoomStepper();
    expect(zoom.step(1.01, 0)).toBe(1);
    expect(zoom.step(1.01, 16)).toBe(0);
    expect(zoom.step(1 / 1.01, 32)).toBe(-1);
    expect(zoom.step(1 / 1.01, 32 + ZOOM_TICKS.gestureGapMs + 1)).toBe(-1);
  });

  it("ignores no-ops and nonsense", () => {
    const zoom = createZoomStepper();
    for (const factor of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(zoom.step(factor, 0)).toBe(0);
  });
});

describe("createBubbleGate", () => {
  it("lets a pop through when nothing else is sounding, at most once per spacing", () => {
    const gate = createBubbleGate();
    expect(gate.allow(1000)).toBe(true);
    expect(gate.allow(1000 + BUBBLE_SPACING_MS - 1)).toBe(false);
    expect(gate.allow(1000 + BUBBLE_SPACING_MS)).toBe(true);
  });

  it("keeps out of the way of a store stinger (the crew reacts exactly when the store plays one)", () => {
    const gate = createBubbleGate();
    gate.noteEvents([{ type: "ship", ok: true, reputationDelta: 2 }], 1000);
    expect(gate.allow(1000)).toBe(false);
    expect(gate.allow(1000 + STINGER_CLEARANCE * 1000 - 1)).toBe(false);
    expect(gate.allow(1000 + STINGER_CLEARANCE * 1000)).toBe(true);
  });

  it("does not hold back for events the store never answers", () => {
    const gate = createBubbleGate();
    gate.noteEvents([{ type: "easter-egg", command: "coffee" }], 1000);
    expect(gate.allow(1000)).toBe(true);
  });

  it("stays quiet for the whole game-over sting", () => {
    const gate = createBubbleGate();
    gate.noteEvents([{ type: "game-over", ending: "bankruptcy" }], 0);
    const until = (STING_DELAY + STING_LENGTH.bankruptcy + STINGER_CLEARANCE) * 1000;
    expect(gate.allow(until - 1)).toBe(false);
    expect(gate.allow(until)).toBe(true);
  });
});
