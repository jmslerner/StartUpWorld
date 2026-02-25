import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface GrowthPanelProps {
  state: GameState;
}

export const GrowthPanel = ({ state }: GrowthPanelProps) => (
  <PanelCard title="Growth">
    <div className="flex items-center justify-between">
      <span>Weekly Burn</span>
      <span>${state.burn.toLocaleString()}</span>
    </div>
    <div className="flex items-center justify-between">
      <span>Reputation</span>
      <span>{state.reputation}/100</span>
    </div>
    <p className="text-xs text-mist/80">Campaigns boost users but raise burn.</p>
  </PanelCard>
);
