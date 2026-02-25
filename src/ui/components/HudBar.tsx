import type { GameState } from "../../types/game";

interface HudBarProps {
  state: GameState;
}

const formatMoney = (value: number) => `$${value.toLocaleString()}`;

export const FundingStrip = ({ state }: HudBarProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;
  return (
    <div className="panel-surface flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs text-mist">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-amber-200 font-semibold uppercase tracking-wide">Funding</span>
        <span className="text-white font-semibold">Cash {formatMoney(state.cash)}</span>
        <span>Runway {runway}w</span>
        <span>Burn {formatMoney(state.burn)}</span>
        <span>MRR {formatMoney(state.mrr)}</span>
      </div>
      <span className="text-mist/70">Cash is your oxygen. Don’t run out.</span>
    </div>
  );
};

export const HudBar = ({ state }: HudBarProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;
  return (
    <div className="panel-surface flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs text-mist">
      <span className="text-white font-semibold text-sm">StartUpWorld</span>
      <span>Week {state.week}</span>
      <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
        Cash {formatMoney(state.cash)}
      </span>
      <span>Runway {runway}w</span>
      <span>Burn {formatMoney(state.burn)}</span>
      <span>MRR {formatMoney(state.mrr)}</span>
      <span>Users {state.users.toLocaleString()}</span>
      <span>AP {state.ap}</span>
    </div>
  );
};
