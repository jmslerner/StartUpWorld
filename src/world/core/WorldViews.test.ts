import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { marketFrame, marketLayout, marketMarks, type MarketLayout, type MarketMarks } from "../market/marketLayout";
import { computeBuildingFrame } from "../office/framing";
import type { MarketCompany, MarketScene, OfficeIndex, OfficeScene } from "../types";
import { CameraRig, type GroundBounds } from "./CameraRig";
import { layoutBounds } from "./layoutBounds";
import { SceneFrames } from "./sceneFrames";
import { WorldViews } from "./WorldViews";

const office = (index: OfficeIndex, product = 2): OfficeScene => ({
  runId: "run",
  seed: 7,
  year: 1990,
  office: index,
  capacity: 9,
  era: "any",
  teams: { product, growth: 1, recruiting: 0 },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
});

const company = (seat: number): MarketCompany => ({
  seat,
  name: `C${seat}`,
  state: seat === 0 ? "player" : "rival",
  users: 100 * (seat + 1),
  height: 0.2 * (seat + 1),
  won: 0.1,
  listed: false,
  newcomer: false,
});

/** A market of `count` companies; its bounds depend on the count alone. */
const market = (count: number, year = 1991): MarketScene => ({
  runId: "run",
  year,
  era: "dial-up",
  barUsers: 1000,
  bar: 0.5,
  pool: 100,
  companies: Array.from({ length: count }, (_, seat) => company(seat)),
});

/** The market system as the views see it: its root, what it shows, whether it is on, its layout and marks. */
class FakeMarket {
  readonly root = new THREE.Group();
  /** Every setActive, in order. */
  readonly active: boolean[] = [];
  private plan: MarketLayout | null = null;

  show(scene: MarketScene): void {
    this.plan = marketLayout(scene);
  }

  setActive(on: boolean): void {
    this.active.push(on);
  }

  layout(): MarketLayout | null {
    return this.plan;
  }

  marks(): MarketMarks | null {
    return this.plan === null ? null : marketMarks(this.plan);
  }
}

const harness = (options: { reducedMotion?: boolean } = {}) => {
  const scene = new THREE.Scene();
  const lights = new THREE.Group();
  const highlights = new THREE.Group();
  const fake = new FakeMarket();
  fake.root.visible = false;
  // A rebuildable system's root: everything that is not a core root is the office's.
  const desks = new THREE.Group();
  scene.add(lights, highlights, fake.root, desks);
  const rig = new CameraRig();
  rig.setViewport(1280, 800);
  const shadowBounds: GroundBounds[] = [];
  const views = new WorldViews({
    scene,
    rig,
    lighting: { setBounds: (bounds) => shadowBounds.push({ ...bounds }) },
    market: fake,
    coreRoots: new Set<THREE.Object3D>([lights, highlights, fake.root]),
    reducedMotion: options.reducedMotion ?? false,
  });
  return { scene, lights, highlights, desks, market: fake, rig, shadowBounds, views, frames: new SceneFrames() };
};

type Harness = ReturnType<typeof harness>;
const shown = (h: Harness) => ({
  lights: h.lights.visible,
  highlights: h.highlights.visible,
  desks: h.desks.visible,
  market: h.market.root.visible,
});

describe("WorldViews: what is drawn", () => {
  it("draws the shown view's roots only: the office's or the market's, and leaves the core roots as they are", () => {
    const h = harness();
    h.highlights.visible = false;
    h.views.applyVisibility();
    expect(h.views.kind).toBe("office");
    expect(shown(h)).toEqual({ lights: true, highlights: false, desks: true, market: false });

    h.views.show("market");
    expect(h.views.kind).toBe("market");
    expect(shown(h)).toEqual({ lights: true, highlights: false, desks: false, market: true });
    expect(h.market.active).toEqual([true]);
    // A rebuilt office brings a new root while the market shows: hidden with the rest of the office.
    const rebuilt = new THREE.Group();
    h.scene.add(rebuilt);
    h.views.applyVisibility();
    expect(rebuilt.visible).toBe(false);

    h.views.show("office");
    expect(shown(h)).toEqual({ lights: true, highlights: false, desks: true, market: false });
    expect(rebuilt.visible).toBe(true);
    expect(h.market.active).toEqual([true, false]);
  });

  it("registers the market's companies again after a new run emptied the registry, only while the market shows", () => {
    const h = harness();
    h.views.reregisterMarket();
    expect(h.market.active).toEqual([]);
    h.views.show("market");
    h.views.reregisterMarket();
    expect(h.market.active).toEqual([true, false, true]);
  });
});

describe("WorldViews: framing", () => {
  it("points the camera, its pan limits and the shadows at each office: a cut to the first, a glide to a new one", () => {
    const h = harness();
    const first = h.frames.stage(office(0));
    h.views.frameLayout(first);
    expect(h.shadowBounds).toEqual([layoutBounds(first.layout)]);
    expect(h.rig.isAnimating).toBe(false);
    expect(h.rig.getTarget()).toEqual(computeBuildingFrame(first.layout).target);

    // The same office with one more person: the camera stays where it is.
    const revision = h.rig.revision;
    h.views.frameLayout(h.frames.stage(office(0, 3)));
    expect(h.rig.revision).toBe(revision);

    const moved = h.frames.stage(office(2));
    h.views.frameLayout(moved);
    expect(h.shadowBounds.at(-1)).toEqual(layoutBounds(moved.layout));
    expect(h.rig.isAnimating).toBe(true);
    h.rig.finish();
    expect(h.rig.getTarget()).toEqual(computeBuildingFrame(moved.layout).target);
  });

  it.each([false, true])(
    "frames the market (reduced motion: %s), keeps the office's framing meanwhile, and goes back to the office as it is now",
    (reducedMotion) => {
      const h = harness({ reducedMotion });
      const first = h.frames.stage(office(0));
      h.views.frameLayout(first);
      h.views.setMarket(market(4));
      // The office shows: a market given meanwhile moves nothing.
      expect(h.shadowBounds).toHaveLength(1);
      expect(h.rig.getTarget()).toEqual(computeBuildingFrame(first.layout).target);

      h.views.show("market");
      expect(h.rig.isAnimating).toBe(!reducedMotion);
      h.rig.finish();
      const plan = marketLayout(market(4));
      expect(h.shadowBounds.at(-1)).toEqual(plan.bounds);
      expect(h.rig.getTarget()).toEqual(marketFrame(plan).target);

      // The company moves house while the market shows: the camera and the shadows stay on the market...
      const moved = h.frames.stage(office(2));
      h.views.frameLayout(moved);
      expect(h.shadowBounds.at(-1)).toEqual(plan.bounds);
      expect(h.rig.isAnimating).toBe(false);
      expect(h.rig.getTarget()).toEqual(marketFrame(plan).target);

      // ...and going back shows the office it moved to.
      h.views.show("office");
      expect(h.rig.isAnimating).toBe(!reducedMotion);
      h.rig.finish();
      expect(h.shadowBounds.at(-1)).toEqual(layoutBounds(moved.layout));
      expect(h.rig.getTarget()).toEqual(computeBuildingFrame(moved.layout).target);
    }
  );

  it("while the market shows, frames a market again when its bounds change, and not for one with the same bounds", () => {
    const h = harness();
    h.views.setMarket(market(4));
    expect(h.shadowBounds).toEqual([]);
    h.views.show("market");
    expect(h.shadowBounds).toEqual([marketLayout(market(4)).bounds]);
    h.views.setMarket(market(4, 1992));
    expect(h.shadowBounds).toHaveLength(1);
    h.views.setMarket(market(3, 1993));
    expect(h.shadowBounds).toEqual([marketLayout(market(4)).bounds, marketLayout(market(3)).bounds]);
    // Shown again after the office (which has no layout yet here): framed again, the same bounds or not.
    h.views.show("office");
    h.views.show("market");
    expect(h.shadowBounds).toHaveLength(3);
  });

  it("once cleared, has no office framing left to go back to", () => {
    const h = harness();
    h.views.frameLayout(h.frames.stage(office(0)));
    h.views.show("market");
    h.views.clear();
    const revision = h.rig.revision;
    h.views.show("office");
    expect(h.shadowBounds).toHaveLength(1);
    expect(h.rig.revision).toBe(revision);
  });
});

describe("WorldViews: the market's marks", () => {
  it("says where the market's buildings and bar are drawn as the camera stands now, and only while the market shows", () => {
    const h = harness();
    h.views.setMarket(market(4));
    expect(h.views.marketMarks()).toBeNull();
    h.views.show("market");
    h.rig.finish();
    const marks = h.views.marketMarks();
    const world = marketMarks(marketLayout(market(4)));
    expect(marks?.lots.map((lot) => lot.seat)).toEqual([0, 1, 2, 3]);
    world.lots.forEach((lot, index) => {
      // Across, the centre of the roof; down, its highest corner on screen.
      expect(marks?.lots[index].top.x).toBeCloseTo(h.rig.project(lot.centre).x, 9);
      expect(marks?.lots[index].top.y).toBeCloseTo(Math.min(...lot.corners.map((corner) => h.rig.project(corner).y)), 9);
    });
    expect(marks?.bar).toEqual({
      left: h.rig.project(world.bar!.left),
      right: h.rig.project(world.bar!.right),
      top: h.rig.project(world.bar!.top),
    });
    h.views.show("office");
    expect(h.views.marketMarks()).toBeNull();
  });
});
