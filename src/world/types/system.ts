/** Split from src/world/types.ts (M5): system plumbing: quality, signals, the world context and the sound listener. Re-exported by ../types. */

import type * as THREE from "three";
import type { WorldEvent, WorldSnapshot } from "./snapshot";
import type { OfficeLayout } from "./office";
import type { SeatingApi } from "./seating";
import type { InteractableRegistry } from "./interaction";
import type { FxApi } from "./fx";
import type { Vec2 } from "./geometry";

export type QualityLevel = "low" | "high";

/**
 * Live facts one system publishes for the others to read each frame — the few
 * places where the systems have to act in step without knowing each other.
 */
export interface WorldSignals {
  /**
   * How many people are walking through the doorway right now (arriving or
   * leaving). Written by the people system every frame; the office holds the
   * front door open while it is above zero.
   */
  doorTraffic: number;
  /**
   * The desk chairs somebody is using, and how far each is pulled out: 0 (sitting in
   * it) … 1 (rolled back out of the way: getting up, sitting down, or away from the
   * desk). Keyed by `chairKey(seat)`: the desk's slot index, or −1 / −2 for the
   * founder's / cofounder's chair. A chair nobody is using is not listed (the office
   * tucks it in). Rewritten in place by the people system every frame; absent while
   * there is no people system.
   */
  chairsOut?: ReadonlyMap<number, number>;
  /**
   * People who still hold a seat in the seating plan but are no longer in the office
   * (after a lost run the staff go home). Their desks look vacant. Replaced — never
   * modified — whenever its contents change, so readers can compare by reference.
   */
  vacated?: ReadonlySet<string>;
}

export interface WorldContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly quality: QualityLevel;
  readonly reducedMotion: boolean;
  readonly interactables: InteractableRegistry;
  readonly fx: FxApi;
  readonly seating: SeatingApi;
  readonly signals: WorldSignals;
  /** The layout for the snapshot currently being applied / last applied. */
  getLayout(): OfficeLayout;
  /** Smoothly re-frame the camera on a point (e.g. on phase change). */
  focusCamera(target: Vec2, viewHeight?: number, seconds?: number): void;
  /**
   * Where systems report the moments only they can time (see WorldSoundListener), in world
   * coordinates. Absent unless the app asked for them: systems call it with `?.`.
   */
  readonly sound?: WorldSoundSink;
}

/** The world-coordinate side of WorldSoundListener, for systems (positions on the ground). */
export interface WorldSoundSink {
  /** Footsteps from `from` toward `to`; `approach` +1 arriving, −1 leaving, 0 passing by. */
  footsteps(from: Vec2, to: Vec2, steps: number, approach: number): void;
  /** Somebody sat down at `at` after walking in. */
  chairSit(at: Vec2): void;
}

export interface WorldSystem {
  /**
   * Called on every game-state change, in system order (office → people → fx).
   * `prev` is null on the first call: build the scene instantly, with no
   * entrance animations. `events` describes what changed since `prev`.
   */
  applySnapshot(next: WorldSnapshot, prev: WorldSnapshot | null, events: readonly WorldEvent[]): void;
  /** Per frame. `dt` is seconds since last frame (clamped to ≤ 0.1); `elapsed` is total seconds. */
  update(dt: number, elapsed: number): void;
  /** Remove everything this system added to the scene and free GPU resources. */
  dispose(): void;
}


export interface WorldSoundCue {
  pan: number;
}

export interface WorldFootstepsCue extends WorldSoundCue {
  /** How many steps to play (1–6). */
  steps: number;
  /** +1 arriving (swells), −1 leaving (fades), 0 passing by. */
  approach: number;
  /** Where the walker is heading, on the same scale as `pan`. */
  panTo: number;
}

/**
 * Optional listener for the sounds only the world can time: real footsteps, a chair taking a
 * new arrival's weight, a thought bubble popping up, and the lighting's time of day. The
 * world behaves exactly the same with or without it; every method is optional and a listener
 * that throws is ignored.
 */
export interface WorldSoundListener {
  /**
   * Somebody walks through the front door: an arrival a couple of seconds before reaching
   * their seat (approach +1), somebody leaving as they set off (−1), and the founder's
   * `coffee` errand there and back (0). Ordinary wandering stays silent.
   */
  onFootsteps?(cue: WorldFootstepsCue): void;
  /** An arrival sits down at their desk. */
  onChairSit?(cue: WorldSoundCue): void;
  /** A thought bubble pops up over somebody's head. */
  onBubble?(cue: WorldSoundCue): void;
  /** The lighting's dusk amount (0 daylight … 1 dusk and night) whenever it has moved noticeably. */
  onDusk?(amount: number): void;
}

export interface WorldOptions {
  quality?: QualityLevel;
  reducedMotion?: boolean;
  /** Optional: report sound-worthy moments (see WorldSoundListener). */
  sound?: WorldSoundListener;
}
