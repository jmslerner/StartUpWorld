/**
 * Every desk in the office, its chair, and who is (not) sitting at it.
 *
 * Built once per office. After that two things change: who sits where, and which team a desk belongs to. A desk
 * that gains an occupant lights up and stops being something to tap (the person is); a desk that loses one goes
 * dark and can be tapped as a free desk. A desk wears its team's colour, on its trim and on its chair, and shows
 * what that team works on; a desk no team has is neutral. Which team a desk belongs to, and who sits at it, is the
 * seating plan's to say (ctx.seating). Without one, every desk is free and neutral.
 *
 * Chairs follow the people using them (ctx.signals.chairsOut): rolled back while
 * somebody gets up or sits down or is away, under them while they sit, and tucked
 * in under the desk when nobody is using the chair at all.
 */
import * as THREE from "three";
import { C, ROLE_COLORS } from "../core/palette";
import { addHitProxy } from "../interaction/hitProxy";
import type { InteractableOptions, InteractableTarget, Placement, SeatingApi, Team, WorldSignals } from "../types";
import { DESK_OFFSET } from "./layouts";
import { createChair, createDesk, deskStyleFor, SCREEN_FOR_NOBODY, SCREEN_FOR_TEAM } from "./props";
import type { DeskHandle, PropHandle } from "./props";
import type { StageKit } from "./StageKit";

/** What a free desk is called when it is pointed at. */
export const FREE_DESK_LABEL = "Free desk";

/** The trim and chair colour of a desk no team has. */
export const NEUTRAL_DESK_ACCENT = C.grey;

/** How far a chair rolls back (away from the desk) to let somebody in or out. */
export const CHAIR_PULL = 0.5;
/** How far an unused chair is pushed in under its desk. */
export const CHAIR_TUCK = 0.16;
/** Chairs glide to where they should be at this rate (1/s). */
const CHAIR_EASE = 16;
/** A chair this close to where it should be has arrived. */
const CHAIR_ARRIVED = 1e-4;

const NOBODY: ReadonlySet<string> = new Set<string>();

/**
 * Chairs cast no shadow: they stand under a desk or a person whose
 * shadow already covers theirs, and a full floor has fifty of them — one
 * shadow-pass draw each that nobody would miss.
 */
const noShadows = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    child.castShadow = false;
  });
};

/** The colour of a team's desks; neutral for a desk no team has. */
export const deskAccentFor = (team: Team | null): number => (team === null ? NEUTRAL_DESK_ACCENT : ROLE_COLORS[team]);

interface DeskSlot {
  /** Index into layout.deskSeats, and the WorldSignals.chairsOut key. */
  index: number;
  /** Desk + chair, positioned at the seat and facing with it. */
  group: THREE.Group;
  desk: DeskHandle;
  chair: PropHandle;
  /** The team whose area this desk is in. */
  team: Team | null;
  /** Who the seating plan puts here. */
  seatedId: string | null;
  /** Who is shown working here (null while they are away, even though they still hold the desk). */
  occupantId: string | null;
  registered: boolean;
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
  private vacated: ReadonlySet<string> = NOBODY;
  /** The next chair update jumps straight to the targets (a fresh build). */
  private snapChairs = true;
  private chairsMoving = false;

  /** `seating` says which team each desk belongs to as it is built; null builds every desk neutral. */
  constructor(kit: StageKit, registrar: Registrar, seating: SeatingApi | null) {
    this.kit = kit;
    this.registrar = registrar;
    kit.layout.deskSeats.forEach((seat, index) => this.slots.push(this.buildSlot(index, seat, seating?.teamOfDesk(index) ?? null)));
  }

  /** Desk indices currently offered as free desks, lowest first (for tests and debugging). */
  registeredSlots(): number[] {
    return this.slots.filter((slot) => slot.registered).map((slot) => slot.index);
  }

  /**
   * Bring the desks in line with who sits where and which team has which desk.
   * `signals.vacated` lists people who hold a desk but are not in the office (someone away raising money):
   * their desks go dark, though they stay taken. `animate` is false when the office must simply be in the
   * new state (a first build, a reset).
   */
  sync(seating: SeatingApi | null, signals?: WorldSignals, animate = true): void {
    this.vacated = signals?.vacated ?? NOBODY;
    if (!animate) this.snapChairs = true;
    for (const slot of this.slots) {
      this.restyle(slot, seating?.teamOfDesk(slot.index) ?? null);
      slot.seatedId = seating?.deskOccupant(slot.index) ?? null;
      this.setRegistered(slot, slot.seatedId === null);
    }
    this.refreshOccupants();
  }

  /** Per frame: follow who is away (signals.vacated) and roll the chairs to where they should be. */
  update(dt: number, signals?: WorldSignals): void {
    const vacated = signals?.vacated ?? NOBODY;
    if (vacated !== this.vacated) {
      this.vacated = vacated;
      this.refreshOccupants();
    }
    this.rollChairs(dt, signals?.chairsOut);
  }

  /** True while a chair is still rolling to where it should be. */
  busy(): boolean {
    return this.snapChairs || this.chairsMoving;
  }

  /** Where a desk's chair is in its own desk's frame (+ = toward the desk). For tests. */
  chairOffset(index: number): number {
    return this.slots[index]?.chair.group.position.z ?? 0;
  }

  /** Is this desk shown in use (screen on)? For tests. */
  isLit(index: number): boolean {
    return this.slots[index] !== undefined && this.slots[index].occupantId !== null;
  }

  /** The team whose colour this desk wears; null for a neutral desk. For tests. */
  teamOf(index: number): Team | null {
    return this.slots[index]?.team ?? null;
  }

  /** The desk and chair groups of one seat. For tests. */
  objectOf(index: number): THREE.Group | null {
    return this.slots[index]?.group ?? null;
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
    let moving = false;
    for (const slot of this.slots) {
      const out = chairsOut ? chairsOut.get(slot.index) : slot.occupantId !== null ? 0 : undefined;
      const target = out === undefined ? CHAIR_TUCK : -CHAIR_PULL * out;
      const position = slot.chair.group.position;
      const gap = target - position.z;
      if (Math.abs(gap) < CHAIR_ARRIVED) continue;
      position.z = Math.abs(gap) < 1e-3 ? target : position.z + gap * k;
      if (Math.abs(target - position.z) >= CHAIR_ARRIVED) moving = true;
    }
    this.chairsMoving = moving;
  }

  private buildSlot(index: number, seat: Placement, team: Team | null): DeskSlot {
    const group = new THREE.Group();
    group.name = `desk:${index}`;
    const slot: DeskSlot = {
      index,
      group,
      // Desks start vacant; the first sync seats whoever belongs there.
      desk: this.createDeskFor(index, team, false),
      chair: this.createChairFor(team),
      team,
      seatedId: null,
      occupantId: null,
      registered: false,
    };
    this.attach(slot);
    this.kit.placeGroup(group, seat);
    // One click area over desk and chair together, so the gaps between legs and
    // between the two pieces of furniture are part of the "free desk" target.
    addHitProxy(group, { pad: 0.04, minHeight: 0.9 });
    return slot;
  }

  /**
   * The desk passed to another team (or to none): its colour is baked into its shape, so the desk and its chair
   * are swapped for ones in the new colour. The chair stays where it was rolled to.
   */
  private restyle(slot: DeskSlot, team: Team | null): void {
    if (team === slot.team) return;
    const chairAt = slot.chair.group.position.z;
    this.kit.props.remove(slot.desk);
    this.kit.props.remove(slot.chair);
    slot.team = team;
    slot.desk = this.createDeskFor(slot.index, team, slot.occupantId !== null);
    slot.chair = this.createChairFor(team);
    this.attach(slot);
    slot.chair.group.position.z = chairAt;
  }

  private attach(slot: DeskSlot): void {
    this.kit.props.add(slot.desk, slot.group);
    // In the seat's frame the desk surface is straight ahead.
    slot.desk.group.position.set(0, 0, DESK_OFFSET);
    // The chair stands exactly on the seat: that is where the people system sits somebody down.
    this.kit.props.add(slot.chair, slot.group);
    noShadows(slot.chair.group);
  }

  private createDeskFor(index: number, team: Team | null, occupied: boolean): DeskHandle {
    return createDesk({
      style: deskStyleFor(this.kit.office, this.kit.look),
      accent: deskAccentFor(team),
      // Clutter varies by desk, so a bench is not a row of clones.
      variant: index,
      screen: team === null ? SCREEN_FOR_NOBODY : SCREEN_FOR_TEAM[team],
      occupied,
    });
  }

  private createChairFor(team: Team | null): PropHandle {
    return createChair({ style: deskStyleFor(this.kit.office, this.kit.look), accent: deskAccentFor(team) });
  }

  private setRegistered(slot: DeskSlot, registered: boolean): void {
    if (registered === slot.registered) return;
    slot.registered = registered;
    if (registered) {
      this.registrar.register(slot.group, { kind: "desk", desk: slot.index }, { label: FREE_DESK_LABEL, anchorHeight: 1.25 });
    } else {
      this.registrar.unregister(slot.group);
    }
  }
}
