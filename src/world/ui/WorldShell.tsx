import { Component, type ErrorInfo, type ReactNode } from "react";
import "../world.css";
import { SHELL_FAILURE_LOG, SHELL_WORDS } from "./shellWords";

/**
 * The parts of the 3D view that are on the page before the world is: what is shown while the world's code loads,
 * and what is shown instead when the world cannot run. Nothing here may import three.js (directly or indirectly),
 * so a page can show these at once and load the world lazily. The words are in ./shellWords.ts and the looks in
 * ../world.css, which this file brings in so that they load with the world's shell and with nothing else.
 */

/** Reserves the world viewport's space while the lazy chunk (three.js and the scene code) loads. */
export const WorldPlaceholder = () => (
  <div aria-hidden className="world-viewport world-placeholder">
    {SHELL_WORDS.opening}
  </div>
);

/** One quiet line where the world would be. The game is complete without it. */
export const WorldUnavailableNote = () => (
  <div role="status" className="world-note">
    {SHELL_WORDS.unavailable}
  </div>
);

interface WorldBoundaryProps {
  children: ReactNode;
  /** Shown in place of the world after a failure. */
  fallback: ReactNode;
  /** Called once when the world fails, so the page can give its space to something else. */
  onError?: () => void;
}

interface WorldBoundaryState {
  failed: boolean;
}

/**
 * The world is a view; the page must outlive it. Without this, an error thrown while rendering the 3D layer, or
 * its chunk failing to download, would reach the page's own error boundary and take everything else down with it.
 */
export class WorldBoundary extends Component<WorldBoundaryProps, WorldBoundaryState> {
  constructor(props: WorldBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): WorldBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(SHELL_FAILURE_LOG, error, info.componentStack);
    this.props.onError?.();
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
