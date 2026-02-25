import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface CompanyPanelProps {
  state: GameState;
}

export const CompanyPanel = ({ state }: CompanyPanelProps) => (
  <PanelCard title="Company">
    <div className="flex items-center justify-between">
      <span>Stage</span>
      <span className="text-neon">{state.stage}</span>
    </div>
    <div className="flex items-center justify-between">
      <span>Reputation</span>
      <span>{state.reputation}/100</span>
    </div>
  </PanelCard>
);
