import type { ReactNode } from "react";
import type { Company, Department, Plan, PriceTier, RulesConfig } from "../../engine/types";
import { assignEveryone, setLayoffs, setRaise, stepDepartment, stepHireLimit, stepMarketing } from "../draft";
import { money, percent, quarter } from "../format";
import { BUTTON, HINT, LABEL, TONE } from "../styles";
import type { PlanningView } from "../viewModel";
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
  config: RulesConfig;
  onChange: (plan: Plan) => void;
}

/** The player's plan for the coming quarter. What it is projected to do is shown by ProjectionCard. */
export const PlanningPanel = ({ company, turn, draft, view, config, onChange }: PlanningPanelProps) => {
  const { projection } = view;
  const capacity = view.hiring.capacity;
  const { hireLimit } = draft;
  // A number is a limit the player set and it stays put; "no limit" follows what recruiting can find.
  const limitNote =
    hireLimit === null
      ? `No limit: as many as recruiting can find, ${capacity} this quarter. `
      : hireLimit > capacity
        ? `Recruiting can only find ${capacity} this quarter. `
        : "";
  const marketingPull = config.pull.marketingCoefficient * Math.sqrt(draft.marketing / config.pull.marketingStep) * (view.marketing.halved ? 0.5 : 1);
  const chosenRaise = view.raise.options.find((option) => option.selected);
  const selectedTier = view.prices.find((tier) => tier.selected);

  const departmentHint: Record<Department, string> = {
    product: `quality ${Math.floor(company.quality)} → ${Math.floor(projection.quality)}`,
    growth: `+${percent(config.pull.growthCoefficient * projection.work.growth)} pull`,
    recruiting: capacity === 0 ? "no hires" : `up to ${plural(capacity, "hire", "hires")}`,
  };

  return (
    <section aria-label={`Plan for ${quarter(turn)}`} className="panel-surface rounded-xl p-3">
      <h2 className={LABEL}>Plan for {quarter(turn)}</h2>

      {/* ── Team ── */}
      <div className="mt-3 space-y-2">
        {(["product", "growth", "recruiting"] as const).map((department) => (
          <Row key={department} title={DEPARTMENT_NAME[department]} hint={departmentHint[department]}>
            <Stepper
              label={DEPARTMENT_NAME[department]}
              value={draft.allocation[department]}
              onStep={(delta) => onChange(stepDepartment(company, draft, department, delta))}
              canDecrease={draft.allocation[department] > 0}
              canIncrease={view.unassigned > 0}
            />
          </Row>
        ))}
        <div className={`${HINT} flex items-center justify-between gap-2`}>
          <span>
            {plural(view.available, "person", "people")} to assign
            {view.unassigned > 0 && <span className={TONE.caution}>, {view.unassigned} unassigned</span>}. Together they do the work of {projection.work.effective.toFixed(1)}.
          </span>
          {view.unassigned > 0 && (
            <button type="button" onClick={() => onChange(assignEveryone(company, draft))} className={`${BUTTON} shrink-0 px-2 py-1 text-[0.7rem]`}>
              Assign all
            </button>
          )}
        </div>
        {capacity > 0 && (
          <Row
            title="Hire at most"
            hint={`${limitNote}${money(view.hiring.fee)} fee each, then ${money(config.salary)} a quarter in salary; they start next quarter. ${plural(view.hiring.candidates, "candidate", "candidates")} this quarter, most hype picks first: expect ${view.hiring.expected}.`}
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
              {draft.marketing === 0 ? "No spend this quarter." : `+${percent(marketingPull)} pull. Each extra dollar does less.`}
              {view.marketing.halved && <span className={TONE.caution}> Ad prices spiked: half as effective this quarter.</span>}
            </>
          }
        >
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Marketing: four steps less" disabled={draft.marketing <= 0} onClick={() => onChange(stepMarketing(draft, -4, config))} className={`${BUTTON} hidden h-9 px-2 text-xs sm:block`}>
              −−
            </button>
            <Stepper
              label="Marketing"
              value={money(draft.marketing)}
              valueClassName="w-16"
              onStep={(delta) => onChange(stepMarketing(draft, delta, config))}
              canDecrease={draft.marketing > 0}
              canIncrease={draft.marketing < view.marketing.max}
            />
            <button
              type="button"
              aria-label="Marketing: four steps more"
              disabled={draft.marketing >= view.marketing.max}
              onClick={() => onChange(stepMarketing(draft, 4, config))}
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
              ? `Leaves you ${percent(chosenRaise.equityAfter)} and gives investors a seat (board ${company.founderSeats}–${chosenRaise.investorSeatsAfter}). One of your people spends the quarter on it. No raise for the ${plural(config.raise.cooldownTurns, "quarter", "quarters")} after.`
              : `Priced on a ${money(view.raise.valuation)} valuation. Every raise adds an investor to your board.`)}
        </p>
      </div>

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
        <p className={`${HINT} mt-1.5`}>{money(view.poach.cost)} an attempt, win or lose. If it works, one of their people joins you next quarter.</p>
      </div>

      {/* ── Lay off ── */}
      <div className="mt-4 border-t border-white/5 pt-3">
        <Row
          title="Lay off"
          hint={
            draft.layoffs > 0
              ? `${money(view.layoffs.severance * draft.layoffs)} severance and ${view.layoffs.hype} hype. They leave before the quarter's work.`
              : `${money(view.layoffs.severance)} severance each, and ${view.layoffs.hype} hype.`
          }
        >
          <Stepper label="Lay off" value={draft.layoffs} onStep={(delta) => onChange(setLayoffs(company, draft, draft.layoffs + delta))} canDecrease={draft.layoffs > 0} canIncrease={draft.layoffs < view.layoffs.max} />
        </Row>
      </div>
    </section>
  );
};
