import type { GameState } from "../../types/game";
import { getEffectiveMaxAp, calcNetBurn } from "../../engine/economy";

interface HudBarProps {
  state: GameState;
  setupComplete?: boolean;
  onToggleStats?: () => void;
  statsOpen?: boolean;
  onToggleLeaderboard?: () => void;
  onRestart?: () => void;
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

export const HudBar = ({
  state,
  setupComplete = true,
  onToggleStats,
  statsOpen = false,
  onToggleLeaderboard,
  onRestart,
}: HudBarProps) => {
  const netBurn = calcNetBurn(state);
  const profitable = netBurn <= 0;
  const runway = profitable ? 999 : Math.max(0, Math.floor(state.cash / netBurn));
  const runwayUrgent = !profitable && runway <= 4;
  const founder = state.founder.archetype;
  const seedShown = state.seedText?.trim() ? state.seedText : String(state.seed);
  const setupProgress = [
    state.founder.name.trim().length > 0,
    state.companyName.trim().length > 0,
    Boolean(state.founder.archetype),
    Boolean(state.cofounder.archetype),
  ].filter(Boolean).length;
  const companyLabel = state.companyName.trim() || "StartUpWorld";

  if (!setupComplete) {
    return (
      <div className="panel-surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-xs text-mist">
        <span className="text-sm font-semibold text-white" title="Game title">
          {companyLabel}
        </span>
        {state.companyName.trim() ? (
          <span className="text-mist/60" title="Game title">
            StartUpWorld
          </span>
        ) : null}
        <span className="text-mist/60">|</span>
        <span title="Current week of your run.">Week {state.week}</span>
        <span
          className="rounded bg-steel/60 px-1.5 py-0.5 font-mono tabular-nums"
          title={state.seedLocked ? "Run seed (locked)." : "Run seed (settable before you start)."}
        >
          Seed {seedShown}
        </span>
        <span className="font-semibold text-white" title="Cash in the bank when your run begins.">
          Starter cash {fmt(state.cash)}
        </span>
        <span
          className="rounded bg-neon/10 px-1.5 py-0.5 font-semibold text-neon"
          title="Complete setup to unlock the full dashboard."
        >
          Setup {setupProgress}/4
        </span>
        <span className="text-mist/70">Finish setup to unlock the full cockpit.</span>

        <div className="ml-auto flex gap-1.5">
          {onRestart ? (
            <button
              type="button"
              onClick={onRestart}
              className="rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
              title="Start a fresh run"
            >
              New Run
            </button>
          ) : null}
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
        </div>
      </div>
    );
  }

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
      {profitable ? (
        <span className="text-emerald-400" title="Revenue exceeds burn. Cash is growing.">
          Profit +{fmt(Math.abs(netBurn))}/wk
        </span>
      ) : (
        <span title="Burn minus revenue per week.">Net burn {fmt(netBurn)}/wk</span>
      )}
      <span className={runwayUrgent ? "font-semibold text-red-400" : profitable ? "text-emerald-400" : ""}>
        <span title={profitable ? "Profitable — runway is infinite." : "Weeks until cash runs out at current net burn."}>
          Runway {profitable ? "∞" : `${runway}w`}
        </span>
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
        {onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
            title="Start a fresh run"
          >
            New Run
          </button>
        ) : null}
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
