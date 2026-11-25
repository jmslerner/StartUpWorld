import { useMemo } from "react";
import { CONFIG } from "../../config";
import { useGame } from "../../state/useGame";
import { count, money, percent, quarter } from "../format";
import { BUTTON, HINT, LABEL, PRIMARY, TONE } from "../styles";
import { endView } from "../viewModel";

/** How the game ended, where everyone finished, and what each rival turned out to be. */
export const EndScreen = () => {
  const game = useGame((state) => state.game);
  const seed = useGame((state) => state.seed);
  const abandon = useGame((state) => state.abandon);
  const openReport = useGame((state) => state.openReport);
  const hasReport = useGame((state) => state.lastLog !== null);
  const view = useMemo(() => (game === null ? null : endView(game, CONFIG)), [game]);
  if (view === null) return null;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col justify-center gap-3 px-3 py-6">
      <section className="panel-surface rounded-xl px-4 py-5 sm:px-6">
        <p className={view.won ? LABEL : "text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-amber-400"}>
          {view.won ? "You win" : "Game over"} · {quarter(view.turn)}
        </p>
        <h1 className={`mt-3 text-xl font-semibold leading-tight sm:text-2xl ${view.won ? "text-neon" : "text-gray-100"}`}>{view.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-mist">{view.text}</p>

        <h2 className={`${LABEL} mt-5`}>Final standings</h2>
        <ol className="mt-2 space-y-1.5">
          {view.standings.map((standing, index) => (
            <li key={standing.id} className={`rounded-lg px-3 py-2 ${standing.you ? "bg-neon/10 ring-1 ring-inset ring-neon/30" : "bg-black/20"} ${standing.out !== null ? "opacity-60" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-gray-100">
                  <span className="mr-2 tabular-nums text-mist/60">{index + 1}</span>
                  {standing.name}
                  {standing.winner && <span className={`ml-2 text-xs ${TONE.good}`}>winner</span>}
                </span>
                <span className="shrink-0 text-xs text-mist">{standing.type}</span>
              </div>
              <p className={`${HINT} mt-0.5 tabular-nums`}>
                {standing.out !== null
                  ? `${standing.out.reason === "bankrupt" ? "Bankrupt" : "Founder fired"} in ${quarter(standing.out.turn)} with ${count(standing.users)} users.`
                  : `${count(standing.users)} users, worth ${money(standing.valuation)}. Founder owns ${percent(standing.equity)}: a stake of ${money(standing.stake)}.`}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={abandon} className={`${PRIMARY} flex-1`}>
            Play again
          </button>
          {hasReport && (
            <button type="button" onClick={openReport} className={`${BUTTON} px-4 py-2.5 text-sm`}>
              Last quarter&apos;s report
            </button>
          )}
        </div>
        {seed !== null && <p className={`${HINT} mt-3`}>Seed {seed}: start a new game with it to face the same rivals and events.</p>}
      </section>
    </main>
  );
};
