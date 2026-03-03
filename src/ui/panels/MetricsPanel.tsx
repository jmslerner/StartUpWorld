import { useState } from "react";
import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";
import { calcNetBurn, calcWeeklyRevenue } from "../../engine/economy";
import { computeContext } from "../../engine/context";

interface MetricsPanelProps {
  state: GameState;
}

const fmt = (v: number) => `$${v.toLocaleString()}`;

export const MetricsPanel = ({ state }: MetricsPanelProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const netBurn = calcNetBurn(state);
  const profitable = netBurn <= 0;
  const runway = profitable ? 999 : Math.max(0, Math.floor(state.cash / netBurn));
  const weeklyRevenue = calcWeeklyRevenue(state);
  const ctx = computeContext(state);

  return (
    <PanelCard title="Metrics">
      <Row
        label="Users"
        description="How many active users you currently have. Growth is your leverage."
        value={state.users.toLocaleString()}
      >
        <Delta current={state.users} previous={state.lastWeek.users} />
      </Row>
      <Row label="MRR" description="Monthly Recurring Revenue. Your revenue engine." value={fmt(state.mrr)}>
        <Delta current={state.mrr} previous={state.lastWeek.mrr} format={(v) => `$${v.toLocaleString()}`} />
      </Row>
      <Row label="ARPU" description="Average Revenue Per User per month." value={`$${state.arpu}`} />
      <Row label="Cash" description="Cash in the bank. When this hits zero, you die." value={fmt(state.cash)}>
        <Delta current={state.cash} previous={state.lastWeek.cash} format={(v) => `$${v.toLocaleString()}`} />
      </Row>
      <Row label="Burn" description="Gross weekly burn (before revenue)." value={`${fmt(state.burn)}/wk`} />
      <Row label="Net Burn" description="Burn minus revenue per week." value={`${fmt(netBurn)}/wk`} />
      <Row label="Revenue" description="Weekly revenue recognized (MRR / 4)." value={`${fmt(weeklyRevenue)}/wk`} />
      <Row
        label="Runway"
        description="How many weeks you can survive at the current burn rate."
        value={`${runway}w`}
        urgent={runway <= 4}
      />

      <div className="pt-1 text-right">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className={
            showAdvanced
              ? "rounded-lg bg-neon/10 px-2 py-1 text-[0.65rem] font-semibold text-neon"
              : "rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50"
          }
          title="Show advanced unit economics (LTV/CAC)"
        >
          {showAdvanced ? "Advanced ▲" : "Advanced ▼"}
        </button>
      </div>

      {showAdvanced ? (
        <div className="space-y-1.5">
          <Row label="LTV" description="Lifetime Value per user (ARPU × avg lifetime)." value={fmt(ctx.ltv)} />
          <Row label="CAC" description="Cost to Acquire a Customer (monthly GTM spend / new users)." value={fmt(ctx.cac)} />
          <Row label="LTV/CAC" description= "VCs look for 3x+; payback matters too." value={`${ctx.ltvCacRatio.toFixed(1)}x`} />
        </div>
      ) : null}
    </PanelCard>
  );
};

const Row = ({
  label,
  description,
  value,
  urgent,
  children,
}: {
  label: string;
  description?: string;
  value: string;
  urgent?: boolean;
  children?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-mist/80" title={description}>
      {label}
    </span>
    <span className={urgent ? "font-semibold text-red-400" : ""}>
      {value}
      {children}
    </span>
  </div>
);
