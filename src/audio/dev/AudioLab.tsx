import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CompanyPhase } from "../../types/game";
import { SoundMenu } from "../../ui/components/SoundMenu";
import type { WorldEvent } from "../../world/types";
import type { AmbienceState } from "../ambience";
import { getAudioEngine } from "../engine";
import { BUS_NAMES, audioSettings, type BusName } from "../settings";
import { SOUND_NAMES, SOUNDS, type SoundName } from "../sounds";
import { SAMPLE_EVENTS, WORLD_EVENT_TYPES, describeEvent, makeSnapshot } from "../testing/fixtures";
import { STORE_STINGERS, createWorldAudio, type WorldAudio } from "../worldAudio";
import { PAIR_LIMITS, limitsFor } from "./labChecks";
import { PAIRS, storeStingersFor } from "./labPairs";
import { drawSpectrogram, drawWaveform } from "./labDraw";
import { LAB_AMBIENCE_STATE, labOptions, measureAmbience, measureMusic, measurePair, pairWindow, type AmbienceResult, type MusicResult, type PairResult, type SoundResult } from "./labRender";
import {
  LabSession,
  PHASES,
  createLabApi,
  installLabApi,
  prepareLabEngine,
  summarize,
  summarizeAmbience,
  summarizeMusic,
  summarizePair,
  type AmbienceSummary,
} from "./labSession";

/**
 * /audio-lab (dev only): every sound with a play button and its measurements, the mixer, the
 * ambience and music directors, a WorldEvent bench, and `window.__audioLab` for the headless
 * harness. Query: ?bus=world&page=0&per=8 (one page of big cards), ?focus=a,b (named sounds),
 * ?only=sounds | panels | pairs (show just that part; "pairs" renders the stinger + world pairs on
 * load), ?auto=0 (do not measure on load), ?sink=none (live engine
 * on a silent null device, for headless runs), ?phase=…&team=… (initial ambience controls).
 */

const session = new LabSession();
prepareLabEngine();

interface Query {
  bus: BusName | "all";
  focus: SoundName[] | null;
  page: number | null;
  per: number;
  only: string | null;
  auto: boolean;
}

const readQuery = (): Query => {
  const params = new URLSearchParams(window.location.search);
  const bus = params.get("bus");
  const focus = params.get("focus");
  const page = params.get("page");
  return {
    bus: BUS_NAMES.includes(bus as BusName) ? (bus as BusName) : "all",
    focus: focus ? focus.split(",").filter((name): name is SoundName => name in SOUNDS) : null,
    page: page === null ? null : Math.max(0, Number(page) || 0),
    per: Math.max(1, Number(params.get("per")) || 8),
    only: params.get("only"),
    auto: params.get("auto") !== "0",
  };
};

const fmt = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : "–");

const chip = (ok: boolean): string =>
  ok ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.65rem] font-semibold text-emerald-400" : "rounded bg-red-500/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-red-400";

const buttonClass = "rounded-lg bg-steel/30 px-2 py-1 text-[0.65rem] text-mist/80 hover:bg-steel/50";
const activeButtonClass = "rounded-lg bg-neon/10 px-2 py-1 text-[0.65rem] font-semibold text-neon";

// ─────────────────────────────────────────────────────────────────────────────
// Plots
// ─────────────────────────────────────────────────────────────────────────────

interface PlotsProps {
  mono: Float32Array;
  sampleRate: number;
  durationS?: number;
  limitS?: number | null;
  centroidHz?: number;
  /** Only draw the first this-many seconds (the rest of the render is silence). */
  viewS?: number;
  large: boolean;
}

const Plots = ({ mono, sampleRate, durationS, limitS, centroidHz, viewS, large }: PlotsProps) => {
  const waveRef = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const shown = viewS === undefined ? mono : mono.subarray(0, Math.min(mono.length, Math.max(2048, Math.ceil(viewS * sampleRate))));
    if (waveRef.current) drawWaveform(waveRef.current, shown, sampleRate, { durationS, limitS });
    if (specRef.current) drawSpectrogram(specRef.current, shown, sampleRate, centroidHz);
  }, [mono, sampleRate, durationS, limitS, centroidHz, viewS, large]);

  return (
    <div className="flex flex-col gap-1">
      <canvas ref={waveRef} className={`block w-full rounded ${large ? "h-28" : "h-16"}`} />
      <canvas ref={specRef} className={`block w-full rounded ${large ? "h-40" : "h-24"}`} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// One sound
// ─────────────────────────────────────────────────────────────────────────────

interface SoundCardProps {
  name: SoundName;
  result: SoundResult | undefined;
  error: string | undefined;
  large: boolean;
}

const SoundCard = ({ name, result, error, large }: SoundCardProps) => {
  const def = SOUNDS[name];
  const summary = result ? summarize(result) : null;
  return (
    <div className="panel-surface flex flex-col gap-1.5 rounded-xl p-2.5 text-xs text-mist" data-sound={name}>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} data-play={name} onClick={() => getAudioEngine().play(name, labOptions(name))} aria-label={`Play ${name}`}>
          ▶
        </button>
        <span className="font-semibold text-white">{name}</span>
        <span className="text-mist/50">{def.bus}</span>
        <span className="ml-auto">
          {summary ? <span className={chip(summary.pass)}>{summary.pass ? "PASS" : "FAIL"}</span> : error ? <span className={chip(false)}>ERROR</span> : <span className="text-mist/40">…</span>}
        </span>
      </div>
      {summary ? (
        <div className="font-mono text-[0.65rem] leading-relaxed text-mist/80">
          peak {fmt(summary.peakDb)} dBFS (target {def.level}) · rms {fmt(summary.rmsDb)} · {fmt(summary.durationS, 3)} s
          {summary.maxDurS !== null ? ` / ${summary.maxDurS}` : ""} · {fmt(summary.loudnessM)} LUFS-M · centroid {summary.centroidHz} Hz · dc {fmt(summary.dc, 4)} · edges{" "}
          {fmt(summary.startAbs, 4)}/{fmt(summary.endAbs, 4)}
        </div>
      ) : null}
      {error ? <div className="text-red-400">{error}</div> : null}
      {summary && summary.violations.length > 0 ? (
        <ul className="list-inside list-disc text-[0.65rem] text-red-400">
          {summary.violations.map((violation) => (
            <li key={violation}>{violation}</li>
          ))}
        </ul>
      ) : null}
      {result ? (
        <Plots
          mono={result.mono}
          sampleRate={result.sampleRate}
          durationS={result.report.durationS}
          limitS={limitsFor(def).maxDur}
          centroidHz={result.report.centroidHz}
          viewS={Math.max(result.report.durationRelS * 1.2 + 0.02, (limitsFor(def).maxDur ?? 0) * (def.kind === "ui" ? 1.5 : 0.6))}
          large={large}
        />
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mixer
// ─────────────────────────────────────────────────────────────────────────────

interface RangeProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

const Range = ({ label, value, min = 0, max = 1, step = 0.01, onChange }: RangeProps) => (
  <label className="flex items-center gap-2">
    <span className="w-24 shrink-0 text-mist/80">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-1.5 w-full cursor-pointer accent-neon"
    />
    <span className="w-10 shrink-0 text-right font-mono tabular-nums text-mist/60">{step >= 1 ? value : value.toFixed(2)}</span>
  </label>
);

const Mixer = () => {
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get, audioSettings.get);
  return (
    <section className="panel-surface flex flex-col gap-2 rounded-xl p-3 text-xs text-mist">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Mixer</h2>
        <button type="button" className={buttonClass} onClick={() => audioSettings.reset()}>
          Reset to defaults
        </button>
      </div>
      <Range label="master" value={settings.master} onChange={(value) => audioSettings.setMaster(value)} />
      {BUS_NAMES.map((bus) => (
        <div key={bus} className="flex items-center gap-2">
          <div className="flex-1">
            <Range label={bus} value={settings.volumes[bus]} onChange={(value) => audioSettings.setVolume(bus, value)} />
          </div>
          <button
            type="button"
            aria-pressed={settings.busMuted[bus]}
            className={settings.busMuted[bus] ? activeButtonClass : buttonClass}
            onClick={() => audioSettings.setBusMuted(bus, !settings.busMuted[bus])}
          >
            mute
          </button>
        </div>
      ))}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Ambience + events + music
// ─────────────────────────────────────────────────────────────────────────────

const snapshotFor = (state: AmbienceState) =>
  makeSnapshot({
    phase: state.phase,
    teamSize: state.teamSize,
    morale: state.morale,
    stress: state.stress,
    runwayWeeks: state.runwayLow ? 3 : 20,
    pendingEventTitle: state.pendingEvent ? "An event" : null,
    gameOver: state.gameOver ? "bankruptcy" : null,
    setupComplete: state.setupComplete,
  });

/** What the store would play for this event, for auditioning the two layers together. */
const playStoreStinger = (event: WorldEvent): void => {
  for (const s of storeStingersFor([event])) getAudioEngine().play(s.sound, { delay: s.delay });
};

const Flag = ({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) => (
  <button type="button" aria-pressed={on} className={on ? activeButtonClass : buttonClass} onClick={onToggle}>
    {label}
  </button>
);

const BedSummary = ({ summary }: { summary: AmbienceSummary }) => (
  <div className="font-mono text-[0.65rem] leading-relaxed text-mist/80">
    <span className={chip(summary.pass)}>{summary.pass ? "PASS" : "FAIL"}</span> rms {fmt(summary.rmsDb)} dBFS (bed alone {fmt(summary.bedOnlyRmsDb)}) · 1 s
    windows {fmt(summary.windowMinDb)}…{fmt(summary.windowMaxDb)} (pump {fmt(summary.pumpDb)} dB) · one-shots {summary.oneShots}, loudest{" "}
    {fmt(summary.oneShotPeakDb)} dBFS = {fmt(summary.oneShotOverBedDb)} dB over the bed · periodicity {fmt(summary.periodicity, 2)} @ {fmt(summary.periodicityLagS, 2)} s ·
    waveform loop r {fmt(summary.loopCorrelation, 3)} · {fmt(summary.loudnessI)} LUFS · centroid {summary.centroidHz} Hz
    {summary.violations.length > 0 ? <span className="text-red-400"> — {summary.violations.join("; ")}</span> : null}
  </div>
);

/** Initial ambience controls, overridable from the query (?phase=unicorn&team=45&morale=80&stress=90&dusk=0.8&flags=runwayLow,gameOver). */
const initialAmbience = (): AmbienceState => {
  const params = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number): number => {
    const raw = params.get(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const phase = params.get("phase");
  const flags = new Set((params.get("flags") ?? "").split(","));
  const base = LAB_AMBIENCE_STATE;
  return {
    phase: PHASES.includes(phase as CompanyPhase) ? (phase as CompanyPhase) : base.phase,
    teamSize: number("team", base.teamSize),
    morale: number("morale", base.morale),
    stress: number("stress", base.stress),
    dusk: number("dusk", base.dusk),
    runwayLow: flags.has("runwayLow"),
    pendingEvent: flags.has("pendingEvent"),
    gameOver: flags.has("gameOver"),
    setupComplete: !flags.has("noSetup"),
    worldVisible: !flags.has("hidden"),
  };
};

const WorldPanel = () => {
  const [state, setState] = useState<AmbienceState>(initialAmbience);
  const [withStinger, setWithStinger] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bed, setBed] = useState<AmbienceResult | null>(null);
  const [matrix, setMatrix] = useState<Record<string, AmbienceSummary> | null>(null);
  const [music, setMusic] = useState<MusicResult | null>(null);
  const audioRef = useRef<WorldAudio | null>(null);
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get, audioSettings.get);

  useEffect(() => {
    const audio = createWorldAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.setDusk(state.dusk);
    audio.setWorldVisible(state.worldVisible);
    audio.setSnapshot(snapshotFor(state));
  }, [state]);

  const patch = (change: Partial<AmbienceState>) => setState((prev) => ({ ...prev, ...change }));

  const fire = (event: WorldEvent) => {
    if (withStinger) playStoreStinger(event);
    audioRef.current?.handleEvents([event], snapshotFor(state));
  };

  const renderBed = () => {
    setBusy(true);
    measureAmbience(state, 30)
      .then(setBed)
      .catch(() => setBed(null))
      .finally(() => setBusy(false));
  };

  const renderMatrix = () => {
    const api = (window as Window & { __audioLab?: { ambienceMatrix(seconds?: number): Promise<Record<string, AmbienceSummary>> } }).__audioLab;
    if (!api) return;
    setBusy(true);
    api
      .ambienceMatrix(30)
      .then(setMatrix)
      .catch(() => setMatrix(null))
      .finally(() => setBusy(false));
  };

  const renderMusic = () => {
    setBusy(true);
    measureMusic({ phase: state.phase, stress: state.stress }, 60)
      .then(setMusic)
      .catch(() => setMusic(null))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <section className="panel-surface flex flex-col gap-2 rounded-xl p-3 text-xs text-mist">
        <h2 className="text-sm font-semibold text-white">Ambience (live, through createWorldAudio)</h2>
        <div className="flex flex-wrap gap-1.5">
          {PHASES.map((phase: CompanyPhase) => (
            <Flag key={phase} label={phase} on={state.phase === phase} onToggle={() => patch({ phase })} />
          ))}
        </div>
        <Range label="team size" value={state.teamSize} min={0} max={64} step={1} onChange={(teamSize) => patch({ teamSize })} />
        <Range label="morale" value={state.morale} min={0} max={100} step={1} onChange={(morale) => patch({ morale })} />
        <Range label="stress" value={state.stress} min={0} max={100} step={1} onChange={(stress) => patch({ stress })} />
        <Range label="dusk" value={state.dusk} onChange={(dusk) => patch({ dusk })} />
        <div className="flex flex-wrap gap-1.5">
          <Flag label="world visible" on={state.worldVisible} onToggle={() => patch({ worldVisible: !state.worldVisible })} />
          <Flag label="setup complete" on={state.setupComplete} onToggle={() => patch({ setupComplete: !state.setupComplete })} />
          <Flag label="runway low" on={state.runwayLow} onToggle={() => patch({ runwayLow: !state.runwayLow })} />
          <Flag label="pending event" on={state.pendingEvent} onToggle={() => patch({ pendingEvent: !state.pendingEvent })} />
          <Flag label="game over" on={state.gameOver} onToggle={() => patch({ gameOver: !state.gameOver })} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={buttonClass} disabled={busy} onClick={renderBed}>
            Render 30 s offline
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={renderMatrix}>
            Render matrix (5 phases × 3 team sizes, dusk, extremes, quiet states)
          </button>
          {busy ? <span className="text-mist/50">rendering…</span> : null}
        </div>
        {bed ? (
          <>
            <BedSummary summary={summarizeAmbience(bed)} />
            <Plots mono={bed.mono} sampleRate={bed.sampleRate} centroidHz={bed.report.centroidHz} large />
          </>
        ) : null}
        {matrix ? (
          <div className="flex flex-col gap-1">
            {Object.entries(matrix).map(([key, summary]) => (
              <div key={key} className="flex gap-2">
                <span className="w-32 shrink-0 text-white">{key}</span>
                <BedSummary summary={summary} />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel-surface flex flex-col gap-2 rounded-xl p-3 text-xs text-mist">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">World events (createWorldAudio().handleEvents)</h2>
          <Flag label="with the store's stinger" on={withStinger} onToggle={() => setWithStinger(!withStinger)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {WORLD_EVENT_TYPES.flatMap((type) =>
            SAMPLE_EVENTS[type].map((event, index) => (
              <button
                key={`${type}:${index}`}
                type="button"
                className={buttonClass}
                data-event={describeEvent(event)}
                title={`store stinger: ${STORE_STINGERS[type].when}${STORE_STINGERS[type].which.length ? ` (${STORE_STINGERS[type].which.join(", ")})` : ""}`}
                onClick={() => fire(event)}
              >
                {describeEvent(event)}
              </button>
            )),
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["hover", "select", "open", "close", "press", "prefill", "denied"] as const).map((kind) => (
            <button key={kind} type="button" className={buttonClass} data-ui={kind} onClick={() => audioRef.current?.ui[kind]()}>
              ui.{kind}
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => audioRef.current?.ui.toggle(true)}>
            ui.toggle(on)
          </button>
          <button type="button" className={buttonClass} onClick={() => audioRef.current?.ui.toggle(false)}>
            ui.toggle(off)
          </button>
          <button type="button" className={buttonClass} onClick={() => audioRef.current?.ui.zoom(1)}>
            ui.zoom(+1)
          </button>
          <button type="button" className={buttonClass} onClick={() => audioRef.current?.ui.zoom(-1)}>
            ui.zoom(−1)
          </button>
        </div>
      </section>

      <section className="panel-surface flex flex-col gap-2 rounded-xl p-3 text-xs text-mist">
        <h2 className="text-sm font-semibold text-white">Music (optional, ships OFF)</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Flag
            label={settings.musicEnabled ? "music enabled" : "music disabled"}
            on={settings.musicEnabled}
            onToggle={() => audioSettings.setMusicEnabled(!settings.musicEnabled)}
          />
          <button type="button" className={buttonClass} disabled={busy} onClick={renderMusic}>
            Render 60 s offline ({state.phase}, stress {state.stress})
          </button>
          <span className="text-mist/50">follows the phase and stress controls above; plays only while setup is complete</span>
        </div>
        {music ? (
          <>
            <div className="font-mono text-[0.65rem] text-mist/80">
              {(() => {
                const summary = summarizeMusic(music);
                return `rms ${fmt(summary.rmsDb)} dBFS · peak ${fmt(summary.peakDb)} · pump ${fmt(summary.pumpDb)} dB · periodicity ${fmt(summary.periodicity, 2)} · centroid ${summary.centroidHz} Hz`;
              })()}
            </div>
            <Plots mono={music.mono} sampleRate={music.sampleRate} centroidHz={music.metrics.centroidHz} large />
          </>
        ) : null}
      </section>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Stinger + world pairs
// ─────────────────────────────────────────────────────────────────────────────

const PairRow = ({ result }: { result: PairResult }) => {
  const summary = summarizePair(result);
  return (
    <div className="panel-surface flex flex-col gap-1.5 rounded-xl p-2.5 text-xs text-mist" data-pair={result.spec.label}>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-white">{result.spec.label}</span>
        <span className="ml-auto">
          <span className={chip(summary.pass)}>{summary.pass ? "PASS" : "FAIL"}</span>
        </span>
      </div>
      <div className="font-mono text-[0.65rem] leading-relaxed text-mist/80">
        mix peak {fmt(summary.mixPeakDb)} dBFS (max {PAIR_LIMITS.mixPeakMaxDb}) · stinger {fmt(summary.stingerPeakDb)} · world {fmt(summary.worldPeakDb)},{" "}
        {summary.worldUnderStingerDb <= -150
          ? "silent while the stinger speaks"
          : `under the stinger ${fmt(summary.worldUnderStingerDb)} (lead ${fmt(summary.stingerLeadDb)} dB ≥ ${PAIR_LIMITS.stingerLeadDb})`}{" "}
        · {summary.loudnessRule ? `loudness lead ${fmt(summary.loudnessLeadLu)} LU (≥ ${PAIR_LIMITS.loudnessLeadLu}) · ` : ""}
        {fmt(summary.durationS, 2)} s
      </div>
      <div className="font-mono text-[0.6rem] text-mist/50">
        store: {summary.stingers.join(", ")} · world: {summary.world.join(", ")}
      </div>
      {summary.violations.length > 0 ? <div className="text-[0.65rem] text-red-400">{summary.violations.join("; ")}</div> : null}
      <Plots mono={result.mono} sampleRate={result.sampleRate} durationS={result.report.mix.durationS} centroidHz={result.report.mix.centroidHz} viewS={pairWindow(result.spec)} large={false} />
    </div>
  );
};

const PairsPanel = ({ auto }: { auto: boolean }) => {
  const [results, setResults] = useState<PairResult[]>([]);
  // `?only=pairs` renders them on load (the headless harness screenshots this view).
  const [busy, setBusy] = useState(auto);
  const [started, setStarted] = useState(auto);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const run = async () => {
      for (const spec of PAIRS) {
        if (cancelled) return;
        const result = await measurePair(spec);
        if (cancelled) return;
        setResults((prev) => [...prev, result]);
      }
    };
    run()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [started]);

  const start = () => {
    if (started) return;
    setBusy(true);
    setStarted(true);
  };

  const failing = results.filter((result) => summarizePair(result).violations.length > 0).length;
  return (
    <section className="flex flex-col gap-2" data-pairs-done={results.length === PAIRS.length ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-mist">
        <h2 className="mr-2 text-sm font-semibold text-white">Store stinger + world layer, rendered together</h2>
        <button type="button" className={buttonClass} disabled={busy || started} onClick={start}>
          Render {PAIRS.length} pairs offline
        </button>
        <span className="text-mist/50">
          {started ? `${results.length}/${PAIRS.length}` : ""}
          {results.length > 0 ? (failing === 0 ? " · all pass" : ` · ${failing} failing`) : ""}
        </span>
      </div>
      {results.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {results.map((result) => (
            <PairRow key={result.spec.label} result={result} />
          ))}
        </div>
      ) : null}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const Status = () => {
  const [status, setStatus] = useState({ state: "idle", voices: 0, error: "" });
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = getAudioEngine();
      const error = engine.error;
      setStatus({ state: engine.state, voices: engine.voiceCount(), error: error === null ? "" : error instanceof Error ? error.message : String(error) });
    }, 400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-[0.65rem] text-mist/70">
      engine {status.state} · {status.voices} voices{status.error ? ` · last error: ${status.error}` : ""}
      {status.state === "idle" ? " · click anything to unlock audio" : ""}
    </span>
  );
};

const AudioLab = () => {
  const version = useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const [query] = useState(readQuery);
  const [bus, setBus] = useState<BusName | "all">(query.bus);

  useEffect(() => installLabApi(createLabApi(session)), []);

  const names = useMemo(() => {
    let list: SoundName[] = query.focus ?? SOUND_NAMES.filter((name) => bus === "all" || SOUNDS[name].bus === bus);
    if (query.page !== null) list = list.slice(query.page * query.per, (query.page + 1) * query.per);
    return list;
  }, [bus, query]);

  // Measure what is on screen first; with a page or a focus list that is all that is measured.
  useEffect(() => {
    if (query.auto) void session.measure(names);
  }, [names, query.auto]);

  const large = query.focus !== null || query.page !== null;
  const measured = session.sounds.size + session.errors.size;
  const failing = SOUND_NAMES.filter((name) => session.errors.has(name) || (session.sounds.get(name)?.violations.length ?? 0) > 0);
  const showPanels = query.only === null || query.only === "panels";
  const showSounds = query.only === null || query.only === "sounds";
  const showPairs = query.only === null || query.only === "pairs";

  return (
    <div className="min-h-screen px-3 py-4 text-slate-100 md:px-6" data-lab-version={version}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
        <header className="panel-surface flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-xs text-mist">
          <span className="text-sm font-semibold text-white">Audio lab</span>
          <span className="text-mist/60">StartUpWorld</span>
          <span className="text-mist/60">|</span>
          <span>
            {measured}/{SOUND_NAMES.length} measured
          </span>
          <span className={chip(failing.length === 0)}>{failing.length === 0 ? (session.done ? "ALL PASS" : "no failures yet") : `${failing.length} failing`}</span>
          <Status />
          <div className="ml-auto">
            <SoundMenu />
          </div>
        </header>

        {failing.length > 0 ? (
          <div className="panel-surface rounded-xl px-4 py-2 text-xs text-red-400">Failing: {failing.join(", ")}</div>
        ) : null}

        {showPanels ? (
          <>
            <Mixer />
            <WorldPanel />
          </>
        ) : null}

        {showPairs ? <PairsPanel auto={query.only === "pairs"} /> : null}

        {showSounds ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <h2 className="mr-2 text-sm font-semibold text-white">Sounds</h2>
              {(["all", ...BUS_NAMES] as const).map((option) => (
                <button key={option} type="button" className={bus === option ? activeButtonClass : buttonClass} onClick={() => setBus(option)}>
                  {option}
                </button>
              ))}
              <span className="ml-2 text-mist/50">
                waveform: peak-normalised, amber = 5 ms RMS in dB (top 0, bottom −84, dashed −60) · green = falls below −60 dBFS · red = limit
              </span>
            </div>
            <div className={large ? "grid gap-2 md:grid-cols-2" : "grid gap-2 md:grid-cols-2 xl:grid-cols-3"}>
              {names.map((name) => (
                <SoundCard key={name} name={name} result={session.sounds.get(name)} error={session.errors.get(name)} large={large} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export default AudioLab;
