import type { Company } from "../../engine/types";
import { count, money, runwayText } from "../format";
import { HINT, LABEL, TONE } from "../styles";
import type { PlanningView } from "../viewModel";

interface ProjectionCardProps {
  company: Company;
  view: PlanningView;
}

/** What the plan on screen is projected to do, and anything the player should know before ending the quarter. */
export const ProjectionCard = ({ company, view }: ProjectionCardProps) => {
  const { projection } = view;
  const cashTone = projection.cash < 0 ? TONE.danger : projection.cashFloor < 0 ? TONE.caution : "text-gray-100";
  return (
    <section aria-label="If this plan plays out" className="panel-surface rounded-xl p-3">
      <h2 className={LABEL}>If this plan plays out</h2>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Cash at quarter end</dt>
          <dd className={`text-right font-semibold tabular-nums ${cashTone}`}>
            at least {money(projection.cashFloor)} <span className="font-normal text-mist/70">· expected</span> {money(projection.cash)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Revenue ~ / costs</dt>
          <dd className="text-right tabular-nums text-gray-100">
            {money(projection.revenue)} <span className="text-mist/70">/</span> {money(projection.costs.total)}
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
          <dd className="text-right tabular-nums text-gray-100">{runwayText(projection.runway)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-mist">Team next quarter ~</dt>
          <dd className="text-right tabular-nums text-gray-100">{projection.headcount}</dd>
        </div>
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
