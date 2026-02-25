import type { GameState, TeamRole } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

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
        <span>{total}</span>
      </div>
    </PanelCard>
  );
};
