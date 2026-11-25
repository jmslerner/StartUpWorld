/**
 * Effects. Implements FxApi for the other systems (bursts, streams, float text, thought bubbles, camera shake) and,
 * as a WorldSystem, reacts to three things only:
 *
 *   1. people arrive: one "+N" floats up at the door;
 *   2. people leave: one "−N" floats up at the door;
 *   3. the company changes office: dust puffs across the floor while the new building comes up, and the camera
 *      gets the kick it always got at that moment.
 *
 * Under reduced motion the new office raises no dust and the camera does not shake, and the numbers at the door
 * stand still and are gone in under a second (REDUCED_TEXT_SECONDS): nothing the effects do moves after a second.
 *
 * Where N comes from (see `doorCounts`): while everyone is drawn, from the cast's own lists, so the number is the
 * number of figures that appear and disappear. Somebody expected at the door counts when they appear there and not
 * again when they are hired; a hire that is called off counts as leaving the door. Once more people work here than
 * are drawn, the lists only know the 50 on screen (and give new ids to people who were in the building all along),
 * so N comes from the two scenes' head counts instead.
 *
 * The first frame, another run and an earlier year show the office as it is, without a word.
 */
import * as THREE from "three";
import { clamp } from "../core/math";
import { REBUILD_RISE_DELAY, REBUILD_RISE_SECONDS } from "../office/timing";
import { TEAMS } from "../types";
import type {
  BubbleIcon,
  BurstKind,
  FloatTone,
  FxApi,
  OfficeLayout,
  OfficeScene,
  QualityLevel,
  Vec3Like,
  WorldFrame,
  WorldSystem,
} from "../types";
import { BubbleLayer, DEFAULT_BUBBLE_HEIGHT, DEFAULT_BUBBLE_SECONDS } from "./BubbleLayer";
import { FloatTextLayer } from "./FloatTextLayer";
import { formatSignedCount } from "./format";
import { ParticleRenderer } from "./ParticleRenderer";
import { BURST_KINDS, KIND_PROFILES, ParticlePool } from "./particles";

export interface FxDeps {
  scene: THREE.Scene;
  quality: QualityLevel;
  reducedMotion: boolean;
  /** The layout of the frame being applied (same as WorldContext.getLayout). */
  getLayout(): OfficeLayout;
  /** World units covered by one CSS pixel at the current zoom; keeps sprites readable. */
  unitsPerPixel(): number;
  /** Forwarded to the camera rig. */
  shakeCamera(strength: number): void;
  /** Injectable for deterministic tests. */
  random?: () => number;
  /** Optional: a bubble popped up; `at` is where (world space; only valid during the call). */
  onBubble?(at: THREE.Vector3): void;
}

export interface ParticleBudget {
  /** Most particles alive at once; beyond it the oldest are dropped. */
  capacity: number;
  /** Multiplier on how many particles a burst or stream emits. */
  density: number;
}

/** About 600 particles on high, about half on low, far fewer under reduced motion. */
export const particleBudget = (quality: QualityLevel, reducedMotion: boolean): ParticleBudget => {
  if (reducedMotion) return { capacity: 90, density: 0.3 };
  return quality === "high" ? { capacity: 600, density: 1 } : { capacity: 250, density: 0.5 };
};

/** A count of people as the cast reads it: whole, and nobody for a negative or a number that is not one. */
const whole = (count: number): number => (Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);

/** Everyone of the company in a scene: at work, away, and let go but not gone yet. People expected at the door are not. */
const headCount = (scene: OfficeScene): number =>
  TEAMS.reduce((sum, team) => sum + whole(scene.teams[team]), 0) + whole(scene.away) + whole(scene.leaving);

/**
 * How many people arrived and how many left between two frames, as the door says it.
 *
 * - No frame before, another run or an earlier year: nobody. The office is simply shown as it is.
 * - Neither cast hides anyone: the cast's lists, as they are. They hold everyone who appears or disappears, at a
 *   desk or at the door.
 * - Either cast hides people: the scenes' head counts. Those who left are the people the previous scene had as
 *   leaving, once the year has moved on (within a year nobody goes). Those who arrived are whatever the new head
 *   count has beyond the people who stayed. Neither goes below nothing.
 */
export const doorCounts = (next: WorldFrame, prev: WorldFrame | null): { arrived: number; left: number } => {
  if (prev === null || next.scene.runId !== prev.scene.runId || next.scene.year < prev.scene.year) return { arrived: 0, left: 0 };
  if (next.cast.hidden <= 0 && prev.cast.hidden <= 0) return { arrived: next.cast.arrived.length, left: next.cast.left.length };
  const left = next.scene.year > prev.scene.year ? whole(prev.scene.leaving) : 0;
  const stayed = headCount(prev.scene) - left;
  return { arrived: Math.max(0, headCount(next.scene) - stayed), left };
};

/** Heights (world units above the floor) effects are placed at. */
const DOOR_TEXT_Y = 1.7;
const DUST_Y = 0.15;

/** The puffs of dust a new office raises, and how hard each one is. */
const RISE_DUST_PUFFS = 6;
const RISE_DUST_INTENSITY = 1.4;
/** The camera's kick as the office changes. */
const RISE_SHAKE = 0.4;
/**
 * How long a shake counts as playing. The camera rig lets a shake die away within 0.77 s at full strength; a test
 * holds this against the real rig.
 */
export const SHAKE_SECONDS = 0.8;

/** Under reduced motion a float text stands still and shows this long: gone within a second of its frame. */
export const REDUCED_TEXT_SECONDS = 0.9;

/** The longest a bubble may be asked to show. */
const MAX_BUBBLE_SECONDS = 60;

const DEFAULT_STREAM_COUNT = 8;
const MAX_STREAM_COUNT = 40;
const MAX_INTENSITY = 4;

/** What a stream particle turns into when it lands: a glint, or a puff for the grubby kinds. */
const ARRIVAL_POP: Record<BurstKind, BurstKind> = {
  confetti: "sparkle",
  sparkle: "sparkle",
  smoke: "dust",
  money: "sparkle",
  hearts: "sparkle",
  bugs: "dust",
  users: "sparkle",
  dust: "dust",
};

interface ScheduledBurst {
  delay: number;
  kind: BurstKind;
  x: number;
  y: number;
  z: number;
  intensity: number;
}

export class FxSystem implements WorldSystem, FxApi {
  /** Holds every particle mesh and sprite. Owned by this class. */
  readonly root = new THREE.Group();
  /** Exposed for tests and debug overlays; treat as read-only. */
  readonly particles: ParticlePool;

  private readonly deps: FxDeps;
  private readonly density: number;
  private readonly renderer: ParticleRenderer;
  private readonly floats: FloatTextLayer;
  private readonly bubbles: BubbleLayer;
  /** Scratch for the position handed to deps.onBubble. */
  private readonly bubbleAt = new THREE.Vector3();
  private readonly scheduled: ScheduledBurst[] = [];
  private readonly spareSchedule: ScheduledBurst[] = [];
  private readonly pointA: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Seconds a camera shake asked for here still has to play. */
  private shakeLeft = 0;

  constructor(deps: FxDeps) {
    this.deps = deps;
    const budget = particleBudget(deps.quality, deps.reducedMotion);
    this.density = budget.density;
    this.particles = new ParticlePool(budget.capacity, deps.random);
    this.renderer = new ParticleRenderer(this.particles);
    this.floats = new FloatTextLayer({
      reducedMotion: deps.reducedMotion,
      unitsPerPixel: deps.unitsPerPixel,
      ...(deps.reducedMotion ? { lifeSeconds: REDUCED_TEXT_SECONDS, still: true } : {}),
    });
    this.bubbles = new BubbleLayer({
      scene: deps.scene,
      reducedMotion: deps.reducedMotion,
      unitsPerPixel: deps.unitsPerPixel,
    });
    this.root.name = "fx";
    this.root.add(this.renderer.root, this.bubbles.root, this.floats.root);
    deps.scene.add(this.root);
  }

  // ── FxApi ─────────────────────────────────────────────────────────────────

  burst(kind: BurstKind, at: Vec3Like, intensity = 1): void {
    const strength = clamp(intensity, 0, MAX_INTENSITY);
    if (strength <= 0) return;
    const count = Math.max(1, Math.round(KIND_PROFILES[kind].count * strength * this.density));
    // Bigger bursts also fly a little further, so they read as bigger rather than just denser.
    this.particles.spawnBurst(kind, at, count, clamp(0.85 + 0.15 * strength, 0.8, 1.4));
  }

  stream(kind: BurstKind, from: Vec3Like, to: Vec3Like, count = DEFAULT_STREAM_COUNT): void {
    const scaled = Math.round(clamp(count, 0, MAX_STREAM_COUNT) * this.density);
    if (count > 0) this.particles.spawnStream(kind, from, to, Math.max(1, scaled));
  }

  floatText(text: string, at: Vec3Like, tone: FloatTone = "neutral"): void {
    this.floats.spawn(text, at, tone);
  }

  bubble(
    anchor: THREE.Object3D,
    icon: BubbleIcon,
    seconds = DEFAULT_BUBBLE_SECONDS,
    heightOffset = DEFAULT_BUBBLE_HEIGHT
  ): void {
    // A length that is not a number, or one without end, would keep the bubble (and so the loop) alive for good.
    const lasting = Number.isFinite(seconds) ? Math.min(seconds, MAX_BUBBLE_SECONDS) : DEFAULT_BUBBLE_SECONDS;
    if (!this.bubbles.show(anchor, icon, lasting, heightOffset) || !this.deps.onBubble) return;
    this.deps.onBubble(anchor.getWorldPosition(this.bubbleAt));
  }

  shake(strength: number): void {
    if (this.deps.reducedMotion || !(strength > 0)) return;
    this.deps.shakeCamera(strength);
    this.shakeLeft = SHAKE_SECONDS;
  }

  // ── WorldSystem ───────────────────────────────────────────────────────────

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    let reset = false;
    let moved = false;
    for (const event of next.events) {
      if (event.kind === "run-reset") reset = true;
      else if (event.kind === "office-changed") moved = true;
    }
    if (reset) this.reset();
    // The first frame, another run, an earlier year (or a loaded game): the office appears as it is, without fanfare.
    if (prev === null || reset) return;

    const layout = this.deps.getLayout();
    const { arrived, left } = doorCounts(next, prev);
    if (arrived > 0) this.floatText(formatSignedCount(arrived), this.door(layout), "good");
    if (left > 0) this.floatText(formatSignedCount(-left), this.door(layout), "bad");
    // Under reduced motion the new office comes up without dust or a kick of the camera.
    if (moved && !this.deps.reducedMotion) {
      this.raiseDust(layout);
      this.shake(RISE_SHAKE);
    }
  }

  update(dt: number, elapsed: number): void {
    // A frame whose length is not a positive, finite number passes no time. Added to an age it would stay there
    // (nothing is ever older than "not a number"), and the effects would report themselves busy for good.
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.shakeLeft > 0) this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    this.fireScheduled(dt);
    const pool = this.particles;
    pool.step(dt);
    if (pool.arrivalCount > 0) this.popArrivals();
    this.renderer.sync();
    this.floats.update(dt);
    this.bubbles.update(dt, elapsed);
  }

  /** True while a particle, a burst still waiting to fire, a float text, a bubble or a shake is alive. */
  busy(): boolean {
    return (
      this.particles.activeCount > 0 ||
      this.scheduled.length > 0 ||
      this.floats.activeCount > 0 ||
      this.bubbles.activeCount > 0 ||
      this.shakeLeft > 0
    );
  }

  /** Remove every particle, label and bubble at once (run reset). */
  reset(): void {
    this.particles.clear();
    this.renderer.sync();
    this.floats.clear();
    this.bubbles.clear();
    this.shakeLeft = 0;
    while (this.scheduled.length > 0) this.spareSchedule.push(this.scheduled.pop() as ScheduledBurst);
  }

  dispose(): void {
    this.reset();
    this.root.removeFromParent();
    this.renderer.dispose();
    this.floats.dispose();
    this.bubbles.dispose();
  }

  // ── Reactions ─────────────────────────────────────────────────────────────

  /**
   * Dust across the floor while the new building comes up: the first puff as the rise starts, the last as it
   * lands (see office/timing.ts).
   */
  private raiseDust(layout: OfficeLayout): void {
    const { minX, maxX, minZ, maxZ } = layout.floor;
    const random = this.deps.random ?? Math.random;
    for (let i = 0; i < RISE_DUST_PUFFS; i += 1) {
      const x = minX + (maxX - minX) * (0.1 + 0.8 * random());
      const z = minZ + (maxZ - minZ) * (0.1 + 0.8 * random());
      const delay = REBUILD_RISE_DELAY + (i / (RISE_DUST_PUFFS - 1)) * REBUILD_RISE_SECONDS;
      this.schedule(delay, "dust", x, DUST_Y, z, RISE_DUST_INTENSITY);
    }
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /** Above the doorway, where the numbers of people float. */
  private door(layout: OfficeLayout): Vec3Like {
    const point = this.pointA;
    point.x = layout.door.x;
    point.y = DOOR_TEXT_Y;
    point.z = layout.door.z;
    return point;
  }

  private schedule(delay: number, kind: BurstKind, x: number, y: number, z: number, intensity: number): void {
    const entry = this.spareSchedule.pop() ?? { delay: 0, kind, x: 0, y: 0, z: 0, intensity: 1 };
    entry.delay = delay;
    entry.kind = kind;
    entry.x = x;
    entry.y = y;
    entry.z = z;
    entry.intensity = intensity;
    this.scheduled.push(entry);
  }

  private fireScheduled(dt: number): void {
    for (let i = this.scheduled.length - 1; i >= 0; i -= 1) {
      const entry = this.scheduled[i];
      entry.delay -= dt;
      if (entry.delay > 0) continue;
      this.burst(entry.kind, entry, entry.intensity);
      this.scheduled.splice(i, 1);
      this.spareSchedule.push(entry);
    }
  }

  private popArrivals(): void {
    const pool = this.particles;
    const { arrivals } = pool;
    // step() only resets the arrival list at its start, so spawning here is safe.
    for (let i = 0; i < pool.arrivalCount; i += 1) {
      const point = this.pointA;
      point.x = arrivals[i * 4];
      point.y = arrivals[i * 4 + 1];
      point.z = arrivals[i * 4 + 2];
      const kind = BURST_KINDS[arrivals[i * 4 + 3]];
      pool.spawnBurst(ARRIVAL_POP[kind], point, this.density >= 1 ? 2 : 1, 0.6);
    }
  }
}
