import type { TimelineMark, TimelineView } from "../careerTimeline";

interface TimelineProps {
  view: TimelineView;
  /** The milestones to draw; the view's own when not given. The end screen passes the whole career's. */
  marks?: readonly TimelineMark[];
  /** Draw "you are here" at the view's year. A finished career has no "here": the end screen passes false. */
  here?: boolean;
}

/** Near the line's ends "you are here" hangs inwards, so its label is never cut off at the first or last years. */
const hereAnchor = (share: number): string =>
  share < 0.08 ? "items-start" : share > 0.92 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center";

const SR_ONLY = "sr-only";

/** One line from the first year to the last: the eras, history's end, the dated cards so far, the milestones, and where the year is. */
export const Timeline = ({ view, marks = view.marks, here = true }: TimelineProps) => {
  const span = view.lastYear - view.firstYear + 1;
  /** The middle of a year, as a share of the line. */
  const share = (year: number): number => (year - view.firstYear + 0.5) / span;
  const at = (year: number): string => `${(share(year) * 100).toFixed(3)}%`;
  const historyEdge = `${(((view.historyEnds - view.firstYear + 1) / span) * 100).toFixed(3)}%`;
  const showsHistoryEnd = view.historyEnds < view.lastYear;

  // Marks of the same year stack downwards so none hides another.
  const seen = new Map<number, number>();
  const placed = marks.map((mark) => {
    const index = seen.get(mark.year) ?? 0;
    seen.set(mark.year, index + 1);
    return { mark, index };
  });

  const listed = [
    ...view.cards.map((card) => ({ year: card.year, text: `${card.year}: ${card.name}`, card: true })),
    ...marks.map((mark) => ({ year: mark.year, text: `${mark.year}: ${mark.text}`, card: false })),
  ].sort((a, b) => a.year - b.year);

  return (
    <section aria-label="Timeline" className="panel-surface rounded-xl px-3 py-2.5">
      <div className="overflow-x-auto">
        <div className="relative min-w-[44rem] pb-3">
          <div className="flex gap-px">
            {view.eras.map((era) => (
              <div
                key={era.id}
                title={`${era.name}${era.invented ? " (imagined)" : ""}: ${era.firstYear} to ${era.lastYear}`}
                style={{ flexGrow: era.lastYear - era.firstYear + 1, flexBasis: 0 }}
                className={`min-w-0 rounded px-1.5 py-1 ${era.current ? "bg-neon/15 ring-1 ring-inset ring-neon/40" : era.invented ? "bg-steel/10" : "bg-steel/25"}`}
              >
                <div className={`text-[0.62rem] font-semibold leading-tight ${era.current ? "text-neon" : "text-gray-100"} ${era.invented ? "italic" : ""}`}>{era.name}</div>
                <div className="truncate text-[0.58rem] tabular-nums text-mist/70">
                  {era.firstYear}–{era.lastYear}
                </div>
              </div>
            ))}
          </div>

          <div className="relative mt-1 h-7">
            <div className="absolute inset-x-0 top-3 h-px bg-steel/60" />
            {view.cards.map((card) => (
              <span
                key={`card-${card.year}-${card.name}`}
                data-card-text=""
                title={`${card.year}: ${card.name}`}
                style={{ left: at(card.year) }}
                className={`absolute top-0.5 -translate-x-1/2 text-[0.7rem] leading-none ${card.shift ? "text-amber-400" : "text-mist"}`}
              >
                {card.shift ? "◇" : "|"}
              </span>
            ))}
            {placed.map(({ mark, index }) => (
              <span
                key={`mark-${mark.year}-${index}`}
                title={`${mark.year}: ${mark.text}`}
                style={{ left: at(mark.year), top: `${14 + index * 4}px` }}
                className={`absolute h-2 w-2 -translate-x-1/2 rounded-full ${mark.yours ? "bg-neon" : "bg-mist/60"}`}
              />
            ))}
            {here && (
              <span data-here="" style={{ left: at(view.year) }} className={`absolute top-0 flex flex-col ${hereAnchor(share(view.year))}`}>
                <span className="h-3 w-0.5 bg-neon" />
                <span className="whitespace-nowrap text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-neon">you are here</span>
              </span>
            )}
          </div>

          {showsHistoryEnd && (
            <div style={{ left: historyEdge }} className="pointer-events-none absolute inset-y-0 border-l border-dashed border-amber-400/60">
              <span className="absolute -bottom-0.5 left-1 whitespace-nowrap text-[0.55rem] uppercase tracking-[0.12em] text-amber-400/80">history ends</span>
            </div>
          )}
        </div>
      </div>

      {view.shift !== null && <p className="mt-1.5 text-[0.7rem] leading-snug text-amber-300">{view.shift.text}</p>}

      <ul aria-label="Milestones" className={SR_ONLY}>
        {listed.map((item, index) => (
          <li key={index} {...(item.card ? { "data-card-text": "" } : {})}>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
};
