/**
 * Art-department toolkit for the 3D world.
 *
 *  1. The palette: app UI colours, diorama colours, role / outfit / skin / hair
 *     colours and the per-phase furniture themes. (core/colors.ts)
 *  2. Shared resource caches: materials (`mat`, `vertexMat`, `glowMat`,
 *     `glassMat`), unit geometries (`unitBox`, …), baked model geometries
 *     (`bakeModel`) and canvas textures (`canvasTexture`).
 *     (core/materials.ts, core/geometry.ts, core/models.ts, core/textures.ts)
 *  3. `ModelBuilder`: stacks coloured primitives and bakes them into ONE
 *     vertex-coloured geometry, so a whole prop costs a single draw call.
 *     (core/models.ts)
 *
 * One lighting model everywhere: Lambert (hemisphere + one directional light).
 * Self-lit things (screens, LEDs, neon) use Lambert emissive or the unlit
 * `glowMat`.
 *
 * Everything cached here is freed by `disposeSharedResources()` and lazily
 * re-created on next use, so mount → dispose → mount (React StrictMode) works.
 * No DOM access happens at module load; canvas helpers return null in node.
 *
 * M5: this file used to hold all of the above in one 1,074-line module. The
 * implementation now lives in the five modules below (plus sharedResources.ts
 * for the cross-cache ledger); this file is only a re-export barrel, so every
 * existing import from "./palette" / "../core/palette" keeps working.
 */
export * from "./colors";
export * from "./materials";
export * from "./geometry";
export * from "./models";
export * from "./textures";
export * from "./sharedResources";
