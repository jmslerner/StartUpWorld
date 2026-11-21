import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The parts of the 3D view that live in the entry chunk: what the shell shows
 * while the world is loading, and what it shows instead when the world cannot
 * run. Nothing here may import three.js (directly or indirectly).
 */

/** Reserves the world viewport's space while the lazy chunk (three.js and the scene code) loads. */
export const WorldPlaceholder = () => (
  <div
    aria-hidden
    className="world-viewport grid h-full w-full place-items-center rounded-xl text-[0.7rem] uppercase tracking-widest text-mist/40"
  >
    Opening the office…
  </div>
);

/** One quiet line where the world would be. The game is fully playable without it. */
export const WorldUnavailableNote = () => (
  <div role="status" className="panel-surface rounded-xl px-3 py-1.5 text-[0.7rem] text-mist/70">
    3D view unavailable on this device — the terminal has everything.
  </div>
);

interface WorldBoundaryProps {
  children: ReactNode;
  /** Shown in place of the world after a failure. */
  fallback: ReactNode;
  /** Called once when the world fails, so the shell can give its space back to the terminal. */
  onError?: () => void;
}

interface WorldBoundaryState {
  failed: boolean;
}

/**
 * The world is a view; the game must outlive it. Without this, an error thrown
 * while rendering the 3D layer — or its chunk failing to download — would reach
 * the app-level error boundary, whose only way out is starting a new game.
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
    console.error("[world] The 3D view failed and was switched off for this session.", error, info.componentStack);
    this.props.onError?.();
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
