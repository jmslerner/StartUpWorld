import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../engine";
import { buildWorldSnapshot } from "../snapshot";
import type { QualityLevel, WorldSnapshot } from "../types";
import { getLightingState, Lighting } from "./Lighting";

const FRAME = 1 / 60;

const baseSnapshot: WorldSnapshot = {
  ...buildWorldSnapshot(createInitialState()),
  setupComplete: true,
  ap: 3,
  maxAp: 3,
  gameOver: null,
};
const at = (overrides: Partial<WorldSnapshot>): WorldSnapshot => ({ ...baseSnapshot, ...overrides });

const makeLighting = (
  quality: QualityLevel = "high",
  reducedMotion = false
): { scene: THREE.Scene; lighting: Lighting; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } => {
  const scene = new THREE.Scene();
  const lighting = new Lighting({ scene, quality, reducedMotion });
  const lights = lighting.root.children;
  const hemi = lights.find((light): light is THREE.HemisphereLight => light instanceof THREE.HemisphereLight);
  // The sun is the first directional light; the fill comes after it.
  const sun = lights.find((light): light is THREE.DirectionalLight => light instanceof THREE.DirectionalLight);
  if (!hemi || !sun) throw new Error("lights missing");
  return { scene, lighting, sun, hemi };
};

const run = (lighting: Lighting, seconds: number, each?: () => void): void => {
  for (let t = 0; t < seconds; t += FRAME) {
    lighting.update(FRAME, t);
    each?.();
  }
};

/** Unit vector from the lit area toward the sun. */
const sunDirection = (sun: THREE.DirectionalLight): THREE.Vector3 =>
  sun.position.clone().sub(sun.target.position).normalize();

describe("Lighting time of day", () => {
  it("maps action points to dusk: full AP is day, none left is dusk", () => {
    const dusk = [3, 2, 1, 0].map((ap) => {
      const { scene, lighting } = makeLighting();
      lighting.applySnapshot(at({ ap }), null, []);
      lighting.update(FRAME, 0);
      return getLightingState(scene).duskAmount;
    });
    expect(dusk[0]).toBe(0);
    expect(dusk[3]).toBe(1);
    expect(dusk[1]).toBeGreaterThan(dusk[0]);
    expect(dusk[2]).toBeGreaterThan(dusk[1]);
    expect(dusk[3]).toBeGreaterThan(dusk[2]);
  });

  it("dims the sky as the day runs out, and reports how light it still is", () => {
    const measure = (ap: number): { hemi: number; daylight: number } => {
      const { scene, lighting, hemi } = makeLighting();
      lighting.applySnapshot(at({ ap }), null, []);
      lighting.update(FRAME, 0);
      return { hemi: hemi.intensity, daylight: getLightingState(scene).daylight };
    };
    const looks = [3, 2, 1, 0].map(measure);
    expect(looks[0].daylight).toBe(1);
    for (let i = 1; i < looks.length; i += 1) {
      expect(looks[i].hemi).toBeLessThan(looks[i - 1].hemi);
      expect(looks[i].daylight).toBeLessThan(looks[i - 1].daylight);
    }
    // Dusk is dark enough for screens and lamps to read as light sources.
    expect(looks[3].daylight).toBeLessThan(0.5);
    expect(looks[3].daylight).toBeGreaterThan(0.1);
  });

  it("keeps the sun on the viewer's left by day and brings it round to the open side at dusk", () => {
    const { lighting, sun } = makeLighting();
    lighting.applySnapshot(at({ ap: 3 }), null, []);
    lighting.update(FRAME, 0);
    const morning = sunDirection(sun);
    // From −X/+Z and high: shadows fall toward +X/−Z, the viewer's right.
    expect(morning.x).toBeLessThan(0);
    expect(morning.z).toBeGreaterThan(0);
    expect(morning.y).toBeGreaterThan(0.75);

    lighting.applySnapshot(at({ ap: 0 }), null, []);
    lighting.update(FRAME, 0);
    const dusk = sunDirection(sun);
    expect(dusk.y).toBeLessThan(morning.y);
    // Mostly from +Z, the side with no wall, so it lights the room instead of shading it.
    expect(dusk.z).toBeGreaterThan(Math.abs(dusk.x) * 2);
  });

  it("handles a zero AP budget without dividing by zero", () => {
    const { scene, lighting } = makeLighting();
    lighting.applySnapshot(at({ ap: 0, maxAp: 0 }), null, []);
    lighting.update(FRAME, 0);
    expect(getLightingState(scene).duskAmount).toBe(1);
  });

  it("snaps on the first snapshot and glides afterwards", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    const morning = at({ ap: 3 });
    lighting.applySnapshot(at({ ap: 0 }), null, []);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBe(1);

    lighting.applySnapshot(morning, at({ ap: 0 }), []);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBeGreaterThan(0.9);
    let previous = state.duskAmount;
    run(lighting, 3, () => {
      expect(state.duskAmount).toBeLessThanOrEqual(previous);
      previous = state.duskAmount;
    });
    expect(state.duskAmount).toBeLessThan(0.01);
  });
});

describe("Lighting week sweep", () => {
  it("goes through night and arrives at the new morning in about a second and a half", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    lighting.applySnapshot(at({ ap: 1 }), null, []);
    lighting.update(FRAME, 0);
    const before = state.duskAmount;
    expect(before).toBeLessThan(1);

    const morning = at({ ap: 3, week: 2 });
    lighting.applySnapshot(morning, at({ ap: 1 }), [{ type: "week-advanced", week: 2 }]);
    let darkest = Infinity;
    let duskiest = 0;
    run(lighting, 1.4, () => {
      darkest = Math.min(darkest, state.daylight);
      duskiest = Math.max(duskiest, state.duskAmount);
    });
    expect(duskiest).toBeGreaterThan(0.95);
    expect(darkest).toBeLessThan(0.15);
    // Not finished yet at 1.4 s...
    expect(state.duskAmount).toBeGreaterThan(0);

    // ...and exactly at the morning look just after 1.5 s.
    run(lighting, 0.2);
    expect(state.duskAmount).toBe(0);
    expect(state.daylight).toBe(1);
  });

  it("snaps instead when motion is reduced", () => {
    const { scene, lighting, sun } = makeLighting("high", true);
    const state = getLightingState(scene);
    lighting.applySnapshot(at({ ap: 0 }), null, []);
    lighting.update(FRAME, 0);
    lighting.applySnapshot(at({ ap: 3, week: 2 }), at({ ap: 0 }), [{ type: "week-advanced", week: 2 }]);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBe(0);
    const settled = sun.intensity;
    run(lighting, 1, () => expect(sun.intensity).toBe(settled));
  });
});

describe("Lighting moments", () => {
  it("flickers briefly when an event lands, then recovers fully", () => {
    const { lighting, sun } = makeLighting();
    lighting.applySnapshot(baseSnapshot, null, []);
    lighting.update(FRAME, 0);
    const steady = sun.intensity;

    lighting.applySnapshot(at({ pendingEventTitle: "Uh oh" }), baseSnapshot, [{ type: "event-opened", title: "Uh oh" }]);
    let lowest = steady;
    run(lighting, 0.38, () => {
      lowest = Math.min(lowest, sun.intensity);
    });
    expect(lowest).toBeLessThan(steady * 0.8);
    run(lighting, 0.1);
    expect(sun.intensity).toBeCloseTo(steady, 6);
  });

  it("does not flicker under reduced motion", () => {
    const { lighting, sun } = makeLighting("high", true);
    lighting.applySnapshot(baseSnapshot, null, []);
    lighting.update(FRAME, 0);
    const steady = sun.intensity;
    lighting.applySnapshot(baseSnapshot, baseSnapshot, [{ type: "event-opened", title: "Uh oh" }]);
    run(lighting, 0.5, () => expect(sun.intensity).toBe(steady));
  });

  it("is dim before setup is finished and fades up afterwards", () => {
    const { scene, lighting, hemi } = makeLighting();
    const state = getLightingState(scene);
    lighting.applySnapshot(at({ setupComplete: false }), null, []);
    lighting.update(FRAME, 0);
    const dimSky = hemi.intensity;
    expect(state.duskAmount).toBeGreaterThan(0.5);
    expect(state.daylight).toBeLessThan(0.5);

    lighting.applySnapshot(baseSnapshot, at({ setupComplete: false }), [{ type: "setup-completed" }]);
    run(lighting, 0.25);
    // A slow fade: clearly under way after a quarter second, but nowhere near done.
    expect(hemi.intensity).toBeGreaterThan(dimSky);
    expect(state.duskAmount).toBeGreaterThan(0.4);
    run(lighting, 6);
    expect(state.duskAmount).toBeLessThan(0.01);
  });

  it("ends a won run in bright gold and a lost one in near-darkness", () => {
    const look = (ending: WorldSnapshot["gameOver"]): { sun: number; warmth: number; daylight: number } => {
      const { scene, lighting, sun } = makeLighting();
      lighting.applySnapshot(at({ gameOver: ending }), null, []);
      lighting.update(FRAME, 0);
      return { sun: sun.intensity, warmth: sun.color.r - sun.color.b, daylight: getLightingState(scene).daylight };
    };
    const morning = look(null);
    for (const ending of ["ipo", "acquisition", "ai-hype-exit"] as const) {
      const win = look(ending);
      expect(win.sun).toBeGreaterThan(morning.sun);
      expect(win.warmth).toBeGreaterThan(0.2);
      expect(win.daylight).toBe(1);
    }
    for (const ending of ["bankruptcy", "founder-removal", "zombie-saas", "forced-acquisition"] as const) {
      const loss = look(ending);
      expect(loss.daylight).toBeLessThan(0.15);
      expect(loss.warmth).toBeLessThan(0);
    }
  });
});

describe("Lighting looks", () => {
  it("can be pinned to a named look, matching what snapshots produce", () => {
    const pinned = makeLighting();
    pinned.lighting.showLook("dusk");
    const driven = makeLighting();
    driven.lighting.applySnapshot(at({ ap: 0 }), null, []);
    driven.lighting.update(FRAME, 0);

    expect(pinned.sun.intensity).toBe(driven.sun.intensity);
    expect(pinned.sun.color.getHex()).toBe(driven.sun.color.getHex());
    expect(pinned.hemi.intensity).toBe(driven.hemi.intensity);
    expect(getLightingState(pinned.scene).duskAmount).toBe(1);

    // It holds: nothing drifts while no snapshot arrives.
    run(pinned.lighting, 1);
    expect(pinned.sun.intensity).toBe(driven.sun.intensity);
    expect(getLightingState(pinned.scene).duskAmount).toBe(1);
  });

  it("gives every look its own character", () => {
    const { scene, lighting, sun } = makeLighting();
    const seen = new Set<string>();
    for (const look of ["morning", "afternoon", "dusk", "night", "sunrise", "setup", "win", "loss"] as const) {
      lighting.showLook(look);
      seen.add(`${sun.color.getHexString()}|${sun.intensity}|${getLightingState(scene).daylight.toFixed(3)}`);
    }
    expect(seen.size).toBe(8);
  });
});

describe("Lighting shadows", () => {
  it("casts shadows on high quality only", () => {
    expect(makeLighting("high").sun.castShadow).toBe(true);
    expect(makeLighting("low").sun.castShadow).toBe(false);
  });

  it("setShadowsEnabled(false) stops casting and frees the shadow map; true turns it back on", () => {
    const { lighting, sun } = makeLighting("high");
    // Stand-in for the render target WebGLShadowMap creates on the first shadowed render.
    const map = new THREE.WebGLRenderTarget(4, 4);
    let disposed = 0;
    map.addEventListener("dispose", () => disposed++);
    sun.shadow.map = map;

    lighting.setShadowsEnabled(false);
    expect(sun.castShadow).toBe(false);
    expect(disposed).toBe(1);
    // null makes WebGLShadowMap build a fresh one if shadows come back.
    expect(sun.shadow.map).toBeNull();

    lighting.setShadowsEnabled(false);
    expect(disposed).toBe(1);

    lighting.setShadowsEnabled(true);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBeGreaterThan(0);
  });

  it("setShadowsEnabled is a no-op on a low world, which never casts", () => {
    const { lighting, sun } = makeLighting("low");
    lighting.setShadowsEnabled(true);
    expect(sun.castShadow).toBe(false);
  });

  it("only ever has one shadow-casting light", () => {
    const { lighting } = makeLighting("high");
    const casters = lighting.root.children.filter((child) => (child as THREE.Light).castShadow === true);
    expect(casters).toHaveLength(1);
  });

  it("fits the shadow frustum around the floor at every time of day", () => {
    const bounds = { minX: -9, maxX: 14, minZ: -6, maxZ: 11 };
    for (const ap of [3, 2, 1, 0]) {
      const { lighting, sun } = makeLighting("high");
      lighting.setBounds(bounds);
      lighting.applySnapshot(at({ ap }), null, []);
      lighting.update(FRAME, 0);
      sun.updateMatrixWorld(true);
      sun.target.updateMatrixWorld(true);
      sun.shadow.updateMatrices(sun);

      for (const x of [bounds.minX, bounds.maxX]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          for (const y of [0, 4]) {
            const ndc = new THREE.Vector3(x, y, z).project(sun.shadow.camera);
            expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("Lighting state sharing", () => {
  it("hands out one stable state object per scene, in any order of creation", () => {
    const bare = new THREE.Scene();
    expect(getLightingState(bare)).toEqual({ duskAmount: 0, daylight: 1 });
    expect(getLightingState(bare)).toBe(getLightingState(bare));

    // Fetched before the Lighting system exists, and still the live object afterwards.
    const scene = new THREE.Scene();
    const early = getLightingState(scene);
    const lighting = new Lighting({ scene, quality: "low", reducedMotion: false });
    lighting.applySnapshot(at({ ap: 0 }), null, []);
    lighting.update(FRAME, 0);
    expect(early.duskAmount).toBe(1);
    expect(getLightingState(bare).duskAmount).toBe(0);
  });

  it("removes its lights and goes back to daylight on dispose", () => {
    const { scene, lighting } = makeLighting();
    expect(scene.children).toEqual([lighting.root]);
    lighting.applySnapshot(at({ ap: 0 }), null, []);
    lighting.update(FRAME, 0);
    lighting.dispose();
    expect(scene.children).toEqual([]);
    expect(getLightingState(scene)).toEqual({ duskAmount: 0, daylight: 1 });
  });
});
