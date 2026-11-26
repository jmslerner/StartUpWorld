import { describe, expect, it, vi } from "vitest";
import { settle, SETTLE_LIMIT_SECONDS } from "./settle";

describe("settle: finish at once whatever is moving", () => {
  it("runs nothing when nothing moves", () => {
    const update = vi.fn();
    expect(settle(() => false, update, 0.1)).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("steps until nothing moves, a step at a time", () => {
    let left = 5;
    const update = vi.fn<(dt: number) => void>(() => {
      left -= 1;
    });
    expect(settle(() => left > 0, update, 0.1)).toBeCloseTo(0.5);
    expect(update).toHaveBeenCalledTimes(5);
    expect(update.mock.calls.every(([dt]) => dt === 0.1)).toBe(true);
  });

  it("stops at the limit whatever still moves", () => {
    expect(settle(() => true, () => undefined, 0.1, 2)).toBeCloseTo(2);
  });

  it("the default limit is half a minute of world time", () => {
    expect(SETTLE_LIMIT_SECONDS).toBe(30);
    const update = vi.fn();
    expect(settle(() => true, update, 0.1)).toBeCloseTo(30);
    expect(update).toHaveBeenCalledTimes(300);
  });
});
