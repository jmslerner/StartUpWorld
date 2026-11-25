/**
 * OfficeSystem: the level designer of the world layer.
 *
 * It turns the pure floor plan of the scene's office into a place — building, desks, the eight stations, set
 * dressing, the sign beside the door — and owns every static thing in it that can be tapped. People are somebody
 * else's job; this system only reads where they sit, which team has which desk and how many are not drawn, from
 * the seating plan in its context. Until there is one, the desks are free and neutral and there is no sign.
 *
 * Lifecycle:
 *   • another office (or the first frame, or a new run, or another look) builds a fresh
 *     OfficeStage; the old one sinks away while the new one rises and its
 *     contents pop in;
 *   • every other frame is applied incrementally by `OfficeStage.sync`.
 */
import * as THREE from "three";
import { lookFor } from "../core/colors";
import { getLightingState } from "../core/lightingState";
import type { LightingState } from "../core/lightingState";
import type { LookId, SeatingApi, WorldContext, WorldFrame, WorldSystem } from "../types";
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

/**
 * What the office reads of the world. A whole WorldContext is one of these. The seating plan may be absent: an
 * office can be built before anybody is seated in it.
 */
export type OfficeContext = Pick<WorldContext, "scene" | "reducedMotion" | "interactables" | "signals" | "getLayout"> & {
  readonly seating?: SeatingApi;
};

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
/** Dusk glow is pushed to the props only when it has moved by at least this much. */
const GLOW_STEP = 0.01;

export class OfficeSystem implements WorldSystem {
  private readonly ctx: OfficeContext;
  private readonly root = new THREE.Group();
  private readonly motion = new StageMotion();
  private readonly lighting: Readonly<LightingState>;
  private stage: OfficeStage | null = null;
  /** Offices on their way out (still sinking). */
  private readonly leaving = new Set<OfficeStage>();
  private appliedGlow = -1;
  private disposed = false;

  constructor(ctx: OfficeContext) {
    this.ctx = ctx;
    this.root.name = "office";
    ctx.scene.add(this.root);
    this.lighting = getLightingState(ctx.scene);
  }

  /** The office currently on show (for tests and the lab). */
  get currentStage(): OfficeStage | null {
    return this.stage;
  }

  applyFrame(next: WorldFrame, prev: WorldFrame | null): void {
    if (this.disposed) return;
    const layout = this.ctx.getLayout();
    const look = lookFor(next.scene.era);
    const reset = next.events.some((event) => event.kind === "run-reset");
    const instant = prev === null || reset || this.ctx.reducedMotion;
    const rebuilt = this.stage === null || this.stage.layout !== layout || this.stage.look !== look || reset;
    const stage = this.stage !== null && !rebuilt ? this.stage : this.rebuild(instant, look);

    // A stage that was just built has nothing to animate *from*: it must simply be right.
    stage.sync(!instant && !rebuilt);
    // After the sync, so that the sign is part of the reveal.
    if (rebuilt && !instant) this.reveal(stage);
  }

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    this.motion.update(dt);
    const stage = this.stage;
    if (!stage) return;
    if (this.glowPending()) {
      this.appliedGlow = this.lighting.duskAmount;
      stage.setGlow(this.appliedGlow);
    }
    stage.update(dt, elapsed, this.ctx.signals.doorTraffic);
  }

  /** True while an office is sinking, rising or popping in, the door or a chair is moving, or the dusk glow has yet to be passed on. */
  busy(): boolean {
    if (this.disposed) return false;
    if (this.motion.busy || this.leaving.size > 0) return true;
    if (this.stage === null) return false;
    return this.ctx.signals.doorTraffic > 0 || this.glowPending() || this.stage.busy();
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

  /** Small drifts of the dusk glow are skipped, but its end points must always be reached exactly. */
  private glowPending(): boolean {
    const glow = this.lighting.duskAmount;
    return glow !== this.appliedGlow && (Math.abs(glow - this.appliedGlow) >= GLOW_STEP || glow === 0 || glow === 1);
  }

  /** Replace the office with the one of the context's layout, in the look of the scene's era. */
  private rebuild(instant: boolean, look: LookId): OfficeStage {
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
      look,
      interactables: this.ctx.interactables,
      seating: this.ctx.seating,
      signals: this.ctx.signals,
    });
    this.root.add(stage.root);
    this.stage = stage;
    stage.setGlow(this.lighting.duskAmount);
    this.appliedGlow = this.lighting.duskAmount;
    return stage;
  }

  /** The building rises as one piece; then its contents pop in, in the order they were built (desks, stations, décor, the sign). */
  private reveal(stage: OfficeStage): void {
    const { kit } = stage;
    this.motion.rise(kit.structure, RISE_DEPTH, RISE_DELAY, RISE_SECONDS);
    const pieces = kit.entrances;
    const last = Math.max(1, pieces.length - 1);
    for (let i = 0; i < pieces.length; i += 1) {
      this.motion.pop(pieces[i], POP_START + (i / last) * POP_SPREAD, POP_SECONDS);
    }
  }
}
