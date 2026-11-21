/**
 * Tiny deterministic hashing helpers for the world layer.
 *
 * The world must look identical every time the same run is loaded, so anything
 * "random" about a person (name, skin tone, hair) is derived from the run seed
 * with these instead of Math.random(). They are intentionally separate from the
 * engine RNG: reading the world never advances (or depends on) gameplay rolls.
 */

/** murmur3's 32-bit finaliser: every input bit affects every output bit. */
export const mix32 = (value: number): number => {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/**
 * Well-mixed uint32 for a (seed, text) pair.
 *
 * FNV-1a alone leaves the low bits of short, similar strings ("engineering-3" /
 * "engineering-4") correlated, which shows up as neighbours sharing a hair colour.
 * Finalising with mix32 removes that.
 */
export const hashText32 = (seed: number, text: string): number => {
  let h = mix32((seed ^ 0x9e3779b9) >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
};
