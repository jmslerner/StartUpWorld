import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOfficeLayout } from "../office/layouts";
import type { OfficeLayout, QualityLevel, WorldSystem } from "../types";
import { CameraRig } from "./CameraRig";
import { FIRST_FRAME_SECONDS, MAX_FRAME_SECONDS, MIN_FRAME_SECONDS } from "./FrameLoop";
import { qualityGovernor, RenderLoop } from "./RenderLoop";
import { SystemRunner } from "./SystemRunner";

/** The page's frame clock: frames requested and cancelled, each one played only when the test says so. */
class PageFrames {
  now = 1000;
  readonly pending = new Map<number, (now: number) => void>();
  private nextId = 1;

  readonly request = (callback: (now: number) => void): number => {
    const id = this.nextId++;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancel = (id: number): void => {
    this.pending.delete(id);
  };

  /** Let `ms` pass and play the frame requested, if there is one. True when one was played. */
  tick(ms = 1000 / 60): boolean {
    this.now += ms;
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const callback of due) callback(this.now);
    return due.length > 0;
  }

  /** Play frames `ms` apart for as long as one is requested (at most `limit`). */
  untilRest(ms = 1000 / 60, limit = 1000): void {
    for (let played = 0; played < limit && this.tick(ms); played += 1);
  }
}

/** An event target that knows which listeners are on it. */
class Watched extends EventTarget {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (callback) this.listeners.set(type, new Set(this.listeners.get(type)).add(callback));
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void {
    if (callback) this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }

  /** The event types listened to now. */
  types(): string[] {
    return [...this.listeners].filter(([, callbacks]) => callbacks.size > 0).map(([type]) => type);
  }
}

type Query = Watched & { readonly media: string };

interface Entry {
  readonly what: string;
  readonly dt?: number;
  readonly elapsed?: number;
}

interface Harness {
  readonly loop: RenderLoop;
  readonly clock: PageFrames;
  readonly canvas: Watched;
  readonly page: { devicePixelRatio: number };
  /** Every media query the loop asked for, in order. */
  readonly queries: Query[];
  readonly rig: CameraRig;
  readonly renderer: {
    readonly ratios: number[];
    readonly sizes: (readonly [number, number, boolean | undefined])[];
    fail: boolean;
  };
  /** What happened in each frame, in order. */
  readonly log: Entry[];
  /** What the app's callbacks were told. */
  readonly told: string[];
  readonly shadows: boolean[];
  readonly reports: string[];
  readonly frames: { layout: OfficeLayout };
  /** Seconds the systems still have to move. */
  readonly probe: { moving: number };
  /** `during` runs once, in the middle of the next frame (from the highlights' update, as a listener would). */
  readonly hooks: { during: (() => void) | null };
}

const harness = (quality: QualityLevel = "high"): Harness => {
  const clock = new PageFrames();
  const queries: Query[] = [];
  const page = {
    devicePixelRatio: 2,
    matchMedia: (media: string): Query => {
      const query = Object.assign(new Watched(), { media });
      queries.push(query);
      return query;
    },
  };
  vi.stubGlobal("window", page);
  vi.stubGlobal("requestAnimationFrame", clock.request);
  vi.stubGlobal("cancelAnimationFrame", clock.cancel);
  // The governor and the loop's work timing read the page's clock.
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);

  const log: Entry[] = [];
  const told: string[] = [];
  const shadows: boolean[] = [];
  const reports: string[] = [];
  const probe = { moving: 0 };
  const runner = new SystemRunner((message) => reports.push(message));
  const system: WorldSystem = {
    applyFrame: () => {},
    update: (dt, elapsed) => {
      log.push({ what: "update", dt, elapsed });
      probe.moving = Math.max(0, probe.moving - dt);
    },
    busy: () => probe.moving > 0,
    dispose: () => {},
  };
  runner.register("probe", () => system);
  runner.start();

  const rig = new CameraRig();
  const update = rig.update.bind(rig);
  vi.spyOn(rig, "update").mockImplementation((dt) => {
    log.push({ what: "camera", dt });
    update(dt);
  });
  const renderer = {
    ratios: [] as number[],
    sizes: [] as (readonly [number, number, boolean | undefined])[],
    fail: false,
    render: (): void => {
      log.push({ what: "render" });
      if (renderer.fail) throw new Error("the renderer broke");
    },
    setPixelRatio: (ratio: number): void => {
      renderer.ratios.push(ratio);
    },
    setSize: (width: number, height: number, updateStyle?: boolean): void => {
      renderer.sizes.push([width, height, updateStyle]);
    },
  };
  const canvas = new Watched();
  const frames = { layout: getOfficeLayout(0) };
  const hooks: Harness["hooks"] = { during: null };
  const loop = new RenderLoop({
    canvas,
    renderer,
    scene: new THREE.Scene(),
    rig,
    runner,
    interaction: {
      update: (dt, elapsed) => {
        log.push({ what: "highlights", dt, elapsed });
        const during = hooks.during;
        hooks.during = null;
        during?.();
      },
    },
    lighting: { setShadowsEnabled: (on) => shadows.push(on) },
    governor: qualityGovernor(quality),
    frames,
    afterUpdate: () => log.push({ what: "sound" }),
    callbacks: { onContextLost: () => told.push("lost"), onContextRestored: () => told.push("restored") },
  });
  return { loop, clock, canvas, page, queries, rig, renderer, log, told, shadows, reports, frames, probe, hooks };
};

const whats = (entries: readonly Entry[]): string[] => entries.map((entry) => entry.what);
const draws = (h: Harness): number => h.log.filter((entry) => entry.what === "render").length;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RenderLoop: a frame", () => {
  it("moves the systems, tells the sound, moves the camera and the highlights, then draws, on the world's own clock", () => {
    const h = harness();
    h.loop.start();
    h.clock.tick(20);
    h.clock.tick(50);
    expect(whats(h.log)).toEqual([
      ...["update", "sound", "camera", "highlights", "render"],
      ...["update", "sound", "camera", "highlights", "render"],
    ]);
    // The first frame after a start has nothing before it to measure from; the next is the time between them.
    const [first, , , firstHighlights, , second] = h.log;
    expect(first.dt).toBeCloseTo(FIRST_FRAME_SECONDS, 9);
    expect(first.elapsed).toBeCloseTo(FIRST_FRAME_SECONDS, 9);
    expect(firstHighlights.elapsed).toBeCloseTo(FIRST_FRAME_SECONDS, 9);
    expect(second.dt).toBeCloseTo(0.05, 9);
    expect(second.elapsed).toBeCloseTo(FIRST_FRAME_SECONDS + 0.05, 9);
    expect(h.loop.framesDrawn).toBe(2);
  });

  it.each(["dispose", "pause"] as const)("is not drawn when a listener %ss the world during it, and no frame follows", (stop) => {
    const h = harness();
    h.loop.start();
    h.clock.tick();
    h.hooks.during = () => (stop === "dispose" ? h.loop.dispose() : h.loop.setPaused(true));
    h.clock.tick();
    expect(whats(h.log.slice(5))).toEqual(["update", "sound", "camera", "highlights"]);
    expect(h.loop.framesDrawn).toBe(1);
    expect(h.clock.pending.size).toBe(0);
  });

  it("goes on running while the systems or the camera move, and rests a second after they stop", () => {
    const h = harness();
    h.probe.moving = 0.5;
    h.loop.start();
    h.clock.untilRest();
    const movingFor = h.log.filter((entry) => entry.what === "update").length;
    // Half a second of movement at 60 fps, then the second of grace.
    expect(movingFor).toBeGreaterThan(85);
    expect(movingFor).toBeLessThan(95);
    expect(h.clock.pending.size).toBe(0);
    // The camera's glide alone keeps it running to the glide's end.
    h.rig.setFraming({ x: 4, z: 4 }, 12);
    h.loop.wake();
    h.clock.untilRest();
    expect(h.rig.isAnimating).toBe(false);
    expect(h.rig.getTarget()).toEqual({ x: 4, z: 4 });
  });
});

describe("RenderLoop: drawing", () => {
  it("sizes the backing store in whole pixels, at least one, and draws it at once", () => {
    const h = harness();
    h.loop.applySize(640.7, 480.2);
    expect(h.renderer.sizes).toEqual([[640, 480, false]]);
    expect(h.rig.viewport).toEqual({ width: 640, height: 480 });
    expect(draws(h)).toBe(1);
    h.loop.applySize(0.4, 0);
    expect(h.renderer.sizes.at(-1)).toEqual([1, 1, false]);
    expect(draws(h)).toBe(2);
  });

  it.each([
    ["high", 3, 2],
    ["high", 1.25, 1.25],
    ["low", 3, 1.5],
    ["low", 1, 1],
  ] as const)("on %s quality at a device pixel ratio of %s, draws at a pixel ratio of %s", (quality, screen, drawn) => {
    const h = harness(quality);
    h.page.devicePixelRatio = screen;
    h.loop.applySize(640, 480);
    expect(h.renderer.ratios).toEqual([drawn]);
  });

  it("counts every picture and tells each frame listener after it; a broken listener or renderer costs nothing more", () => {
    const h = harness();
    const told: string[] = [];
    const stopA = h.loop.onFrame(() => told.push("a"));
    h.loop.onFrame(() => {
      throw new Error("a broken listener");
    });
    const b = (): void => {
      told.push("b");
    };
    // The same function twice is two listeners, each stopped by its own call.
    const stopFirstB = h.loop.onFrame(b);
    h.loop.onFrame(b);
    h.loop.applySize(800, 600);
    expect(told).toEqual(["a", "b", "b"]);
    stopA();
    stopFirstB();
    h.renderer.fail = true;
    h.loop.applySize(800, 601);
    expect(told).toEqual(["a", "b", "b", "b"]);
    expect(h.loop.framesDrawn).toBe(2);
    expect(h.reports).toEqual(["[world] render failed; carrying on without it."]);
  });

  it("runs the systems once, by the shortest step there is, before a scene just applied is drawn by anything but a frame", () => {
    const h = harness();
    h.loop.sceneApplied();
    expect(h.log).toEqual([]);
    h.loop.applySize(800, 600);
    h.loop.applySize(800, 601);
    expect(whats(h.log)).toEqual(["update", "render", "render"]);
    expect(h.log[0].dt).toBe(MIN_FRAME_SECONDS);

    // A frame's own update is that one update: nothing more runs before it is drawn.
    h.loop.start();
    h.clock.tick();
    h.loop.sceneApplied();
    h.clock.tick();
    expect(whats(h.log.slice(-5))).toEqual(["update", "sound", "camera", "highlights", "render"]);
    expect(h.log.filter((entry) => entry.dt === MIN_FRAME_SECONDS)).toHaveLength(1);
  });

  it("finishes at once whatever moves, in whole frames of the longest step, ends the camera's glide, and draws it", () => {
    const h = harness();
    h.loop.start();
    h.clock.untilRest();
    const before = h.log.length;
    const clockBefore = h.log.filter((entry) => entry.what === "update").at(-1)?.elapsed ?? 0;
    h.probe.moving = 0.25;
    h.rig.setFraming({ x: 5, z: -3 }, 12);
    h.loop.settle();
    const settled = h.log.slice(before);
    expect(whats(settled)).toEqual(["update", "update", "update"]);
    expect(settled.map((entry) => entry.dt)).toEqual([MAX_FRAME_SECONDS, MAX_FRAME_SECONDS, MAX_FRAME_SECONDS]);
    expect(settled[2].elapsed).toBeCloseTo(clockBefore + 3 * MAX_FRAME_SECONDS, 9);
    expect(h.rig.isAnimating).toBe(false);
    expect(h.rig.getTarget()).toEqual({ x: 5, z: -3 });
    expect(h.clock.pending.size).toBe(1);
    h.clock.tick();
    expect(h.log.at(-1)?.what).toBe("render");
  });
});

describe("RenderLoop: what stops and starts it", () => {
  it("listens to the context's loss and return and to the pointer on the canvas, and to the screen's pixel ratio", () => {
    const h = harness();
    h.loop.listen();
    expect(h.canvas.types()).toEqual([
      "webglcontextlost",
      "webglcontextrestored",
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "pointerleave",
      "wheel",
      "gesturestart",
      "gesturechange",
      "gestureend",
    ]);
    expect(h.queries.map((query) => query.media)).toEqual(["(resolution: 2dppx)"]);
    expect(h.queries[0].types()).toEqual(["change"]);
  });

  it("wakes at rest when the pointer does anything on the canvas", () => {
    const h = harness();
    h.loop.listen();
    h.loop.start();
    h.clock.untilRest();
    expect(h.clock.pending.size).toBe(0);
    h.canvas.dispatchEvent(new Event("wheel"));
    expect(h.clock.pending.size).toBe(1);
  });

  it("draws nothing while the context is lost, asks for it back, and draws anew once it returns, moving or not", () => {
    const h = harness();
    h.loop.listen();
    h.loop.start();
    h.clock.untilRest();
    const drawn = h.loop.framesDrawn;
    const lost = new Event("webglcontextlost", { cancelable: true });
    h.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(h.told).toEqual(["lost"]);
    // Resized meanwhile: sized, but not drawn.
    h.loop.applySize(500, 400);
    expect(h.rig.viewport).toEqual({ width: 500, height: 400 });
    expect(h.loop.framesDrawn).toBe(drawn);
    expect(h.clock.pending.size).toBe(0);

    h.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(h.told).toEqual(["lost", "restored"]);
    expect(h.clock.pending.size).toBe(1);
    h.clock.tick();
    expect(h.loop.framesDrawn).toBe(drawn + 1);

    // Lost again while something moves: even a wake asks for no frame until it is back.
    h.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    h.loop.wake();
    expect(h.clock.pending.size).toBe(0);
  });

  it("draws nothing while paused, and once shown again draws a fresh picture even with nothing moving", () => {
    const h = harness();
    h.loop.start();
    h.clock.untilRest();
    h.loop.setPaused(true);
    expect(h.clock.pending.size).toBe(0);
    h.loop.setPaused(false);
    expect(h.clock.pending.size).toBe(1);
    // Told again that it is shown, when it was: nothing new to draw.
    h.clock.untilRest();
    h.loop.setPaused(false);
    expect(h.clock.pending.size).toBe(0);
    // Paused, even a wake asks for no frame.
    h.loop.setPaused(true);
    h.loop.wake();
    expect(h.clock.pending.size).toBe(0);
  });

  it("follows the screen's pixel ratio: a new one re-arms the watch for it and redraws at its size", () => {
    const h = harness();
    h.loop.listen();
    h.loop.applySize(800, 600);
    h.loop.start();
    h.clock.untilRest();
    const drawn = h.loop.framesDrawn;
    h.page.devicePixelRatio = 1;
    h.queries[0].dispatchEvent(new Event("change"));
    expect(h.queries.map((query) => query.media)).toEqual(["(resolution: 2dppx)", "(resolution: 1dppx)"]);
    expect(h.queries[0].types()).toEqual([]);
    expect(h.queries[1].types()).toEqual(["change"]);
    expect(h.renderer.ratios.at(-1)).toBe(1);
    expect(h.renderer.sizes.at(-1)).toEqual([800, 600, false]);
    expect(h.loop.framesDrawn).toBe(drawn + 1);
    expect(h.clock.pending.size).toBe(1);
  });

  it("disposed, requests no frame ever again and takes off every listener it put on", () => {
    const h = harness();
    h.loop.listen();
    h.loop.start();
    h.loop.onFrame(() => h.told.push("frame"));
    h.loop.dispose();
    expect(h.canvas.types()).toEqual([]);
    expect(h.queries[0].types()).toEqual([]);
    expect(h.clock.pending.size).toBe(0);
    h.loop.wake();
    h.loop.setPaused(true);
    h.loop.setPaused(false);
    h.loop.setKeepAwake(true);
    expect(h.clock.pending.size).toBe(0);
    expect(h.told).toEqual([]);
  });
});

describe("RenderLoop: adaptive quality", () => {
  it("under steady overload lowers the pixel-ratio cap rung by rung, redrawing at each, and then turns the shadows off", () => {
    const h = harness("high");
    h.loop.applySize(800, 600);
    h.loop.setKeepAwake(true);
    h.loop.start();
    // Frames 150 ms apart: every one an outlier, which is overload in any window.
    for (let frame = 0; frame < 200; frame += 1) h.clock.tick(150);
    expect(h.renderer.ratios).toEqual([2, 1.5, 1]);
    expect(h.shadows).toEqual([false]);
    // Each pixel-ratio rung is applied and drawn at once, in the frame that took it: one picture more than the frames
    // played for each, besides the first size's.
    const played = h.log.filter((entry) => entry.what === "highlights").length;
    expect(h.renderer.sizes).toHaveLength(3);
    expect(draws(h)).toBe(played + 3);
  });

  it("judges nothing while the office plan keeps changing: a new plan means new shaders, so it waits again", () => {
    const h = harness("high");
    h.loop.applySize(800, 600);
    h.loop.setKeepAwake(true);
    h.loop.start();
    for (let frame = 0; frame < 200; frame += 1) {
      // A new plan every second.
      if (frame % 7 === 0) h.frames.layout = getOfficeLayout(frame % 14 === 0 ? 1 : 2);
      h.clock.tick(150);
    }
    expect(h.renderer.ratios).toEqual([2]);
    expect(h.shadows).toEqual([]);
  });
});
