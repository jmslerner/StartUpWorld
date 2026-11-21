/**
 * Every desk in the office, its chair, and who is (not) sitting at it.
 *
 * Built once per office; after that only occupancy changes: a desk that gains
 * an occupant lights up and stops being clickable, a desk that loses one goes
 * dark and offers itself as "Empty desk — hire". A handful of floating "+"
 * markers point out the free desks nearest the door.
 *
 * Chairs follow the people using them (ctx.signals.chairsOut): rolled back while
 * somebody gets up or sits down or is away, under them while they sit, and tucked
 * in under the desk when nobody is using the chair at all.
 */
import * as THREE from "three";
import type { CompanyPhase } from "../../types/game";
import { addHitProxy } from "../interaction/hitProxy";
import { COFOUNDER_CHAIR, FOUNDER_CHAIR } from "../people/approach";
import type {
  InteractableOptions,
  InteractableTarget,
  Placement,
  SeatingApi,
  WorldSignals,
  WorldSnapshot,
} from "../types";
import { PHASE_THEMES } from "../core/palette";
import { DESK_OFFSET } from "./layouts";
import {
  createChair,
  createDesk,
  createOverflowSpot,
  createVacantMarker,
  DESK_STYLE_FOR_PHASE,
  SCREEN_FOR_ROLE,
} from "./props";
import type { DeskHandle, DeskStyle, OverflowSpotHandle, PropHandle, ScreenKind } from "./props";
import type { StageKit } from "./StageKit";

/** How many "+" markers may float at once; more than this turns a big empty floor into noise. */
export const MAX_VACANT_MARKERS = 6;

export const EMPTY_DESK_LABEL = "Empty desk — hire";

/** How far a chair rolls back (away from the desk) to let somebody in or out. */
export const CHAIR_PULL = 0.5;
/** How far an unused chair is pushed in under its desk. */
export const CHAIR_TUCK = 0.16;
/** Chairs glide to where they should be at this rate (1/s). */
const CHAIR_EASE = 16;

const NOBODY: ReadonlySet<string> = new Set<string>();

/**
 * Chairs and beanbags cast no shadow: they stand under a desk or a person whose
 * shadow already covers theirs, and a full floor has a hundred of them — one
 * shadow-pass draw each that nobody would miss.
 */
const noShadows = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    child.castShadow = false;
  });
};

/** The founders sit a notch above the floor's standard issue once there is a floor to speak of. */
const FOUNDER_DESK_STYLE: Record<CompanyPhase, DeskStyle> = {
  garage: "garage",
  coworking: "standard",
  office: "premium",
  unicorn: "executive",
  public: "executive",
};

type Owner = "founder" | "cofounder" | "desk";

interface DeskSlot {
  owner: Owner;
  /** Index into layout.deskSeats; −1 for the founders. */
  slotIndex: number;
  /** Desk + chair (+ marker), positioned at the seat and facing with it. */
  group: THREE.Group;
  desk: DeskHandle;
  chair: PropHandle;
  /** Who the seating plan puts here. */
  seatedId: string | null;
  /** Who is shown working here (null once they have left, even if they still hold the desk). */
  occupantId: string | null;
  /** WorldSignals.chairsOut key. */
  chairKey: number;
  registered: boolean;
  screen: ScreenKind;
}

/** What DeskSlots needs from the interaction layer (OfficeStage tracks registrations for teardown). */
export interface Registrar {
  register(object: THREE.Object3D, target: InteractableTarget, options: InteractableOptions): void;
  unregister(object: THREE.Object3D): void;
}

export class DeskSlots {
  private readonly kit: StageKit;
  private readonly registrar: Registrar;
  private readonly slots: DeskSlot[] = [];
  /** Employee desk slots, nearest the door first: the order markers are handed out in. */
  private readonly byDoorDistance: DeskSlot[] = [];
  private readonly markers: PropHandle[] = [];
  private readonly cushions = new Map<number, OverflowSpotHandle>();
  private upgraded: boolean;
  private seating: SeatingApi | null = null;
  private vacated: ReadonlySet<string> = NOBODY;
  /** The next chair update jumps straight to the targets (a fresh build or a loaded game). */
  private snapChairs = true;

  constructor(kit: StageKit, registrar: Registrar, upgraded: boolean) {
    this.kit = kit;
    this.registrar = registrar;
    this.upgraded = upgraded;
    const { layout } = kit;
    this.slots.push(this.buildSlot("founder", -1, layout.founderSeat));
    this.slots.push(this.buildSlot("cofounder", -1, layout.cofounderSeat));
    layout.deskSeats.forEach((seat, slotIndex) => this.slots.push(this.buildSlot("desk", slotIndex, seat)));

    const { door } = layout;
    this.byDoorDistance = this.slots
      .filter((slot) => slot.owner === "desk")
      .sort((a, b) => {
        const seatA = layout.deskSeats[a.slotIndex];
        const seatB = layout.deskSeats[b.slotIndex];
        return Math.hypot(seatA.x - door.x, seatA.z - door.z) - Math.hypot(seatB.x - door.x, seatB.z - door.z);
      });
  }

  /** Slot indices currently offered as empty desks (for tests and debugging). */
  registeredSlots(): number[] {
    return this.slots.filter((slot) => slot.registered).map((slot) => slot.slotIndex);
  }

  /** Number of beanbags out for people without a desk. */
  cushionCount(): number {
    return this.cushions.size;
  }

  /** Number of "+" markers showing right now. */
  visibleMarkers(): number {
    return this.markers.filter((marker) => marker.group.visible).length;
  }

  /**
   * Bring desks, markers and cushions in line with who sits where.
   * `showMarkers` is false while the office should stay quiet (setup, game over).
   * `signals.vacated` lists people who hold a desk but have gone (a lost run's staff):
   * their desks go dark, though they stay "taken" as far as hiring goes. `animate`
   * is false when the office must simply be in the new state (a first build, a loaded game).
   */
  sync(snapshot: WorldSnapshot, seating: SeatingApi, showMarkers: boolean, signals?: WorldSignals, animate = true): void {
    this.seating = seating;
    this.vacated = signals?.vacated ?? NOBODY;
    if (!animate) this.snapChairs = true;
    for (const slot of this.slots) {
      const seatedId = this.occupantOf(slot, seating);
      slot.seatedId = seatedId;
      if (seatedId !== null) this.showScreenFor(slot, seatedId, snapshot);
      this.setRegistered(slot, slot.owner === "desk" && seatedId === null);
    }
    this.refreshOccupants();
    this.syncMarkers(showMarkers);
    this.syncCushions(seating);
  }

  /** Per frame: follow who has left (signals.vacated) and roll the chairs to where they should be. */
  update(dt: number, signals?: WorldSignals): void {
    const vacated = signals?.vacated ?? NOBODY;
    if (vacated !== this.vacated) {
      this.vacated = vacated;
      this.refreshOccupants();
      if (this.seating) this.syncCushions(this.seating);
    }
    this.rollChairs(dt, signals?.chairsOut);
  }

  /** Where each chair is in its own desk's frame (+ = toward the desk). For tests. */
  chairOffset(slotIndex: number, owner: "founder" | "cofounder" | "desk" = "desk"): number {
    const slot = this.slots.find((candidate) => candidate.owner === owner && candidate.slotIndex === (owner === "desk" ? slotIndex : -1));
    return slot ? slot.chair.group.position.z : 0;
  }

  /** Is this desk shown in use (screen on)? For tests. */
  isLit(slotIndex: number): boolean {
    return this.slots.some((slot) => slot.owner === "desk" && slot.slotIndex === slotIndex && slot.occupantId !== null);
  }

  private refreshOccupants(): void {
    for (const slot of this.slots) {
      const occupantId = slot.seatedId !== null && !this.vacated.has(slot.seatedId) ? slot.seatedId : null;
      if (occupantId === slot.occupantId) continue;
      slot.occupantId = occupantId;
      slot.desk.setOccupied(occupantId !== null);
    }
  }

  /**
   * A chair somebody is using sits where they want it (`chairsOut`); one nobody is
   * using is tucked in. Without a people system (no `chairsOut` at all) a chair
   * simply stands under whoever the desk belongs to.
   */
  private rollChairs(dt: number, chairsOut: ReadonlyMap<number, number> | undefined): void {
    const k = this.snapChairs ? 1 : 1 - Math.exp(-dt * CHAIR_EASE);
    this.snapChairs = false;
    for (const slot of this.slots) {
      const out = chairsOut ? chairsOut.get(slot.chairKey) : slot.occupantId !== null ? 0 : undefined;
      const target = out === undefined ? CHAIR_TUCK : -CHAIR_PULL * out;
      const position = slot.chair.group.position;
      const gap = target - position.z;
      if (Math.abs(gap) < 1e-4) continue;
      position.z = Math.abs(gap) < 1e-3 ? target : position.z + gap * k;
    }
  }

  /** The office-upgrade asset arrived (or left): swap every desk for its other variant. */
  setUpgraded(upgraded: boolean): void {
    if (upgraded === this.upgraded) return;
    this.upgraded = upgraded;
    for (const slot of this.slots) {
      const occupied = slot.occupantId !== null;
      this.kit.props.remove(slot.desk);
      slot.desk = this.createDeskFor(slot.owner, slot.slotIndex, occupied, slot.screen);
      this.attachDesk(slot);
    }
  }

  private buildSlot(owner: Owner, slotIndex: number, seat: Placement): DeskSlot {
    const group = new THREE.Group();
    group.name = owner === "desk" ? `desk:${slotIndex}` : `desk:${owner}`;
    const style = this.styleFor(owner);
    const screen: ScreenKind = owner === "desk" ? "code" : SCREEN_FOR_ROLE[owner];
    const slot: DeskSlot = {
      owner,
      slotIndex,
      group,
      // Desks start vacant; the first sync seats whoever belongs there.
      desk: this.createDeskFor(owner, slotIndex, false, screen),
      chair: createChair({ style, accent: this.accentFor(owner, slotIndex) }),
      seatedId: null,
      occupantId: null,
      chairKey: owner === "desk" ? slotIndex : owner === "founder" ? FOUNDER_CHAIR : COFOUNDER_CHAIR,
      registered: false,
      screen,
    };
    this.attachDesk(slot);
    // The chair stands exactly on the seat: that is where the people system sits somebody down.
    this.kit.props.add(slot.chair, group);
    noShadows(slot.chair.group);
    this.kit.placeGroup(group, seat);
    // One click area over desk and chair together, so the gaps between legs and
    // between the two pieces of furniture are part of the "empty desk" target.
    if (owner === "desk") addHitProxy(group, { pad: 0.04, minHeight: 0.9 });
    return slot;
  }

  private attachDesk(slot: DeskSlot): void {
    this.kit.props.add(slot.desk, slot.group);
    // In the seat's frame the desk surface is straight ahead.
    slot.desk.group.position.set(0, 0, DESK_OFFSET);
  }

  private createDeskFor(owner: Owner, slotIndex: number, occupied: boolean, screen: ScreenKind): DeskHandle {
    return createDesk({
      style: this.styleFor(owner),
      upgraded: this.upgraded,
      accent: this.accentFor(owner, slotIndex),
      // Founders get fixed clutter; everyone else varies by slot so a bench is not a row of clones.
      variant: owner === "desk" ? slotIndex : owner === "founder" ? 1 : 2,
      screen,
      occupied,
    });
  }

  private styleFor(owner: Owner): DeskStyle {
    const { phase } = this.kit;
    return owner === "desk" ? DESK_STYLE_FOR_PHASE[phase] : FOUNDER_DESK_STYLE[phase];
  }

  /** Hot desks in the shared loft come in the loft's three colours; everywhere else the style decides. */
  private accentFor(owner: Owner, slotIndex: number): number | undefined {
    if (this.kit.phase !== "coworking" || owner !== "desk") return undefined;
    const { accents } = PHASE_THEMES.coworking;
    // Facing pairs (0/1, 2/3 …) share a colour so the island reads as coloured bays.
    return accents[Math.floor(slotIndex / 2) % accents.length];
  }

  private occupantOf(slot: DeskSlot, seating: SeatingApi): string | null {
    if (slot.owner === "desk") return seating.deskOccupant(slot.slotIndex);
    return seating.seatOf(slot.owner) !== null ? slot.owner : null;
  }

  private showScreenFor(slot: DeskSlot, occupantId: string, snapshot: WorldSnapshot): void {
    if (slot.owner !== "desk") return;
    const person = snapshot.people.find((candidate) => candidate.id === occupantId);
    const screen: ScreenKind = person?.role ? SCREEN_FOR_ROLE[person.role] : "code";
    if (screen === slot.screen) return;
    slot.screen = screen;
    slot.desk.setScreen(screen);
  }

  private setRegistered(slot: DeskSlot, registered: boolean): void {
    if (registered === slot.registered) return;
    slot.registered = registered;
    if (registered) {
      this.registrar.register(
        slot.group,
        { kind: "empty-desk", slotIndex: slot.slotIndex },
        { label: EMPTY_DESK_LABEL, anchorHeight: 1.25 }
      );
    } else {
      this.registrar.unregister(slot.group);
    }
  }

  /** Hand the markers to the free desks nearest the door; park the rest out of sight. */
  private syncMarkers(show: boolean): void {
    let used = 0;
    if (show) {
      for (const slot of this.byDoorDistance) {
        if (used >= MAX_VACANT_MARKERS) break;
        if (slot.seatedId !== null) continue;
        const marker = this.markers[used] ?? this.createMarker();
        if (marker.group.parent !== slot.group) slot.group.add(marker.group);
        marker.group.visible = true;
        used += 1;
      }
    }
    for (let i = used; i < this.markers.length; i += 1) this.markers[i].group.visible = false;
  }

  private createMarker(): PropHandle {
    const marker = createVacantMarker();
    // Over the chair-side edge of the desk: it reads as "this seat", and stays clear of the monitor.
    marker.group.position.set(0, 0, DESK_OFFSET * 0.45);
    this.markers.push(marker);
    // Parented by syncMarkers; the scratch parent only satisfies PropSet.add.
    this.kit.props.add(marker, this.kit.contents);
    return marker;
  }

  /** A beanbag appears under whoever has to sit on the floor, and goes when they get a desk. */
  private syncCushions(seating: SeatingApi): void {
    const { overflowSpots } = this.kit.layout;
    for (let i = 0; i < overflowSpots.length; i += 1) {
      const sitter = seating.overflowOccupant(i);
      // A beanbag goes with its sitter (when they go home, it goes too).
      const occupied = sitter !== null && !this.vacated.has(sitter);
      const cushion = this.cushions.get(i);
      if (occupied && !cushion) {
        const spot = overflowSpots[i];
        const created = this.kit.place(createOverflowSpot({ variant: i }), spot);
        noShadows(created.group);
        // The sitter brings their own laptop.
        created.setOccupied(true);
        this.cushions.set(i, created);
      } else if (!occupied && cushion) {
        this.kit.remove(cushion);
        this.cushions.delete(i);
      }
    }
  }
}
