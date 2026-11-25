import * as THREE from "three";
import type { ScreenPoint, Vec2, Vec3Like } from "../types";
import { clamp, easeInOutCubic, lerp, saturate } from "./math";

/** The camera sits toward (+X, +Y, +Z) of the point it frames and never rotates. */
export const CAMERA_AZIMUTH = Math.PI / 4;
/** atan(1/√2) ≈ 35.26° — true isometric, so all three world axes foreshorten equally. */
export const CAMERA_ELEVATION = Math.atan(Math.SQRT1_2);

/** Zoom limits, as multiples of the current framing's default scale. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.6;

const DEFAULT_FRAMING_SECONDS = 1.1;
const DEFAULT_FOCUS_SECONDS = 0.8;
const DEFAULT_RESET_SECONDS = 0.6;
const MIN_VIEW_HEIGHT = 0.5;

// Orthographic size comes from the frustum, not from how far away the camera
// body is, so the distance only has to keep everything between the clip planes.
// A ground point at the top or bottom edge of the view is (viewHeight / 2) ·
// cot(elevation) nearer or farther than the framed point; even a 70-unit-tall
// view (far beyond any office at minimum zoom) stays within ±50 of 120.
const CAMERA_DISTANCE = 120;
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 400;

/** Peak shake travel, as a fraction of the visible height, at strength 1. */
const SHAKE_REACH = 0.016;
/** Exponential decay rate (1/s) of a shake: effectively gone after half a second. */
const SHAKE_DECAY = 6;

const SIN_AZ = Math.sin(CAMERA_AZIMUTH);
const COS_AZ = Math.cos(CAMERA_AZIMUTH);
const SIN_EL = Math.sin(CAMERA_ELEVATION);
const COS_EL = Math.cos(CAMERA_ELEVATION);

/** Unit vector from the framed point toward the camera. */
const TO_CAMERA = { x: COS_EL * SIN_AZ, y: SIN_EL, z: COS_EL * COS_AZ };
/** Screen-right and screen-up expressed in world space. */
const RIGHT = { x: COS_AZ, y: 0, z: -SIN_AZ };
const UP = { x: -SIN_EL * SIN_AZ, y: COS_EL, z: -SIN_EL * COS_AZ };
/**
 * How far the ground point under a screen position moves per world unit of
 * screen-right (U) / screen-up (V) travel. V is stretched by 1 / sin(elevation)
 * because the ground plane is seen at a slant.
 */
const GROUND_U = { x: COS_AZ, z: -SIN_AZ };
const GROUND_V = { x: -SIN_AZ / SIN_EL, z: -COS_AZ / SIN_EL };

export interface GroundBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FramingOptions {
  /** Cut straight to the new framing instead of tweening. */
  instant?: boolean;
  /** Tween length in seconds (ignored when `instant`). */
  seconds?: number;
  /**
   * Horizontal world extent (measured along screen-right) that must stay visible
   * at zoom 1. On narrow canvases the view is widened beyond `viewHeight` to fit
   * it, so a phone in portrait still sees the whole floor. 0 / omitted = off.
   */
  fitWidth?: number;
  /**
   * Fraction (0–1] of the viewport's binding dimension the framed extents
   * should fill at zoom 1; the rest is margin. Default 1 (edge to edge).
   */
  fill?: number;
}

export interface FocusPointOptions {
  /** Tween length in seconds. */
  seconds?: number;
}

export interface CameraRigOptions {
  /** Snap instead of tweening and ignore shake requests. */
  reducedMotion?: boolean;
}

interface Tween {
  active: boolean;
  elapsed: number;
  duration: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  fromViewHeight: number;
  toZoom: number;
}

/**
 * Fixed-angle isometric camera. All of the projection maths lives here as plain
 * arithmetic (so it runs in node tests and never allocates); the three.js camera
 * is kept in sync after every change for rendering and raycasting.
 *
 * Vocabulary: the *framing* is the default view for the current office (a
 * ground target + world units visible vertically). *Zoom* is a multiplier on
 * top of it, so zoom 1 always means "the framing's default".
 */
export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  /** Canvas size in CSS pixels. Updated in place by setViewport(); treat as read-only. */
  readonly viewport = { width: 300, height: 150 };

  private readonly reducedMotion: boolean;
  private readonly target = { x: 0, z: 0 };
  private readonly framing = { x: 0, z: 0, viewHeight: 12, fitWidth: 0, fill: 1 };
  private readonly tween: Tween = {
    active: false,
    elapsed: 0,
    duration: 0,
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
    fromViewHeight: 12,
    toZoom: 1,
  };
  private bounds: GroundBounds | null = null;
  private zoomLevel = 1;
  private shakeAmplitude = 0;
  private shakeTime = 0;
  private shakeU = 0;
  private shakeV = 0;
  private revisionCount = 0;

  constructor(options: CameraRigOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
    // Orientation is fixed for the camera's whole life; only its position moves.
    this.camera.position.set(TO_CAMERA.x, TO_CAMERA.y, TO_CAMERA.z);
    this.camera.lookAt(0, 0, 0);
    this.sync();
  }

  /** Bumped whenever the rendered view actually changes; cheap change detection for consumers. */
  get revision(): number {
    return this.revisionCount;
  }

  /** Current zoom multiplier (1 = the framing's default; > 1 is closer). */
  get zoom(): number {
    return this.zoomLevel;
  }

  /** World units currently visible from the top to the bottom of the canvas. */
  get viewHeight(): number {
    return this.defaultViewHeight / this.zoomLevel;
  }

  /** View height at zoom 1 for the current framing and canvas shape. */
  get defaultViewHeight(): number {
    const { viewHeight, fitWidth, fill } = this.framing;
    return (fitWidth > 0 ? Math.max(viewHeight, fitWidth / this.aspect) : viewHeight) / fill;
  }

  /** True while a framing/focus tween or a shake is still playing. */
  get isAnimating(): boolean {
    return this.tween.active || this.shakeAmplitude > 0;
  }

  /** World units covered by one CSS pixel at the current zoom. */
  unitsPerPixel(): number {
    return this.viewHeight / this.viewport.height;
  }

  /** The ground point at the centre of the canvas. */
  getTarget(out: Vec2 = { x: 0, z: 0 }): Vec2 {
    out.x = this.target.x;
    out.z = this.target.z;
    return out;
  }

  /** Canvas CSS size changed. Keeps the same ground point centred. */
  setViewport(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.viewport.width && h === this.viewport.height) return;
    this.viewport.width = w;
    this.viewport.height = h;
    this.sync();
  }

  /**
   * Set the default view for the current office and move the camera to it.
   * Zoom limits and reset() are relative to this framing from now on.
   */
  setFraming(target: Vec2, viewHeight: number, options: FramingOptions = {}): void {
    // Captured before the framing changes so the tween starts from what is on screen now.
    const fromViewHeight = this.viewHeight;
    this.framing.x = target.x;
    this.framing.z = target.z;
    this.framing.viewHeight = Math.max(MIN_VIEW_HEIGHT, viewHeight);
    this.framing.fitWidth = Math.max(0, options.fitWidth ?? 0);
    const fill = options.fill ?? 1;
    this.framing.fill = fill > 0 && fill <= 1 ? fill : 1;
    const seconds = options.instant ? 0 : (options.seconds ?? DEFAULT_FRAMING_SECONDS);
    this.startTween(target.x, target.z, 1, seconds, fromViewHeight);
  }

  /**
   * Glide to look at a ground point, optionally changing how much is visible.
   * Does not change the default framing, so reset() still returns to it.
   */
  focus(target: Vec2, viewHeight?: number, seconds: number = DEFAULT_FOCUS_SECONDS): void {
    const toZoom =
      viewHeight !== undefined && viewHeight > 0
        ? clamp(this.defaultViewHeight / viewHeight, ZOOM_MIN, ZOOM_MAX)
        : this.zoomLevel;
    this.startTween(target.x, target.z, toZoom, seconds, this.viewHeight);
  }

  /**
   * Glide (at the current zoom) so that the world point `world` is drawn at
   * the canvas position `at` (CSS pixels) — e.g. just above a bottom sheet that
   * covers part of the canvas. Never zooms.
   *
   * The pan limit is relaxed by exactly the distance between `at` and the
   * canvas centre, so something at the very edge of the diorama can still be
   * brought to `at`. Afterwards panning only ever moves back toward the limit.
   */
  focusPoint(world: Vec3Like, at: ScreenPoint, options: FocusPointOptions = {}): void {
    const unitsPerPixel = this.unitsPerPixel();
    const { width, height } = this.viewport;
    // Where `world` is drawn now, relative to the centre, in world units of screen-right/up.
    const dx = world.x - this.target.x;
    const dz = world.z - this.target.z;
    const u = dx * RIGHT.x + dz * RIGHT.z;
    const v = dx * UP.x + world.y * UP.y + dz * UP.z;
    // ...and where it should be.
    const wantU = (at.x - width / 2) * unitsPerPixel;
    const wantV = (height / 2 - at.y) * unitsPerPixel;
    const du = u - wantU;
    const dv = v - wantV;
    const toX = this.target.x + du * GROUND_U.x + dv * GROUND_V.x;
    const toZ = this.target.z + du * GROUND_U.z + dv * GROUND_V.z;
    // Ground distance between the canvas centre and `at`.
    const slack = Math.hypot(wantU, wantV / SIN_EL);
    const x = this.bounds ? clamp(toX, this.bounds.minX - slack, this.bounds.maxX + slack) : toX;
    const z = this.bounds ? clamp(toZ, this.bounds.minZ - slack, this.bounds.maxZ + slack) : toZ;
    this.startTween(x, z, this.zoomLevel, options.seconds ?? DEFAULT_FOCUS_SECONDS, this.viewHeight, false);
  }

  /** Return to the framing's default target and zoom. */
  reset(seconds: number = DEFAULT_RESET_SECONDS): void {
    this.startTween(this.framing.x, this.framing.z, 1, seconds, this.viewHeight);
  }

  /**
   * Limit panning: the centre of the view is kept inside `bounds` grown by
   * `margin` on every side. Pass null to remove the limit.
   */
  setBounds(bounds: GroundBounds | null, margin = 0): void {
    const next = bounds
      ? {
          minX: bounds.minX - margin,
          maxX: bounds.maxX + margin,
          minZ: bounds.minZ - margin,
          maxZ: bounds.maxZ + margin,
        }
      : null;
    // Called on every game-state change; an unchanged limit must not undo a
    // focusPoint() that deliberately went past it.
    const previous = this.bounds;
    if (
      previous === next ||
      (previous &&
        next &&
        previous.minX === next.minX &&
        previous.maxX === next.maxX &&
        previous.minZ === next.minZ &&
        previous.maxZ === next.maxZ)
    ) {
      return;
    }
    this.bounds = next;
    if (this.tween.active) {
      this.tween.toX = this.clampX(this.tween.toX);
      this.tween.toZ = this.clampZ(this.tween.toZ);
      return;
    }
    const x = this.clampX(this.target.x);
    const z = this.clampZ(this.target.z);
    if (x === this.target.x && z === this.target.z) return;
    this.target.x = x;
    this.target.z = z;
    this.sync();
  }

  /**
   * Drag-pan: the ground under the pointer follows a pointer movement of
   * (dx, dy) CSS pixels exactly, until the pan limit is reached.
   */
  panByPixels(dx: number, dy: number): void {
    this.tween.active = false;
    const unitsPerPixel = this.unitsPerPixel();
    const du = dx * unitsPerPixel;
    const dv = -dy * unitsPerPixel;
    this.target.x = this.clampX(this.target.x - du * GROUND_U.x - dv * GROUND_V.x, this.target.x);
    this.target.z = this.clampZ(this.target.z - du * GROUND_U.z - dv * GROUND_V.z, this.target.z);
    this.sync();
  }

  /**
   * Multiply the zoom by `factor` (> 1 zooms in), keeping the ground point under
   * `at` (CSS pixels; defaults to the canvas centre) fixed on screen.
   */
  zoomAt(factor: number, at?: ScreenPoint): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.tween.active = false;
    const nextZoom = clamp(this.zoomLevel * factor, ZOOM_MIN, ZOOM_MAX);
    if (nextZoom === this.zoomLevel) return;

    const { width, height } = this.viewport;
    const before = this.unitsPerPixel();
    const after = before * (this.zoomLevel / nextZoom);
    const px = (at ? at.x : width / 2) - width / 2;
    const py = height / 2 - (at ? at.y : height / 2);
    // The pointer's offset from centre covers less ground after zooming in, so
    // slide the target toward the pointer by exactly the difference.
    const du = px * (before - after);
    const dv = py * (before - after);
    this.zoomLevel = nextZoom;
    this.target.x = this.clampX(this.target.x + du * GROUND_U.x + dv * GROUND_V.x, this.target.x);
    this.target.z = this.clampZ(this.target.z + du * GROUND_U.z + dv * GROUND_V.z, this.target.z);
    this.sync();
  }

  /** Kick the camera; `strength` 0..1. Stronger requests win over a decaying one. */
  shake(strength: number): void {
    if (this.reducedMotion) return;
    this.shakeAmplitude = Math.max(this.shakeAmplitude, saturate(strength));
  }

  /** Advance tweens and shake. Call once per frame before rendering. */
  update(dt: number): void {
    let changed = false;
    if (this.tween.active) {
      this.advanceTween(dt);
      changed = true;
    }
    if (this.shakeAmplitude > 0) {
      this.advanceShake(dt);
      changed = true;
    }
    if (changed) this.sync();
  }

  /**
   * World position → CSS pixels relative to the canvas's top-left corner.
   * Ignores shake on purpose so DOM anchored to the result stays steady.
   */
  project(world: Vec3Like, out: ScreenPoint = { x: 0, y: 0 }): ScreenPoint {
    const dx = world.x - this.target.x;
    const dz = world.z - this.target.z;
    const u = dx * RIGHT.x + dz * RIGHT.z;
    const v = dx * UP.x + world.y * UP.y + dz * UP.z;
    const pixelsPerUnit = this.viewport.height / this.viewHeight;
    out.x = this.viewport.width / 2 + u * pixelsPerUnit;
    out.y = this.viewport.height / 2 - v * pixelsPerUnit;
    return out;
  }

  /** CSS pixels → the point on the floor plane (y = 0) drawn at that pixel. */
  screenToGround(screen: ScreenPoint, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const unitsPerPixel = this.unitsPerPixel();
    const u = (screen.x - this.viewport.width / 2) * unitsPerPixel;
    const v = (this.viewport.height / 2 - screen.y) * unitsPerPixel;
    out.x = this.target.x + u * GROUND_U.x + v * GROUND_V.x;
    out.z = this.target.z + u * GROUND_U.z + v * GROUND_V.z;
    return out;
  }

  private get aspect(): number {
    return this.viewport.width / this.viewport.height;
  }

  /**
   * Keep a view-centre coordinate inside the pan limit. With `from` (where the
   * centre is now), a centre that is already outside — after focusPoint() — may
   * stay there and move back in, but never further out: no jump on the next drag.
   */
  private clampX(x: number, from?: number): number {
    if (!this.bounds) return x;
    const { minX, maxX } = this.bounds;
    return from === undefined ? clamp(x, minX, maxX) : clamp(x, Math.min(minX, from), Math.max(maxX, from));
  }

  private clampZ(z: number, from?: number): number {
    if (!this.bounds) return z;
    const { minZ, maxZ } = this.bounds;
    return from === undefined ? clamp(z, minZ, maxZ) : clamp(z, Math.min(minZ, from), Math.max(maxZ, from));
  }

  private startTween(
    toX: number,
    toZ: number,
    toZoom: number,
    seconds: number,
    fromViewHeight: number,
    clampToBounds = true
  ): void {
    const x = clampToBounds ? this.clampX(toX) : toX;
    const z = clampToBounds ? this.clampZ(toZ) : toZ;
    if (seconds <= 0 || this.reducedMotion) {
      this.tween.active = false;
      this.target.x = x;
      this.target.z = z;
      this.zoomLevel = toZoom;
      this.sync();
      return;
    }
    const tween = this.tween;
    tween.active = true;
    tween.elapsed = 0;
    tween.duration = seconds;
    tween.fromX = this.target.x;
    tween.fromZ = this.target.z;
    tween.toX = x;
    tween.toZ = z;
    tween.fromViewHeight = fromViewHeight;
    tween.toZoom = toZoom;
    // The framing may have just changed under us: re-express what is on screen
    // right now as a zoom of the new framing so the first tween frame is seamless.
    this.zoomLevel = this.defaultViewHeight / fromViewHeight;
    this.sync();
  }

  private advanceTween(dt: number): void {
    const tween = this.tween;
    tween.elapsed += dt;
    const t = Math.min(tween.elapsed / tween.duration, 1);
    if (t >= 1) {
      tween.active = false;
      this.target.x = tween.toX;
      this.target.z = tween.toZ;
      this.zoomLevel = tween.toZoom;
      return;
    }
    const eased = easeInOutCubic(t);
    this.target.x = lerp(tween.fromX, tween.toX, eased);
    this.target.z = lerp(tween.fromZ, tween.toZ, eased);
    // Interpolate the scale geometrically so the zoom reads as a constant speed.
    const base = this.defaultViewHeight;
    const toViewHeight = base / tween.toZoom;
    const viewHeight = tween.fromViewHeight * Math.pow(toViewHeight / tween.fromViewHeight, eased);
    this.zoomLevel = base / viewHeight;
  }

  private advanceShake(dt: number): void {
    this.shakeTime += dt;
    this.shakeAmplitude *= Math.exp(-SHAKE_DECAY * dt);
    if (this.shakeAmplitude < 0.01) {
      this.shakeAmplitude = 0;
      this.shakeU = 0;
      this.shakeV = 0;
      return;
    }
    // Two incommensurate sines per axis: reads as noise, costs nothing, never allocates.
    const reach = this.shakeAmplitude * SHAKE_REACH * this.viewHeight;
    const t = this.shakeTime;
    this.shakeU = reach * (Math.sin(t * 61.3) + 0.5 * Math.sin(t * 127.1 + 1.3));
    this.shakeV = reach * (Math.sin(t * 73.7 + 2.1) + 0.5 * Math.sin(t * 149.3 + 0.4));
  }

  /** Push the rig's state into the three.js camera (frustum + position). */
  private sync(): void {
    const { camera } = this;
    const halfHeight = this.viewHeight / 2;
    const halfWidth = halfHeight * this.aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    camera.position.set(
      this.target.x + TO_CAMERA.x * CAMERA_DISTANCE + RIGHT.x * this.shakeU + UP.x * this.shakeV,
      TO_CAMERA.y * CAMERA_DISTANCE + UP.y * this.shakeV,
      this.target.z + TO_CAMERA.z * CAMERA_DISTANCE + RIGHT.z * this.shakeU + UP.z * this.shakeV
    );
    // Raycasts can happen between frames (taps), so matrices must be current immediately.
    camera.updateMatrixWorld();
    this.revisionCount += 1;
  }
}
