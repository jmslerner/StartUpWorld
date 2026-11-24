import { useCallback, useMemo, useState } from "react";
import { CONFIG } from "../../config";
import type { Plan } from "../../engine/types";
import { PLAYER_ID } from "../../state/player";
import { gameStore, useGame } from "../../state/useGame";
import { EventBanner } from "../components/EventBanner";
import { HowToPlayDialog } from "../components/HowToPlay";
import { PlanningPanel } from "../components/PlanningPanel";
import { ProjectionCard } from "../components/ProjectionCard";
import { QuarterReport } from "../components/QuarterReport";
import { ResourceBar } from "../components/ResourceBar";
import { RivalsPanel } from "../components/RivalsPanel";
import { SoundMenu } from "../components/SoundMenu";
import { money, quarter } from "../format";
import { SFX } from "../sound";
import { BUTTON, BUTTON_ON, LABEL, PRIMARY, TONE } from "../styles";
import { endView, eventView, planningView, reportView, resourceView, rivalsView } from "../viewModel";

type Tab = "plan" | "rivals";

/** The game itself: resources on top, the plan and the rivals side by side, the report over everything after each quarter. */
export const GameScreen = () => {
  const game = useGame((state) => state.game);
  const draft = useGame((state) => state.draft);
  const lastLog = useGame((state) => state.lastLog);
  const reportOpen = useGame((state) => state.reportOpen);
  const over = useGame((state) => state.over);
  const setDraft = useGame((state) => state.setDraft);
  const endQuarter = useGame((state) => state.endQuarter);
  const closeReport = useGame((state) => state.closeReport);
  const openReport = useGame((state) => state.openReport);
  const abandon = useGame((state) => state.abandon);

  const [tab, setTab] = useState<Tab>("plan");
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmingQuit, setConfirmingQuit] = useState(false);

  const resource = useMemo(() => (game === null ? null : resourceView(game, CONFIG)), [game]);
  const planning = useMemo(() => (game === null || draft === null ? null : planningView(game, draft, CONFIG)), [game, draft]);
  const rivals = useMemo(() => (game === null ? [] : rivalsView(game, CONFIG)), [game]);
  const event = useMemo(() => (game === null ? null : eventView(game.event, game, CONFIG)), [game]);
  const report = useMemo(() => (game === null || lastLog === null || !reportOpen ? null : reportView(game, lastLog, CONFIG)), [game, lastLog, reportOpen]);

  const onChange = useCallback((plan: Plan) => setDraft(plan), [setDraft]);

  const onEndQuarter = useCallback(() => {
    SFX.tick();
    endQuarter();
    setTab("plan");
    window.scrollTo({ top: 0 });
  }, [endQuarter]);

  const onCloseReport = useCallback(() => {
    // The ending's sound belongs to the click that reveals it.
    const state = gameStore.getState();
    const ending = state.over && state.game !== null ? endView(state.game, CONFIG) : null;
    if (ending !== null) SFX.gameOver(ending.sound);
    closeReport();
  }, [closeReport]);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  if (game === null || draft === null || resource === null || planning === null) return null;
  const company = game.companies[PLAYER_ID];
  const { projection } = planning;
  const cashTone = projection.cash < 0 ? TONE.danger : projection.cashFloor < 0 ? TONE.caution : "text-gray-100";
  // The most serious thing to know before ending the quarter, if there is one.
  const headline = planning.warnings.find((warning) => warning.level !== "note");

  return (
    <>
      <div inert={report !== null || helpOpen}>
        <main className="mx-auto w-full max-w-6xl space-y-3 px-3 pb-28 pt-3">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className={LABEL}>StartUpWorld</p>
            <h1 className="order-last w-full min-w-0 truncate text-sm font-semibold text-gray-100 sm:order-none sm:w-auto sm:flex-1">
              {resource.companyName} <span className="font-normal text-mist/70">· {quarter(game.turn)} of {resource.maxTurns}</span>
            </h1>
            <div className="flex items-center gap-1.5">
              {lastLog !== null && (
                <button type="button" onClick={openReport} className={`${BUTTON} hidden px-2 py-1 text-[0.65rem] lg:block`}>
                  Last report
                </button>
              )}
              <button type="button" onClick={() => setHelpOpen(true)} className={`${BUTTON} px-2 py-1 text-[0.65rem]`}>
                How to play
              </button>
              <SoundMenu />
              {confirmingQuit ? (
                <>
                  <button type="button" onClick={abandon} className="rounded-lg bg-red-500/20 px-2 py-1 text-[0.65rem] font-semibold text-red-400 hover:bg-red-500/30">
                    Abandon game
                  </button>
                  <button type="button" onClick={() => setConfirmingQuit(false)} className={`${BUTTON} px-2 py-1 text-[0.65rem]`}>
                    Keep playing
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmingQuit(true)} className={`${BUTTON} px-2 py-1 text-[0.65rem]`}>
                  New game
                </button>
              )}
            </div>
          </header>

          <ResourceBar view={resource} boardRunwayTurns={CONFIG.board.runwayTurns} />
          {event !== null && <EventBanner event={event} />}

          <div className="flex gap-1.5 lg:hidden" role="group" aria-label="Show">
            <button type="button" aria-pressed={tab === "plan"} onClick={() => setTab("plan")} className={`${tab === "plan" ? BUTTON_ON : BUTTON} flex-1 py-2 text-xs`}>
              Plan
            </button>
            <button type="button" aria-pressed={tab === "rivals"} onClick={() => setTab("rivals")} className={`${tab === "rivals" ? BUTTON_ON : BUTTON} flex-1 py-2 text-xs`}>
              Rivals
            </button>
            <button type="button" disabled={lastLog === null} onClick={openReport} className={`${BUTTON} flex-1 py-2 text-xs`}>
              Report
            </button>
          </div>

          {/* Wide screens: the plan on the left; its projection and the rivals on the right. Phones: one tab at a time. */}
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className={tab === "plan" ? "" : "hidden lg:block"}>
              <PlanningPanel company={company} turn={game.turn} draft={draft} view={planning} config={CONFIG} onChange={onChange} />
            </div>
            <div className="space-y-3">
              <div className={tab === "plan" ? "" : "hidden lg:block"}>
                <ProjectionCard company={company} view={planning} />
              </div>
              <div className={tab === "rivals" ? "" : "hidden lg:block"}>
                <RivalsPanel you={resource} rivals={rivals} />
              </div>
            </div>
          </div>
        </main>

        {/* Always in reach: what the plan does to cash, the most serious warning, and the button that ends the quarter. */}
        <div className="panel-surface fixed inset-x-0 bottom-0 z-30 rounded-t-xl border-b-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 shrink-0 text-xs">
              <div className="text-[0.6rem] uppercase tracking-[0.16em] text-mist/60">Cash after {quarter(game.turn)}</div>
              <div className={`font-semibold tabular-nums ${cashTone}`}>
                <span className="sm:hidden">≥ </span>
                <span className="hidden sm:inline">at least </span>
                {money(projection.cashFloor)} <span className="font-normal text-mist/70">· <span className="sm:hidden">exp.</span><span className="hidden sm:inline">expected</span></span> {money(projection.cash)}
              </div>
            </div>
            <p className={`hidden min-w-0 flex-1 truncate text-xs md:block ${headline === undefined ? "" : TONE[headline.level]}`} title={headline?.text}>
              {headline?.text}
            </p>
            <button type="button" onClick={onEndQuarter} className={`${PRIMARY} ml-auto shrink-0 md:ml-0`}>
              End {quarter(game.turn)}
            </button>
          </div>
        </div>
      </div>

      {report !== null && <QuarterReport companyName={resource.companyName} view={report} over={over} onClose={onCloseReport} />}
      {helpOpen && <HowToPlayDialog config={CONFIG} onClose={closeHelp} />}
    </>
  );
};
