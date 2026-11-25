/**
 * Scaffolding shared by the people tests: a miniature of what the World does around the people system (scene → cast
 * and events → seating → layout) and a CrewHost that records what it is asked to show. Test-only; nothing in the
 * app imports it.
 */
import { nextCast } from "../cast";
import type { Cast } from "../cast";
import { getOfficeLayout } from "../office/layouts";
import { sceneEvents } from "../sceneEvents";
import type { BubbleIcon, OfficeLayout, OfficeScene, WorldFrame } from "../types";
import type { Actor } from "./actor";
import type { Crew, CrewHost } from "./crew";
import { SeatingPlan } from "./seating";

/** A scene with these people at work (Product, Growth, Recruiting), in the shared office unless `patch` says otherwise. */
export const scene = (teams: readonly [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "run",
  seed: 20_240_607,
  year: 1990,
  office: 1,
  capacity: 9,
  era: "any",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] },
  away: 0,
  leaving: 0,
  arriving: 0,
  ending: null,
  ...patch,
});

export interface Frame {
  next: WorldFrame;
  prev: WorldFrame | null;
  layout: OfficeLayout;
}

/** Does for a test what World.setScene does for the real systems: works out the cast, seats it and picks the layout. */
export class Studio {
  readonly seating = new SeatingPlan();
  layout: OfficeLayout = getOfficeLayout(0);
  last: WorldFrame | null = null;

  get cast(): Cast | null {
    return this.last?.cast ?? null;
  }

  frame(next: OfficeScene): Frame {
    const prev = this.last;
    const cast = nextCast(prev?.cast ?? null, next);
    const events = sceneEvents(prev?.scene ?? null, next);
    this.layout = getOfficeLayout(next.office);
    this.seating.reconcile(cast, this.layout);
    this.last = { scene: next, cast, events };
    return { next: this.last, prev, layout: this.layout };
  }

  /** Push a scene through to a Crew the way the EmployeeSystem would. */
  apply(crew: Crew, next: OfficeScene): Frame {
    const frame = this.frame(next);
    crew.applyFrame(frame.next, frame.prev, this.seating, frame.layout);
    return frame;
  }
}

export interface BubbleRecord {
  id: string;
  icon: BubbleIcon;
  seconds: number | undefined;
}

/** A CrewHost that shows nothing and remembers everything. */
export class RecordingHost implements CrewHost {
  /** Actors that currently have a "body". */
  readonly alive = new Set<Actor>();
  readonly retired = new Set<Actor>();
  readonly bubbles: BubbleRecord[] = [];
  readonly puffs: Array<{ x: number; z: number }> = [];
  spawnCount = 0;
  despawnCount = 0;

  spawn(actor: Actor): void {
    if (this.alive.has(actor)) throw new Error(`spawned twice: ${actor.id}`);
    this.alive.add(actor);
    this.spawnCount += 1;
  }

  retire(actor: Actor): void {
    this.retired.add(actor);
  }

  despawn(actor: Actor): void {
    if (!this.alive.has(actor)) throw new Error(`despawned without a body: ${actor.id}`);
    this.alive.delete(actor);
    this.despawnCount += 1;
  }

  bubble(actor: Actor, icon: BubbleIcon, seconds?: number): void {
    this.bubbles.push({ id: actor.id, icon, seconds });
  }

  dust(x: number, z: number): void {
    this.puffs.push({ x, z });
  }

  dustAt(x: number, z: number): boolean {
    return this.puffs.some((puff) => Math.hypot(puff.x - x, puff.z - z) < 1e-6);
  }

  /** Icons shown so far, optionally for one person. */
  icons(id?: string): BubbleIcon[] {
    return this.bubbles.filter((bubble) => id === undefined || bubble.id === id).map((bubble) => bubble.icon);
  }

  clearLog(): void {
    this.bubbles.length = 0;
    this.puffs.length = 0;
  }
}

/** Step a crew forward `seconds` in 60 fps frames, calling `each` after every frame. */
export const run = (crew: Crew, seconds: number, each?: (time: number) => void): void => {
  const dt = 1 / 60;
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    crew.update(dt);
    each?.((i + 1) * dt);
  }
};
