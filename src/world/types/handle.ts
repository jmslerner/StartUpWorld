/** The React-facing WorldHandle and its callbacks. Re-exported by ../types. */

import type { InteractableTarget } from "./interaction";
import type { OfficeScene, Team } from "./scene";

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

/** Figures read from the renderer and the systems: what the lab page shows and the browser checks measure. */
export interface WorldStats {
  /** Draw calls of the last frame drawn, the shadow pass included. */
  readonly drawCalls: number;
  /** Triangles of the last frame drawn. */
  readonly triangles: number;
  /** Geometries and textures the renderer holds right now. Still readable after dispose, when both should be 0. */
  readonly geometries: number;
  readonly textures: number;
  /** Figures drawn: the people in the office and those still walking out of it. At most 56; 0 once disposed. */
  readonly figures: number;
  /** People of the company who are not drawn: the count on the sign beside the door. */
  readonly hidden: number;
  /** Frames drawn since the world was created. It stands still while the world is at rest. */
  readonly framesDrawn: number;
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
  /**
   * Keep the world awake (true) or let it rest (false, which is how it starts). At rest, a second after the last
   * thing stopped moving, nothing is drawn until something changes. Kept awake, a frame is drawn every time the
   * page offers one, and people wander from their desks now and then; without it nobody ever does, so after any
   * scene the world comes to rest once the walks are done. For looking at the office's idle movement.
   */
  setKeepAwake(on: boolean): void;
  /** What the renderer and the systems count right now. */
  stats(): WorldStats;
  /**
   * Take the graphics context away, as a browser may at any time, and give it back. For checking what the view
   * does then; nothing in the game calls them. Losing reports onContextLost; restoring, onContextRestored.
   */
  loseContext(): void;
  restoreContext(): void;
  /**
   * The team a target belongs to: a person working has their team, a desk the team whose area it is in, a team
   * area itself. Someone away, leaving or at the door, anything else, and a world that is gone: null.
   */
  teamOf(target: InteractableTarget): Team | null;
  /** Who sits at this desk (an index into the layout's desks), or null. */
  personAt(desk: number): string | null;
  /** The next scene, if it is of this year and takes someone from this person's team, moves this person. Used once. */
  releaseFirst(personId: string | null): void;
  /** Finish at once whatever is moving (walks, an office rising, the lights, the camera's glide), then draw it. */
  settle(): void;
  dispose(): void;
}
