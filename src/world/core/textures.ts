/** Split from core/palette.ts (M5): canvas textures — shared canvasTexture and caller-owned DynamicTexture. Re-exported by ./palette, so every existing import from "./palette" / "../core/palette" keeps working. */
import * as THREE from "three";

export type CanvasDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/** Font stack for anything drawn into a texture; matches the app's terminal font. */
export const LABEL_FONT = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

interface CanvasEntry {
  texture: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  draw: CanvasDraw;
}

const textureCache = new Map<string, CanvasEntry>();
/** Caller-owned textures that are still alive (so a late font load can repaint them). */
const liveDynamicTextures = new Set<CanvasEntry>();
let fontWatchStarted = false;

/** True when canvas textures can be drawn (i.e. we are in a browser). */
export const canDrawTextures = (): boolean => typeof document !== "undefined";

const repaint = (entry: CanvasEntry): void => {
  const { canvas } = entry.ctx;
  entry.ctx.clearRect(0, 0, canvas.width, canvas.height);
  entry.draw(entry.ctx, canvas.width, canvas.height);
  entry.texture.needsUpdate = true;
};

/**
 * Text drawn before the web font arrives uses a fallback face. Repaint every
 * live texture once the real font is ready so signs match the terminal.
 */
const watchLabelFont = (): void => {
  if (fontWatchStarted || typeof document === "undefined" || !document.fonts) return;
  fontWatchStarted = true;
  const probe = '600 32px "IBM Plex Mono"';
  if (document.fonts.check(probe)) return;
  document.fonts
    .load(probe)
    .then(() => {
      for (const entry of textureCache.values()) repaint(entry);
      for (const entry of liveDynamicTextures) repaint(entry);
    })
    .catch(() => {
      // Offline / blocked font: the fallback face is fine.
    });
};

const createCanvasEntry = (width: number, height: number, draw: CanvasDraw): CanvasEntry | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const entry: CanvasEntry = { texture, ctx, draw };
  repaint(entry);
  watchLabelFont();
  return entry;
};

/**
 * Shared, cached canvas texture. Returns null where there is no DOM (tests) —
 * callers must fall back to a flat colour.
 */
export const canvasTexture = (key: string, width: number, height: number, draw: CanvasDraw): THREE.CanvasTexture | null => {
  const cached = textureCache.get(key);
  if (cached) return cached.texture;
  const entry = createCanvasEntry(width, height, draw);
  if (!entry) return null;
  textureCache.set(key, entry);
  return entry.texture;
};

/** A canvas texture owned by one prop that repaints on demand (calendar week, "+N" sign). */
export interface DynamicTexture {
  readonly texture: THREE.CanvasTexture;
  /** Replace the picture. */
  redraw(draw: CanvasDraw): void;
  dispose(): void;
}

/** Caller-owned repaintable texture, or null where there is no DOM. Dispose it with the prop. */
export const createDynamicTexture = (width: number, height: number, draw: CanvasDraw): DynamicTexture | null => {
  const entry = createCanvasEntry(width, height, draw);
  if (!entry) return null;
  liveDynamicTextures.add(entry);
  return {
    texture: entry.texture,
    redraw(next: CanvasDraw): void {
      entry.draw = next;
      repaint(entry);
    },
    dispose(): void {
      liveDynamicTextures.delete(entry);
      entry.texture.dispose();
    },
  };
};

/** Internal (M5): used by sharedResources.disposeSharedResources. Live dynamic textures are caller-owned and are not touched. */
export const disposeTextureCache = (): void => {
  for (const entry of textureCache.values()) entry.texture.dispose();
  textureCache.clear();
};

/** Internal (M5): used by sharedResources.sharedResourceStats. */
export const textureCacheSize = (): number => textureCache.size;
