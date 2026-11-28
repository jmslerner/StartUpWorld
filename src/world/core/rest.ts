/**
 * When the drawing loop may stop.
 *
 * The world is redrawn only while something changes: a frame is drawn while this state is `running`, and it stops
 * running once a whole second has passed in which no system and no camera moved and nobody asked for a frame.
 * At rest nothing is drawn and no frame is requested; the next thing that happens (a new scene, a pointer, a new
 * size) wakes it. The second of grace is what lets the people's idle poses, a hover and the highlights settle
 * before the picture freezes.
 *
 * Pure: the frame loop (./FrameLoop.ts) feeds it once per frame and acts on what comes back.
 */

/** How long nothing has to move before the loop stops drawing. */
export const REST_AFTER_SECONDS = 1;

export interface RestState {
  /** Frames are being drawn. */
  readonly running: boolean;
  /** Seconds since anything last moved or asked for a frame. */
  readonly quiet: number;
}

/** Running, with nothing quiet behind it: how a loop starts, and what waking gives. */
export const AWAKE: RestState = Object.freeze({ running: true, quiet: 0 });

/**
 * One frame's worth: `busy` is whether any system or the camera is still moving, `woken` whether something asked
 * for a frame. `dt` is taken as given (the loop hands it the frame's length on the page's clock); a length that
 * is not a positive, finite number adds no quiet.
 */
export const restStep = (
  state: RestState,
  frame: { readonly dt: number; readonly busy: boolean; readonly woken: boolean }
): RestState => {
  if (frame.busy || frame.woken) return AWAKE;
  if (!state.running) return state;
  if (!(frame.dt > 0) || !Number.isFinite(frame.dt)) return state;
  const quiet = state.quiet + frame.dt;
  return { running: quiet < REST_AFTER_SECONDS, quiet };
};
