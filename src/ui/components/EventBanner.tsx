import type { EventView } from "../viewModel";
import type { Words } from "../words";

interface EventBannerProps {
  event: EventView;
  words: Words;
  /** The year a dated card in force belongs to; null for a random draw, and always in a race. */
  datedYear: number | null;
  /** The timeline's last year of history; null in a race. A dated year after it is ahead of history. */
  historyEnds: number | null;
}

/** This period's event card. Its effects are already in the numbers on screen. */
export const EventBanner = ({ event, words, datedYear, historyEnds }: EventBannerProps) => {
  const label = datedYear === null ? "Event" : `${historyEnds !== null && datedYear > historyEnds ? "Ahead" : "History"} ${datedYear}`;
  return (
    <section aria-label={`This ${words.period}'s event`} className="panel-surface rounded-xl border-amber-400/30 px-3 py-2 text-xs">
      <span className="mr-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-amber-400">{label}</span>
      <span data-card-text="" className="font-semibold text-gray-100">
        {event.name}.
      </span>{" "}
      <span data-card-text="" className="text-mist">
        {event.text}
      </span>
      {event.target !== null && <span className={event.targetIsYou ? "font-semibold text-amber-300" : "text-mist"}> {event.targetIsYou ? "It hit you." : `It hit ${event.target}.`}</span>}
    </section>
  );
};
