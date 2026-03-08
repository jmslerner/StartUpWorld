import { useEffect, useState } from "react";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { GraveyardPanel } from "./GraveyardPanel";
import { fetchLeaderboard, fetchGraveyard } from "../../api/client";
import type { LeaderboardEntry } from "../../types/social";
import type { GraveyardEntry } from "../../types/social";

type TabKey = "leaderboard" | "graveyard";

interface LeaderboardOverlayProps {
  onClose: () => void;
  currentSeed?: number;
}

export const LeaderboardOverlay = ({ onClose, currentSeed }: LeaderboardOverlayProps) => {
  const [tab, setTab] = useState<TabKey>("leaderboard");
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [graves, setGraves] = useState<GraveyardEntry[]>([]);
  const [loadingL, setLoadingL] = useState(true);
  const [loadingG, setLoadingG] = useState(true);

  useEffect(() => {
    fetchLeaderboard().then((entries) => {
      setLeaders(entries);
      setLoadingL(false);
    });
    fetchGraveyard().then((entries) => {
      setGraves(entries);
      setLoadingG(false);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-surface flex w-full max-w-2xl flex-col rounded-xl px-5 py-5" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50">
            {tab === "leaderboard" ? "Top 50" : "Startup Graveyard"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-mist/60 hover:bg-white/5 hover:text-mist"
          >
            Esc
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Tab label="Leaderboard" active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} />
          <Tab label="Graveyard" active={tab === "graveyard"} onClick={() => setTab("graveyard")} />
        </div>

        {/* Content */}
        <div className="terminal-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
          {tab === "leaderboard" ? (
            <LeaderboardPanel entries={leaders} loading={loadingL} currentSeed={currentSeed} />
          ) : (
            <GraveyardPanel entries={graves} loading={loadingG} />
          )}
        </div>
      </div>
    </div>
  );
};

const Tab = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={
      active
        ? "rounded-lg bg-neon/10 px-2 py-1.5 text-xs font-semibold text-neon"
        : "rounded-lg bg-steel/30 px-2 py-1.5 text-xs text-mist/80"
    }
  >
    {label}
  </button>
);
