/**
 * Bookkeeping for the props of one built office: which ones animate, which
 * ones glow at dusk, and how to free them all again.
 *
 * Most of an office is static, so the per-frame work is kept to the handles
 * that actually have something to do.
 */
import type * as THREE from "three";
import type { PropHandle } from "./props";

type Ticking = PropHandle & Required<Pick<PropHandle, "update">>;
type Glowing = PropHandle & Required<Pick<PropHandle, "setGlow">>;

const hasUpdate = (handle: PropHandle): handle is Ticking => handle.update !== undefined;
const hasGlow = (handle: PropHandle): handle is Glowing => handle.setGlow !== undefined;

const removeFrom = <T>(list: T[], item: T): void => {
  const index = list.indexOf(item);
  if (index < 0) return;
  // Order is irrelevant here, so fill the hole with the last entry.
  list[index] = list[list.length - 1];
  list.pop();
};

export class PropSet {
  private readonly all = new Set<PropHandle>();
  private readonly ticking: Ticking[] = [];
  private readonly glowing: Glowing[] = [];
  private glow = 0;

  get size(): number {
    return this.all.size;
  }

  /** Take ownership of `handle` and attach it to `parent`. */
  add<T extends PropHandle>(handle: T, parent: THREE.Object3D): T {
    parent.add(handle.group);
    this.all.add(handle);
    if (hasUpdate(handle)) this.ticking.push(handle);
    if (hasGlow(handle)) {
      this.glowing.push(handle);
      // A prop that arrives at dusk must not sit dark until the light next changes.
      handle.setGlow(this.glow);
    }
    return handle;
  }

  /** Detach and free one prop. Safe to call for a handle that is not in the set. */
  remove(handle: PropHandle): void {
    if (!this.all.delete(handle)) return;
    if (hasUpdate(handle)) removeFrom(this.ticking, handle);
    if (hasGlow(handle)) removeFrom(this.glowing, handle);
    handle.dispose();
  }

  update(dt: number, elapsed: number): void {
    const { ticking } = this;
    for (let i = 0; i < ticking.length; i += 1) {
      const handle = ticking[i];
      // Hidden props (a parked vacant marker, the overflow sign at zero) need no animation.
      if (handle.group.visible) handle.update(dt, elapsed);
    }
  }

  /** 0 = daylight, 1 = full dusk glow, for every prop that has lights or screens. */
  setGlow(amount: number): void {
    this.glow = amount;
    const { glowing } = this;
    for (let i = 0; i < glowing.length; i += 1) glowing[i].setGlow(amount);
  }

  dispose(): void {
    for (const handle of this.all) handle.dispose();
    this.all.clear();
    this.ticking.length = 0;
    this.glowing.length = 0;
  }
}
