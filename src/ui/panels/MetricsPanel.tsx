import type { GameState } from "../../types/game";
import { PanelCard } from "../components/PanelCard";
import { Delta } from "../components/Gauge";

interface MetricsPanelProps {
  state: GameState;
}

const fmt = (v: number) => `$${v.toLocaleString()}`;

export const MetricsPanel = ({ state }: MetricsPanelProps) => {
  const runway = state.burn > 0 ? Math.max(0, Math.floor(state.cash / state.burn)) : 0;

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
      <Row label="Burn" description="Net cash lost per week. Faster burn means less time." value={`${fmt(state.burn)}/wk`} />
      <Row
        label="Runway"
        description="How many weeks you can survive at the current burn rate."
        value={`${runway}w`}
        urgent={runway <= 4}
      />
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
