import { useRef, useState } from "react";
import type { GameState, EndingType } from "../../types/game";
import { generateEndingSummary, type EndingSummary } from "../../engine/endingSummary";
import { generateEpitaph } from "../../engine/epitaphs";
import { submitScore, submitGraveyardEntry } from "../../api/client";
import { LeaderboardOverlay } from "./LeaderboardOverlay";

interface GameOverCardProps {
  state: GameState;
  onPlayAgain: () => void;
  /** Offer "View office": put the card aside (it stays mounted, keeping the name form) to watch the 3D ending. */
  canPeek?: boolean;
}

const NAME_STORAGE_KEY = "startupworld:playerName";
const MAX_NAME_LENGTH = 32;

const fmt = (v: number): string => v.toLocaleString();
const fmtUsd = (v: number): string => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
};

const accentColor: Record<EndingType, string> = {
  ipo: "text-neon border-neon/40",
  acquisition: "text-amber-300 border-amber-300/40",
  bankruptcy: "text-red-400 border-red-400/40",
  "founder-removal": "text-red-400 border-red-400/40",
  "zombie-saas": "text-mist border-mist/40",
  "ai-hype-exit": "text-amber-300 border-amber-300/40",
  "forced-acquisition": "text-red-400 border-red-400/40",
};

const gradeColor = (grade: string): string => {
  if (grade === "A") return "text-neon bg-neon/10";
  if (grade === "B") return "text-emerald-400 bg-emerald-400/10";
  if (grade === "C") return "text-amber-300 bg-amber-300/10";
  if (grade === "D") return "text-orange-400 bg-orange-400/10";
  return "text-red-400 bg-red-400/10";
};

const endingLabel: Record<EndingType, string> = {
  ipo: "IPO",
  acquisition: "ACQUIRED",
  bankruptcy: "BANKRUPT",
  "founder-removal": "REMOVED",
  "zombie-saas": "ZOMBIE SAAS",
  "ai-hype-exit": "AI HYPE EXIT",
  "forced-acquisition": "FORCED SALE",
};

const readStoredName = (): string | null => {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
};

const storeName = (name: string): void => {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // private mode / storage disabled — not worth failing the submit over
  }
};

type SubmitStatus = "idle" | "submitting" | "done";

export const GameOverCard = ({ state, onPlayAgain, canPeek = false }: GameOverCardProps) => {
  const summary: EndingSummary | null = generateEndingSummary(state);
  const [name, setName] = useState(() => readStoredName() ?? state.founder.name ?? "");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [rank, setRank] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [peeking, setPeeking] = useState(false);
  // Guards against a double-click landing before the disabled state renders.
  const submittingRef = useRef(false);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && status === "idle";

  const handleSubmit = async () => {
    if (!summary || !canSubmit || submittingRef.current) return;
    const ending = state.gameOver?.ending;
    if (!ending) return;

    submittingRef.current = true;
    setStatus("submitting");
    storeName(trimmedName);

    const result = await submitScore({
      companyName: state.companyName,
      founderName: trimmedName,
      ending,
      score: summary.score,
      finalValuation: state.valuation,
      founderOwnership: state.capTable.founderPct,
      finalUsers: state.users,
      finalMrr: state.mrr,
      week: state.week,
      seed: state.seed,
    });

    // Graveyard is fire-and-forget; it records the company, not the player.
    void submitGraveyardEntry({
      companyName: state.companyName,
      ending,
      epitaph: generateEpitaph(state, ending),
      grade: summary.grade,
      week: state.week,
    });

    setRank(result.rank);
    setSubmitError(result.error);
    setStatus("done");
  };

  if (!summary) return null;

  const accent = accentColor[summary.ending];

  if (showLeaderboard) {
    return <LeaderboardOverlay onClose={() => setShowLeaderboard(false)} currentSeed={state.seed} />;
  }

  const peek = canPeek && peeking;

  return (
    <>
    {peek ? (
      // Bottom right on wide screens, where the log's left-aligned lines rarely reach.
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 md:justify-end md:px-8">
        <button
          type="button"
          onClick={() => setPeeking(false)}
          className={`pointer-events-auto panel-surface rounded-full border px-4 py-2 text-xs font-semibold shadow-lg transition hover:bg-white/10 ${accent}`}
        >
          {endingLabel[summary.ending]} · Show results
        </button>
      </div>
    ) : null}
    {/* Scrolls when the window is shorter than the card; m-auto centres it otherwise. */}
    <div className={`fixed inset-0 z-30 overflow-y-auto bg-black/80 p-4 ${peek ? "hidden" : "flex"}`}>
      <div className={`panel-surface m-auto w-full max-w-lg rounded-xl border-l-2 px-5 py-5 ${accent}`}>
        {/* Header */}
        <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-widest opacity-70">
          Game Over
        </div>
        <div className={`mb-1 inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${accent.split(" ")[0]} bg-white/5`}>
          {endingLabel[summary.ending]}
        </div>
        <div className="mb-3 mt-2 text-sm font-semibold text-slate-100">
          {summary.headline}
        </div>

        {/* Narrative */}
        <div className="mb-4 text-xs leading-relaxed text-mist/80">
          {summary.narrative.replace(/\[\[beat\]\]/g, "  ...  ")}
        </div>

        {/* Grade + Rank */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-mist/60">Grade:</span>
            <span className={`rounded px-2 py-0.5 text-sm font-bold ${gradeColor(summary.grade)}`}>
              {summary.grade}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mist/60">Score:</span>
            <span className="font-mono text-sm tabular-nums text-slate-100/80">{summary.score}</span>
          </div>
          {rank !== null && (
            <span className="rounded bg-neon/10 px-2 py-0.5 text-xs font-bold text-neon">
              #{rank} on leaderboard
            </span>
          )}
        </div>

        {/* Stats grid */}
        <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <Stat label="Week" value={String(summary.stats.week)} />
          <Stat label="Final Cash" value={fmtUsd(summary.stats.finalCash)} />
          <Stat label="Users" value={fmt(summary.stats.finalUsers)} />
          <Stat label="MRR" value={fmtUsd(summary.stats.finalMrr)} />
          <Stat label="Valuation" value={fmtUsd(summary.stats.finalValuation)} />
          <Stat label="Peak Valuation" value={fmtUsd(summary.stats.peakValuation)} />
          <Stat label="Ownership" value={`${summary.stats.founderOwnership}%`} />
          <Stat label="Total Raised" value={fmtUsd(summary.stats.totalRaised)} />
          <Stat label="Team Size" value={String(summary.stats.teamSize)} />
        </div>

        {/* Achievements */}
        {summary.achievements.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50">
              Achievements
            </div>
            <div className="flex flex-wrap gap-1.5">
              {summary.achievements.map((a) => (
                <span key={a} className="rounded bg-white/5 px-2 py-0.5 text-[0.65rem] text-mist/70">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Leaderboard submission */}
        <div className="mb-4 rounded-lg bg-white/[0.02] px-3 py-3">
          {status === "done" ? (
            <div className="text-xs leading-relaxed text-mist/70">
              {submitError ? (
                <span className="text-amber-300/80">{submitError}</span>
              ) : (
                <>
                  Submitted as <span className="font-semibold text-slate-100">{trimmedName}</span>.
                  {rank !== null ? ` You're #${rank}.` : " Score recorded."}
                </>
              )}
            </div>
          ) : (
            <>
              <label
                htmlFor="leaderboard-name"
                className="mb-1.5 block text-[0.6rem] font-semibold uppercase tracking-widest text-mist/50"
              >
                Your name for the leaderboard
              </label>
              <div className="flex gap-2">
                <input
                  id="leaderboard-name"
                  type="text"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="off"
                  placeholder="Founder name"
                  disabled={status === "submitting"}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSubmit();
                  }}
                  className="min-w-0 flex-1 rounded bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/10 placeholder:text-mist/30 focus:ring-neon/40 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  className="shrink-0 rounded bg-neon/10 px-3 py-1.5 text-xs font-medium text-neon transition hover:bg-neon/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {status === "submitting" ? "Submitting..." : "Submit"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Buttons ("View office" takes its own row on phones rather than squeezing the others onto two lines) */}
        <div className="flex flex-wrap gap-2 whitespace-nowrap">
          <button
            onClick={onPlayAgain}
            className="flex-1 rounded bg-neon/10 px-4 py-2 text-sm font-medium text-neon transition hover:bg-neon/20"
          >
            Play Again
          </button>
          <button
            onClick={() => setShowLeaderboard(true)}
            className="rounded bg-steel/30 px-4 py-2 text-sm font-medium text-mist/80 transition hover:bg-steel/50"
          >
            Leaderboard
          </button>
          {canPeek ? (
            <button
              type="button"
              onClick={() => setPeeking(true)}
              className="w-full rounded bg-steel/30 px-4 py-2 text-sm font-medium text-mist/80 transition hover:bg-steel/50 sm:w-auto"
            >
              View office
            </button>
          ) : null}
        </div>
      </div>
    </div>
    </>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span className="text-mist/50">{label}</span>
    <span className="font-mono tabular-nums text-slate-100/80">{value}</span>
  </div>
);
