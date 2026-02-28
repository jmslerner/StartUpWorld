import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Tooltip } from "../components/Tooltip";

interface RiskProfilePanelProps {
  state: GameState;
}

export const RiskProfilePanel = ({ state }: RiskProfilePanelProps) => (
  <PanelCard title="Risk Profile">
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-center text-[0.6rem] uppercase tracking-[0.22em] text-mist/60">Internal</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label="Cohesion"
            value={`${state.culture.cohesion}/100`}
            tone={toneLowBad(state.culture.cohesion)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">Cohesion</div>
                <div className="text-mist/80">Up: stable team, aligned choices. Down: rapid hiring, conflict, churn.</div>
                <div className="text-mist/80">Impact: low cohesion increases drama risk and makes execution harder.</div>
              </div>
            }
          />
          <Stat
            label="Morale"
            value={`${state.culture.morale}/100`}
            tone={toneLowBad(state.culture.morale)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">Morale</div>
                <div className="text-mist/80">Up: wins, good runway, positive events. Down: failures, crunch, instability.</div>
                <div className="text-mist/80">Impact: low morale reduces output and increases negative outcomes.</div>
              </div>
            }
          />
          <Stat
            label="Stress"
            value={`${state.stress}/100`}
            tone={toneHighBad(state.stress)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">Stress</div>
                <div className="text-mist/80">Up: low runway, crises, big burn. Down: cash buffer, momentum, fewer fires.</div>
                <div className="text-mist/80">Impact: high stress lowers success odds and spikes riskier events.</div>
              </div>
            }
          />
        </div>
      </div>

      <div className="border-t border-white/5 pt-2">
        <div className="mb-1 text-center text-[0.6rem] uppercase tracking-[0.22em] text-mist/60">External</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label="Volatility"
            value={`${state.volatility}/100`}
            tone={toneHighBad(state.volatility)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">Volatility</div>
                <div className="text-mist/80">Up: chaotic weeks, high risk-taking, big swings. Down: stability and controlled burn.</div>
                <div className="text-mist/80">Impact: amplifies outcomes—higher highs, sharper lows.</div>
              </div>
            }
          />
          <Stat
            label="Reputation"
            value={`${state.reputation}/100`}
            tone={toneLowBad(state.reputation)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">Reputation</div>
                <div className="text-mist/80">Up: shipping, traction, good press. Down: public failures, scandals, churn.</div>
                <div className="text-mist/80">Impact: affects growth tailwinds, hiring, and event flavor.</div>
              </div>
            }
          />
          <Stat
            label="VC Rep"
            value={`${state.vcReputation}/100`}
            tone={toneLowBad(state.vcReputation)}
            help={
              <div className="space-y-1">
                <div className="font-semibold text-slate-100">VC Rep</div>
                <div className="text-mist/80">Up: clean raises, strong metrics, good interactions. Down: desperation, broken promises.</div>
                <div className="text-mist/80">Impact: affects fundraising odds and how investors treat your asks.</div>
              </div>
            }
          />
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

const Stat = ({
  label,
  value,
  tone,
  help,
}: {
  label: string;
  value: string;
  tone?: Tone;
  help: React.ReactNode;
}) => {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "warn"
          ? "text-amber-300"
          : "text-slate-100/90";

  return (
    <div className="rounded-lg bg-steel/30 px-2 py-1 text-center">
      <Tooltip content={help} align="left" widthClassName="w-80">
        <button
          type="button"
          className="w-full text-center text-[0.6rem] uppercase tracking-[0.2em] text-mist/60 underline decoration-white/10 decoration-dotted underline-offset-4"
          onMouseDown={(event) => event.preventDefault()}
        >
          {label}
        </button>
      </Tooltip>
      <div className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
};
