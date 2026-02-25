export interface RngDraw<T> {
  rng: number;
  value: T;
}

const UINT32_MAX_PLUS_ONE = 2 ** 32;

export const normalizeUint32 = (n: number): number => (n >>> 0);

export const nextUint32 = (rng: number): RngDraw<number> => {
  // xorshift32
  let x = normalizeUint32(rng);
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return { rng: normalizeUint32(x), value: normalizeUint32(x) };
};

export const nextFloat01 = (rng: number): RngDraw<number> => {
  const d = nextUint32(rng);
  return { rng: d.rng, value: d.value / UINT32_MAX_PLUS_ONE };
};

export const nextIntInclusive = (rng: number, min: number, max: number): RngDraw<number> => {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo + 1;
  const d = nextUint32(rng);
  return { rng: d.rng, value: lo + (d.value % span) };
};

export const chance = (rng: number, p: number): RngDraw<boolean> => {
  const clipped = Math.max(0, Math.min(1, p));
  const d = nextFloat01(rng);
  return { rng: d.rng, value: d.value < clipped };
};

export const signedUnit = (rng: number): RngDraw<number> => {
  // Returns a value in [-1, 1], with a slightly “peaked” distribution
  // by averaging 3 uniforms.
  let r = rng;
  const a = nextFloat01(r);
  r = a.rng;
  const b = nextFloat01(r);
  r = b.rng;
  const c = nextFloat01(r);
  r = c.rng;

  const u = (a.value + b.value + c.value) / 3;
  return { rng: r, value: (u - 0.5) * 2 };
};

export const pickWeightedIndex = (rng: number, weights: number[]): RngDraw<number | null> => {
  const positive = weights.map((w) => (Number.isFinite(w) ? Math.max(0, w) : 0));
  const total = positive.reduce((acc, w) => acc + w, 0);
  if (total <= 0) {
    return { rng, value: null };
  }
  const d = nextFloat01(rng);
  const target = d.value * total;
  let running = 0;
  for (let i = 0; i < positive.length; i++) {
    running += positive[i];
    if (target <= running) {
      return { rng: d.rng, value: i };
    }
  }
  return { rng: d.rng, value: positive.length - 1 };
};
