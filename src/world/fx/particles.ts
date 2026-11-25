import type { BurstKind, Vec3Like } from "../types";
import { clamp, easeOutBack, lerp, smoothstep } from "../core/math";

/**
 * Particle simulation, with no three.js in sight: plain typed arrays stepped by
 * plain arithmetic. ParticleRenderer turns the result into instanced meshes;
 * unit tests drive this file directly.
 */

/** Meshes particles can be drawn with. Each shape is one InstancedMesh. */
export type ParticleShape = "chip" | "gem" | "puff" | "heart" | "peg";
export const PARTICLE_SHAPES: readonly ParticleShape[] = ["chip", "gem", "puff", "heart", "peg"];

/** Index into this array is the numeric kind id stored per particle. */
export const BURST_KINDS: readonly BurstKind[] = [
  "confetti",
  "sparkle",
  "smoke",
  "money",
  "hearts",
  "bugs",
  "users",
  "dust",
];

/**
 * tumble  – spins about a random axis (confetti, bills, puffs)
 * upright – stays vertical, spins about Y (sparkles, people-pegs)
 * facing  – stays vertical and turned toward the camera, rocking gently (hearts)
 * heading – stays vertical and points where it is going (bugs)
 */
export type ParticleOrientation = "tumble" | "upright" | "facing" | "heading";

/**
 * ignore – passes through the floor (things that rise, or die before landing)
 * settle – stops where it lands and fades out
 * bounce – hops with a little less energy each time
 * scurry – lands, then runs along the floor on a wiggling heading
 */
export type FloorBehaviour = "ignore" | "settle" | "bounce" | "scurry";

type Range = readonly [min: number, max: number];

export interface KindProfile {
  shape: ParticleShape;
  /** sRGB hex colours; each particle picks one at random. */
  colors: readonly number[];
  /** Particles in a burst of intensity 1 at full density. */
  count: number;
  /** Seconds alive. */
  life: Range;
  /** Launch speed in units/s. */
  speed: Range;
  /** Launch angle away from straight up, in radians (0 = up, π/2 = along the floor). */
  cone: Range;
  /** Vertical acceleration in units/s²: negative falls, positive floats. */
  gravity: number;
  /** Exponential velocity decay rate (1/s); gravity / drag is the terminal speed. */
  drag: number;
  /** Size in world units of the particle's largest dimension. */
  size: Range;
  /** Per-axis proportions applied on top of `size`. */
  proportions: readonly [number, number, number];
  /** Size multiplier reached by the end of life (smoke billows; most stay at 1). */
  growth: number;
  /** Spin speed in rad/s; the sign is randomised. */
  spin: Range;
  orientation: ParticleOrientation;
  /** Sideways flutter: peak speed in units/s, and how fast it alternates (rad/s). */
  sway: number;
  swayRate: number;
  /** 0..1 depth of a rapid size shimmer. */
  twinkle: number;
  /** Particles start within this radius of the burst point... */
  spawnRadius: number;
  /** ...and this far above it. */
  spawnLift: Range;
  floor: FloorBehaviour;
  /** Seconds spent popping in and shrinking away. */
  fadeIn: number;
  fadeOut: number;
}

export const KIND_PROFILES: Record<BurstKind, KindProfile> = {
  // A fountain of paper: thrown up about 1.2 units, then flutters down at ~1.3 units/s.
  confetti: {
    shape: "chip",
    colors: [0x7dd3fc, 0xf59e0b, 0xf472b6, 0x4ade80, 0xa78bfa, 0xfacc15, 0xf8fafc],
    count: 40,
    life: [1.5, 2.3],
    speed: [3, 6.4],
    cone: [0, 0.95],
    gravity: -3.2,
    drag: 2.4,
    size: [0.13, 0.21],
    proportions: [1, 0.1, 0.62],
    growth: 1,
    spin: [5, 14],
    orientation: "tumble",
    sway: 0.9,
    swayRate: 6,
    twinkle: 0,
    spawnRadius: 0.15,
    spawnLift: [0, 0.2],
    floor: "settle",
    fadeIn: 0.08,
    fadeOut: 0.35,
  },
  sparkle: {
    shape: "gem",
    // Saturated enough to read against off-white walls as well as dark floors.
    colors: [0x7dd3fc, 0x38bdf8, 0xfde047, 0xfbbf24, 0xffffff],
    count: 22,
    life: [0.7, 1.3],
    speed: [0.8, 2.4],
    cone: [0, 1.2],
    gravity: 0.9,
    drag: 2.2,
    size: [0.15, 0.3],
    proportions: [0.62, 1, 0.62],
    growth: 1,
    spin: [2, 6],
    orientation: "upright",
    sway: 0,
    swayRate: 0,
    twinkle: 0.5,
    spawnRadius: 0.4,
    spawnLift: [0, 0.5],
    floor: "ignore",
    fadeIn: 0.12,
    fadeOut: 0.4,
  },
  smoke: {
    shape: "puff",
    colors: [0x6b7280, 0x9ca3af, 0x4b5563, 0xd1d5db],
    count: 14,
    life: [1.0, 1.7],
    speed: [0.7, 1.7],
    cone: [0, 0.7],
    gravity: 0.5,
    drag: 1.2,
    size: [0.24, 0.42],
    proportions: [1, 0.9, 1],
    growth: 2.1,
    spin: [0.4, 1.4],
    orientation: "tumble",
    sway: 0.3,
    swayRate: 2,
    twinkle: 0,
    spawnRadius: 0.35,
    spawnLift: [0, 0.25],
    floor: "ignore",
    fadeIn: 0.18,
    fadeOut: 0.6,
  },
  // Bills appear overhead and flutter down through the burst point.
  money: {
    shape: "chip",
    colors: [0x4ade80, 0x22c55e, 0x86efac, 0xfbbf24],
    count: 22,
    life: [1.9, 2.6],
    speed: [0.2, 0.9],
    cone: [0, Math.PI],
    gravity: -3,
    drag: 2.6,
    size: [0.24, 0.3],
    proportions: [1, 0.05, 0.5],
    growth: 1,
    spin: [2, 6],
    orientation: "tumble",
    sway: 1.4,
    swayRate: 5,
    twinkle: 0,
    spawnRadius: 1,
    spawnLift: [1.1, 2.1],
    floor: "settle",
    fadeIn: 0.12,
    fadeOut: 0.3,
  },
  hearts: {
    shape: "heart",
    colors: [0xfb7185, 0xf472b6, 0xfda4af, 0xf43f5e],
    count: 9,
    life: [1.2, 1.8],
    speed: [0.5, 1.1],
    cone: [0, 0.45],
    gravity: 0.35,
    drag: 0.9,
    size: [0.24, 0.36],
    proportions: [1, 1, 1],
    growth: 1.15,
    spin: [0, 0],
    orientation: "facing",
    sway: 0.5,
    swayRate: 3,
    twinkle: 0,
    spawnRadius: 0.3,
    spawnLift: [0, 0.3],
    floor: "ignore",
    fadeIn: 0.2,
    fadeOut: 0.45,
  },
  // Hop off whatever broke, then scatter across the floor.
  bugs: {
    shape: "chip",
    colors: [0xdc2626, 0xb91c1c, 0xef4444, 0x7f1d1d],
    count: 12,
    life: [1.2, 1.9],
    speed: [1.5, 2.9],
    cone: [1.25, 1.5],
    gravity: -14,
    drag: 0.5,
    size: [0.14, 0.2],
    proportions: [0.62, 0.42, 1],
    growth: 1,
    spin: [0, 0],
    orientation: "heading",
    sway: 0,
    swayRate: 9,
    twinkle: 0,
    spawnRadius: 0.12,
    spawnLift: [0, 0.1],
    floor: "scurry",
    fadeIn: 0.06,
    fadeOut: 0.3,
  },
  users: {
    shape: "peg",
    colors: [0x7dd3fc, 0x38bdf8, 0xbae6fd, 0x22d3ee],
    count: 10,
    life: [1.0, 1.5],
    speed: [1.8, 3.2],
    cone: [0.15, 0.9],
    gravity: -9,
    drag: 0.4,
    size: [0.26, 0.34],
    proportions: [1, 1, 1],
    growth: 1,
    spin: [0, 0],
    orientation: "upright",
    sway: 0,
    swayRate: 0,
    twinkle: 0,
    spawnRadius: 0.15,
    spawnLift: [0, 0.1],
    floor: "bounce",
    fadeIn: 0.12,
    fadeOut: 0.3,
  },
  // A quick, low ring of dust — someone just sat down or something just landed.
  dust: {
    shape: "puff",
    colors: [0xb8a888, 0xa89878, 0xcdbf9f],
    count: 10,
    life: [0.4, 0.7],
    speed: [0.7, 1.5],
    cone: [1.1, 1.5],
    gravity: 0.3,
    drag: 3.5,
    size: [0.15, 0.24],
    proportions: [1, 0.8, 1],
    growth: 1.9,
    spin: [0.5, 2],
    orientation: "tumble",
    sway: 0,
    swayRate: 0,
    twinkle: 0,
    spawnRadius: 0.12,
    spawnLift: [0.02, 0.1],
    floor: "ignore",
    fadeIn: 0.1,
    fadeOut: 0.4,
  },
};

/** Slot states. */
export const SLOT_FREE = 0;
export const SLOT_BALLISTIC = 1;
export const SLOT_STREAM = 2;

/** Seconds a stream particle takes to fly its arc. */
export const STREAM_SECONDS = 0.9;
/** A whole stream leaves over at most this long, however many particles it has. */
const STREAM_STAGGER_SECONDS = 0.7;
const STREAM_STAGGER_STEP = 0.07;

const TWO_PI = Math.PI * 2;
const BOUNCE_RESTITUTION = 0.45;
const BOUNCE_FRICTION = 0.7;
/** Below this rebound speed a bouncing particle just stays down. */
const BOUNCE_REST_SPEED = 0.7;
const SCURRY_TURN_RATE = 5;
const TWINKLE_RATE = 19;

const hexToLinear = (hex: number, out: Float32Array, offset: number): void => {
  // sRGB → linear, matching what three.js does for hex colours, so instance
  // colours land in the renderer's working colour space.
  for (let channel = 0; channel < 3; channel += 1) {
    const c = ((hex >> (16 - channel * 8)) & 0xff) / 255;
    out[offset + channel] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
};

interface CompiledProfile extends KindProfile {
  /** Linear RGB triples, flattened. */
  linearColors: Float32Array;
}

const compileProfiles = (): CompiledProfile[] =>
  BURST_KINDS.map((kind) => {
    const profile = KIND_PROFILES[kind];
    const linearColors = new Float32Array(profile.colors.length * 3);
    profile.colors.forEach((hex, i) => hexToLinear(hex, linearColors, i * 3));
    return { ...profile, linearColors };
  });

/** Shape name → index into PARTICLE_SHAPES, resolved once at module load (the renderer used to redo this lookup per live particle per frame). */
export const PARTICLE_SHAPE_INDEX: ReadonlyMap<ParticleShape, number> = new Map(
  PARTICLE_SHAPES.map((shape, index) => [shape, index] as const)
);

/**
 * A fixed-capacity ring of particles. Spawning never allocates: when the ring
 * is full the next spawn simply overwrites the oldest particle, so a huge burst
 * degrades by losing its tail rather than by stalling the frame.
 */
export class ParticlePool {
  readonly capacity: number;

  readonly state: Uint8Array;
  readonly kind: Uint8Array;
  /** PARTICLE_SHAPES index per slot, fixed at spawn (mirrors `kind`); the renderer reads it instead of searching by shape name every frame. */
  readonly shapeIndex: Uint8Array;
  readonly grounded: Uint8Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Negative while a staggered particle waits for its turn. */
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  /** Tumble angle, or yaw for the upright orientations. */
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  /** Tumble axis (unit vector). */
  readonly ax: Float32Array;
  readonly ay: Float32Array;
  readonly az: Float32Array;
  readonly phase: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Stream particles: where the arc starts and ends, how high it rises, and its sideways bow. */
  readonly ox: Float32Array;
  readonly oy: Float32Array;
  readonly oz: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly tz: Float32Array;
  readonly arc: Float32Array;
  readonly bowX: Float32Array;
  readonly bowZ: Float32Array;

  /**
   * Stream particles that reached their destination during the last step():
   * [x, y, z, kindId] per arrival. The owner reads it right after stepping
   * (typically to spawn a little pop) — it is overwritten by the next step.
   */
  readonly arrivals: Float32Array;
  arrivalCount = 0;

  /** Height of the floor that settle/bounce/scurry particles land on. */
  floorY = 0;

  private readonly random: () => number;
  private readonly profiles: CompiledProfile[];
  private readonly dragFactors: Float32Array;
  private head = 0;

  constructor(capacity: number, random: () => number = Math.random) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.random = random;
    this.profiles = compileProfiles();
    this.dragFactors = new Float32Array(BURST_KINDS.length);

    const n = this.capacity;
    const floats = (): Float32Array => new Float32Array(n);
    this.state = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.shapeIndex = new Uint8Array(n);
    this.grounded = new Uint8Array(n);
    this.px = floats();
    this.py = floats();
    this.pz = floats();
    this.vx = floats();
    this.vy = floats();
    this.vz = floats();
    this.age = floats();
    this.life = floats();
    this.size = floats();
    this.rot = floats();
    this.spin = floats();
    this.ax = floats();
    this.ay = floats();
    this.az = floats();
    this.phase = floats();
    this.r = floats();
    this.g = floats();
    this.b = floats();
    this.ox = floats();
    this.oy = floats();
    this.oz = floats();
    this.tx = floats();
    this.ty = floats();
    this.tz = floats();
    this.arc = floats();
    this.bowX = floats();
    this.bowZ = floats();
    this.arrivals = new Float32Array(n * 4);
  }

  /** Particles currently in flight or waiting to start. O(capacity); meant for tests and debug overlays. */
  get activeCount(): number {
    let count = 0;
    for (let i = 0; i < this.capacity; i += 1) if (this.state[i] !== SLOT_FREE) count += 1;
    return count;
  }

  profileOf(index: number): KindProfile {
    return this.profiles[this.kind[index]];
  }

  /** PARTICLE_SHAPES index for a slot, fixed when the particle was spawned. */
  shapeIndexOf(index: number): number {
    return this.shapeIndex[index];
  }

  clear(): void {
    this.state.fill(SLOT_FREE);
    this.arrivalCount = 0;
    this.head = 0;
  }

  /** Launch `count` particles of a kind outward from a point. `energy` scales their launch speed. */
  spawnBurst(kind: BurstKind, at: Vec3Like, count: number, energy = 1): void {
    const kindId = BURST_KINDS.indexOf(kind);
    const profile = this.profiles[kindId];
    const random = this.random;
    for (let n = 0; n < count; n += 1) {
      const i = this.allocate(kindId, profile);
      this.state[i] = SLOT_BALLISTIC;
      this.age[i] = 0;

      const spawnAngle = random() * TWO_PI;
      const spawnDistance = Math.sqrt(random()) * profile.spawnRadius;
      this.px[i] = at.x + Math.cos(spawnAngle) * spawnDistance;
      this.py[i] = at.y + lerp(profile.spawnLift[0], profile.spawnLift[1], random());
      this.pz[i] = at.z + Math.sin(spawnAngle) * spawnDistance;

      const tilt = lerp(profile.cone[0], profile.cone[1], random());
      const heading = random() * TWO_PI;
      const speed = lerp(profile.speed[0], profile.speed[1], random()) * energy;
      const horizontal = Math.sin(tilt) * speed;
      this.vx[i] = Math.cos(heading) * horizontal;
      this.vy[i] = Math.cos(tilt) * speed;
      this.vz[i] = Math.sin(heading) * horizontal;
    }
  }

  /**
   * Send `count` particles along an arc from one point to another, leaving one
   * after another. Each reports an arrival when it lands.
   */
  spawnStream(kind: BurstKind, from: Vec3Like, to: Vec3Like, count: number): void {
    if (count <= 0) return;
    const kindId = BURST_KINDS.indexOf(kind);
    const profile = this.profiles[kindId];
    const random = this.random;

    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, to.y - from.y, dz);
    const flat = Math.hypot(dx, dz);
    // Unit vector across the direction of travel, for fanning the arcs out sideways.
    const sideX = flat > 1e-4 ? -dz / flat : 1;
    const sideZ = flat > 1e-4 ? dx / flat : 0;
    const stagger = Math.min(STREAM_STAGGER_STEP, STREAM_STAGGER_SECONDS / count);
    const arcHeight = clamp(0.6 + distance * 0.22, 0.6, 2.6);
    const yaw = Math.atan2(dx, dz);

    for (let n = 0; n < count; n += 1) {
      const i = this.allocate(kindId, profile);
      this.state[i] = SLOT_STREAM;
      // Small jitter keeps a long stream from looking like a conveyor belt.
      this.age[i] = -(n * stagger + random() * stagger * 0.5);
      this.life[i] = STREAM_SECONDS * lerp(0.9, 1.1, random());
      this.ox[i] = from.x + (random() - 0.5) * 0.3;
      this.oy[i] = from.y + (random() - 0.5) * 0.2;
      this.oz[i] = from.z + (random() - 0.5) * 0.3;
      this.tx[i] = to.x + (random() - 0.5) * 0.25;
      this.ty[i] = to.y + (random() - 0.5) * 0.2;
      this.tz[i] = to.z + (random() - 0.5) * 0.25;
      this.arc[i] = arcHeight * lerp(0.8, 1.2, random());
      const bow = (random() - 0.5) * Math.min(1.2, distance * 0.3);
      this.bowX[i] = sideX * bow;
      this.bowZ[i] = sideZ * bow;
      this.px[i] = this.ox[i];
      this.py[i] = this.oy[i];
      this.pz[i] = this.oz[i];
      this.vx[i] = dx;
      this.vy[i] = 0;
      this.vz[i] = dz;
      if (profile.orientation !== "tumble") this.rot[i] = yaw;
    }
  }

  /** Advance every particle by `dt` seconds. */
  step(dt: number): void {
    this.arrivalCount = 0;
    if (dt <= 0) return;
    const { profiles, dragFactors, state, age, life } = this;
    for (let k = 0; k < profiles.length; k += 1) dragFactors[k] = Math.exp(-profiles[k].drag * dt);

    for (let i = 0; i < this.capacity; i += 1) {
      const mode = state[i];
      if (mode === SLOT_FREE) continue;
      age[i] += dt;
      if (age[i] < 0) continue;
      if (age[i] >= life[i]) {
        if (mode === SLOT_STREAM) this.recordArrival(i);
        state[i] = SLOT_FREE;
        continue;
      }
      if (mode === SLOT_STREAM) this.stepStream(i, dt);
      else this.stepBallistic(i, dt);
    }
  }

  /**
   * Current size multiplier of a particle (0 while it waits to start): the
   * pop-in, the shrink-away that stands in for fading, growth and twinkle.
   */
  scaleOf(index: number): number {
    const age = this.age[index];
    if (age < 0) return 0;
    const profile = this.profiles[this.kind[index]];
    const life = this.life[index];
    const remaining = life - age;
    // Streams land with a pop of their own, so they keep their size to the end.
    const fadeOut = this.state[index] === SLOT_STREAM ? Math.min(profile.fadeOut, 0.12) : profile.fadeOut;
    let scale = this.size[index];
    if (age < profile.fadeIn) scale *= easeOutBack(age / profile.fadeIn);
    if (remaining < fadeOut) scale *= smoothstep(remaining / fadeOut);
    if (profile.growth !== 1) scale *= lerp(1, profile.growth, age / life);
    if (profile.twinkle > 0) {
      scale *= 1 - profile.twinkle * 0.5 * (1 + Math.sin(age * TWINKLE_RATE + this.phase[index]));
    }
    return scale;
  }

  /** Claim the next slot in the ring (evicting its occupant) and fill in what every particle needs. */
  private allocate(kindId: number, profile: CompiledProfile): number {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const random = this.random;

    this.kind[i] = kindId;
    this.shapeIndex[i] = PARTICLE_SHAPE_INDEX.get(profile.shape) ?? 0;
    this.grounded[i] = 0;
    this.life[i] = lerp(profile.life[0], profile.life[1], random());
    this.size[i] = lerp(profile.size[0], profile.size[1], random());
    this.phase[i] = random() * TWO_PI;
    this.rot[i] = random() * TWO_PI;
    this.spin[i] = lerp(profile.spin[0], profile.spin[1], random()) * (random() < 0.5 ? -1 : 1);

    // Uniform random unit vector for the tumble axis.
    const axisY = random() * 2 - 1;
    const axisAngle = random() * TWO_PI;
    const axisFlat = Math.sqrt(1 - axisY * axisY);
    this.ax[i] = Math.cos(axisAngle) * axisFlat;
    this.ay[i] = axisY;
    this.az[i] = Math.sin(axisAngle) * axisFlat;

    const color = Math.min(profile.colors.length - 1, Math.floor(random() * profile.colors.length)) * 3;
    this.r[i] = profile.linearColors[color];
    this.g[i] = profile.linearColors[color + 1];
    this.b[i] = profile.linearColors[color + 2];
    return i;
  }

  private stepBallistic(i: number, dt: number): void {
    const profile = this.profiles[this.kind[i]];
    const age = this.age[i];

    if (this.grounded[i] === 1) {
      if (profile.floor !== "scurry") return;
      // Wiggle the heading so the bugs zig-zag instead of running dead straight.
      const turn = Math.sin(age * profile.swayRate + this.phase[i]) * SCURRY_TURN_RATE * dt;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const vx = this.vx[i];
      const vz = this.vz[i];
      this.vx[i] = vx * cos - vz * sin;
      this.vz[i] = vx * sin + vz * cos;
      this.px[i] += this.vx[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      return;
    }

    const drag = this.dragFactors[this.kind[i]];
    this.vx[i] *= drag;
    this.vy[i] = this.vy[i] * drag + profile.gravity * dt;
    this.vz[i] *= drag;

    let swayX = 0;
    let swayZ = 0;
    if (profile.sway > 0) {
      // Flutter across the tumble axis so each scrap of paper slips its own way.
      const flutter = Math.sin(age * profile.swayRate + this.phase[i]) * profile.sway;
      swayX = this.az[i] * flutter;
      swayZ = -this.ax[i] * flutter;
    }
    this.px[i] += (this.vx[i] + swayX) * dt;
    this.py[i] += this.vy[i] * dt;
    this.pz[i] += (this.vz[i] + swayZ) * dt;
    this.rot[i] += this.spin[i] * dt;

    if (profile.floor === "ignore") return;
    const restY = this.floorY + this.size[i] * profile.proportions[1] * 0.5;
    if (this.py[i] > restY || this.vy[i] >= 0) return;
    this.py[i] = restY;

    switch (profile.floor) {
      case "settle":
        this.grounded[i] = 1;
        // Lie still for a moment, then shrink away from wherever it landed.
        this.life[i] = Math.min(this.life[i], age + profile.fadeOut + 0.15);
        break;
      case "bounce": {
        const rebound = -this.vy[i] * BOUNCE_RESTITUTION;
        this.vx[i] *= BOUNCE_FRICTION;
        this.vz[i] *= BOUNCE_FRICTION;
        if (rebound < BOUNCE_REST_SPEED) {
          this.grounded[i] = 1;
          this.vy[i] = 0;
        } else {
          this.vy[i] = rebound;
        }
        break;
      }
      case "scurry":
        this.grounded[i] = 1;
        this.vy[i] = 0;
        break;
    }
  }

  private stepStream(i: number, dt: number): void {
    const t = smoothstep(this.age[i] / this.life[i]);
    const hump = 4 * t * (1 - t);
    const bow = Math.sin(Math.PI * t);
    this.px[i] = lerp(this.ox[i], this.tx[i], t) + this.bowX[i] * bow;
    this.py[i] = lerp(this.oy[i], this.ty[i], t) + this.arc[i] * hump;
    this.pz[i] = lerp(this.oz[i], this.tz[i], t) + this.bowZ[i] * bow;
    if (this.profiles[this.kind[i]].orientation === "tumble") this.rot[i] += this.spin[i] * dt;
  }

  private recordArrival(i: number): void {
    const offset = this.arrivalCount * 4;
    this.arrivals[offset] = this.tx[i];
    this.arrivals[offset + 1] = this.ty[i];
    this.arrivals[offset + 2] = this.tz[i];
    this.arrivals[offset + 3] = this.kind[i];
    this.arrivalCount += 1;
  }
}
