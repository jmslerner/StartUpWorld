import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Gauge } from "../components/Gauge";

interface HealthPanelProps {
  state: GameState;
}

export const HealthPanel = ({ state }: HealthPanelProps) => (
  <PanelCard title="Health">
    <Gauge label="Morale" value={state.culture.morale} color="green" />
    <Gauge label="Cohesion" value={state.culture.cohesion} color="neon" />
    <Gauge label="Stress" value={state.stress} color={state.stress > 60 ? "red" : "ember"} />
    <Gauge label="Volatility" value={state.volatility} color={state.volatility > 60 ? "red" : "ember"} />
    <div className="mt-1 flex items-center justify-between border-t border-white/5 pt-1">
      <span className="text-mist/60">Reputation</span>
      <span>{state.reputation}/100</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-mist/60">VC Rep</span>
      <span>{state.vcReputation}/100</span>
    </div>
  </PanelCard>
);
