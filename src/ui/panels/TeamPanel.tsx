import type { GameState, TeamRole } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";
import { Tooltip } from "../components/Tooltip";

interface TeamPanelProps {
  state: GameState;
}

const roles: { key: TeamRole; label: string }[] = [
  { key: "engineering", label: "Eng" },
  { key: "design", label: "Design" },
  { key: "marketing", label: "Mkt" },
  { key: "sales", label: "Sales" },
  { key: "ops", label: "Ops" },
  { key: "hr", label: "HR" },
  { key: "legal", label: "Legal" },
];

const roleTips: Record<TeamRole, string> = {
  engineering: "Builds product faster. More output, more burn.",
  design: "Improves UX and feature quality. Higher conversion/retention potential, more burn.",
  marketing: "Drives demand and top-of-funnel. Can outpace delivery if over-hired.",
  sales: "Turns demand into revenue. Can increase burn and stress if product/ops can't keep up.",
  ops: "Reduces churn/drag and keeps the org running. Adds cost but prevents chaos.",
  hr: "Helps scale hiring and reduces people issues. Adds process overhead.",
  legal: "Reduces legal risk and contract friction. Adds cost.",
};

export const TeamPanel = ({ state }: TeamPanelProps) => {
  const total = Object.values(state.team).reduce((a, b) => a + b, 0);
  const strain = total <= 4 ? "Low" : total <= 10 ? "Med" : "High";
  const strainClass = strain === "High" ? "text-red-400" : strain === "Med" ? "text-amber-300" : "text-emerald-400";

  return (
    <PanelCard title="Team">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-center">
        {roles.map(({ key, label }) => (
          <Tooltip key={key} content={roleTips[key]} align="right">
            <span className={state.team[key] > 0 ? "text-slate-100/90" : "text-mist/40"}>
              {label} {state.team[key]}
            </span>
          </Tooltip>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
        <div className="text-center">
          <span className="text-mist/60" title="Total team size. Hiring increases burn and can strain cohesion.">Headcount</span>
          <div className="tabular-nums">
            {total}
            <Delta current={total} previous={state.lastWeek.teamSize} />
          </div>
        </div>
        <div className="text-center">
          <span className="text-mist/60" title="How hard it is for the founders to coordinate and manage the team.">Mgmt strain</span>
          <div className={`font-medium ${strainClass}`}>{strain}</div>
        </div>
      </div>
    </PanelCard>
  );
};
