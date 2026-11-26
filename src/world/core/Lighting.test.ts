import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { nextCast } from "../cast";
import { sceneEvents } from "../sceneEvents";
import type { OfficeIndex, OfficeScene, QualityLevel, WorldFrame } from "../types";
import { LOOKS, PHASES } from "./colors";
import { getLightingState, Lighting, LIGHTING_LOOKS, lightingKeyFor, restingLook, type LightingLook } from "./Lighting";

const FRAME = 1 / 60;

const baseScene: OfficeScene = {
  runId: "run",
  seed: 7,
  year: 1995,
  office: 0,
  capacity: 4,
  era: "flat",
  teams: { product: 2, growth: 1, recruiting: 0 },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
};
const OFFICES: readonly OfficeIndex[] = [0, 1, 2, 3, 4];

/** The frame for a scene: on its own, or as what follows `prev` (the events are the real ones). */
const frameOf = (overrides: Partial<OfficeScene> = {}, prev: WorldFrame | null = null): WorldFrame => {
  const scene = { ...baseScene, ...overrides };
  return { scene, cast: nextCast(prev?.cast ?? null, scene), events: sceneEvents(prev?.scene ?? null, scene) };
};
const base = frameOf();

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

/** Everything the lights show, as one comparable value. */
const lightOf = (rig: { scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }) => ({
  sun: rig.sun.intensity,
  sunColor: rig.sun.color.getHex(),
  sunFrom: sunDirection(rig.sun).toArray(),
  sky: rig.hemi.intensity,
  skyColor: rig.hemi.color.getHex(),
  groundColor: rig.hemi.groundColor.getHex(),
  ...getLightingState(rig.scene),
});

describe("Lighting at rest", () => {
  it("rests in full daylight in every office, with the sun high on the viewer's left", () => {
    for (const office of OFFICES) {
      const rig = makeLighting();
      rig.lighting.applyFrame(frameOf({ office }), null);
      rig.lighting.update(FRAME, 0);
      expect(getLightingState(rig.scene)).toEqual({ duskAmount: 0, daylight: 1 });
      // From −X/+Z and high: shadows fall toward +X/−Z, the viewer's right.
      const from = sunDirection(rig.sun);
      expect(from.x).toBeLessThan(0);
      expect(from.z).toBeGreaterThan(0);
      expect(from.y).toBeGreaterThan(0.75);
      expect(rig.lighting.busy()).toBe(false);
    }
  });

  it("keeps the sun on the viewer's left by day and brings it round to the open side at dusk", () => {
    const { lighting, sun } = makeLighting();
    lighting.showLook("morning");
    const morning = sunDirection(sun);
    // From −X/+Z and high: shadows fall toward +X/−Z, the viewer's right.
    expect(morning.x).toBeLessThan(0);
    expect(morning.z).toBeGreaterThan(0);
    expect(morning.y).toBeGreaterThan(0.75);

    lighting.showLook("dusk");
    const dusk = sunDirection(sun);
    expect(dusk.y).toBeLessThan(morning.y);
    // Mostly from +Z, the side with no wall, so it lights the room instead of shading it.
    expect(dusk.z).toBeGreaterThan(Math.abs(dusk.x) * 2);
  });

  it("lighting has no clock: two frames a year apart give the same light", () => {
    // Shown on their own, two years of the same office look the same.
    const first = makeLighting();
    first.lighting.applyFrame(base, null);
    first.lighting.update(FRAME, 0);
    const later = makeLighting();
    later.lighting.applyFrame(frameOf({ year: baseScene.year + 1 }), null);
    later.lighting.update(FRAME, 0);
    expect(lightOf(later)).toEqual(lightOf(first));

    // And once the year has turned in front of the player, the light is back where it was.
    const before = lightOf(first);
    const next = frameOf({ year: baseScene.year + 1 }, base);
    expect(next.events).toEqual([{ kind: "year-advanced", from: baseScene.year, to: baseScene.year + 1 }]);
    first.lighting.applyFrame(next, base);
    run(first.lighting, 2);
    expect(first.lighting.busy()).toBe(false);
    expect(lightOf(first)).toEqual(before);
  });

  it("nothing the plan changes within a year moves the light", () => {
    const rig = makeLighting();
    rig.lighting.applyFrame(base, null);
    rig.lighting.update(FRAME, 0);
    const before = lightOf(rig);
    const next = frameOf({ teams: { product: 1, growth: 1, recruiting: 1 }, away: 1, leaving: 1, arriving: 2, era: "anything" }, base);
    rig.lighting.applyFrame(next, base);
    expect(rig.lighting.busy()).toBe(false);
    run(rig.lighting, 0.5, () => expect(lightOf(rig)).toEqual(before));
  });

  it("snaps on the first frame and glides afterwards", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    lighting.showLook("dusk");
    expect(state.duskAmount).toBe(1);

    // The first frame simply is.
    lighting.applyFrame(base, null);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBe(0);

    // A later one is glided to.
    lighting.showLook("dusk");
    lighting.applyFrame(base, base);
    expect(lighting.busy()).toBe(true);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBeGreaterThan(0.9);
    let previous = state.duskAmount;
    run(lighting, 3, () => {
      expect(state.duskAmount).toBeLessThanOrEqual(previous);
      previous = state.duskAmount;
    });
    expect(state.duskAmount).toBeLessThan(0.01);
  });

  it("is busy while the light is moving, and lands exactly on the resting look", () => {
    const moved = makeLighting();
    moved.lighting.showLook("night");
    moved.lighting.applyFrame(base, base);
    expect(moved.lighting.busy()).toBe(true);
    let frames = 0;
    while (moved.lighting.busy() && frames < 60 * 30) {
      moved.lighting.update(FRAME, frames * FRAME);
      frames += 1;
    }
    // It does come to rest, in seconds rather than never.
    expect(moved.lighting.busy()).toBe(false);
    expect(frames * FRAME).toBeLessThan(6);

    const still = makeLighting();
    still.lighting.applyFrame(base, null);
    still.lighting.update(FRAME, 0);
    expect(lightOf(moved)).toEqual(lightOf(still));
  });
});

describe("Lighting and odd frame lengths", () => {
  const ODD = [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it("a frame whose length is not a positive finite number changes nothing, in a glide", () => {
    const rig = makeLighting();
    rig.lighting.showLook("night");
    rig.lighting.applyFrame(base, base);
    run(rig.lighting, 0.2);
    const before = lightOf(rig);
    for (const dt of ODD) {
      rig.lighting.update(dt, 0);
      expect(lightOf(rig)).toEqual(before);
      expect(rig.lighting.busy()).toBe(true);
    }
    // And the light still comes to rest afterwards, on the resting look.
    run(rig.lighting, 6);
    expect(rig.lighting.busy()).toBe(false);
    expect(getLightingState(rig.scene)).toEqual({ duskAmount: 0, daylight: 1 });
  });

  it("nor in a year's sweep, which still ends on time", () => {
    const rig = makeLighting();
    rig.lighting.applyFrame(base, null);
    rig.lighting.applyFrame(frameOf({ year: baseScene.year + 1 }, base), base);
    run(rig.lighting, 0.5);
    const before = lightOf(rig);
    for (const dt of ODD) {
      rig.lighting.update(dt, 0);
      expect(lightOf(rig)).toEqual(before);
      expect(rig.lighting.busy()).toBe(true);
    }
    run(rig.lighting, 1.1);
    expect(rig.lighting.busy()).toBe(false);
    expect(getLightingState(rig.scene)).toEqual({ duskAmount: 0, daylight: 1 });
  });
});

describe("Lighting year sweep", () => {
  it("goes through night and arrives at the new morning in about a second and a half", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    lighting.applyFrame(base, null);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBe(0);

    lighting.applyFrame(frameOf({ year: baseScene.year + 1 }, base), base);
    expect(lighting.busy()).toBe(true);
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
    expect(lighting.busy()).toBe(true);

    // ...and exactly at the morning look just after 1.5 s.
    run(lighting, 0.2);
    expect(state.duskAmount).toBe(0);
    expect(state.daylight).toBe(1);
    expect(lighting.busy()).toBe(false);
  });

  it("snaps instead when motion is reduced", () => {
    const { scene, lighting, sun } = makeLighting("high", true);
    const state = getLightingState(scene);
    lighting.showLook("dusk");
    lighting.applyFrame(frameOf({ year: baseScene.year + 1 }, base), base);
    expect(lighting.busy()).toBe(false);
    lighting.update(FRAME, 0);
    expect(state.duskAmount).toBe(0);
    const settled = sun.intensity;
    run(lighting, 1, () => expect(sun.intensity).toBe(settled));
  });

  it("a reset shows the new run at once, with no sweep", () => {
    const { scene, lighting } = makeLighting();
    const lost = frameOf({ ending: "lost" });
    lighting.applyFrame(lost, null);
    lighting.update(FRAME, 0);
    const fresh = frameOf({ runId: "another" }, lost);
    expect(fresh.events).toEqual([{ kind: "run-reset" }]);
    lighting.applyFrame(fresh, lost);
    expect(lighting.busy()).toBe(false);
    lighting.update(FRAME, 0);
    expect(getLightingState(scene)).toEqual({ duskAmount: 0, daylight: 1 });
  });
});

describe("Lighting endings", () => {
  it("ends a won run in bright gold and a lost one in near-darkness", () => {
    const look = (ending: OfficeScene["ending"]): { sun: number; warmth: number; daylight: number } => {
      const { scene, lighting, sun } = makeLighting();
      lighting.applyFrame(frameOf({ ending }), null);
      lighting.update(FRAME, 0);
      return { sun: sun.intensity, warmth: sun.color.r - sun.color.b, daylight: getLightingState(scene).daylight };
    };
    const morning = look(null);
    const win = look("won");
    expect(win.sun).toBeGreaterThan(morning.sun);
    expect(win.warmth).toBeGreaterThan(0.2);
    expect(win.daylight).toBe(1);
    const loss = look("lost");
    expect(loss.daylight).toBeLessThan(0.15);
    expect(loss.warmth).toBeLessThan(0);
  });

  it("fades slowly into an ending, and then rests there", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    lighting.applyFrame(base, null);
    lighting.update(FRAME, 0);

    const lost = frameOf({ ending: "lost" }, base);
    expect(lost.events).toEqual([{ kind: "ended", ending: "lost" }]);
    lighting.applyFrame(lost, base);
    expect(lighting.busy()).toBe(true);
    run(lighting, 0.25);
    // A slow fade: clearly under way after a quarter second, but nowhere near done.
    expect(state.daylight).toBeLessThan(0.97);
    expect(state.daylight).toBeGreaterThan(0.7);
    run(lighting, 12);
    expect(lighting.busy()).toBe(false);

    const shown = makeLighting();
    shown.lighting.applyFrame(frameOf({ ending: "lost" }), null);
    shown.lighting.update(FRAME, 0);
    expect(state).toEqual(getLightingState(shown.scene));
  });

  it("a frame with no events, arriving during the fade, does not hurry it", () => {
    const hurried = makeLighting();
    const alone = makeLighting();
    const lost = frameOf({ ending: "lost" }, base);
    for (const rig of [hurried, alone]) {
      rig.lighting.applyFrame(base, null);
      rig.lighting.applyFrame(lost, base);
      run(rig.lighting, 0.25);
    }
    // The same scene again, as a resize or a re-render sends it.
    const again = frameOf({ ending: "lost" }, lost);
    expect(again.events).toEqual([]);
    hurried.lighting.applyFrame(again, lost);
    expect(hurried.lighting.busy()).toBe(true);
    for (let t = 0; t < 3; t += FRAME) {
      hurried.lighting.update(FRAME, t);
      alone.lighting.update(FRAME, t);
      expect(lightOf(hurried)).toEqual(lightOf(alone));
    }
    // Still the slow fade three seconds on, not one the normal rate has finished.
    expect(hurried.lighting.busy()).toBe(true);
  });

  it("a new goal during the fade is glided to at the normal rate", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    const lost = frameOf({ ending: "lost" }, base);
    lighting.applyFrame(base, null);
    lighting.applyFrame(lost, base);
    run(lighting, 2);
    // Not a case the game produces (a run that has ended stays ended), but the light must not crawl back.
    const back: WorldFrame = { scene: base.scene, cast: lost.cast, events: [] };
    lighting.applyFrame(back, lost);
    run(lighting, 4);
    expect(lighting.busy()).toBe(false);
    expect(state).toEqual({ duskAmount: 0, daylight: 1 });
  });

  it("the year that ends the run fades to the ending instead of sweeping to a morning", () => {
    const { scene, lighting } = makeLighting();
    const state = getLightingState(scene);
    lighting.applyFrame(base, null);
    lighting.update(FRAME, 0);
    const won = frameOf({ year: baseScene.year + 1, ending: "won" }, base);
    expect(won.events.map((event) => event.kind)).toEqual(["year-advanced", "ended"]);
    lighting.applyFrame(won, base);
    // No night on the way to the win.
    run(lighting, 12, () => expect(state.daylight).toBe(1));
    expect(lighting.busy()).toBe(false);
  });
});

describe("Lighting looks", () => {
  it("each era rests in a light of its own, the same in all five offices", () => {
    expect(LOOKS.map((look) => restingLook(2, look))).toEqual(
      ["morning", "afternoon", "noon", "overcast", "morning", "golden", "sunrise", "studio", "twilight"]);
    for (const look of LOOKS) expect(new Set(PHASES.map((office) => restingLook(office, look))).size).toBe(1);
  });

  it("lists every mood, and every mood is a light of its own", () => {
    expect(LIGHTING_LOOKS).toEqual(["morning", "afternoon", "dusk", "night", "sunrise", "win", "loss", "noon", "overcast", "golden", "studio", "twilight"]);
    // A light's key: sun colour, sun intensity and sky colour; no two moods share one.
    const text = (mood: LightingLook): string => {
      const k = lightingKeyFor(mood);
      return `${k.sunColor.getHexString()}:${k.sunIntensity}:${k.skyColor.getHexString()}`;
    };
    expect(new Set(LIGHTING_LOOKS.map(text)).size).toBe(LIGHTING_LOOKS.length);
    // The resting moods of the new eras are daylight: no prop glows in them but faintly at twilight.
    expect(["noon", "overcast", "golden", "studio"].map((m) => lightingKeyFor(m as LightingLook).dusk)).toEqual([0, 0, 0, 0]);
    expect(lightingKeyFor("twilight").dusk).toBeLessThanOrEqual(0.3);
  });

  it("can be pinned to a named look, matching what frames produce", () => {
    for (const [look, ending] of [["morning", null], ["win", "won"], ["loss", "lost"]] as const) {
      const pinned = makeLighting();
      pinned.lighting.showLook(look);
      const driven = makeLighting();
      driven.lighting.applyFrame(frameOf({ ending }), null);
      driven.lighting.update(FRAME, 0);
      expect(lightOf(pinned)).toEqual(lightOf(driven));

      // It holds: nothing drifts while no frame arrives.
      expect(pinned.lighting.busy()).toBe(false);
      run(pinned.lighting, 1);
      expect(lightOf(pinned)).toEqual(lightOf(driven));
    }
  });

  it("gives every look its own character", () => {
    const { scene, lighting, sun } = makeLighting();
    const seen = new Set<string>();
    for (const look of LIGHTING_LOOKS) {
      lighting.showLook(look);
      seen.add(`${sun.color.getHexString()}|${sun.intensity}|${getLightingState(scene).daylight.toFixed(3)}`);
    }
    expect(LIGHTING_LOOKS).toHaveLength(12);
    expect(seen.size).toBe(12);
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

  it("new bounds move the sun at once, while the lighting is at rest", () => {
    for (const quality of ["high", "low"] as const) {
      const { lighting, sun } = makeLighting(quality);
      lighting.applyFrame(base, null);
      const from = sunDirection(sun);
      lighting.setBounds({ minX: 20, maxX: 44, minZ: -30, maxZ: -12 });
      expect(lighting.busy()).toBe(false);
      // No update in between: a resting loop would not send one.
      expect(sun.target.position.x).toBe(32);
      expect(sun.target.position.z).toBe(-21);
      expect(sunDirection(sun).distanceTo(from)).toBeLessThan(1e-9);
    }
  });

  it("fits the shadow frustum around the floor under every look", () => {
    const bounds = { minX: -9, maxX: 14, minZ: -6, maxZ: 11 };
    for (const look of LIGHTING_LOOKS) {
      const { lighting, sun } = makeLighting("high");
      lighting.setBounds(bounds);
      lighting.showLook(look);
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
    lighting.applyFrame(frameOf({ ending: "lost" }), null);
    lighting.update(FRAME, 0);
    expect(early.duskAmount).toBeGreaterThan(0.4);
    expect(getLightingState(bare).duskAmount).toBe(0);
  });

  it("removes its lights and goes back to daylight on dispose", () => {
    const { scene, lighting } = makeLighting();
    expect(scene.children).toEqual([lighting.root]);
    lighting.applyFrame(frameOf({ ending: "lost" }), null);
    lighting.update(FRAME, 0);
    lighting.dispose();
    expect(scene.children).toEqual([]);
    expect(getLightingState(scene)).toEqual({ duskAmount: 0, daylight: 1 });
  });
});
