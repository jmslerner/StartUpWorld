/**
 * The scaffolding one built office hangs on: its scene-graph roots, the props
 * it owns and the order they were placed in (which is the order they pop in
 * when the office is revealed).
 *
 * The builders in shell.ts / dressing.ts / DeskSlots.ts … all work through
 * this, so none of them needs to know about OfficeSystem.
 */
import * as THREE from "three";
import type { CompanyPhase } from "../../types/game";
import type { OfficeLayout } from "../types";
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
  readonly phase: CompanyPhase;
  readonly layout: OfficeLayout;
  /** Everything of this office. */
  readonly root = new THREE.Group();
  /** Ground, floor slab, walls: the part that rises as one piece. */
  readonly structure = new THREE.Group();
  /** Furniture, scenery, markers: everything that pops in piece by piece. */
  readonly contents = new THREE.Group();
  readonly props = new PropSet();
  /** Top-level content objects in build order. */
  readonly entrances: THREE.Object3D[] = [];

  constructor(layout: OfficeLayout) {
    this.phase = layout.phase;
    this.layout = layout;
    this.root.name = `office:${layout.phase}`;
    this.structure.name = "structure";
    this.contents.name = "contents";
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

  /** Add a ready-made group (e.g. a desk with its chair) to the contents. */
  placeGroup(group: THREE.Object3D, spot: Spot): void {
    this.position(group, spot);
    this.contents.add(group);
    this.entrances.push(group);
  }

  /** Free a prop that was placed earlier (asset swaps, cushions coming and going). */
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
