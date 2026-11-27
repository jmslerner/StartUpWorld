import type { CareerStatusView } from "../careerTimeline";
import { TONE } from "../styles";

interface CareerStatusProps {
  view: CareerStatusView;
}

/** The year's status on one line: the era, the office and the next one, and what the company has used up. */
export const CareerStatus = ({ view }: CareerStatusProps) => {
  const { office, nextOffice } = view;
  const parts = [
    `${view.eraName}${view.invented ? " (imagined)" : ""}`,
    `${office.name}: ${office.headcount} of ${office.capacity} people`,
    nextOffice === null ? "No bigger office to move to" : `Next: ${nextOffice.name}, up to ${nextOffice.capacity} people`,
    view.listedYear === null ? "Private" : `Public since ${view.listedYear}`,
    view.rescueYear === null ? "Rescue not used" : `Rescue used in ${view.rescueYear}`,
  ];
  return (
    <section aria-label="Your career" data-tutorial="status" className="panel-surface flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-xs text-mist">
      {parts.map((part, index) => (
        <span key={index} className={index === 0 ? "font-semibold text-gray-100" : undefined}>
          {index > 0 && <span className="mr-2 text-mist/40">·</span>}
          {part}
        </span>
      ))}
      {view.boardPaused && (
        <span className={TONE.note}>
          <span className="mr-2 text-mist/40">·</span>
          After the rescue your board does not vote this year.
        </span>
      )}
    </section>
  );
};
