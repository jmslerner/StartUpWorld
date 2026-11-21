/**
 * The lab's measuring session (renders every sound once, caches the results, notifies the
 * page as they arrive) and the `window.__audioLab` API the headless harness drives.
 *
 *   await __audioLab.metrics()                      // { [sound]: SoundSummary }
 *   await __audioLab.failures()                     // { [sound]: string[] } — only what breaks the brief
 *   await __audioLab.gains()                        // suggested calibration trims
 *   await __audioLab.renderAmbience(state, 30)      // bed metrics for one state
 *   __audioLab.ambienceStates()                     // the labelled states of the matrix (render them one by one)
 *   await __audioLab.ambienceMatrix(30)             // 5 phases × small/medium/large teams, each phase at dusk,
 *                                                   //   the extremes, and the states that must be almost silent
 *   __audioLab.pairLabels()                         // the store-stinger + world-layer pairs
 *   await __audioLab.pairs(labels?)                 // { [pair]: PairSummary } — both layers through one limiter
 *   await __audioLab.renderMusic({ phase }, 60)
 *   await __audioLab.limiter()                      // measured limiter curve
 *   __audioLab.live()                               // live engine state
 */
import type { CompanyPhase } from "../../types/game";
import type { AmbienceState } from "../ambience";
import { AudioEngine, getAudioEngine, setSharedAudioEngine } from "../engine";
import type { MusicMood } from "../music";
import type { BusName } from "../settings";
import { SOUND_NAMES, SOUNDS, isSoundName, type SoundKind, type SoundName } from "../sounds";
import { planCues } from "../worldAudio";
import { toDb, type BedMetrics, type Metrics } from "./labAnalysis";
import { ambienceViolations, limitsFor, type AmbienceReport } from "./labChecks";
import { PAIRS } from "./labPairs";
import {
  measureAmbience,
  measureMusic,
  measurePair,
  measureSound,
  probeLimiter,
  type AmbienceResult,
  type LimiterProbe,
  type MusicResult,
  type PairResult,
  type SoundResult,
} from "./labRender";

const round = (value: number, digits = 2): number => {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
};

export interface SoundSummary {
  bus: BusName;
  kind: SoundKind;
  pass: boolean;
  violations: string[];
  /** Designed peak and the calibration trim that gets there. */
  level: number;
  gain: number;
  suggestedGain: number;
  /** Loudest / quietest peak over the seeds, dBFS. */
  peakDb: number;
  peakMinDb: number;
  rmsDb: number;
  /** Longest time to fall below −60 dBFS over the seeds, and the limit it is held to. */
  durationS: number;
  maxDurS: number | null;
  /** Longest time to fall 60 dB below its own peak. */
  durationRelS: number;
  centroidHz: number;
  centroidMinHz: number;
  centroidMaxHz: number;
  /** Loudest / quietest K-weighted momentary loudness over the seeds, LUFS. */
  loudnessM: number;
  loudnessMinM: number;
  dc: number;
  startAbs: number;
  endAbs: number;
  finite: boolean;
  seeds: number;
}

export const summarize = (result: SoundResult): SoundSummary => {
  const def = SOUNDS[result.name];
  const r = result.report;
  return {
    bus: def.bus,
    kind: def.kind,
    pass: result.violations.length === 0,
    violations: result.violations,
    level: def.level,
    gain: def.gain,
    suggestedGain: Number(result.suggestedGain.toPrecision(3)),
    peakDb: round(r.peakMaxDb),
    peakMinDb: round(r.peakMinDb),
    rmsDb: round(r.rmsDb),
    durationS: round(r.durationMaxS, 3),
    maxDurS: limitsFor(def).maxDur,
    durationRelS: round(r.durationRelMaxS, 3),
    centroidHz: Math.round(r.centroidHz),
    centroidMinHz: Math.round(r.centroidMinHz),
    centroidMaxHz: Math.round(r.centroidMaxHz),
    loudnessM: round(r.loudnessMaxM),
    loudnessMinM: round(r.loudnessMinM),
    dc: round(r.dcMax, 5),
    startAbs: round(r.startMax, 5),
    endAbs: round(r.endMax, 5),
    finite: r.finiteAll,
    seeds: r.seeds,
  };
};

export interface AmbienceSummary {
  pass: boolean;
  violations: string[];
  rmsDb: number;
  bedOnlyRmsDb: number;
  peakDb: number;
  windowMinDb: number;
  windowMaxDb: number;
  pumpDb: number;
  spikeDb: number;
  oneShotPeakDb: number;
  oneShotOverBedDb: number;
  oneShots: number;
  periodicity: number;
  periodicityLagS: number;
  /** Ungated integrated loudness, LUFS. */
  loudnessI: number;
  /** Level-normalised 1/3-octave colour, 100 Hz – 8 kHz, dB (compare phases with colourDistance). */
  colourDb: number[];
  /** Waveform autocorrelation of the bed alone at lags 2–25 s (a loop reads near 1). */
  loopCorrelation: number;
  loopLagS: number;
  centroidHz: number;
  dc: number;
  finite: boolean;
  seconds: number;
}

const audible = (state: AmbienceState): boolean => state.worldVisible && state.setupComplete && !state.gameOver;

export const summarizeAmbience = (result: AmbienceResult): AmbienceSummary => {
  const r: AmbienceReport = result.report;
  const violations = ambienceViolations(r, audible(result.state));
  return {
    pass: violations.length === 0,
    violations,
    rmsDb: round(r.rmsDb),
    bedOnlyRmsDb: round(r.bedOnlyRmsDb),
    peakDb: round(r.peakDb),
    windowMinDb: round(r.windowMinDb),
    windowMaxDb: round(r.windowMaxDb),
    pumpDb: round(r.pumpDb),
    spikeDb: round(r.spikeDb),
    oneShotPeakDb: round(r.oneShotPeakDb),
    oneShotOverBedDb: round(r.oneShotOverBedDb),
    oneShots: r.oneShots,
    periodicity: round(r.periodicity, 3),
    periodicityLagS: round(r.periodicityLagS),
    loudnessI: round(r.loudnessI),
    colourDb: r.colourDb,
    loopCorrelation: round(r.loopCorrelation, 3),
    loopLagS: round(r.loopLagS, 3),
    centroidHz: Math.round(r.centroidHz),
    dc: round(r.dc, 5),
    finite: r.finite,
    seconds: round(r.seconds),
  };
};

export interface MusicSummary {
  rmsDb: number;
  peakDb: number;
  pumpDb: number;
  periodicity: number;
  periodicityLagS: number;
  centroidHz: number;
  dc: number;
  finite: boolean;
  seconds: number;
}

export const summarizeMusic = (result: MusicResult): MusicSummary => {
  const m: Metrics = result.metrics;
  const b: BedMetrics = result.bed;
  return {
    rmsDb: round(b.rmsDb),
    peakDb: round(m.peakDb),
    pumpDb: round(b.pumpDb),
    periodicity: round(b.periodicity, 3),
    periodicityLagS: round(b.periodicityLagS),
    centroidHz: Math.round(m.centroidHz),
    dc: round(m.dc, 5),
    finite: m.finite,
    seconds: round(m.seconds),
  };
};

export const PHASES: readonly CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];
export const TEAM_SIZES = { small: 3, medium: 14, large: 45 } as const;

/**
 * Every ambience state the acceptance pass renders, by label. Rows starting with "QUIET" are the
 * states the brief wants almost silent (before setup, after game over) or stopped (view hidden).
 */
export const AMBIENCE_MATRIX: ReadonlyArray<readonly [string, Partial<AmbienceState>]> = [
  ...PHASES.flatMap((phase) => Object.entries(TEAM_SIZES).map(([label, teamSize]) => [`${phase}/${label}`, { phase, teamSize }] as const)),
  ...PHASES.map((phase) => [`${phase}/medium dusk=1`, { phase, teamSize: TEAM_SIZES.medium, dusk: 1 }] as const),
  ["office/medium dusk=0.5", { phase: "office", teamSize: TEAM_SIZES.medium, dusk: 0.5 }],
  ["office/medium stress=100", { phase: "office", teamSize: TEAM_SIZES.medium, stress: 100 }],
  ["office/medium morale=5", { phase: "office", teamSize: TEAM_SIZES.medium, morale: 5 }],
  ["office/medium event+runway", { phase: "office", teamSize: TEAM_SIZES.medium, pendingEvent: true, runwayLow: true }],
  ["garage/0 dusk=1 morale=0 (quietest)", { phase: "garage", teamSize: 0, dusk: 1, morale: 0 }],
  ["unicorn/64 morale=100 stress=100 (loudest)", { phase: "unicorn", teamSize: 64, morale: 100, stress: 100, runwayLow: true }],
  ["QUIET setup incomplete", { setupComplete: false }],
  ["QUIET game over", { gameOver: true }],
  ["QUIET world hidden", { worldVisible: false }],
];

export interface PairSummary {
  pass: boolean;
  violations: string[];
  stingers: string[];
  world: string[];
  /** Both layers through one limiter, worst seed. */
  mixPeakDb: number;
  mixRmsDb: number;
  stingerPeakDb: number;
  worldPeakDb: number;
  /** World layer alone, inside the stinger's loud part. */
  worldUnderStingerDb: number;
  /** stingerPeakDb − worldUnderStingerDb. */
  stingerLeadDb: number;
  stingerWindowS: number;
  /** Momentary loudness of the stinger(s) and of the world layer, each alone, and the difference. */
  stingerLoudnessM: number;
  worldLoudnessM: number;
  loudnessLeadLu: number;
  /** Whether the loudness lead is asked of this pair (not when the only stinger is the tick). */
  loudnessRule: boolean;
  durationS: number;
  centroidHz: number;
  dc: number;
  startAbs: number;
  endAbs: number;
  finite: boolean;
  seeds: number;
}

export const summarizePair = (result: PairResult): PairSummary => {
  const r = result.report;
  return {
    pass: result.violations.length === 0,
    violations: result.violations,
    stingers: result.spec.stingers.map((s) => (s.delay > 0 ? `${s.sound}@${s.delay}s` : s.sound)),
    world: planCues(result.spec.events).map((c) => `${c.sound}@${round(c.delay)}s`),
    mixPeakDb: round(r.mix.peakDb),
    mixRmsDb: round(r.mix.rmsDb),
    stingerPeakDb: round(r.stingerPeakDb),
    worldPeakDb: round(r.worldPeakDb),
    worldUnderStingerDb: round(r.worldUnderStingerDb),
    stingerLeadDb: round(r.stingerPeakDb - r.worldUnderStingerDb),
    stingerWindowS: round(r.stingerWindowS, 3),
    stingerLoudnessM: round(r.stingerLoudnessM),
    worldLoudnessM: round(r.worldLoudnessM),
    loudnessLeadLu: round(r.loudnessLeadLu),
    loudnessRule: r.loudnessRule,
    durationS: round(r.mix.durationS, 3),
    centroidHz: Math.round(r.mix.centroidHz),
    dc: round(r.mix.dc, 5),
    startAbs: round(r.mix.startAbs, 5),
    endAbs: round(r.mix.endAbs, 5),
    finite: r.mix.finite,
    seeds: r.seeds,
  };
};

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class LabSession {
  readonly sounds = new Map<SoundName, SoundResult>();
  readonly errors = new Map<SoundName, string>();
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  get done(): boolean {
    return this.sounds.size + this.errors.size >= SOUND_NAMES.length;
  }

  /** Measure these sounds (those not measured yet), one at a time, after anything already queued. */
  measure(names: readonly SoundName[]): Promise<void> {
    this.queue = this.queue.then(() => this.measureMissing(names));
    return this.queue;
  }

  /** Measure every sound. */
  run(): Promise<void> {
    return this.measure(SOUND_NAMES);
  }

  private bump(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private async measureMissing(names: readonly SoundName[]): Promise<void> {
    for (const name of names) {
      if (this.sounds.has(name) || this.errors.has(name)) continue;
      try {
        this.sounds.set(name, await measureSound(name));
      } catch (error) {
        this.errors.set(name, error instanceof Error ? error.message : String(error));
      }
      this.bump();
      await pause();
    }
  }
}

export interface AudioLabApi {
  metrics(): Promise<Record<string, SoundSummary>>;
  failures(): Promise<Record<string, string[]>>;
  gains(): Promise<Record<string, number>>;
  renderAmbience(state?: Partial<AmbienceState>, seconds?: number): Promise<AmbienceSummary>;
  ambienceStates(): Record<string, Partial<AmbienceState>>;
  ambienceMatrix(seconds?: number): Promise<Record<string, AmbienceSummary>>;
  pairLabels(): string[];
  pairs(labels?: readonly string[]): Promise<Record<string, PairSummary>>;
  renderMusic(mood?: Partial<MusicMood>, seconds?: number): Promise<MusicSummary>;
  limiter(): Promise<LimiterProbe>;
  live(): { state: string; voices: number; error: string };
  /** Peak level (dBFS) at the live engine's output over the next `ms` milliseconds; null before unlock. */
  livePeak(ms?: number): Promise<number | null>;
  /** Peak and (approximate) RMS at the live engine's output over the next `ms` milliseconds. */
  liveLevel(ms?: number): Promise<{ peakDb: number; rmsDb: number; state: string; voices: number } | null>;
  /** Play a sound on the live engine (needs a prior user gesture, like everything live). */
  play(name: string): boolean;
  /** Resolves once everything queued so far has been measured and the page has had two frames to draw. */
  drawn(): Promise<void>;
}

type LabWindow = Window & { __audioLab?: AudioLabApi };

export const createLabApi = (session: LabSession): AudioLabApi => ({
  async metrics() {
    await session.run();
    const out: Record<string, SoundSummary> = {};
    for (const name of SOUND_NAMES) {
      const result = session.sounds.get(name);
      if (result) out[name] = summarize(result);
    }
    return out;
  },
  async failures() {
    await session.run();
    const out: Record<string, string[]> = {};
    for (const name of SOUND_NAMES) {
      const result = session.sounds.get(name);
      const error = session.errors.get(name);
      if (error) out[name] = [`render failed: ${error}`];
      else if (result && result.violations.length > 0) out[name] = result.violations;
    }
    return out;
  },
  async gains() {
    await session.run();
    const out: Record<string, number> = {};
    for (const name of SOUND_NAMES) {
      const result = session.sounds.get(name);
      if (!result) continue;
      if (Math.abs(result.report.peakMaxDb - SOUNDS[name].level) > 0.25) out[name] = Number(result.suggestedGain.toPrecision(3));
    }
    return out;
  },
  async renderAmbience(state = {}, seconds = 30) {
    return summarizeAmbience(await measureAmbience(state, seconds));
  },
  ambienceStates() {
    return Object.fromEntries(AMBIENCE_MATRIX.map(([label, state]) => [label, { ...state }]));
  },
  async ambienceMatrix(seconds = 30) {
    const out: Record<string, AmbienceSummary> = {};
    for (const [label, state] of AMBIENCE_MATRIX) {
      out[label] = summarizeAmbience(await measureAmbience(state, seconds));
      await pause();
    }
    return out;
  },
  pairLabels() {
    return PAIRS.map((spec) => spec.label);
  },
  async pairs(labels) {
    const out: Record<string, PairSummary> = {};
    for (const spec of PAIRS) {
      if (labels && !labels.includes(spec.label)) continue;
      out[spec.label] = summarizePair(await measurePair(spec));
      await pause();
    }
    return out;
  },
  async renderMusic(mood = {}, seconds = 60) {
    return summarizeMusic(await measureMusic(mood, seconds));
  },
  limiter: () => probeLimiter(),
  live() {
    const engine = getAudioEngine();
    const error = engine.error;
    return { state: engine.state, voices: engine.voiceCount(), error: error === null ? "" : error instanceof Error ? error.message : String(error) };
  },
  async livePeak(ms = 1000) {
    return (await this.liveLevel(ms))?.peakDb ?? null;
  },
  async liveLevel(ms = 1000) {
    const engine = getAudioEngine();
    const output = engine.output;
    const ctx = engine.context;
    if (!output || !ctx) return null;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    output.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    let sum = 0;
    let count = 0;
    const until = performance.now() + ms;
    while (performance.now() < until) {
      analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i += 1) {
        peak = Math.max(peak, Math.abs(data[i]));
        sum += data[i] * data[i];
      }
      count += data.length;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    output.disconnect(analyser);
    return { peakDb: round(toDb(peak)), rmsDb: round(toDb(Math.sqrt(sum / Math.max(1, count)))), state: engine.state, voices: engine.voiceCount() };
  },
  play(name) {
    return isSoundName(name) ? getAudioEngine().play(name) !== null : false;
  },
  async drawn() {
    await session.measure([]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  },
});

/**
 * `?sink=none`: run the live engine on an AudioContext with no output device. Headless Chrome
 * does not pump a muted real device, so its audio clock stands still; a null sink renders in
 * real time and silently, which lets the harness exercise the live path (unlock, scheduling,
 * voice clean-up, ambience) and read real levels from `livePeak()`.
 */
export const prepareLabEngine = (): void => {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("sink") !== "none") return;
  setSharedAudioEngine(
    new AudioEngine({
      env: {
        createContext: () => new AudioContext({ latencyHint: "interactive", sinkId: { type: "none" } } as AudioContextOptions),
      },
    }),
  );
};

export const installLabApi = (api: AudioLabApi): (() => void) => {
  const w = window as LabWindow;
  w.__audioLab = api;
  return () => {
    if (w.__audioLab === api) delete w.__audioLab;
  };
};
