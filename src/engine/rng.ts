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

// ── Streams ──
//
// The turn-based engine keeps no rng state. Every roll draws from a stream keyed by
// (seed, turn, purpose, company), so a game replays exactly from its seed and plans, and one
// company's choices never shift another company's rolls.

/**
 * murmur3's 32-bit finalizer: every input bit reaches every output bit. xorshift32's first output
 * barely depends on the low bits of its seed, so keys are mixed with this before use.
 */
export const fmix32 = (x: number): number => {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** What a stream is for. Append only: changing an id would change every recorded game. */
export const STREAM = {
  eventRoll: 1,
  eventCard: 2,
  eventTarget: 3,
  hiringOrder: 4,
  poachOrder: 5,
  poach: 6,
  board: 7,
  cpuNoise: 8,
  names: 9,
} as const;

/**
 * The starting state of the stream for one decision. Turn fits 16 bits, purpose and company 8 each,
 * so two different keys of the same game can never collide. xorshift32 is stuck at 0, hence `|| 1`.
 */
export const streamSeed = (seed: number, turn: number, purpose: number, company = 0): number => {
  const key = (((turn & 0xffff) << 16) | ((purpose & 0xff) << 8) | (company & 0xff)) >>> 0;
  return fmix32((fmix32(seed) ^ Math.imul(key + 1, 0x9e3779b1)) >>> 0) || 1;
};

/** The first draw of a stream, in [0, 1): enough for any single roll. */
export const firstFloat = (seed: number, turn: number, purpose: number, company = 0): number =>
  nextFloat01(streamSeed(seed, turn, purpose, company)).value;
