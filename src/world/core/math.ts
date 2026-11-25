/**
 * Small scalar helpers shared by the camera, lighting and FX code.
 * Everything here is pure and allocation-free so it is safe inside frame loops.
 */

export const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export const saturate = (value: number): number => clamp(value, 0, 1);

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Hermite ease: 0 at t ≤ 0, 1 at t ≥ 1, zero slope at both ends. */
export const smoothstep = (t: number): number => {
  const x = saturate(t);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (t: number): number => {
  const x = 1 - saturate(t);
  return 1 - x * x * x;
};

export const easeInOutCubic = (t: number): number => {
  const x = saturate(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Overshoots to ≈ 1.1 before settling at 1 — the "pop" used for bubbles and float text. */
export const easeOutBack = (t: number): number => {
  const x = saturate(t) - 1;
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
};

/**
 * Frame-rate independent exponential approach. `lambda` is the decay rate in
 * 1/seconds: after 1/lambda seconds roughly 63% of the gap has closed.
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
