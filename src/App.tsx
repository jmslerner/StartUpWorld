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
import { useEffect, useMemo, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { stageRaiseCaps } from "./engine/investors";
import { ASSET_CATALOG, ALL_ASSET_IDS, phaseAtLeast } from "./engine/assets";

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);
  const resetGame = useGameStore((store) => store.resetGame);
  const commandHistory = useGameStore((store) => store.commandHistory);

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsActive, setStatsActive] = useState<StatsPanelKey>("growth");
  const [mobileStatsSnap, setMobileStatsSnap] = useState<SheetSnap>("collapsed");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const { rendered: typedLog, isTyping, fastForward } = useTypewriterQueue(log);

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

  const terminalInputRef = useRef<HTMLInputElement>(null);
  const onboardingInputRef = useRef<HTMLInputElement>(null);

  const onboardingComplete = Boolean(
    state.founder.name.trim() && state.companyName.trim() && state.founder.archetype && state.cofounder.archetype
  );

  useEffect(() => {
    const isCoarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (isCoarsePointer) return;
    if (!onboardingComplete) {
      onboardingInputRef.current?.focus();
      return;
    }
    terminalInputRef.current?.focus();
  }, [onboardingComplete]);

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

  return (
    <div
      className="min-h-screen px-3 py-4 pb-4 text-slate-100 md:px-6"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="sticky top-3 z-20 md:static">
          <HudBar
            state={state}
            setupComplete={onboardingComplete}
            onToggleStats={toggleStats}
            statsOpen={effectiveStatsOpen}
            onToggleLeaderboard={() => setLeaderboardOpen(true)}
            onRestart={restartRun}
          />
        </div>

        {state.pendingEvent && <EventCard event={state.pendingEvent} />}

        <div className="grid gap-3 md:grid-cols-12">
          <div
            className={
              statsOpen
                ? "flex min-h-[60vh] flex-col md:col-span-8 lg:col-span-9"
                : "flex min-h-[60vh] flex-col md:col-span-12"
            }
            onMouseDownCapture={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.("[data-terminal-log]")) return;
              if (target?.closest?.("[data-onboarding]")) return;
              terminalInputRef.current?.focus();
            }}
          >
            {!onboardingComplete ? (
              <OnboardingCard state={state} runCommand={runCommand} inputRef={onboardingInputRef} />
            ) : null}
            <TerminalInput ref={terminalInputRef} onSubmit={runCommand} isTyping={isTyping} fastForward={fastForward} commandHistory={commandHistory} boardMembers={boardMembers} raiseAmountHints={raiseAmountHints} availableAssets={availableAssets} />
            <TerminalLog log={typedLog} isTyping={isTyping} />
          </div>

          {statsOpen ? (
            <div className="hidden md:col-span-4 md:block lg:col-span-3">
              <div className="sticky top-3">
                <StatsDrawer state={state} active={statsActive} onActiveChange={setStatsActive} />
              </div>
            </div>
          ) : null}
        </div>

        {state.gameOver && <GameOverCard state={state} onPlayAgain={resetGame} />}

        {leaderboardOpen && (
          <LeaderboardOverlay onClose={() => setLeaderboardOpen(false)} currentSeed={state.seed} />
        )}

        <div className="md:hidden">
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
