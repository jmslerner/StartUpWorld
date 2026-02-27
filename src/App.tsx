import { HudBar } from "./ui/components/HudBar";
import { EventCard } from "./ui/components/EventCard";
import { TerminalInput, TerminalLog, useTypewriterQueue } from "./ui/terminal";
import { useGameStore } from "./state/useGameStore";
import { GrowthPanel, TeamPanel, RiskProfilePanel } from "./ui/panels";
import { MobilePanelsSheet } from "./ui/components/MobilePanelsSheet";
import { useEffect, useRef } from "react";

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);

  const { rendered: typedLog, isTyping, fastForward } = useTypewriterQueue(log);

  const terminalInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    terminalInputRef.current?.focus();
  }, []);

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

      terminalInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div
      className="min-h-screen px-3 py-4 pb-[18vh] text-slate-100 md:px-6 md:pb-4"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <div className="sticky top-3 z-20 md:static">
          <HudBar state={state} />
        </div>

        {state.pendingEvent && <EventCard event={state.pendingEvent} />}

        <div className="grid gap-3 md:grid-cols-12">
          <div
            className="flex min-h-[60vh] flex-col md:col-span-7 lg:col-span-8"
            onMouseDownCapture={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.("[data-terminal-log]")) return;
              terminalInputRef.current?.focus();
            }}
          >
            <TerminalInput ref={terminalInputRef} onSubmit={runCommand} isTyping={isTyping} fastForward={fastForward} />
            <TerminalLog log={typedLog} isTyping={isTyping} />
          </div>

          <div className="hidden gap-3 md:col-span-5 md:grid md:max-h-[70vh] md:overflow-y-auto md:pr-1 lg:col-span-4 lg:max-h-[60vh]">
            <GrowthPanel state={state} />
            <TeamPanel state={state} />
            <RiskProfilePanel state={state} />
          </div>
        </div>

        <div className="md:hidden">
          <MobilePanelsSheet state={state} />
        </div>
      </div>
    </div>
  );
};

export default App;
