import * as THREE from "three";
import { CAMERA_ELEVATION } from "../core/CameraRig";
import { clamp, easeOutBack, easeOutCubic, smoothstep } from "../core/math";
import type { FloatTone, Vec3Like } from "../types";

export interface FloatTextOptions {
  reducedMotion: boolean;
  /** World units covered by one CSS pixel right now (sprites are sized from it). */
  unitsPerPixel(): number;
  /** How long a text shows, in seconds. Left out, 1.4. */
  lifeSeconds?: number;
  /** A text stands where it appears, at its size: no rise and no pop, only the fade in and out. */
  still?: boolean;
}

const TONE_COLORS: Record<FloatTone, string> = {
  good: "#4ade80",
  bad: "#f87171",
  neutral: "#ffffff",
  cash: "#fbbf24",
};

/** Textures are drawn at this font size: 2× the largest on-screen size, so they stay crisp at DPR 2. */
const FONT_PX = 48;
const FONT = `bold ${FONT_PX}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const OUTLINE = "rgba(8, 10, 14, 0.94)";
const OUTLINE_PX = 11;
const PADDING_PX = 9;
const TEXTURE_HEIGHT = Math.round(FONT_PX * 1.3) + PADDING_PX * 2;

/** Text is nominally this tall in world units, i.e. it scales with the diorama... */
const NOMINAL_FONT_UNITS = 0.27;
/** ...but its on-screen font size is held between these, so it stays readable at any zoom. */
const MIN_FONT_PX = 13;
const MAX_FONT_PX = 24;

const LIFE_SECONDS = 1.4;
const RISE_UNITS = 1.2;
/** Reduced motion keeps the information but drops most of the travel. */
const REDUCED_RISE_UNITS = 0.3;
const POP_SECONDS = 0.16;
const FADE_IN_SECONDS = 0.08;
/** Fraction of life after which the text starts fading out. */
const FADE_OUT_FROM = 0.62;

/** Texts spawned this close together (seconds, world units) are stacked instead of overlapping. */
const STACK_WINDOW_SECONDS = 0.5;
const STACK_RADIUS = 0.8;
/** Line pitch as a fraction of the sprite height (the sprite includes outline padding). */
const STACK_PITCH = 0.8;
/** Tallest stack; beyond it new texts share the top line rather than climbing off screen. */
const MAX_STACK_SLOT = 6;

const MAX_ACTIVE = 28;
const TEXTURE_CACHE_CAP = 40;
const RENDER_ORDER = 1100;

/** A world-space step up appears shorter on screen by this factor (the camera looks down at a slant). */
const VERTICAL_FORESHORTENING = Math.cos(CAMERA_ELEVATION);

/**
 * The lowest line of a stack that is not taken. `takenMask` has bit n set when
 * line n is occupied by a text that has not yet risen out of the way.
 */
export const lowestFreeSlot = (takenMask: number): number => {
  let slot = 0;
  while (slot < MAX_STACK_SLOT && (takenMask & (1 << slot)) !== 0) slot += 1;
  return slot;
};

interface CachedText {
  texture: THREE.CanvasTexture;
  aspect: number;
  /** Active sprites showing this texture; only unused textures may be evicted. */
  users: number;
}

interface FloatItem {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  cached: CachedText | null;
  active: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  slot: number;
}

/**
 * "+12 rep", "−$3,000": short labels that rise from a point and fade.
 *
 * Sprites are pooled and their canvas textures cached by text + tone (the same
 * few strings recur all game), with least-recently-used eviction. Nothing here
 * touches the DOM until the first spawn, and spawn() is a no-op where there is
 * no document, so the module is safe to import and construct under node.
 */
export class FloatTextLayer {
  readonly root = new THREE.Group();

  private readonly options: FloatTextOptions;
  private readonly life: number;
  private readonly items: FloatItem[] = [];
  /** Insertion order doubles as recency: re-inserting on every hit keeps the oldest first. */
  private readonly cache = new Map<string, CachedText>();
  /** Bumped when the web font finishes loading, so later texts are redrawn with it. */
  private fontEpoch = 0;
  private fontRequested = false;

  constructor(options: FloatTextOptions) {
    this.options = options;
    const life = options.lifeSeconds;
    this.life = life !== undefined && life > 0 && Number.isFinite(life) ? life : LIFE_SECONDS;
    this.root.name = "fx-float-text";
  }

  get activeCount(): number {
    let count = 0;
    for (const item of this.items) if (item.active) count += 1;
    return count;
  }

  spawn(text: string, at: Vec3Like, tone: FloatTone): void {
    if (typeof document === "undefined" || text.length === 0) return;
    const cached = this.textureFor(text, tone);
    if (!cached) return;

    const item = this.claimItem();
    // Texts that appeared here a moment ago are still in the way; older ones
    // have already risen clear, so their lines can be used again.
    let taken = 0;
    for (const other of this.items) {
      if (!other.active || other === item || other.age > STACK_WINDOW_SECONDS) continue;
      if (Math.abs(other.y - at.y) > 1 || Math.hypot(other.x - at.x, other.z - at.z) > STACK_RADIUS) continue;
      taken |= 1 << other.slot;
    }
    const slot = lowestFreeSlot(taken);

    cached.users += 1;
    item.cached = cached;
    item.active = true;
    item.age = 0;
    item.x = at.x;
    item.y = at.y;
    item.z = at.z;
    item.slot = slot;
    item.material.map = cached.texture;
    item.material.opacity = 0;
    item.sprite.visible = true;
    this.place(item);
  }

  update(dt: number): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.age += dt;
      if (item.age >= this.life) this.release(item);
      else this.place(item);
    }
  }

  /** Remove everything on screen (run reset). Cached textures are kept. */
  clear(): void {
    for (const item of this.items) if (item.active) this.release(item);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    for (const item of this.items) {
      this.root.remove(item.sprite);
      item.material.dispose();
    }
    this.items.length = 0;
    for (const cached of this.cache.values()) cached.texture.dispose();
    this.cache.clear();
  }

  private place(item: FloatItem): void {
    const cached = item.cached;
    if (!cached) return;
    const unitsPerPixel = this.options.unitsPerPixel();
    const fontPx = clamp(NOMINAL_FONT_UNITS / unitsPerPixel, MIN_FONT_PX, MAX_FONT_PX);
    const height = (fontPx * unitsPerPixel * TEXTURE_HEIGHT) / FONT_PX;
    const t = item.age / this.life;
    const still = this.options.still === true;
    const rise = still ? 0 : (this.options.reducedMotion ? REDUCED_RISE_UNITS : RISE_UNITS) * easeOutCubic(t);
    const stack = (item.slot * height * STACK_PITCH) / VERTICAL_FORESHORTENING;
    const pop = still ? 1 : 0.6 + 0.4 * easeOutBack(item.age / POP_SECONDS);

    item.sprite.position.set(item.x, item.y + rise + stack, item.z);
    item.sprite.scale.set(height * cached.aspect * pop, height * pop, 1);
    item.material.opacity =
      Math.min(1, item.age / FADE_IN_SECONDS) * (1 - smoothstep((t - FADE_OUT_FROM) / (1 - FADE_OUT_FROM)));
  }

  private release(item: FloatItem): void {
    item.active = false;
    item.sprite.visible = false;
    if (item.cached) item.cached.users -= 1;
    item.cached = null;
  }

  /** A free sprite; when all are busy, the one that has been up longest gives way. */
  private claimItem(): FloatItem {
    let oldest: FloatItem | null = null;
    for (const item of this.items) {
      if (!item.active) return item;
      if (!oldest || item.age > oldest.age) oldest = item;
    }
    if (oldest && this.items.length >= MAX_ACTIVE) {
      this.release(oldest);
      return oldest;
    }
    const material = new THREE.SpriteMaterial({
      transparent: true,
      // Labels are UI: always on top of the diorama and untouched by tone mapping.
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = RENDER_ORDER;
    sprite.visible = false;
    this.root.add(sprite);
    const item: FloatItem = { sprite, material, cached: null, active: false, age: 0, x: 0, y: 0, z: 0, slot: 0 };
    this.items.push(item);
    return item;
  }

  private textureFor(text: string, tone: FloatTone): CachedText | null {
    this.requestFont();
    const cacheKey = `${this.fontEpoch}|${tone}|${text}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, hit);
      return hit;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = FONT;
    const width = Math.ceil(ctx.measureText(text).width) + PADDING_PX * 2;
    canvas.width = width;
    canvas.height = TEXTURE_HEIGHT;
    // Resizing a canvas resets its context state.
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // A dark outline keeps any tone legible over any floor, wall or prop.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_PX;
    ctx.strokeText(text, width / 2, TEXTURE_HEIGHT / 2 + 2);
    ctx.fillStyle = TONE_COLORS[tone];
    ctx.fillText(text, width / 2, TEXTURE_HEIGHT / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const cached: CachedText = { texture, aspect: width / TEXTURE_HEIGHT, users: 0 };
    this.cache.set(cacheKey, cached);
    this.evict();
    return cached;
  }

  private evict(): void {
    if (this.cache.size <= TEXTURE_CACHE_CAP) return;
    for (const [cacheKey, cached] of this.cache) {
      if (cached.users > 0) continue;
      cached.texture.dispose();
      this.cache.delete(cacheKey);
      if (this.cache.size <= TEXTURE_CACHE_CAP) return;
    }
  }

  /**
   * Canvas text silently falls back to another font while a web font is still
   * loading. Ask for it once; when it arrives, start a new cache generation so
   * the fallback renderings age out.
   */
  private requestFont(): void {
    if (this.fontRequested) return;
    this.fontRequested = true;
    const fonts = document.fonts;
    if (!fonts || fonts.check(FONT)) return;
    fonts.load(FONT).then(
      () => {
        this.fontEpoch += 1;
      },
      () => {
        // Offline or blocked: the monospace fallback is fine.
      }
    );
  }
}
