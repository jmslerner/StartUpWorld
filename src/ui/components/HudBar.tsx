import type { GameState } from "../../types/game";
import { getEffectiveMaxAp } from "../../engine/economy";

interface HudBarProps {
  state: GameState;
  onToggleStats?: () => void;
  statsOpen?: boolean;
  onToggleLeaderboard?: () => void;
}

const fmt = (v: number) => `$${v.toLocaleString()}`;

const fmtCompactUsd = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString()}`;
};

export const HudBar = ({ state, onToggleStats, statsOpen = false, onToggleLeaderboard }: HudBarProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;
  const runwayUrgent = runway <= 4;
  const founder = state.founder.archetype;
  const seedShown = state.seedText?.trim() ? state.seedText : String(state.seed);

  return (
    <div className="panel-surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-xs text-mist">
      <span className="text-sm font-semibold text-white" title="Your company">
        {state.companyName}
      </span>
      <span className="text-mist/60" title="Game title">
        StartUpWorld
      </span>
      <span className="text-mist/60">|</span>
      <span title="Current week of your run.">Week {state.week}</span>
      <span
        className="rounded bg-steel/60 px-1.5 py-0.5 font-mono tabular-nums"
        title={state.seedLocked ? "Run seed (locked)." : "Run seed (settable before you start)."}
      >
        Seed {seedShown}
      </span>
      <span className="text-mist/80" title="You">
        {state.founder.name}
      </span>
      {founder && (
        <span
          className="rounded bg-neon/10 px-1.5 py-0.5 text-neon"
          title="Your founder archetype. Affects success odds and how the company behaves."
        >
          {founder}
        </span>
      )}
      <span
        className={`rounded px-1.5 py-0.5 font-mono tabular-nums ${
          state.ap === 0 ? "bg-red-500/20 text-red-400" : "bg-neon/10 text-neon"
        }`}
        title="Action Points. Spend on commands; refresh each week."
      >
        AP {state.ap}/{getEffectiveMaxAp(state)}
      </span>
      <span className="text-mist/60">|</span>
      <span className="font-semibold text-white" title="Cash in the bank. When it hits zero, the run ends.">
        Cash {fmt(state.cash)}
      </span>
      <span title="Net cash lost per week.">Burn {fmt(state.burn)}/wk</span>
      <span className={runwayUrgent ? "font-semibold text-red-400" : ""}>
        <span title="Weeks until you run out of cash at current burn.">Runway {runway}w</span>
      </span>
      <span className="font-semibold text-white" title="Estimated valuation derived from ARR, growth, and market mood.">
        Valuation {fmtCompactUsd(state.valuation)}
      </span>
      <span
        className="rounded bg-steel/60 px-1.5 py-0.5"
        title="Company phase is driven by traction and valuation thresholds."
      >
        Phase {state.companyPhase}
      </span>

      <div className="ml-auto flex gap-1.5">
        {onToggleLeaderboard ? (
          <button
            type="button"
            onClick={onToggleLeaderboard}
            className="rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
            title="Leaderboard & Graveyard"
          >
            Ranks
          </button>
        ) : null}
        {onToggleStats ? (
          <button
            type="button"
            onClick={onToggleStats}
            className={
              statsOpen
                ? "rounded-lg bg-neon/10 px-2 py-1 text-[0.65rem] font-semibold text-neon"
                : "rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80"
            }
            title="Toggle stats"
          >
            Stats
          </button>
        ) : null}
      </div>
    </div>
  );
};
