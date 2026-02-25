import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";

interface RiskProfilePanelProps {
  state: GameState;
}

export const RiskProfilePanel = ({ state }: RiskProfilePanelProps) => (
  <PanelCard title="Risk Profile">
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-[0.6rem] uppercase tracking-[0.22em] text-mist/60">Internal</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Cohesion" value={`${state.culture.cohesion}/100`} tone={toneLowBad(state.culture.cohesion)} />
          <Stat label="Morale" value={`${state.culture.morale}/100`} tone={toneLowBad(state.culture.morale)} />
          <Stat label="Stress" value={`${state.stress}/100`} tone={toneHighBad(state.stress)} />
        </div>
      </div>

      <div className="border-t border-white/5 pt-2">
        <div className="mb-1 text-[0.6rem] uppercase tracking-[0.22em] text-mist/60">External</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Volatility" value={`${state.volatility}/100`} tone={toneHighBad(state.volatility)} />
          <Stat label="Reputation" value={`${state.reputation}/100`} tone={toneLowBad(state.reputation)} />
          <Stat label="VC Rep" value={`${state.vcReputation}/100`} tone={toneLowBad(state.vcReputation)} />
        </div>
      </div>
    </div>
  </PanelCard>
);

type Tone = "neutral" | "good" | "warn" | "bad";

const toneHighBad = (v: number): Tone => {
  if (v >= 75) return "bad";
  if (v >= 55) return "warn";
  return "neutral";
};

const toneLowBad = (v: number): Tone => {
  if (v <= 25) return "bad";
  if (v <= 45) return "warn";
  if (v >= 75) return "good";
  return "neutral";
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: Tone }) => {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "warn"
          ? "text-amber-300"
          : "text-slate-100/90";

  return (
    <div className="rounded-lg bg-steel/30 px-2 py-1">
      <div className="text-[0.6rem] uppercase tracking-[0.2em] text-mist/60">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
};
