/**
 * When the labels over the market are placed again: right after each frame the world draws (the camera gliding in,
 * the buildings growing, a pan or a zoom), and on the next animation frame after anything else that can move them (a
 * resize, the company's card or the view switch changing). Nothing else: while the world rests and nothing changes, no
 * frame is asked for. Pure but for the frame requests it is handed.
 */

export interface AnimationFrames {
  request(callback: () => void): number;
  cancel(id: number): void;
}

export interface LabelFollower {
  /** The world drew a frame: place the labels now, over what it drew (and drop a placement still pending). */
  frameDrawn(): void;
  /** Something besides the world may have moved them: place them on the next animation frame, once however often asked. */
  wake(): void;
  /** No more placements; anything pending is cancelled. */
  stop(): void;
}

export const createLabelFollower = (place: () => void, frames: AnimationFrames): LabelFollower => {
  let pending: number | null = null;
  let stopped = false;
  const cancelPending = (): void => {
    if (pending === null) return;
    frames.cancel(pending);
    pending = null;
  };
  return {
    frameDrawn: () => {
      if (stopped) return;
      cancelPending();
      place();
    },
    wake: () => {
      if (stopped || pending !== null) return;
      pending = frames.request(() => {
        pending = null;
        if (!stopped) place();
      });
    },
    stop: () => {
      stopped = true;
      cancelPending();
    },
  };
};
