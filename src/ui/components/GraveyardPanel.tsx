import type { GraveyardEntry } from "../../types/social";
import type { EndingType } from "../../types/game";

interface GraveyardPanelProps {
  entries: GraveyardEntry[];
  loading: boolean;
}

const accentColor: Record<EndingType, string> = {
  ipo: "border-neon/40",
  acquisition: "border-amber-300/40",
  bankruptcy: "border-red-400/40",
  "founder-removal": "border-red-400/40",
  "zombie-saas": "border-mist/40",
  "ai-hype-exit": "border-amber-300/40",
};

const badgeColor: Record<EndingType, string> = {
  ipo: "text-neon bg-neon/10",
  acquisition: "text-amber-300 bg-amber-300/10",
  bankruptcy: "text-red-400 bg-red-400/10",
  "founder-removal": "text-red-400 bg-red-400/10",
  "zombie-saas": "text-mist bg-mist/10",
  "ai-hype-exit": "text-amber-300 bg-amber-300/10",
};

const endingLabel: Record<EndingType, string> = {
  ipo: "IPO",
  acquisition: "ACQUIRED",
  bankruptcy: "BANKRUPT",
  "founder-removal": "REMOVED",
  "zombie-saas": "ZOMBIE",
  "ai-hype-exit": "HYPE EXIT",
};

export const GraveyardPanel = ({ entries, loading }: GraveyardPanelProps) => {
  if (loading) {
    return <div className="py-8 text-center text-xs text-mist/50">Loading graveyard...</div>;
  }

  if (entries.length === 0) {
    return <div className="py-8 text-center text-xs text-mist/50">The graveyard is empty. For now.</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`rounded-lg border-l-2 bg-white/[0.02] px-3 py-2 ${accentColor[entry.ending]}`}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider ${badgeColor[entry.ending]}`}>
              {endingLabel[entry.ending]}
            </span>
            <span className="text-[0.6rem] text-mist/40">Week {entry.week}</span>
          </div>
          <div className="text-xs font-semibold text-slate-100">{entry.companyName}</div>
          <div className="mt-0.5 text-[0.7rem] italic leading-relaxed text-mist/60">
            "{entry.epitaph}"
          </div>
        </div>
      ))}
    </div>
  );
};
