import * as THREE from "three";
import { WIN_ENDINGS } from "../outcomes";
import type { QualityLevel, WorldEvent, WorldSnapshot, WorldSystem } from "../types";
import type { GroundBounds } from "./CameraRig";
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
interface LightKey {
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
/** Before the company exists: a single warm bulb in a dark garage, with enough cool bounce to read the room. */
const SETUP = key(0xffbd80, 1.45, [0.15, 1, 0.45], 0x4a5c8c, 0x16161f, 0.6, 0.2, 0.75);
const WIN = key(0xffe39a, 2.2, [-0.2, 0.95, 0.6], 0xfff0c2, 0xb89b6a, 1.5, 1.1, 0);
/**
 * Lights out: cold moonlight and a dim blue sky, with the screens and lamps
 * glowing. Dark enough to read as the end at a glance (the floor gets well under
 * a sixth of the morning's light), but the cool fill from the camera's side keeps
 * the furniture and the two founders left at their desks legible.
 */
const LOSS = key(0x9aabcb, 0.78, [0.1, 0.9, 0.5], 0x56627e, 0x161a22, 0.62, 0.34, 0.45);

const MORNING_BRIGHTNESS = floorBrightness(MORNING);

/** Every look the lighting can settle on, by name. */
export type LightingLook = "morning" | "afternoon" | "dusk" | "night" | "sunrise" | "setup" | "win" | "loss";

const LOOKS: Record<LightingLook, LightKey> = {
  morning: MORNING,
  afternoon: AFTERNOON,
  dusk: DUSK,
  night: NIGHT,
  sunrise: SUNRISE,
  setup: SETUP,
  win: WIN,
  loss: LOSS,
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
/** Setup finishing and the run ending are moments; let them breathe. */
const SLOW_RATE = 0.9;

const SWEEP_SECONDS = 1.5;
/** Fractions of the week sweep at which it is darkest, and at which the sun breaks the horizon. */
const SWEEP_NIGHT_AT = 0.32;
const SWEEP_SUNRISE_AT = 0.64;

const FLICKER_SECONDS = 0.4;
const FLICKER_DEPTH = 0.5;

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

/**
 * The look for a normal working week: action points are the clock. Full AP is
 * morning, half is a warm afternoon, none left is dusk — a quiet nudge to end
 * the week.
 */
const daytimeKey = (ap: number, maxAp: number, out: LightKey): LightKey => {
  const spent = maxAp > 0 ? saturate(1 - ap / maxAp) : 1;
  return spent <= 0.5
    ? mixKeys(MORNING, AFTERNOON, smoothstep(spent * 2), out)
    : mixKeys(AFTERNOON, DUSK, smoothstep(spent * 2 - 1), out);
};

const goalKey = (snapshot: WorldSnapshot, out: LightKey): LightKey => {
  if (snapshot.gameOver) return copyKey(WIN_ENDINGS.has(snapshot.gameOver) ? WIN : LOSS, out);
  if (!snapshot.setupComplete) return copyKey(SETUP, out);
  return daytimeKey(snapshot.ap, snapshot.maxAp, out);
};

/**
 * Sun, sky and fill lights, driven by the game state:
 * time of day from AP, a night→sunrise sweep when the week ends, a flicker
 * when an event lands, and special looks for setup and for the end of a run.
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
  private readonly sweepFrom = copyKey(MORNING, key(0, 0, [0, 1, 0], 0, 0, 0, 0, 0));
  private readonly shadowCenter = new THREE.Vector3();
  private shadowRadius = 12;
  private rate = NORMAL_RATE;
  /** Seconds into the week sweep / event flicker; negative when not playing. */
  private sweepTime = -1;
  private flickerTime = -1;

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
    this.apply(1);
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
   * Snap to a named look and hold it until the next applySnapshot. The game
   * never calls this (snapshots drive the lighting); it lets dev pages and
   * galleries show props under exactly the lights the world will use.
   */
  showLook(look: LightingLook): void {
    copyKey(LOOKS[look], this.goal);
    copyKey(this.goal, this.shown);
    this.sweepTime = -1;
    this.flickerTime = -1;
    this.apply(1);
  }

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    goalKey(next, this.goal);
    this.rate = NORMAL_RATE;

    let snap = prev === null;
    let sweep = false;
    for (const event of events) {
      switch (event.type) {
        case "run-reset":
          snap = true;
          break;
        case "week-advanced":
          sweep = true;
          break;
        case "event-opened":
          if (!this.reducedMotion) this.flickerTime = 0;
          break;
        case "setup-completed":
        case "game-over":
          this.rate = SLOW_RATE;
          break;
        default:
          break;
      }
    }

    if (snap || this.reducedMotion) {
      // Reduced motion: no sweeps and no glides, the new look simply is.
      copyKey(this.goal, this.shown);
      this.sweepTime = -1;
      if (snap) this.flickerTime = -1;
    } else if (sweep) {
      copyKey(this.shown, this.sweepFrom);
      this.sweepTime = 0;
    }
  }

  update(dt: number, elapsed: number): void {
    void elapsed;
    if (this.sweepTime >= 0) this.advanceSweep(dt);
    else mixKeys(this.shown, this.goal, 1 - Math.exp(-this.rate * dt), this.shown);

    let gain = 1;
    if (this.flickerTime >= 0) {
      this.flickerTime += dt;
      if (this.flickerTime >= FLICKER_SECONDS) {
        this.flickerTime = -1;
      } else {
        // Three quick dips, each shallower than the last: a tube light catching.
        const progress = this.flickerTime / FLICKER_SECONDS;
        const dipping = Math.sin(progress * Math.PI * 6) > 0;
        if (dipping) gain = 1 - FLICKER_DEPTH * (1 - progress);
      }
    }
    this.apply(gain);
  }

  dispose(): void {
    this.root.removeFromParent();
    // Light.dispose() frees the shadow map render target.
    this.sun.dispose();
    this.fill.dispose();
    this.hemi.dispose();
    releaseLightingState(this.scene);
  }

  /** Week rollover: wherever we are → night → sunrise → the new morning. */
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

  /** Push `shown` into the actual lights. `gain` scales every intensity (flicker). */
  private apply(gain: number): void {
    const { shown, sun, hemi, fill } = this;
    sun.color.copy(shown.sunColor);
    sun.intensity = shown.sunIntensity * gain;
    hemi.color.copy(shown.skyColor);
    hemi.groundColor.copy(shown.groundColor);
    hemi.intensity = shown.hemiIntensity * gain;
    fill.intensity = shown.fillIntensity * gain;

    sun.target.position.copy(this.shadowCenter);
    sun.position.copy(this.shadowCenter).addScaledVector(shown.sunDirection, this.shadowRadius + SUN_STANDOFF);

    this.state.duskAmount = saturate(shown.dusk);
    this.state.daylight = saturate(floorBrightness(shown) / MORNING_BRIGHTNESS);
  }
}
