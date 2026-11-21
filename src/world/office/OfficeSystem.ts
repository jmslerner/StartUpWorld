/**
 * OfficeSystem: the level designer of the world layer.
 *
 * It turns the pure floor plan of the current company phase into a place —
 * building, desks, the eight stations, purchasable assets, markers — and owns
 * every static interactable in it. People are somebody else's job
 * (EmployeeSystem); this system only reads where they sit (ctx.seating).
 *
 * Lifecycle:
 *   • a new phase (or the first snapshot, or a new run) builds a fresh
 *     OfficeStage; the old one sinks away while the new one rises and its
 *     contents pop in;
 *   • every other snapshot is applied incrementally by `OfficeStage.sync`;
 *   • a few events get a visible reaction here (see spec §3, OfficeSystem column).
 */
import * as THREE from "three";
import { getLightingState } from "../core/lightingState";
import type { LightingState } from "../core/lightingState";
import type { WorldContext, WorldEvent, WorldSnapshot, WorldSystem } from "../types";
import { StageMotion } from "./motion";
import { OfficeStage } from "./OfficeStage";
import {
  REBUILD_POP_SECONDS,
  REBUILD_POP_SPREAD,
  REBUILD_POP_START,
  REBUILD_RISE_DELAY,
  REBUILD_RISE_DEPTH,
  REBUILD_RISE_SECONDS,
  REBUILD_SINK_DEPTH,
  REBUILD_SINK_SECONDS,
} from "./timing";

// The rebuild's timing is shared with the people system (they pop in after their chairs): see ./timing.
const SINK_SECONDS = REBUILD_SINK_SECONDS;
const SINK_DEPTH = REBUILD_SINK_DEPTH;
const RISE_DELAY = REBUILD_RISE_DELAY;
const RISE_SECONDS = REBUILD_RISE_SECONDS;
const RISE_DEPTH = REBUILD_RISE_DEPTH;
/** Contents pop in over this window once the building is nearly up; the whole change stays under 1.2 s. */
const POP_START = REBUILD_POP_START;
const POP_SPREAD = REBUILD_POP_SPREAD;
const POP_SECONDS = REBUILD_POP_SECONDS;
/** A purchased asset lands with a slower, bouncier pop than furniture. */
const ASSET_POP_SECONDS = 0.5;

/** Dusk glow is pushed to the props only when it has moved by at least this much. */
const GLOW_STEP = 0.01;

export class OfficeSystem implements WorldSystem {
  private readonly ctx: WorldContext;
  private readonly root = new THREE.Group();
  private readonly motion = new StageMotion();
  private readonly lighting: Readonly<LightingState>;
  private stage: OfficeStage | null = null;
  /** Offices on their way out (still sinking). */
  private readonly leaving = new Set<OfficeStage>();
  private appliedGlow = -1;
  private disposed = false;

  constructor(ctx: WorldContext) {
    this.ctx = ctx;
    this.root.name = "office";
    ctx.scene.add(this.root);
    this.lighting = getLightingState(ctx.scene);
  }

  /** The office currently on show (for tests and the dev sandbox). */
  get currentStage(): OfficeStage | null {
    return this.stage;
  }

  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void {
    if (this.disposed) return;
    const instant = prev === null || this.ctx.reducedMotion;
    const reset = events.some((event) => event.type === "run-reset");
    const rebuilt = this.stage === null || this.stage.phase !== next.phase || reset;
    const stage = rebuilt ? this.rebuild(next, instant || reset) : this.stage;
    if (!stage) return;

    // A stage that was just built has nothing to animate *from*: it must simply be right.
    const animate = !instant && !rebuilt;
    const arrived = stage.sync(next, animate);
    if (rebuilt) {
      // After the sync, so that assets, cushions and markers are part of the reveal.
      if (!instant && !reset) this.reveal(stage);
    } else if (animate) {
      for (const assetId of arrived) {
        const object = stage.assets.objectOf(assetId);
        // The scale-bounce of a purchase (or of a blueprint appearing).
        if (object) this.motion.pop(object, 0, ASSET_POP_SECONDS);
      }
    }
    if (prev !== null) this.react(stage, events);
  }

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    this.motion.update(dt);
    const stage = this.stage;
    if (!stage) return;
    const glow = this.lighting.duskAmount;
    // Small drifts are skipped, but the end points must always be reached exactly.
    if (glow !== this.appliedGlow && (Math.abs(glow - this.appliedGlow) >= GLOW_STEP || glow === 0 || glow === 1)) {
      this.appliedGlow = glow;
      stage.setGlow(glow);
    }
    stage.update(dt, elapsed, this.ctx.signals.doorTraffic);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Completes any sink in progress, which disposes the offices that were leaving.
    this.motion.finishAll();
    for (const stage of this.leaving) stage.dispose();
    this.leaving.clear();
    this.stage?.dispose();
    this.stage = null;
    this.root.removeFromParent();
    this.root.clear();
  }

  /** Replace the office with one for `snapshot.phase`. */
  private rebuild(snapshot: WorldSnapshot, instant: boolean): OfficeStage {
    const old = this.stage;
    this.stage = null;
    if (old) {
      // Its interactables go now, so the new office can claim the same targets.
      old.unregisterAll();
      if (instant) {
        old.dispose();
      } else {
        this.leaving.add(old);
        this.motion.sink(old.root, SINK_DEPTH, SINK_SECONDS, () => {
          this.leaving.delete(old);
          old.dispose();
        });
      }
    }

    const stage = new OfficeStage({
      layout: this.ctx.getLayout(),
      interactables: this.ctx.interactables,
      seating: this.ctx.seating,
      snapshot,
      signals: this.ctx.signals,
    });
    this.root.add(stage.root);
    this.stage = stage;
    stage.setGlow(this.lighting.duskAmount);
    this.appliedGlow = this.lighting.duskAmount;
    return stage;
  }

  /** The building rises as one piece; then its contents pop in, in the order they were built (desks, stations, décor, assets). */
  private reveal(stage: OfficeStage): void {
    const { kit } = stage;
    this.motion.rise(kit.structure, RISE_DEPTH, RISE_DELAY, RISE_SECONDS);
    const pieces = kit.entrances;
    const last = Math.max(1, pieces.length - 1);
    for (let i = 0; i < pieces.length; i += 1) {
      this.motion.pop(pieces[i], POP_START + (i / last) * POP_SPREAD, POP_SECONDS);
    }
  }

  /** Spec §3, OfficeSystem column: the events this system answers with something visible. */
  private react(stage: OfficeStage, events: readonly WorldEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "ship":
          stage.stations.ship.pulse(event.ok ? "good" : "bad");
          break;
        case "launch":
          if (event.ok) stage.stations.launch.flash();
          break;
        case "pricing-changed":
          stage.flashPricing();
          break;
        // The front door needs no cue: it opens for whoever is actually walking
        // through it (ctx.signals.doorTraffic, see OfficeStage.update).
        default:
          break;
      }
    }
  }
}
