/**
 * One built office: the building, its desks, its eight stations, its set dressing and the sign beside the door,
 * for exactly one of the five offices in one look.
 *
 * OfficeSystem builds a stage when the office (or the run) changes and throws it away at the next change. In
 * between, `sync` only touches what changed: who sits where, which team has which desk, the count on the sign.
 *
 * The stations are furniture. They stand where the plan puts them and can be pointed at, by the name of the piece
 * of furniture they are; nothing of the game is read into them.
 */
import * as THREE from "three";
import { addHitBox, addHitProxy } from "../interaction/hitProxy";
import type {
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  LookId,
  OfficeIndex,
  OfficeLayout,
  SeatingApi,
  StationKind,
  WorldSignals,
} from "../types";
import { DeskSlots } from "./DeskSlots";
import type { Registrar } from "./DeskSlots";
import { dressOffice } from "./dressing";
import { doorExterior, WALL_HEIGHT } from "./layouts";
import { createOverflowSign, createStation } from "./props";
import type { OverflowSignHandle, StationHandles } from "./props";
import { buildShell, ROLL_UP_WIDTH } from "./shell";
import type { Shell } from "./shell";
import { StageKit } from "./StageKit";

/** What each station is called when it is pointed at: the piece of furniture, in plain words. */
export const STATION_LABELS: Record<StationKind, string> = {
  ship: "Whiteboard",
  launch: "Marketing corner",
  investors: "Phone corner",
  boardroom: "Board table",
  calendar: "Wall calendar",
  coffee: "Coffee machine",
  servers: "Server rack",
  pricing: "Price board",
};

export const DOOR_LABEL = "Front door";

/** What the sign beside the door is called when it is pointed at: a count in plain words. */
export const signLabel = (count: number): string => (count === 1 ? "1 more person works here" : `${count} more people work here`);

/** How long the front door is held open when somebody is announced. */
const DOOR_OPEN_SECONDS = 1.5;
/** How long it stays open after the last person has walked through. */
const DOOR_LINGER_SECONDS = 0.8;

/** Where the sign stands relative to the doorway: this far out, this far to the side. */
const SIGN_OUT = 1.3;
const SIGN_ASIDE = 1.4;

/** No station's click area is smaller than this, however slight the prop. */
const STATION_CLICK_AREA = { minWidth: 0.8, minDepth: 0.6, minHeight: 1.0 } as const;

const _box = new THREE.Box3();

/** Height of an object's top above the floor, for anchoring a card over it. */
const topOf = (object: THREE.Object3D): number => {
  object.updateWorldMatrix(true, true);
  _box.setFromObject(object);
  return Number.isFinite(_box.max.y) ? _box.max.y : 1.6;
};

export interface StageOptions {
  layout: OfficeLayout;
  look: LookId;
  interactables: InteractableRegistry;
  /** Who sits where, which team has which desk, and how many people are not drawn. Absent until there is one. */
  seating?: SeatingApi;
  /** What the people system publishes (who is away, where the chairs are, who is in the doorway). */
  signals?: WorldSignals;
}

export class OfficeStage implements Registrar {
  readonly kit: StageKit;
  readonly stations: Readonly<StationHandles>;
  readonly desks: DeskSlots;

  private readonly interactables: InteractableRegistry;
  private readonly seating: SeatingApi | null;
  private readonly signals: WorldSignals | undefined;
  private readonly registered = new Set<THREE.Object3D>();
  private readonly shell: Shell;
  private sign: OverflowSignHandle | null = null;
  private shownCount = 0;
  private doorOpenFor = 0;

  constructor(options: StageOptions) {
    this.interactables = options.interactables;
    this.seating = options.seating ?? null;
    this.signals = options.signals;
    this.kit = new StageKit(options.layout, options.look);

    this.shell = buildShell(this.kit);
    this.register(this.shell.doorObject, { kind: "door" }, { label: DOOR_LABEL, anchorHeight: this.shell.doorHeight });
    this.addDoorClickArea();

    this.desks = new DeskSlots(this.kit, this, this.seating);
    this.stations = this.buildStations();
    dressOffice(this.kit);
  }

  get office(): OfficeIndex {
    return this.kit.office;
  }

  get look(): LookId {
    return this.kit.look;
  }

  get layout(): OfficeLayout {
    return this.kit.layout;
  }

  get root(): THREE.Group {
    return this.kit.root;
  }

  /** The number on the sign beside the door; 0 when there is no sign. */
  get signCount(): number {
    return this.shownCount;
  }

  /** The sign beside the door, while there is one. */
  get signObject(): THREE.Object3D | null {
    return this.sign?.group ?? null;
  }

  // ── Registrar ─────────────────────────────────────────────────────────────

  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void {
    this.registered.add(object);
    this.interactables.register(object, target, options);
  }

  unregister(object: THREE.Object3D): void {
    if (!this.registered.delete(object)) return;
    this.interactables.unregister(object);
  }

  /** Make nothing in this office something to tap any more (it is on its way out). */
  unregisterAll(): void {
    for (const object of this.registered) this.interactables.unregister(object);
    this.registered.clear();
  }

  // ── The frame ─────────────────────────────────────────────────────────────

  /**
   * Bring the office in line with the seating plan as it is now. `animate` is false when the office must simply
   * *be* in the new state (a first build, a reset).
   */
  sync(animate: boolean): void {
    this.desks.sync(this.seating, this.signals, animate);
    this.setSignCount(this.seating?.hiddenCount() ?? 0);
  }

  /**
   * Swing the front door open ahead of an arrival. From then on it follows the
   * people actually walking through it (see `update`).
   */
  openDoor(): void {
    this.doorOpenFor = Math.max(this.doorOpenFor, DOOR_OPEN_SECONDS);
    this.shell.door?.setOpen(1);
  }

  /**
   * Per frame. `doorTraffic` is how many people are in the doorway right now:
   * the door is held open for them, and shut a moment after the last one is through.
   */
  update(dt: number, elapsed: number, doorTraffic = 0): void {
    if (doorTraffic > 0) {
      if (this.doorOpenFor <= 0) this.shell.door?.setOpen(1);
      this.doorOpenFor = Math.max(this.doorOpenFor, DOOR_LINGER_SECONDS);
    } else if (this.doorOpenFor > 0) {
      this.doorOpenFor -= dt;
      if (this.doorOpenFor <= 0) this.shell.door?.setOpen(0);
    }
    this.desks.update(dt, this.signals);
    this.kit.props.update(dt, elapsed);
  }

  /** True while something of this office is on its way somewhere: the door, a chair. */
  busy(): boolean {
    return this.doorOpenFor > 0 || (this.shell.door?.moving() ?? false) || this.desks.busy();
  }

  setGlow(amount: number): void {
    this.kit.props.setGlow(amount);
  }

  dispose(): void {
    this.unregisterAll();
    // M1: free the merged shell geometry (the kit's prop disposal below does
    // not own it — the merge created it).
    this.shell.merged?.dispose();
    this.kit.dispose();
    this.sign = null;
    this.shownCount = 0;
  }

  // ── Stations ──────────────────────────────────────────────────────────────

  private buildStations(): StationHandles {
    const build = <K extends StationKind>(kind: K): StationHandles[K] => {
      const handle = createStation(kind, this.kit.office, this.kit.look);
      this.kit.place(handle, this.kit.layout.stations[kind]);
      this.register(
        handle.group,
        { kind: "station", station: kind },
        { label: STATION_LABELS[kind], anchorHeight: Math.min(topOf(handle.group) + 0.1, WALL_HEIGHT) }
      );
      // Some stations are slight things (a phone on a stool, a board seen nearly edge-on):
      // every one of them gets a click area the size of the prop, and never a tiny one.
      addHitProxy(handle.group, STATION_CLICK_AREA);
      return handle;
    };
    // In the order of STATION_KINDS.
    return {
      ship: build("ship"),
      launch: build("launch"),
      investors: build("investors"),
      boardroom: build("boardroom"),
      calendar: build("calendar"),
      coffee: build("coffee"),
      servers: build("servers"),
      pricing: build("pricing"),
    };
  }

  /** Show the year on the wall calendar. */
  setYear(year: number): void {
    this.stations.calendar.setYear(year);
  }

  /**
   * The doorway's click area. A framed door is simply wrapped; the garage's roll-up
   * door is an open frame, so only its posts and its rail are made
   * clickable — a box over the whole opening would swallow clicks meant for the
   * desks seen through it.
   */
  private addDoorClickArea(): void {
    const { doorObject, door } = this.shell;
    if (door) {
      addHitProxy(doorObject, { minDepth: 0.45, minWidth: 0.9 });
      return;
    }
    const half = ROLL_UP_WIDTH / 2 + 0.05;
    for (const side of [-1, 1]) {
      addHitBox(doorObject, { x: side * half, y: 0, z: 0, width: 0.4, height: 2.45, depth: 0.4 });
    }
    // The rolled-up door on its rail.
    addHitBox(doorObject, { x: 0, y: 2.14, z: 0, width: ROLL_UP_WIDTH + 0.3, height: 0.3, depth: 0.36 });
  }

  // ── The sign ──────────────────────────────────────────────────────────────

  /** The "+N" picket sign outside the door, for the people of the company who are not drawn. Gone at zero. */
  private setSignCount(wanted: number): void {
    const count = Number.isFinite(wanted) ? Math.max(0, Math.floor(wanted)) : 0;
    if (count === this.shownCount) return;
    this.shownCount = count;
    if (count === 0) {
      if (!this.sign) return;
      this.unregister(this.sign.group);
      this.kit.remove(this.sign);
      this.sign = null;
      return;
    }
    if (!this.sign) {
      const { layout } = this.kit;
      const outside = doorExterior(layout, SIGN_OUT);
      // Beside the doorway rather than in it, turned toward the camera.
      this.sign = this.kit.place(createOverflowSign(), {
        x: outside.x - Math.cos(layout.door.facing) * SIGN_ASIDE,
        z: outside.z + Math.sin(layout.door.facing) * SIGN_ASIDE,
        facing: Math.PI / 4,
      });
      this.sign.setCount(count);
      addHitProxy(this.sign.group);
    }
    this.sign.setCount(count);
    // Registering again under the same target replaces the entry, which is how the label follows the count.
    this.register(this.sign.group, { kind: "sign" }, { label: signLabel(count), anchorHeight: 1.6 });
  }
}
