/**
 * Optional generative background music. Ships OFF (`audioSettings.musicEnabled === false`).
 *
 * A quiet ambient bed: a slow, wandering chord cycle on a soft pad with sparse electric-piano
 * plucks. No drums, no pulse. It never loops: chords follow a weighted random walk, voicings
 * and lengths are drawn fresh each time and plucks are Poisson arrivals, so no stretch of it
 * repeats exactly (the planner is pure and unit-tested for that).
 *
 * It stays out of the stingers' way by construction: every pluck is a note of the game's
 * D-major pentatonic and every pad chord is diatonic to D major, in every phase — the stingers,
 * the heartbeat and the bells all live in D, so a pad in another key (G's C♮, A's G♯) would rub
 * against them. Phases differ in colour instead: the chord the cycle starts from and leans
 * toward (the Lydian lift of IV in the coworking space, the Mixolydian swagger of V on the
 * unicorn floor), tempo, register and how busy the plucks are.
 *   phase  → home chord, tempo, register, how busy the plucks are
 *   stress → leans on the minor chords of the key, closes the pad's filter, thins the plucks
 *
 * NOTE: tuned by measurement and by ear-free reasoning only — audition it before enabling it
 * for players. See the audio lab (/audio-lab) for a live toggle and an offline render.
 */
import type { CompanyPhase } from "../types/game";
import type { AudioEngine } from "./engine";
import { KEY_ROOT_MIDI, PENTATONIC, clamp, midiToHz, mulberry32 } from "./synth";

export interface MusicMood {
  phase: CompanyPhase;
  /** 0–100. */
  stress: number;
  /** False before setup and after game over: the music rests. */
  active: boolean;
}

export const DEFAULT_MUSIC_MOOD: MusicMood = { phase: "garage", stress: 20, active: false };

export type MusicEvent =
  | { type: "pad"; at: number; dur: number; notes: number[]; bright: number; chord: string }
  | { type: "pluck"; at: number; dur: number; freq: number; gain: number; pan: number; variant: number };

interface PhaseStyle {
  /** Semitones from D to this phase's key. Always 0: everything stays in D (see the header). */
  key: number;
  /** Index into CHORDS of the chord this phase starts from and leans back toward. */
  home: number;
  /** Seconds per chord. */
  chordLen: number;
  /** Plucks per second. */
  pluckRate: number;
  /** Pad filter openness, 0..1. */
  bright: number;
  /** Lowest MIDI note the plucks use. */
  pluckLow: number;
}

const STYLE: Record<CompanyPhase, PhaseStyle> = {
  garage: { key: 0, home: 0, chordLen: 10.5, pluckRate: 0.12, bright: 0.3, pluckLow: 62 },
  coworking: { key: 0, home: 1, chordLen: 9.5, pluckRate: 0.18, bright: 0.45, pluckLow: 64 },
  office: { key: 0, home: 0, chordLen: 9, pluckRate: 0.2, bright: 0.5, pluckLow: 66 },
  unicorn: { key: 0, home: 4, chordLen: 8, pluckRate: 0.28, bright: 0.65, pluckLow: 69 },
  public: { key: 0, home: 2, chordLen: 10, pluckRate: 0.16, bright: 0.55, pluckLow: 62 },
};

interface Chord {
  name: string;
  /** Root, semitones above the key's tonic. */
  root: number;
  /** Pitch classes above the key's tonic that belong to the chord. */
  tones: readonly number[];
  minor: boolean;
  /** Where the walk likes to go next: [index into CHORDS, weight]. */
  next: ReadonlyArray<readonly [number, number]>;
}

const CHORDS: readonly Chord[] = [
  { name: "Imaj9", root: 0, tones: [0, 4, 7, 11, 2], minor: false, next: [[1, 3], [2, 3], [3, 2], [4, 1], [5, 1]] },
  { name: "IVmaj9", root: 5, tones: [5, 9, 0, 4, 7], minor: false, next: [[0, 3], [4, 2], [3, 2], [2, 2]] },
  { name: "vi9", root: 9, tones: [9, 0, 4, 7, 11], minor: true, next: [[1, 3], [3, 2], [0, 2], [5, 1]] },
  { name: "ii9", root: 2, tones: [2, 5, 9, 0, 4], minor: true, next: [[4, 3], [1, 2], [2, 1], [0, 1]] },
  { name: "Vsus", root: 7, tones: [7, 0, 2, 4, 9], minor: false, next: [[0, 4], [2, 2], [1, 1]] },
  { name: "iii7", root: 4, tones: [4, 7, 11, 2], minor: true, next: [[2, 3], [1, 3]] },
];

/** Seconds a chord keeps ringing under the next one (the pad recipe's release time). */
const PAD_OVERLAP = 4.5;

const mod12 = (value: number): number => ((value % 12) + 12) % 12;

/** Lowest MIDI note at or above `floor` with the given pitch class. */
const atOrAbove = (pitchClass: number, floor: number): number => floor + mod12(pitchClass - floor);

/**
 * Pure event generator. Call `plan(from, to, mood)` with contiguous, increasing windows; it
 * returns the pad and pluck events that START inside each window.
 */
export class MusicPlanner {
  /** Chords and plucks draw from separate random streams, so neither disturbs the other. */
  private readonly chordRand: () => number;
  private readonly pluckRand: () => number;
  private rand: () => number;
  /** The chord that starts at `nextChordAt`… */
  private chord = 0;
  /** …and the one that started most recently (what the plucks play over). */
  private sounding = 0;
  private nextChordAt = 0;
  private nextPluckAt = 0;
  private started = false;

  constructor(rand: () => number = Math.random) {
    this.chordRand = mulberry32(Math.floor(rand() * 0xffffffff));
    this.pluckRand = mulberry32(Math.floor(rand() * 0xffffffff));
    this.rand = this.chordRand;
  }

  reset(): void {
    this.started = false;
    this.chord = 0;
  }

  plan(from: number, to: number, mood: MusicMood): MusicEvent[] {
    const events: MusicEvent[] = [];
    const style = STYLE[mood.phase];
    const stress = clamp(mood.stress, 0, 100) / 100;
    const tonic = KEY_ROOT_MIDI + style.key;
    const pluckRate = style.pluckRate * (1 - 0.4 * stress);
    if (!this.started) {
      this.started = true;
      this.chord = stress > 0.6 ? 2 : style.home;
      this.sounding = this.chord;
      this.nextChordAt = from + 0.05;
      this.rand = this.pluckRand;
      this.nextPluckAt = from + 2.5 + this.gap(style.pluckRate);
    }
    // A gap between windows (the clock stalled: an interrupted or suspended context) must not
    // come back as a pile-up of every chord and pluck that "should" have played meanwhile.
    if (this.nextChordAt < from - 1) this.nextChordAt = from;
    if (this.nextPluckAt < from - 1) this.nextPluckAt = from + 1 + this.gap(pluckRate);

    // Walk forward in time, taking whichever comes next, so a pluck always knows its chord.
    while (Math.min(this.nextChordAt, this.nextPluckAt) < to) {
      if (this.nextChordAt <= this.nextPluckAt) {
        this.rand = this.chordRand;
        const chord = CHORDS[this.chord];
        const len = style.chordLen * this.range(0.88, 1.12);
        events.push({
          type: "pad",
          at: this.nextChordAt,
          dur: len + PAD_OVERLAP, // the tail of each chord lies under the head of the next
          notes: this.voice(chord, tonic).map(midiToHz),
          bright: clamp(style.bright - 0.3 * stress + this.range(-0.05, 0.05), 0.05, 1),
          chord: chord.name,
        });
        this.nextChordAt += len;
        this.sounding = this.chord;
        this.chord = this.step(chord, stress, style.home);
      } else {
        this.rand = this.pluckRand;
        if (this.nextPluckAt >= from) this.phrase(events, this.nextPluckAt, tonic, style);
        this.nextPluckAt += Math.max(0.6, this.gap(pluckRate));
      }
    }
    return events.sort((a, b) => a.at - b.at);
  }

  private range(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  private gap(rate: number): number {
    return -Math.log(1 - this.rand() * 0.999999) / Math.max(0.01, rate);
  }

  /** Weighted random walk; stress leans toward the minor chords of the key, each phase toward its home chord. */
  private step(chord: Chord, stress: number, home: number): number {
    const weights = chord.next.map(([index, weight]) => {
      const target = CHORDS[index];
      const lean = (target.minor ? 1 + 1.5 * stress : 1 - 0.7 * stress) * (index === home ? 1.6 : 1);
      return [index, weight * Math.max(0.05, lean)] as const;
    });
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    let pick = this.rand() * total;
    for (const [index, weight] of weights) {
      pick -= weight;
      if (pick <= 0) return index;
    }
    return weights[weights.length - 1][0];
  }

  /** A bass note plus three upper voices drawn from the chord, spread between A3 and E5. */
  private voice(chord: Chord, tonic: number): number[] {
    const bass = atOrAbove(mod12(tonic + chord.root), 43);
    const pool = chord.tones.slice(1).map((tone) => mod12(tonic + tone));
    const chosen: number[] = [];
    let guard = 0;
    while (chosen.length < 3 && guard < 40) {
      guard += 1;
      const pitchClass = pool[Math.floor(this.rand() * pool.length)];
      const note = atOrAbove(pitchClass, 57 + Math.floor(this.rand() * 2) * 7);
      if (note > 77) continue;
      if (chosen.some((other) => Math.abs(other - note) < 2)) continue;
      chosen.push(note);
    }
    return [bass, ...chosen.sort((a, b) => a - b)];
  }

  /** One pluck, or now and then a little two- or three-note figure, always on the pentatonic. */
  private phrase(events: MusicEvent[], at: number, tonic: number, style: PhaseStyle): void {
    const chord = CHORDS[this.sounding];
    const chordClasses = new Set(chord.tones.map((tone) => mod12(tonic + tone)));
    const scale: number[] = [];
    for (let midi = style.pluckLow; midi <= style.pluckLow + 19; midi += 1) {
      if (PENTATONIC.includes(mod12(midi - KEY_ROOT_MIDI) as (typeof PENTATONIC)[number])) scale.push(midi);
    }
    const consonant = scale.filter((midi) => chordClasses.has(mod12(midi)));
    const pool = consonant.length >= 2 ? consonant : scale;
    let index = scale.indexOf(pool[Math.floor(this.rand() * pool.length)]);
    const count = this.rand() < 0.3 ? 2 + Math.floor(this.rand() * 2) : 1;
    const pan = this.range(-0.35, 0.35);
    let t = at;
    for (let i = 0; i < count; i += 1) {
      events.push({
        type: "pluck",
        at: t,
        dur: this.range(1.3, 2),
        freq: midiToHz(scale[index]),
        gain: this.range(0.6, 1) * (i === 0 ? 1 : 0.8),
        pan,
        variant: Math.floor(this.rand() * 2),
      });
      index = clamp(index + (this.rand() < 0.5 ? -1 : 1), 0, scale.length - 1);
      t += this.range(0.42, 0.78);
    }
  }
}

const TICK_MS = 500;
const LOOKAHEAD = 1.5;

export interface MusicDirectorOptions {
  rand?: () => number;
}

export class MusicDirector {
  private readonly engine: AudioEngine;
  private readonly planner: MusicPlanner;
  private mood: MusicMood = DEFAULT_MUSIC_MOOD;
  private timer: ReturnType<typeof setInterval> | null = null;
  private horizon = 0;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(engine: AudioEngine, options: MusicDirectorOptions = {}) {
    this.engine = engine;
    this.planner = new MusicPlanner(options.rand ?? Math.random);
    this.unsubscribe = engine.subscribe(this.sync);
  }

  setMood(mood: MusicMood): void {
    this.mood = mood;
    this.sync();
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Offline: schedule `seconds` of music from time zero (ignores the enabled flag). */
  renderOffline(seconds: number): void {
    if (this.disposed) return;
    this.planner.reset();
    this.perform(this.planner.plan(0, seconds, { ...this.mood, active: true }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stop(0.1);
  }

  private readonly sync = (): void => {
    if (this.disposed || this.engine.offline) return;
    const wanted = this.mood.active && this.engine.settings.get().musicEnabled && this.engine.isAudible("music");
    if (!wanted) {
      this.stop(1.2);
      return;
    }
    if (this.timer !== null) return;
    if (!this.engine.tap("music")) return; // not unlocked yet — the engine will call back
    this.planner.reset();
    this.horizon = 0;
    this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
  };

  private stop(fade: number): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.engine.stopAll("music", fade);
  }

  private readonly tick = (): void => {
    if (this.disposed || this.engine.state !== "running") return;
    const now = this.engine.now();
    const from = Math.max(this.horizon, now + 0.05);
    const to = now + LOOKAHEAD;
    if (to <= from) return;
    this.perform(this.planner.plan(from, to, this.mood));
    this.horizon = to;
  };

  private perform(events: readonly MusicEvent[]): void {
    for (const event of events) {
      if (event.type === "pad") {
        this.engine.play("music-pad", { at: event.at, notes: event.notes, dur: event.dur, intensity: event.bright });
      } else {
        this.engine.play("music-pluck", { at: event.at, notes: [event.freq], dur: event.dur, gain: event.gain, pan: event.pan, variant: event.variant });
      }
    }
  }
}
