import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Gauge } from "../components/Gauge";

interface FounderPanelProps {
  state: GameState;
}

export const FounderPanel = ({ state }: FounderPanelProps) => {
  const archetype = state.founder.archetype;
  const cofounderArch = state.cofounder.archetype;

  return (
    <PanelCard title="Founder &amp; Co">
      <div className="flex items-center justify-between">
        <span className="text-mist/60" title="That’s you.">Name</span>
        <span>{state.founder.name}</span>
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-mist/60"
          title="Your founder style. It tweaks success odds and how the company behaves."
        >
          Founder
        </span>
        {archetype ? (
          <span className="text-neon">{archetype}</span>
        ) : (
          <span className="text-mist/60" title="Pick one in the terminal: founder visionary|hacker|sales-animal|philosopher">
            (unpicked)
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-mist/60" title="What you’re selling to yourself and to investors.">Thesis</span>
        <span>{state.thesis}</span>
      </div>

      <div className="mt-1 border-t border-white/5 pt-1 text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50">
        Cofounder
      </div>

      {cofounderArch ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-mist/60" title="Your cofounder.">Name</span>
            <span>{state.cofounder.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-mist/60" title="Cofounder archetype. Shapes the relationship and drama.">Type</span>
            <span className="text-neon">{cofounderArch}</span>
          </div>
          <Gauge
            label="Trust"
            description="Cofounder trust in you. Low trust unlocks power struggles."
            value={state.cofounder.trust}
            color={state.cofounder.trust < 30 ? "red" : "green"}
          />
          <Gauge
            label="Ego"
            description="Cofounder ego. High ego means conflict, politics, and surprise coups."
            value={state.cofounder.ego}
            color={state.cofounder.ego > 70 ? "red" : "ember"}
          />
          <Gauge
            label="Ambition"
            description="Cofounder ambition. High ambition can accelerate growth or explode the team."
            value={state.cofounder.ambition}
            color="neon"
          />
        </>
      ) : (
        <p className="text-mist/50">Pick a cofounder in the terminal: cofounder operator|builder|rainmaker|powderkeg</p>
      )}
    </PanelCard>
  );
};
