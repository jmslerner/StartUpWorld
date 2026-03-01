import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";
import { Tooltip } from "../components/Tooltip";
import type { ReactNode } from "react";

interface GrowthPanelProps {
  state: GameState;
}

const fmtUsd = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toLocaleString()}`;
};

const fmtNum = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${abs.toLocaleString()}`;
};

const fmtPct01 = (v: number) => `${Math.round(v * 100)}%`;

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
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric label="Users" description="Active users. Momentum compounds.">
          <span className="tabular-nums">
            {fmtNum(state.users)}
            <Delta current={state.users} previous={state.lastWeek.users} format={(v) => fmtNum(v)} />
          </span>
        </Metric>

        <Metric label="MRR" description="Monthly Recurring Revenue.">
          <span className="tabular-nums">
            {fmtUsd(state.mrr)}
            <Delta current={state.mrr} previous={state.lastWeek.mrr} format={(v) => fmtUsd(v)} />
          </span>
        </Metric>

        <Metric label="ARPU" description="Average revenue per user per month.">
          <span className="tabular-nums">${state.arpu}</span>
        </Metric>

        <Metric label="Weekly" description="Week-over-week growth snapshot.">
          <span className="flex flex-wrap justify-center gap-2 tabular-nums">
            <GrowthChip label="MRR" pct={mrrWeeklyPct} />
            <GrowthChip label="Users" pct={usersWeeklyPct} />
          </span>
        </Metric>
      </div>

      <div className="mt-2 border-t border-white/5 pt-2">
        <Row label="Ownership" description="Founder ownership after priced rounds.">
          <span className="tabular-nums">{fmtPct01(state.capTable.founderPct)}</span>
        </Row>
        {state.lastRound ? (
          <div className="mt-1 text-[0.7rem] leading-relaxed text-mist/70">
            Last round: +{fmtUsd(state.lastRound.amount)} @{" "}
            {fmtUsd(state.lastRound.preMoney)} pre / {fmtUsd(state.lastRound.postMoney)} post,{" "}
            dilution {fmtPct01(state.lastRound.dilutionPct)}.
          </div>
        ) : (
          <div className="mt-1 text-[0.7rem] text-mist/70">No priced rounds yet.</div>
        )}
      </div>
    </PanelCard>
  );
};

const Metric = ({ label, description, children }: { label: string; description: string; children: ReactNode }) => {
  return (
    <Tooltip content={description} align="left" widthClassName="w-72" className="w-full cursor-help">
      <div className="w-full text-center">
        <div className="flex justify-center">
          <span className="text-mist/80" aria-label={label}>
            {label}
          </span>
        </div>
        <div className="mt-0.5 flex justify-center">{children}</div>
      </div>
    </Tooltip>
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
