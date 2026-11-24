import type { EventView } from "../viewModel";

interface EventBannerProps {
  event: EventView;
}

/** This quarter's event card. Its effects are already in the numbers on screen. */
export const EventBanner = ({ event }: EventBannerProps) => (
  <section aria-label="This quarter's event" className="panel-surface rounded-xl border-amber-400/30 px-3 py-2 text-xs">
    <span className="mr-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-amber-400">Event</span>
    <span className="font-semibold text-gray-100">{event.name}.</span> <span className="text-mist">{event.text}</span>
    {event.target !== null && <span className={event.targetIsYou ? "font-semibold text-amber-300" : "text-mist"}> {event.targetIsYou ? "It hit you." : `It hit ${event.target}.`}</span>}
  </section>
);
