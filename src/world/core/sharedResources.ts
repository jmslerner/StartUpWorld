/** Split from core/palette.ts (M5): the shared-resource ledger — counts and whole-cache disposal across materials / geometry / textures. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import { disposeGeometryCache, geometryCacheSize } from "./geometry";
import { disposeMaterialCache, materialCacheSize } from "./materials";
import { disposeTextureCache, textureCacheSize } from "./textures";

/** Counts of live cached resources — for leak checks in tests and the gallery HUD. */
export const sharedResourceStats = (): { materials: number; geometries: number; textures: number } => ({
  materials: materialCacheSize(),
  geometries: geometryCacheSize(),
  textures: textureCacheSize(),
});

/**
 * Free every cached material, geometry and texture and empty the caches. Safe to
 * call repeatedly; the next `mat()` / `bakeModel()` / `canvasTexture()` call
 * simply rebuilds what it needs.
 */
export const disposeSharedResources = (): void => {
  disposeMaterialCache();
  disposeGeometryCache();
  disposeTextureCache();
};
