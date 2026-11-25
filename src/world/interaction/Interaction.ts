import * as THREE from "three";
import type { CameraRig } from "../core/CameraRig";
import { clamp } from "../core/math";
import { targetKey } from "../targets";
import type {
  InteractableHit,
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  ScreenPoint,
  ScreenRect,
  WorldCallbacks,
} from "../types";
import { computeLocalBounds, createFootprint, footprintFromBounds } from "./footprint";
import { GestureRecognizer, type PointerKind } from "./gestures";
import { HighlightRing, HOVER_RING, SELECTED_RING } from "./HighlightRing";
import { InteractableStore, type InteractableEntry } from "./picking";

export interface InteractionDeps {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  rig: CameraRig;
  callbacks: WorldCallbacks;
  reducedMotion: boolean;
}

/** Zoom per pixel of wheel travel: one 100 px mouse-wheel notch ≈ 17%. */
const WHEEL_ZOOM_SPEED = 0.0016;
/** Trackpad pinches arrive as ctrl+wheel with tiny deltas and want a livelier response. */
const PINCH_WHEEL_ZOOM_SPEED = 0.012;
/** Caps a single wheel event so a free-spinning wheel cannot slam between the zoom limits. */
const MAX_WHEEL_STEP_PX = 240;
/** Pixels per "line" for browsers that report wheel deltas in lines (Firefox). */
const WHEEL_LINE_PX = 33;
/**
 * Hover is re-picked when the pointer moves, plus this often while it rests on
 * the canvas — enough to notice a person walking out from under the cursor
 * without paying for a raycast every frame.
 */
const HOVER_REFRESH_SECONDS = 0.25;
/** How often a highlighted object's bounds are re-measured (poses change its shape). */
const BOUNDS_REFRESH_SECONDS = 0.5;
/** The selected anchor must move this far (CSS px) before listeners hear about it. */
const ANCHOR_EPSILON_PX = 0.5;

const ANCHOR_UNKNOWN = 0;
const ANCHOR_VISIBLE = 1;
const ANCHOR_GONE = 2;

/** A highlight ring plus the cached measurements of whatever it is currently around. */
interface HighlightSlot {
  readonly ring: HighlightRing;
  readonly bounds: THREE.Box3;
  entry: InteractableEntry | null;
  hasBounds: boolean;
  age: number;
}

/**
 * Safari reports a trackpad pinch through its own gesture events instead of the
 * ctrl+wheel every other browser synthesises. Not in the DOM typings.
 */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Listener names for the above, kept together so add/remove cannot drift apart. */
const SAFARI_GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

const pointerKind = (event: PointerEvent): PointerKind =>
  event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse";

/**
 * Everything between the player's pointer and the world: the registry systems
 * add clickable things to, hover/click picking, drag-pan, wheel and pinch zoom,
 * and the ground-ring highlights.
 *
 * It reports what was hovered and tapped through its callbacks and acts on
 * none of it: what a tap means is for whoever mounted the world to decide.
 *
 * Focus rules: this never calls preventDefault on pointerdown (that would
 * swallow the compatibility mousedown the page around it may listen for) and
 * never focuses the canvas. It does cancel the default action of mousedown,
 * which is what stops the browser taking focus away from a field in one of
 * the page's panels when the player clicks into the world.
 */
export class Interaction implements InteractableRegistry {
  /** Holds the highlight meshes. Owned by this class; not part of any other system. */
  readonly root = new THREE.Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly rig: CameraRig;
  private readonly callbacks: WorldCallbacks;
  private readonly store: InteractableStore;
  private readonly gestures: GestureRecognizer;
  private readonly hover: HighlightSlot;
  private readonly selected: HighlightSlot;
  private readonly footprint = createFootprint();
  private readonly pointer: ScreenPoint = { x: 0, y: 0 };
  private readonly scratchPoint: ScreenPoint = { x: 0, y: 0 };
  private readonly anchorPoint: ScreenPoint = { x: 0, y: 0 };
  private readonly measureBounds = new THREE.Box3();
  private readonly measureCorner = new THREE.Vector3();
  private readonly measureScreen: ScreenPoint = { x: 0, y: 0 };
  private readonly previousTouchAction: string;
  private readonly previousCursor: string;

  private hoverKey: string | null = null;
  private selectedKey: string | null = null;
  private pointerInside = false;
  private hoverDirty = false;
  private sinceHoverPick = 0;
  private cursor = "";
  /** Scale reported by the previous Safari gesture event of the pinch in progress. */
  private gestureScale = 1;
  private anchorState = ANCHOR_UNKNOWN;
  private anchorX = 0;
  private anchorY = 0;
  private disposed = false;

  constructor(deps: InteractionDeps) {
    this.canvas = deps.canvas;
    this.rig = deps.rig;
    this.callbacks = deps.callbacks;
    this.store = new InteractableStore(deps.scene, deps.rig.camera, () => deps.rig.viewport);
    this.gestures = new GestureRecognizer({
      onTap: (point, kind) => this.handleTap(point, kind),
      onPan: (dx, dy) => this.rig.panByPixels(dx, dy),
      onZoom: (factor, at) => this.zoomAt(factor, at),
      onDragStart: () => this.handleDragStart(),
      onDragEnd: () => this.handleDragEnd(),
    });

    this.hover = this.createSlot(new HighlightRing(HOVER_RING, deps.reducedMotion));
    this.selected = this.createSlot(new HighlightRing(SELECTED_RING, deps.reducedMotion));
    this.root.name = "interaction";
    deps.scene.add(this.root);

    const { canvas } = this;
    this.previousTouchAction = canvas.style.touchAction;
    this.previousCursor = canvas.style.cursor;
    // Without this the browser would claim touch drags for page scroll/zoom
    // and cancel our pointers mid-gesture.
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("lostpointercapture", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    for (const type of SAFARI_GESTURE_EVENTS) canvas.addEventListener(type, this.onSafariGesture);
    this.refreshCursor();
  }

  // ── InteractableRegistry ──────────────────────────────────────────────────

  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void {
    this.store.register(object, target, options);
    // Whatever is under a resting pointer may just have changed.
    this.hoverDirty = true;
  }

  unregister(object: THREE.Object3D): void {
    this.store.unregister(object);
    this.hoverDirty = true;
  }

  /** Forget every registered object (run reset). Selection is kept by key and re-attaches on re-register. */
  clearRegistry(): void {
    this.store.clear();
    this.hoverDirty = true;
  }

  // ── Handle API ────────────────────────────────────────────────────────────

  /** Mark a target as selected (null clears). The ring follows it for as long as it exists. */
  setSelected(target: InteractableTarget | null): void {
    this.select(target ? targetKey(target) : null);
  }

  /** Projected anchor of a target in canvas CSS pixels, or null when it is not in the scene. */
  project(target: InteractableTarget): ScreenPoint | null {
    const entry = this.store.get(target);
    return entry ? this.store.projectEntry(entry) : null;
  }

  /**
   * Where a target is drawn on the canvas: the projected corners of the box
   * around its visible meshes, plus its anchor. Writes the box's world-space
   * centre into `centre` when given. Null when the target is not in the scene.
   */
  screenBounds(target: InteractableTarget, centre?: THREE.Vector3, out?: ScreenRect): ScreenRect | null {
    const entry = this.store.get(target);
    if (!entry || !this.store.isLive(entry)) return null;
    const anchor = this.store.projectEntry(entry, this.measureScreen);
    if (!anchor) return null;
    // L6: hot callers (World.focus) pass a scratch rect via `out` so measuring
    // allocates nothing; the handle-level API keeps the allocating default
    // because its callers may retain the returned rect.
    const rect: ScreenRect = out ?? { left: 0, top: 0, right: 0, bottom: 0 };
    rect.left = anchor.x;
    rect.top = anchor.y;
    rect.right = anchor.x;
    rect.bottom = anchor.y;
    const { object } = entry;
    const bounds = this.measureBounds;
    const corner = this.measureCorner;
    if (!computeLocalBounds(object, bounds)) {
      // Nothing visible to measure: the anchor and the ground beneath it.
      this.store.anchorWorld(entry, corner);
      corner.y = 0;
      centre?.copy(corner);
      const ground = this.rig.project(corner, this.measureScreen);
      rect.bottom = Math.max(rect.bottom, ground.y);
      return rect;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < 8; index += 1) {
      corner
        .set(
          index & 1 ? bounds.max.x : bounds.min.x,
          index & 2 ? bounds.max.y : bounds.min.y,
          index & 4 ? bounds.max.z : bounds.min.z
        )
        .applyMatrix4(object.matrixWorld);
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      minZ = Math.min(minZ, corner.z);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
      maxZ = Math.max(maxZ, corner.z);
      const screen = this.rig.project(corner, this.measureScreen);
      rect.left = Math.min(rect.left, screen.x);
      rect.right = Math.max(rect.right, screen.x);
      rect.top = Math.min(rect.top, screen.y);
      rect.bottom = Math.max(rect.bottom, screen.y);
    }
    centre?.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    return rect;
  }

  /** Per frame, after the systems and the camera have moved: hover, highlights, anchor tracking. */
  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    this.updateHover(dt);

    const hovered = this.hoverKey !== null && this.hoverKey !== this.selectedKey ? this.liveEntry(this.hoverKey) : null;
    const selected = this.selectedKey !== null ? this.liveEntry(this.selectedKey) : null;
    this.placeRing(this.hover, hovered, dt);
    this.placeRing(this.selected, selected, dt);
    const unitsPerPixel = this.rig.unitsPerPixel();
    this.hover.ring.update(elapsed, unitsPerPixel);
    this.selected.ring.update(elapsed, unitsPerPixel);

    this.trackSelectedAnchor(selected);
  }

  dispose(): void {
    if (this.disposed) return;
    // Set first: ending an in-flight drag below must not touch the cursor again.
    this.disposed = true;
    this.gestures.cancelAll();
    const { canvas } = this;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    canvas.removeEventListener("lostpointercapture", this.onPointerCancel);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("mousedown", this.onMouseDown);
    canvas.removeEventListener("wheel", this.onWheel);
    for (const type of SAFARI_GESTURE_EVENTS) canvas.removeEventListener(type, this.onSafariGesture);
    canvas.style.touchAction = this.previousTouchAction;
    canvas.style.cursor = this.previousCursor;

    this.store.clear();
    this.hover.ring.dispose();
    this.selected.ring.dispose();
    this.hover.entry = null;
    this.selected.entry = null;
    this.root.removeFromParent();
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Primary button / first contact only; right and middle clicks are not ours.
    if (event.button !== 0) return;
    const point = this.toCanvas(event);
    this.gestures.down(event.pointerId, point.x, point.y);
    if (!this.gestures.isTracking(event.pointerId)) return;
    // Capture so a drag keeps panning (and reliably ends) outside the canvas.
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer vanished between the event and now; pointercancel will follow.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.toCanvas(event);
    if (this.gestures.isTracking(event.pointerId)) {
      this.gestures.move(event.pointerId, point.x, point.y);
      return;
    }
    // Fingers have no hover state; a touch only ever taps or drags.
    if (event.pointerType === "touch") return;
    this.notePointer(point);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.gestures.isTracking(event.pointerId)) return;
    const point = this.toCanvas(event);
    const kind = pointerKind(event);
    if (kind !== "touch") this.notePointer(point);
    this.gestures.up(event.pointerId, point.x, point.y, kind);
    this.refreshCursor();
  };

  /** pointercancel and lostpointercapture: the gesture is over and must not count as a click. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.gestures.isTracking(event.pointerId)) return;
    this.gestures.cancel(event.pointerId);
    this.refreshCursor();
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    this.pointerInside = false;
    this.setHover(null);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    // Keeps keyboard focus wherever it already is (a panel beside the world) and stops a
    // drag from starting a text selection across the page.
    event.preventDefault();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    // The page must not scroll (or browser-zoom, for ctrl+wheel) under the world.
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= WHEEL_LINE_PX;
    else if (event.deltaMode === 2) delta *= this.rig.viewport.height;
    delta = clamp(delta, -MAX_WHEEL_STEP_PX, MAX_WHEEL_STEP_PX);
    if (delta === 0) return;
    const speed = event.ctrlKey ? PINCH_WHEEL_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    this.zoomAt(Math.exp(-delta * speed), this.toCanvas(event));
    this.hoverDirty = true;
  };

  private readonly onSafariGesture = (event: Event): void => {
    // Otherwise Safari zooms the whole page under the pinch.
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    if (event.type !== "gesturechange") {
      this.gestureScale = 1;
      return;
    }
    // On iOS the same pinch also arrives as two touch pointers, which the
    // recognizer is already turning into zoom; acting on both would double it.
    if (this.gestures.pressed || !(gesture.scale > 0)) return;
    this.zoomAt(gesture.scale / this.gestureScale, this.toCanvas(gesture));
    this.gestureScale = gesture.scale;
    this.hoverDirty = true;
  };

  /** The player zoomed (wheel, pinch): move the camera and say by how much it really moved. */
  private zoomAt(factor: number, at: ScreenPoint): void {
    const before = this.rig.zoom;
    this.rig.zoomAt(factor, at);
    const after = this.rig.zoom;
    if (after !== before && before > 0) this.callbacks.onZoom?.(after / before);
  }

  // ── Gestures ──────────────────────────────────────────────────────────────

  private handleTap(point: ScreenPoint, kind: PointerKind): void {
    const entry = this.store.pick(point);
    this.select(entry ? entry.key : null);
    this.callbacks.onSelect(entry ? this.hitFor(entry) : null);
    if (kind !== "touch") this.hoverDirty = true;
  }

  private handleDragStart(): void {
    // Tooltips should not ride along while the world is being dragged.
    this.setHover(null);
    this.refreshCursor();
  }

  private handleDragEnd(): void {
    this.hoverDirty = true;
    this.refreshCursor();
  }

  // ── Hover ─────────────────────────────────────────────────────────────────

  private notePointer(point: ScreenPoint): void {
    const { width, height } = this.rig.viewport;
    this.pointer.x = point.x;
    this.pointer.y = point.y;
    this.pointerInside = point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
    this.hoverDirty = true;
  }

  private updateHover(dt: number): void {
    this.sinceHoverPick += dt;
    if (this.gestures.pressed) return;
    if (!this.pointerInside) {
      this.hoverDirty = false;
      return;
    }
    if (!this.hoverDirty && this.sinceHoverPick < HOVER_REFRESH_SECONDS) return;
    this.hoverDirty = false;
    this.sinceHoverPick = 0;
    this.setHover(this.store.pick(this.pointer));
  }

  private setHover(entry: InteractableEntry | null): void {
    const key = entry ? entry.key : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.refreshCursor();
    this.callbacks.onHover(entry ? this.hitFor(entry) : null);
  }

  private refreshCursor(): void {
    if (this.disposed) return;
    const cursor = this.gestures.dragging ? "grabbing" : this.hoverKey !== null ? "pointer" : "grab";
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    this.canvas.style.cursor = cursor;
  }

  // ── Selection + highlights ────────────────────────────────────────────────

  private select(key: string | null): void {
    if (key === this.selectedKey) return;
    this.selectedKey = key;
    // A new target must report its anchor even if it happens to project to the
    // same pixel as the previous one. Clearing keeps the state so the listener
    // is told (once) that the old anchor is gone.
    if (key !== null) this.anchorState = ANCHOR_UNKNOWN;
  }

  /** Looked up by key every frame, so an object rebuilt under the same target carries on seamlessly. */
  private liveEntry(key: string): InteractableEntry | null {
    const entry = this.store.getByKey(key);
    return entry && this.store.isLive(entry) ? entry : null;
  }

  private createSlot(ring: HighlightRing): HighlightSlot {
    this.root.add(ring.root);
    return { ring, bounds: new THREE.Box3(), entry: null, hasBounds: false, age: 0 };
  }

  private placeRing(slot: HighlightSlot, entry: InteractableEntry | null, dt: number): void {
    if (!entry || entry.noHighlight) {
      slot.entry = null;
      slot.ring.hide();
      return;
    }
    slot.age += dt;
    if (slot.entry !== entry || slot.age >= BOUNDS_REFRESH_SECONDS) {
      slot.entry = entry;
      slot.age = 0;
      slot.hasBounds = computeLocalBounds(entry.object, slot.bounds);
    }
    slot.ring.place(footprintFromBounds(entry.object, slot.hasBounds ? slot.bounds : null, this.footprint));
  }

  private trackSelectedAnchor(selected: InteractableEntry | null): void {
    const notify = this.callbacks.onSelectedAnchorMove;
    if (!notify) return;
    const screen = selected ? this.store.projectEntry(selected, this.anchorPoint) : null;
    if (!screen) {
      // Deselected, unregistered, hidden or removed: say so once.
      if (this.anchorState === ANCHOR_VISIBLE || (this.anchorState === ANCHOR_UNKNOWN && this.selectedKey !== null)) {
        this.anchorState = ANCHOR_GONE;
        notify(null);
      }
      return;
    }
    if (
      this.anchorState === ANCHOR_VISIBLE &&
      Math.abs(screen.x - this.anchorX) < ANCHOR_EPSILON_PX &&
      Math.abs(screen.y - this.anchorY) < ANCHOR_EPSILON_PX
    ) {
      return;
    }
    this.anchorState = ANCHOR_VISIBLE;
    this.anchorX = screen.x;
    this.anchorY = screen.y;
    notify({ x: screen.x, y: screen.y });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private hitFor(entry: InteractableEntry): InteractableHit {
    return {
      target: entry.target,
      label: entry.label,
      screen: this.store.projectEntry(entry) ?? { x: 0, y: 0 },
    };
  }

  /**
   * Event position in the rig's viewport pixels. The rig's size is whatever the
   * shell last reported through resize(); scaling by the live CSS box keeps
   * picking correct even if a layout change has not been reported yet.
   */
  private toCanvas(event: { readonly clientX: number; readonly clientY: number }): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    const { width, height } = this.rig.viewport;
    const point = this.scratchPoint;
    point.x = rect.width > 0 ? ((event.clientX - rect.left) * width) / rect.width : 0;
    point.y = rect.height > 0 ? ((event.clientY - rect.top) * height) / rect.height : 0;
    return point;
  }
}
