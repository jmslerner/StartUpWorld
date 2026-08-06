interface FetchErrorProps {
  message: string;
  onRetry?: () => void;
}

export const FetchError = ({ message, onRetry }: FetchErrorProps) => (
  <div className="flex flex-col items-center gap-3 py-8 text-center">
    <div className="max-w-xs text-xs leading-relaxed text-mist/60">{message}</div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="rounded bg-steel/30 px-3 py-1.5 text-xs text-mist/80 transition hover:bg-steel/50"
      >
        Try again
      </button>
    )}
  </div>
);
