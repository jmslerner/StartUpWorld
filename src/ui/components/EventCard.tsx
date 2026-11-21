import type { PendingEvent } from "../../types/game";
import { stripTypewriterTokens } from "../terminal/tokens";

interface EventCardProps {
  event: PendingEvent;
  /** Runs a terminal command; each choice is a button for `choose <n>`. */
  runCommand: (input: string) => void;
  /**
   * Tighter layout for when the card shares the screen with the 3D world: every
   * row it gives up is a row the office and the terminal keep. The typed-command
   * hint goes, because each button already shows its command.
   */
  compact?: boolean;
}

export const EventCard = ({ event, runCommand, compact = false }: EventCardProps) => (
  <div
    data-event-card
    className={`panel-surface rounded-xl border-l-2 border-amber-400/60 text-xs ${compact ? "px-3 py-2 short:py-1.5" : "px-4 py-3"}`}
  >
    {compact ? (
      // Title and prompt share one paragraph; the choices sit side by side when there is room.
      <div className="mb-1.5 leading-snug">
        <span className="mr-2 text-[0.6rem] font-semibold uppercase tracking-widest text-amber-300/80">Event</span>
        <span className="mr-2 text-sm font-medium text-slate-100">{event.title}</span>
        <span className="text-mist/80">{stripTypewriterTokens(event.prompt)}</span>
      </div>
    ) : (
      <>
        <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-widest text-amber-300/80">
          Event
        </div>
        <div className="mb-2 text-sm font-medium text-slate-100">{event.title}</div>
        <div className="mb-2 text-mist/80">{stripTypewriterTokens(event.prompt)}</div>
      </>
    )}
    <div className={compact ? "grid gap-1 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]" : "flex flex-col gap-1"}>
      {event.choices.map((c, i) => (
        <button
          key={c.id}
          type="button"
          title={`Runs: choose ${i + 1}`}
          // Keep keyboard focus in the terminal: the press must not move it here.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand(`choose ${i + 1}`)}
          className={`flex w-full items-baseline gap-2 rounded-lg bg-steel/30 px-2 text-left text-mist transition-colors hover:bg-amber-400/10 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-300 ${
            compact ? "py-1" : "py-1.5"
          }`}
        >
          <span className="shrink-0 text-amber-300">{i + 1})</span>
          <span className="min-w-0 flex-1">{stripTypewriterTokens(c.text)}</span>
          {/* The typed command the button runs. In the compact card it gives way on
              phones and short windows, where every line counts (the title still says it). */}
          <span
            aria-hidden
            className={`shrink-0 font-mono text-[0.68rem] text-neon/70 ${compact ? "hidden sm:inline short:hidden" : ""}`}
          >
            &gt; choose {i + 1}
          </span>
        </button>
      ))}
    </div>
    {compact ? null : (
      <div className="mt-2 text-mist/50">Type <span className="text-neon">choose 1</span>, <span className="text-neon">choose 2</span>, etc.</div>
    )}
  </div>
);
