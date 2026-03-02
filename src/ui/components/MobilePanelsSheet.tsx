import { useMemo, useState } from "react";
import type { GameState } from "../../types/game";
import { BottomSheet, type SheetSnap } from "./BottomSheet";
import { BoardPanel, GrowthPanel, RiskProfilePanel, TeamPanel } from "../panels";

type PanelKey = "growth" | "team" | "risk" | "board";

interface MobilePanelsSheetProps {
  state: GameState;
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  collapsedVh?: number;
}

export const MobilePanelsSheet = ({ state, snap: controlledSnap, onSnapChange: controlledOnSnapChange, collapsedVh }: MobilePanelsSheetProps) => {
  const [uncontrolledSnap, setUncontrolledSnap] = useState<SheetSnap>("collapsed");
  const [active, setActive] = useState<PanelKey>("growth");

  const snap = controlledSnap ?? uncontrolledSnap;
  const onSnapChange = controlledOnSnapChange ?? setUncontrolledSnap;

  const content = useMemo(() => {
    if (active === "team") return <TeamPanel state={state} />;
    if (active === "risk") return <RiskProfilePanel state={state} />;
    if (active === "board") return <BoardPanel state={state} />;
    return <GrowthPanel state={state} />;
  }, [active, state]);

  return (
    <BottomSheet
      snap={snap}
      onSnapChange={onSnapChange}
      collapsedVh={collapsedVh}
      header={
        <div className="grid grid-cols-4 gap-2">
          <Tab label="Growth" active={active === "growth"} onClick={() => setActive("growth")} />
          <Tab label="Team" active={active === "team"} onClick={() => setActive("team")} />
          <Tab label="Risk" active={active === "risk"} onClick={() => setActive("risk")} />
          <Tab label="Board" active={active === "board"} onClick={() => setActive("board")} />
        </div>
      }
    >
      {content}
    </BottomSheet>
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
