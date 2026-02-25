import type { GameState, TeamRole } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";

interface TeamPanelProps {
  state: GameState;
}

const roles: { key: TeamRole; label: string }[] = [
  { key: "engineering", label: "Eng" },
  { key: "design", label: "Design" },
  { key: "marketing", label: "Mkt" },
  { key: "sales", label: "Sales" },
  { key: "ops", label: "Ops" },
];

export const TeamPanel = ({ state }: TeamPanelProps) => {
  const total = Object.values(state.team).reduce((a, b) => a + b, 0);
  const strain = total <= 4 ? "Low" : total <= 10 ? "Med" : "High";
  const strainClass = strain === "High" ? "text-red-400" : strain === "Med" ? "text-amber-300" : "text-emerald-400";

  return (
    <PanelCard title="Team">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {roles.map(({ key, label }) => (
          <span
            key={key}
            className={state.team[key] > 0 ? "text-slate-100/90" : "text-mist/40"}
            title="Headcount by function. More people means more output and more burn."
          >
            {label} {state.team[key]}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-white/5 pt-1">
        <span className="text-mist/60" title="Total team size. Hiring increases burn and can strain cohesion.">Headcount</span>
        <span className="tabular-nums">
          {total}
          <Delta current={total} previous={state.lastWeek.teamSize} />
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-mist/60" title="How hard it is for the founders to coordinate and manage the team.">Mgmt strain</span>
        <span className={`font-medium ${strainClass}`}>{strain}</span>
      </div>
    </PanelCard>
  );
};
