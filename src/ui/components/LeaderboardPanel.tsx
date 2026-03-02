import type { LeaderboardEntry } from "../../types/social";
import type { EndingType } from "../../types/game";

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  loading: boolean;
  currentSeed?: number;
}

const fmtUsd = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `$${(abs / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(0)}K`;
  return `$${abs}`;
};

const gradeColor = (grade: string): string => {
  if (grade === "A") return "text-neon bg-neon/10";
  if (grade === "B") return "text-emerald-400 bg-emerald-400/10";
  if (grade === "C") return "text-amber-300 bg-amber-300/10";
  if (grade === "D") return "text-orange-400 bg-orange-400/10";
  return "text-red-400 bg-red-400/10";
};

const endingShort: Record<EndingType, string> = {
  ipo: "IPO",
  acquisition: "ACQ",
  bankruptcy: "BANK",
  "founder-removal": "REM",
  "zombie-saas": "ZOMB",
  "ai-hype-exit": "HYPE",
  "forced-acquisition": "SOLD",
};

export const LeaderboardPanel = ({ entries, loading, currentSeed }: LeaderboardPanelProps) => {
  if (loading) {
    return <div className="py-8 text-center text-xs text-mist/50">Loading leaderboard...</div>;
  }

  if (entries.length === 0) {
    return <div className="py-8 text-center text-xs text-mist/50">No scores yet. Be the first.</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Header row */}
      <div className="grid grid-cols-[2rem_1fr_2.5rem_4rem_2.5rem_2.5rem] gap-x-2 px-2 text-[0.6rem] uppercase tracking-widest text-mist/40">
        <span>#</span>
        <span>Company</span>
        <span>Grd</span>
        <span>Val</span>
        <span>Wk</span>
        <span>End</span>
      </div>

      {entries.map((entry, i) => {
        const isCurrentPlayer = currentSeed !== undefined && entry.seed === currentSeed;
        return (
          <div
            key={entry.id}
            className={`grid grid-cols-[2rem_1fr_2.5rem_4rem_2.5rem_2.5rem] items-center gap-x-2 rounded px-2 py-1.5 text-xs ${
              isCurrentPlayer ? "bg-neon/5 border border-neon/20" : "hover:bg-white/5"
            }`}
          >
            <span className={`font-mono tabular-nums ${i < 3 ? "font-bold text-neon" : "text-mist/60"}`}>
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-100">{entry.companyName}</div>
              <div className="truncate text-[0.6rem] text-mist/50">{entry.founderName}</div>
            </div>
            <span className={`rounded px-1 py-0.5 text-center text-[0.6rem] font-bold ${gradeColor(entry.grade)}`}>
              {entry.grade}
            </span>
            <span className="font-mono tabular-nums text-slate-100/80">{fmtUsd(entry.finalValuation)}</span>
            <span className="font-mono tabular-nums text-mist/60">{entry.week}</span>
            <span className="text-[0.6rem] text-mist/60">{endingShort[entry.ending]}</span>
          </div>
        );
      })}
    </div>
  );
};
