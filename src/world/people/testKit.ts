/**
 * Scaffolding shared by the people tests: a miniature of what the World does
 * around the EmployeeSystem (state → snapshot → seating → layout) and a CrewHost
 * that records what it is asked to show. Test-only; nothing in the app imports it.
 */
import { createInitialState } from "../../engine";
import type { CompanyPhase, EndingType, GameState, TeamRole, TeamRoster } from "../../types/game";
import { getOfficeLayout } from "../office/layouts";
import { buildWorldSnapshot } from "../snapshot";
import type { BubbleIcon, OfficeLayout, StationKind, WorldEvent, WorldSnapshot } from "../types";
import type { Actor } from "./actor";
import type { Crew, CrewHost } from "./crew";
import { SeatingPlan } from "./seating";

export interface CompanyOptions {
  phase?: CompanyPhase;
  team?: Partial<TeamRoster>;
  /** Default true. */
  setup?: boolean;
  morale?: number;
  stress?: number;
  over?: EndingType | null;
  week?: number;
  seed?: number;
}

const NO_TEAM: TeamRoster = {
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
};

/** A GameState with just the fields the world looks at set to something specific. */
export const company = (options: CompanyOptions = {}): GameState => {
  const base = createInitialState();
  const setup = options.setup ?? true;
  const week = options.week ?? 1;
  return {
    ...base,
    seed: options.seed ?? 20_240_607,
    week,
    companyName: setup ? "Test Labs" : "",
    founder: { name: setup ? "Robin" : "", archetype: setup ? "hacker" : null },
    cofounder: { ...base.cofounder, name: "Sam", archetype: setup ? "operator" : null },
    companyPhase: options.phase ?? "coworking",
    team: { ...NO_TEAM, ...options.team },
    culture: { ...base.culture, morale: options.morale ?? 55 },
    stress: options.stress ?? 20,
    gameOver: options.over ? { ending: options.over, week, headline: "Test ending" } : null,
  };
};

export const hired = (role: TeamRole, ...indices: number[]): WorldEvent => ({
  type: "hired",
  role,
  personIds: indices.map((index) => `${role}-${index}`),
});

export const departed = (role: TeamRole, ...indices: number[]): WorldEvent => ({
  type: "departed",
  role,
  personIds: indices.map((index) => `${role}-${index}`),
});

export interface Frame {
  next: WorldSnapshot;
  prev: WorldSnapshot | null;
  events: readonly WorldEvent[];
  layout: OfficeLayout;
}

/** Does for a test what World.setSnapshot does for the real systems: seats people and picks the layout. */
export class Studio {
  readonly seating = new SeatingPlan();
  layout: OfficeLayout = getOfficeLayout("garage");
  snapshot: WorldSnapshot | null = null;

  frame(state: GameState, events: readonly WorldEvent[] = []): Frame {
    const next = buildWorldSnapshot(state);
    const prev = this.snapshot;
    this.layout = getOfficeLayout(next.phase, next.ownedAssets);
    // Until setup completes the World seats only the founder.
    const roster = next.setupComplete ? next.people : next.people.filter((person) => person.kind === "founder");
    this.seating.reconcile(roster, next.setupComplete ? next.hiddenPeople : 0, this.layout);
    this.snapshot = next;
    return { next, prev, events, layout: this.layout };
  }

  /** Push a state through to a Crew the way the EmployeeSystem would. */
  apply(crew: Crew, state: GameState, events: readonly WorldEvent[] = []): Frame {
    const frame = this.frame(state, events);
    crew.applySnapshot(frame.next, frame.prev, frame.events, this.seating, frame.layout);
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
  readonly renames: string[] = [];
  readonly bubbles: BubbleRecord[] = [];
  readonly puffs: Array<{ x: number; z: number }> = [];
  readonly streams: Array<{ id: string; station: StationKind }> = [];
  spawnCount = 0;
  despawnCount = 0;

  spawn(actor: Actor): void {
    if (this.alive.has(actor)) throw new Error(`spawned twice: ${actor.id}`);
    this.alive.add(actor);
    this.spawnCount += 1;
  }

  renamed(actor: Actor): void {
    this.renames.push(actor.id);
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

  stream(actor: Actor, station: StationKind): void {
    this.streams.push({ id: actor.id, station });
  }

  /** Icons shown so far, optionally for one person. */
  icons(id?: string): BubbleIcon[] {
    return this.bubbles.filter((bubble) => id === undefined || bubble.id === id).map((bubble) => bubble.icon);
  }

  clearLog(): void {
    this.bubbles.length = 0;
    this.puffs.length = 0;
    this.streams.length = 0;
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
