import type { GameState, TeamRole } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface TeamPanelProps {
  state: GameState;
}

const roleLabel: Record<TeamRole, string> = {
  engineering: "Engineering",
  design: "Design",
  marketing: "Marketing",
  sales: "Sales",
  ops: "Ops",
};

export const TeamPanel = ({ state }: TeamPanelProps) => (
  <PanelCard title="Team">
    {Object.entries(state.team).map(([role, count]) => (
      <div key={role} className="flex items-center justify-between">
        <span>{roleLabel[role as TeamRole]}</span>
        <span>{count}</span>
      </div>
    ))}
  </PanelCard>
);
