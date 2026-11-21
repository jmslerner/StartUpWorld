import * as THREE from "three";
import { clamp } from "../core/math";
import type {
  BubbleIcon,
  BurstKind,
  FloatTone,
  FxApi,
  OfficeLayout,
  QualityLevel,
  SeatingApi,
  StationKind,
  Vec2,
  Vec3Like,
  WorldEvent,
  WorldSnapshot,
  WorldSystem,
} from "../types";
import { isPromotion, isWinEnding } from "../outcomes";
import { BubbleLayer, DEFAULT_BUBBLE_HEIGHT, DEFAULT_BUBBLE_SECONDS } from "./BubbleLayer";
import { FloatTextLayer } from "./FloatTextLayer";
import { formatCountDelta, formatHeadcountDelta, formatMoneyDelta } from "./format";
import { ParticleRenderer } from "./ParticleRenderer";
import { BURST_KINDS, KIND_PROFILES, ParticlePool } from "./particles";

export interface FxDeps {
  scene: THREE.Scene;
  quality: QualityLevel;
  reducedMotion: boolean;
  seating: SeatingApi;
  /** The layout of the snapshot being applied (same as WorldContext.getLayout). */
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

/** Spec §5: ≈ 600 particles on high, about half on low, far fewer under reduced motion. */
export const particleBudget = (quality: QualityLevel, reducedMotion: boolean): ParticleBudget => {
  if (reducedMotion) return { capacity: 90, density: 0.3 };
  return quality === "high" ? { capacity: 600, density: 1 } : { capacity: 250, density: 0.5 };
};

/**
 * Burst size for "how much just happened": grows with the order of magnitude
 * of `amount` relative to `unit`, so a $50M round is clearly bigger than a
 * $50K one without being a thousand times bigger.
 */
export const magnitudeIntensity = (amount: number, unit: number, min: number, max: number): number =>
  clamp(min + 0.35 * Math.log10(1 + Math.abs(amount) / unit), min, max);

/** Heights (world units above the floor) FX are placed at. */
const STATION_BURST_Y = 1.35;
const STATION_TEXT_Y = 1.95;
const HEAD_BURST_Y = 1.7;
const HEAD_TEXT_Y = 2.05;
const DOOR_TEXT_Y = 1.7;
const DOOR_FLOOR_Y = 0.3;
const SERVER_INTAKE_Y = 1;
const ASSET_BURST_Y = 1.2;

/** Cash movements smaller than this are noise, not news. */
const CASH_FLOAT_MIN = 500;
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

/**
 * Juice. Implements FxApi for the other systems (bursts, streams, float text,
 * speech bubbles, camera shake) and, as a WorldSystem, plays the generic
 * reaction to each WorldEvent at the relevant station of the current layout.
 *
 * Who animates what is split in the spec so nothing fires twice: this class
 * owns only the particle/text reactions listed for "FxSystem" there. Bubbles
 * over characters and anything on the furniture belong to the other systems,
 * which call back in through FxApi.
 */
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
  private readonly pointB: Vec3Like = { x: 0, y: 0, z: 0 };

  constructor(deps: FxDeps) {
    this.deps = deps;
    const budget = particleBudget(deps.quality, deps.reducedMotion);
    this.density = budget.density;
    this.particles = new ParticlePool(budget.capacity, deps.random);
    this.renderer = new ParticleRenderer(this.particles);
    this.floats = new FloatTextLayer({ reducedMotion: deps.reducedMotion, unitsPerPixel: deps.unitsPerPixel });
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
    if (!this.bubbles.show(anchor, icon, seconds, heightOffset) || !this.deps.onBubble) return;
    this.deps.onBubble(anchor.getWorldPosition(this.bubbleAt));
  }

  shake(strength: number): void {
    if (this.deps.reducedMotion) return;
    this.deps.shakeCamera(strength);
  }

  // ── WorldSystem ───────────────────────────────────────────────────────────

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    let raised = false;
    let launched = false;
    for (const event of events) {
      if (event.type === "run-reset") this.reset();
      else if (event.type === "raise" && event.ok) raised = true;
      else if (event.type === "launch" && event.ok) launched = true;
    }
    // First snapshot (or a loaded save): the world appears as it is, without fanfare.
    if (prev === null) return;

    const layout = this.deps.getLayout();
    for (const event of events) this.react(event, next, prev, layout, raised, launched);
  }

  update(dt: number, elapsed: number): void {
    this.fireScheduled(dt);
    const pool = this.particles;
    pool.step(dt);
    if (pool.arrivalCount > 0) this.popArrivals();
    this.renderer.sync();
    this.floats.update(dt);
    this.bubbles.update(dt, elapsed);
  }

  /** Remove every particle, label and bubble at once (run reset). */
  reset(): void {
    this.particles.clear();
    this.renderer.sync();
    this.floats.clear();
    this.bubbles.clear();
    while (this.scheduled.length > 0) this.spareSchedule.push(this.scheduled.pop() as ScheduledBurst);
  }

  dispose(): void {
    this.reset();
    this.root.removeFromParent();
    this.renderer.dispose();
    this.floats.dispose();
    this.bubbles.dispose();
  }

  // ── Event reactions ───────────────────────────────────────────────────────

  private react(
    event: WorldEvent,
    next: WorldSnapshot,
    prev: WorldSnapshot,
    layout: OfficeLayout,
    raised: boolean,
    launched: boolean
  ): void {
    switch (event.type) {
      case "hired":
      case "departed": {
        // The event's true head-count change, not personIds: those only list people
        // who fit on screen, and a big office can hire past that. (Hand-built events
        // without a count fall back to the rosters.)
        const sign = event.type === "hired" ? 1 : -1;
        const change = event.count !== undefined ? sign * event.count : next.team[event.role] - prev.team[event.role];
        const delta = change !== 0 ? change : (event.personIds.length || 1) * sign;
        this.floatText(formatHeadcountDelta(delta, event.role), this.door(layout, DOOR_TEXT_Y), delta > 0 ? "good" : "bad");
        break;
      }
      case "ship":
        this.reactToShip(event.ok, event.reputationDelta, layout);
        break;
      case "launch":
        this.reactToLaunch(event.ok, event.usersDelta, layout);
        break;
      case "pitch":
        this.burst(event.ok ? "sparkle" : "smoke", this.station(layout, "investors", STATION_BURST_Y));
        break;
      case "raise":
        if (event.ok) {
          const intensity = magnitudeIntensity(event.amount, 25_000, 0.7, 2.4);
          this.burst("money", this.founder(layout, HEAD_BURST_Y), intensity);
          this.burst("confetti", this.founder(layout, HEAD_BURST_Y), intensity);
          // A round can close with nothing reaching the bank (it repays debt first).
          const text = event.amount > 0 ? formatMoneyDelta(event.amount) : "Funded";
          this.floatText(text, this.founder(layout, HEAD_TEXT_Y), "cash");
        } else {
          this.burst("smoke", this.station(layout, "investors", STATION_BURST_Y));
        }
        break;
      case "board-action":
        this.burst(event.ok ? "hearts" : "smoke", this.station(layout, "boardroom", STATION_BURST_Y));
        break;
      case "pricing-changed":
        this.burst("sparkle", this.station(layout, "pricing", STATION_BURST_Y), 0.6);
        break;
      case "week-advanced":
        this.floatText(`Week ${event.week}`, this.station(layout, "calendar", STATION_TEXT_Y), "neutral");
        break;
      case "cash-changed":
        // A raise already announced its own, much more exciting, number.
        if (!raised && Math.abs(event.delta) >= CASH_FLOAT_MIN) {
          this.floatText(formatMoneyDelta(event.delta), this.founder(layout, HEAD_TEXT_Y), event.delta > 0 ? "cash" : "bad");
        }
        break;
      case "users-changed":
        // A successful launch already sent its own crowd through the door.
        if (!launched && event.delta > 0) this.streamUsers(layout, clamp(Math.round(2 + 2 * Math.log10(1 + event.delta)), 2, 10));
        break;
      case "phase-changed":
        // Moving up is a party. Falling back a phase is the same rebuild without one.
        if (isPromotion(event.from, event.to)) this.celebrateAcrossFloor(layout, 5, 0.5, 1.3);
        this.shake(0.4);
        break;
      case "stage-changed":
        this.burst("confetti", this.founder(layout, HEAD_BURST_Y));
        break;
      case "asset-acquired":
        this.burst("sparkle", this.ground(layout.assetAnchors[event.assetId], ASSET_BURST_Y), 1.4);
        break;
      case "setup-completed":
        this.burst("sparkle", this.door(layout, STATION_BURST_Y));
        break;
      case "game-over":
        if (isWinEnding(event.ending)) this.celebrateAcrossFloor(layout, 12, 1.8, 1.4);
        else this.smokeOut(layout);
        break;
      // ── People and product builds ──
      case "released":
        this.reactToRelease(event.tier, event.reception, layout);
        break;
      case "build-started":
        this.burst("sparkle", this.station(layout, "ship", STATION_BURST_Y), 0.6);
        this.floatText("Kickoff", this.station(layout, "ship", STATION_TEXT_Y), "neutral");
        break;
      case "build-cancelled":
        // The column peels off the wall and goes in the bin.
        this.burst("dust", this.station(layout, "ship", STATION_BURST_Y), 1.4);
        this.floatText("Cancelled", this.station(layout, "ship", STATION_TEXT_Y), "bad");
        break;
      case "surprise":
        this.burst("bugs", this.station(layout, "ship", STATION_BURST_Y - 0.2), 0.7);
        this.floatText("Surprise scope", this.station(layout, "ship", STATION_TEXT_Y), "bad");
        this.shake(0.15);
        break;
      case "crunch-changed":
        if (event.on) this.floatText("Crunch", this.station(layout, "ship", STATION_TEXT_Y), "bad");
        break;
      case "resigned":
        this.floatText(event.kind === "burnout" ? "Burnt out" : "Poached", this.door(layout, DOOR_TEXT_Y + 0.45), "bad");
        if (event.buildAtRisk) {
          // The lead took a quarter of the build with them: notes fall off the wall.
          this.burst("dust", this.station(layout, "ship", STATION_BURST_Y), 1.2);
          this.floatText("Lost its lead", this.station(layout, "ship", STATION_TEXT_Y), "bad");
        }
        break;
      case "cruft-band":
        if (event.rising && event.band === "sparking") this.burst("smoke", this.station(layout, "servers", STATION_BURST_Y), 0.8);
        break;
      case "moat-band":
        if (event.rising) this.burst("sparkle", this.station(layout, "ship", 0.4), 0.6);
        break;
      case "offer-landed":
      case "retained":
      case "staffed":
      case "experience":
      case "energy-band":
      case "candidates-shown":
      case "build-progress":
        // Over people's heads and on their desks: the people system's job.
        break;
      // Reactions to these belong to the office and the characters (see the spec's table).
      case "run-reset":
      case "event-opened":
      case "event-resolved":
      case "easter-egg":
      case "command-failed":
        break;
    }
  }

  private reactToShip(ok: boolean, reputationDelta: number, layout: OfficeLayout): void {
    const text = reputationDelta !== 0 ? formatCountDelta(reputationDelta, "rep") : ok ? "Shipped" : "Buggy";
    if (ok) {
      this.burst("sparkle", this.station(layout, "ship", STATION_BURST_Y), clamp(0.8 + Math.abs(reputationDelta) * 0.08, 0.8, 2));
    } else {
      this.burst("smoke", this.station(layout, "ship", STATION_BURST_Y));
      this.burst("bugs", this.station(layout, "ship", STATION_BURST_Y - 0.4));
      this.shake(0.3);
    }
    // The number speaks for itself: a shipped feature can still cost reputation.
    const gained = reputationDelta !== 0 ? reputationDelta > 0 : ok;
    this.floatText(text, this.station(layout, "ship", STATION_TEXT_Y), gained ? "good" : "bad");
  }

  /** A release, sized by its tier: a gold rain for a breakout down to smoke and bugs for a flop. */
  private reactToRelease(tier: "flop" | "shrug" | "solid" | "breakout", reception: number, layout: OfficeLayout): void {
    const at = (y: number): Vec3Like => this.station(layout, "ship", y);
    const label = `${tier.toUpperCase()} ${Math.round(reception)}`;
    switch (tier) {
      case "breakout":
        this.burst("confetti", at(STATION_BURST_Y), 2.6);
        this.burst("sparkle", at(STATION_BURST_Y), 1.8);
        this.celebrateAcrossFloor(layout, 5, 1.1, 1.1);
        this.streamUsers(layout, 14);
        this.floatText(label, at(STATION_TEXT_Y), "good");
        this.shake(0.2);
        break;
      case "solid":
        this.burst("sparkle", at(STATION_BURST_Y), 1.7);
        this.burst("confetti", at(STATION_BURST_Y), 0.9);
        this.floatText(label, at(STATION_TEXT_Y), "good");
        break;
      case "shrug":
        // One party popper, politely.
        this.burst("confetti", at(STATION_BURST_Y), 0.3);
        this.floatText(label, at(STATION_TEXT_Y), "neutral");
        break;
      case "flop":
        this.burst("smoke", at(STATION_BURST_Y), 1.8);
        this.burst("bugs", at(STATION_BURST_Y - 0.4), 1.4);
        this.floatText(label, at(STATION_TEXT_Y), "bad");
        this.shake(0.3);
        break;
    }
  }

  private reactToLaunch(ok: boolean, usersDelta: number, layout: OfficeLayout): void {
    if (ok) {
      this.streamUsers(layout, clamp(Math.round(6 + 5 * Math.log10(1 + Math.max(0, usersDelta))), 6, 26));
      const text = usersDelta !== 0 ? formatCountDelta(usersDelta, "users") : "Launched";
      this.floatText(text, this.station(layout, "launch", STATION_TEXT_Y), "good");
      return;
    }
    this.burst("smoke", this.station(layout, "launch", STATION_BURST_Y));
    const text = usersDelta > 0 ? formatCountDelta(usersDelta, "users") : "Flop";
    this.floatText(text, this.station(layout, "launch", STATION_TEXT_Y), usersDelta > 0 ? "neutral" : "bad");
  }

  /** New users hop in through the door and into the servers. */
  private streamUsers(layout: OfficeLayout, count: number): void {
    const from = this.door(layout, DOOR_FLOOR_Y);
    const servers = layout.stations.servers;
    const to = this.pointB;
    to.x = servers.x;
    to.y = SERVER_INTAKE_Y;
    to.z = servers.z;
    this.stream("users", from, to, count);
  }

  /** `bursts` confetti fountains spread over the floor and over `seconds`. */
  private celebrateAcrossFloor(layout: OfficeLayout, bursts: number, seconds: number, intensity: number): void {
    const { minX, maxX, minZ, maxZ } = layout.floor;
    const random = this.deps.random ?? Math.random;
    for (let i = 0; i < bursts; i += 1) {
      const x = minX + (maxX - minX) * (0.15 + 0.7 * random());
      const z = minZ + (maxZ - minZ) * (0.15 + 0.7 * random());
      this.schedule((i / Math.max(1, bursts - 1)) * seconds, "confetti", x, 1 + random() * 0.8, z, intensity);
    }
  }

  /** The run is lost: smoke rises from where the work used to happen. */
  private smokeOut(layout: OfficeLayout): void {
    const founder = this.deps.seating.seatOf("founder") ?? layout.founderSeat;
    const spots: readonly Vec2[] = [founder, layout.stations.servers, layout.stations.ship, layout.stations.launch];
    spots.forEach((spot, i) => this.schedule(i * 0.25, "smoke", spot.x, STATION_BURST_Y - 0.3, spot.z, 1.3));
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private ground(spot: Vec2, y: number): Vec3Like {
    const point = this.pointA;
    point.x = spot.x;
    point.y = y;
    point.z = spot.z;
    return point;
  }

  private station(layout: OfficeLayout, kind: StationKind, y: number): Vec3Like {
    return this.ground(layout.stations[kind], y);
  }

  private door(layout: OfficeLayout, y: number): Vec3Like {
    return this.ground(layout.door, y);
  }

  /** Above the founder's actual seat (falling back to the layout's if they are not seated yet). */
  private founder(layout: OfficeLayout, y: number): Vec3Like {
    return this.ground(this.deps.seating.seatOf("founder") ?? layout.founderSeat, y);
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
