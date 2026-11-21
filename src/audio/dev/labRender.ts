/**
 * Offline rendering for the audio lab: the SAME engine, recipes and directors as the live
 * game, pointed at an OfflineAudioContext, at default settings, through the whole mix chain
 * (bus fader → master → limiter). What comes out is what a player would hear, as numbers.
 */
import { AmbienceDirector, DEFAULT_AMBIENCE_STATE, type AmbienceState, type LayerName } from "../ambience";
import { AudioEngine, LIMITER, limiterMakeupGain } from "../engine";
import { DEFAULT_MUSIC_MOOD, MusicDirector, type MusicMood } from "../music";
import { createAudioSettingsStore, DEFAULT_AUDIO_SETTINGS, volumeToGain } from "../settings";
import { SOUNDS, type PlayOptions, type SoundName } from "../sounds";
import { hz, mulberry32 } from "../synth";
import { SUPPORTING_EVENTS, planCues } from "../worldAudio";
import { analyze, analyzeBed, loopCorrelation, loudness, mixToMono, thirdOctaveColour, toDb, type BedMetrics, type Metrics } from "./labAnalysis";
import { PAIR_LIMITS, pairViolations, soundViolations, suggestedGain, worstCase, type AmbienceReport, type PairReport, type SoundReport } from "./labChecks";
import type { PairSpec } from "./labPairs";

/** Sample rate of the offline renders (override with ?rate=48000 to check the other common rate). */
export const LAB_SAMPLE_RATE: number = (() => {
  if (typeof window === "undefined") return 44100;
  const asked = Number(new URLSearchParams(window.location.search).get("rate"));
  return asked >= 22050 && asked <= 96000 ? asked : 44100;
})();
/**
 * Every sound is rendered once per seed; the report is the worst case over them. Twelve seeds:
 * short noise transients read from a random offset vary by several dB from play to play, and
 * six seeds once let a 1-in-20 peak slip past calibration.
 */
export const LAB_SEEDS = [11, 23, 47, 89, 131, 197, 263, 331, 409, 487, 563, 641] as const;

/**
 * Sounds are triggered this long after the offline context starts and the lead-in is thrown
 * away: a DynamicsCompressorNode fades its gain in over its first ~0.15 s of life, which would
 * make everything that starts at time zero measure up to 13 dB too quiet. (In the live game
 * the limiter has been running long before any sound plays.)
 */
export const LAB_PREROLL = 0.3;

export interface Render {
  channels: [Float32Array, Float32Array];
  sampleRate: number;
}

const skip = (render: Render, seconds: number): Render => {
  const n = Math.round(seconds * render.sampleRate);
  return { channels: [render.channels[0].subarray(n), render.channels[1].subarray(n)], sampleRate: render.sampleRate };
};

const offlineContext = (seconds: number): OfflineAudioContext => {
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) throw new Error("OfflineAudioContext is not available in this browser");
  return new Ctor(2, Math.max(1, Math.ceil(seconds * LAB_SAMPLE_RATE)), LAB_SAMPLE_RATE);
};

const offlineEngine = (ctx: OfflineAudioContext, seed: number): AudioEngine =>
  new AudioEngine({ offlineContext: ctx, settings: createAudioSettingsStore(null), seed });

const finish = async (ctx: OfflineAudioContext): Promise<Render> => {
  const buffer = await ctx.startRendering();
  return { channels: [buffer.getChannelData(0), buffer.getChannelData(1)], sampleRate: buffer.sampleRate };
};

/** How long to render a sound for: its limit plus enough room to see it overrun. */
export const renderWindow = (name: SoundName): number => {
  const def = SOUNDS[name];
  switch (def.kind) {
    case "ui":
      return 0.6;
    case "stinger":
    case "diegetic":
      return def.maxDur + 0.9;
    case "ambient":
      return name === "amb-car" ? 5 : 3;
    case "music":
      return name === "music-pad" ? 13 : 4.5;
  }
};

/** Parameters the lab uses for sounds that take any. */
export const labOptions = (name: SoundName): PlayOptions => {
  switch (name) {
    case "music-pad":
      return { notes: [hz("D3"), hz("A3"), hz("F#4"), hz("E5")], dur: 10, intensity: 0.5 };
    case "music-pluck":
      return { notes: [hz("A4")], dur: 1.6 };
    case "footsteps":
      return { steps: 6 };
    case "raise-ok":
    case "confetti-pops":
    case "keyboard-flurry":
      return { intensity: 1 };
    default:
      return {};
  }
};

export const renderSound = async (name: SoundName, seed: number, options: PlayOptions = {}): Promise<Render> => {
  const ctx = offlineContext(renderWindow(name) + LAB_PREROLL);
  const engine = offlineEngine(ctx, seed);
  const handle = engine.play(name, { ...labOptions(name), ...options, at: LAB_PREROLL, seed });
  if (!handle) {
    const cause = engine.error;
    throw cause instanceof Error ? cause : new Error(`${name}: nothing was scheduled`);
  }
  const render = await finish(ctx);
  engine.dispose();
  return skip(render, LAB_PREROLL);
};

export interface SoundResult {
  name: SoundName;
  report: SoundReport;
  violations: string[];
  suggestedGain: number;
  /** Mono mix of the first seed, for drawing. */
  mono: Float32Array;
  sampleRate: number;
}

export const measureSound = async (name: SoundName): Promise<SoundResult> => {
  const runs: Metrics[] = [];
  let mono: Float32Array = new Float32Array(0);
  let sampleRate = LAB_SAMPLE_RATE;
  for (const seed of LAB_SEEDS) {
    const render = await renderSound(name, seed);
    runs.push(analyze(render.channels, render.sampleRate));
    if (seed === LAB_SEEDS[0]) {
      mono = mixToMono(render.channels);
      sampleRate = render.sampleRate;
    }
  }
  const report = worstCase(runs);
  const def = SOUNDS[name];
  return { name, report, violations: soundViolations(def, report, name), suggestedGain: suggestedGain(def, report), mono, sampleRate };
};

// ─────────────────────────────────────────────────────────────────────────────
// Ambience
// ─────────────────────────────────────────────────────────────────────────────

/** The lab's baseline: a small company, mid-morning, nothing wrong. */
export const LAB_AMBIENCE_STATE: AmbienceState = { ...DEFAULT_AMBIENCE_STATE, setupComplete: true, teamSize: 6 };

export const renderAmbienceOnce = async (
  state: AmbienceState,
  seconds: number,
  seed: number,
  only?: "bed" | "scatter",
  layers?: readonly LayerName[],
): Promise<Render & { oneShots: number }> => {
  const ctx = offlineContext(seconds);
  const engine = offlineEngine(ctx, seed);
  const director = new AmbienceDirector(engine, { rand: mulberry32(seed * 7919 + 13), only, layers });
  director.setState(state);
  director.renderOffline(seconds);
  const cause = engine.error;
  if (cause) throw cause instanceof Error ? cause : new Error("ambience: a recipe failed");
  const render = await finish(ctx);
  const oneShots = director.oneShotCount;
  director.dispose();
  engine.dispose();
  return { ...render, oneShots };
};

export interface AmbienceResult {
  state: AmbienceState;
  report: AmbienceReport;
  mono: Float32Array;
  sampleRate: number;
}

/**
 * Render the bed three ways from the same seed — everything, continuous layers only, one-shots
 * only — so the one-shots can be compared with the bed they sit in.
 */
export const measureAmbience = async (partial: Partial<AmbienceState> = {}, seconds = 30, seed = 7): Promise<AmbienceResult> => {
  const state: AmbienceState = { ...LAB_AMBIENCE_STATE, ...partial };
  const full = await renderAmbienceOnce(state, seconds, seed);
  const bedOnly = await renderAmbienceOnce(state, seconds, seed, "bed");
  const scatterOnly = await renderAmbienceOnce(state, seconds, seed, "scatter");

  const mono = mixToMono(full.channels);
  const metrics = analyze(full.channels, full.sampleRate);
  const bed: BedMetrics = analyzeBed(mono, full.sampleRate);
  const bedOnlyMono = mixToMono(bedOnly.channels);
  const bedOnlyRmsDb = analyzeBed(bedOnlyMono, bedOnly.sampleRate).rmsDb;
  // Skip the first second (the layers fading in) when looking for loops.
  const loop = loopCorrelation(bedOnlyMono.subarray(Math.round(bedOnly.sampleRate)), bedOnly.sampleRate);
  const skipped = Math.round(0.5 * full.sampleRate);
  const integrated = loudness(
    full.channels.map((c) => c.subarray(skipped)),
    full.sampleRate,
  ).integrated;
  const oneShotPeakDb = full.oneShots > 0 ? analyze(scatterOnly.channels, scatterOnly.sampleRate).peakDb : toDb(0);
  const report: AmbienceReport = {
    ...metrics,
    ...bed,
    // A bed never "ends": these two are meaningless for it.
    truncated: false,
    bedOnlyRmsDb,
    loudnessI: integrated,
    colourDb: thirdOctaveColour(mono.subarray(skipped), full.sampleRate),
    loopCorrelation: loop.correlation,
    loopLagS: loop.lagS,
    oneShotPeakDb,
    oneShotOverBedDb: oneShotPeakDb - bed.rmsDb,
    oneShots: full.oneShots,
  };
  return { state, report, mono, sampleRate: full.sampleRate };
};

// ─────────────────────────────────────────────────────────────────────────────
// Stinger + world pairs
// ─────────────────────────────────────────────────────────────────────────────

/** Seeds per pair (three renders each: both layers, stinger alone, world alone). */
export const PAIR_SEEDS = [11, 47, 131] as const;

/** Render long enough for the slowest cue or stinger of the pair to finish. */
export const pairWindow = (spec: PairSpec): number => {
  let end = 0;
  for (const c of planCues(spec.events)) end = Math.max(end, c.delay + SOUNDS[c.sound].maxDur);
  for (const s of spec.stingers) end = Math.max(end, s.delay + SOUNDS[s.sound].maxDur);
  return end + 0.4;
};

/**
 * One render of a pair. Every sound gets a seed from its position in the pair, so the
 * "both", "stinger" and "world" renders schedule exactly the same audio for each layer.
 */
export const renderPairOnce = async (spec: PairSpec, seed: number, layers: "both" | "stinger" | "world" | "support"): Promise<Render> => {
  const ctx = offlineContext(pairWindow(spec) + LAB_PREROLL);
  const engine = offlineEngine(ctx, seed);
  if (layers === "both" || layers === "stinger") {
    spec.stingers.forEach((s, i) => engine.play(s.sound, { at: LAB_PREROLL + s.delay, seed: seed * 101 + i }));
  }
  if (layers !== "stinger") {
    planCues(spec.events).forEach((c, i) => {
      // "support": only the cues of events the stinger answers (rule 5 in worldAudio.ts).
      if (layers === "support" && !(c.event && SUPPORTING_EVENTS.has(c.event))) return;
      engine.play(c.sound, { ...c.options, at: LAB_PREROLL + c.delay, seed: seed * 101 + 50 + i });
    });
  }
  const cause = engine.error;
  if (cause) throw cause instanceof Error ? cause : new Error(`${spec.label}: a recipe failed`);
  const render = await finish(ctx);
  engine.dispose();
  return skip(render, LAB_PREROLL);
};

/** Largest |sample| of both channels between two times, linear. */
const peakBetween = (render: Render, from: number, to: number): number => {
  const a = Math.max(0, Math.floor(from * render.sampleRate));
  const b = Math.min(render.channels[0].length, Math.ceil(to * render.sampleRate));
  let peak = 0;
  for (const data of render.channels) for (let i = a; i < b; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
};

/** Seconds at which the render last comes within `db` of its own peak. */
const lastWithin = (render: Render, db: number): number => {
  const total = peakBetween(render, 0, Number.POSITIVE_INFINITY);
  const floor = total * 10 ** (-db / 20);
  let last = 0;
  for (const data of render.channels) {
    for (let i = data.length - 1; i > last; i -= 1) {
      if (Math.abs(data[i]) >= floor) {
        last = i;
        break;
      }
    }
  }
  return last / render.sampleRate;
};

export interface PairResult {
  spec: PairSpec;
  report: PairReport;
  violations: string[];
  /** Mono mix of both layers (first seed), for drawing. */
  mono: Float32Array;
  sampleRate: number;
}

export const measurePair = async (spec: PairSpec): Promise<PairResult> => {
  const mixes: Metrics[] = [];
  let stingerPeakDb = Number.POSITIVE_INFINITY;
  let worldPeakDb = Number.NEGATIVE_INFINITY;
  let worldUnderStingerDb = Number.NEGATIVE_INFINITY;
  let stingerWindowS = 0;
  let stingerLoudnessM = Number.NEGATIVE_INFINITY;
  let worldLoudnessM = Number.NEGATIVE_INFINITY;
  let loudnessLeadLu = Number.POSITIVE_INFINITY;
  const cues = planCues(spec.events);
  const supporting = cues.filter((c) => c.event && SUPPORTING_EVENTS.has(c.event));
  const loudnessRule = spec.stingers.some((s) => s.sound !== "tick") && supporting.length > 0;
  let mono: Float32Array = new Float32Array(0);
  let sampleRate = LAB_SAMPLE_RATE;
  const first = Math.min(...spec.stingers.map((s) => s.delay));
  for (const seed of PAIR_SEEDS) {
    const both = await renderPairOnce(spec, seed, "both");
    const stinger = await renderPairOnce(spec, seed, "stinger");
    const world = await renderPairOnce(spec, seed, "world");
    mixes.push(analyze(both.channels, both.sampleRate));
    const window = lastWithin(stinger, PAIR_LIMITS.stingerWindowDb);
    stingerWindowS = Math.max(stingerWindowS, window - first);
    stingerPeakDb = Math.min(stingerPeakDb, toDb(peakBetween(stinger, 0, Number.POSITIVE_INFINITY)));
    worldPeakDb = Math.max(worldPeakDb, toDb(peakBetween(world, 0, Number.POSITIVE_INFINITY)));
    worldUnderStingerDb = Math.max(worldUnderStingerDb, toDb(peakBetween(world, first, window)));
    if (loudnessRule) {
      const support = supporting.length === cues.length ? world : await renderPairOnce(spec, seed, "support");
      const stingerL = loudness(stinger.channels, stinger.sampleRate).momentaryMax;
      const worldL = loudness(support.channels, support.sampleRate).momentaryMax;
      stingerLoudnessM = Math.max(stingerLoudnessM, stingerL);
      worldLoudnessM = Math.max(worldLoudnessM, worldL);
      loudnessLeadLu = Math.min(loudnessLeadLu, stingerL - worldL);
    }
    if (seed === PAIR_SEEDS[0]) {
      mono = mixToMono(both.channels);
      sampleRate = both.sampleRate;
    }
  }
  const worst = worstCase(mixes);
  const mix: Metrics = {
    ...worst,
    peakDb: worst.peakMaxDb,
    durationS: worst.durationMaxS,
    dc: worst.dcMax,
    startAbs: worst.startMax,
    endAbs: worst.endMax,
    finite: worst.finiteAll,
    truncated: worst.truncatedAny,
  };
  const report: PairReport = {
    mix,
    stingerPeakDb,
    worldPeakDb,
    worldUnderStingerDb,
    stingerWindowS,
    stingerLoudnessM,
    worldLoudnessM,
    loudnessLeadLu: loudnessRule ? loudnessLeadLu : 0,
    loudnessRule,
    seeds: PAIR_SEEDS.length,
  };
  return { spec, report, violations: pairViolations(report), mono, sampleRate };
};

// ─────────────────────────────────────────────────────────────────────────────
// Music
// ─────────────────────────────────────────────────────────────────────────────

export interface MusicResult {
  mood: MusicMood;
  metrics: Metrics;
  bed: BedMetrics;
  mono: Float32Array;
  sampleRate: number;
}

export const measureMusic = async (partial: Partial<MusicMood> = {}, seconds = 60, seed = 5): Promise<MusicResult> => {
  const mood: MusicMood = { ...DEFAULT_MUSIC_MOOD, ...partial, active: true };
  const ctx = offlineContext(seconds);
  const engine = offlineEngine(ctx, seed);
  const director = new MusicDirector(engine, { rand: mulberry32(seed * 104729 + 3) });
  director.setMood(mood);
  director.renderOffline(seconds);
  const cause = engine.error;
  if (cause) throw cause instanceof Error ? cause : new Error("music: a recipe failed");
  const render = await finish(ctx);
  director.dispose();
  engine.dispose();
  const mono = mixToMono(render.channels);
  return { mood, metrics: analyze(render.channels, render.sampleRate), bed: analyzeBed(mono, render.sampleRate, 4), mono, sampleRate: render.sampleRate };
};

// ─────────────────────────────────────────────────────────────────────────────
// Limiter probe
// ─────────────────────────────────────────────────────────────────────────────

export interface LimiterPoint {
  /** Level of a 1 kHz sine arriving at the limiter, dBFS. */
  inDb: number;
  /** Steady-state level at the output, dBFS. */
  outDb: number;
}

export interface LimiterProbe {
  /** Makeup gain the engine assumes (and trims away), dB. */
  predictedMakeupDb: number;
  /** Small-signal gain actually measured through limiter + trim, dB (should be ≈ 0). */
  smallSignalGainDb: number;
  curve: LimiterPoint[];
}

/** Feed sines of rising level through the real master chain and read what comes out. */
export const probeLimiter = async (): Promise<LimiterProbe> => {
  const masterGain = volumeToGain(DEFAULT_AUDIO_SETTINGS.master);
  const levels = [-40, -30, -20, -14, -10, -8, -6, -4, -2, 0, 3, 6];
  const curve: LimiterPoint[] = [];
  for (const inDb of levels) {
    const ctx = offlineContext(1);
    const engine = offlineEngine(ctx, 1);
    const tap = engine.tap("ui");
    if (!tap) throw new Error("offline engine has no graph");
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const level = ctx.createGain();
    level.gain.value = 10 ** (inDb / 20) / masterGain;
    osc.connect(level);
    level.connect(tap.mix);
    osc.start(0);
    const render = await finish(ctx);
    engine.dispose();
    let peak = 0;
    const data = render.channels[0];
    for (let i = Math.floor(data.length * 0.6); i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    curve.push({ inDb, outDb: toDb(peak) });
  }
  return {
    predictedMakeupDb: toDb(limiterMakeupGain(LIMITER.threshold, LIMITER.knee, LIMITER.ratio)),
    smallSignalGainDb: curve[0].outDb - curve[0].inDb,
    curve,
  };
};
