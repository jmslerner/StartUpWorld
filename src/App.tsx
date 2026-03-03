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
import { HudBarMock } from "./ui/components/HudBarMock";
import { useEffect, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);
  const resetGame = useGameStore((store) => store.resetGame);

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsActive, setStatsActive] = useState<StatsPanelKey>("growth");
  const [mobileStatsSnap, setMobileStatsSnap] = useState<SheetSnap>("collapsed");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  const { rendered: typedLog, isTyping, fastForward } = useTypewriterQueue(log);

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

  const showHudMock = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("hud");

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

  if (showHudMock) {
    return (
      <div className="min-h-screen px-3 py-4 text-slate-100 md:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <HudBarMock />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen px-3 py-4 pb-4 text-slate-100 md:px-6"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="sticky top-3 z-20 md:static">
          <HudBar state={state} onToggleStats={toggleStats} statsOpen={effectiveStatsOpen} onToggleLeaderboard={() => setLeaderboardOpen(true)} />
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
            <TerminalInput ref={terminalInputRef} onSubmit={runCommand} isTyping={isTyping} fastForward={fastForward} />
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
