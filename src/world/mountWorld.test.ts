import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneFrames } from "./core/sceneFrames";
import { getOfficeLayout } from "./office/layouts";
import type { InteractableHit, OfficeIndex, OfficeScene, WorldCallbacks, WorldHandle, WorldOptions } from "./types";
import { createStage, INITIAL_STAGE_STATE, type WorldStage } from "./ui/stage";

/**
 * mountWorld in node: the world itself (WebGL) is faked and the DOM pieces the mount touches (observers, document,
 * window) are stubbed, each keeping count of what is still alive. The stage, the scene source and the device probe's
 * answers are real values.
 */
const fakes = vi.hoisted(() => {
  const makeHandle = () => ({
    setScene: vi.fn<(scene: unknown) => void>(),
    resize: vi.fn(),
    setSelected: vi.fn(),
    project: vi.fn(() => null),
    screenBounds: vi.fn(() => null),
    focus: vi.fn(),
    freeDeskSlots: vi.fn(() => []),
    hiddenCount: vi.fn(() => 0),
    zoomBy: vi.fn(),
    resetCamera: vi.fn(),
    setPaused: vi.fn(),
    setKeepAwake: vi.fn(),
    stats: vi.fn(() => ({ drawCalls: 0, triangles: 0, geometries: 0, textures: 0, figures: 0, hidden: 0, framesDrawn: 0 })),
    loseContext: vi.fn(),
    restoreContext: vi.fn(),
    teamOf: vi.fn(() => null),
    personAt: vi.fn(() => null),
    releaseFirst: vi.fn(),
    settle: vi.fn(),
    dispose: vi.fn(),
  });
  const handle = makeHandle();
  class WorldUnsupportedError extends Error {}
  const createWorld = vi.fn<(...args: unknown[]) => unknown>(() => handle);
  const environment = {
    detectQuality: vi.fn(() => "high"),
    prefersReducedMotion: vi.fn(() => false),
    hasFinePointer: vi.fn(() => true),
  };
  return { handle, makeHandle, createWorld, WorldUnsupportedError, environment };
});

vi.mock("./core/World", () => ({
  createWorld: fakes.createWorld,
  inspectWorld: vi.fn(() => null),
  WorldUnsupportedError: fakes.WorldUnsupportedError,
}));
vi.mock("./ui/environment", () => fakes.environment);

const { mountWorld, watchStage } = await import("./mountWorld");
type SceneSource = import("./mountWorld").SceneSource;

/** Live DOM resources, so a test can tell what was left behind. */
const live = {
  resizeObservers: new Set<FakeResizeObserver>(),
  intersectionObservers: new Set<FakeIntersectionObserver>(),
  listeners: new Map<string, Set<EventListenerOrEventListenerObject>>(),
  timers: 0,
  frameRequests: 0,
  failIntersectionObserve: false,
};

class FakeResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe(): void {
    live.resizeObservers.add(this);
  }
  disconnect(): void {
    live.resizeObservers.delete(this);
  }
  fire(): void {
    this.callback();
  }
}

class FakeIntersectionObserver {
  private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void;
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    this.callback = callback;
  }
  observe(): void {
    if (live.failIntersectionObserve) throw new Error("observe failed");
    live.intersectionObservers.add(this);
  }
  disconnect(): void {
    live.intersectionObservers.delete(this);
  }
  fire(...visible: boolean[]): void {
    this.callback(visible.map((isIntersecting) => ({ isIntersecting })));
  }
}

const scene = (patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "run",
  seed: 7,
  year: 1990,
  office: 1,
  capacity: 9,
  era: "any",
  teams: { product: 3, growth: 2, recruiting: 1 },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});

/** A tiny scene source: one value, and listeners that are told when it changes. */
interface Source extends SceneSource {
  set(next: OfficeScene): void;
  /** Tell the listeners without changing anything. */
  ping(): void;
  listeners: Set<() => void>;
}

const sourceOf = (first: OfficeScene): Source => {
  let current = first;
  const listeners = new Set<() => void>();
  return {
    listeners,
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      current = next;
      for (const listener of [...listeners]) listener();
    },
    ping: () => {
      for (const listener of [...listeners]) listener();
    },
  };
};

const canvas = {} as HTMLCanvasElement;
const viewport = { clientWidth: 800, clientHeight: 600 };
const fakeDocument = { hidden: false };
let stage: WorldStage;
let source: Source;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

const mount = (): (() => void) => mountWorld(canvas, viewport as HTMLElement, stage, source);

/** The callbacks and options the mount handed to createWorld, for its latest call. */
const created = (): { callbacks: WorldCallbacks; options: WorldOptions } => {
  const call = fakes.createWorld.mock.calls[fakes.createWorld.mock.calls.length - 1];
  return { callbacks: call[1] as WorldCallbacks, options: call[2] as WorldOptions };
};

const listenerCount = (): number => [...live.listeners.values()].reduce((sum, set) => sum + set.size, 0);
const only = <T>(set: Set<T>): T => {
  expect(set.size).toBe(1);
  return [...set][0];
};

/** Nothing of a mount is left on the page, and nothing reaches its world any more. */
const expectNothingLeft = (handle = fakes.handle): void => {
  expect(handle.dispose).toHaveBeenCalledTimes(1);
  expect(live.resizeObservers.size).toBe(0);
  expect(live.intersectionObservers.size).toBe(0);
  expect(listenerCount()).toBe(0);
  expect(live.timers).toBe(0);
  expect(live.frameRequests).toBe(0);
  expect(source.listeners.size).toBe(0);
  expect(Reflect.has(window, "__startupWorld")).toBe(false);
  // No subscription survives: a later scene reaches no world.
  const calls = handle.setScene.mock.calls.length;
  source.set(scene({ year: 2099 }));
  expect(handle.setScene).toHaveBeenCalledTimes(calls);
  expect(stage.store.getState().handle).toBeNull();
  expect(stage.anchor.get()).toBeNull();
};

beforeEach(() => {
  // The mount itself must set no timer and request no frame; these count any it does.
  vi.stubGlobal("window", {});
  vi.stubGlobal("setTimeout", () => {
    live.timers += 1;
    return 0;
  });
  vi.stubGlobal("setInterval", () => {
    live.timers += 1;
    return 0;
  });
  vi.stubGlobal("requestAnimationFrame", () => {
    live.frameRequests += 1;
    return 0;
  });
  fakeDocument.hidden = false;
  vi.stubGlobal("document", {
    get hidden() {
      return fakeDocument.hidden;
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (!live.listeners.has(type)) live.listeners.set(type, new Set());
      live.listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      live.listeners.get(type)?.delete(listener);
    },
  });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  live.resizeObservers.clear();
  live.intersectionObservers.clear();
  live.listeners.clear();
  live.timers = 0;
  live.frameRequests = 0;
  live.failIntersectionObserve = false;
  viewport.clientWidth = 800;
  viewport.clientHeight = 600;
  vi.clearAllMocks();
  fakes.createWorld.mockImplementation(() => fakes.handle);
  fakes.handle.setScene.mockImplementation(() => undefined);
  fakes.handle.dispose.mockImplementation(() => undefined);
  fakes.environment.detectQuality.mockImplementation(() => "high");
  fakes.environment.prefersReducedMotion.mockImplementation(() => false);
  fakes.environment.hasFinePointer.mockImplementation(() => true);
  stage = createStage();
  source = sourceOf(scene());
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
});

const fireVisibility = (): void => {
  for (const listener of live.listeners.get("visibilitychange") ?? []) (listener as () => void)();
};

describe("mountWorld", () => {
  it("feeds the world its first scene, and every later one", () => {
    const first = source.get();
    const cleanup = mount();
    expect(stage.store.getState().status).toBe("running");
    expect(stage.store.getState().handle).toBe(fakes.handle);
    expect(fakes.createWorld).toHaveBeenCalledTimes(1);
    expect(fakes.createWorld.mock.calls[0][0]).toBe(canvas);
    expect(fakes.handle.setScene.mock.calls).toEqual([[first]]);

    const second = scene({ year: 1991, teams: { product: 4, growth: 2, recruiting: 1 } });
    source.set(second);
    const third = scene({ year: 1992, office: 2, capacity: 22 });
    source.set(third);
    expect(fakes.handle.setScene.mock.calls).toEqual([[first], [second], [third]]);
    // The scene is handed over as it is: the world works out the people and what changed by itself.
    expect(fakes.handle.setScene.mock.calls[2][0]).toBe(third);

    // Being told of a change when the scene is the very same value is not a new scene.
    source.ping();
    source.ping();
    expect(fakes.handle.setScene).toHaveBeenCalledTimes(3);
    cleanup();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("the world has its size before its first scene", () => {
    const order: string[] = [];
    fakes.handle.resize.mockImplementation(() => order.push("resize"));
    fakes.handle.setScene.mockImplementation(() => order.push("scene"));
    mount()();
    expect(order).toEqual(["resize", "scene"]);
  });

  it("resizes with the viewport, skipping sizes of nothing and repeats", () => {
    const cleanup = mount();
    expect(fakes.handle.resize.mock.calls).toEqual([[800, 600]]);
    expect(stage.store.getState().size).toEqual({ width: 800, height: 600 });
    const observer = only(live.resizeObservers);

    // The observer reports the same size again: nothing to do.
    observer.fire();
    expect(fakes.handle.resize).toHaveBeenCalledTimes(1);

    viewport.clientWidth = 390;
    viewport.clientHeight = 844;
    observer.fire();
    expect(fakes.handle.resize.mock.calls[1]).toEqual([390, 844]);
    expect(stage.store.getState().size).toEqual({ width: 390, height: 844 });

    // Sized to nothing (hidden with display none, a collapsed panel): the world keeps the size it had.
    for (const [width, height] of [[0, 844], [390, 0], [0, 0], [-5, 20]]) {
      viewport.clientWidth = width;
      viewport.clientHeight = height;
      observer.fire();
    }
    expect(fakes.handle.resize).toHaveBeenCalledTimes(2);
    expect(stage.store.getState().size).toEqual({ width: 390, height: 844 });

    // Shown again at the size it had: still nothing to do. At another size: resized.
    viewport.clientWidth = 390;
    viewport.clientHeight = 844;
    observer.fire();
    expect(fakes.handle.resize).toHaveBeenCalledTimes(2);
    viewport.clientWidth = 1280;
    viewport.clientHeight = 800;
    observer.fire();
    expect(fakes.handle.resize.mock.calls[2]).toEqual([1280, 800]);
    cleanup();
  });

  it("a viewport of no size at the start gets its size when it has one", () => {
    viewport.clientWidth = 0;
    viewport.clientHeight = 0;
    const cleanup = mount();
    expect(fakes.handle.resize).not.toHaveBeenCalled();
    expect(fakes.handle.setScene).toHaveBeenCalledTimes(1);
    viewport.clientWidth = 640;
    viewport.clientHeight = 480;
    only(live.resizeObservers).fire();
    expect(fakes.handle.resize.mock.calls).toEqual([[640, 480]]);
    cleanup();
  });

  it("pauses when the page is hidden or the view is off screen", () => {
    const cleanup = mount();
    const paused = (): boolean | undefined => fakes.handle.setPaused.mock.calls[fakes.handle.setPaused.mock.calls.length - 1]?.[0];
    // Seen and on a visible page, as far as anyone knows at the start.
    expect(paused()).toBe(false);
    const observer = only(live.intersectionObservers);
    expect(live.listeners.get("visibilitychange")?.size).toBe(1);

    observer.fire(false);
    expect(paused()).toBe(true);
    observer.fire(true);
    expect(paused()).toBe(false);
    // Several reports at once: the last one is how things stand.
    observer.fire(true, false);
    expect(paused()).toBe(true);
    observer.fire(false, true);
    expect(paused()).toBe(false);

    fakeDocument.hidden = true;
    fireVisibility();
    expect(paused()).toBe(true);
    // Scrolled back into view on a hidden page: still paused.
    observer.fire(true);
    expect(paused()).toBe(true);
    // Scrolled away while hidden, then the page is shown: still paused, until it is back on screen.
    observer.fire(false);
    fakeDocument.hidden = false;
    fireVisibility();
    expect(paused()).toBe(true);
    observer.fire(true);
    expect(paused()).toBe(false);
    cleanup();
  });

  it("reads the device inside the mount, once for each world, and hands the answers to it", () => {
    expect(fakes.environment.detectQuality).not.toHaveBeenCalled();
    expect(fakes.environment.prefersReducedMotion).not.toHaveBeenCalled();
    expect(fakes.environment.hasFinePointer).not.toHaveBeenCalled();
    fakes.environment.detectQuality.mockImplementation(() => "low");
    fakes.environment.prefersReducedMotion.mockImplementation(() => true);
    mount()();
    expect(created().options).toEqual({ quality: "low", reducedMotion: true });
    for (const probe of Object.values(fakes.environment)) expect(probe).toHaveBeenCalledTimes(1);

    fakes.environment.detectQuality.mockImplementation(() => "high");
    fakes.environment.prefersReducedMotion.mockImplementation(() => false);
    stage = createStage();
    mount()();
    expect(created().options).toEqual({ quality: "high", reducedMotion: false });
    for (const probe of Object.values(fakes.environment)) expect(probe).toHaveBeenCalledTimes(2);
  });

  it("mirrors what the world reports into the stage: hover with a mouse only, selection, the anchor", () => {
    const hit: InteractableHit = { target: { kind: "door" }, label: "Door", screen: { x: 10, y: 20 } };
    const cleanup = mount();
    const { callbacks } = created();
    callbacks.onHover(hit);
    expect(stage.store.getState().hover).toBe(hit);
    callbacks.onHover(null);
    expect(stage.store.getState().hover).toBeNull();
    callbacks.onSelect(hit);
    expect(stage.store.getState().selected).toEqual({ kind: "door" });
    expect(stage.anchor.get()).toEqual({ x: 10, y: 20 });
    callbacks.onSelectedAnchorMove?.({ x: 11, y: 22 });
    expect(stage.anchor.get()).toEqual({ x: 11, y: 22 });
    callbacks.onSelect(null);
    expect([stage.store.getState().selected, stage.anchor.get()]).toEqual([null, null]);
    cleanup();

    // A finger has no hover: the last thing touched must not stay marked as pointed at.
    fakes.environment.hasFinePointer.mockImplementation(() => false);
    stage = createStage();
    const touch = mount();
    created().callbacks.onHover(hit);
    expect(stage.store.getState().hover).toBeNull();
    created().callbacks.onSelect(hit);
    expect(stage.store.getState().selected).toEqual({ kind: "door" });
    touch();
  });

  it("each tap the world reports is told on the stage, the same person twice included", () => {
    const person: InteractableHit = { target: { kind: "person", personId: "p1" }, label: "Someone", screen: { x: 5, y: 6 } };
    const cleanup = mount();
    const { callbacks } = created();
    const heard: unknown[] = [];
    const selectedWhenHeard: unknown[] = [];
    stage.taps.subscribe((target) => {
      heard.push(target);
      selectedWhenHeard.push(stage.store.getState().selected);
    });
    callbacks.onSelect(person);
    expect(stage.store.getState().selected).toEqual({ kind: "person", personId: "p1" });
    callbacks.onSelect(person);
    callbacks.onSelect(null);
    expect(stage.store.getState().selected).toBeNull();
    expect(heard).toEqual([{ kind: "person", personId: "p1" }, { kind: "person", personId: "p1" }, null]);
    // The store is up to date by the time the tap is told.
    expect(selectedWhenHeard).toEqual(heard);
    cleanup();
    // Once the mount is gone, what its world still reports is not told.
    callbacks.onSelect(person);
    expect(heard).toHaveLength(3);
  });

  it("another run clears what was selected: it belonged to the other company", () => {
    const cleanup = mount();
    stage.select({ kind: "desk", desk: 2 });
    source.set(scene({ year: 1991 }));
    expect(stage.store.getState().selected).toEqual({ kind: "desk", desk: 2 });
    source.set(scene({ runId: "another" }));
    expect(stage.store.getState().selected).toBeNull();
    expect(fakes.handle.setSelected).toHaveBeenLastCalledWith(null);
    cleanup();
  });

  it("a lost context is said on the stage, and a restored one too", () => {
    const hit: InteractableHit = { target: { kind: "door" }, label: "Door", screen: { x: 10, y: 20 } };
    const cleanup = mount();
    const { callbacks } = created();
    callbacks.onHover(hit);
    callbacks.onContextLost?.();
    expect(stage.store.getState().status).toBe("context-lost");
    expect(stage.store.getState().hover).toBeNull();
    // The world is still the stage's: it is the one to dispose, and a restore brings it back.
    expect(stage.store.getState().handle).toBe(fakes.handle);
    callbacks.onContextRestored?.();
    expect(stage.store.getState().status).toBe("running");
    callbacks.onContextLost?.();
    cleanup();
    expectNothingLeft();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    // Whatever the old world still reports after it is gone changes nothing.
    callbacks.onContextRestored?.();
    callbacks.onContextLost?.();
    callbacks.onHover(hit);
    callbacks.onSelect(hit);
    callbacks.onSelectedAnchorMove?.({ x: 1, y: 1 });
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    expect(stage.anchor.get()).toBeNull();
  });

  it("leaves nothing behind when it is torn down, twice over, or when a step of the teardown throws (Review Focus 3)", () => {
    const cleanup = mount();
    expect(live.resizeObservers.size).toBe(1);
    expect(live.intersectionObservers.size).toBe(1);
    expect(listenerCount()).toBe(1);
    expect(source.listeners.size).toBe(1);
    expect(Reflect.has(window, "__startupWorld")).toBe(true);
    stage.select({ kind: "door" });

    cleanup();
    expectNothingLeft();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    // A second call (React runs an effect's cleanup once, a careless caller twice) changes nothing.
    cleanup();
    cleanup();
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();

    // Every step of the teardown throws in turn: the others still run, nothing is left, and the caller is not thrown at.
    const breakers: Array<[string, () => void]> = [
      ["dispose", () => fakes.handle.dispose.mockImplementationOnce(() => {
        throw new Error("dispose failed");
      })],
      ["resize observer", () => vi.spyOn(only(live.resizeObservers), "disconnect").mockImplementationOnce(function (this: FakeResizeObserver) {
        live.resizeObservers.delete(this);
        throw new Error("disconnect failed");
      })],
      ["intersection observer", () => vi.spyOn(only(live.intersectionObservers), "disconnect").mockImplementationOnce(function (this: FakeIntersectionObserver) {
        live.intersectionObservers.delete(this);
        throw new Error("disconnect failed");
      })],
    ];
    for (const [name, arm] of breakers) {
      vi.clearAllMocks();
      fakes.createWorld.mockImplementation(() => fakes.handle);
      stage = createStage();
      source = sourceOf(scene());
      const again = mount();
      arm();
      expect(() => again(), name).not.toThrow();
      expectNothingLeft();
      expect(stage.store.getState(), name).toEqual(INITIAL_STAGE_STATE);
      expect(consoleError, name).toHaveBeenCalledTimes(1);
      again();
      expect(fakes.handle.dispose, name).toHaveBeenCalledTimes(1);
    }

    // A source whose unsubscribe throws: the same.
    vi.clearAllMocks();
    stage = createStage();
    source = sourceOf(scene());
    const subscribe = source.subscribe;
    source.subscribe = (listener) => {
      const stop = subscribe(listener);
      return () => {
        stop();
        throw new Error("unsubscribe failed");
      };
    };
    const last = mount();
    expect(() => last()).not.toThrow();
    expectNothingLeft();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("mounted and torn down twenty times, the page holds what it held before the first", () => {
    for (let round = 0; round < 20; round += 1) {
      stage = createStage();
      const cleanup = mount();
      source.set(scene({ year: 1990 + round }));
      only(live.intersectionObservers).fire(false);
      cleanup();
    }
    expect(fakes.createWorld).toHaveBeenCalledTimes(20);
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(20);
    expect([live.resizeObservers.size, live.intersectionObservers.size, listenerCount(), source.listeners.size]).toEqual([0, 0, 0, 0]);
    expect([live.timers, live.frameRequests]).toEqual([0, 0]);
    expect(Reflect.has(window, "__startupWorld")).toBe(false);
  });

  it("says the view is not supported when no context can be had, and throws nothing (Review Focus 5)", () => {
    fakes.createWorld.mockImplementation(() => {
      throw new fakes.WorldUnsupportedError("no WebGL 2");
    });
    let cleanup: () => void = () => undefined;
    expect(() => {
      cleanup = mount();
    }).not.toThrow();
    expect(stage.store.getState().status).toBe("unsupported");
    expect(stage.store.getState().handle).toBeNull();
    // An expected situation: nothing for the console, and nothing was set up.
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect([live.resizeObservers.size, live.intersectionObservers.size, listenerCount(), source.listeners.size]).toEqual([0, 0, 0, 0]);
    expect(fakes.handle.setScene).not.toHaveBeenCalled();
    expect(Reflect.has(window, "__startupWorld")).toBe(false);
    // Later scenes change nothing and throw nothing.
    expect(() => source.set(scene({ year: 1991 }))).not.toThrow();

    expect(() => cleanup()).not.toThrow();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    cleanup();
    expect(fakes.handle.dispose).not.toHaveBeenCalled();
  });

  it("says the same when the world fails to start for any other reason, with a line for the console", () => {
    fakes.createWorld.mockImplementation(() => {
      throw new Error("a bug");
    });
    const cleanup = mount();
    expect(stage.store.getState().status).toBe("unsupported");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[world] Could not start the 3D view.", expect.any(Error));
    cleanup();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);

    // The device probe failing counts as that too.
    consoleError.mockClear();
    fakes.createWorld.mockImplementation(() => fakes.handle);
    fakes.environment.detectQuality.mockImplementation(() => {
      throw new Error("no screen");
    });
    stage = createStage();
    expect(() => mount()()).not.toThrow();
    expect(fakes.createWorld).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("takes the world down again when its first scene cannot be applied", () => {
    fakes.handle.setScene.mockImplementation(() => {
      throw new Error("bad scene");
    });
    const cleanup = mount();
    expectNothingLeft();
    expect(stage.store.getState().status).toBe("unsupported");
    expect(consoleError).toHaveBeenCalledWith("[world] Could not start the 3D view.", expect.any(Error));
    cleanup();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("undoes everything set up so far when a later step of the mount fails, even if the undoing fails too", () => {
    live.failIntersectionObserve = true;
    mount();
    expect(fakes.handle.setScene).toHaveBeenCalledTimes(1);
    expectNothingLeft();
    expect(stage.store.getState().status).toBe("unsupported");

    vi.clearAllMocks();
    consoleError.mockClear();
    stage = createStage();
    source = sourceOf(scene());
    fakes.handle.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });
    expect(() => mount()).not.toThrow();
    expect(live.resizeObservers.size).toBe(0);
    expect(source.listeners.size).toBe(0);
    expect(stage.store.getState().status).toBe("unsupported");
    // One line for the failed dispose, one for the failed start.
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("a later scene the world cannot take is logged once and does not stop the ones after it", () => {
    const cleanup = mount();
    fakes.handle.setScene.mockImplementationOnce(() => {
      throw new Error("bad scene");
    });
    expect(() => source.set(scene({ year: 1991 }))).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(stage.store.getState().status).toBe("running");
    const good = scene({ year: 1992 });
    source.set(good);
    expect(fakes.handle.setScene).toHaveBeenLastCalledWith(good);
    cleanup();
    expectNothingLeft();
  });

  it("a source that keeps telling after it was asked to stop reaches no world", () => {
    source.subscribe = (listener) => {
      source.listeners.add(listener);
      return () => undefined;
    };
    const cleanup = mount();
    cleanup();
    expect(source.listeners.size).toBe(1);
    expect(() => source.set(scene({ year: 1999 }))).not.toThrow();
    expect(fakes.handle.setScene).toHaveBeenCalledTimes(1);
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
  });

  it("only one world lives at a time: a second mount takes the first down before it creates its own", () => {
    const firstStage = stage;
    const firstSource = source;
    const firstCleanup = mount();
    expect(firstStage.store.getState().handle).toBe(fakes.handle);

    const second = fakes.makeHandle();
    const order: string[] = [];
    fakes.handle.dispose.mockImplementation(() => order.push("first disposed"));
    fakes.createWorld.mockImplementation(() => {
      order.push("second created");
      return second;
    });
    stage = createStage();
    source = sourceOf(scene({ runId: "second" }));
    const secondCleanup = mount();

    expect(order).toEqual(["first disposed", "second created"]);
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
    expect(firstStage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    expect(firstSource.listeners.size).toBe(0);
    expect(stage.store.getState().handle).toBe(second);
    expect(stage.store.getState().status).toBe("running");
    expect([live.resizeObservers.size, live.intersectionObservers.size, listenerCount()]).toEqual([1, 1, 1]);
    // It is a mistake of whoever mounted twice, and the console says so.
    expect(consoleWarn).toHaveBeenCalledTimes(1);

    // The first mount's own teardown, arriving late, touches nothing of the second.
    firstCleanup();
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(stage.store.getState().handle).toBe(second);
    expect([live.resizeObservers.size, source.listeners.size]).toEqual([1, 1]);
    expect(Reflect.has(window, "__startupWorld")).toBe(true);

    secondCleanup();
    expectNothingLeft(second as unknown as typeof fakes.handle);
    // With nothing living, a mount is just a mount again.
    consoleWarn.mockClear();
    stage = createStage();
    fakes.createWorld.mockImplementation(() => fakes.handle);
    mount()();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("a mount that never got a world leaves the way free for the next", () => {
    fakes.createWorld.mockImplementationOnce(() => {
      throw new fakes.WorldUnsupportedError("no WebGL 2");
    });
    mount();
    stage = createStage();
    const cleanup = mount();
    expect(stage.store.getState().status).toBe("running");
    expect(consoleWarn).not.toHaveBeenCalled();
    cleanup();
  });

  it("an office index out of range shows the garage", () => {
    // The mount hands the scene on as it is, and the world's own step from scene to frame picks the plan through
    // the layout's rule: an index that is not one of the five offices gives the garage.
    for (const office of [9, -1, 2.5, Number.NaN]) {
      vi.clearAllMocks();
      stage = createStage();
      source = sourceOf(scene({ office: office as OfficeIndex }));
      const cleanup = mount();
      expect(stage.store.getState().status).toBe("running");
      const [given] = fakes.handle.setScene.mock.calls[0] as [OfficeScene];
      expect(given).toBe(source.get());
      const staged = new SceneFrames().stage(given);
      expect(staged.layout, String(office)).toBe(getOfficeLayout(0));
      expect(staged.next.cast.people, String(office)).toHaveLength(6);
      cleanup();
      expect(consoleError).not.toHaveBeenCalled();
    }
  });
});

describe("watchStage", () => {
  const handleOf = (): WorldHandle => fakes.makeHandle() as unknown as WorldHandle;

  it("tells of the world and its status as they change, and of nothing else", () => {
    const seen: Array<{ status: string; handle: WorldHandle | null }> = [];
    const stop = watchStage(stage, (state) => seen.push(state));
    // Nothing yet: the view is starting and there is no world, which is where every listener begins.
    expect(seen).toEqual([]);
    const handle = handleOf();
    stage.store.setState({ status: "running", handle });
    expect(seen).toEqual([{ status: "running", handle }]);
    // Hover, selection and size are not the listener's business.
    stage.store.setState({ hover: null, size: { width: 3, height: 4 }, selected: { kind: "door" } });
    expect(seen).toHaveLength(1);
    stage.store.setState({ status: "context-lost" });
    stage.store.setState({ status: "running" });
    expect(seen.map((state) => state.status)).toEqual(["running", "context-lost", "running"]);
    expect(seen.every((state) => state.handle === handle)).toBe(true);
    stage.reset();
    expect(seen[3]).toEqual({ status: "starting", handle: null });
    stop();
    stage.store.setState({ status: "running", handle });
    expect(seen).toHaveLength(4);
  });

  it("a listener that arrives late is told how things stand", () => {
    const handle = handleOf();
    stage.store.setState({ status: "running", handle });
    const seen: unknown[] = [];
    watchStage(stage, (state) => seen.push(state))();
    expect(seen[0]).toEqual({ status: "running", handle });
  });

  it("never leaves its listener holding a world: stopping says the world is gone, once", () => {
    const seen: Array<{ status: string; handle: WorldHandle | null }> = [];
    const stop = watchStage(stage, (state) => seen.push(state));
    stage.store.setState({ status: "running", handle: handleOf() });
    stop();
    expect(seen[seen.length - 1]).toEqual({ status: "starting", handle: null });
    expect(seen).toHaveLength(2);
    stop();
    expect(seen).toHaveLength(2);

    // Already told that the world is gone, or never told of one: stopping adds nothing.
    stage.reset();
    const quiet: unknown[] = [];
    const stopQuiet = watchStage(stage, (state) => quiet.push(state));
    stopQuiet();
    expect(quiet).toEqual([]);
    const unsupported: unknown[] = [];
    const stopUnsupported = watchStage(stage, (state) => unsupported.push(state));
    stage.store.setState({ status: "unsupported" });
    stopUnsupported();
    expect(unsupported).toEqual([{ status: "unsupported", handle: null }, { status: "starting", handle: null }]);
  });

  it("works through a whole mount: running with the world, then gone", () => {
    const seen: Array<{ status: string; handle: WorldHandle | null }> = [];
    const stop = watchStage(stage, (state) => seen.push(state));
    const cleanup = mount();
    cleanup();
    stop();
    expect(seen).toEqual([
      { status: "running", handle: fakes.handle },
      { status: "starting", handle: null },
    ]);
  });
});
