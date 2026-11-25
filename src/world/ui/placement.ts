/**
 * Where a card goes relative to the thing it describes.
 *
 * Pure geometry in CSS pixels, in the coordinate space of the world viewport
 * (origin top-left) — the same space WorldHandle.project() reports in.
 */
import type { ScreenPoint, ScreenRect } from "../types";

export interface Size {
  width: number;
  height: number;
}

export type CardSide = "above" | "below" | "left" | "right";

export interface CardPlacement {
  /** Top-left corner of the card. */
  left: number;
  top: number;
  /** Which side of the anchor the card sits on. */
  side: CardSide;
  /**
   * Where the pointer notch attaches, relative to the card's top-left corner:
   * a point on the edge that faces the anchor. null when the anchor is too far
   * away for a notch to mean anything (the target is off-screen).
   */
  notch: ScreenPoint | null;
}

export interface PlacementOptions {
  /** Minimum distance between the card and the viewport edge. */
  margin?: number;
  /** Distance between the anchor and the card edge facing it (room for the notch). */
  gap?: number;
  /** Keeps the notch clear of the card's rounded corners. */
  cornerInset?: number;
  /**
   * Where the object itself is drawn (WorldHandle.screenBounds). The card is
   * kept off it: it opens beyond the object's edges rather than the anchor's,
   * and when nothing fits cleanly the position covering the least of it wins.
   */
  avoid?: ScreenRect | null;
  /**
   * The side the card is on now. Kept for as long as it still fits cleanly, so
   * a card beside a walking person (or a slowly panning view) does not flip
   * from side to side.
   */
  prefer?: CardSide | null;
  /**
   * The card's top edge stays at or below this (e.g. under a row of buttons, so a card
   * never covers them), as long as the card is short enough to fit under it.
   * Defaults to `margin`.
   */
  minTop?: number;
}

/** Extra room kept around the object's drawn box: idle animations wobble it by a few pixels. */
const AVOID_PADDING = 4;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

const overlapArea = (left: number, top: number, card: Size, rect: ScreenRect): number => {
  const width = Math.min(left + card.width, rect.right) - Math.max(left, rect.left);
  const height = Math.min(top + card.height, rect.bottom) - Math.max(top, rect.top);
  return width > 0 && height > 0 ? width * height : 0;
};

/** Distance from a point to a rectangle (0 inside it). */
const distanceToRect = (x: number, y: number, rect: ScreenRect): number =>
  Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));

/**
 * Preference order:
 *   1. above the object (the anchor sits on top of it, so this never covers it);
 *   2. beside it — tall cards rarely fit above, and a card beside the object still
 *      leaves it visible. When both sides have room it opens AWAY from the middle of
 *      the viewport: the office is centred there, the empty backdrop is at the edges;
 *   3. below it;
 *   4. whatever is left: the position (clamped inside the viewport) that covers the
 *      least of the object — above, when nothing is known about the object's size.
 * In every case the card is finally clamped inside the viewport.
 */
export const placeCard = (
  anchor: ScreenPoint,
  card: Size,
  viewport: Size,
  { margin = 8, gap = 14, cornerInset = 16, avoid = null, prefer = null, minTop: wantedMinTop = margin }: PlacementOptions = {}
): CardPlacement => {
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;
  // A card too tall to fit under the requested top line may still use the margin above it.
  const minTop = Math.max(margin, Math.min(wantedMinTop, maxTop));
  // The region the card stays off: the object's drawn box, which always contains its anchor.
  const object: ScreenRect = avoid
    ? {
        left: Math.min(avoid.left - AVOID_PADDING, anchor.x),
        top: Math.min(avoid.top - AVOID_PADDING, anchor.y),
        right: Math.max(avoid.right + AVOID_PADDING, anchor.x),
        bottom: Math.max(avoid.bottom + AVOID_PADDING, anchor.y),
      }
    : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };

  const fitsAbove = object.top - gap - card.height >= minTop;
  const fitsBelow = object.bottom + gap + card.height <= viewport.height - margin;
  const fitsRight = object.right + gap + card.width <= viewport.width - margin;
  const fitsLeft = object.left - gap - card.width >= margin;

  const position = (side: CardSide): { left: number; top: number } => {
    let left: number;
    let top: number;
    if (side === "above" || side === "below") {
      left = anchor.x - card.width / 2;
      top = side === "above" ? object.top - gap - card.height : object.bottom + gap;
    } else {
      left = side === "right" ? object.right + gap : object.left - gap - card.width;
      // Slightly above centre: the object hangs below its anchor.
      top = anchor.y - card.height * 0.4;
    }
    return { left: clamp(left, margin, maxLeft), top: clamp(top, minTop, maxTop) };
  };

  const fits: Record<CardSide, boolean> = { above: fitsAbove, below: fitsBelow, left: fitsLeft, right: fitsRight };

  let side: CardSide;
  if (prefer && fits[prefer]) side = prefer;
  else if (fitsAbove) side = "above";
  else if (fitsLeft || fitsRight) {
    // Both fit: open outward, over the backdrop rather than over the office.
    side = fitsLeft && fitsRight ? (anchor.x < viewport.width / 2 ? "left" : "right") : fitsRight ? "right" : "left";
  } else if (fitsBelow) side = "below";
  else {
    // Nothing fits cleanly: cover as little of the object as possible.
    const outward: CardSide = anchor.x < viewport.width / 2 ? "left" : "right";
    const inward: CardSide = outward === "left" ? "right" : "left";
    side = "above";
    let least = Infinity;
    for (const candidate of ["above", outward, inward, "below"] as const) {
      const at = position(candidate);
      const covered = overlapArea(at.left, at.top, card, object);
      if (covered < least) {
        least = covered;
        side = candidate;
      }
    }
  }
  const { left, top } = position(side);

  // The notch slides along the facing edge to stay pointed at the anchor.
  const vertical = side === "above" || side === "below";
  const along = vertical
    ? clamp(anchor.x - left, cornerInset, card.width - cornerInset)
    : clamp(anchor.y - top, cornerInset, card.height - cornerInset);
  const notchPoint: ScreenPoint = vertical
    ? { x: along, y: side === "above" ? card.height : 0 }
    : { x: side === "right" ? 0 : card.width, y: along };

  // If clamping dragged the card away from the object, a notch would point at nothing.
  const reach = distanceToRect(left + notchPoint.x, top + notchPoint.y, object);
  return { left, top, side, notch: reach <= gap * 2.5 ? notchPoint : null };
};

/** Top-left corner for a small label chip centred above a point, kept inside the viewport. */
export const placeChip = (anchor: ScreenPoint, chip: Size, viewport: Size, margin = 4, gap = 10): ScreenPoint => ({
  x: clamp(anchor.x - chip.width / 2, margin, viewport.width - chip.width - margin),
  y: clamp(anchor.y - gap - chip.height, margin, viewport.height - chip.height - margin),
});
