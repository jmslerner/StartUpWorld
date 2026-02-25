import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface ProductPanelProps {
  state: GameState;
}

export const ProductPanel = ({ state }: ProductPanelProps) => (
  <PanelCard title="Product">
    <div className="flex items-center justify-between">
      <span>MRR</span>
      <span>${state.mrr.toLocaleString()}</span>
    </div>
    <div className="flex items-center justify-between">
      <span>Users</span>
      <span>{state.users.toLocaleString()}</span>
    </div>
    <p className="text-xs text-mist/80">Ship features to raise reputation and MRR.</p>
  </PanelCard>
);
