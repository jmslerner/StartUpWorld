import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[StartupWorld] Uncaught error:", error, info.componentStack);
  }

  handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-slate-100">
        <div className="panel-surface mx-auto w-full max-w-lg rounded-xl px-6 py-8">
          <h1 className="mb-2 text-lg font-bold tracking-wide text-red-400">
            === CRASH ===
          </h1>
          <p className="mb-4 text-sm text-mist/80">
            Something went wrong. Your startup just experienced a critical failure.
          </p>
          {this.state.error && (
            <pre className="mb-4 max-h-32 overflow-auto rounded bg-black/40 px-3 py-2 text-xs text-red-300/70">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-lg bg-neon/10 px-4 py-2 text-sm font-semibold text-neon hover:bg-neon/20"
          >
            Try Again (New Game)
          </button>
        </div>
      </div>
    );
  }
}
