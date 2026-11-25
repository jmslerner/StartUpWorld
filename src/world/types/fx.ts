/** Split from src/world/types.ts (M5): the FxApi surface (bursts, streams, floating text, bubbles). Re-exported by ../types. */

import type * as THREE from "three";
import type { Vec3Like } from "./geometry";

export type BurstKind = "confetti" | "sparkle" | "smoke" | "money" | "hearts" | "bugs" | "users" | "dust";
export type FloatTone = "good" | "bad" | "neutral" | "cash";
export type BubbleIcon =
  | "code"
  | "idea"
  | "coffee"
  | "money"
  | "heart"
  | "stress"
  | "zzz"
  | "exclaim"
  | "question"
  | "megaphone"
  | "bug"
  | "rocket"
  | "chart"
  | "phone"
  | "wave";

export interface FxApi {
  /** One-shot particle burst at a world position. `intensity` ≈ 1 is a normal burst. */
  burst(kind: BurstKind, at: Vec3Like, intensity?: number): void;
  /** Particles that arc from one point to another (e.g. code bubbles flying to the product wall). */
  stream(kind: BurstKind, from: Vec3Like, to: Vec3Like, count?: number): void;
  /** Short text that floats up and fades, e.g. "+12 rep", "−$3,000". */
  floatText(text: string, at: Vec3Like, tone?: FloatTone): void;
  /**
   * Small icon bubble that follows `anchor` for `seconds` (default 2.2) then pops.
   * `heightOffset` defaults to 0: the bubble's tail tip sits on the anchor, which is what a
   * character's head anchor wants. For an object whose origin is on the floor pass ≈ 1.7.
   */
  bubble(anchor: THREE.Object3D, icon: BubbleIcon, seconds?: number, heightOffset?: number): void;
  /** Brief camera shake; `strength` 0..1. No-op when reduced motion is on. */
  shake(strength: number): void;
}

