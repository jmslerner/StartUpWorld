import { useId, useRef } from "react";
import type { CareerReportView } from "../careerReport";
import { count, money } from "../format";
import { BUTTON, LABEL, PRIMARY, TONE } from "../styles";
import { useDialog } from "../useDialog";
import type { ReportView } from "../viewModel";
import type { Words } from "../words";

interface YearSummaryProps {
  career: CareerReportView;
  view: ReportView;
  /** The player's career ended this year. */
  over: boolean;
  words: Words;
  /** Shows the full report in the same dialog. */
  onFull: () => void;
  onClose: () => void;
}

/** The year in brief: what a career's report opens on, before the full ledger. */
export const YearSummary = ({ career, view, over, words, onFull, onClose }: YearSummaryProps) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const close = useDialog(onClose, closeRef);
  // The headline is often the summary's first line: it is said once.
  const lines = career.summary.filter((line) => line !== career.headline);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-ink/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="mx-auto flex min-h-full w-full max-w-xl items-start px-3 py-4 sm:items-center sm:py-8">
        <article className="panel-surface terminal-scanlines w-full rounded-xl px-4 py-4 text-xs sm:px-6 sm:py-5">
          <header className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-2">
            <h2 id={titleId} className="text-sm font-semibold text-gray-100">
              {career.title}
            </h2>
            <span className={`${LABEL} shrink-0`}>The year in brief</span>
          </header>

          {career.headline !== null && <p className="mt-3 text-sm leading-relaxed text-gray-100">{career.headline}</p>}
          {career.headline === null && lines.length === 0 && <p className="mt-3 text-mist/70">No milestones this year.</p>}
          {lines.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-mist">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Cash at the year&apos;s end</dt>
              <dd className={`text-base font-semibold tabular-nums ${view.books.cashEnd < 0 ? TONE.danger : "text-gray-100"}`}>{money(view.books.cashEnd)}</dd>
            </div>
            <div>
              <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-mist/60">Users at the year&apos;s end</dt>
              <dd className="text-base font-semibold tabular-nums text-gray-100">{count(view.users.end)}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={onFull} className={`${BUTTON} px-4 py-2.5 text-sm`}>
              Full report
            </button>
            <button ref={closeRef} type="button" onClick={close} className={`${PRIMARY} flex-1`}>
              {over ? "See how it ended" : `Plan ${words.when(view.turn + 1)}`}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
};
