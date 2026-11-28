/**
 * The app's sound listener (WorldOptions.sound), as the world reaches it: footsteps, a chair sat on and a thought
 * bubble are placed in stereo by where the camera draws them, and the lighting's time of day is passed on whenever it
 * has moved noticeably. Whatever the listener does wrong stays out of the frame, and once the world is disposed it is
 * told nothing more.
 */
import * as THREE from "three";
import type { WorldSoundListener, WorldSoundSink } from "../types";
import type { LightingState } from "./lightingState";
import { clamp } from "./math";

/**
 * Sound pans are kept moderate: the canvas is a window in the page, not the whole sound
 * stage, so something at its edge sounds off to the side, never hard in one ear.
 */
export const SOUND_PAN_SPREAD = 0.6;
/** Height (world units) at which a sound's position is projected: about a seated person's chest. */
const SOUND_HEIGHT = 0.8;
/** The lighting's dusk amount is passed on when it has moved this much (and at both ends). */
const DUSK_REPORT_STEP = 0.02;

export class WorldSound {
  private readonly listener: WorldSoundListener | null;
  private readonly camera: THREE.Camera;
  /** The lighting's published state (a stable object per scene), read for the listener's dusk. */
  private readonly lighting: Readonly<LightingState>;
  private readonly disposed: () => boolean;
  private readonly point = new THREE.Vector3();
  /** Last dusk amount handed to the listener; NaN before the first. */
  private reportedDusk = Number.NaN;

  /**
   * `listener` is the app's, or null when it listens for nothing; `camera` the one the world draws with; `lighting`
   * the lighting's state for the world's scene; `disposed` says whether the world is gone.
   */
  constructor(
    listener: WorldSoundListener | null,
    camera: THREE.Camera,
    lighting: Readonly<LightingState>,
    disposed: () => boolean
  ) {
    this.listener = listener;
    this.camera = camera;
    this.lighting = lighting;
    this.disposed = disposed;
  }

  /** The world-coordinate sink systems report to, or undefined when nobody listens for those sounds. */
  sink(): WorldSoundSink | undefined {
    const sound = this.listener;
    if (!sound || (!sound.onFootsteps && !sound.onChairSit)) return undefined;
    return {
      footsteps: (from, to, steps, approach) =>
        this.tell((listener) =>
          listener.onFootsteps?.({ steps, approach, pan: this.pan(from.x, from.z), panTo: this.pan(to.x, to.z) })
        ),
      chairSit: (at) => this.tell((listener) => listener.onChairSit?.({ pan: this.pan(at.x, at.z) })),
    };
  }

  /** What the effects call when a thought bubble shows (FxDeps.onBubble), or undefined when nobody listens for it. */
  bubbleSink(): ((at: THREE.Vector3) => void) | undefined {
    return this.listener?.onBubble ? (at) => this.tell((sound) => sound.onBubble?.({ pan: this.pan(at.x, at.z) })) : undefined;
  }

  /** Pass the lighting's time of day on to the listener when it has moved noticeably. Called every frame. */
  reportDusk(): void {
    if (!this.listener?.onDusk) return;
    const dusk = this.lighting.duskAmount;
    const last = this.reportedDusk;
    const atEnd = (dusk === 0 || dusk === 1) && dusk !== last;
    if (!atEnd && Math.abs(dusk - last) < DUSK_REPORT_STEP) return;
    this.reportedDusk = dusk;
    this.tell((sound) => sound.onDusk?.(dusk));
  }

  /** Stereo position of a point on the ground, from where the camera draws it. */
  private pan(x: number, z: number): number {
    const ndc = this.point.set(x, SOUND_HEIGHT, z).project(this.camera).x;
    return Number.isFinite(ndc) ? clamp(ndc, -1, 1) * SOUND_PAN_SPREAD : 0;
  }

  /** Call the listener; whatever it does wrong stays out of the frame. */
  private tell(call: (listener: WorldSoundListener) => void): void {
    const sound = this.listener;
    if (!sound || this.disposed()) return;
    try {
      call(sound);
    } catch {
      // A garnish: a broken listener must never cost a frame.
    }
  }
}
