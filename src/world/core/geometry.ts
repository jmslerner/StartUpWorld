/** Split from core/palette.ts (M5): shared geometries — the geometry cache, the unit geometries and the one-line mesh helpers. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import * as THREE from "three";
import { mat } from "./materials";

const geometryCache = new Map<string, THREE.BufferGeometry>();

/** Shared geometry by key. `build` runs only on a cache miss. */
export const cachedGeometry = <T extends THREE.BufferGeometry>(key: string, build: () => T): T => {
  const cached = geometryCache.get(key);
  if (cached) return cached as T;
  const geometry = build();
  geometryCache.set(key, geometry);
  return geometry;
};

/** 1 × 1 × 1 box centred on the origin — scale the mesh, not the geometry. */
export const unitBox = (): THREE.BoxGeometry => cachedGeometry("unit:box", () => new THREE.BoxGeometry(1, 1, 1));
/** Radius 0.5, height 1, Y axis, centred. */
export const unitCylinder = (segments = 16): THREE.CylinderGeometry =>
  cachedGeometry(`unit:cyl:${segments}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, segments));
/** Base radius 0.5, height 1, Y axis, centred. */
export const unitCone = (segments = 16): THREE.ConeGeometry => cachedGeometry(`unit:cone:${segments}`, () => new THREE.ConeGeometry(0.5, 1, segments));
/** Radius 0.5 (diameter 1), centred. */
export const unitSphere = (segments = 14): THREE.SphereGeometry =>
  cachedGeometry(`unit:sphere:${segments}`, () => new THREE.SphereGeometry(0.5, segments, Math.max(6, Math.round(segments * 0.65))));
/** 1 × 1 plane in XY facing +Z, centred, with UVs (labels, screens). */
export const unitPlane = (): THREE.PlaneGeometry => cachedGeometry("unit:plane", () => new THREE.PlaneGeometry(1, 1));
/** Radius 0.5 disc in XY facing +Z (rotate −90° about X to lay it on the floor). */
export const unitDisc = (segments = 24): THREE.CircleGeometry => cachedGeometry(`unit:disc:${segments}`, () => new THREE.CircleGeometry(0.5, segments));

// ── One-line mesh helpers ────────────────────────────────────────────────────
// Positions are (x, yBase, z): x/z are the centre, yBase is the BOTTOM of the
// part, because furniture is built from the floor up.

type MaterialOrColor = THREE.Material | number;
const resolveMaterial = (material: MaterialOrColor): THREE.Material => (typeof material === "number" ? mat(material) : material);

/** Set the shadow flags and hand the object back (for chaining). */
export const shadowed = <T extends THREE.Object3D>(object: T, cast = true, receive = true): T => {
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
};

export const boxMesh = (w: number, h: number, d: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitBox(), resolveMaterial(material));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const cylinderMesh = (radius: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 16): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitCylinder(segments), resolveMaterial(material));
  mesh.scale.set(radius * 2, h, radius * 2);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const coneMesh = (radius: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 16): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitCone(segments), resolveMaterial(material));
  mesh.scale.set(radius * 2, h, radius * 2);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh);
};

export const sphereMesh = (radius: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0, segments = 14): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitSphere(segments), resolveMaterial(material));
  mesh.scale.setScalar(radius * 2);
  mesh.position.set(x, yBase + radius, z);
  return shadowed(mesh);
};

/** Upright plane facing +Z. Does not cast shadows (it is a label / screen / glow). */
export const planeMesh = (w: number, h: number, material: MaterialOrColor, x = 0, yBase = 0, z = 0): THREE.Mesh => {
  const mesh = new THREE.Mesh(unitPlane(), resolveMaterial(material));
  mesh.scale.set(w, h, 1);
  mesh.position.set(x, yBase + h / 2, z);
  return shadowed(mesh, false, false);
};

/** Internal (M5): used by sharedResources.disposeSharedResources. */
export const disposeGeometryCache = (): void => {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
};

/** Internal (M5): used by sharedResources.sharedResourceStats. */
export const geometryCacheSize = (): number => geometryCache.size;
