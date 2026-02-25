import { HudBar } from "./ui/components/HudBar";
import { TerminalInput, TerminalLog } from "./ui/terminal";
import { useGameStore } from "./state/useGameStore";
import { CompanyPanel, FundingPanel, GrowthPanel, ProductPanel, TeamPanel } from "./ui/panels";

const App = () => {
  const state = useGameStore((store) => store.state);
  const log = useGameStore((store) => store.log);
  const runCommand = useGameStore((store) => store.runCommand);

  return (
    <div className="min-h-screen px-4 py-6 text-slate-100 md:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <HudBar state={state} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="flex min-h-[70vh] flex-col gap-4">
            <TerminalLog log={log} />
            <TerminalInput onSubmit={runCommand} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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
