import { useEffect, useState } from "react";
import { LeaderboardPanel } from "./ui/components/LeaderboardPanel";
import { GraveyardPanel } from "./ui/components/GraveyardPanel";
import { fetchLeaderboard, fetchGraveyard } from "./api/client";
import type { LeaderboardEntry, GraveyardEntry } from "./types/social";
import { Analytics } from "@vercel/analytics/react";

type TabKey = "leaderboard" | "graveyard";

const LeaderboardPage = () => {
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

  return (
    <div className="min-h-screen px-3 py-6 text-slate-100 md:px-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-wide text-white">STARTUP WORLD</h1>
            <p className="text-xs text-mist/50">Build your AI startup from garage to IPO.</p>
          </div>
          <a
            href="/"
            className="rounded-lg bg-neon/10 px-4 py-2 text-xs font-semibold text-neon hover:bg-neon/20"
          >
            Play
          </a>
        </div>

        {/* Card */}
        <div className="panel-surface flex flex-col rounded-xl px-5 py-5">
          {/* Title */}
          <div className="mb-3 text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50">
            {tab === "leaderboard" ? "Top 50" : "Startup Graveyard"}
          </div>

          {/* Tabs */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Tab label="Leaderboard" active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} />
            <Tab label="Graveyard" active={tab === "graveyard"} onClick={() => setTab("graveyard")} />
          </div>

          {/* Content */}
          <div className="min-h-[300px]">
            {tab === "leaderboard" ? (
              <LeaderboardPanel entries={leaders} loading={loadingL} />
            ) : (
              <GraveyardPanel entries={graves} loading={loadingG} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[0.6rem] text-mist/30">
          Share this page with friends to compete.
        </div>
      </div>
      <Analytics />
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

export default LeaderboardPage;
