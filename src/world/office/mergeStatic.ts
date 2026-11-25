/**
 * M1: merge static geometry into one mesh per (material, shadow-flags) pair.
 *
 * The office shell (ground, floor, walls, corner post, kerbs) is dozens of
 * baked-model meshes that never move, never glow and are never registered as
 * interactables — but each one costs its own draw call. Their geometries are
 * all ModelBuilder bakes (indexed, position/normal/color), so they merge
 * cleanly per material. The merged meshes are NOT registered with the
 * interaction store, and picking only ever raycasts registered objects, so
 * picking is unaffected; the door is excluded by the caller because it swings.
 *
 * Ownership: merging clones the source geometries, so the sources stay owned
 * by their prop handles exactly as before. The merged geometries created here
 * are the caller's to dispose (see MergedStatic.dispose), exactly once, at
 * stage teardown.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface MergedStatic {
  /** The merged meshes, already added to the parent the children came from. */
  readonly group: THREE.Group;
  /** Free the merged geometries (the only GPU resources merging creates). */
  dispose(): void;
}

interface Bucket {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

/**
 * Replace every mesh under `parent`'s direct children — except the subtrees in
 * `keep` — with one merged mesh per material. Returns null when there was
 * nothing to merge. If a bucket cannot be merged (mixed attributes), its
 * clones are kept as individual meshes instead: correct, just not merged.
 */
export const mergeStaticChildren = (parent: THREE.Group, keep: ReadonlySet<THREE.Object3D>): MergedStatic | null => {
  const buckets = new Map<string, Bucket>();
  const consumed: THREE.Object3D[] = [];

  const walk = (node: THREE.Object3D, base: THREE.Matrix4): void => {
    node.updateMatrix();
    const world = new THREE.Matrix4().multiplyMatrices(base, node.matrix);
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !Array.isArray(mesh.material)) {
      const material = mesh.material as THREE.Material;
      const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, geometries: [] };
        buckets.set(key, bucket);
      }
      bucket.geometries.push(mesh.geometry.clone().applyMatrix4(world));
    }
    for (const child of node.children) walk(child, world);
  };

  for (const child of [...parent.children]) {
    if (keep.has(child)) continue;
    walk(child, new THREE.Matrix4());
    consumed.push(child);
  }
  if (buckets.size === 0) return null;

  const group = new THREE.Group();
  group.name = "structure:merged";
  const owned: THREE.BufferGeometry[] = [];
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    if (merged) {
      // The clones' data now lives in `merged`; the clones were never
      // rendered, so disposing them only drops their CPU-side arrays.
      for (const geometry of bucket.geometries) geometry.dispose();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      group.add(mesh);
      owned.push(merged);
    } else {
      for (const geometry of bucket.geometries) {
        const mesh = new THREE.Mesh(geometry, bucket.material);
        mesh.castShadow = bucket.castShadow;
        mesh.receiveShadow = bucket.receiveShadow;
        group.add(mesh);
        owned.push(geometry);
      }
    }
  }
  for (const child of consumed) child.removeFromParent();
  parent.add(group);
  return {
    group,
    dispose(): void {
      for (const geometry of owned) geometry.dispose();
    },
  };
};
