import * as THREE from "three";

/**
 * A rounded rectangle on the ground under an object: where the highlight ring
 * is drawn. Positions are world space; `yaw` turns the rectangle with the object.
 */
export interface Footprint {
  x: number;
  y: number;
  z: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  radius: number;
}

export const createFootprint = (): Footprint => ({ x: 0, y: 0, z: 0, halfX: 0.4, halfZ: 0.4, yaw: 0, radius: 0.4 });

/** Tiny or wafer-thin props (a phone, a wall calendar) still get a ring you can see. */
const MIN_HALF_EXTENT = 0.28;
/** Breathing room between the object and its ring. */
const PADDING = 0.14;
/** Rings sit just above the floor so they neither z-fight with it nor sink under rugs. */
const GROUND_LIFT = 0.035;
/**
 * Objects whose lowest point is higher than this are wall-mounted or hovering:
 * their ring goes on the floor beneath them instead of floating in mid-air.
 * Anything lower is standing on a platform or pad and keeps its ring there.
 */
const RAISED_LIMIT = 0.6;
/** Footprints this close to square read better as a circle than as a rounded box. */
const ROUND_ASPECT = 1.35;
const BOX_CORNER_RADIUS = 0.3;

const inverseRoot = new THREE.Matrix4();
const relative = new THREE.Matrix4();
const box = new THREE.Box3();
const point = new THREE.Vector3();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();

const accumulate = (node: THREE.Object3D, out: THREE.Box3): void => {
  // Hidden branches (including invisible click proxies) should not inflate the ring.
  if (!node.visible) return;
  const geometry = (node as Partial<THREE.Mesh>).geometry;
  if (geometry?.isBufferGeometry) {
    if (geometry.boundingBox === null) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds && !bounds.isEmpty()) {
      relative.multiplyMatrices(inverseRoot, node.matrixWorld);
      out.union(box.copy(bounds).applyMatrix4(relative));
    }
  }
  for (const child of node.children) accumulate(child, out);
};

/**
 * Bounding box of everything visible under `object`, measured in the object's
 * own frame (so it stays tight when the object is rotated, and stays valid
 * while the object merely moves). Returns false when there is nothing to measure.
 */
export const computeLocalBounds = (object: THREE.Object3D, out: THREE.Box3): boolean => {
  object.updateWorldMatrix(true, true);
  inverseRoot.copy(object.matrixWorld).invert();
  out.makeEmpty();
  accumulate(object, out);
  return !out.isEmpty();
};

/**
 * Place a footprint under `object` from its cached local bounds. Cheap enough
 * to call every frame for the one or two highlighted objects, which is what
 * lets the ring follow a walking person without re-measuring their meshes.
 */
export const footprintFromBounds = (object: THREE.Object3D, localBounds: THREE.Box3 | null, out: Footprint): Footprint => {
  object.updateWorldMatrix(true, false);
  object.matrixWorld.decompose(position, quaternion, scale);
  out.yaw = euler.setFromQuaternion(quaternion, "YXZ").y;

  let halfX = 0;
  let halfZ = 0;
  if (localBounds && !localBounds.isEmpty()) {
    point.set((localBounds.min.x + localBounds.max.x) / 2, localBounds.min.y, (localBounds.min.z + localBounds.max.z) / 2);
    point.applyMatrix4(object.matrixWorld);
    halfX = ((localBounds.max.x - localBounds.min.x) / 2) * Math.abs(scale.x);
    halfZ = ((localBounds.max.z - localBounds.min.z) / 2) * Math.abs(scale.z);
  } else {
    point.copy(position);
  }

  out.x = point.x;
  out.z = point.z;
  out.y = (point.y > RAISED_LIMIT ? 0 : Math.max(point.y, 0)) + GROUND_LIFT;
  out.halfX = Math.max(halfX, MIN_HALF_EXTENT) + PADDING;
  out.halfZ = Math.max(halfZ, MIN_HALF_EXTENT) + PADDING;
  const shorter = Math.min(out.halfX, out.halfZ);
  const longer = Math.max(out.halfX, out.halfZ);
  out.radius = longer / shorter < ROUND_ASPECT ? shorter : Math.min(shorter, BOX_CORNER_RADIUS);
  return out;
};
