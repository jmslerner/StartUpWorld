import { useEffect, useMemo, useRef, useState } from "react";
import type { CofounderArchetype, FounderArchetype, GameState } from "../../types/game";

export type OnboardingStep = "name" | "company" | "founder" | "cofounder" | null;

interface OnboardingCardProps {
  state: GameState;
  runCommand: (input: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const founderChoices: Array<{ token: FounderArchetype; label: string; title: string }> = [
  { token: "visionary", label: "Visionary", title: "Big narrative, higher variance." },
  { token: "hacker", label: "Hacker", title: "Ships fast, strong execution." },
  { token: "sales-animal", label: "Sales Animal", title: "GTM + fundraising lift, chaotic upside." },
  { token: "philosopher", label: "Philosopher", title: "Calmer, culture-first, lower volatility." },
];

const cofounderChoices: Array<{ token: CofounderArchetype; label: string; title: string }> = [
  { token: "operator", label: "Operator", title: "Stability + process." },
  { token: "builder", label: "Builder", title: "Reliable product execution." },
  { token: "rainmaker", label: "Rainmaker", title: "Intros + deals." },
  { token: "powderkeg", label: "Powderkeg", title: "High upside, high drama." },
];

const getStep = (state: GameState): OnboardingStep => {
  if (!state.founder.name.trim()) return "name";
  if (!state.companyName.trim()) return "company";
  if (!state.founder.archetype) return "founder";
  if (!state.cofounder.archetype) return "cofounder";
  return null;
};

export const OnboardingCard = ({ state, runCommand, inputRef }: OnboardingCardProps) => {
  const step = useMemo(() => getStep(state), [state]);
  const [nameDraft, setNameDraft] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  const localInputRef = useRef<HTMLInputElement>(null);
  const effectiveInputRef = inputRef ?? localInputRef;

  useEffect(() => {
    if (step === "name" || step === "company") {
      queueMicrotask(() => effectiveInputRef.current?.focus());
    }
  }, [effectiveInputRef, step]);

  if (!step) return null;

  return (
    <div data-onboarding className="panel-surface flex flex-col gap-2 rounded-xl px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist">
        <span className="font-semibold text-white">Start your run</span>
        <span className="text-mist/60">|</span>
        <span className={step === "name" ? "text-neon" : "text-mist/70"}>1) Name</span>
        <span className={step === "company" ? "text-neon" : "text-mist/70"}>2) Company</span>
        <span className={step === "founder" ? "text-neon" : "text-mist/70"}>3) Founder</span>
        <span className={step === "cofounder" ? "text-neon" : "text-mist/70"}>4) Cofounder</span>
      </div>

      {step === "name" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = nameDraft.trim();
            if (!trimmed) return;
            runCommand(`name ${trimmed}`);
            setNameDraft("");
          }}
        >
          <span className="select-none text-mist/70">Your name</span>
          <input
            ref={effectiveInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="e.g. Ada"
            className="w-full bg-transparent text-base text-slate-100/90 outline-none caret-neon md:text-sm"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="shrink-0 rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80">
            Set
          </button>
        </form>
      ) : null}

      {step === "company" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = companyDraft.trim();
            if (!trimmed) return;
            runCommand(`company ${trimmed}`);
            setCompanyDraft("");
          }}
        >
          <span className="select-none text-mist/70">Company</span>
          <input
            ref={effectiveInputRef}
            value={companyDraft}
            onChange={(e) => setCompanyDraft(e.target.value)}
            placeholder="e.g. Stealth Tiger"
            className="w-full bg-transparent text-base text-slate-100/90 outline-none caret-neon md:text-sm"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="shrink-0 rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80">
            Set
          </button>
        </form>
      ) : null}

      {step === "founder" ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {founderChoices.map((c) => (
            <button
              key={c.token}
              type="button"
              title={c.title}
              onClick={() => runCommand(`founder ${c.token}`)}
              className="rounded-lg bg-steel/30 px-2 py-1.5 text-xs text-slate-100/90 hover:bg-white/5"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {step === "cofounder" ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {cofounderChoices.map((c) => (
            <button
              key={c.token}
              type="button"
              title={c.title}
              onClick={() => runCommand(`cofounder ${c.token}`)}
              className="rounded-lg bg-steel/30 px-2 py-1.5 text-xs text-slate-100/90 hover:bg-white/5"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
