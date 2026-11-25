/**
 * The handful of scripted moves the office makes: props popping in, the
 * building rising out of the ground, the old office sinking away.
 *
 * Tweens are plain records in one list, ticked by OfficeSystem. Nothing is
 * allocated per frame; a tween allocates once, when it is started.
 */
import type * as THREE from "three";

type TweenKind = "pop" | "rise" | "sink";

interface Tween {
  kind: TweenKind;
  object: THREE.Object3D;
  /** Seconds still to wait before the move starts. */
  delay: number;
  duration: number;
  time: number;
  /** Resting transform, restored exactly when the move ends. */
  baseY: number;
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  /** How far below its resting height a rising / sinking object starts / ends. */
  depth: number;
  onDone: (() => void) | null;
}

/** Scale used for "not there yet": a true zero would make the matrix singular. */
const HIDDEN_SCALE = 0.001;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t * t * t;

/** Overshoots to about 1.1 before settling: the "pop" of a toy being set down. */
const easeOutBack = (t: number): number => {
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
};

export class StageMotion {
  private readonly tweens: Tween[] = [];

  get busy(): boolean {
    return this.tweens.length > 0;
  }

  /** Scale `object` up from nothing with a little overshoot, after `delay` seconds. */
  pop(object: THREE.Object3D, delay = 0, duration = 0.34): void {
    // start() records the resting scale before it is collapsed here.
    this.start("pop", object, delay, duration, 0, null);
    object.scale.multiplyScalar(HIDDEN_SCALE);
  }

  /** Lift `object` into place from `depth` below, after `delay` seconds. */
  rise(object: THREE.Object3D, depth: number, delay = 0, duration = 0.5): void {
    this.start("rise", object, delay, duration, depth, null);
    object.position.y -= depth;
    // Hidden until its turn comes, or it would sit visibly below the old office.
    object.visible = false;
  }

  /** Drop `object` by `depth` while it shrinks a little, then call `onDone` (which should remove it). */
  sink(object: THREE.Object3D, depth: number, duration: number, onDone: () => void): void {
    this.start("sink", object, 0, duration, depth, onDone);
  }

  update(dt: number): void {
    const { tweens } = this;
    for (let i = tweens.length - 1; i >= 0; i -= 1) {
      const tween = tweens[i];
      if (tween.delay > 0) {
        tween.delay -= dt;
        continue;
      }
      tween.time += dt;
      const t = Math.min(1, tween.time / tween.duration);
      this.apply(tween, t);
      if (t >= 1) {
        tweens[i] = tweens[tweens.length - 1];
        tweens.pop();
        tween.onDone?.();
      }
    }
  }

  /** Jump every running move to its end state (and run the completion callbacks). */
  finishAll(): void {
    const pending = this.tweens.splice(0, this.tweens.length);
    for (const tween of pending) {
      this.apply(tween, 1);
      tween.onDone?.();
    }
  }

  private start(
    kind: TweenKind,
    object: THREE.Object3D,
    delay: number,
    duration: number,
    depth: number,
    onDone: (() => void) | null
  ): void {
    const tween: Tween = {
      kind,
      object,
      delay,
      duration: Math.max(0.01, duration),
      time: 0,
      baseY: object.position.y,
      baseScaleX: object.scale.x,
      baseScaleY: object.scale.y,
      baseScaleZ: object.scale.z,
      depth,
      onDone,
    };
    this.tweens.push(tween);
  }

  private apply(tween: Tween, t: number): void {
    const { object } = tween;
    if (tween.kind === "pop") {
      const s = t >= 1 ? 1 : Math.max(HIDDEN_SCALE, easeOutBack(t));
      object.scale.set(tween.baseScaleX * s, tween.baseScaleY * s, tween.baseScaleZ * s);
    } else if (tween.kind === "rise") {
      object.visible = true;
      object.position.y = tween.baseY - tween.depth * (1 - easeOutCubic(t));
    } else {
      const eased = easeInCubic(t);
      object.position.y = tween.baseY - tween.depth * eased;
      const s = 1 - 0.12 * eased;
      object.scale.set(tween.baseScaleX * s, tween.baseScaleY * s, tween.baseScaleZ * s);
    }
  }
}
