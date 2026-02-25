import type { GameState } from "../../types/game";

interface HudBarProps {
  state: GameState;
}

const fmt = (v: number) => `$${v.toLocaleString()}`;

export const HudBar = ({ state }: HudBarProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;
  const runwayUrgent = runway <= 4;
  const founder = state.founder.archetype;

  return (
    <div className="panel-surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-xs text-mist">
      <span className="text-sm font-semibold text-white">StartUpWorld</span>
      <span className="text-mist/60">|</span>
      <span>Week {state.week}</span>
      {founder && (
        <span className="rounded bg-neon/10 px-1.5 py-0.5 text-neon">{founder}</span>
      )}
      <span className="rounded bg-steel/60 px-1.5 py-0.5">AP {state.ap}</span>
      <span className="text-mist/60">|</span>
      <span className="font-semibold text-white">{fmt(state.cash)}</span>
      <span>Burn {fmt(state.burn)}/wk</span>
      <span className={runwayUrgent ? "font-semibold text-red-400" : ""}>
        Runway {runway}w
      </span>
      <span className="text-mist/60">|</span>
      <span>MRR {fmt(state.mrr)}</span>
      <span>Users {state.users.toLocaleString()}</span>
    </div>
  );
};
