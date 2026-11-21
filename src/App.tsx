import { HudBar } from "./ui/components/HudBar";
import { EventCard } from "./ui/components/EventCard";
import { GameOverCard } from "./ui/components/GameOverCard";
import { LeaderboardOverlay } from "./ui/components/LeaderboardOverlay";
import { TerminalInput, TerminalLog, useTypewriterQueue } from "./ui/terminal";
import { useGameStore } from "./state/useGameStore";
import { MobilePanelsSheet } from "./ui/components/MobilePanelsSheet";
import { StatsDrawer, type StatsPanelKey } from "./ui/components/StatsDrawer";
import type { SheetSnap } from "./ui/components/BottomSheet";
import { OnboardingCard } from "./ui/components/OnboardingCard";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { stageRaiseCaps } from "./engine/investors";
import { ASSET_CATALOG, ALL_ASSET_IDS, phaseAtLeast } from "./engine/assets";
import { useUiStore } from "./state/useUiStore";
import { WorldBoundary, WorldPlaceholder, WorldUnavailableNote } from "./world/ui/WorldShell";

// The 3D world (three.js and all scene code) is its own chunk: the terminal is
// interactive before it arrives, and stays the whole game if it never does.
const WorldView = lazy(() => import("./world/WorldView"));

/** How long the 3D world has the screen to itself when a run ends, before the game-over card. */
const ENDING_SCENE_MS = 4500;

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);
  const resetGame = useGameStore((store) => store.resetGame);
  const commandHistory = useGameStore((store) => store.commandHistory);
  const worldEnabled = useUiStore((store) => store.worldEnabled);
  const worldUnsupported = useUiStore((store) => store.worldUnsupported);
  const toggleWorld = useUiStore((store) => store.toggleWorld);
  const setWorldUnsupported = useUiStore((store) => store.setWorldUnsupported);
  // With the world on screen the app becomes a fixed, full-height shell. Without
  // it (switched off, or not available on this device) the layout is the classic
  // terminal-only page, untouched.
  const showWorld = worldEnabled && !worldUnsupported;

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsActive, setStatsActive] = useState<StatsPanelKey>("growth");
  const [mobileStatsSnap, setMobileStatsSnap] = useState<SheetSnap>("collapsed");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const { rendered: typedLog, isTyping, flushAll } = useTypewriterQueue(log);

  // When a run ends in front of the player, the 3D world plays the ending out —
  // confetti and a cheering office, or the lights going down and people leaving —
  // and the game-over card (a full-screen overlay) waits for that. A save that is
  // loaded already over, or a run that ends with the world switched off, shows
  // the card at once. Tracked by the ending object itself, so every run gets its scene.
  const ending = state.gameOver;
  const [endingRevealed, setEndingRevealed] = useState(ending);
  useEffect(() => {
    if (!ending || !showWorld) return;
    const timer = window.setTimeout(() => setEndingRevealed(ending), ENDING_SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [ending, showWorld]);
  const showGameOver = Boolean(ending) && (!showWorld || endingRevealed === ending);

  const boardMembers = useMemo(() =>
    state.board.members.map(m => ({
      name: m.name,
      personality: m.personality,
      confidence: m.confidence,
      role: m.role,
    })),
    [state.board.members]
  );

  const raiseAmountHints = useMemo(() => {
    const caps = stageRaiseCaps[state.stage];
    if (!caps) return [];
    const fmt = (n: number): string => {
      if (n >= 1_000_000) return `${n / 1_000_000}m`;
      if (n >= 1_000) return `${n / 1_000}k`;
      return String(n);
    };
    const label = (n: number): string => {
      if (n >= 1_000_000) return `$${n / 1_000_000}M`;
      if (n >= 1_000) return `$${n / 1_000}K`;
      return `$${n}`;
    };
    const conservative = Math.round(caps.softCap * 0.4 / 1000) * 1000;
    const mid = Math.round((caps.softCap + caps.hardCap) / 2 / 1000) * 1000;
    return [
      { label: `${label(conservative)} (conservative)`, value: fmt(conservative), tooltip: "A modest raise. Easier to close, less dilution." },
      { label: `${label(caps.softCap)} (soft cap)`, value: fmt(caps.softCap), tooltip: `Standard raise for ${state.stage} stage. Good probability if pipeline is warm.` },
      { label: `${label(mid)} (ambitious)`, value: fmt(mid), tooltip: "Above soft cap. Harder to close, more dilution pressure." },
      { label: `${label(caps.hardCap)} (hard cap)`, value: fmt(caps.hardCap), tooltip: `Maximum for ${state.stage} stage. Very hard to close. High dilution risk.` },
    ];
  }, [state.stage]);

  const availableAssets = useMemo(() =>
    ALL_ASSET_IDS
      .filter(id => !state.assets.some(a => a.id === id))
      .filter(id => phaseAtLeast(state.companyPhase, ASSET_CATALOG[id].minPhase))
      .map(id => {
        const def = ASSET_CATALOG[id];
        return {
          id: def.id,
          name: def.name,
          cost: def.cost,
          tooltip: `${def.description} | Maintenance: $${def.maintenanceCost.toLocaleString()}/wk`,
        };
      }),
    [state.assets, state.companyPhase]
  );

  const onboardingComplete = Boolean(
    state.founder.name.trim() && state.companyName.trim() && state.founder.archetype && state.cofounder.archetype
  );

  const terminalInputRef = useRef<HTMLInputElement>(null);
  const onboardingInputRef = useRef<HTMLInputElement>(null);
  const previousOnboardingCompleteRef = useRef(onboardingComplete);

  useEffect(() => {
    const isCoarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (isCoarsePointer) return;
    if (!onboardingComplete) {
      onboardingInputRef.current?.focus();
      return;
    }
    terminalInputRef.current?.focus();
  }, [onboardingComplete]);

  useEffect(() => {
    const wasComplete = previousOnboardingCompleteRef.current;
    previousOnboardingCompleteRef.current = onboardingComplete;
    if (!wasComplete && onboardingComplete) {
      flushAll();
    }
  }, [flushAll, onboardingComplete]);

  const effectiveStatsOpen = statsOpen || mobileStatsSnap !== "collapsed";
  const restartRun = () => {
    const shouldRestart = typeof window === "undefined"
      ? true
      : window.confirm("Start a new run? Your current progress will be lost.");
    if (!shouldRestart) return;
    resetGame();
  };

  const toggleStats = () => {
    setStatsOpen((prev) => !prev);
    setMobileStatsSnap((prev) => (prev === "collapsed" ? "mid" : "collapsed"));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);
      if (isEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // A focused control (Stats, Ranks, 3D, New Run, an event choice, a button in
      // the 3D world's overlay…) is operated from the keyboard like any control:
      // Enter / Space press it instead of being redirected to the terminal.
      const pressesControl =
        (event.key === "Enter" || event.key === " ") &&
        Boolean(target?.closest?.("button, a[href], summary, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch]"));
      if (pressesControl) return;

      // A popover that manages its own focus (the Sound menu) answers Escape itself: it
      // closes and hands focus back to the button that opened it.
      if (event.key === "Escape" && target?.closest?.("[data-own-escape]")) return;

      // If the user starts typing anywhere, route focus back to the terminal.
      const shouldFocus = event.key === "Escape" || event.key === "Enter" || event.key === "Backspace" || event.key.length === 1;
      if (!shouldFocus) return;

      if (!onboardingComplete) {
        onboardingInputRef.current?.focus();
        return;
      }
      terminalInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onboardingComplete]);

  const mainSpan = statsOpen ? "md:col-span-8 lg:col-span-9" : "md:col-span-12";

  return (
    // Fixed-height shell, with or without the 3D world: nothing scrolls but the
    // terminal log (and the stats drawer). When space runs short the world gives
    // way first, down to a minimum; the log keeps at least 200 px and the input
    // stays on screen. Only a window too short for those minimums scrolls the page.
    <div className="h-[100dvh] px-3 py-3 text-slate-100 short:py-2 md:px-6">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 short:gap-2">
        <div className="relative z-20 shrink-0">
          <HudBar
            state={state}
            setupComplete={onboardingComplete}
            onToggleStats={toggleStats}
            statsOpen={effectiveStatsOpen}
            onToggleLeaderboard={() => setLeaderboardOpen(true)}
            onRestart={restartRun}
            onToggleWorld={toggleWorld}
            worldEnabled={worldEnabled}
          />
        </div>

        {/* A run can end with an event still open; there is nothing left to choose then. */}
        {state.pendingEvent && !state.gameOver && (
          <div className="shrink-0">
            <EventCard event={state.pendingEvent} runCommand={runCommand} compact={showWorld} />
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 short:gap-2 md:grid-cols-12">
          <div
            className={`flex min-h-0 flex-col gap-3 short:gap-2 ${mainSpan}`}
            onMouseDownCapture={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.("[data-terminal-log]")) return;
              if (target?.closest?.("[data-onboarding]")) return;
              // The world keeps focus where it is by itself (and on touch devices,
              // focusing the input here would raise the keyboard on every tap).
              if (target?.closest?.("[data-world]")) return;
              terminalInputRef.current?.focus();
            }}
          >
            {showWorld ? (
              // World above, terminal below: ~62% of the column on desktop, ~39dvh on phones.
              // It shrinks before the terminal does (the terminal's minimum is its log's 200 px).
              // The desktop viewport is much wider than the office, so its height is what
              // decides how big the office is drawn: it gets the larger share.
              <div className="min-h-[180px] shrink basis-[39dvh] md:min-h-[150px] md:basis-[62%]">
                <WorldBoundary fallback={null} onError={() => setWorldUnsupported(true)}>
                  <Suspense fallback={<WorldPlaceholder />}>
                    <WorldView runCommand={runCommand} />
                  </Suspense>
                </WorldBoundary>
              </div>
            ) : null}
            {worldEnabled && worldUnsupported ? <WorldUnavailableNote /> : null}

            {/* No min-h-0 here: the terminal's minimum is its content's (setup card, input, a 200 px log), so the world shrinks instead. */}
            <div className="flex flex-1 flex-col">
              {!onboardingComplete ? (
                <div className="shrink-0">
                  <OnboardingCard state={state} runCommand={runCommand} inputRef={onboardingInputRef} />
                </div>
              ) : null}
              <div className="shrink-0">
                {/* Enter while output is typing skips to the end of it (all of it: a week's
                    close is a dozen lines, one Enter each was a chore); it never submits. */}
                <TerminalInput ref={terminalInputRef} onSubmit={runCommand} isTyping={isTyping} fastForward={flushAll} commandHistory={commandHistory} boardMembers={boardMembers} raiseAmountHints={raiseAmountHints} availableAssets={availableAssets} />
              </div>
              <TerminalLog log={typedLog} isTyping={isTyping} />
            </div>
          </div>

          {statsOpen ? (
            <div className="hidden min-h-0 md:col-span-4 md:flex md:flex-col lg:col-span-3">
              <StatsDrawer state={state} active={statsActive} onActiveChange={setStatsActive} />
            </div>
          ) : null}
        </div>

        {showGameOver && (
          <GameOverCard
            state={state}
            onPlayAgain={resetGame}
            // With the world on screen the player can put the card aside to look at the ending scene.
            canPeek={showWorld}
          />
        )}

        {leaderboardOpen && (
          <LeaderboardOverlay onClose={() => setLeaderboardOpen(false)} currentSeed={state.seed} />
        )}

        {/* The sheet is position: fixed; in the shell layout its wrapper must not take a flex gap. */}
        <div className="contents md:hidden">
          <MobilePanelsSheet
            state={state}
            snap={mobileStatsSnap}
            collapsedVh={0}
            onSnapChange={(next) => {
              setMobileStatsSnap(next);
              setStatsOpen(next !== "collapsed");
            }}
          />
        </div>
      </div>
      <Analytics />
    </div>
  );
};

export default App;
