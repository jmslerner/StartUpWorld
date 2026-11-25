/** The React-facing WorldHandle and its callbacks. Re-exported by ../types. */

import type { InteractableTarget } from "./interaction";
import type { OfficeScene } from "./scene";

/** CSS pixels relative to the canvas's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in the same CSS-pixel space as ScreenPoint. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WorldFocusOptions {
  /**
   * CSS pixels at the bottom of the canvas that are covered (a docked card):
   * the target is brought into the area above them.
   */
  avoidBottomPx?: number;
  /** CSS pixels at the top of the canvas that are covered (the HUD row). */
  avoidTopPx?: number;
  /** Glide length in seconds (snaps under reduced motion). */
  seconds?: number;
}

export interface InteractableHit {
  target: InteractableTarget;
  label: string;
  /** Projected anchor position (not the pointer position). */
  screen: ScreenPoint;
}

export interface WorldCallbacks {
  onHover(hit: InteractableHit | null): void;
  /** Click / tap on an interactable (or on empty space → null). */
  onSelect(hit: InteractableHit | null): void;
  /** The selected target's projected anchor moved (camera pan/zoom, person walking). null = no longer visible. */
  onSelectedAnchorMove?(screen: ScreenPoint | null): void;
  onContextLost?(): void;
  /** The WebGL context came back after a loss; the world has already resumed rendering. */
  onContextRestored?(): void;
  /**
   * The zoom actually changed by `factor` (> 1 closer) because of the player: a wheel notch, a
   * pinch, or WorldHandle.zoomBy. Not called at the zoom limits, nor for camera moves the
   * world makes by itself (re-framing, reset).
   */
  onZoom?(factor: number): void;
}

export interface WorldHandle {
  /** Show this scene. The world works out the people (nextCast) and what changed (sceneEvents) by itself. */
  setScene(scene: OfficeScene): void;
  /** Canvas CSS size changed. */
  resize(width: number, height: number): void;
  /** Highlight a target as selected (null clears). */
  setSelected(target: InteractableTarget | null): void;
  /** Projected anchor of a target, or null if it is not in the scene. */
  project(target: InteractableTarget): ScreenPoint | null;
  /** Where a target is drawn: the projected box around its visible meshes and its anchor. Null if not in the scene. */
  screenBounds(target: InteractableTarget): ScreenRect | null;
  /**
   * Pan (never zoom) so the target sits in the visible part of the canvas, e.g.
   * above a docked card. Does nothing when it is already comfortably in view.
   */
  focus(target: InteractableTarget, options?: WorldFocusOptions): void;
  /** Indices into the current layout's desks that nobody sits at, lowest first. */
  freeDeskSlots(): readonly number[];
  /** People of the company who are not drawn (the count on the sign beside the door). */
  hiddenCount(): number;
  /** Multiply the current zoom (>1 zooms in). Clamped to sane limits. */
  zoomBy(factor: number): void;
  /** Return to the office's default framing. */
  resetCamera(): void;
  /** Pause/resume the render loop (tab hidden, canvas off-screen). */
  setPaused(paused: boolean): void;
  dispose(): void;
}
