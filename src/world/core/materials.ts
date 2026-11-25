/** Split from core/palette.ts (M5): shared materials — the material cache and mat / vertexMat / glowMat / glassMat. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import * as THREE from "three";
import { C } from "./colors";

const materialCache = new Map<string, THREE.Material>();

export interface MatOptions {
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  /** Faceted shading. */
  flat?: boolean;
  /** Multiply by the geometry's `color` attribute (baked models). */
  vertexColors?: boolean;
  doubleSided?: boolean;
  depthWrite?: boolean;
  /** Push the surface back in depth so coplanar geometry drawn on top never z-fights. */
  decal?: boolean;
  map?: THREE.Texture | null;
  /** Use `map` as the emissive map too (glowing signs / screens). */
  emissiveMap?: boolean;
}

/**
 * Shared Lambert material. Identical arguments return the same instance, so
 * NEVER mutate the result — clone it when a prop animates its own colour /
 * opacity / glow, and dispose the clone yourself.
 */
export const mat = (color: number, opts: MatOptions = {}): THREE.MeshLambertMaterial => {
  const key = [
    "lambert",
    color,
    opts.emissive ?? -1,
    opts.emissiveIntensity ?? 1,
    opts.transparent ? 1 : 0,
    opts.opacity ?? 1,
    opts.flat ? 1 : 0,
    opts.vertexColors ? 1 : 0,
    opts.doubleSided ? 1 : 0,
    opts.depthWrite === false ? 0 : 1,
    opts.decal ? 1 : 0,
    opts.map ? opts.map.id : -1,
    opts.emissiveMap ? 1 : 0,
  ].join("|");
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshLambertMaterial;

  const opacity = opts.opacity ?? 1;
  const material = new THREE.MeshLambertMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? opacity < 1,
    opacity,
    flatShading: opts.flat ?? false,
    vertexColors: opts.vertexColors ?? false,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
    map: opts.map ?? null,
    emissiveMap: opts.emissiveMap ? (opts.map ?? null) : null,
  });
  if (opts.decal) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = 2;
    material.polygonOffsetUnits = 2;
  }
  materialCache.set(key, material);
  return material;
};

/**
 * THE workhorse material: white Lambert that shows a baked model's vertex
 * colours. `tint` multiplies everything (used for dimmed / ghosted looks);
 * `decal` is for ground planes that other surfaces sit flush on.
 */
export const vertexMat = (tint = 0xffffff, decal = false): THREE.MeshLambertMaterial => mat(tint, { vertexColors: true, decal });

export interface GlowOptions {
  opacity?: number;
  /** Additive blending, for light pools and beams. */
  additive?: boolean;
  vertexColors?: boolean;
  doubleSided?: boolean;
  map?: THREE.Texture | null;
}

/** Shared unlit material for things that are their own light source (LEDs, beacons, light pools). */
export const glowMat = (color: number, opts: GlowOptions = {}): THREE.MeshBasicMaterial => {
  const opacity = opts.opacity ?? 1;
  const translucent = opacity < 1 || Boolean(opts.additive) || Boolean(opts.map);
  const key = ["basic", color, opacity, opts.additive ? 1 : 0, opts.vertexColors ? 1 : 0, opts.doubleSided ? 1 : 0, opts.map ? opts.map.id : -1].join("|");
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: translucent,
    opacity,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    // Translucent glows must not hide what is behind them in the depth buffer.
    depthWrite: !translucent,
    vertexColors: opts.vertexColors ?? false,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    map: opts.map ?? null,
    toneMapped: false,
  });
  materialCache.set(key, material);
  return material;
};

/** Shared window / partition glass. */
export const glassMat = (tint: number = C.glass, opacity = 0.32): THREE.MeshLambertMaterial =>
  mat(tint, { transparent: true, opacity, depthWrite: false, doubleSided: true });

/** Internal (M5): used by sharedResources.disposeSharedResources. */
export const disposeMaterialCache = (): void => {
  for (const material of materialCache.values()) material.dispose();
  materialCache.clear();
};

/** Internal (M5): used by sharedResources.sharedResourceStats. */
export const materialCacheSize = (): number => materialCache.size;
