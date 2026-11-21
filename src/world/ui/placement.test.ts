import { describe, expect, it } from "vitest";
import { placeCard, placeChip, type Size } from "./placement";

const viewport: Size = { width: 900, height: 420 };
const small: Size = { width: 260, height: 150 };
const tall: Size = { width: 340, height: 360 };

const inside = (left: number, top: number, card: Size, margin = 8): boolean =>
  left >= margin &&
  top >= margin &&
  left + card.width <= viewport.width - margin &&
  top + card.height <= viewport.height - margin;

describe("placeCard", () => {
  it("sits centred above the anchor when there is room, notch pointing down at it", () => {
    const placement = placeCard({ x: 450, y: 300 }, small, viewport);
    expect(placement.side).toBe("above");
    expect(placement.left).toBe(450 - 130);
    expect(placement.top).toBe(300 - 14 - 150);
    expect(placement.notch).toEqual({ x: 130, y: 150 });
  });

  it("slides sideways at the viewport edge and keeps the notch on the anchor", () => {
    const placement = placeCard({ x: 40, y: 300 }, small, viewport);
    expect(placement.side).toBe("above");
    expect(placement.left).toBe(8);
    expect(placement.notch).toEqual({ x: 32, y: 150 });
  });

  it("opens away from the middle when both sides have room, leaving the office in view", () => {
    const wide: Size = { width: 1150, height: 400 };
    const rightOfCentre = placeCard({ x: 640, y: 220 }, tall, wide);
    expect(rightOfCentre.side).toBe("right");
    expect(rightOfCentre.left).toBe(654);
    const leftOfCentre = placeCard({ x: 510, y: 220 }, tall, wide);
    expect(leftOfCentre.side).toBe("left");
    expect(leftOfCentre.left + tall.width).toBe(496);
  });

  it("goes beside the anchor when it cannot fit above, on whichever side has room", () => {
    const leftHalf = placeCard({ x: 200, y: 120 }, tall, viewport);
    expect(leftHalf.side).toBe("right");
    expect(leftHalf.left).toBe(214);
    expect(leftHalf.notch?.x).toBe(0);

    const rightHalf = placeCard({ x: 700, y: 120 }, tall, viewport);
    expect(rightHalf.side).toBe("left");
    expect(rightHalf.left + tall.width).toBe(700 - 14);
    expect(rightHalf.notch?.x).toBe(tall.width);
  });

  it("drops below only when neither above nor beside works", () => {
    const narrow: Size = { width: 400, height: 420 };
    const placement = placeCard({ x: 200, y: 60 }, { width: 380, height: 200 }, narrow);
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(74);
  });

  it("always ends up inside the viewport, wherever the anchor is", () => {
    for (const card of [small, tall]) {
      for (let x = -200; x <= 1100; x += 65) {
        for (let y = -150; y <= 600; y += 45) {
          const placement = placeCard({ x, y }, card, viewport);
          expect(inside(placement.left, placement.top, card), `${card.height} @ ${x},${y}`).toBe(true);
          if (placement.notch) {
            expect(placement.notch.x).toBeGreaterThanOrEqual(0);
            expect(placement.notch.x).toBeLessThanOrEqual(card.width);
            expect(placement.notch.y).toBeGreaterThanOrEqual(0);
            expect(placement.notch.y).toBeLessThanOrEqual(card.height);
          }
        }
      }
    }
  });

  it("drops the notch when the target is far off-screen", () => {
    expect(placeCard({ x: 450, y: -400 }, small, viewport).notch).toBeNull();
    expect(placeCard({ x: 2000, y: 200 }, small, viewport).notch).toBeNull();
  });

  it("pins a card that is larger than the viewport to the top-left margin", () => {
    const placement = placeCard({ x: 100, y: 100 }, { width: 1000, height: 500 }, viewport);
    expect(placement.left).toBe(8);
    expect(placement.top).toBe(8);
  });
});

describe("placeChip", () => {
  it("centres the chip above the point and keeps it in view", () => {
    const chip: Size = { width: 80, height: 22 };
    expect(placeChip({ x: 450, y: 200 }, chip, viewport)).toEqual({ x: 410, y: 168 });
    expect(placeChip({ x: 10, y: 5 }, chip, viewport)).toEqual({ x: 4, y: 4 });
    expect(placeChip({ x: 895, y: 500 }, chip, viewport)).toEqual({ x: 816, y: 394 });
  });
});

describe("placeCard with the object's drawn box", () => {
  const wide: Size = { width: 1150, height: 394 };
  const card: Size = { width: 280, height: 300 };
  const overlaps = (left: number, top: number, size: Size, rect: { left: number; top: number; right: number; bottom: number }): boolean =>
    left < rect.right && left + size.width > rect.left && top < rect.bottom && top + size.height > rect.top;

  it("opens beyond the object's edge, not just beyond its anchor", () => {
    // A wide object (a jet) whose anchor is in its middle.
    const avoid = { left: 520, top: 160, right: 760, bottom: 260 };
    const placement = placeCard({ x: 640, y: 160 }, card, wide, { avoid });
    expect(placement.side).toBe("right");
    // Beyond the object's right edge, plus a little room for idle wobble, plus the notch gap.
    expect(placement.left).toBeGreaterThanOrEqual(760 + 14);
    expect(placement.left).toBeLessThanOrEqual(760 + 14 + 6);
    expect(overlaps(placement.left, placement.top, card, avoid)).toBe(false);
    expect(placement.notch).not.toBeNull();
  });

  it("never covers the object anywhere in a wide, short viewport", () => {
    for (let x = 60; x <= 1090; x += 37) {
      for (let y = 40; y <= 340; y += 29) {
        const avoid = { left: x - 30, top: y, right: x + 30, bottom: Math.min(y + 50, 390) };
        const placement = placeCard({ x, y }, card, wide, { avoid });
        expect(overlaps(placement.left, placement.top, card, avoid), `${x},${y}`).toBe(false);
      }
    }
  });

  it("covers as little as possible when nothing fits cleanly", () => {
    const cramped: Size = { width: 420, height: 320 };
    const avoid = { left: 150, top: 100, right: 270, bottom: 200 };
    const placement = placeCard({ x: 210, y: 100 }, { width: 260, height: 240 }, cramped, { avoid });
    const size = { width: 260, height: 240 };
    const area = (left: number, top: number): number =>
      Math.max(0, Math.min(left + size.width, avoid.right) - Math.max(left, avoid.left)) *
      Math.max(0, Math.min(top + size.height, avoid.bottom) - Math.max(top, avoid.top));
    // Squeezed straight above (the old fallback) would cover more of it.
    const squeezedAbove = area(Math.min(Math.max(210 - 130, 8), 420 - 260 - 8), 8);
    expect(area(placement.left, placement.top)).toBeLessThan(squeezedAbove);
  });

  it("keeps its current side while that still fits, instead of flipping across the middle", () => {
    const avoid = { left: 560, top: 150, right: 600, bottom: 200 };
    const fresh = placeCard({ x: 580, y: 150 }, card, wide, { avoid });
    // Just right of centre: a fresh card opens outward, to the right.
    expect(fresh.side).toBe("right");
    // A person walking left past the middle keeps their card on the same side.
    const moved = { left: 540, top: 150, right: 580, bottom: 200 };
    expect(placeCard({ x: 560, y: 150 }, card, wide, { avoid: moved }).side).toBe("left");
    expect(placeCard({ x: 560, y: 150 }, card, wide, { avoid: moved, prefer: "right" }).side).toBe("right");
    // ...until it no longer fits there.
    const edge = { left: 900, top: 150, right: 940, bottom: 200 };
    expect(placeCard({ x: 920, y: 150 }, card, wide, { avoid: edge, prefer: "right" }).side).toBe("left");
  });

  it("stays under a requested top line (the HUD row) whenever the card fits below it", () => {
    // An object near the top: clamped to the margin, the card would cover the HUD row.
    const avoid = { left: 700, top: 30, right: 760, bottom: 90 };
    const placed = placeCard({ x: 730, y: 30 }, small, viewport, { avoid, minTop: 44 });
    expect(placed.top).toBeGreaterThanOrEqual(44);
    expect(placed.top + small.height).toBeLessThanOrEqual(viewport.height - 8);
    // A card taller than the room under the line still fits the viewport, using the margin.
    const giant: Size = { width: 300, height: 400 };
    const squeezed = placeCard({ x: 730, y: 30 }, giant, viewport, { avoid, minTop: 44 });
    expect(squeezed.top).toBe(viewport.height - 8 - giant.height);
    // Without the option nothing changes.
    expect(placeCard({ x: 730, y: 30 }, small, viewport, { avoid }).top).toBe(8);
  });
});
