import { useId, useState, type FormEvent } from "react";
import { CONFIG } from "../../config";
import { useGame } from "../../state/useGame";
import { HowToPlay } from "../components/HowToPlay";
import { SoundMenu } from "../components/SoundMenu";
import { SFX } from "../sound";
import { HINT, LABEL, PRIMARY } from "../styles";

const MAX_SEED = 2_000_000_000;

/** The first screen: name the company, read the rules, start. */
export const NewGameScreen = () => {
  const startGame = useGame((state) => state.startGame);
  const [name, setName] = useState("");
  const [seedText, setSeedText] = useState("");
  const nameId = useId();
  const seedId = useId();

  const typedSeed = Number(seedText);
  const seedIsValid = seedText.trim() === "" || (Number.isInteger(typedSeed) && typedSeed >= 1 && typedSeed <= MAX_SEED);

  const start = (event: FormEvent) => {
    event.preventDefault();
    if (!seedIsValid) return;
    // A game is its seed plus the plans made: the same seed deals the same rivals and events.
    const seed = seedText.trim() === "" ? 1 + Math.floor(Math.random() * MAX_SEED) : typedSeed;
    SFX.opportunity();
    startGame(name, seed);
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col justify-center gap-3 px-3 py-6">
      <section className="panel-surface rounded-xl px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <p className={LABEL}>StartUpWorld</p>
          <SoundMenu />
        </div>
        <h1 className="mt-3 text-xl font-semibold leading-tight text-gray-100 sm:text-2xl">Run a startup against three rivals.</h1>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          One turn is a quarter. You have {CONFIG.game.maxTurns} of them to take your company public before a blitzscaler, a bootstrapper or the incumbent gets there first.
        </p>

        <form onSubmit={start} className="mt-5">
          <label htmlFor={nameId} className="block text-sm text-gray-100">
            Name your startup
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={nameId}
              type="text"
              value={name}
              maxLength={24}
              autoComplete="off"
              placeholder="Your Startup"
              onChange={(event) => setName(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-gray-100 placeholder:text-mist/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon/70"
            />
            <button type="submit" disabled={!seedIsValid} className={PRIMARY}>
              Start the first quarter
            </button>
          </div>

          <details className="mt-3">
            <summary className={`${HINT} cursor-pointer select-none`}>Replay a game with its seed</summary>
            <label htmlFor={seedId} className={`${HINT} mt-2 block`}>
              A seed fixes the rivals and the events. Leave it empty for a new game.
            </label>
            <input
              id={seedId}
              type="text"
              inputMode="numeric"
              value={seedText}
              placeholder="for example 20417"
              onChange={(event) => setSeedText(event.target.value)}
              aria-invalid={!seedIsValid}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 placeholder:text-mist/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon/70 sm:w-56"
            />
            {!seedIsValid && <p className="mt-1 text-xs text-amber-400">A seed is a whole number from 1 to {MAX_SEED.toLocaleString("en-US")}.</p>}
          </details>
        </form>
      </section>

      <section className="panel-surface rounded-xl px-4 py-5 sm:px-6">
        <h2 className={`${LABEL} mb-3`}>How to play</h2>
        <HowToPlay config={CONFIG} />
      </section>
    </main>
  );
};
