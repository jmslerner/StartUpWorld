/**
 * Invisible click areas.
 *
 * Picking tests real triangles, which is exact but unforgiving: a phone on a
 * stool, a wall calendar seen edge-on or a peg person a dozen pixels wide is a
 * tiny target at the default zoom. A hit proxy is an invisible box around the
 * prop that the picker treats as part of it (see InteractableStore.isHittable),
 * so everything clickable has a comfortable, predictable area.
 *
 * Proxies are never drawn, are ignored by the highlight ring's measurements
 * (they are hidden), and share one geometry and one material that own no GPU
 * resources because nothing ever renders them.
 */
import * as THREE from "three";
import { computeLocalBounds } from "./footprint";

export interface HitBox {
  /** Centre of the box in the object's own frame; `y` is the BOTTOM of the box. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

export interface HitProxyOptions {
  /** Extra room added on every side of the visible bounds. Default 0.06. */
  pad?: number;
  /** The box is grown (about its centre) to at least these sizes. */
  minWidth?: number;
  minHeight?: number;
  minDepth?: number;
}

const DEFAULT_PAD = 0.06;
const DEFAULT_MIN_SIZE = 0.7;
const DEFAULT_MIN_HEIGHT = 0.9;

let sharedGeometry: THREE.BoxGeometry | null = null;
let sharedMaterial: THREE.MeshBasicMaterial | null = null;
const bounds = new THREE.Box3();

/** An invisible, pickable box as a child of `object`. */
export const addHitBox = (object: THREE.Object3D, box: HitBox): THREE.Mesh => {
  // Created lazily (module scope must stay free of work for node tests) and shared by every proxy.
  sharedGeometry ??= new THREE.BoxGeometry(1, 1, 1);
  sharedMaterial ??= new THREE.MeshBasicMaterial();
  const proxy = new THREE.Mesh(sharedGeometry, sharedMaterial);
  proxy.name = "hit-proxy";
  proxy.visible = false;
  proxy.userData.hitProxy = true;
  proxy.position.set(box.x, box.y + box.height / 2, box.z);
  proxy.scale.set(box.width, box.height, box.depth);
  object.add(proxy);
  return proxy;
};

/**
 * Wrap everything currently visible under `object` in one invisible click box,
 * padded and grown to a comfortable minimum size. Call it once the object's
 * visible parts are in place; returns null when there is nothing to wrap.
 *
 * The box never dips below the object's own origin plane when the object stands
 * on the floor, so growing a short prop makes it taller rather than burying it.
 */
export const addHitProxy = (object: THREE.Object3D, options: HitProxyOptions = {}): THREE.Mesh | null => {
  if (!computeLocalBounds(object, bounds)) return null;
  const pad = options.pad ?? DEFAULT_PAD;
  const width = Math.max(bounds.max.x - bounds.min.x + pad * 2, options.minWidth ?? DEFAULT_MIN_SIZE);
  const depth = Math.max(bounds.max.z - bounds.min.z + pad * 2, options.minDepth ?? DEFAULT_MIN_SIZE);
  const height = Math.max(bounds.max.y - bounds.min.y + pad * 2, options.minHeight ?? DEFAULT_MIN_HEIGHT);
  const centreY = (bounds.min.y + bounds.max.y) / 2;
  // Floor-standing things grow upward; things hanging on a wall grow about their middle.
  const standsOnFloor = bounds.min.y < 0.3;
  const bottom = standsOnFloor ? Math.min(bounds.min.y, 0) : centreY - height / 2;
  return addHitBox(object, {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: bottom,
    z: (bounds.min.z + bounds.max.z) / 2,
    width,
    height: standsOnFloor ? Math.max(height, bounds.max.y + pad - bottom) : height,
    depth,
  });
};
