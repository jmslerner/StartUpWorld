/**
 * The scaffolding one built office hangs on: its scene-graph roots, the props
 * it owns and the order they were placed in (which is the order they pop in
 * when the office is revealed).
 *
 * The builders in shell.ts / dressing.ts / DeskSlots.ts … all work through
 * this, so none of them needs to know about OfficeSystem.
 */
import * as THREE from "three";
import type { LookId, OfficeIndex, OfficeLayout } from "../types";
import { mergeStaticChildren } from "./mergeStatic";
import type { MergedStatic } from "./mergeStatic";
import type { PropHandle } from "./props";
import { PropSet } from "./PropSet";

/** Where a prop goes: floor position, yaw, and optionally a height (wall-hung things). */
export interface Spot {
  x: number;
  z: number;
  facing?: number;
  y?: number;
}

export class StageKit {
  /** Which of the five offices this is. */
  readonly office: OfficeIndex;
  /** How it is dressed: the furniture's finish for this size of office. */
  readonly look: LookId;
  readonly layout: OfficeLayout;
  /** Everything of this office. */
  readonly root = new THREE.Group();
  /** Ground, floor slab, walls: the part that rises as one piece. */
  readonly structure = new THREE.Group();
  /** Furniture, scenery, markers: everything that pops in piece by piece. */
  readonly contents = new THREE.Group();
  /**
   * The still things of the contents (no animation, no glow, never pointed at), which `mergeStatics` draws as one
   * mesh per material. It pops in as one piece, at the place of the first still thing.
   */
  readonly statics = new THREE.Group();
  readonly props = new PropSet();
  /** Top-level content objects in build order. */
  readonly entrances: THREE.Object3D[] = [];
  private merged: MergedStatic | null = null;
  private mergedOnce = false;

  constructor(layout: OfficeLayout, look: LookId = "classic") {
    this.office = layout.office;
    this.look = look;
    this.layout = layout;
    this.root.name = `office:${layout.office}`;
    this.structure.name = "structure";
    this.contents.name = "contents";
    this.statics.name = "statics";
    this.root.add(this.structure, this.contents);
  }

  /** Add a prop to the building itself (it appears with the shell, not on its own). */
  build<T extends PropHandle>(handle: T, spot: Spot): T {
    this.position(handle.group, spot);
    return this.props.add(handle, this.structure);
  }

  /** Put a prop into the office as a piece of its contents. */
  place<T extends PropHandle>(handle: T, spot: Spot): T {
    this.position(handle.group, spot);
    this.props.add(handle, this.contents);
    this.entrances.push(handle.group);
    return handle;
  }

  /**
   * Put a prop that never moves, glows or is pointed at into the office. It stays owned by the kit's props (so it is
   * disposed as before) but hangs under `statics`, to be merged with the other still things by `mergeStatics`.
   */
  placeStatic<T extends PropHandle>(handle: T, spot: Spot): T {
    this.position(handle.group, spot);
    this.props.add(handle, this.statics);
    if (this.statics.parent === null) {
      this.contents.add(this.statics);
      this.entrances.push(this.statics);
    }
    return handle;
  }

  /** Draw every still thing placed so far as one mesh per material. Call once, after dressing; later calls do nothing. */
  mergeStatics(): void {
    if (this.mergedOnce) return;
    this.mergedOnce = true;
    this.merged = mergeStaticChildren(this.statics, new Set());
  }

  /** Add a ready-made group (e.g. a desk with its chair) to the contents. */
  placeGroup(group: THREE.Object3D, spot: Spot): void {
    this.position(group, spot);
    this.contents.add(group);
    this.entrances.push(group);
  }

  /** Free a prop that was placed earlier (a desk swapped for one in another team's colour). */
  remove(handle: PropHandle): void {
    this.forget(handle.group);
    this.props.remove(handle);
  }

  /** Stop treating `object` as an entrance (it has been removed from the office). */
  forget(object: THREE.Object3D): void {
    const index = this.entrances.indexOf(object);
    if (index >= 0) this.entrances.splice(index, 1);
  }

  dispose(): void {
    this.merged?.dispose();
    this.merged = null;
    this.props.dispose();
    this.entrances.length = 0;
    this.root.removeFromParent();
    this.root.clear();
  }

  private position(object: THREE.Object3D, spot: Spot): void {
    object.position.set(spot.x, spot.y ?? 0, spot.z);
    object.rotation.y = spot.facing ?? 0;
  }
}
