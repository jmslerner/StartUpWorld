import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../engine";
import { useGameStore } from "../state/useGameStore";
import { useUiStore } from "../state/useUiStore";
import type { WorldSnapshot } from "./types";
import { createStage, INITIAL_STAGE_STATE, type Stage } from "./ui/stage";

/**
 * mountWorld in node: the world itself (WebGL) and the sound are faked, the
 * DOM pieces it touches (observers, document, window) are stubbed, and the
 * game store, snapshot builder and event diff are the real ones.
 */
const fakes = vi.hoisted(() => {
  const handle = {
    setSnapshot: vi.fn<(snapshot: unknown, events?: unknown) => void>(),
    resize: vi.fn(),
    setPaused: vi.fn(),
    setSelected: vi.fn(),
    hiddenCount: vi.fn(() => 0),
    dispose: vi.fn(),
  };
  const audio = {
    dispose: vi.fn(),
    play: vi.fn(),
    handleEvents: vi.fn(),
    setWorldVisible: vi.fn(),
    setDusk: vi.fn(),
    ui: { hover: vi.fn(), open: vi.fn(), select: vi.fn(), close: vi.fn(), zoom: vi.fn() },
  };
  class WorldUnsupportedError extends Error {}
  const createWorld = vi.fn((): unknown => handle);
  return { handle, audio, createWorld, WorldUnsupportedError };
});

vi.mock("./core/World", () => ({
  createWorld: fakes.createWorld,
  inspectWorld: vi.fn(),
  WorldUnsupportedError: fakes.WorldUnsupportedError,
}));
vi.mock("../audio/worldAudio", () => ({ createWorldAudio: () => fakes.audio }));
vi.mock("./ui/environment", () => ({
  detectQuality: () => "high",
  prefersReducedMotion: () => false,
  hasFinePointer: () => true,
}));

const { mountWorld } = await import("./mountWorld");

/** Live DOM resources, so a test can tell what was left behind. */
const live = {
  resizeObservers: new Set<object>(),
  intersectionObservers: new Set<object>(),
  listeners: new Set<EventListenerOrEventListenerObject>(),
  failIntersectionObserve: false,
};

class FakeResizeObserver {
  observe(): void {
    live.resizeObservers.add(this);
  }
  disconnect(): void {
    live.resizeObservers.delete(this);
  }
}

class FakeIntersectionObserver {
  observe(): void {
    if (live.failIntersectionObserve) throw new Error("observe failed");
    live.intersectionObservers.add(this);
  }
  disconnect(): void {
    live.intersectionObservers.delete(this);
  }
}

const canvas = {} as HTMLCanvasElement;
const viewport = { clientWidth: 800, clientHeight: 600 } as HTMLElement;
let stage: Stage;
let consoleError: ReturnType<typeof vi.spyOn>;

const expectNothingLeft = (): void => {
  expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
  expect(fakes.audio.dispose).toHaveBeenCalledTimes(1);
  expect(live.resizeObservers.size).toBe(0);
  expect(live.intersectionObservers.size).toBe(0);
  expect(live.listeners.size).toBe(0);
  expect(Reflect.has(window, "__startupWorld")).toBe(false);
  // No game-store subscription survives: a later state change reaches no world.
  const calls = fakes.handle.setSnapshot.mock.calls.length;
  useGameStore.setState({ state: { ...useGameStore.getState().state, week: 99 } });
  expect(fakes.handle.setSnapshot).toHaveBeenCalledTimes(calls);
};

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => live.listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => live.listeners.delete(listener),
  });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  live.resizeObservers.clear();
  live.intersectionObservers.clear();
  live.listeners.clear();
  live.failIntersectionObserve = false;
  vi.clearAllMocks();
  fakes.createWorld.mockImplementation(() => fakes.handle);
  fakes.handle.setSnapshot.mockImplementation(() => undefined);
  useGameStore.setState({ state: createInitialState(), lastAction: null });
  useUiStore.getState().setWorldUnsupported(false);
  stage = createStage();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

describe("mountWorld", () => {
  it("feeds the world and tears everything down on unmount", () => {
    const cleanup = mountWorld(canvas, viewport, stage);
    expect(stage.store.getState().status).toBe("running");
    expect(fakes.handle.setSnapshot).toHaveBeenCalledTimes(1);
    expect(live.resizeObservers.size).toBe(1);
    expect(live.intersectionObservers.size).toBe(1);
    expect(live.listeners.size).toBe(1);

    cleanup();
    expectNothingLeft();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    // A second call (it is the effect's cleanup; nothing else calls it) changes nothing.
    cleanup();
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("disposes the world, its sound and observers when the first snapshot cannot be applied", () => {
    fakes.handle.setSnapshot.mockImplementation(() => {
      throw new Error("bad snapshot");
    });
    const cleanup = mountWorld(canvas, viewport, stage);

    expectNothingLeft();
    expect(stage.store.getState().status).toBe("unsupported");
    expect(stage.store.getState().handle).toBeNull();
    expect(useUiStore.getState().worldUnsupported).toBe(true);
    expect(consoleError).toHaveBeenCalledWith("[world] Could not start the 3D view.", expect.any(Error));

    cleanup();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    expect(fakes.handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("undoes the store subscription too when a later step of the mount fails", () => {
    live.failIntersectionObserve = true;
    mountWorld(canvas, viewport, stage);
    expect(fakes.handle.setSnapshot).toHaveBeenCalledTimes(1);
    expectNothingLeft();
    expect(stage.store.getState().status).toBe("unsupported");
  });

  it("still tears down the rest when a dispose fails during a failed start", () => {
    fakes.handle.setSnapshot.mockImplementation(() => {
      throw new Error("bad snapshot");
    });
    fakes.handle.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });
    mountWorld(canvas, viewport, stage);
    expect(live.resizeObservers.size).toBe(0);
    expect(fakes.audio.dispose).toHaveBeenCalledTimes(1);
    expect(stage.store.getState().status).toBe("unsupported");
  });

  it("falls back quietly when the device has no WebGL 2", () => {
    fakes.createWorld.mockImplementation(() => {
      throw new fakes.WorldUnsupportedError("no WebGL 2");
    });
    mountWorld(canvas, viewport, stage);
    expect(fakes.audio.dispose).toHaveBeenCalledTimes(1);
    expect(stage.store.getState().status).toBe("unsupported");
    expect(useUiStore.getState().worldUnsupported).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
    expect(live.resizeObservers.size).toBe(0);
  });

  it("mounts a save whose company phase it does not know, showing the garage", () => {
    useGameStore.setState({ state: { ...createInitialState(), companyPhase: "megacorp" as never } });
    const cleanup = mountWorld(canvas, viewport, stage);
    expect(stage.store.getState().status).toBe("running");
    const [first] = fakes.handle.setSnapshot.mock.calls[0] as [WorldSnapshot];
    expect(first.phase).toBe("garage");
    cleanup();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
