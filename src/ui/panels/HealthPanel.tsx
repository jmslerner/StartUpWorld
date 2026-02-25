import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Gauge } from "../components/Gauge";

interface HealthPanelProps {
  state: GameState;
}

export const HealthPanel = ({ state }: HealthPanelProps) => (
  <PanelCard title="Health">
    <Gauge
      label="Morale"
      description="How energized the team feels. Low morale hurts execution and increases risk."
      value={state.culture.morale}
      color="green"
    />
    <Gauge
      label="Cohesion"
      description="How aligned the team is. Low cohesion makes everything harder and triggers drama."
      value={state.culture.cohesion}
      color="neon"
    />
    <Gauge
      label="Stress"
      description="Founder/company stress. High stress reduces success odds and makes bad choices feel rational."
      value={state.stress}
      color={state.stress > 60 ? "red" : "ember"}
    />
    <Gauge
      label="Volatility"
      description="How chaotic the environment is. Higher volatility means bigger swings and sharper events."
      value={state.volatility}
      color={state.volatility > 60 ? "red" : "ember"}
    />
    <div className="mt-1 flex items-center justify-between border-t border-white/5 pt-1">
      <span className="text-mist/60" title="How the market perceives you. Helps with growth and investor attention.">Reputation</span>
      <span>{state.reputation}/100</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-mist/60" title="How credible you look to investors. Higher is easier fundraising.">VC Rep</span>
      <span>{state.vcReputation}/100</span>
    </div>
  </PanelCard>
);
