/**
 * Finishing at once whatever is moving: the walks, an office rising, the lights. Pure: the world hands it its own
 * "is anything moving" and "move on by dt", and it runs those in fixed steps until nothing moves, or until the limit
 * of world time is reached whatever still moves (something that never rests, like a looping effect, must not hang
 * the page).
 */

/** At most this much world time is run to settle: far longer than any walk or change the world makes. */
export const SETTLE_LIMIT_SECONDS = 30;

/**
 * Step `update` by `step` seconds while `busy()` says something moves, up to `limit` seconds of world time.
 * Returns the world seconds run (0 when nothing moved).
 */
export const settle = (busy: () => boolean, update: (dt: number) => void, step: number, limit = SETTLE_LIMIT_SECONDS): number => {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  // Whole steps, counted as integers, so the limit is not missed by rounding in a running sum.
  const steps = Math.max(0, Math.ceil(limit / step - 1e-9));
  let run = 0;
  while (run < steps && busy()) {
    update(step);
    run += 1;
  }
  return run * step;
};
