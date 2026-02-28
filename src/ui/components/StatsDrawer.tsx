import { useMemo } from "react";
import type { GameState } from "../../types/game";
import { GrowthPanel, RiskProfilePanel, TeamPanel } from "../panels";

export type StatsPanelKey = "growth" | "team" | "risk";

interface StatsDrawerProps {
  state: GameState;
  active: StatsPanelKey;
  onActiveChange: (key: StatsPanelKey) => void;
}

export const StatsDrawer = ({ state, active, onActiveChange }: StatsDrawerProps) => {
  const content = useMemo(() => {
    if (active === "team") return <TeamPanel state={state} />;
    if (active === "risk") return <RiskProfilePanel state={state} />;
    return <GrowthPanel state={state} />;
  }, [active, state]);

  return (
    <div className="panel-surface flex max-h-[70vh] flex-col gap-2 rounded-xl p-3">
      <div className="grid grid-cols-3 gap-2">
        <Tab label="Growth" active={active === "growth"} onClick={() => onActiveChange("growth")} />
        <Tab label="Team" active={active === "team"} onClick={() => onActiveChange("team")} />
        <Tab label="Risk" active={active === "risk"} onClick={() => onActiveChange("risk")} />
      </div>

      <div className="terminal-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">{content}</div>
    </div>
  );
};

const Tab = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={
      active
        ? "rounded-lg bg-neon/10 px-2 py-1 text-xs font-semibold text-neon"
        : "rounded-lg bg-steel/30 px-2 py-1 text-xs text-mist/80"
    }
  >
    {label}
  </button>
);
