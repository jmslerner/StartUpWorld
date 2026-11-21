import type { ScreenPoint } from "../types";

/** A press that travels less than this many CSS pixels is a click/tap, not a drag. */
export const CLICK_THRESHOLD_PX = 6;

export type PointerKind = "mouse" | "touch" | "pen";

export interface GestureSink {
  /** A press was released without ever leaving the click threshold. */
  onTap(point: ScreenPoint, kind: PointerKind): void;
  /** Pointer travel in CSS pixels since the previous pan (one finger, or the centroid of two). */
  onPan(dx: number, dy: number): void;
  /** Two-finger spread changed by `factor` (> 1 = fingers moving apart) around `at`. */
  onZoom(factor: number, at: ScreenPoint): void;
  /** The press turned into a drag or pinch. */
  onDragStart(): void;
  /** The drag or pinch ended (all pointers lifted or cancelled). */
  onDragEnd(): void;
}

interface TrackedPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/**
 * Turns raw pointer down/move/up samples into taps, pans and pinches.
 *
 * It knows nothing about the DOM or the camera, which keeps the fiddly parts —
 * the click threshold, a second finger arriving mid-drag, one finger of a pinch
 * lifting — unit-testable with plain numbers.
 */
export class GestureRecognizer {
  private readonly sink: GestureSink;
  private readonly threshold: number;
  private readonly pointers = new Map<number, TrackedPointer>();
  private readonly point: ScreenPoint = { x: 0, y: 0 };
  /** Set once the press can no longer end as a tap. */
  private dragged = false;
  private pinchDistance = 0;
  private pinchX = 0;
  private pinchY = 0;

  constructor(sink: GestureSink, threshold: number = CLICK_THRESHOLD_PX) {
    this.sink = sink;
    this.threshold = threshold;
  }

  /** At least one pointer is down. */
  get pressed(): boolean {
    return this.pointers.size > 0;
  }

  /** A drag or pinch is in progress (the press has left the click threshold). */
  get dragging(): boolean {
    return this.dragged && this.pointers.size > 0;
  }

  isTracking(id: number): boolean {
    return this.pointers.has(id);
  }

  down(id: number, x: number, y: number): void {
    // A third finger adds nothing we can interpret; a repeated id is a stale
    // pointer whose release we never saw, so it simply restarts.
    if (this.pointers.size >= 2 && !this.pointers.has(id)) return;
    this.pointers.set(id, { x, y, startX: x, startY: y });
    if (this.pointers.size === 1) {
      this.dragged = false;
      return;
    }
    // Second finger: whatever this was, it is now a pinch and can never be a tap.
    if (!this.dragged) {
      this.dragged = true;
      this.sink.onDragStart();
    }
    this.measurePinch();
  }

  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;

    if (this.pointers.size === 1) {
      if (!this.dragged) {
        if (Math.hypot(x - pointer.startX, y - pointer.startY) < this.threshold) return;
        // Start panning from here rather than from the press point, so the
        // view does not lurch by the threshold distance when the drag begins.
        this.dragged = true;
        pointer.x = x;
        pointer.y = y;
        this.sink.onDragStart();
        return;
      }
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      pointer.x = x;
      pointer.y = y;
      if (dx !== 0 || dy !== 0) this.sink.onPan(dx, dy);
      return;
    }

    pointer.x = x;
    pointer.y = y;
    const previousDistance = this.pinchDistance;
    const previousX = this.pinchX;
    const previousY = this.pinchY;
    this.measurePinch();
    const dx = this.pinchX - previousX;
    const dy = this.pinchY - previousY;
    if (dx !== 0 || dy !== 0) this.sink.onPan(dx, dy);
    // Fingers that are (nearly) touching give a meaningless ratio; skip those samples.
    if (previousDistance > 1 && this.pinchDistance > 1 && previousDistance !== this.pinchDistance) {
      this.point.x = this.pinchX;
      this.point.y = this.pinchY;
      this.sink.onZoom(this.pinchDistance / previousDistance, this.point);
    }
  }

  up(id: number, x: number, y: number, kind: PointerKind): void {
    if (!this.pointers.delete(id)) return;
    if (this.pointers.size > 0) {
      this.rebaseRemaining();
      return;
    }
    if (this.dragged) {
      this.dragged = false;
      this.sink.onDragEnd();
      return;
    }
    this.point.x = x;
    this.point.y = y;
    this.sink.onTap(this.point, kind);
  }

  /** The browser took the pointer away (system gesture, capture lost): never a tap. */
  cancel(id: number): void {
    if (!this.pointers.delete(id)) return;
    if (this.pointers.size > 0) {
      this.rebaseRemaining();
      return;
    }
    if (this.dragged) {
      this.dragged = false;
      this.sink.onDragEnd();
    }
  }

  cancelAll(): void {
    if (this.pointers.size === 0) return;
    this.pointers.clear();
    if (this.dragged) {
      this.dragged = false;
      this.sink.onDragEnd();
    }
  }

  /**
   * One finger of a pinch lifted: carry on as a one-finger pan from where the
   * remaining finger is now, without a jump.
   */
  private rebaseRemaining(): void {
    for (const pointer of this.pointers.values()) {
      pointer.startX = pointer.x;
      pointer.startY = pointer.y;
    }
    if (this.pointers.size >= 2) this.measurePinch();
  }

  private measurePinch(): void {
    let first: TrackedPointer | null = null;
    let second: TrackedPointer | null = null;
    for (const pointer of this.pointers.values()) {
      if (!first) first = pointer;
      else if (!second) second = pointer;
    }
    if (!first || !second) return;
    this.pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
    this.pinchX = (first.x + second.x) / 2;
    this.pinchY = (first.y + second.y) / 2;
  }
}
