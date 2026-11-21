/**
 * The acceptance numbers from the sound brief, as code. The lab runs every sound through
 * these and shows pass/fail; the same table is what the final report is generated from.
 */
import type { SoundDef, SoundKind, SoundName } from "../sounds";
import type { BedMetrics, Metrics } from "./labAnalysis";

export interface Limits {
  /** Allowed post-limiter peak window at default settings, dBFS. */
  peakMin: number;
  peakMax: number;
  /** Longest allowed time to fall below −60 dBFS; null = not constrained. */
  maxDur: number | null;
}

const KIND_LIMITS: Record<SoundKind, Omit<Limits, "maxDur">> = {
  ui: { peakMin: -30, peakMax: -18 },
  stinger: { peakMin: -20, peakMax: -9 },
  diegetic: { peakMin: -24, peakMax: -10 },
  // Ambience one-shots and music have no window in the brief beyond "quiet"; these keep them honest.
  ambient: { peakMin: -60, peakMax: -24 },
  music: { peakMin: -60, peakMax: -18 },
};

export const GLOBAL_LIMITS = {
  /** No sound may peak above this. */
  ceilingDb: -3,
  /** |DC offset|. */
  dc: 0.002,
  /** First / last sample magnitude (clicks). */
  edge: 0.002,
  centroidMinHz: 150,
  centroidMaxHz: 6000,
} as const;

export const AMBIENCE_LIMITS = {
  rmsMinDb: -46,
  rmsMaxDb: -32,
  /** No single one-shot more than this above the bed. */
  oneShotOverBedDb: 12,
  /** The bed's waveform may not come round again: max autocorrelation at lags of 2–25 s. */
  loopCorrelation: 0.1,
} as const;

export const limitsFor = (def: SoundDef): Limits => ({
  ...KIND_LIMITS[def.kind],
  maxDur: def.kind === "ambient" || def.kind === "music" ? null : def.maxDur,
});

/** Worst case of a sound over several random seeds. */
export interface SoundReport extends Metrics {
  /** Highest / lowest peak over the seeds. */
  peakMaxDb: number;
  peakMinDb: number;
  /** Longest duration over the seeds. */
  durationMaxS: number;
  /** Loudest / quietest momentary loudness over the seeds, LUFS. */
  loudnessMaxM: number;
  loudnessMinM: number;
  durationRelMaxS: number;
  centroidMinHz: number;
  centroidMaxHz: number;
  dcMax: number;
  startMax: number;
  endMax: number;
  finiteAll: boolean;
  truncatedAny: boolean;
  seeds: number;
}

export const worstCase = (runs: readonly Metrics[]): SoundReport => {
  const first = runs[0];
  return {
    ...first,
    peakMaxDb: Math.max(...runs.map((m) => m.peakDb)),
    peakMinDb: Math.min(...runs.map((m) => m.peakDb)),
    durationMaxS: Math.max(...runs.map((m) => m.durationS)),
    loudnessMaxM: Math.max(...runs.map((m) => m.loudnessM)),
    loudnessMinM: Math.min(...runs.map((m) => m.loudnessM)),
    durationRelMaxS: Math.max(...runs.map((m) => m.durationRelS)),
    centroidMinHz: Math.min(...runs.map((m) => m.centroidHz)),
    centroidMaxHz: Math.max(...runs.map((m) => m.centroidHz)),
    dcMax: Math.max(...runs.map((m) => m.dc)),
    startMax: Math.max(...runs.map((m) => m.startAbs)),
    endMax: Math.max(...runs.map((m) => m.endAbs)),
    finiteAll: runs.every((m) => m.finite),
    truncatedAny: runs.some((m) => m.truncated),
    seeds: runs.length,
  };
};

const f1 = (value: number): string => value.toFixed(1);

/**
 * Loudness windows (K-weighted momentary loudness, LUFS) for the families whose members must
 * sit together. Not in the brief; they keep the hierarchy honest where peak calibration cannot:
 * the regular result stingers sound equally loud, every game-over sting sounds like a bigger
 * moment than any of them, and none of the endings is the loudest thing in the game.
 */
const RESULT_STINGERS: readonly SoundName[] = ["success", "fail", "alert", "crisis", "opportunity", "cash-in", "warning"];
const GAME_OVER_STINGS: readonly SoundName[] = [
  "gameover-ipo",
  "gameover-acquisition",
  "gameover-bankruptcy",
  "gameover-founder-removal",
  "gameover-zombie-saas",
  "gameover-ai-hype-exit",
  "gameover-forced-acquisition",
];
/** The generic stingers for mechanics still being designed (`neutral`, a woodblock tok, is meant to be small). */
const MECHANICS_STINGERS: readonly SoundName[] = [
  "positive-small",
  "positive-big",
  "negative-small",
  "negative-big",
  "project-started",
  "project-progress",
  "release-flop",
  "release-ok",
  "release-hit",
  "level-up",
  "training-done",
  "resignation",
];
export const LOUDNESS_WINDOWS: Partial<Record<SoundName, readonly [number, number]>> = {
  ...Object.fromEntries(RESULT_STINGERS.map((name) => [name, [-31.5, -27] as const])),
  ...Object.fromEntries(MECHANICS_STINGERS.map((name) => [name, [-34, -24.5] as const])),
  ...Object.fromEntries(GAME_OVER_STINGS.map((name) => [name, [-27, -23] as const])),
};

/** Every way `report` breaks the brief; empty = pass. */
export const soundViolations = (def: SoundDef, report: SoundReport, name?: SoundName): string[] => {
  const out: string[] = [];
  const window = name === undefined ? undefined : LOUDNESS_WINDOWS[name];
  if (window) {
    if (report.loudnessMaxM > window[1]) out.push(`loudness ${f1(report.loudnessMaxM)} LUFS-M above its family's ${window[1]}`);
    if (report.loudnessMinM < window[0]) out.push(`loudness ${f1(report.loudnessMinM)} LUFS-M below its family's ${window[0]}`);
  }
  const limits = limitsFor(def);
  if (!report.finiteAll) out.push("NaN/Infinity in output");
  if (report.peakMaxDb > GLOBAL_LIMITS.ceilingDb) out.push(`peak ${f1(report.peakMaxDb)} dBFS above ceiling ${GLOBAL_LIMITS.ceilingDb}`);
  if (report.peakMaxDb > limits.peakMax) out.push(`peak ${f1(report.peakMaxDb)} dBFS above ${limits.peakMax}`);
  if (report.peakMinDb < limits.peakMin) out.push(`peak ${f1(report.peakMinDb)} dBFS below ${limits.peakMin}`);
  if (limits.maxDur !== null && report.durationMaxS >= limits.maxDur) {
    out.push(`duration ${report.durationMaxS.toFixed(3)} s not under ${limits.maxDur} s`);
  }
  if (report.truncatedAny) out.push("still sounding at the end of the render window");
  if (report.dcMax >= GLOBAL_LIMITS.dc) out.push(`DC offset ${report.dcMax.toFixed(4)}`);
  if (report.startMax >= GLOBAL_LIMITS.edge) out.push(`click at start (${report.startMax.toFixed(4)})`);
  if (report.endMax >= GLOBAL_LIMITS.edge) out.push(`click at end (${report.endMax.toFixed(4)})`);
  if (report.centroidMinHz < GLOBAL_LIMITS.centroidMinHz) out.push(`centroid ${Math.round(report.centroidMinHz)} Hz is boomy (< ${GLOBAL_LIMITS.centroidMinHz})`);
  if (report.centroidMaxHz > GLOBAL_LIMITS.centroidMaxHz) out.push(`centroid ${Math.round(report.centroidMaxHz)} Hz is shrill (> ${GLOBAL_LIMITS.centroidMaxHz})`);
  return out;
};

/** Linear gain that would move the loudest seed onto the sound's designed level. */
export const suggestedGain = (def: SoundDef, report: SoundReport): number => def.gain * 10 ** ((def.level - report.peakMaxDb) / 20);

export interface AmbienceReport extends Metrics, BedMetrics {
  /** RMS of the continuous layers alone, dBFS. */
  bedOnlyRmsDb: number;
  /** Ungated integrated loudness of the whole bed, LUFS. */
  loudnessI: number;
  /** Level-normalised 1/3-octave colour of the whole bed (THIRD_OCTAVES), dB. */
  colourDb: number[];
  /** Waveform autocorrelation of the continuous layers alone (1–2.5 kHz, lags 2–25 s), and where. */
  loopCorrelation: number;
  loopLagS: number;
  /** Highest peak of the one-shot layer alone, dBFS (−160 if there were none). */
  oneShotPeakDb: number;
  /** oneShotPeakDb − rmsDb. */
  oneShotOverBedDb: number;
  /** One-shots scheduled during the render. */
  oneShots: number;
}

/**
 * A store stinger and the world layer of the same moment, rendered together through one
 * limiter. Not in the brief as numbers; these make "never a second stinger" measurable:
 * the pair must stay well clear of the ceiling, and while the stinger is speaking the world
 * layer must sit clearly under it.
 */
export const PAIR_LIMITS = {
  /** The two layers together, dBFS (the limiter starts at −8). */
  mixPeakMaxDb: -6,
  /** Inside the stinger's loud part, the world layer peaks at least this far below the stinger. */
  stingerLeadDb: 3,
  /** The stinger's "loud part" ends when it last comes within this many dB of its own peak. */
  stingerWindowDb: 20,
  /**
   * Over the whole moment, the loudest 400 ms of the world layer that supports the stinger is
   * at least this far below the stinger's (K-weighted momentary loudness, same seed). Peaks
   * alone hide a crowd, a trill or a held tone that carries far more loudness per dB of peak
   * than a pluck. Not asked of the week's own sunrise (its `tick` is a click, not a stinger).
   */
  loudnessLeadLu: 3.5,
} as const;

/** Worst case of one pair over several seeds. */
export interface PairReport {
  /** The mix: both layers through one engine. */
  mix: Metrics;
  /** Peak of the stinger(s) alone, dBFS (lowest over the seeds — the hardest case for the lead). */
  stingerPeakDb: number;
  /** Peak of the world layer alone, dBFS (highest over the seeds). */
  worldPeakDb: number;
  /** Peak of the world layer alone inside the stinger's loud part, dBFS (highest over the seeds). */
  worldUnderStingerDb: number;
  /** Length of the stinger's loud part, seconds (from the first stinger). */
  stingerWindowS: number;
  /** Momentary loudness of the stinger(s) alone and of the supporting world layer alone (loudest seed of each), LUFS. */
  stingerLoudnessM: number;
  worldLoudnessM: number;
  /** stinger − supporting world layer, same seed; the smallest over the seeds, LU. */
  loudnessLeadLu: number;
  /**
   * Whether a loudness lead is asked of this pair: it has a real stinger (not just the week's
   * tick) and world cues from an event that stinger answers (worldAudio's SUPPORTING_EVENTS).
   */
  loudnessRule: boolean;
  seeds: number;
}

export const pairViolations = (report: PairReport): string[] => {
  const out: string[] = [];
  const mix = report.mix;
  if (!mix.finite) out.push("NaN/Infinity in output");
  if (mix.peakDb > GLOBAL_LIMITS.ceilingDb) out.push(`mix peak ${f1(mix.peakDb)} dBFS above ceiling ${GLOBAL_LIMITS.ceilingDb}`);
  if (mix.peakDb > PAIR_LIMITS.mixPeakMaxDb) out.push(`mix peak ${f1(mix.peakDb)} dBFS above ${PAIR_LIMITS.mixPeakMaxDb}`);
  const lead = report.stingerPeakDb - report.worldUnderStingerDb;
  if (lead < PAIR_LIMITS.stingerLeadDb) out.push(`world layer only ${f1(lead)} dB under the stinger while it plays (< ${PAIR_LIMITS.stingerLeadDb})`);
  if (report.loudnessRule && report.loudnessLeadLu < PAIR_LIMITS.loudnessLeadLu) {
    out.push(`world layer only ${f1(report.loudnessLeadLu)} LU under the stinger in loudness (< ${PAIR_LIMITS.loudnessLeadLu})`);
  }
  if (mix.dc >= GLOBAL_LIMITS.dc) out.push(`DC offset ${mix.dc.toFixed(4)}`);
  if (mix.startAbs >= GLOBAL_LIMITS.edge) out.push(`click at start (${mix.startAbs.toFixed(4)})`);
  if (mix.endAbs >= GLOBAL_LIMITS.edge) out.push(`click at end (${mix.endAbs.toFixed(4)})`);
  if (mix.truncated) out.push("still sounding at the end of the render window");
  return out;
};

export const ambienceViolations =(report: AmbienceReport, expectAudible: boolean): string[] => {
  const out: string[] = [];
  if (!report.finite) out.push("NaN/Infinity in output");
  if (report.peakDb > GLOBAL_LIMITS.ceilingDb) out.push(`peak ${f1(report.peakDb)} dBFS above ceiling`);
  if (report.dc >= GLOBAL_LIMITS.dc) out.push(`DC offset ${report.dc.toFixed(4)}`);
  if (expectAudible) {
    if (report.rmsDb < AMBIENCE_LIMITS.rmsMinDb) out.push(`bed RMS ${f1(report.rmsDb)} dBFS below ${AMBIENCE_LIMITS.rmsMinDb}`);
    if (report.rmsDb > AMBIENCE_LIMITS.rmsMaxDb) out.push(`bed RMS ${f1(report.rmsDb)} dBFS above ${AMBIENCE_LIMITS.rmsMaxDb}`);
    if (report.oneShotOverBedDb > AMBIENCE_LIMITS.oneShotOverBedDb) {
      out.push(`a one-shot peaks ${f1(report.oneShotOverBedDb)} dB above the bed (> ${AMBIENCE_LIMITS.oneShotOverBedDb})`);
    }
    if (report.centroidHz < GLOBAL_LIMITS.centroidMinHz) out.push(`centroid ${Math.round(report.centroidHz)} Hz is boomy`);
    if (report.centroidHz > GLOBAL_LIMITS.centroidMaxHz) out.push(`centroid ${Math.round(report.centroidHz)} Hz is shrill`);
    if (report.pumpDb > 6) out.push(`bed pumps ${f1(report.pumpDb)} dB between 1 s windows`);
    if (report.periodicity > 0.5) out.push(`bed repeats every ${report.periodicityLagS.toFixed(2)} s (r = ${report.periodicity.toFixed(2)})`);
    if (report.loopCorrelation > AMBIENCE_LIMITS.loopCorrelation) {
      out.push(`bed waveform loops every ${report.loopLagS.toFixed(3)} s (r = ${report.loopCorrelation.toFixed(2)} > ${AMBIENCE_LIMITS.loopCorrelation})`);
    }
  } else if (report.rmsDb > -50) {
    out.push(`should be almost silent but is ${f1(report.rmsDb)} dBFS`);
  }
  return out;
};
