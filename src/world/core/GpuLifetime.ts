/**
 * The world's hold on the GPU, from start to end: the canvas's WebGL 2 context and the renderer made on it (and, when
 * either cannot be had, the WorldUnsupportedError that says why); taking the context away and giving it back on
 * request (WorldHandle.loseContext and restoreContext); and handing everything back: what the systems left on stage,
 * the shared caches, the renderer's state, and at last the context itself, once the canvas has left the page.
 *
 * What the world does while its context is gone (draw nothing, then draw anew) is the render loop's: ./RenderLoop.ts.
 */
import * as THREE from "three";
import type { QualityLevel } from "../types";
import { disposeSharedResources } from "./palette";
import { configureRenderer } from "./rendererLook";

/** Thrown by createWorld when the browser cannot give us a usable WebGL 2 context. */
export class WorldUnsupportedError extends Error {
  constructor(message = "WebGL 2 is not available.", options?: ErrorOptions) {
    super(message, options);
    this.name = "WorldUnsupportedError";
  }
}

export const CONTEXT_RELEASE_DELAY_MS = 300;

// Exactly what THREE.WebGLRenderer would ask for itself. We create the context
// first so that failing to get one never involves constructing a renderer.
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
  failIfMajorPerformanceCaveat: false,
};

/** Canvases whose GPU context is due to be released because their world was disposed. */
const pendingContextRelease = new WeakMap<HTMLCanvasElement, number>();

export const acquireContext = (canvas: HTMLCanvasElement): WebGL2RenderingContext => {
  // A world is being created on this canvas again (React StrictMode remounts
  // effects on the same element): the context is still wanted after all.
  const pending = pendingContextRelease.get(canvas);
  if (pending !== undefined) {
    window.clearTimeout(pending);
    pendingContextRelease.delete(canvas);
  }
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
  } catch {
    gl = null;
  }
  if (!gl) throw new WorldUnsupportedError("This browser or device cannot create a WebGL 2 context.");
  if (gl.isContextLost()) throw new WorldUnsupportedError("The WebGL context for this canvas has been lost.");
  return gl;
};

/**
 * renderer.dispose() frees what three.js allocated but keeps the context alive,
 * which is what lets a world be re-created on the same canvas. Once the canvas
 * has actually left the page nobody can do that, so hand the GPU memory back
 * rather than waiting for garbage collection (browsers cap live contexts).
 */
export const releaseContextWhenOrphaned = (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): void => {
  const timer = window.setTimeout(() => {
    pendingContextRelease.delete(canvas);
    if (!canvas.isConnected) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }, CONTEXT_RELEASE_DELAY_MS);
  pendingContextRelease.set(canvas, timer);
};

/** Free the GPU resources of an object tree that nobody else is going to clean up. */
export const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((node) => {
    const mesh = node as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
};

/**
 * Take every child of `scene` but those in `keep` off it, and free what each holds on the GPU: what the systems
 * that were stopped for a new run left behind.
 */
export const clearScene = (scene: THREE.Scene, keep: ReadonlySet<THREE.Object3D>): void => {
  for (const child of [...scene.children]) {
    if (keep.has(child)) continue;
    scene.remove(child);
    disposeTree(child);
  }
};

export class GpuLifetime {
  readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  /** The extension that takes the context away and gives it back, fetched while there is a context to ask. */
  private readonly contextSwitch: WEBGL_lose_context | null;

  /** @throws WorldUnsupportedError when there is no usable WebGL 2 context, or the renderer cannot start on it. */
  constructor(canvas: HTMLCanvasElement, quality: QualityLevel) {
    this.canvas = canvas;
    this.gl = acquireContext(canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        context: this.gl,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (cause) {
      throw new WorldUnsupportedError("WebGL 2 is available, but the renderer could not start.", { cause });
    }
    configureRenderer(this.renderer, quality);
    this.contextSwitch = this.gl.getExtension("WEBGL_lose_context");
  }

  /** Take the context away, as a browser may at any time. Nothing when it is lost already. */
  loseContext(): void {
    if (this.gl.isContextLost()) return;
    this.contextSwitch?.loseContext();
  }

  /** Give the context back. Only a context taken away through the extension can be given back through it. */
  restoreContext(): void {
    if (!this.gl.isContextLost()) return;
    this.contextSwitch?.restoreContext();
  }

  /**
   * Hand back everything the world holds on the GPU but the context: `stopSystems` takes the systems down, then
   * whatever is left in `scene` is taken off it and freed, with every material that was on stage before the systems
   * went and the shared caches, and the renderer is reset and disposed. release() follows, last of all.
   */
  disposeStage(scene: THREE.Scene, stopSystems: () => void): void {
    // Materials shared through caches outlive the systems that used them, and
    // each keeps a dispose-listener pointing back into this renderer. Note what
    // is on stage now so those links can be cut once the systems are gone
    // (disposing a cached material is harmless: it is rebuilt on next use).
    const materials = new Set<THREE.Material>();
    scene.traverse((node) => {
      const material = (node as Partial<THREE.Mesh>).material;
      if (Array.isArray(material)) for (const entry of material) materials.add(entry);
      else if (material) materials.add(material);
    });

    stopSystems();
    // Whatever a system left in the scene still owns GPU memory; take it back.
    // NOTE (L5): disposeTree() disposes the materials on stage, and the loop
    // after it disposes the collected set a second time, as does
    // disposeSharedResources() for cached materials below. That redundancy is
    // deliberate and safe — Material.dispose() is idempotent (it only emits
    // the dispose event; three.js drops the GL program on the next render) —
    // and it guarantees the renderer links noted above are cut even for a
    // material that left the stage before teardown. Do not "deduplicate" it
    // without re-proving that every path still cuts those links.
    for (const child of [...scene.children]) {
      scene.remove(child);
      disposeTree(child);
    }
    for (const material of materials) material.dispose();
    // The prop/character caches are module-level: free them with the world so a
    // re-created world (StrictMode, the 3D toggle) starts from clean GPU state.
    disposeSharedResources();
    // The context outlives this renderer whenever a new world is created on the
    // same canvas (React StrictMode does exactly that). Hand it back in its
    // default state: a leftover such as UNPACK_FLIP_Y would otherwise trip up
    // the next renderer's start-up texture uploads.
    this.renderer.resetState();
    this.renderer.dispose();
  }

  /** The world is gone: the context is released once its canvas has left the page (see releaseContextWhenOrphaned). */
  release(): void {
    releaseContextWhenOrphaned(this.canvas, this.gl);
  }
}
