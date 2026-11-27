import { useState, type ReactNode } from "react";
import type { Company, Department, Plan, PriceTier, RulesConfig } from "../../engine/types";
import { assignEveryone, setLayoffs, setRaise, stepDepartment, stepHireLimit, stepMarketing } from "../draft";
import type { CareerHiringView } from "../careerHiring";
import type { ListingView } from "../careerPlan";
import { careerCanIncrease, careerStepDepartment, dropMove, moveNote, NO_MOVES, noteMove, type MoveNotes } from "../careerTeam";
import { money, percent } from "../format";
import { BUTTON, HINT, LABEL, TONE } from "../styles";
import type { PlanningView } from "../viewModel";
import type { Words } from "../words";
import { GoPublicRow } from "./GoPublicRow";
import { Segmented } from "./Segmented";
import { Stepper } from "./Stepper";

const TIER_NAME: Record<PriceTier, string> = { budget: "Budget", standard: "Standard", premium: "Premium" };
const DEPARTMENT_NAME: Record<Department, string> = { product: "Product", growth: "Growth", recruiting: "Recruiting" };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How a price tier differs from the plain one, from the config's own numbers. */
const tierEffect = (pullFactor: number, churnDelta: number): string => {
  const pull = pullFactor === 1 ? "normal pull" : `${percent(Math.abs(pullFactor - 1))} ${pullFactor > 1 ? "more" : "less"} pull`;
  const points = Math.round(Math.abs(churnDelta) * 100);
  const churn = churnDelta === 0 ? "normal churn" : `churn ${plural(points, "point", "points")} ${churnDelta < 0 ? "lower" : "higher"}`;
  return `${pull}, ${churn}`;
};

interface RowProps {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** A control with its name and fine print on the left. */
const Row = ({ title, hint, children }: RowProps) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <div className="text-sm text-gray-100">{title}</div>
      {hint !== undefined && <div className={HINT}>{hint}</div>}
    </div>
    {children}
  </div>
);

interface PlanningPanelProps {
  company: Company;
  turn: number;
  draft: Plan;
  view: PlanningView;
  /** The year's rules in a career. */
  config: RulesConfig;
  words: Words;
  /** Going public as the plan offers it; null in a race. */
  listing: ListingView | null;
  /** A career: "+" moves someone from another team. The race never passes it. */
  career?: boolean;
  /** A career's hiring words. The race never passes it. */
  hiring?: CareerHiringView | null;
  onChange: (plan: Plan) => void;
}

/** The player's plan for the coming quarter or year. What it is projected to do is shown by ProjectionCard. */
export const PlanningPanel = ({ company, turn, draft, view, config, words, listing, career, hiring, onChange }: PlanningPanelProps) => {
  const { projection } = view;
  // Where people moved by the career's "+" came from, for this year only.
  const [moves, setMoves] = useState<{ turn: number; notes: MoveNotes }>({ turn, notes: NO_MOVES });
  const notes = moves.turn === turn ? moves.notes : NO_MOVES;
  const stepTeam = (department: Department, delta: 1 | -1): void => {
    if (career !== true) {
      onChange(stepDepartment(company, draft, department, delta));
      return;
    }
    const step = careerStepDepartment(company, draft, department, delta);
    if (step.plan === draft) return;
    const next = step.from !== null ? noteMove(notes, step.from, department) : delta < 0 ? dropMove(notes, department) : notes;
    setMoves({ turn, notes: next });
    onChange(step.plan);
  };
  const teamHint = (department: Department): string => {
    const note = career === true ? moveNote(notes, department) : null;
    return note === null ? departmentHint[department] : `${departmentHint[department]} · ${note}`;
  };
  const capacity = view.hiring.capacity;
  const { hireLimit } = draft;
  // A number is a limit the player set and it stays put; "no limit" follows what recruiting can find.
  const limitNote =
    hireLimit === null
      ? `No limit: as many as recruiting can find, ${capacity} this ${words.period}. `
      : hireLimit > capacity
        ? `Recruiting can only find ${capacity} this ${words.period}. `
        : "";
  const chosenRaise = view.raise.options.find((option) => option.selected);
  const selectedTier = view.prices.find((tier) => tier.selected);

  const departmentHint: Record<Department, string> = {
    product: `quality ${Math.floor(company.quality)} → ${Math.floor(projection.quality)}`,
    growth: `+${percent(config.pull.growthCoefficient * projection.work.growth)} pull`,
    recruiting: capacity === 0 ? "no hires" : `up to ${plural(capacity, "hire", "hires")}`,
  };

  return (
    <section aria-label={`Plan for ${words.when(turn)}`} className="panel-surface rounded-xl p-3">
      <h2 className={LABEL}>Plan for {words.when(turn)}</h2>

      {/* ── Team ── */}
      <div className="mt-3 space-y-2">
        {(["product", "growth", "recruiting"] as const).map((department) => (
          <Row key={department} title={DEPARTMENT_NAME[department]} hint={teamHint(department)}>
            <Stepper
              label={DEPARTMENT_NAME[department]}
              value={draft.allocation[department]}
              onStep={(delta) => stepTeam(department, delta)}
              canDecrease={draft.allocation[department] > 0}
              canIncrease={career === true ? careerCanIncrease(company, draft, department) : view.unassigned > 0}
            />
          </Row>
        ))}
        <div className={`${HINT} flex items-center justify-between gap-2`}>
          <span>
            {plural(view.available, "person", "people")} to assign
            {view.unassigned > 0 && <span className={TONE.caution}>, {view.unassigned} unassigned</span>}. Together they do the work of {view.workDone.toFixed(1)}.
          </span>
          {view.unassigned > 0 && (
            <button type="button" onClick={() => onChange(assignEveryone(company, draft))} className={`${BUTTON} shrink-0 px-2 py-1 text-[0.7rem]`}>
              Assign all
            </button>
          )}
        </div>
        {hiring?.teamLine != null && <p className={HINT}>{hiring.teamLine}</p>}
        {capacity > 0 && (
          <Row
            title="Hire at most"
            hint={
              hiring == null
                ? `${limitNote}${money(view.hiring.fee)} fee each, then ${money(config.salary)} a ${words.period} in salary; they start next ${words.period}. ${plural(view.hiring.candidates, "candidate", "candidates")} this ${words.period}, most hype picks first: expect ${view.hiring.expected}.`
                : `${limitNote}${hiring.hireText}`
            }
          >
            <Stepper
              label="Hire at most"
              value={hireLimit ?? "No limit"}
              valueClassName="w-[4.5rem]"
              onStep={(delta) => onChange(stepHireLimit(draft, delta, capacity))}
              canDecrease={hireLimit === null || hireLimit > 0}
              canIncrease={hireLimit !== null}
            />
          </Row>
        )}
      </div>

      {/* ── Marketing ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <Row
          title="Marketing"
          hint={
            <>
              {draft.marketing === 0 ? `No spend this ${words.period}.` : `+${percent(view.marketing.pull)} pull. Each extra dollar does less.`}
              {view.marketing.effect !== 1 && (
                <span className={view.marketing.effect < 1 ? TONE.caution : TONE.good}> This {words.period}&apos;s event: marketing is {percent(view.marketing.effect)} as effective.</span>
              )}
            </>
          }
        >
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Marketing: four steps less" disabled={draft.marketing <= 0} onClick={() => onChange(stepMarketing(draft, -4, config, view.marketing.max))} className={`${BUTTON} hidden h-9 px-2 text-xs sm:block`}>
              −−
            </button>
            <Stepper
              label="Marketing"
              value={money(draft.marketing)}
              valueClassName="w-16"
              onStep={(delta) => onChange(stepMarketing(draft, delta, config, view.marketing.max))}
              canDecrease={draft.marketing > 0}
              canIncrease={draft.marketing < view.marketing.max}
            />
            <button
              type="button"
              aria-label="Marketing: four steps more"
              disabled={draft.marketing >= view.marketing.max}
              onClick={() => onChange(stepMarketing(draft, 4, config, view.marketing.max))}
              className={`${BUTTON} hidden h-9 px-2 text-xs sm:block`}
            >
              ++
            </button>
          </div>
        </Row>
      </div>

      {/* ── Price ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="mb-1.5 text-sm text-gray-100">Price</div>
        <Segmented
          label="Price"
          selected={draft.price}
          onSelect={(tier) => onChange({ ...draft, price: tier })}
          options={view.prices.map((tier) => ({ key: tier.tier, label: TIER_NAME[tier.tier], sub: `$${tier.price} a user` }))}
          mobileColumns={3}
        />
        {selectedTier !== undefined && (
          <p className={`${HINT} mt-1.5`}>
            {TIER_NAME[selectedTier.tier]}: {tierEffect(selectedTier.pullFactor, selectedTier.churnDelta)}. Changing price is free.
          </p>
        )}
      </div>

      {/* ── Raise ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="mb-1.5 text-sm text-gray-100">Raise money</div>
        <Segmented
          label="Raise money"
          selected={draft.raisePercent}
          onSelect={(option) => onChange(setRaise(company, draft, option))}
          options={[
            { key: 0, label: "No raise" },
            ...view.raise.options.map((option) => ({ key: option.percent, label: `Sell ${option.percent}%`, sub: money(option.amount), disabled: view.raise.blocked !== null, title: view.raise.blockedText ?? undefined })),
          ]}
        />
        <p className={`${HINT} mt-1.5`}>
          {view.raise.blockedText ??
            (chosenRaise !== undefined
              ? `Leaves you ${percent(chosenRaise.equityAfter)} and gives investors a seat (board ${company.founderSeats}–${chosenRaise.investorSeatsAfter}). One of your people spends the ${words.period} on it. No raise for the ${plural(config.raise.cooldownTurns, words.period, words.periods)} after.`
              : `Priced on a ${money(view.raise.valuation)} valuation. Every raise adds an investor to your board.`)}
        </p>
      </div>

      {/* ── Go public: a career only ── */}
      {listing !== null && (
        <div className="mt-4 border-t border-white/5 pt-3">
          <div className="mb-1.5 text-sm text-gray-100">Go public</div>
          <GoPublicRow listing={listing} company={company} draft={draft} onChange={onChange} />
        </div>
      )}

      {/* ── Poach ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="mb-1.5 text-sm text-gray-100">Poach from a rival</div>
        <Segmented
          label="Poach from a rival"
          selected={draft.poachTarget ?? -1}
          onSelect={(id) => onChange({ ...draft, poachTarget: id === -1 ? null : id })}
          options={[
            { key: -1, label: "Nobody" },
            ...view.poach.options.map((option) => ({ key: option.id, label: option.name, sub: option.allowed ? `${percent(option.chance)} odds` : "too small", disabled: !option.allowed, title: option.reason ?? undefined })),
          ]}
        />
        <p className={`${HINT} mt-1.5`}>{money(view.poach.cost)} an attempt, win or lose. If it works, one of their people joins you next {words.period}.</p>
      </div>

      {/* ── Lay off ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <Row
          title="Lay off"
          hint={
            draft.layoffs > 0
              ? `${money(view.layoffs.severance * draft.layoffs)} severance and ${view.layoffs.hype} hype. They leave before the ${words.period}'s work.`
              : `${money(view.layoffs.severance)} severance each, and ${view.layoffs.hype} hype.`
          }
        >
          <Stepper label="Lay off" value={draft.layoffs} onStep={(delta) => onChange(setLayoffs(company, draft, draft.layoffs + delta))} canDecrease={draft.layoffs > 0} canIncrease={draft.layoffs < view.layoffs.max} />
        </Row>
      </div>
    </section>
  );
};
