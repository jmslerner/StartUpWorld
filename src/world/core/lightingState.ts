import type * as THREE from "three";

/**
 * What the lighting is doing right now, for systems that want their own glows
 * to follow the time of day (monitors, desk lamps, signs, windows).
 *
 * Read it via `getLightingState(ctx.scene)`; never write to it.
 */
export interface LightingState {
  /**
   * 0 in full daylight, rising to 1 at dusk and staying there through the night.
   * Multiply emissive intensity by it (or lerp toward a "lit" colour with it).
   */
  duskAmount: number;
  /** How brightly the floor is lit, relative to a full-AP morning: 1 by day, ≈ 0.3 at dusk, ≈ 0.1 at night. */
  daylight: number;
}

const states = new WeakMap<THREE.Scene, LightingState>();

const stateFor = (scene: THREE.Scene): LightingState => {
  let state = states.get(scene);
  if (!state) {
    state = { duskAmount: 0, daylight: 1 };
    states.set(scene, state);
  }
  return state;
};

/**
 * The live lighting state for a scene. Always the same object for a given
 * scene, whenever it is first asked for, so it is safe to fetch once in a
 * constructor and read every frame. Scenes without a Lighting system (unit
 * tests, the prop gallery) simply stay at plain daylight.
 */
export const getLightingState = (scene: THREE.Scene): Readonly<LightingState> => stateFor(scene);

/** For the Lighting system only: the mutable state it publishes for `scene`. */
export const bindLightingState = (scene: THREE.Scene): LightingState => stateFor(scene);

/** For the Lighting system only: stop publishing for `scene` (readers see daylight again). */
export const releaseLightingState = (scene: THREE.Scene): void => {
  const state = states.get(scene);
  if (!state) return;
  state.duskAmount = 0;
  state.daylight = 1;
};
