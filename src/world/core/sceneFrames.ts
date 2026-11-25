/**
 * From a scene to the one frame every system is handed.
 *
 * This is the part of World.setScene that needs no renderer: work out the people (nextCast) and what changed
 * (sceneEvents), pick the office's plan, and seat everyone, in that order, so that by the time a system sees the
 * frame the layout and the seating are already this frame's. It owns the seating plan for the life of the world.
 *
 * Another run (another run id, or an earlier year) is a first scene again: the seating forgets everything and the
 * frame comes with nothing before it and no events, so every system builds it at once with nothing to animate from.
 */
import { nextCast } from "../cast";
import { getOfficeLayout } from "../office/layouts";
import { SeatingPlan } from "../people/seating";
import { sceneEvents } from "../sceneEvents";
import type { OfficeLayout, OfficeScene, SceneEvent, WorldFrame } from "../types";

export interface StagedFrame {
  /** The frame to hand to every system. */
  readonly next: WorldFrame;
  /** The frame before it, or null for a first scene and for another run. */
  readonly prev: WorldFrame | null;
  /** The plan of the office this frame shows. An office index out of range gives the garage. */
  readonly layout: OfficeLayout;
  /** This scene belongs to another run than the one before: whatever was built for that one must go. */
  readonly newRun: boolean;
}

const NO_EVENTS: readonly SceneEvent[] = Object.freeze([]);

export class SceneFrames {
  /** One plan for the life of the world: what systems read as ctx.seating. */
  readonly seating = new SeatingPlan();
  private current: OfficeLayout = getOfficeLayout(0);
  private previous: WorldFrame | null = null;
  private readonly fault: (label: string, error: unknown) => void;

  /** `fault` is told of a step that threw; the frame is made all the same, with what there is. */
  constructor(fault: (label: string, error: unknown) => void = () => undefined) {
    this.fault = fault;
  }

  /** The plan of the office being shown (the garage before the first scene). */
  get layout(): OfficeLayout {
    return this.current;
  }

  /** The last frame made, or null before the first. */
  get last(): WorldFrame | null {
    return this.previous;
  }

  /**
   * Make the frame for `scene`. `onNewRun` is called when the scene belongs to another run, before the seating
   * forgets the old one and before the layout changes: the moment to take down whatever was built for that run.
   */
  stage(scene: OfficeScene, onNewRun?: () => void): StagedFrame {
    const before = this.previous;
    const cast = nextCast(before?.cast ?? null, scene);
    const events = sceneEvents(before?.scene ?? null, scene);
    const newRun = before !== null && events.some((event) => event.kind === "run-reset");
    if (newRun) {
      try {
        onNewRun?.();
      } catch (error) {
        this.fault("newRun", error);
      }
      this.seating.reset();
    }

    // If the floor plan cannot be produced the world keeps the one it has.
    try {
      this.current = getOfficeLayout(scene.office);
    } catch (error) {
      this.fault("layout", error);
    }
    const layout = this.current;
    try {
      this.seating.reconcile(cast, layout);
    } catch (error) {
      this.fault("seating.reconcile", error);
    }

    const next: WorldFrame = { scene, cast, events: newRun ? NO_EVENTS : events };
    this.previous = next;
    return { next, prev: newRun ? null : before, layout, newRun };
  }

  /** Forget everything (the world is disposed). */
  clear(): void {
    this.previous = null;
    this.current = getOfficeLayout(0);
    this.seating.reset();
  }
}
