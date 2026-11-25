import * as THREE from "three";
import { clamp, easeOutBack, smoothstep } from "../core/math";
import type { BubbleIcon } from "../types";
import { BUBBLE_TAIL_ANCHOR, BUBBLE_TEXTURE_HEIGHT, BUBBLE_TEXTURE_WIDTH, drawBubble } from "./bubbleIcons";

export interface BubbleLayerOptions {
  /** Bubbles whose anchor is no longer attached under this object are dropped. */
  scene: THREE.Object3D;
  reducedMotion: boolean;
  /** World units covered by one CSS pixel right now (sprites are sized from it). */
  unitsPerPixel(): number;
}

export const DEFAULT_BUBBLE_SECONDS = 2.2;
/**
 * Extra lift above the anchor. Zero by default: the tip of the bubble's tail
 * touches the anchor itself, so callers anchor to the point the bubble should
 * grow from (a character's head anchor) rather than to something on the floor.
 */
export const DEFAULT_BUBBLE_HEIGHT = 0;

/** Bubbles are nominally this wide in world units, held between these on-screen widths (CSS px). */
const NOMINAL_WIDTH_UNITS = 0.62;
const MIN_WIDTH_PX = 26;
const MAX_WIDTH_PX = 52;

const POP_IN_SECONDS = 0.2;
const POP_OUT_SECONDS = 0.16;
/** Gentle float so a bubble over a seated, still character does not look pasted on. */
const BOB_UNITS = 0.035;
const BOB_RATE = 2.6;

const MAX_BUBBLES = 24;
const RENDER_ORDER = 1000;
const ASPECT = BUBBLE_TEXTURE_HEIGHT / BUBBLE_TEXTURE_WIDTH;

interface Bubble {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  anchor: THREE.Object3D | null;
  age: number;
  seconds: number;
  heightOffset: number;
  phase: number;
}

/**
 * Little icon bubbles that ride above characters' heads.
 * One per anchor (a new one replaces the old), capped globally, and dropped
 * the moment their anchor leaves the scene so nothing is left hanging in the air.
 */
export class BubbleLayer {
  readonly root = new THREE.Group();

  private readonly options: BubbleLayerOptions;
  /** Lookup for "one bubble per anchor"; `active` holds the same bubbles for allocation-free iteration. */
  private readonly byAnchor = new Map<THREE.Object3D, Bubble>();
  private readonly active: Bubble[] = [];
  private readonly spare: Bubble[] = [];
  private readonly textures = new Map<BubbleIcon, THREE.CanvasTexture>();
  private readonly position = new THREE.Vector3();

  constructor(options: BubbleLayerOptions) {
    this.options = options;
    this.root.name = "fx-bubbles";
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** Returns whether a bubble is now showing (false: no DOM, or the icon could not be drawn). */
  show(anchor: THREE.Object3D, icon: BubbleIcon, seconds: number, heightOffset: number): boolean {
    if (typeof document === "undefined") return false;
    const texture = this.textureFor(icon);
    if (!texture) return false;

    let bubble = this.byAnchor.get(anchor);
    if (bubble) {
      // Same character, new thought: swap the picture and give a small re-pop
      // instead of shrinking away and growing back.
      bubble.age = Math.min(bubble.age, POP_IN_SECONDS * 0.5);
    } else {
      if (this.active.length >= MAX_BUBBLES) this.dropOldest();
      bubble = this.spare.pop() ?? this.createBubble();
      bubble.anchor = anchor;
      bubble.age = 0;
      // Out of step with its neighbours, so a row of bubbles does not bob in unison.
      bubble.phase = this.active.length * 1.7;
      this.byAnchor.set(anchor, bubble);
      this.active.push(bubble);
    }
    bubble.seconds = Math.max(seconds, POP_IN_SECONDS + POP_OUT_SECONDS);
    bubble.heightOffset = heightOffset;
    bubble.material.map = texture;
    bubble.sprite.visible = true;
    this.place(bubble, 0);
    return true;
  }

  update(dt: number, elapsed: number): void {
    // Backwards, because retiring a bubble removes it from the list.
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const bubble = this.active[i];
      bubble.age += dt;
      if (bubble.age >= bubble.seconds || !bubble.anchor || !this.isAttached(bubble.anchor)) this.retire(bubble);
      else this.place(bubble, elapsed);
    }
  }

  /** Remove everything on screen (run reset). Icon textures are kept. */
  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) this.retire(this.active[i]);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    for (const bubble of this.spare) {
      this.root.remove(bubble.sprite);
      bubble.material.dispose();
    }
    this.spare.length = 0;
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }

  private place(bubble: Bubble, elapsed: number): void {
    const anchor = bubble.anchor;
    if (!anchor) return;
    const unitsPerPixel = this.options.unitsPerPixel();
    const width = clamp(NOMINAL_WIDTH_UNITS / unitsPerPixel, MIN_WIDTH_PX, MAX_WIDTH_PX) * unitsPerPixel;
    const remaining = bubble.seconds - bubble.age;
    const pop = remaining < POP_OUT_SECONDS ? smoothstep(remaining / POP_OUT_SECONDS) : easeOutBack(bubble.age / POP_IN_SECONDS);
    const bob = this.options.reducedMotion ? 0 : Math.sin(elapsed * BOB_RATE + bubble.phase) * BOB_UNITS;

    anchor.getWorldPosition(this.position);
    bubble.sprite.position.set(this.position.x, this.position.y + bubble.heightOffset + bob, this.position.z);
    bubble.sprite.scale.set(width * pop, width * ASPECT * pop, 1);
  }

  private retire(bubble: Bubble): void {
    if (bubble.anchor) this.byAnchor.delete(bubble.anchor);
    const index = this.active.indexOf(bubble);
    if (index >= 0) this.active.splice(index, 1);
    bubble.anchor = null;
    bubble.sprite.visible = false;
    this.spare.push(bubble);
  }

  private dropOldest(): void {
    let oldest: Bubble | null = null;
    for (const bubble of this.active) {
      if (!oldest || bubble.age > oldest.age) oldest = bubble;
    }
    if (oldest) this.retire(oldest);
  }

  private isAttached(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (node === this.options.scene) return true;
    }
    return false;
  }

  private createBubble(): Bubble {
    const material = new THREE.SpriteMaterial({
      transparent: true,
      // Bubbles are UI: always readable on top of the diorama, untouched by tone mapping.
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    // Pivot on the tip of the tail, so the bubble grows out of the speaker.
    sprite.center.set(0.5, BUBBLE_TAIL_ANCHOR);
    sprite.renderOrder = RENDER_ORDER;
    sprite.visible = false;
    this.root.add(sprite);
    return { sprite, material, anchor: null, age: 0, seconds: DEFAULT_BUBBLE_SECONDS, heightOffset: 0, phase: 0 };
  }

  private textureFor(icon: BubbleIcon): THREE.CanvasTexture | null {
    const existing = this.textures.get(icon);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = BUBBLE_TEXTURE_WIDTH;
    canvas.height = BUBBLE_TEXTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawBubble(ctx, icon);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(icon, texture);
    return texture;
  }
}
