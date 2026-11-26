import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { rulesForTurn, yearOf } from "../../engine/career";
import type { Plan } from "../../engine/types";
import { PLAYER_ID } from "../../state/player";
import { browserStorage, gameStore, useGame } from "../../state/useGame";
import { marketSceneFor } from "../../scene/marketScene";
import { NO_PLAYBACK, withMarket, yearPlayback } from "../../scene/yearPlayback";
import type { WorldViewState } from "../../world/mountWorld";
import type { MarketScene, WorldViewKind } from "../../world/types/market";
import { EventBanner } from "../components/EventBanner";
import { OfficeSlot } from "../components/OfficeSlot";
import { HowToPlayDialog } from "../components/HowToPlay";
import { PlanningPanel } from "../components/PlanningPanel";
import { ProjectionCard } from "../components/ProjectionCard";
import { QuarterReport } from "../components/QuarterReport";
import { ResourceBar } from "../components/ResourceBar";
import { careerEndView } from "../careerEnd";
import { listingView, officeMoveView } from "../careerPlan";
import { careerReportView, rivalCareerRows } from "../careerReport";
import { careerStatusView, datedYear, timelineView } from "../careerTimeline";
import { CareerStatus } from "../components/CareerStatus";
import { RivalsPanel } from "../components/RivalsPanel";
import { SoundMenu } from "../components/SoundMenu";
import { Timeline } from "../components/Timeline";
import { YearSummary } from "../components/YearSummary";
import { money } from "../format";
import { viewNow } from "../marketView";
import { SFX } from "../sound";
import { BUTTON, BUTTON_ON, LABEL, PRIMARY, TONE } from "../styles";
import { SETTLE_MS } from "../useDialog";
import { endView, eventView, planningView, reportView, resourceView, rivalsView } from "../viewModel";
import { createOfficeProbe, PROBE_GLOBAL, type CareerOfficeProbe, type OfficeProbeLink } from "../officeProbe";
import { createOfficeSource } from "../officeSource";
import {
  beatLine,
  canDrawOffice,
  canPlayOut,
  canSwitch,
  DESKTOP_QUERY,
  firstAvailability,
  nextAvailability,
  officeCellHeight,
  officeLayoutFor,
  OFFICE_WORDS,
  playingLine,
  readOfficePreference,
  reloadOffered,
  writeOfficePreference,
  type OfficeAvailability,
} from "../officeView";
import { wordsFor } from "../words";
import { beatNow, endRefused, finishYearPlay, IDLE, startYearPlay, yearPlaysOut, yearPlayAfterLoss, yearPlayStep, type YearPlay } from "../yearPlay";

type Tab = "plan" | "rivals";

/** The page's one check hook, made and installed on `window` by the first career screen, and never taken off. */
let pageProbe: (CareerOfficeProbe & OfficeProbeLink) | null = null;
const officeProbe = (): CareerOfficeProbe & OfficeProbeLink => {
  if (pageProbe === null) {
    pageProbe = createOfficeProbe();
    window[PROBE_GLOBAL] = pageProbe;
  }
  return pageProbe;
};

const NO_VIEW: WorldViewState = { status: "starting", handle: null };

/** A desktop browser window, now. */
/** How often the screen looks at the clock while a year plays out. */
const PLAY_TICK_MS = 250;

/** The player asked for less motion, now. */
const reducedMotionNow = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const desktopWindow = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;

/** The game itself: resources on top, the plan and the rivals side by side, the report over everything after each year or quarter. */
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
  const leave = useGame((state) => state.leave);
  const config = useGame((state) => state.config);
  const record = useGame((state) => state.record);
  const seed = useGame((state) => state.seed);
  const words = useMemo(() => wordsFor(config), [config]);
  const career = config.career !== undefined;

  // The 3D office: read once per mount, before the first paint, so a device without WebGL 2 never flashes it.
  const [availability, setAvailability] = useState<OfficeAvailability>(() => firstAvailability(career && canDrawOffice()));
  const [preference, setPreference] = useState(() => readOfficePreference(browserStorage()));
  const [wide, setWide] = useState(desktopWindow);
  // The store as the office's scene source: one per screen, never read in a race.
  const [officeSource] = useState(() => createOfficeSource(gameStore));
  const layout = officeLayoutFor({ career, preference, availability, wide });
  const viewRef = useRef<WorldViewState>(NO_VIEW);
  const availabilityRef = useRef(availability);
  const [cellHeight, setCellHeight] = useState<number | null>(null);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // A year playing out after End: the ref is what the handlers read, the state what the page shows.
  const playRef = useRef<YearPlay>(IDLE);
  const [play, setPlay] = useState<YearPlay>(IDLE);
  const [playNow, setPlayNow] = useState(0);
  const beatShown = useRef<number | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  // When the year started playing: the second click of a double click on End lands on Skip, and must not skip it.
  const playStartedAt = useRef(Number.NEGATIVE_INFINITY);

  const [tab, setTab] = useState<Tab>("plan");
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmingQuit, setConfirmingQuit] = useState(false);
  // A career's report opens on the year in brief; the full report is one button away. Reset as the report closes,
  // so every opening starts on the summary.
  const [fullReport, setFullReport] = useState(false);
  // The career's market: the view the player chose, and the company selected in it.
  const [chosenView, setChosenView] = useState<WorldViewKind>("office");
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  const resource = useMemo(() => (game === null ? null : resourceView(game, config)), [game, config]);
  const planning = useMemo(() => (game === null || draft === null ? null : planningView(game, draft, config)), [game, draft, config]);
  const rivals = useMemo(() => (game === null ? [] : rivalsView(game, config)), [game, config]);
  const rivalCareers = useMemo(() => (game === null ? [] : rivalCareerRows(game, config)), [game, config]);
  const event = useMemo(() => (game === null ? null : eventView(game.event, game, config)), [game, config]);
  const report = useMemo(
    () => (game === null || lastLog === null || !reportOpen ? null : reportView(game, lastLog, config)),
    [game, lastLog, reportOpen, config],
  );
  // The report's career lines and the coming card's date; null in a race.
  const careerReport = useMemo(
    () => (game === null || lastLog === null || !reportOpen ? null : careerReportView(game, lastLog, record, config)),
    [game, lastLog, reportOpen, record, config],
  );
  const datedNext = useMemo(() => (lastLog === null ? null : datedYear(lastLog.nextEvent, lastLog.turn + 1, config)), [lastLog, config]);
  // A career's timeline and the year's status; null in a race.
  const timeline = useMemo(() => (game === null ? null : timelineView(game, record, config)), [game, record, config]);
  const status = useMemo(() => (game === null ? null : careerStatusView(game, config)), [game, config]);
  // Going public and the coming office move, as the plan offers them; null in a race.
  const listing = useMemo(() => (game === null || draft === null ? null : listingView(game, draft, config)), [game, draft, config]);
  const move = useMemo(() => (planning === null ? null : officeMoveView(planning.projection, config)), [planning, config]);
  // The market the world draws; null in a race, without a seed, and before any year was played.
  const market = useMemo<MarketScene | null>(
    () => (game === null || lastLog === null || seed === null || config.career === undefined ? null : marketSceneFor({ game, log: lastLog, config, seed })),
    [game, lastLog, config, seed],
  );
  const marketRef = useRef<MarketScene | null>(market);
  useEffect(() => {
    marketRef.current = market;
  }, [market]);
  // Another run: nothing is selected in its market.
  const runId = market?.runId ?? null;
  const [selectedRun, setSelectedRun] = useState(runId);
  if (runId !== selectedRun) {
    setSelectedRun(runId);
    setSelectedSeat(null);
  }

  const onChange = useCallback((plan: Plan) => setDraft(plan), [setDraft]);

  /** The year stops playing: the new year shows, the world finishes what is moving, and the summary opens. */
  const finishPlay = useCallback(() => {
    if (playRef.current.phase !== "playing") return;
    playRef.current = finishYearPlay(playRef.current, officeSource, viewRef.current.handle);
    beatShown.current = null;
    setPlay(IDLE);
  }, [officeSource]);

  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  useEffect(() => {
    if (!career || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const changed = (): void => setWide(query.matches);
    changed();
    // A window made narrow leaves the 3D layout: a year playing out ends at once.
    const moved = (): void => {
      if (!query.matches) finishPlay();
      changed();
    };
    query.addEventListener("change", moved);
    return () => query.removeEventListener("change", moved);
  }, [career, finishPlay]);

  useEffect(() => {
    if (!career) return;
    return officeProbe().attach(() => viewRef.current, officeSource, () => availabilityRef.current, () => marketRef.current);
  }, [career, officeSource]);

  // The office cell ends above the bottom bar with nothing scrolled.
  useLayoutEffect(() => {
    if (layout !== "3d") return;
    const measure = (): void => {
      const cell = cellRef.current;
      if (cell === null) return;
      const top = cell.getBoundingClientRect().top + window.scrollY;
      const bar = barRef.current?.getBoundingClientRect().height ?? 0;
      setCellHeight(officeCellHeight({ viewport: window.innerHeight, top, bar }));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (barRef.current !== null) observer?.observe(barRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  });

  const onView = useCallback((state: WorldViewState) => {
    const old = viewRef.current.handle;
    if (old !== null && old !== state.handle) officeProbe().retire(old);
    viewRef.current = state;
    // An office that stops drawing, or goes away, ends a year playing out at once.
    if (yearPlayAfterLoss(playRef.current, nextAvailability(availabilityRef.current, state.status)) === IDLE) finishPlay();
    setAvailability((prev) => nextAvailability(prev, state.status));
  }, [finishPlay]);
  const onOfficeFailed = useCallback(() => {
    finishPlay();
    setAvailability("failed");
  }, [finishPlay]);
  const onMove = useCallback(
    (patch: Pick<Plan, "allocation">) => {
      const current = gameStore.getState().draft;
      if (current !== null) setDraft({ ...current, ...patch });
    },
    [setDraft],
  );
  const toggleOffice = useCallback(() => {
    const on = layout !== "3d";
    if (!on) finishPlay();
    writeOfficePreference(browserStorage(), on);
    setPreference(on);
    if (on) setAvailability((prev) => (prev === "context-lost" ? "unknown" : prev));
  }, [layout, finishPlay]);
  const reloadOffice = useCallback(() => setAvailability("unknown"), []);

  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const reportClosedAt = useRef(Number.NEGATIVE_INFINITY);

  const onEndQuarter = useCallback(() => {
    // Nothing ends a year while one plays out or a report is open: no second year, and last year never replays.
    if (endRefused(playRef.current, gameStore.getState().reportOpen)) return;
    // The report's button can sit right over this one: the second tap of a double tap on it lands here
    // as the report closes, and must not play a year or quarter nobody has planned.
    if (performance.now() - reportClosedAt.current < SETTLE_MS) return;
    SFX.tick();
    // Focus leaves the button before the report opens over it: when the report closes, focus comes back to
    // the top of the page, not to a button that a key held down would press again and again.
    titleRef.current?.focus({ preventScroll: true });
    const before = gameStore.getState();
    const playOut =
      before.game !== null && before.config.career !== undefined && canPlayOut({ layout, availability: availabilityRef.current, reducedMotion: reducedMotionNow() });
    if (playOut && before.game !== null && before.config.career !== undefined) {
      const turnBefore = before.game.turn;
      const year = yearOf(turnBefore, before.config.career);
      officeSource.startPlay();
      endQuarter();
      const after = gameStore.getState();
      const playerOut = after.game === null || after.game.companies[PLAYER_ID].out !== null;
      if (yearPlaysOut({ log: before.lastLog }, { log: after.lastLog, failure: after.failure, playerOut })) {
        const now = performance.now();
        playRef.current = startYearPlay(playRef.current, withMarket(yearPlayback(after.lastLog?.companies[PLAYER_ID] ?? null, false)), year, now);
        setPlayNow(now);
      }
      const started = playRef.current;
      if (started.phase === "playing") {
        playStartedAt.current = performance.now();
        beatShown.current = 0;
        officeSource.showBeat(started.playback, 0);
      } else {
        officeSource.showBeat(NO_PLAYBACK, null);
      }
      setPlay(started);
    } else {
      endQuarter();
    }
    setTab("plan");
    window.scrollTo({ top: 0 });
  }, [endQuarter, layout, officeSource]);

  // While a year plays out the clock moves the caption's moment on, and ends the year when its time is up (or, should
  // a change of view have slipped past its handler, when the office stopped drawing). The year ends in one go: the
  // new year shown and the caption taken away before anything is drawn, so no frame shows the new year's expected
  // hires at the door under the last beat's caption.
  useEffect(() => {
    if (play.phase !== "playing") return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (yearPlayStep(playRef.current, beatShown.current, now).kind === "finish" || yearPlayAfterLoss(playRef.current, availabilityRef.current) === IDLE) {
        flushSync(finishPlay);
        return;
      }
      setPlayNow(now);
    }, PLAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [play, finishPlay]);

  // The office follows the caption: as the page takes the caption for a moment, before anything is drawn, the scene
  // takes that moment's beat. Showing a beat on the clock instead let a frame or two draw the next beat (the hires
  // walking in, the new office) under the last beat's caption.
  useLayoutEffect(() => {
    if (play !== playRef.current) return;
    const step = yearPlayStep(play, beatShown.current, playNow);
    if (step.kind === "beat" && play.phase === "playing") {
      beatShown.current = step.index;
      officeSource.showBeat(play.playback, step.index);
    }
  }, [play, playNow, officeSource]);

  // Skip has the focus while a year plays out.
  useEffect(() => {
    if (play.phase === "playing") skipRef.current?.focus({ preventScroll: true });
  }, [play]);

  const onCloseReport = useCallback(() => {
    // The ending's sound belongs to the click that reveals it.
    const state = gameStore.getState();
    const ending =
      !state.over || state.game === null
        ? null
        : state.config.career !== undefined
          ? careerEndView(state.game, state.record, state.config)
          : endView(state.game, state.config);
    if (ending !== null) SFX.gameOver(ending.sound);
    reportClosedAt.current = performance.now();
    // The full report opened from the summary, whose button is gone: focus goes back to the top of the page.
    if (fullReport) titleRef.current?.focus({ preventScroll: true });
    setFullReport(false);
    closeReport();
  }, [closeReport, fullReport]);

  const onSkip = useCallback(() => {
    if (performance.now() - playStartedAt.current < SETTLE_MS) return;
    finishPlay();
  }, [finishPlay]);

  const showFullReport = useCallback(() => setFullReport(true), []);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  /** "Show in market" on a rival's card: the market, that company selected, and the office cell in view. */
  const showInMarket = useCallback((seat: number) => {
    setChosenView("market");
    setSelectedSeat(seat);
    cellRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  if (game === null || draft === null || resource === null || planning === null) return null;
  const company = game.companies[PLAYER_ID];
  const { projection } = planning;
  const cashTone = projection.cash < 0 ? TONE.danger : projection.cashFloor < 0 ? TONE.caution : "text-gray-100";
  // The most serious thing to know before ending the year or quarter, if there is one.
  const headline = planning.warnings.find((warning) => warning.level !== "note");
  const playing = play.phase === "playing";
  // While a year plays out the page behind already shows the next year: it is dimmed, so the office and the
  // caption are the one year in view.
  const dim = `transition-opacity duration-300 ${playing ? "opacity-40" : ""}`;
  const beat = beatNow(play, playNow);
  const shownView = viewNow(chosenView, playing ? beat : null);
  const officeNames = rulesForTurn(config, game.turn).career?.offices.map((office) => office.name) ?? [];

  return (
    <>
      <div inert={report !== null || helpOpen || playing}>
        <main className="mx-auto w-full max-w-6xl space-y-3 px-3 pb-44 pt-3 md:pb-28">
          <header className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 ${dim}`}>
            <p className={LABEL}>StartUpWorld</p>
            <h1 ref={titleRef} tabIndex={-1} className="order-last w-full min-w-0 truncate text-sm font-semibold text-gray-100 outline-none sm:order-none sm:w-auto sm:flex-1">
              {resource.companyName}{" "}
              <span className="font-normal text-mist/70">· {status !== null ? status.heading : `${words.when(game.turn)} of ${resource.maxTurns}`}</span>
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
              {career && (
                <button
                  type="button"
                  aria-pressed={layout === "3d"}
                  disabled={!canSwitch(availability, wide)}
                  title={canSwitch(availability, wide) ? undefined : availability === "unsupported" || availability === "failed" ? OFFICE_WORDS.unavailable : OFFICE_WORDS.narrow}
                  onClick={toggleOffice}
                  className={`${layout === "3d" ? BUTTON_ON : BUTTON} px-2 py-1 text-[0.65rem] disabled:opacity-50`}
                >
                  {OFFICE_WORDS.toggle}
                </button>
              )}
              {career && reloadOffered(availability) && (
                <button type="button" title={OFFICE_WORDS.lost} onClick={reloadOffice} className={`${BUTTON} px-2 py-1 text-[0.65rem]`}>
                  {OFFICE_WORDS.reload}
                </button>
              )}
              <SoundMenu />
              {confirmingQuit ? (
                <>
                  {words.career && (
                    <button type="button" onClick={leave} className={`${BUTTON} px-2 py-1 text-[0.65rem]`}>
                      Save and leave
                    </button>
                  )}
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

          {layout === "3d" ? (
            <>
              <div className={`space-y-3 ${dim}`}>
                {timeline !== null && <Timeline view={timeline} />}
                {event !== null && (
                  <EventBanner event={event} words={words} datedYear={datedYear(game.event, game.turn, config)} historyEnds={timeline?.historyEnds ?? null} />
                )}
              </div>
              {/* A desktop window: the office and the year's figures on the left, the plan on the right. */}
              <div className="grid items-start gap-3 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div ref={cellRef} data-office className="overflow-hidden rounded-xl" style={cellHeight === null ? undefined : { height: cellHeight }}>
                    <OfficeSlot
                      source={officeSource}
                      draft={draft}
                      onMove={onMove}
                      onView={onView}
                      onFailed={onOfficeFailed}
                      market={market}
                      view={shownView}
                      selectedSeat={selectedSeat}
                      playing={playing}
                      rivals={rivals}
                      onSelectCompany={setSelectedSeat}
                      onChooseView={setChosenView}
                    />
                  </div>
                  <div className={`space-y-3 ${dim}`}>
                    {status !== null && <CareerStatus view={status} />}
                    <ResourceBar view={resource} boardRunwayTurns={rulesForTurn(config, game.turn).board.runwayTurns} words={words} rescueUsed={status !== null && status.rescueYear !== null} compact />
                    <ProjectionCard company={company} view={planning} words={words} move={move} />
                    <RivalsPanel you={resource} rivals={rivals} words={words} careers={rivalCareers} onShow={market === null ? undefined : showInMarket} />
                  </div>
                </div>
                <div className={dim}>
                  <PlanningPanel company={company} turn={game.turn} draft={draft} view={planning} config={rulesForTurn(config, game.turn)} words={words} listing={listing} onChange={onChange} />
                </div>
              </div>
            </>
          ) : (
            <>
            {timeline !== null && <Timeline view={timeline} />}
            {status !== null && <CareerStatus view={status} />}
            <ResourceBar view={resource} boardRunwayTurns={rulesForTurn(config, game.turn).board.runwayTurns} words={words} rescueUsed={status !== null && status.rescueYear !== null} />
            {event !== null && (
              <EventBanner event={event} words={words} datedYear={datedYear(game.event, game.turn, config)} historyEnds={timeline?.historyEnds ?? null} />
            )}

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
                <PlanningPanel company={company} turn={game.turn} draft={draft} view={planning} config={rulesForTurn(config, game.turn)} words={words} listing={listing} onChange={onChange} />
              </div>
              <div className="space-y-3">
                <div className={tab === "plan" ? "" : "hidden lg:block"}>
                  <ProjectionCard company={company} view={planning} words={words} move={move} />
                </div>
                <div className={tab === "rivals" ? "" : "hidden lg:block"}>
                  <RivalsPanel you={resource} rivals={rivals} words={words} careers={rivalCareers} />
                </div>
              </div>
            </div>
            </>
          )}
        </main>

        {/* Always in reach: what the plan does to cash, the most serious warning, and the button that ends the year or quarter. */}
        <div ref={barRef} className="panel-surface fixed inset-x-0 bottom-0 z-30 rounded-t-xl border-b-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {/* Narrow screens have no room beside the button: the warning gets lines of its own above it. */}
          {headline !== undefined && <p className={`mx-auto line-clamp-3 w-full max-w-6xl px-3 pt-2 text-[0.7rem] leading-snug md:hidden ${TONE[headline.level]}`}>{headline.text}</p>}
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 shrink-0 text-xs">
              <div className="text-[0.6rem] uppercase tracking-[0.16em] text-mist/60">Cash after {words.when(game.turn)}</div>
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
              End {words.when(game.turn)}
            </button>
          </div>
        </div>
      </div>

      {play.phase === "playing" && (
        <div className="panel-surface fixed inset-x-0 bottom-0 z-40 rounded-t-xl border-b-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2.5" role="status">
            <div className="min-w-0 flex-1 text-xs">
              <div className="text-[0.6rem] uppercase tracking-[0.16em] text-mist/60">{playingLine(play.year)}</div>
              <div className="truncate font-semibold text-gray-100">{beat === null ? "\u00a0" : beatLine(beat, officeNames)}</div>
            </div>
            <button ref={skipRef} type="button" onClick={onSkip} className={`${PRIMARY} shrink-0`}>
              {OFFICE_WORDS.skip}
            </button>
          </div>
        </div>
      )}
      {report !== null &&
        !playing &&
        (careerReport !== null && !fullReport ? (
          <YearSummary career={careerReport} view={report} over={over} words={words} onFull={showFullReport} onClose={onCloseReport} />
        ) : (
          <QuarterReport companyName={resource.companyName} view={report} over={over} words={words} career={careerReport} datedNext={datedNext} historyEnds={timeline?.historyEnds ?? null} onClose={onCloseReport} />
        ))}
      {helpOpen && <HowToPlayDialog config={config} onClose={closeHelp} />}
    </>
  );
};
