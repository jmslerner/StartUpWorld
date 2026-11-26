import { describe, expect, it, vi } from "vitest";
import type { InteractableTarget, ScreenPoint, WorldHandle } from "../types";
import { createStage, INITIAL_STAGE_STATE } from "./stage";

/** The two calls of a world the stage makes, recorded. */
const fakeHandle = (at: ScreenPoint | null): { handle: WorldHandle; selected: (InteractableTarget | null)[] } => {
  const selected: (InteractableTarget | null)[] = [];
  const handle = {
    setSelected: (target: InteractableTarget | null) => void selected.push(target),
    project: () => at,
  } as unknown as WorldHandle;
  return { handle, selected };
};

const DESK: InteractableTarget = { kind: "desk", desk: 2 };
const DOOR: InteractableTarget = { kind: "door" };

describe("the stage store", () => {
  it("starts with nothing: no world, no hover, no selection, no size, no anchor", () => {
    const stage = createStage();
    expect(stage.store.getState()).toEqual({ status: "starting", handle: null, hover: null, selected: null, size: { width: 0, height: 0 } });
    expect(stage.anchor.get()).toBeNull();
  });

  it("the stage store hands the latest anchor to whoever asks, and forgets it on reset", () => {
    const stage = createStage();
    const heard: (ScreenPoint | null)[] = [];
    const stop = stage.anchor.subscribe((point) => heard.push(point));
    const late: (ScreenPoint | null)[] = [];

    stage.anchor.set({ x: 10, y: 20 });
    stage.anchor.set({ x: 11, y: 21 });
    expect(stage.anchor.get()).toEqual({ x: 11, y: 21 });
    // Somebody who starts listening later is told from then on, and can ask for the latest.
    stage.anchor.subscribe((point) => late.push(point));
    stage.anchor.set({ x: 12, y: 22 });
    expect(heard).toEqual([{ x: 10, y: 20 }, { x: 11, y: 21 }, { x: 12, y: 22 }]);
    expect(late).toEqual([{ x: 12, y: 22 }]);

    stage.store.setState({ status: "running", selected: DESK, size: { width: 800, height: 500 } });
    stage.reset();
    expect(stage.anchor.get()).toBeNull();
    expect(stage.store.getState()).toEqual(INITIAL_STAGE_STATE);
    expect(heard[heard.length - 1]).toBeNull();

    // Whoever stopped listening hears no more.
    stop();
    stage.anchor.set({ x: 1, y: 1 });
    expect(heard).toHaveLength(4);
    expect(late[late.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it("selecting tells the world, the store and the anchor in one step", () => {
    const stage = createStage();
    const { handle, selected } = fakeHandle({ x: 300, y: 200 });
    stage.store.setState({ status: "running", handle });

    stage.select(DESK);
    expect(selected).toEqual([DESK]);
    expect(stage.store.getState().selected).toEqual(DESK);
    expect(stage.anchor.get()).toEqual({ x: 300, y: 200 });

    stage.select(null);
    expect(selected).toEqual([DESK, null]);
    expect(stage.store.getState().selected).toBeNull();
    expect(stage.anchor.get()).toBeNull();
  });

  it("selecting something that is not in the scene, or with no world yet, leaves no anchor", () => {
    const gone = createStage();
    gone.store.setState({ handle: fakeHandle(null).handle });
    gone.select(DOOR);
    expect(gone.store.getState().selected).toEqual(DOOR);
    expect(gone.anchor.get()).toBeNull();

    const early = createStage();
    early.anchor.set({ x: 5, y: 5 });
    expect(() => early.select(DOOR)).not.toThrow();
    expect(early.store.getState().selected).toEqual(DOOR);
    expect(early.anchor.get()).toBeNull();
  });

  it("tells only those who listen to the part that changed, and two stages share nothing", () => {
    const stage = createStage();
    const other = createStage();
    const states = vi.fn();
    stage.store.subscribe(states);
    stage.anchor.set({ x: 1, y: 2 });
    // The anchor moves every frame: it does not go through the store.
    expect(states).not.toHaveBeenCalled();
    stage.store.setState({ status: "unsupported" });
    expect(states).toHaveBeenCalledTimes(1);
    expect(other.store.getState().status).toBe("starting");
    expect(other.anchor.get()).toBeNull();
    // A reset of one leaves the shared starting state as it was.
    stage.reset();
    expect(INITIAL_STAGE_STATE).toEqual({ status: "starting", handle: null, hover: null, selected: null, size: { width: 0, height: 0 } });
  });

  it("tells every tap, the same one twice included, until a listener stops; a reset keeps listeners", () => {
    const stage = createStage();
    const seen: unknown[] = [];
    const stop = stage.taps.subscribe((target) => seen.push(target));
    stage.taps.tell(DESK);
    stage.taps.tell(DESK);
    stage.reset();
    stage.taps.tell(null);
    stop();
    stage.taps.tell(DOOR);
    expect(seen).toEqual([DESK, DESK, null]);
  });

  it("a listener that throws does not keep the others from hearing the tap", () => {
    const stage = createStage();
    const seen: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stage.taps.subscribe(() => {
      throw new Error("broken listener");
    });
    stage.taps.subscribe((target) => seen.push(target));
    expect(() => stage.taps.tell(DOOR)).not.toThrow();
    expect(seen).toEqual([DOOR]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
