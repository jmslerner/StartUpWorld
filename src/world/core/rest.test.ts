import { describe, expect, it } from "vitest";
import { AWAKE, REST_AFTER_SECONDS, restStep } from "./rest";
import type { RestState } from "./rest";

const FRAME = 1 / 60;
const quietFrame = { dt: FRAME, busy: false, woken: false };

/** A loop that has come to rest: more than a second of frames in which nothing moved. */
const atRest = (): RestState => {
  let state = AWAKE;
  for (let i = 0; i < 90; i++) state = restStep(state, quietFrame);
  return state;
};

describe("the resting loop", () => {
  it("starts awake, with no quiet behind it", () => {
    expect(AWAKE).toEqual({ running: true, quiet: 0 });
    expect(Object.isFrozen(AWAKE)).toBe(true);
    expect(REST_AFTER_SECONDS).toBe(1);
  });

  it("keeps running while something moves", () => {
    let state = AWAKE;
    for (let i = 0; i < 600; i++) {
      state = restStep(state, { dt: FRAME, busy: true, woken: false });
      expect(state).toEqual({ running: true, quiet: 0 });
    }
  });

  it("rests one second after the last movement", () => {
    let state = AWAKE;
    for (let i = 0; i < 59; i++) state = restStep(state, { dt: 1 / 60, busy: false, woken: false });
    expect(state.running).toBe(true);
    state = restStep(state, { dt: 2 / 60, busy: false, woken: false });
    expect(state.running).toBe(false);
  });

  it("counts the second from the last movement, not from the first quiet frame", () => {
    let state = AWAKE;
    for (let i = 0; i < 50; i++) state = restStep(state, quietFrame);
    expect(state.quiet).toBeCloseTo(50 / 60, 9);
    state = restStep(state, { dt: FRAME, busy: true, woken: false });
    expect(state).toEqual({ running: true, quiet: 0 });
    for (let i = 0; i < 59; i++) state = restStep(state, quietFrame);
    expect(state.running).toBe(true);
    state = restStep(state, { dt: 2 * FRAME, busy: false, woken: false });
    expect(state.running).toBe(false);
  });

  it("stays at rest while nothing happens, however long", () => {
    let state = atRest();
    expect(state.running).toBe(false);
    for (let i = 0; i < 600; i++) {
      state = restStep(state, { dt: 10, busy: false, woken: false });
      expect(state.running).toBe(false);
    }
  });

  it("wakes when asked, and when something starts to move", () => {
    expect(restStep(atRest(), { dt: FRAME, busy: false, woken: true })).toEqual({ running: true, quiet: 0 });
    expect(restStep(atRest(), { dt: FRAME, busy: true, woken: false })).toEqual({ running: true, quiet: 0 });
    expect(restStep(atRest(), { dt: FRAME, busy: true, woken: true })).toEqual({ running: true, quiet: 0 });
    // Being asked while already running starts the quiet second again.
    let state = AWAKE;
    for (let i = 0; i < 30; i++) state = restStep(state, quietFrame);
    expect(restStep(state, { dt: FRAME, busy: false, woken: true })).toEqual({ running: true, quiet: 0 });
  });

  it("is awake for a full second after waking with nothing to do", () => {
    let state = restStep(atRest(), { dt: FRAME, busy: false, woken: true });
    let frames = 0;
    while (state.running && frames < 1000) {
      state = restStep(state, quietFrame);
      frames += 1;
    }
    expect(frames).toBeGreaterThanOrEqual(59);
    expect(frames).toBeLessThanOrEqual(61);
  });

  it("a long frame counts as it is, not as a second of quiet", () => {
    // The world clamps a frame to a tenth of a second before it gets here; what arrives is taken as given.
    expect(restStep(AWAKE, { dt: 0.1, busy: false, woken: false })).toEqual({ running: true, quiet: 0.1 });
    expect(restStep(AWAKE, { dt: 0.5, busy: false, woken: false })).toEqual({ running: true, quiet: 0.5 });
    expect(restStep({ running: true, quiet: 0.5 }, { dt: 0.5, busy: false, woken: false }).running).toBe(false);
    expect(restStep(AWAKE, { dt: 5, busy: false, woken: false })).toEqual({ running: false, quiet: 5 });
    let state = AWAKE;
    for (let i = 0; i < 9; i++) state = restStep(state, { dt: 0.1, busy: false, woken: false });
    expect(state.running).toBe(true);
  });

  it("a frame whose length is not a positive, finite number adds no quiet and cannot wedge the loop awake", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0]) {
      let state: RestState = { running: true, quiet: 0.5 };
      state = restStep(state, { dt: bad, busy: false, woken: false });
      expect(state, String(bad)).toEqual({ running: true, quiet: 0.5 });
      state = restStep(state, { dt: 0.6, busy: false, woken: false });
      expect(state.running, String(bad)).toBe(false);
    }
  });

  it("never changes the state it is given", () => {
    const before: RestState = Object.freeze({ running: true, quiet: 0.25 });
    restStep(before, quietFrame);
    restStep(before, { dt: FRAME, busy: true, woken: true });
    expect(before).toEqual({ running: true, quiet: 0.25 });
  });
});
