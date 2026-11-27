import { describe, expect, it } from "vitest";
import { createLabelFollower, type AnimationFrames } from "./labelFollow";

const fakeFrames = () => {
  let next = 1;
  const queued = new Map<number, () => void>();
  const frames: AnimationFrames = {
    request: (callback) => {
      const id = next++;
      queued.set(id, callback);
      return id;
    },
    cancel: (id) => void queued.delete(id),
  };
  return {
    frames,
    get queued() {
      return queued.size;
    },
    /** Runs the frames asked for so far, as the browser would on its next animation frame. */
    flush() {
      const due = [...queued.values()];
      queued.clear();
      for (const callback of due) callback();
    },
  };
};

describe("createLabelFollower", () => {
  it("asks for no frame while nothing happens: the labels rest with the world", () => {
    const f = fakeFrames();
    let placed = 0;
    createLabelFollower(() => placed++, f.frames);
    f.flush();
    expect([placed, f.queued]).toEqual([0, 0]);
  });

  it("places the labels at once after each frame the world draws, and asks for no frame of its own", () => {
    const f = fakeFrames();
    let placed = 0;
    const follower = createLabelFollower(() => placed++, f.frames);
    follower.frameDrawn();
    follower.frameDrawn();
    expect([placed, f.queued]).toEqual([2, 0]);
  });

  it("places them once on the next frame however often it is woken, and then stops asking", () => {
    const f = fakeFrames();
    let placed = 0;
    const follower = createLabelFollower(() => placed++, f.frames);
    follower.wake();
    follower.wake();
    follower.wake();
    expect([placed, f.queued]).toEqual([0, 1]);
    f.flush();
    expect([placed, f.queued]).toEqual([1, 0]);
    f.flush();
    expect(placed).toBe(1);
    follower.wake();
    f.flush();
    expect(placed).toBe(2);
  });

  it("a world frame takes the place of a pending wake", () => {
    const f = fakeFrames();
    let placed = 0;
    const follower = createLabelFollower(() => placed++, f.frames);
    follower.wake();
    follower.frameDrawn();
    expect([placed, f.queued]).toEqual([1, 0]);
  });

  it("stopped, it cancels what is pending and places nothing more", () => {
    const f = fakeFrames();
    let placed = 0;
    const follower = createLabelFollower(() => placed++, f.frames);
    follower.wake();
    follower.stop();
    expect(f.queued).toBe(0);
    follower.wake();
    follower.frameDrawn();
    f.flush();
    expect(placed).toBe(0);
  });
});
