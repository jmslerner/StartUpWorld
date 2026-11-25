/**
 * Every word the shell around the 3D view shows a player, in one place so that a test can read them. The shell is
 * what is on the page before the 3D code has loaded and when it cannot run at all.
 */
export const SHELL_WORDS = {
  /** In the view's place while the 3D code loads. */
  opening: "Opening the office…",
  /** Where the view would be, when this device cannot show it or it failed. */
  unavailable: "The 3D office cannot be shown on this device. The game is complete without it.",
} as const;

/** What the error boundary writes to the console (a developer reads it, not a player). */
export const SHELL_FAILURE_LOG = "[world] The 3D view failed and was switched off for this session.";
