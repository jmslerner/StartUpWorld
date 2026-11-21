/**
 * A tiny seeded random source for the people's ambient behaviour.
 *
 * Who wanders next, who nods off and how long a coffee break lasts are all drawn
 * from here rather than Math.random(), so a room of people is reproducible in
 * tests and the same person behaves in character from one session to the next.
 * It never touches the engine's RNG: watching the world cannot change a run.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). (mulberry32) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [0, count). Returns 0 when `count` is not positive. */
  index(count: number): number {
    return count > 0 ? Math.min(count - 1, Math.floor(this.next() * count)) : 0;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
