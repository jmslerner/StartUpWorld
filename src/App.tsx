import { FundingStrip, HudBar } from "./ui/components/HudBar";
import { TerminalInput, TerminalLog } from "./ui/terminal";
import { useGameStore } from "./state/useGameStore";
import { CompanyPanel, FundingPanel, GrowthPanel, ProductPanel, TeamPanel } from "./ui/panels";

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);

  return (
    <div className="min-h-screen px-3 py-4 text-slate-100 md:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <FundingStrip state={state} />
        <HudBar state={state} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="flex min-h-[60vh] flex-col gap-3">
            <TerminalLog log={log} />
            <TerminalInput onSubmit={runCommand} />
          </div>

          <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:max-h-[60vh] lg:grid-cols-1">
            <CompanyPanel state={state} />
            <TeamPanel state={state} />
            <ProductPanel state={state} />
            <GrowthPanel state={state} />
            <FundingPanel state={state} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
