import * as THREE from "three";
import type { LookId, OfficeIndex, OfficeScene, QualityLevel, WorldFrame, WorldSystem } from "../types";
import type { GroundBounds } from "./CameraRig";
import { lookFor } from "./colors";
import { bindLightingState, releaseLightingState, type LightingState } from "./lightingState";
import { saturate, smoothstep } from "./math";

export { getLightingState } from "./lightingState";
export type { LightingState } from "./lightingState";

export interface LightingDeps {
  scene: THREE.Scene;
  quality: QualityLevel;
  reducedMotion: boolean;
}

/** One complete look for the scene. Lighting only ever blends between these. */
export interface LightKey {
  readonly sunColor: THREE.Color;
  readonly skyColor: THREE.Color;
  readonly groundColor: THREE.Color;
  /** Unit vector from the scene toward the sun. */
  readonly sunDirection: THREE.Vector3;
  sunIntensity: number;
  hemiIntensity: number;
  fillIntensity: number;
  /** Published as LightingState.duskAmount. */
  dusk: number;
}

const key = (
  sunColor: number,
  sunIntensity: number,
  sunDirection: readonly [number, number, number],
  skyColor: number,
  groundColor: number,
  hemiIntensity: number,
  fillIntensity: number,
  dusk: number
): LightKey => ({
  sunColor: new THREE.Color(sunColor),
  skyColor: new THREE.Color(skyColor),
  groundColor: new THREE.Color(groundColor),
  sunDirection: new THREE.Vector3(...sunDirection).normalize(),
  sunIntensity,
  hemiIntensity,
  fillIntensity,
  dusk,
});

const luminance = (color: THREE.Color): number => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

/** How brightly a look lights the floor: sun (by how high it stands) plus sky. Used for LightingState.daylight. */
const floorBrightness = (look: LightKey): number =>
  look.sunIntensity * Math.max(look.sunDirection.y, 0) * luminance(look.sunColor) +
  look.hemiIntensity * luminance(look.skyColor);

// Intensities are calibrated for a renderer without tone mapping: three.js
// divides diffuse light by π, so in the morning key an upward-facing surface
// receives sun 1.75 × 0.87 / π + sky 1.3 / π + a little fill ≈ 1.0 — i.e. it is
// drawn in exactly the colour it was authored in. The sun is deliberately not
// much stronger than the sky: walls then stay light (≈ 0.75 and 0.6 of their
// colour) and shadows stay soft, which is the desk-toy look rather than a
// harsh noon.
//
// The camera looks from (+X, +Y, +Z) and the tall walls stand on the −X and −Z
// edges, which shapes every sun position below:
//  • By day the sun is high on the −X/+Z side (the viewer's left), so shadows
//    fall toward the viewer's right and the left wall only shades a thin strip.
//  • As it sinks it swings round to shine in through the open +Z side. A low
//    sun behind a wall would just put the whole room in that wall's shadow;
//    from the open side it floods the interior with ember light and throws
//    long shadows onto the back wall instead.
const MORNING = key(0xfff6ea, 1.75, [-0.28, 1, 0.52], 0xd9e8ff, 0xb5ada6, 1.3, 1.1, 0);
// The afternoon sun is warm but the sky stays near white: with both warm, every
// cool colour in the office (the carpet, the glass, half the shirts) went grey.
const AFTERNOON = key(0xffe2b8, 1.75, [0.1, 0.8, 0.9], 0xf3eef6, 0xa8947d, 1.15, 1.0, 0.15);
/**
 * Ember key against a cool, dimmer sky, so anything emissive glows. The sun is
 * kept well short of full strength and the sky fairly blue: lit faces go amber,
 * shaded ones go blue-violet, and the office keeps its colours instead of
 * turning one shade of terracotta.
 */
const DUSK = key(0xffaa78, 1.6, [0.3, 0.6, 1], 0x8e9ad8, 0x4a4350, 0.95, 0.5, 1);
const NIGHT = key(0x7f9bd9, 0.5, [0.2, 0.9, 0.6], 0x2b3861, 0x10131c, 0.6, 0.2, 1);
const SUNRISE = key(0xffb48a, 1.7, [-0.4, 0.36, 0.95], 0xf2c4c9, 0x6b5a60, 0.8, 0.5, 0.55);
const WIN = key(0xffe39a, 2.2, [-0.2, 0.95, 0.6], 0xfff0c2, 0xb89b6a, 1.5, 1.1, 0);
/**
 * Lights out: cold moonlight and a dim blue sky, with the screens and lamps
 * glowing. Dark enough to read as the end at a glance (the floor gets well under
 * a sixth of the morning's light), but the cool fill from the camera's side keeps
 * the furniture and the empty desks legible.
 */
const LOSS = key(0x9aabcb, 0.78, [0.1, 0.9, 0.5], 0x56627e, 0x161a22, 0.62, 0.34, 0.45);

// The resting lights of the eras that have no decade's light of their own. Daylight all (no glow), but twilight's
// faint dusk, so no two eras rest in the same light.
/** A high white sun: the gold rush at full tilt. */
const NOON = key(0xffffff, 1.85, [-0.15, 1, 0.3], 0xe6f0ff, 0xb8b2aa, 1.35, 1.1, 0);
/** Grey-blue and low in contrast: the bust. */
const OVERCAST = key(0xdfe6f0, 1.2, [-0.2, 1, 0.5], 0xd0d8e4, 0xa8aab0, 1.55, 1.2, 0);
/** A warm late sun: the years of cheap money. */
const GOLDEN = key(0xffd08a, 1.75, [0.2, 0.62, 0.95], 0xf6e6d2, 0x9c8468, 1.1, 0.9, 0);
/** An even cool white: the agents' years. */
const STUDIO = key(0xf2f6ff, 1.6, [-0.25, 1, 0.55], 0xeef3ff, 0xc2c6cc, 1.45, 1.2, 0);
/** A crisp white sun under a clear blue sky: the phones' years, all gloss and glass. */
const CLEAR = key(0xffffff, 1.95, [-0.35, 1, 0.4], 0xb9d6ff, 0xc4c8cc, 1.2, 1.15, 0);
/** A violet sky and a low warm sun: the ambient years. */
const TWILIGHT = key(0xffc49a, 1.4, [0.25, 0.5, 1], 0xc8b8f0, 0x5c5070, 1.0, 0.7, 0.3);

const MORNING_BRIGHTNESS = floorBrightness(MORNING);

/** Every look the lighting can settle on, by name. */
export type LightingLook =
  | "morning"
  | "afternoon"
  | "dusk"
  | "night"
  | "sunrise"
  | "win"
  | "loss"
  | "noon"
  | "overcast"
  | "golden"
  | "studio"
  | "twilight"
  | "clear";

const LOOKS: Record<LightingLook, LightKey> = {
  morning: MORNING,
  afternoon: AFTERNOON,
  dusk: DUSK,
  night: NIGHT,
  sunrise: SUNRISE,
  win: WIN,
  loss: LOSS,
  noon: NOON,
  overcast: OVERCAST,
  golden: GOLDEN,
  studio: STUDIO,
  twilight: TWILIGHT,
  clear: CLEAR,
};

export const LIGHTING_LOOKS: readonly LightingLook[] = [
  "morning",
  "afternoon",
  "dusk",
  "night",
  "sunrise",
  "win",
  "loss",
  "noon",
  "overcast",
  "golden",
  "studio",
  "twilight",
  "clear",
];

/** The key of a mood: what the lighting glides to when it settles on it. Read it, do not change it. */
export const lightingKeyFor = (mood: LightingLook): Readonly<LightKey> => LOOKS[mood];

/**
 * The daytime look each office rests in, by the office's look and then by office (0 the garage … 4 the campus).
 * A year has no clock, so an office has one light for as long as nothing happens. The classic look is the old
 * full-energy morning everywhere; each era rests in a light of its own, the same in all five offices.
 */
const allDay = (mood: LightingLook): readonly [LightingLook, LightingLook, LightingLook, LightingLook, LightingLook] => [
  mood,
  mood,
  mood,
  mood,
  mood,
];
const RESTING_LOOKS: Record<LookId, readonly [LightingLook, LightingLook, LightingLook, LightingLook, LightingLook]> = {
  classic: allDay("morning"),
  // The warm low sun of dial-up, the high noon of the gold rush, the grey of the bust, the clear blue day of the
  // phones, the golden light of cheap money, the clean early light of the winter, the studio white of the agents
  // and the violet twilight of the ambient years.
  "dial-up": allDay("afternoon"),
  "gold-rush": allDay("noon"),
  bust: allDay("overcast"),
  phones: allDay("clear"),
  "cheap-money": allDay("golden"),
  "winter-ai": allDay("sunrise"),
  agents: allDay("studio"),
  ambient: allDay("twilight"),
};

/** The look an office rests in. An office out of range rests as the garage does. */
export const restingLook = (office: OfficeIndex, look: LookId): LightingLook => {
  const looks = RESTING_LOOKS[look];
  return looks[office] ?? looks[0];
};

/**
 * Cool fill from the camera's side, leaning toward +X: those faces never see
 * the daytime sun, and without the fill they would sink to a third of their
 * colour. With it a box reads as three clean tones — top, left, right.
 */
const FILL_COLOR = 0xdfe9ff;
const FILL_DIRECTION = new THREE.Vector3(0.8, 0.35, 0.5).normalize();

/** Decay rates (1/s) of the glide toward a new look. */
const NORMAL_RATE = 2.4;
/** The run ending is a moment; let it breathe. */
const SLOW_RATE = 0.9;
/**
 * A glide never quite arrives. Once every part of the light is within this of where it is heading (intensities,
 * colour channels, the sun's direction, all of the order of 1), it is put there, and the lighting is at rest.
 */
const ARRIVED = 1e-3;

const SWEEP_SECONDS = 1.5;
/** Fractions of the year sweep at which it is darkest, and at which the sun breaks the horizon. */
const SWEEP_NIGHT_AT = 0.32;
const SWEEP_SUNRISE_AT = 0.64;

const SHADOW_MAP_SIZE = 2048;
/** Blur radius in shadow-map texels: soft enough to read as a toy, sharp enough to ground things. */
const SHADOW_RADIUS = 3;
/** < 1 lets a little sun leak into shadows so they stay coloured rather than grey. */
const SHADOW_STRENGTH = 0.78;
/** Depth offset in world units (converted per frustum) — just enough to stop acne on box tops. */
const SHADOW_BIAS_UNITS = 0.012;
const SHADOW_NORMAL_BIAS = 0.035;
/** Gap between the shadow frustum's content and the light, in world units. */
const SUN_STANDOFF = 10;
/** The shadow frustum covers the floor grown by this much, and this far up. */
const SHADOW_MARGIN = 2;
const SHADOW_HEIGHT = 7;

const copyKey = (from: LightKey, to: LightKey): LightKey => {
  to.sunColor.copy(from.sunColor);
  to.skyColor.copy(from.skyColor);
  to.groundColor.copy(from.groundColor);
  to.sunDirection.copy(from.sunDirection);
  to.sunIntensity = from.sunIntensity;
  to.hemiIntensity = from.hemiIntensity;
  to.fillIntensity = from.fillIntensity;
  to.dusk = from.dusk;
  return to;
};

/** out = a blended toward b by t. `out` may be `a` or `b`. */
const mixKeys = (a: LightKey, b: LightKey, t: number, out: LightKey): LightKey => {
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.skyColor.lerpColors(a.skyColor, b.skyColor, t);
  out.groundColor.lerpColors(a.groundColor, b.groundColor, t);
  out.sunDirection.lerpVectors(a.sunDirection, b.sunDirection, t).normalize();
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.fillIntensity = a.fillIntensity + (b.fillIntensity - a.fillIntensity) * t;
  out.dusk = a.dusk + (b.dusk - a.dusk) * t;
  return out;
};

const colorGap = (a: THREE.Color, b: THREE.Color): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

/** How far apart two looks are: the largest difference in any one part. */
const keyGap = (a: LightKey, b: LightKey): number =>
  Math.max(
    colorGap(a.sunColor, b.sunColor),
    colorGap(a.skyColor, b.skyColor),
    colorGap(a.groundColor, b.groundColor),
    Math.abs(a.sunDirection.x - b.sunDirection.x),
    Math.abs(a.sunDirection.y - b.sunDirection.y),
    Math.abs(a.sunDirection.z - b.sunDirection.z),
    Math.abs(a.sunIntensity - b.sunIntensity),
    Math.abs(a.hemiIntensity - b.hemiIntensity),
    Math.abs(a.fillIntensity - b.fillIntensity),
    Math.abs(a.dusk - b.dusk)
  );

/** Where the light of a scene comes to rest: the ending's look once the run is over, the office's daytime look until then. */
const goalKey = (scene: OfficeScene, out: LightKey): LightKey => {
  if (scene.ending === "won") return copyKey(WIN, out);
  if (scene.ending === "lost") return copyKey(LOSS, out);
  return copyKey(LOOKS[restingLook(scene.office, lookFor(scene.era))], out);
};

/**
 * Sun, sky and fill lights, driven by the office scene: one resting daytime look per office (a year has no
 * clock), a night→sunrise sweep when the year turns, and a slow fade to a special look when the run ends.
 */
export class Lighting implements WorldSystem {
  /** Holds every light. Owned by this class. */
  readonly root = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly reducedMotion: boolean;
  private readonly castShadows: boolean;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly state: LightingState;
  /** What is on screen right now. */
  private readonly shown = copyKey(MORNING, key(0, 0, [0, 1, 0], 0, 0, 0, 0, 0));
  /** Where `shown` is heading. */
  private readonly goal = copyKey(MORNING, key(0, 0, [0, 1, 0], 0, 0, 0, 0, 0));
  /** The goal before the latest frame, to tell a glide that carries on from one that turns. */
  private readonly lastGoal = copyKey(MORNING, key(0, 0, [0, 1, 0], 0, 0, 0, 0, 0));
  private readonly sweepFrom = copyKey(MORNING, key(0, 0, [0, 1, 0], 0, 0, 0, 0, 0));
  private readonly shadowCenter = new THREE.Vector3();
  private shadowRadius = 12;
  private rate = NORMAL_RATE;
  /** Seconds into the year sweep; negative when not playing. */
  private sweepTime = -1;
  /** True while `shown` is still gliding toward `goal`. */
  private gliding = false;

  constructor(deps: LightingDeps) {
    this.scene = deps.scene;
    this.reducedMotion = deps.reducedMotion;
    this.castShadows = deps.quality === "high";
    this.state = bindLightingState(deps.scene);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.fill = new THREE.DirectionalLight(FILL_COLOR, 0.5);
    this.fill.position.copy(FILL_DIRECTION).multiplyScalar(30);

    if (this.castShadows) {
      const { shadow } = this.sun;
      this.sun.castShadow = true;
      shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      shadow.radius = SHADOW_RADIUS;
      shadow.intensity = SHADOW_STRENGTH;
      shadow.normalBias = SHADOW_NORMAL_BIAS;
    }

    this.root.name = "lighting";
    // The targets must live in the scene graph or their world matrices never update.
    this.root.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    deps.scene.add(this.root);

    this.setBounds({ minX: -6, maxX: 6, minZ: -5, maxZ: 5 });
  }

  /**
   * Adaptive quality (M2): turn the sun's shadow casting off under sustained
   * frame pressure. Only meaningful on "high" (a "low" world never casts);
   * the World never turns it back on mid-session.
   *
   * Turning it off also frees the shadow map (2048² of depth, ~32 MiB on a
   * device just judged too slow): three.js stops rendering shadow maps once no
   * light casts, so it would otherwise stay allocated for the session. The
   * method stays reversible: with `map` null, WebGLShadowMap builds a fresh
   * render target the next time the sun casts.
   */
  setShadowsEnabled(enabled: boolean): void {
    if (!this.castShadows || this.sun.castShadow === enabled) return;
    this.sun.castShadow = enabled;
    if (!enabled) {
      this.sun.shadow.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** The shadow frustum (and the sun's orbit) is fitted around this floor area. */
  setBounds(bounds: GroundBounds): void {
    const width = bounds.maxX - bounds.minX + SHADOW_MARGIN * 2;
    const depth = bounds.maxZ - bounds.minZ + SHADOW_MARGIN * 2;
    this.shadowCenter.set((bounds.minX + bounds.maxX) / 2, SHADOW_HEIGHT / 2, (bounds.minZ + bounds.maxZ) / 2);
    // A sphere rather than a tight box: the frustum then has the same size
    // whichever way the sun points, so shadow texels do not swim as it moves.
    this.shadowRadius = Math.hypot(width, depth, SHADOW_HEIGHT) / 2;
    this.fill.target.position.set(this.shadowCenter.x, 0, this.shadowCenter.z);
    this.fill.position.copy(this.fill.target.position).addScaledVector(FILL_DIRECTION, 30);
    // The sun stands off from the centre of the bounds. At rest nothing else would move it there.
    this.apply();

    if (!this.castShadows) return;
    const { shadow } = this.sun;
    const camera = shadow.camera;
    const radius = this.shadowRadius;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = SUN_STANDOFF / 2;
    camera.far = SUN_STANDOFF * 1.5 + radius * 2;
    camera.updateProjectionMatrix();
    // three.js expects the bias as a fraction of the frustum's depth range.
    shadow.bias = -SHADOW_BIAS_UNITS / (camera.far - camera.near);
  }

  /**
   * Snap to a named look and hold it until the next applyFrame. The game
   * never calls this (frames drive the lighting); it lets dev pages and
   * galleries show props under exactly the lights the world will use.
   */
  showLook(look: LightingLook): void {
    copyKey(LOOKS[look], this.goal);
    copyKey(this.goal, this.shown);
    this.sweepTime = -1;
    this.gliding = false;
    this.apply();
  }

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    copyKey(this.goal, this.lastGoal);
    goalKey(next.scene, this.goal);

    let snap = prev === null;
    let sweep = false;
    let ended = false;
    for (const event of next.events) {
      switch (event.kind) {
        case "run-reset":
          snap = true;
          break;
        case "year-advanced":
          sweep = true;
          break;
        case "ended":
          ended = true;
          break;
        case "office-changed":
          break;
      }
    }

    if (snap || this.reducedMotion) {
      // Reduced motion: no sweeps and no glides, the new look simply is.
      copyKey(this.goal, this.shown);
      this.sweepTime = -1;
      this.gliding = false;
      this.apply();
    } else if (ended) {
      // The year that ends the run does not sweep round to a morning: the light fades, slowly, to the ending.
      this.rate = SLOW_RATE;
      this.sweepTime = -1;
      this.gliding = true;
    } else if (sweep) {
      copyKey(this.shown, this.sweepFrom);
      this.sweepTime = 0;
      this.gliding = false;
    } else if (this.sweepTime < 0) {
      // Anything else leaves a sweep in progress alone (it ends on the goal), and otherwise glides if there is anywhere to go.
      // A glide already under way to this same goal keeps its rate, so a frame with no news does not hurry an ending's
      // slow fade. A glide that starts here, or turns to another goal, runs at the normal rate.
      const sameGlide = this.gliding && keyGap(this.lastGoal, this.goal) === 0;
      this.gliding = keyGap(this.shown, this.goal) > 0;
      if (this.gliding && !sameGlide) this.rate = NORMAL_RATE;
    }
  }

  update(dt: number, elapsed: number): void {
    void elapsed;
    // A frame of no length, or of a length that is not a number, moves nothing. A NaN let in here would spread to
    // every light and never leave, and the lighting would report itself busy for good.
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.sweepTime >= 0) {
      this.advanceSweep(dt);
    } else if (this.gliding) {
      mixKeys(this.shown, this.goal, 1 - Math.exp(-this.rate * dt), this.shown);
      if (keyGap(this.shown, this.goal) < ARRIVED) {
        copyKey(this.goal, this.shown);
        this.gliding = false;
      }
    } else {
      return;
    }
    this.apply();
  }

  busy(): boolean {
    return this.sweepTime >= 0 || this.gliding;
  }

  dispose(): void {
    this.root.removeFromParent();
    // Light.dispose() frees the shadow map render target.
    this.sun.dispose();
    this.fill.dispose();
    this.hemi.dispose();
    releaseLightingState(this.scene);
  }

  /** The year turns: wherever we are → night → sunrise → the office's resting look. */
  private advanceSweep(dt: number): void {
    this.sweepTime += dt;
    const progress = this.sweepTime / SWEEP_SECONDS;
    if (progress >= 1) {
      this.sweepTime = -1;
      copyKey(this.goal, this.shown);
    } else if (progress < SWEEP_NIGHT_AT) {
      mixKeys(this.sweepFrom, NIGHT, smoothstep(progress / SWEEP_NIGHT_AT), this.shown);
    } else if (progress < SWEEP_SUNRISE_AT) {
      const t = (progress - SWEEP_NIGHT_AT) / (SWEEP_SUNRISE_AT - SWEEP_NIGHT_AT);
      mixKeys(NIGHT, SUNRISE, smoothstep(t), this.shown);
    } else {
      const t = (progress - SWEEP_SUNRISE_AT) / (1 - SWEEP_SUNRISE_AT);
      mixKeys(SUNRISE, this.goal, smoothstep(t), this.shown);
    }
  }

  /** Push `shown` into the actual lights. */
  private apply(): void {
    const { shown, sun, hemi, fill } = this;
    sun.color.copy(shown.sunColor);
    sun.intensity = shown.sunIntensity;
    hemi.color.copy(shown.skyColor);
    hemi.groundColor.copy(shown.groundColor);
    hemi.intensity = shown.hemiIntensity;
    fill.intensity = shown.fillIntensity;

    sun.target.position.copy(this.shadowCenter);
    sun.position.copy(this.shadowCenter).addScaledVector(shown.sunDirection, this.shadowRadius + SUN_STANDOFF);

    this.state.duskAmount = saturate(shown.dusk);
    this.state.daylight = saturate(floorBrightness(shown) / MORNING_BRIGHTNESS);
  }
}
