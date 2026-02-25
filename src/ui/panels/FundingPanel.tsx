import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface FundingPanelProps {
  state: GameState;
}

export const FundingPanel = ({ state }: FundingPanelProps) => {
  const runway = state.burn > 0 ? Math.floor(state.cash / state.burn) : 0;
  return (
    <PanelCard title="Funding">
      <div className="flex items-center justify-between">
        <span>Cash</span>
        <span>${state.cash.toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between">
        <span>Runway</span>
        <span>{runway} weeks</span>
      </div>
      <p className="text-xs text-mist/80">Pitch investors or raise a seed round.</p>
    </PanelCard>
  );
};
