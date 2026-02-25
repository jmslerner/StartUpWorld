import type { GameState } from "../../types/game";

interface HudBarProps {
  state: GameState;
}

const formatMoney = (value: number) => `$${value.toLocaleString()}`;

export const HudBar = ({ state }: HudBarProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;
  return (
    <div className="panel-surface flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs text-mist">
      <span className="text-white font-semibold text-sm">StartUpWorld</span>
      <span>Week {state.week}</span>
      <span>AP {state.ap}</span>
      <span>Cash {formatMoney(state.cash)}</span>
      <span>Users {state.users.toLocaleString()}</span>
      <span>MRR {formatMoney(state.mrr)}</span>
      <span>Burn {formatMoney(state.burn)}</span>
      <span>Runway {runway}w</span>
    </div>
  );
};
