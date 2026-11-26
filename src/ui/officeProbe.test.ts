import { describe, expect, it, vi } from "vitest";
import type { SceneSource, WorldViewState } from "../world/mountWorld";
import type { WorldHandle, WorldStats } from "../world/types/handle";
import type { MarketScene } from "../world/types/market";
import type { OfficeScene } from "../world/types/scene";
import { createOfficeProbe } from "./officeProbe";

const scene: OfficeScene = {
  runId: "run",
  seed: 1,
  year: 1990,
  office: 0,
  capacity: 4,
  era: "dial-up",
  teams: { product: 2, growth: 1, recruiting: 0 },
  away: 0,
  leaving: 0,
  arriving: 1,
  ending: null,
};

const STATS: WorldStats = { drawCalls: 9, triangles: 100, geometries: 5, textures: 2, figures: 4, hidden: 0, framesDrawn: 3 };

const fakeHandle = (): WorldHandle => ({
  setScene: vi.fn(),
  resize: vi.fn(),
  setSelected: vi.fn(),
  project: vi.fn(() => ({ x: 10, y: 20 })),
  screenBounds: vi.fn(() => null),
  focus: vi.fn(),
  freeDeskSlots: vi.fn(() => []),
  hiddenCount: vi.fn(() => 0),
  zoomBy: vi.fn(),
  resetCamera: vi.fn(),
  setPaused: vi.fn(),
  setKeepAwake: vi.fn(),
  stats: vi.fn(() => STATS),
  loseContext: vi.fn(),
  restoreContext: vi.fn(),
  teamOf: vi.fn(() => "product" as const),
  personAt: vi.fn((desk: number) => (desk === 0 ? "p0" : null)),
  releaseFirst: vi.fn(),
  settle: vi.fn(),
  setMarket: vi.fn(),
  setView: vi.fn(),
  view: vi.fn(() => "office" as const),
  dispose: vi.fn(),
});

describe("the career office's check hook", () => {
  it("reads the view as it stands, nothing before there is a world, and none once detached", () => {
    const probe = createOfficeProbe();
    expect([probe.status(), probe.availability(), probe.stats(), probe.scene()]).toEqual(["none", "none", null, null]);
    let state: WorldViewState = { status: "starting", handle: null };
    const source: SceneSource = { get: () => scene, subscribe: () => () => undefined };
    const detach = probe.attach(() => state, source, () => "unknown");
    expect(probe.availability()).toBe("unknown");
    expect([probe.status(), probe.stats(), probe.personAt(0), probe.project({ kind: "door" }), probe.scene()]).toEqual([
      "starting",
      null,
      null,
      null,
      scene,
    ]);
    const handle = fakeHandle();
    state = { status: "running", handle };
    expect([
      probe.status(),
      probe.stats()?.figures,
      probe.personAt(0),
      probe.teamOf({ kind: "person", personId: "p0" }),
      probe.project({ kind: "door" }),
    ]).toEqual(["running", 4, "p0", "product", { x: 10, y: 20 }]);
    probe.loseContext();
    expect(handle.loseContext).toHaveBeenCalledTimes(1);
    detach();
    expect([probe.status(), probe.stats(), probe.availability(), probe.scene()]).toEqual(["none", null, "none", null]);
    probe.loseContext();
    expect(handle.loseContext).toHaveBeenCalledTimes(1);
  });

  it("reads where a target is drawn, for a check to point at a person's body rather than above their head", () => {
    const probe = createOfficeProbe();
    const source: SceneSource = { get: () => scene, subscribe: () => () => undefined };
    let state: WorldViewState = { status: "starting", handle: null };
    probe.attach(() => state, source, () => "unknown");
    expect(probe.screenBounds({ kind: "person", personId: "p0" })).toBeNull();
    const handle = fakeHandle();
    const box = { left: 1, top: 2, right: 3, bottom: 4 };
    vi.mocked(handle.screenBounds).mockReturnValue(box);
    state = { status: "running", handle };
    expect(probe.screenBounds({ kind: "person", personId: "p0" })).toEqual(box);
    expect(handle.screenBounds).toHaveBeenCalledWith({ kind: "person", personId: "p0" });
  });

  it("reads the view and the market the screen shows, and nothing once detached", () => {
    const probe = createOfficeProbe();
    const source: SceneSource = { get: () => scene, subscribe: () => () => undefined };
    const market: MarketScene = {
      runId: "run",
      year: 1991,
      era: "dial-up",
      barUsers: 1000,
      bar: 0.9,
      pool: 100,
      companies: [{ seat: 0, name: "Acme", state: "player", users: 10, height: 0.1, won: 1, listed: false, newcomer: false }],
    };
    const handle = fakeHandle();
    vi.mocked(handle.view).mockReturnValue("market");
    expect([probe.view(), probe.market()]).toEqual([null, null]);
    const withoutMarket = probe.attach(() => ({ status: "running", handle }), source, () => "running");
    expect([probe.view(), probe.market()]).toEqual(["market", null]);
    withoutMarket();
    const detach = probe.attach(() => ({ status: "running", handle }), source, () => "running", () => market);
    expect([probe.view(), probe.market()]).toEqual(["market", market]);
    detach();
    expect([probe.view(), probe.market()]).toEqual([null, null]);
  });

  it("keeps the last world taken down readable", () => {
    const probe = createOfficeProbe();
    const handle = fakeHandle();
    expect(probe.retiredStats()).toBeNull();
    probe.retire(handle);
    expect(probe.retiredStats()?.framesDrawn).toBe(3);
  });

  it("reads no scene from a source that has none, and a detach of an earlier screen leaves the later one attached", () => {
    const probe = createOfficeProbe();
    const empty: SceneSource = {
      get: () => {
        throw new Error("no career");
      },
      subscribe: () => () => undefined,
    };
    const first = probe.attach(() => ({ status: "starting", handle: null }), empty, () => "unknown");
    expect(probe.scene()).toBeNull();
    const source: SceneSource = { get: () => scene, subscribe: () => () => undefined };
    probe.attach(() => ({ status: "running", handle: null }), source, () => "running");
    first();
    expect([probe.status(), probe.availability(), probe.scene()]).toEqual(["running", "running", scene]);
  });
});
