/**
 * Every word the 3D view and the shell around it show a player, in one place so that a test can read them. The
 * shell is what is on the page before the 3D code has loaded and when it cannot run at all; the view's own words
 * are its description for a screen reader and what it says when it stops drawing.
 */
export const SHELL_WORDS = {
  /** In the view's place while the 3D code loads. */
  opening: "Opening the office…",
  /** Where the view would be, when this device cannot show it or it failed. */
  unavailable: "The 3D office cannot be shown on this device. The game is complete without it.",
  /** What the canvas is, for someone who cannot see it. */
  view: "A 3D view of the company's office and the people who work in it. The game is complete without it.",
  /** Over the view when its graphics context is lost: it shows its last picture, or nothing, until it is reloaded. */
  lost: "The 3D office stopped drawing. The game carries on without it.",
  /** The button under that line: a new canvas and a new world on it. */
  reload: "Reload 3D view",
} as const;

/** What the error boundary writes to the console (a developer reads it, not a player). */
export const SHELL_FAILURE_LOG = "[world] The 3D view failed and was switched off for this session.";
