import type { Company } from "../../engine/types";
import type { OfficeMoveView } from "../careerPlan";
import { count, money } from "../format";
import { HINT, LABEL, TONE } from "../styles";
import type { PlanningView } from "../viewModel";
import type { Words } from "../words";

interface ProjectionCardProps {
  company: Company;
  view: PlanningView;
  words: Words;
  /** The office move the projected year brings; null in a race and in a year without one. */
  move: OfficeMoveView | null;
}

/** What the plan on screen is projected to do, and anything the player should know before ending the quarter or year. */
export const ProjectionCard = ({ company, view, words, move }: ProjectionCardProps) => {
  const { projection } = view;
  const moving = projection.costs.moving ?? 0;
  const cashTone = projection.cash < 0 ? TONE.danger : projection.cashFloor < 0 ? TONE.caution : "text-gray-100";
  return (
    <section aria-label="If this plan plays out" className="panel-surface rounded-xl p-3">
      <h2 className={LABEL}>If this plan plays out</h2>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Cash at {words.period} end</dt>
          <dd className={`text-right font-semibold tabular-nums ${cashTone}`}>
            at least {money(projection.cashFloor)} <span className="font-normal text-mist/70">· expected</span> {money(projection.cash)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Revenue ~ / costs</dt>
          <dd className="text-right tabular-nums text-gray-100">
            {money(projection.revenue)} <span className="text-mist/70">/</span> {money(projection.costs.total)}
            {moving > 0 && (
              <>
                {" "}
                <span className="text-mist/70">· Moving</span> {money(moving)}
              </>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Users ~</dt>
          <dd className="text-right tabular-nums text-gray-100">
            {count(company.users)} → {count(projection.users)}{" "}
            <span className="text-mist/70">
              (win {count(projection.usersWon)}, lose {count(projection.usersChurned)})
            </span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Runway after ~</dt>
          <dd className="text-right tabular-nums text-gray-100">{words.runway(projection.runway)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Team next {words.period} ~</dt>
          <dd className="text-right tabular-nums text-gray-100">{projection.headcount}</dd>
        </div>
        {words.career && move !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-mist">Office move</dt>
            <dd className="text-right tabular-nums text-gray-100">
              {move.from} → {move.to}, {money(move.bill)}
            </dd>
          </div>
        )}
      </dl>
      <p className={`${HINT} mt-2`}>~ depends on what your rivals do. The cash floor does not: it assumes you win no users at all.</p>

      {view.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-white/5 pt-3 text-xs" aria-label="About this plan">
          {view.warnings.map((warning) => (
            <li key={warning.text} className={`${TONE[warning.level]} leading-snug`}>
              {warning.level === "danger" ? "▲ " : warning.level === "caution" ? "△ " : "· "}
              {warning.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
