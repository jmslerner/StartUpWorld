import { describe, expect, it, vi } from "vitest";
import type { WorldHandle, WorldStats } from "../world/types/handle";
import { createLab, followAddress, framesSince, type Lab } from "./lab";
import { queryFromScene, sceneFromQuery } from "./labScene";

interface FakeHandle {
  readonly handle: WorldHandle;
  readonly calls: string[];
  frames: number;
}

/** Only what the lab touches of a world. */
const fakeHandle = (figures = 3): FakeHandle => {
  const fake: FakeHandle = {
    calls: [],
    frames: 0,
    handle: {
      setKeepAwake: (on: boolean) => void fake.calls.push(`awake:${on}`),
      loseContext: () => void fake.calls.push("lose"),
      restoreContext: () => void fake.calls.push("restore"),
      stats: (): WorldStats => ({ drawCalls: 40, triangles: 9000, geometries: 12, textures: 5, figures, hidden: 0, framesDrawn: fake.frames }),
    } as unknown as WorldHandle,
  };
  return fake;
};

const labAt = (query = ""): { lab: Lab; clock: { now: number } } => {
  const clock = { now: 0 };
  return { lab: createLab(query, () => clock.now), clock };
};

/** Let promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the lab's scene source", () => {
  it("starts from the address", () => {
    const { lab } = labAt("?office=2&product=9&panel=0");
    expect(lab.getState()).toMatchObject({ fitOffice: false, panelOpen: false, keepAwake: false, shown: true, status: "starting" });
    expect(lab.source.get()).toEqual(sceneFromQuery("?office=2&product=9"));
  });

  it("an address that asks for a fitted office gets one, whatever office it also names", () => {
    const { lab } = labAt("?office=4&product=3&fit=1");
    expect(lab.source.get()).toMatchObject({ office: 0, capacity: 4 });
  });

  it("is one object for good, and tells its listeners of every new scene with a new scene object", () => {
    const { lab } = labAt();
    const source = lab.source;
    const seen: unknown[] = [];
    const stop = source.subscribe(() => seen.push(source.get()));
    const first = source.get();
    lab.edit({ growth: 2 });
    lab.endYear();
    expect(lab.source).toBe(source);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(first);
    expect(seen[1]).not.toBe(seen[0]);
    expect(source.get()).toMatchObject({ year: 1991, teams: { product: 3, growth: 2, recruiting: 0 } });
    stop();
    lab.edit({ growth: 5 });
    expect(seen).toHaveLength(2);
  });

  it("a change that changes nothing tells nobody", () => {
    const { lab } = labAt();
    const listener = vi.fn();
    lab.subscribe(listener);
    lab.setPanelOpen(true);
    lab.setKeepAwake(false);
    lab.setShown(true);
    lab.edit({ product: 3, year: 1990 });
    lab.edit({});
    expect(listener).not.toHaveBeenCalled();
  });

  it("one listener that throws does not keep the others from hearing", () => {
    const { lab } = labAt();
    const heard = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    lab.subscribe(() => {
      throw new Error("no");
    });
    lab.subscribe(heard);
    expect(() => lab.edit({ growth: 1 })).not.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("the lab's controls", () => {
  it("the office follows the head count until one is chosen, and again once it is set free", () => {
    const { lab } = labAt();
    lab.edit({ product: 12 });
    expect(lab.getState().scene).toMatchObject({ office: 2 });
    lab.setOffice(4);
    expect(lab.getState()).toMatchObject({ fitOffice: false, scene: { office: 4, capacity: 150 } });
    lab.edit({ product: 2 });
    expect(lab.getState().scene).toMatchObject({ office: 4 });
    lab.setOffice("fit");
    expect(lab.getState()).toMatchObject({ fitOffice: true, scene: { office: 0, capacity: 4 } });
  });

  it("reset goes back to the scene the page was opened with", () => {
    const { lab } = labAt("?office=1&product=5&year=2001");
    const opened = lab.getState().scene;
    lab.setOffice("fit");
    lab.edit({ product: 80, seed: 9 });
    lab.endYear();
    lab.reset();
    expect(lab.getState().scene).toEqual(opened);
    expect(lab.getState().scene).not.toBe(opened);
    expect(lab.getState().fitOffice).toBe(false);
  });

  it("a scene set from outside is shown as given, and its office is kept", () => {
    const { lab } = labAt();
    const scene = { ...sceneFromQuery("?office=4&product=1"), ending: "won" as const };
    lab.setScene(scene);
    expect(lab.source.get()).toEqual(scene);
    expect(lab.getState().fitOffice).toBe(false);
    // The same numbers again are still another scene object, so the view is told.
    const shown = lab.source.get();
    lab.setScene(scene);
    expect(lab.source.get()).not.toBe(shown);
  });

  it("writes its address: the scene first, then what else it needs", () => {
    const { lab } = labAt("?office=2&product=9&panel=0");
    expect(lab.query()).toBe(`${queryFromScene(lab.getState().scene)}&panel=0`);
    lab.setPanelOpen(true);
    lab.setOffice("fit");
    expect(lab.query()).toBe("?office=1&product=9&growth=0&recruiting=0&away=0&leaving=0&arriving=0&year=1990&era=flat&seed=0&fit=1");
  });
});

describe("the lab and the view", () => {
  it("keeps the view awake when asked, and a view that arrives later is told too", () => {
    const { lab } = labAt();
    const first = fakeHandle();
    lab.viewState({ status: "running", handle: first.handle });
    expect(first.calls).toEqual([]);
    lab.setKeepAwake(true);
    lab.setKeepAwake(false);
    lab.setKeepAwake(true);
    expect(first.calls).toEqual(["awake:true", "awake:false", "awake:true"]);

    lab.viewState({ status: "starting", handle: null });
    const second = fakeHandle();
    lab.viewState({ status: "running", handle: second.handle });
    expect(second.calls).toEqual(["awake:true"]);
    // Told again of the same world, it is not switched on twice.
    lab.viewState({ status: "context-lost", handle: second.handle });
    expect(second.calls).toEqual(["awake:true"]);
  });

  it("without a view the switch still works and nothing throws", () => {
    const { lab } = labAt();
    lab.viewState({ status: "unsupported", handle: null });
    expect(() => {
      lab.setKeepAwake(true);
      lab.edit({ product: 40 });
      lab.endYear();
      lab.reset();
      lab.api.loseContext();
      lab.api.restoreContext();
      lab.sample();
    }).not.toThrow();
    expect(lab.getState()).toMatchObject({ keepAwake: true, status: "unsupported" });
    expect(lab.stats()).toEqual({ drawCalls: 0, triangles: 0, geometries: 0, textures: 0, figures: 0, hidden: 0, framesDrawn: 0, framesLastSecond: 0, status: "unsupported" });
  });

  it("reads the figures of the live world, and of the last world once it is gone", () => {
    const { lab } = labAt();
    const fake = fakeHandle(21);
    lab.viewState({ status: "running", handle: fake.handle });
    expect(lab.stats()).toMatchObject({ status: "running", figures: 21, drawCalls: 40, triangles: 9000 });
    lab.setShown(false);
    lab.viewState({ status: "starting", handle: null });
    expect(lab.stats()).toMatchObject({ status: "off", figures: 21, geometries: 12, textures: 5 });
  });

  it("counts the frames of the last second", () => {
    const { lab, clock } = labAt();
    const fake = fakeHandle();
    lab.viewState({ status: "running", handle: fake.handle });
    for (let tick = 0; tick <= 12; tick++) {
      clock.now = tick * 250;
      fake.frames = tick * 15;
      lab.sample();
    }
    // 3000 ms in, 60 frames a second.
    expect(lab.stats().framesLastSecond).toBe(60);
    // The world rests: a second later nothing was drawn.
    for (let tick = 13; tick <= 17; tick++) {
      clock.now = tick * 250;
      lab.sample();
    }
    expect(lab.stats().framesLastSecond).toBe(0);
    // A new world counts its frames from nothing; the old samples are not held against it.
    const next = fakeHandle();
    lab.viewState({ status: "running", handle: next.handle });
    next.frames = 4;
    expect(lab.stats().framesLastSecond).toBe(0);
    lab.sample();
    clock.now += 500;
    next.frames = 9;
    expect(lab.stats().framesLastSecond).toBe(5);
  });

  it("a view that failed is said to have failed, until it is taken down", () => {
    const { lab } = labAt();
    lab.viewFailed();
    expect(lab.getState().status).toBe("failed");
    lab.setShown(false);
    expect(lab.getState().status).toBe("off");
    lab.setShown(true);
    expect(lab.getState().status).toBe("starting");
  });
});

describe("what the browser checks get", () => {
  it("ready resolves when the view first runs", async () => {
    const { lab } = labAt();
    const ready = vi.fn();
    void lab.api.ready.then(ready);
    await settle();
    expect(ready).not.toHaveBeenCalled();
    lab.viewState({ status: "running", handle: fakeHandle().handle });
    await settle();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("ready resolves when the device cannot show the view, and when the view fails", async () => {
    const unsupported = labAt().lab;
    unsupported.viewState({ status: "unsupported", handle: null });
    await expect(unsupported.api.ready).resolves.toBeUndefined();
    const failed = labAt().lab;
    failed.viewFailed();
    await expect(failed.api.ready).resolves.toBeUndefined();
  });

  it("unmount resolves once the world is gone, mount once a new one runs, and the figures outlive the world", async () => {
    const { lab } = labAt();
    const first = fakeHandle(7);
    lab.viewState({ status: "running", handle: first.handle });

    const gone = vi.fn();
    void lab.api.unmount().then(gone);
    await settle();
    expect(lab.getState()).toMatchObject({ shown: false, status: "running" });
    expect(gone).not.toHaveBeenCalled();
    lab.viewState({ status: "starting", handle: null });
    await settle();
    expect(gone).toHaveBeenCalledTimes(1);
    expect(lab.api.stats()).toMatchObject({ status: "off", figures: 7 });

    const back = vi.fn();
    void lab.api.mount().then(back);
    await settle();
    expect(lab.getState()).toMatchObject({ shown: true, status: "starting" });
    expect(back).not.toHaveBeenCalled();
    lab.viewState({ status: "running", handle: fakeHandle(8).handle });
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    expect(lab.api.stats()).toMatchObject({ status: "running", figures: 8 });
  });

  it("unmount with no world to wait for resolves at once", async () => {
    const { lab } = labAt();
    lab.viewState({ status: "unsupported", handle: null });
    await expect(lab.api.unmount()).resolves.toBeUndefined();
    expect(lab.getState().status).toBe("off");
  });

  it("passes the context calls to the live world only", () => {
    const { lab } = labAt();
    const fake = fakeHandle();
    lab.viewState({ status: "running", handle: fake.handle });
    lab.api.loseContext();
    lab.api.restoreContext();
    expect(fake.calls).toEqual(["lose", "restore"]);
    lab.setShown(false);
    lab.viewState({ status: "starting", handle: null });
    lab.api.loseContext();
    lab.api.restoreContext();
    expect(fake.calls).toEqual(["lose", "restore"]);
  });

  it("a view that failed keeps its failure, and its world is not touched again", () => {
    const { lab } = labAt();
    const fake = fakeHandle();
    lab.viewState({ status: "running", handle: fake.handle });
    lab.viewFailed();
    lab.api.loseContext();
    lab.api.restoreContext();
    expect(fake.calls).toEqual([]);
    // The view's own last word, as it goes, comes after the error boundary's.
    lab.viewState({ status: "starting", handle: null });
    expect(lab.getState().status).toBe("failed");
    // And the other way round: the view goes first, then the boundary speaks.
    const other = labAt().lab;
    other.viewState({ status: "running", handle: fakeHandle().handle });
    other.viewState({ status: "starting", handle: null });
    other.viewFailed();
    expect(other.getState().status).toBe("failed");
  });

  it("setScene and scene are the lab's own", () => {
    const { lab } = labAt();
    const scene = sceneFromQuery("?office=3&product=30");
    lab.api.setScene(scene);
    expect(lab.api.scene()).toEqual(scene);
    expect(lab.source.get()).toEqual(scene);
  });

  it("an era cut at an emoji, or holding half of one, never stops the address being written", () => {
    const era = `${"a".repeat(39)}😀`;
    const opened = labAt(`?era=${encodeURIComponent(`${era}b`)}`).lab;
    expect(opened.getState().scene.era).toBe(era);
    expect(sceneFromQuery(opened.query()).era).toBe(era);

    const { lab } = labAt();
    const written: string[] = [];
    followAddress(lab, (query) => written.push(query));
    lab.edit({ era: `${era}b` });
    expect(lab.getState().scene.era).toBe(era);
    expect(sceneFromQuery(written[written.length - 1]).era).toBe(era);
    // The checks hand in a whole scene, whatever its era says.
    expect(() => lab.api.setScene({ ...sceneFromQuery(""), era: `${"a".repeat(39)}\uD83D` })).not.toThrow();
    expect(sceneFromQuery(written[written.length - 1]).era).toBe("a".repeat(39));
  });
});

describe("the frames since a second ago", () => {
  it("is nothing without a sample", () => {
    expect(framesSince([], 5000, 90)).toBe(0);
  });

  it("is counted from the newest sample that is at least a second old", () => {
    const samples = [{ at: 0, frames: 0 }, { at: 500, frames: 30 }, { at: 1000, frames: 60 }, { at: 1500, frames: 90 }];
    expect(framesSince(samples, 1600, 96)).toBe(66);
    expect(framesSince(samples, 2000, 96)).toBe(36);
  });

  it("is counted from the oldest sample while none is a second old, and is never negative", () => {
    expect(framesSince([{ at: 900, frames: 10 }], 1000, 16)).toBe(6);
    expect(framesSince([{ at: 0, frames: 50 }], 3000, 2)).toBe(0);
  });
});

describe("the address follows the lab", () => {
  it("is written at once and after every change that shows in it, and not otherwise", () => {
    const { lab } = labAt("?product=5");
    const written: string[] = [];
    const stop = followAddress(lab, (query) => written.push(query));
    expect(written).toEqual([lab.query()]);
    lab.edit({ growth: 1 });
    lab.setKeepAwake(true);
    lab.setPanelOpen(false);
    expect(written).toHaveLength(3);
    expect(written[2]).toBe(lab.query());
    expect(written[2].endsWith("&fit=1&panel=0")).toBe(true);
    stop();
    lab.edit({ growth: 2 });
    expect(written).toHaveLength(3);
  });

  it("a browser that refuses the address does not stop the lab", () => {
    const { lab } = labAt();
    followAddress(lab, () => {
      throw new Error("too many");
    });
    expect(() => lab.edit({ growth: 1 })).not.toThrow();
    expect(lab.getState().scene.teams.growth).toBe(1);
  });
});
