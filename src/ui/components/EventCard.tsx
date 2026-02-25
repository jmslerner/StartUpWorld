import type { PendingEvent } from "../../types/game";

interface EventCardProps {
  event: PendingEvent;
}

export const EventCard = ({ event }: EventCardProps) => (
  <div className="panel-surface rounded-xl border-l-2 border-amber-400/60 px-4 py-3 text-xs">
    <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-widest text-amber-300/80">
      Event
    </div>
    <div className="mb-2 text-sm font-medium text-slate-100">{event.title}</div>
    <div className="mb-2 text-mist/80">{event.prompt}</div>
    <div className="space-y-1">
      {event.choices.map((c, i) => (
        <div key={c.id} className="text-mist">
          <span className="text-amber-300">{i + 1})</span> {c.text}
        </div>
      ))}
    </div>
    <div className="mt-2 text-mist/50">Type <span className="text-neon">choose 1</span>, <span className="text-neon">choose 2</span>, etc.</div>
  </div>
);
