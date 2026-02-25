import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";
import type { ReactNode } from "react";

interface GrowthPanelProps {
  state: GameState;
}

const fmtUsd = (v: number) => `$${v.toLocaleString()}`;

const fmtPct = (v: number) => {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

const pctChange = (current: number, previous: number) => {
  if (previous <= 0) return 0;
  return ((current - previous) / previous) * 100;
};

export const GrowthPanel = ({ state }: GrowthPanelProps) => {
  const mrrWeeklyPct = pctChange(state.mrr, state.lastWeek.mrr);
  const usersWeeklyPct = pctChange(state.users, state.lastWeek.users);

  return (
    <PanelCard title="Growth">
      <Row label="Users" description="Active users. Momentum compounds.">
        <span className="tabular-nums">
          {state.users.toLocaleString()}
          <Delta current={state.users} previous={state.lastWeek.users} />
        </span>
      </Row>
      <Row label="MRR" description="Monthly Recurring Revenue.">
        <span className="tabular-nums">
          {fmtUsd(state.mrr)}
          <Delta current={state.mrr} previous={state.lastWeek.mrr} format={(v) => fmtUsd(v)} />
        </span>
      </Row>
      <Row label="ARPU" description="Average revenue per user per month.">
        <span className="tabular-nums">${state.arpu}</span>
      </Row>
      <div className="mt-1 border-t border-white/5 pt-2">
        <Row label="Weekly" description="Week-over-week growth snapshot.">
          <span className="flex items-center gap-2 tabular-nums">
            <GrowthChip label="MRR" pct={mrrWeeklyPct} />
            <GrowthChip label="Users" pct={usersWeeklyPct} />
          </span>
        </Row>
      </div>
    </PanelCard>
  );
};

const GrowthChip = ({ label, pct }: { label: string; pct: number }) => {
  const up = pct > 0;
  const down = pct < 0;
  const color = up ? "text-emerald-400" : down ? "text-red-400" : "text-mist/70";
  const arrow = up ? "▲" : down ? "▼" : "•";

  return (
    <span className={`rounded bg-steel/40 px-1.5 py-0.5 text-[0.65rem] ${color}`}>
      <span className="text-mist/70">{label}</span> {arrow} {fmtPct(pct)}
    </span>
  );
};

const Row = ({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-mist/80" title={description}>
      {label}
    </span>
    {children}
  </div>
);
