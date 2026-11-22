/**
 * One built office: the building, its furniture, its eight stations, the
 * assets and the markers — for exactly one company phase.
 *
 * OfficeSystem builds a stage when the phase (or the run) changes and throws
 * it away at the next change. In between, `sync` only touches what a new
 * snapshot actually changed: occupancy, the calendar page, the beacon…
 */
import * as THREE from "three";
import type { AssetId, CompanyPhase } from "../../types/game";
import { addHitBox, addHitProxy } from "../interaction/hitProxy";
import { isLossEnding } from "../outcomes";
import type {
  BuildView,
  InteractableOptions,
  InteractableRegistry,
  InteractableTarget,
  OfficeLayout,
  SeatingApi,
  StationKind,
  WorldSignals,
  WorldSnapshot,
} from "../types";
import { AssetSlots } from "./AssetSlots";
import { DeskSlots } from "./DeskSlots";
import type { Registrar } from "./DeskSlots";
import { dressOffice } from "./dressing";
import type { Dressing } from "./dressing";
import { doorExterior, STATION_SIZES, WALL_HEIGHT } from "./layouts";
import {
  createAlarmLight,
  createCoffeeMachine,
  createEventBeacon,
  createOverflowSign,
  createStation,
  EVENT_BEACON_HEIGHT,
} from "./props";
import type { AlarmLightHandle, OverflowSignHandle, PropHandle, StationHandle, StationHandles, WallBuild } from "./props";
import { buildShell, ROLL_UP_WIDTH } from "./shell";
import type { Shell } from "./shell";
import { StageKit } from "./StageKit";

export const STATION_LABELS: Record<StationKind, string> = {
  ship: "Product wall — ship",
  launch: "Growth corner — launch",
  investors: "Investor line — pitch & raise",
  boardroom: "Board table",
  calendar: "Calendar — end week",
  coffee: "Coffee machine",
  servers: "Servers",
  pricing: "Pricing board",
};

export const DOOR_LABEL = "Front door — roadmap";
export const BEACON_LABEL = "Event — respond";

/** The alarm starts once the company has this many weeks of cash left, or fewer. */
export const LOW_RUNWAY_WEEKS = 4;

/** Users at which the server rack looks fully loaded (log scale: 10 users is already a flicker). */
const SERVER_FULL_LOAD_USERS = 1_000_000;

/** How long the front door is held open when somebody is announced (a hire, the first day). */
const DOOR_OPEN_SECONDS = 1.5;
/** How long it stays open after the last person has walked through. */
const DOOR_LINGER_SECONDS = 0.8;

/**
 * The alarm light's wall bracket: how far left of the calendar (at the public
 * HQ the stock ticker straddles the calendar, so the lamp goes outside its
 * post), how high, how far off the wall.
 */
const ALARM_GAPS: Record<CompanyPhase, number> = { garage: 0.3, coworking: 0.3, office: 0.3, unicorn: 0.3, public: 0.95 };
const ALARM_HEIGHT = 1.6;
const ALARM_STANDOFF = 0.25;
/** Short beams: the half of their sweep that passes behind the wall must stay hidden by it. */
const ALARM_BEAM_SCALE = 0.4;
/** The prop is desk-toy sized; on a wall across the room it needs to be bigger to be noticed. */
const ALARM_SCALE = 1.4;

/** Where the overflow sign stands relative to the doorway: this far out, this far to the side. */
const OVERFLOW_SIGN_OUT = 1.3;
const OVERFLOW_SIGN_ASIDE = 1.4;

/** No station's click area is smaller than this, however slight the prop. */
const STATION_CLICK_AREA = { minWidth: 0.8, minDepth: 0.6, minHeight: 1.0 } as const;

const _box = new THREE.Box3();

const TYPE_LABELS: Record<BuildView["type"], string> = {
  feature: "Feature",
  growth: "Growth",
  premium: "Premium",
  plumbing: "Plumbing",
  moonshot: "Moonshot",
};

/** The snapshot's builds as the product wall's lanes. */
export const wallBuilds = (snapshot: WorldSnapshot): WallBuild[] =>
  snapshot.builds.map((build) => ({
    name: build.name,
    slug: build.slug,
    label: `${TYPE_LABELS[build.type] ?? build.type} ${build.size.toUpperCase()}`,
    pct: build.pct,
    built: build.built,
    shippable: build.shippable,
    tier: build.tierNow,
    forecast: build.forecastNow,
    dueIn: build.weeksLate > 0 ? -build.weeksLate : Math.max(0, build.dueWeek - snapshot.week),
    crunch: build.crunch,
    crunchWeeks: build.crunchWeeks,
    crew: build.staffIds.length,
    seats: build.seats,
  }));

/** Height of an object's top above the floor, for anchoring its inspector card. */
const topOf = (object: THREE.Object3D): number => {
  object.updateWorldMatrix(true, true);
  _box.setFromObject(object);
  return Number.isFinite(_box.max.y) ? _box.max.y : 1.6;
};

export interface StageOptions {
  layout: OfficeLayout;
  interactables: InteractableRegistry;
  seating: SeatingApi;
  /** The snapshot the office is being built for (company name on the sign, owned upgrades…). */
  snapshot: WorldSnapshot;
  /** What the people system publishes (who has left, where the chairs are, who is in the doorway). */
  signals?: WorldSignals;
}

export class OfficeStage implements Registrar {
  readonly kit: StageKit;
  readonly stations: StationHandles;
  readonly desks: DeskSlots;
  readonly assets: AssetSlots;

  private readonly interactables: InteractableRegistry;
  private readonly seating: SeatingApi;
  private readonly signals: WorldSignals | undefined;
  private readonly registered = new Set<THREE.Object3D>();
  private readonly shell: Shell;
  private readonly dressing: Dressing;
  private beacon: PropHandle | null = null;
  private alarm: AlarmLightHandle | null = null;
  private overflowSign: OverflowSignHandle | null = null;
  private upgraded: boolean;
  private companyName: string;
  private overflowCount = 0;
  private doorOpenFor = 0;

  constructor(options: StageOptions) {
    const { layout, snapshot } = options;
    this.interactables = options.interactables;
    this.seating = options.seating;
    this.signals = options.signals;
    this.kit = new StageKit(layout);
    this.upgraded = snapshot.ownedAssets.includes("office-upgrade");
    this.companyName = snapshot.companyName;

    this.shell = buildShell(this.kit);
    this.register(this.shell.doorObject, { kind: "door" }, { label: DOOR_LABEL, anchorHeight: this.shell.doorHeight });
    this.addDoorClickArea();

    this.desks = new DeskSlots(this.kit, this, this.upgraded);
    this.stations = this.buildStations();
    this.dressing = dressOffice(this.kit, snapshot.companyName);
    this.assets = new AssetSlots(this.kit, this);
  }

  get phase(): CompanyPhase {
    return this.kit.phase;
  }

  get root(): THREE.Group {
    return this.kit.root;
  }

  /** Is the low-runway alarm light up right now? */
  get alarmActive(): boolean {
    return this.alarm !== null;
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

  /** Make nothing in this office clickable any more (it is on its way out). */
  unregisterAll(): void {
    for (const object of this.registered) this.interactables.unregister(object);
    this.registered.clear();
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Bring the office in line with `snapshot`. `animate` is false when the
   * scene must simply *be* in the new state (first build, loaded save).
   * Returns the assets whose prop was (re)built by this call.
   */
  sync(snapshot: WorldSnapshot, animate: boolean): AssetId[] {
    // Before the company exists, and after it has ended, nothing should beg for attention.
    const live = snapshot.setupComplete && snapshot.gameOver === null;

    this.syncUpgrade(snapshot);
    this.desks.sync(snapshot, this.seating, live, this.signals, animate);
    this.syncStations(snapshot, live, animate);
    this.syncMarkers(snapshot, live);
    if (snapshot.companyName !== this.companyName) {
      this.companyName = snapshot.companyName;
      this.dressing.setCompanyName(snapshot.companyName);
    }
    // Nothing is for sale any more once the run is over.
    return this.assets.sync(snapshot, snapshot.gameOver === null);
  }

  /** The pricing model changed: the board lights up over the new one. */
  flashPricing(): void {
    this.stations.pricing.flash();
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

  setGlow(amount: number): void {
    this.kit.props.setGlow(amount);
  }

  dispose(): void {
    this.unregisterAll();
    // M1: free the merged shell geometry (the kit's prop disposal below does
    // not own it — the merge created it).
    this.shell.merged?.dispose();
    this.kit.dispose();
    this.beacon = null;
    this.alarm = null;
    this.overflowSign = null;
  }

  // ── Stations ──────────────────────────────────────────────────────────────

  private buildStations(): StationHandles {
    const { kit } = this;
    const add = <K extends StationKind>(kind: K): StationHandles[K] => {
      const handle =
        kind === "coffee"
          ? (createCoffeeMachine(kit.phase, { upgraded: this.upgraded }) as StationHandles[K])
          : createStation(kind, kit.phase);
      this.addStation(kind, handle);
      return handle;
    };
    return {
      ship: add("ship"),
      launch: add("launch"),
      investors: add("investors"),
      boardroom: add("boardroom"),
      calendar: add("calendar"),
      coffee: add("coffee"),
      servers: add("servers"),
      pricing: add("pricing"),
    };
  }

  private addStation(kind: StationKind, handle: StationHandle): void {
    this.kit.place(handle, this.kit.layout.stations[kind]);
    this.register(
      handle.group,
      { kind: "station", station: kind },
      { label: STATION_LABELS[kind], anchorHeight: Math.min(topOf(handle.group) + 0.1, WALL_HEIGHT) }
    );
    // Some stations are slight things (a phone on a stool, a board seen nearly edge-on):
    // every one of them gets a click area the size of the prop, and never a tiny one.
    addHitProxy(handle.group, STATION_CLICK_AREA);
  }

  /**
   * The doorway's click area. A framed door is simply wrapped; the garage's roll-up
   * door is an open frame, so only its posts and the rail with the sign are made
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
    // The rolled-up door on its rail, and the "> phases" sign hanging from the middle of it.
    addHitBox(doorObject, { x: 0, y: 2.14, z: 0, width: ROLL_UP_WIDTH + 0.3, height: 0.3, depth: 0.36 });
    addHitBox(doorObject, { x: 0, y: 1.72, z: 0, width: 1.1, height: 0.45, depth: 0.3 });
  }

  /** The office-upgrade asset changes the desks and swaps the coffee machine for the espresso one. */
  private syncUpgrade(snapshot: WorldSnapshot): void {
    const upgraded = snapshot.ownedAssets.includes("office-upgrade");
    if (upgraded === this.upgraded) return;
    this.upgraded = upgraded;
    this.desks.setUpgraded(upgraded);
    this.unregister(this.stations.coffee.group);
    this.kit.remove(this.stations.coffee);
    const coffee = createCoffeeMachine(this.kit.phase, { upgraded });
    this.stations.coffee = coffee;
    this.addStation("coffee", coffee);
  }

  private syncStations(snapshot: WorldSnapshot, live: boolean, animate: boolean): void {
    const { stations } = this;
    stations.calendar.setWeek(snapshot.week, animate);
    stations.ship.setNoteCount(Math.round((snapshot.reputation / 100) * stations.ship.maxNotes));
    stations.ship.setBuilds(wallBuilds(snapshot), snapshot.product.slots);
    const load = Math.log10(Math.max(1, snapshot.users)) / Math.log10(SERVER_FULL_LOAD_USERS);
    stations.servers.setLoad(Math.min(1, Math.max(0.05, load)));
    stations.investors.ring(live && snapshot.pendingEventTitle !== null);
    stations.pricing.setModel(snapshot.pricingModel);
  }

  // ── Markers ───────────────────────────────────────────────────────────────

  private syncMarkers(snapshot: WorldSnapshot, live: boolean): void {
    this.setBeacon(live && snapshot.pendingEventTitle !== null);
    this.setAlarm(live && snapshot.runwayWeeks <= LOW_RUNWAY_WEEKS);
    // After a lost run the people the office had no room for have gone home too.
    this.setOverflowCount(isLossEnding(snapshot.gameOver) ? 0 : this.seating.hiddenCount());
  }

  /** The "!" over the investor line: a pending event is a call the founder has to take. */
  private setBeacon(on: boolean): void {
    if (on === (this.beacon !== null)) return;
    if (!on && this.beacon) {
      this.unregister(this.beacon.group);
      this.kit.remove(this.beacon);
      this.beacon = null;
      return;
    }
    const stand = this.kit.layout.stationStandSpots.investors;
    const beacon = this.kit.place(createEventBeacon(), { x: stand.x, z: stand.z });
    this.beacon = beacon;
    this.register(beacon.group, { kind: "event-beacon" }, { label: BEACON_LABEL, anchorHeight: EVENT_BEACON_HEIGHT });
    // A column around the pin and its shaft; the rings on the floor stay out of it so
    // the station behind the beacon can still be clicked.
    addHitBox(beacon.group, { x: 0, y: 0, z: 0, width: 0.9, height: EVENT_BEACON_HEIGHT, depth: 0.9 });
  }

  /** The red light on the back wall beside the calendar: weeks are what is running out. */
  private setAlarm(on: boolean): void {
    if (on === (this.alarm !== null)) return;
    if (!on && this.alarm) {
      this.kit.remove(this.alarm);
      this.alarm = null;
      return;
    }
    const { layout, phase } = this.kit;
    const calendar = layout.stations.calendar;
    // On a bracket to the calendar's left, in the gap the floor plans leave before the product wall.
    this.alarm = this.kit.place(createAlarmLight({ pool: false, bracket: true, beamScale: ALARM_BEAM_SCALE }), {
      x: calendar.x - STATION_SIZES[phase].calendar.width / 2 - ALARM_GAPS[phase],
      y: ALARM_HEIGHT,
      z: layout.floor.minZ + ALARM_STANDOFF,
    });
    this.alarm.group.scale.setScalar(ALARM_SCALE);
  }

  /** "+N" picket sign outside the door for the people the office has no room to show. */
  private setOverflowCount(count: number): void {
    if (count === this.overflowCount) return;
    this.overflowCount = count;
    if (count <= 0) {
      if (!this.overflowSign) return;
      this.unregister(this.overflowSign.group);
      this.kit.remove(this.overflowSign);
      this.overflowSign = null;
      return;
    }
    if (!this.overflowSign) {
      const { layout } = this.kit;
      const outside = doorExterior(layout, OVERFLOW_SIGN_OUT);
      // Beside the doorway rather than in it, turned toward the camera.
      this.overflowSign = this.kit.place(createOverflowSign(), {
        x: outside.x - Math.cos(layout.door.facing) * OVERFLOW_SIGN_ASIDE,
        z: outside.z + Math.sin(layout.door.facing) * OVERFLOW_SIGN_ASIDE,
        facing: Math.PI / 4,
      });
      this.overflowSign.setCount(count);
      addHitProxy(this.overflowSign.group);
    }
    this.overflowSign.setCount(count);
    // Registering again under the same target replaces the entry, which is how the label follows the count.
    this.register(
      this.overflowSign.group,
      { kind: "overflow-sign" },
      { label: `+${count} more ${count === 1 ? "person" : "people"}`, anchorHeight: 1.6 }
    );
  }
}
