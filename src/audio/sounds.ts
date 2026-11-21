/**
 * The sound library: every named sound in the game as a recipe.
 *
 * A recipe is a function `(synth, options) => void` that schedules nodes on whatever
 * context/bus the Synth was built for — so the SAME code plays live through the engine and
 * renders offline in the audio lab (src/audio/dev), where every sound is measured.
 *
 * Design rules followed throughout:
 *   • layer a transient + a body + a tail; filtered noise for anything you could touch;
 *   • every pitch comes from the game's key (D major — see `synth.ts`), so stingers that land
 *     together are consonant: bright family = D major pentatonic, dark family = relative minor
 *     plus F♮/C♮, attention hangs on A, resolution falls to D;
 *   • soft attacks (≥ 2 ms), exponential decays, a little stereo, a small reverb send;
 *   • short beats long, quiet beats loud.
 *
 * `gain` on each definition is a calibration trim measured in the lab so that the sound's
 * post-limiter peak at default settings lands on `level` (dBFS). Re-measure after editing.
 */
import type { BusName } from "./settings";
import { clamp, hz, pent, type NoteName, type Synth, type Tremolo } from "./synth";

export type SoundKind = "ui" | "stinger" | "diegetic" | "ambient" | "music";

export interface PlayOptions {
  /** Seconds from now. */
  delay?: number;
  /** Absolute context time (schedulers). Overrides `delay`. */
  at?: number;
  /** Extra linear gain on top of the calibrated level. */
  gain?: number;
  /** Stereo position of the whole sound, −1..1. */
  pan?: number;
  /** Where it has drifted to by the time it ends (footsteps, fly-bys). */
  panTo?: number;
  /** Pitch/timbre ratio on top of the random variation (1 = as written). */
  pitch?: number;
  /** 0..1 — how big or busy: coins in a raise, pops of confetti, keys in a flurry, pad brightness. */
  intensity?: number;
  /** Footsteps: how many (1–6). */
  steps?: number;
  /** Footsteps: −1 walking away (fades), +1 arriving (swells), 0 passing by. */
  approach?: number;
  /** Picks one of a sound's built-in alternatives (week chime interval, ping-pong side, …). */
  variant?: number;
  /** Music: frequencies in Hz. */
  notes?: readonly number[];
  /** Music: length in seconds. */
  dur?: number;
  /** Fixes the sound's random stream (lab renders, tests). */
  seed?: number;
}

export type Recipe = (s: Synth, o: PlayOptions) => void;

export interface SoundDef {
  readonly bus: BusName;
  readonly kind: SoundKind;
  /** Calibration trim (linear), see the file header. */
  readonly gain: number;
  /** Designed post-limiter peak at default settings, dBFS. */
  readonly level: number;
  /** Minimum seconds between two starts of this sound. */
  readonly minInterval: number;
  /** Random pitch/timbre spread per play, ± cents. */
  readonly cents: number;
  /** Random level spread per play, ± dB. */
  readonly db: number;
  /**
   * Seconds into the sound at which its first clearly pitched, motif-like element is heard.
   * `undefined` = purely tactile/noisy. Used by the "no double hits" rule in worldAudio.ts.
   */
  readonly tonalAt: number | undefined;
  /** The longest this sound may take to fall below −60 dBFS (checked in the lab). */
  readonly maxDur: number;
  readonly render: Recipe;
}

interface Meta {
  level?: number;
  minInterval?: number;
  cents?: number;
  db?: number;
  tonalAt?: number;
  maxDur?: number;
}

const family =
  (bus: BusName, kind: SoundKind, defaults: Required<Omit<Meta, "tonalAt">>) =>
  (gain: number, meta: Meta, render: Recipe): SoundDef => ({
    bus,
    kind,
    gain,
    level: meta.level ?? defaults.level,
    minInterval: meta.minInterval ?? defaults.minInterval,
    cents: meta.cents ?? defaults.cents,
    db: meta.db ?? defaults.db,
    tonalAt: meta.tonalAt,
    maxDur: meta.maxDur ?? defaults.maxDur,
    render,
  });

/** Interface feedback: dry, tiny, under 120 ms. */
const ui = family("ui", "ui", { level: -24, minInterval: 0.05, cents: 18, db: 1, maxDur: 0.12 });
/** Outcome stingers (the `SFX` facade + generic mechanics stingers): under 700 ms. */
const stinger = family("outcome", "stinger", { level: -14, minInterval: 0.08, cents: 12, db: 1, maxDur: 0.7 });
/** Game-over stings: the one place a stinger may take its time (under 1.6 s). */
const sting = family("outcome", "stinger", { level: -13, minInterval: 0.5, cents: 4, db: 0.5, maxDur: 1.6 });
/** Diegetic office events: under 2 s. */
const world = family("world", "diegetic", { level: -17, minInterval: 0.12, cents: 35, db: 1, maxDur: 2 });
/** One-shots sprinkled into the ambience bed by the AmbienceDirector: barely above the bed. */
const amb = family("ambience", "ambient", { level: -36, minInterval: 0.01, cents: 120, db: 3, maxDur: 5 });
/** Building blocks of the optional generative music. */
const mus = family("music", "music", { level: -30, minInterval: 0.05, cents: 0, db: 0.5, maxDur: 30 });

const N = hz;

// ─────────────────────────────────────────────────────────────────────────────
// Shared gestures
// ─────────────────────────────────────────────────────────────────────────────

interface Place {
  pan?: number;
  send?: number;
}

/** A short filtered-noise transient: the "touch" at the front of a sound. */
const tap = (s: Synth, t: number, gain: number, freq: number, o: Place & { dur?: number; q?: number } = {}): void => {
  s.noise({ t, dur: o.dur ?? 0.014, a: 0.003, gain, freq, q: o.q ?? 1.6, pan: o.pan, send: o.send });
};

/** A low body: a sine that drops in pitch plus a puff of dark noise. */
const thump = (s: Synth, t: number, gain: number, freq: number, o: Place & { dur?: number; body?: number } = {}): void => {
  const dur = o.dur ?? 0.11;
  s.tone({ t, freq, to: freq * 0.62, glide: dur * 0.7, dur, a: 0.004, gain, pan: o.pan, send: o.send });
  s.noise({ t, dur: dur * 0.55, a: 0.003, gain: gain * (o.body ?? 0.6), type: "lowpass", freq: freq * 3, color: "brown", pan: o.pan });
};

/** FM bell / chime / glint: bright at the strike, pure as it rings. */
const bell = (
  s: Synth,
  t: number,
  freq: number,
  gain: number,
  o: Place & { dur?: number; ratio?: number; index?: number } = {},
): void => {
  s.fm({ t, freq, ratio: o.ratio ?? 3.5, index: o.index ?? 1.6, indexTo: 0.02, dur: o.dur ?? 0.4, a: 0.003, gain, lp: 6500, pan: o.pan, send: o.send ?? 0.25 });
};

/**
 * The game's "voice": a kalimba-like pluck — a sine body, the fast-dying overtone of a tuned
 * bar two octaves up, and a woody tick.
 */
const pluck = (s: Synth, t: number, freq: number, gain: number, o: Place & { dur?: number; bright?: number } = {}): void => {
  const dur = o.dur ?? 0.24;
  const bright = o.bright ?? 0.35;
  s.tone({ t, freq, dur, a: 0.003, gain, pan: o.pan, send: o.send ?? 0.15 });
  s.tone({ t, freq: freq * (freq > 1300 ? 2 : 4), dur: Math.max(0.03, dur * 0.3), a: 0.002, gain: gain * bright * 0.45, pan: o.pan });
  tap(s, t, gain * bright * 0.6, clamp(freq * 2.6, 1500, 4200), { dur: 0.012, pan: o.pan });
};

/** The dark family's voice: a square (or saw) heard through a closing lowpass. */
const buzz = (
  s: Synth,
  t: number,
  freq: number,
  gain: number,
  o: Place & { to?: number; dur?: number; lp?: number; lpTo?: number; type?: OscillatorType } = {},
): void => {
  const dur = o.dur ?? 0.16;
  s.tone({
    t,
    freq,
    to: o.to,
    glide: dur * 0.8,
    type: o.type ?? "square",
    dur,
    a: 0.006,
    gain,
    lp: o.lp ?? 1500,
    lpTo: o.lpTo ?? 500,
    pan: o.pan,
    send: o.send ?? 0.1,
  });
};

/** Warm electric-piano note (integer-ratio FM) with a tiny tine on the front. */
const ep = (s: Synth, t: number, freq: number, gain: number, dur: number, pan = 0, o: { send?: number; am?: Tremolo } = {}): void => {
  s.fm({ t, freq, ratio: 1, index: 1.25, indexTo: 0.1, indexDur: Math.min(0.35, dur * 0.5), dur, a: 0.005, gain, pan, send: o.send ?? 0.3, am: o.am });
  s.tone({ t, freq: Math.min(5200, freq * 4), dur: 0.06, a: 0.002, gain: gain * 0.1, pan });
};

/** Brass-ish stab: two detuned saws whose lowpass blats open and settles. */
const brass = (s: Synth, t: number, freq: number, dur: number, gain: number, pan = 0): void => {
  for (const detune of [-6, 7]) {
    const el = s.tone({ t, freq, type: "sawtooth", detune, dur, a: 0.014, r: Math.min(0.3, dur * 0.45), gain: gain * 0.5, lp: 700, pan, send: 0.22 });
    if (el.filter) s.sweep(el.filter.frequency, t, [[0, 700], [0.035, 2500], [dur, 1100]]);
  }
};

/**
 * Stick–slip creak (hinges, chairs): a slow sawtooth whose pitch wanders, heard only through
 * two narrow resonances.
 */
const creak = (
  s: Synth,
  t: number,
  dur: number,
  gain: number,
  o: Place & { from?: number; to?: number; res?: number } = {},
): void => {
  const from = o.from ?? 95;
  const to = o.to ?? 130;
  const res = o.res ?? 760;
  const steps = Math.max(3, Math.round(dur / 0.045));
  const path: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = i / steps;
    path.push([k * dur, (from + (to - from) * k) * s.range(0.89, 1.11) * s.pitch]);
  }
  // A narrow band only hears one or two high harmonics of the saw, and harmonic n is n times
  // weaker than the fundamental: make that up so `gain` is roughly the creak's peak level.
  const mean = (from + to) / 2;
  for (const [centre, level] of [
    [res, 1],
    [res * 2.6, 0.4],
  ] as const) {
    const makeup = clamp(centre / mean, 1, 40) * 0.9;
    const el = s.tone({ t, freq: from, type: "sawtooth", dur, a: dur * 0.2, gain: gain * level * makeup, bp: centre, q: 7, pan: o.pan, send: o.send ?? 0.15 });
    if (el.osc) s.sweep(el.osc.frequency, t, path, "lin");
  }
};

/** Air moving: band-passed noise whose centre sweeps while it swells and fades. */
const whoosh = (
  s: Synth,
  t: number,
  dur: number,
  gain: number,
  o: Place & { from: number; to: number; peak?: number; q?: number; panTo?: number },
): void => {
  s.noise({ t, dur, a: dur * (o.peak ?? 0.45), gain, color: "pink", freq: o.from, to: o.to, q: o.q ?? 1.1, pan: o.pan, panTo: o.panTo, send: o.send });
};

/** One hand clap: two slightly flammed bursts. */
const clap = (s: Synth, t: number, gain: number, o: Place & { freq?: number } = {}): void => {
  const freq = o.freq ?? 1150;
  s.noise({ t, dur: 0.012, a: 0.002, gain: gain * 0.8, freq, q: 1.4, pan: o.pan });
  s.noise({ t: t + s.range(0.008, 0.013), dur: 0.07, a: 0.002, gain, freq: freq * 0.92, q: 1.1, pan: o.pan, send: o.send ?? 0.3 });
};

/** A coin: a short inharmonic ring (FM at an irrational ratio) with a bright tick. */
const coin = (s: Synth, t: number, gain: number, o: Place & { freq?: number; dur?: number } = {}): void => {
  const freq = o.freq ?? s.range(2200, 3600);
  const dur = o.dur ?? s.range(0.07, 0.12);
  s.fm({ t, freq, ratio: 1.47, index: 0.7, indexTo: 0.15, dur, a: 0.002, gain, lp: 6200, pan: o.pan, send: o.send ?? 0.12 });
  tap(s, t, gain * 0.35, 3600, { dur: 0.006, pan: o.pan });
};

/** A cricket: a few quick pulses of a high sine. */
const chirp = (s: Synth, t: number, gain: number, o: Place & { freq?: number; pulses?: number } = {}): void => {
  const freq = o.freq ?? 4200;
  const pulses = o.pulses ?? 3;
  for (let i = 0; i < pulses; i += 1) {
    s.tone({ t: t + i * 0.052, freq: freq * (1 + i * 0.004), dur: 0.036, a: 0.006, gain: gain * (i === 0 ? 0.7 : 1), pan: o.pan, send: o.send ?? 0.1 });
  }
};

/** One key of a keyboard: a click and the thock of it bottoming out. */
const key = (s: Synth, t: number, gain: number, o: Place & { space?: boolean } = {}): void => {
  const space = o.space ?? false;
  tap(s, t, gain, space ? s.range(1200, 1500) : s.range(2300, 3400), { dur: space ? 0.016 : 0.01, q: 2, pan: o.pan, send: o.send });
  s.tone({ t, freq: space ? s.range(170, 200) : s.range(250, 340), dur: space ? 0.03 : 0.02, a: 0.002, gain: gain * 0.5, pan: o.pan });
};

/**
 * The voice on the other end of a phone: a saw squeezed through a moving formant, telephone
 * band only. Not speech — the cartoon "wah wah" of someone you cannot quite hear.
 */
const squawk = (s: Synth, t: number, dur: number, gain: number, from: number, to: number, formFrom: number, formTo: number): void => {
  const shape = { t, dur, a: 0.014, r: dur * 0.35 };
  s.tone({ ...shape, freq: from, to, type: "sawtooth", gain, hp: 380, bp: formFrom, bpTo: formTo, q: 3.5, vib: { rate: 6.5, depth: 14 }, send: 0.12 });
  s.tone({ ...shape, freq: from, to, type: "square", gain: gain * 0.25, hp: 380, bp: formFrom * 2.3, bpTo: formTo * 2.1, q: 5 });
};

/** A small group of people making approving noise: three bands of fluttering noise. */
const crowd = (s: Synth, t: number, dur: number, gain: number): void => {
  s.noise({ t, dur, a: dur * 0.38, gain, freq: 720, q: 0.8, color: "pink", pan: -0.3, send: 0.3, am: { rate: s.range(4.5, 6), depth: 0.3 } });
  s.noise({ t, dur, a: dur * 0.45, gain: gain * 0.7, freq: 1750, q: 1.1, color: "pink", pan: 0.3, send: 0.3, am: { rate: s.range(6.5, 8.5), depth: 0.35 } });
  s.noise({ t: t + dur * 0.1, dur: dur * 0.8, a: dur * 0.4, gain: gain * 0.3, freq: 2900, q: 1.4, send: 0.2, am: { rate: s.range(9, 12), depth: 0.4 } });
};

/** A struck glass: a pure ring, one inharmonic partial, a tick. */
const glass = (s: Synth, t: number, freq: number, gain: number, dur: number, pan = 0): void => {
  s.tone({ t, freq, dur, a: 0.003, gain, pan, send: 0.35 });
  s.tone({ t, freq: freq * 2.76, dur: dur * 0.4, a: 0.003, gain: gain * 0.25, pan });
  tap(s, t, gain * 0.3, 4000, { dur: 0.006, pan });
};

const pour = (s: Synth, t: number, dur: number, gain: number): void => {
  // The resonance climbs as the cup fills.
  s.noise({ t, dur, a: 0.04, r: 0.12, gain, freq: 520, to: 1350, q: 5, color: "pink", am: { rate: 23, depth: 0.45 }, send: 0.12 });
  s.noise({ t, dur, a: 0.04, r: 0.12, gain: gain * 0.3, type: "lowpass", freq: 950, color: "pink", am: { rate: 31, depth: 0.3 } });
  for (const drip of [dur + 0.03, dur + 0.11]) {
    s.tone({ t: t + drip, freq: 800, to: 1300, glide: 0.02, dur: 0.03, a: 0.003, gain: gain * 0.25 });
  }
};

const sip = (s: Synth, t: number, gain: number): void => {
  s.noise({ t, dur: 0.27, a: 0.19, gain, freq: 1500, to: 2700, q: 1.5, lp: 4500, am: { rate: 38, depth: 0.45 } });
};

/** A contented exhale made only of filtered noise (an "ahh" formant pair) — no voice. */
const sigh = (s: Synth, t: number, gain: number): void => {
  s.noise({ t, dur: 0.48, a: 0.07, gain, freq: 760, to: 620, q: 2.2, color: "pink", send: 0.2 });
  s.noise({ t, dur: 0.44, a: 0.07, gain: gain * 0.7, freq: 1250, to: 1050, q: 2.6, color: "pink" });
  s.noise({ t, dur: 0.4, a: 0.06, gain: gain * 0.25, type: "highpass", freq: 2500, lp: 5000 });
};

// ─────────────────────────────────────────────────────────────────────────────
// The library
// ─────────────────────────────────────────────────────────────────────────────

const LIBRARY = {
  // ── UI ─────────────────────────────────────────────────────────────────────
  "ui-hover": ui(0.2015, { level: -24.5, minInterval: 0.045 }, (s) => {
    tap(s, 0, 0.5, 3000, { dur: 0.016, q: 2.2 });
    s.tone({ freq: N("B5"), dur: 0.03, a: 0.003, gain: 0.4 });
  }),
  "ui-select": ui(0.193, { level: -22 }, (s) => {
    pluck(s, 0, N("A5"), 0.8, { dur: 0.085, bright: 0.45, send: 0 });
  }),
  "ui-open": ui(0.216, { level: -23 }, (s) => {
    s.tone({ freq: N("D5"), to: N("A5"), glide: 0.055, dur: 0.095, a: 0.005, gain: 0.7 });
    s.noise({ dur: 0.075, a: 0.025, gain: 0.5, freq: 1300, to: 3300, q: 1.4 });
  }),
  "ui-close": ui(0.126, { level: -24 }, (s) => {
    s.tone({ freq: N("A5"), to: N("D5"), glide: 0.055, dur: 0.09, a: 0.005, gain: 0.7 });
    s.noise({ dur: 0.07, a: 0.006, gain: 0.5, freq: 3000, to: 1100, q: 1.4 });
  }),
  "ui-press": ui(0.2062, { level: -22 }, (s) => {
    s.tone({ freq: 235, to: 150, glide: 0.03, dur: 0.055, a: 0.003, gain: 0.9, type: "triangle" });
    // the octave above, so a laptop speaker (nothing below ~250 Hz) still hears the press
    s.tone({ freq: 470, to: 300, glide: 0.03, dur: 0.04, a: 0.003, gain: 0.4 });
    tap(s, 0, 0.5, 1900, { dur: 0.012 });
  }),
  "ui-prefill": ui(0.275, { level: -23, minInterval: 0.1 }, (s) => {
    // two keys and a nudge upward: "your turn to type"
    tap(s, 0, 0.5, 2700, { dur: 0.012 });
    tap(s, 0.038, 0.42, 3100, { dur: 0.012 });
    s.tone({ t: 0.056, freq: N("E5"), to: N("B5"), glide: 0.028, dur: 0.042, a: 0.004, gain: 0.6 });
  }),
  "ui-denied": ui(0.181, { level: -21, minInterval: 0.12, cents: 8 }, (s) => {
    // "nuh-uh": two soft low thuds, the second lower
    s.tone({ freq: 233, to: 215, dur: 0.042, a: 0.004, gain: 0.9, type: "triangle", lp: 900 });
    s.tone({ t: 0.052, freq: 196, to: 175, dur: 0.046, a: 0.004, gain: 0.8, type: "triangle", lp: 900 });
    // second harmonics at −6 dB: the only feedback a refusal gets must survive laptop speakers
    s.tone({ freq: 466, to: 430, dur: 0.038, a: 0.004, gain: 0.45 });
    s.tone({ t: 0.052, freq: 392, to: 350, dur: 0.042, a: 0.004, gain: 0.4 });
    tap(s, 0, 0.2, 1500, { dur: 0.01 });
  }),
  "ui-toggle-on": ui(0.175, { level: -23, cents: 8 }, (s) => {
    pluck(s, 0, N("E5"), 0.6, { dur: 0.04, send: 0 });
    pluck(s, 0.042, N("A5"), 0.8, { dur: 0.06, send: 0 });
  }),
  "ui-toggle-off": ui(0.165, { level: -24, cents: 8 }, (s) => {
    pluck(s, 0, N("A5"), 0.6, { dur: 0.04, send: 0 });
    pluck(s, 0.042, N("E5"), 0.8, { dur: 0.06, send: 0 });
  }),
  "ui-zoom-in": ui(0.1833, { level: -24.5, minInterval: 0.035, cents: 10 }, (s) => {
    s.tone({ freq: 1320, to: 1560, glide: 0.02, dur: 0.032, a: 0.003, gain: 0.6 });
    tap(s, 0, 0.3, 3400, { dur: 0.008 });
  }),
  "ui-zoom-out": ui(0.1748, { level: -24.5, minInterval: 0.035, cents: 10 }, (s) => {
    s.tone({ freq: 1560, to: 1320, glide: 0.02, dur: 0.032, a: 0.003, gain: 0.6 });
    tap(s, 0, 0.3, 2900, { dur: 0.008 });
  }),
  "ui-key": ui(0.1769, { level: -22.5, minInterval: 0.018, cents: 70, db: 0.5 }, (s) => {
    // One soft terminal keystroke — a drop-in for the typing click in TerminalInput, should the
    // app want it on the shared engine.
    key(s, 0, 0.8);
  }),

  // ── Outcome stingers: the SFX facade ───────────────────────────────────────
  success: stinger(0.4386, { level: -14, tonalAt: 0 }, (s) => {
    // The familiar rising chirp (now D5 → F♯5) with a kalimba attack and a glint on top. The
    // glint lands on one of three chord tones and the attack's brightness varies, so the most
    // frequent sound in the game is never quite the same twice.
    pluck(s, 0, N("D5"), 0.5, { dur: 0.09, bright: s.range(0.32, 0.48) });
    s.tone({ t: 0.012, freq: N("D5"), to: N("F#5"), glide: 0.07, dur: 0.21, a: 0.008, gain: 0.8, send: 0.18 });
    s.tone({ t: 0.012, freq: N("D6"), to: N("F#6"), glide: 0.07, dur: 0.12, a: 0.008, gain: 0.1, type: "triangle" });
    bell(s, 0.085, N(s.pick(["F#6", "A6", "D7"] as const)), 0.2, { dur: 0.22, index: s.range(0.9, 1.3), send: 0.3, pan: s.range(0.05, 0.25) });
  }),
  fail: stinger(0.4175, { level: -13, tonalAt: 0 }, (s) => {
    // The familiar descending buzz (now D4 → B3, the relative minor), landing on a soft thud.
    buzz(s, 0, N("D4"), 0.75, { to: N("B3"), dur: 0.2, lp: s.range(1450, 1950), lpTo: 420 });
    s.tone({ freq: N("D3"), to: N("B2"), glide: 0.16, dur: 0.2, a: 0.008, gain: 0.3 });
    thump(s, 0.15, 0.45, s.range(112, 136), { dur: 0.1 });
    tap(s, 0, 0.14, 900, { dur: 0.02, q: 0.8 });
  }),
  alert: stinger(0.5273, { level: -14, tonalAt: 0 }, (s) => {
    // Three quick pips on the dominant: unresolved on purpose.
    for (let i = 0; i < 3; i += 1) {
      const last = i === 2;
      s.tone({ t: i * 0.07, freq: N("A5"), dur: last ? 0.1 : 0.05, a: 0.004, gain: last ? 0.85 : 0.7, send: last ? 0.22 : 0.06 });
      s.tone({ t: i * 0.07, freq: N("A6"), dur: 0.03, a: 0.003, gain: 0.1, type: "triangle" });
    }
  }),
  crisis: stinger(0.4548, { level: -15, tonalAt: 0.08 }, (s) => {
    // Low rumble + high ping, as before — the ping is now a tritone (B5 under F6) that beats.
    s.noise({ dur: 0.36, a: 0.05, gain: 0.6, type: "lowpass", freq: 190, q: 0.8, color: "brown" });
    s.tone({ freq: 92, to: 61, glide: 0.25, dur: 0.32, a: 0.02, gain: 0.35, type: "triangle" });
    s.fm({ t: 0.08, freq: N("F6"), ratio: 2.4, index: 0.9, indexTo: 0.05, dur: 0.3, a: 0.004, gain: 0.6, send: 0.3, pan: 0.15 });
    s.tone({ t: 0.08, freq: N("B5") * 1.006, dur: 0.26, a: 0.004, gain: 0.35, pan: -0.15, send: 0.2 });
  }),
  opportunity: stinger(0.4807, { level: -16.7, tonalAt: 0 }, (s) => {
    // Ascending arpeggio on the tonic triad.
    pluck(s, 0, N("D5"), 0.6, { dur: 0.1, pan: -0.12 });
    pluck(s, 0.065, N("F#5"), 0.66, { dur: 0.11 });
    pluck(s, 0.13, N("A5"), 0.78, { dur: 0.27, pan: 0.12, send: 0.25 });
    bell(s, 0.14, N("A6"), 0.14, { dur: 0.25, index: 0.9, send: 0.3 });
  }),
  tick: stinger(0.3689, { level: -15, minInterval: 0.05, cents: 25 }, (s) => {
    // A soft wooden clock tick.
    // The knock carries the level (a few milliseconds of noise alone would vary play to play).
    tap(s, 0, 0.45, 2300, { dur: 0.014, q: 3 });
    s.tone({ freq: 1150, to: 900, glide: 0.02, dur: 0.032, a: 0.002, gain: 0.8 });
    s.tone({ freq: 420, dur: 0.022, a: 0.002, gain: 0.3 });
  }),
  "cash-in": stinger(0.5737, { level: -14.5, tonalAt: 0.045 }, (s) => {
    // Ka-ching: the mechanism, then a bell on A6 + D7. (A touch under the other stingers: a
    // bright bell carries far more loudness per dB of peak than a pluck.)
    tap(s, 0, 0.5, s.range(1500, 1900), { dur: 0.02, q: 1.2 });
    thump(s, 0, 0.3, 190, { dur: 0.05 });
    bell(s, 0.045, N("A6"), 0.6, { dur: 0.32, ratio: 3.01, index: s.range(0.75, 0.9), pan: -0.1, send: 0.22 });
    bell(s, 0.05, N("D7"), 0.2, { dur: 0.26, ratio: 2.4, index: 0.6, pan: 0.12, send: 0.22 });
    tap(s, 0.045, 0.2, 3600, { dur: 0.03, q: 0.9 });
  }),
  warning: stinger(0.3889, { level: -16, tonalAt: 0 }, (s) => {
    // Two-tone alarm, A5 / F5 twice: the F♮ is what makes it worried.
    for (let i = 0; i < 4; i += 1) {
      const freq = i % 2 === 0 ? N("A5") : N("F5");
      s.tone({ t: i * 0.1, freq, type: "square", dur: 0.088, a: 0.006, gain: 0.42, lp: 2100, send: 0.1 });
      s.tone({ t: i * 0.1, freq, dur: 0.088, a: 0.006, gain: 0.4 });
    }
  }),
  click: stinger(0.4723, { level: -15, minInterval: 0.04, cents: 30 }, (s) => {
    tap(s, 0, 0.45, 3000, { dur: 0.01, q: 1.2 });
    s.tone({ freq: 720, to: 480, glide: 0.012, dur: 0.022, a: 0.002, gain: 0.8 });
  }),

  // ── Game-over stings ───────────────────────────────────────────────────────
  "gameover-ipo": sting(0.425, { tonalAt: 0 }, (s) => {
    // Ta-ta-ta TAAA. Far too grand for a terminal game, which is the joke.
    for (let i = 0; i < 3; i += 1) brass(s, i * 0.1, N("D4"), 0.085, 0.5);
    const chord: ReadonlyArray<readonly [NoteName, number, number]> = [
      ["D4", 0.5, -0.2],
      ["F#4", 0.4, 0.1],
      ["A4", 0.42, -0.05],
      ["D5", 0.5, 0.2],
    ];
    for (const [note, gain, pan] of chord) brass(s, 0.31, N(note), 0.72, gain, pan);
    thump(s, 0.31, 0.5, 147, { dur: 0.18 });
    s.noise({ t: 0.31, dur: 0.55, a: 0.01, gain: 0.25, freq: 3800, q: 0.6, send: 0.3 });
    (["D6", "F#6", "A6", "D7"] as const).forEach((note, i) => {
      bell(s, 0.36 + i * 0.075, N(note), 0.16, { dur: 0.3, index: 1.2, pan: i % 2 ? 0.3 : -0.3 });
    });
  }),
  "gameover-acquisition": sting(0.6912, { level: -11, tonalAt: 0 }, (s) => {
    // Bittersweet: a warm D major that turns, politely, to its relative minor.
    ep(s, 0, N("D4"), 0.5, 0.55, -0.15);
    ep(s, 0.02, N("A4"), 0.4, 0.55, 0.1);
    ep(s, 0.04, N("F#5"), 0.34, 0.5, 0.2);
    ep(s, 0.44, N("B3"), 0.5, 0.72, -0.15);
    ep(s, 0.46, N("F#4"), 0.38, 0.72, 0.05);
    ep(s, 0.48, N("D5"), 0.32, 0.68, 0.2);
    ep(s, 0.62, N("C#5"), 0.22, 0.52, -0.05);
  }),
  "gameover-bankruptcy": sting(0.5455, { level: -11.5, tonalAt: 0 }, (s) => {
    // Four steps down a chromatic staircase, a low womp, and one last coin spinning to rest.
    (["F#4", "F4", "E4", "D4"] as const).forEach((note, i) => {
      buzz(s, i * 0.115, N(note), 0.6, { dur: 0.11, lp: 1500, lpTo: 600 });
    });
    buzz(s, 0.46, N("D3"), 0.8, { to: N("B2"), dur: 0.32, lp: 700, lpTo: 220, type: "sawtooth" });
    thump(s, 0.46, 0.6, 98, { dur: 0.2 });
    let t = 0.62;
    let gap = 0.085;
    for (let i = 0; i < 11; i += 1) {
      coin(s, t, 0.3 * 0.9 ** i + 0.05, { freq: 2500 + i * 45, dur: 0.035, pan: 0.2 });
      t += gap;
      gap *= 0.84;
    }
  }),
  "gameover-founder-removal": sting(0.3556, { level: -14.3, tonalAt: 0.5 }, (s) => {
    // The door, the lock, and a lonely open fifth.
    s.noise({ dur: 0.09, a: 0.002, gain: 0.65, type: "lowpass", freq: 900, color: "pink" });
    thump(s, 0, 0.8, 105, { dur: 0.2 });
    tap(s, 0.004, 0.5, 2200, { dur: 0.02 });
    s.noise({ t: 0.02, dur: 0.35, a: 0.01, gain: 0.25, freq: 420, q: 1.2, color: "pink", send: 0.5 });
    tap(s, 0.34, 0.35, 3200, { dur: 0.01 });
    thump(s, 0.345, 0.2, 320, { dur: 0.04 });
    s.tone({ t: 0.5, freq: N("B3"), dur: 0.7, a: 0.04, gain: 0.8, send: 0.4 });
    s.tone({ t: 0.5, freq: N("F#4"), dur: 0.6, a: 0.05, gain: 0.5, send: 0.4 });
  }),
  "gameover-zombie-saas": sting(0.4855, { level: -18, tonalAt: 0 }, (s) => {
    // Heart monitor: beep, beep, then the line that sags but never quite stops.
    for (const t of [0, 0.3]) s.tone({ t, freq: N("A5"), dur: 0.085, a: 0.004, r: 0.02, gain: 0.55, send: 0.12 });
    // (A held sine is all loudness and no transient: it sits well under the beeps.)
    s.tone({ t: 0.6, freq: N("A5"), to: N("A5") * 0.972, glide: 0.72, dur: 0.72, a: 0.008, r: 0.3, gain: 0.2, send: 0.15, vib: { rate: 5, rateTo: 2.2, depth: 9 } });
    s.tone({ t: 0.6, freq: N("A3"), dur: 0.72, a: 0.08, r: 0.3, gain: 0.15, type: "triangle", lp: 900 });
    s.tone({ t: 0.6, freq: N("A3") * 1.012, dur: 0.72, a: 0.08, r: 0.3, gain: 0.12, type: "triangle", lp: 900 });
  }),
  "gameover-ai-hype-exit": sting(0.6926, { level: -11.5, tonalAt: 0 }, (s) => {
    // Slot machine: six pips climb the scale, then the jackpot bell rattles and pays out.
    for (let i = 0; i < 6; i += 1) pluck(s, i * 0.05, pent(5 + i), 0.5 + i * 0.04, { dur: 0.06, bright: 0.5 });
    const trill = [N("D6"), N("A6"), N("F#6")];
    for (let i = 0; i < 9; i += 1) {
      const last = i === 8;
      bell(s, 0.33 + i * 0.045, trill[i % 3], last ? 0.4 : 0.3, { dur: last ? 0.34 : 0.1, ratio: 3.01, index: 1.4, pan: i % 2 ? 0.25 : -0.25 });
    }
    for (let i = 0; i < 6; i += 1) coin(s, 0.45 + i * 0.07 + s.range(0, 0.03), 0.22, { pan: s.range(-0.5, 0.5) });
  }),
  "gameover-forced-acquisition": sting(0.4364, { level: -11.5, tonalAt: 0.8 }, (s) => {
    // Gavel, gavel, a hurried signature, and a resigned third down onto the F♮.
    for (const t of [0, 0.2]) {
      s.tone({ t, freq: 520, to: 380, glide: 0.03, dur: 0.05, a: 0.002, gain: 0.6, send: 0.3 });
      thump(s, t, 0.7, 180, { dur: 0.08 });
      tap(s, t, 0.4, 1500, { dur: 0.012 });
    }
    s.noise({ t: 0.42, dur: 0.3, a: 0.03, gain: 0.55, freq: 2200, to: 3000, q: 2.5, am: { rate: 13, depth: 0.8 }, pan: 0.2 });
    buzz(s, 0.8, N("A4"), 0.9, { dur: 0.17, type: "triangle", lp: 1800, lpTo: 900, send: 0.25 });
    buzz(s, 0.98, N("F4"), 1.1, { dur: 0.42, type: "triangle", lp: 1600, lpTo: 500, send: 0.3 });
    s.tone({ t: 0.98, freq: N("F3"), dur: 0.4, a: 0.01, gain: 0.45 });
  }),

  // ── Generic stingers for mechanics still being designed ────────────────────
  "positive-small": stinger(0.4073, { level: -16, tonalAt: 0 }, (s) => {
    pluck(s, 0, N("A4"), 0.6, { dur: 0.08 });
    pluck(s, 0.07, N("D5"), 0.8, { dur: 0.17, send: 0.2 });
  }),
  "positive-big": stinger(0.5823, { level: -15, tonalAt: 0 }, (s) => {
    s.tone({ freq: N("D4"), dur: 0.32, a: 0.006, gain: 0.35, send: 0.2 });
    (["D5", "F#5", "A5", "D6"] as const).forEach((note, i) => {
      pluck(s, i * 0.06, N(note), 0.55 + i * 0.07, { dur: i === 3 ? 0.3 : 0.1, pan: -0.2 + i * 0.13, send: 0.22 });
    });
    bell(s, 0.2, N("F#6"), 0.14, { dur: 0.25, pan: -0.25, send: 0.3 });
    bell(s, 0.26, N("A6"), 0.14, { dur: 0.25, pan: 0.25, send: 0.3 });
  }),
  "negative-small": stinger(0.596, { level: -16, tonalAt: 0 }, (s) => {
    buzz(s, 0, N("D5"), 0.5, { dur: 0.09, type: "triangle", lp: 1800, lpTo: 900 });
    buzz(s, 0.085, N("B4"), 0.6, { dur: 0.17, type: "triangle", lp: 1600, lpTo: 600 });
  }),
  "negative-big": stinger(0.4205, { level: -14.5, tonalAt: 0 }, (s) => {
    buzz(s, 0, N("B4"), 0.55, { dur: 0.12, lp: 1700, lpTo: 800 });
    buzz(s, 0.12, N("F4"), 0.6, { dur: 0.12, lp: 1500, lpTo: 700 });
    buzz(s, 0.24, N("D4"), 0.7, { to: N("D4") * 0.97, dur: 0.26, lp: 1300, lpTo: 350, send: 0.06 });
    thump(s, 0.26, 0.5, 110, { dur: 0.14 });
  }),
  neutral: stinger(0.35, { level: -17, tonalAt: 0, cents: 12 }, (s) => {
    // A woodblock "tok": neither good nor bad.
    s.tone({ freq: N("A4"), to: N("A4") * 0.97, dur: 0.07, a: 0.003, gain: 0.8, send: 0.12 });
    s.tone({ freq: N("A4") * 2.76, dur: 0.025, a: 0.002, gain: 0.3 });
    tap(s, 0, 0.4, 1900, { dur: 0.012 });
  }),
  "project-started": stinger(0.4271, { level: -15, tonalAt: 0.05 }, (s) => {
    // A page turned, then a rising fifth: off we go.
    s.noise({ dur: 0.12, a: 0.04, gain: 0.3, freq: 900, to: 2400, q: 1.2, pan: -0.2 });
    pluck(s, 0.05, N("D4"), 0.65, { dur: 0.12 });
    pluck(s, 0.15, N("A4"), 0.8, { dur: 0.24, send: 0.22 });
  }),
  "project-progress": stinger(0.4281, { level: -15.5, tonalAt: 0 }, (s) => {
    // Three soft ratchet steps upward.
    (["E5", "F#5", "A5"] as const).forEach((note, i) => {
      pluck(s, i * 0.07, N(note), 0.55 + i * 0.1, { dur: 0.07, bright: 0.5 });
    });
  }),
  "release-flop": stinger(0.6193, { level: -14, tonalAt: 0 }, (s) => {
    // A sad trombone, in miniature: D, C♯, C, and a B that droops.
    (["D4", "C#4", "C4"] as const).forEach((note, i) => {
      buzz(s, i * 0.09, N(note), 0.55, { dur: 0.088, type: "sawtooth", lp: 1500, lpTo: 600, send: 0.06 });
    });
    s.tone({ t: 0.27, freq: N("B3"), to: N("B3") * 0.9, glide: 0.25, type: "sawtooth", dur: 0.27, a: 0.01, gain: 0.65, lp: 1300, lpTo: 320, vib: { rate: 6, rateTo: 3, depth: 22 }, send: 0.06 });
  }),
  "release-ok": stinger(0.5679, { level: -15, tonalAt: 0 }, (s) => {
    pluck(s, 0, N("D5"), 0.6, { dur: 0.12, pan: -0.15 });
    pluck(s, 0.005, N("A5"), 0.45, { dur: 0.12, pan: 0.15 });
    pluck(s, 0.13, N("F#5"), 0.65, { dur: 0.24, pan: -0.1, send: 0.22 });
    pluck(s, 0.135, N("D6"), 0.45, { dur: 0.22, pan: 0.1, send: 0.22 });
  }),
  "release-hit": stinger(0.5899, { level: -14, tonalAt: 0 }, (s) => {
    // The whole scale in a hurry and a shower of glints: more fanfare than any release deserves.
    s.tone({ freq: N("D4"), dur: 0.36, a: 0.006, gain: 0.35, send: 0.2 });
    [5, 7, 8, 9, 10].forEach((step, i) => pluck(s, i * 0.036, pent(step), 0.5 + i * 0.06, { dur: 0.08, pan: -0.25 + i * 0.12 }));
    bell(s, 0.2, N("A6"), 0.3, { dur: 0.34, ratio: 3.01, index: 1.3, pan: -0.2, send: 0.3 });
    bell(s, 0.215, N("D7"), 0.22, { dur: 0.3, ratio: 2.4, index: 0.8, pan: 0.2, send: 0.3 });
    whoosh(s, 0.08, 0.3, 0.2, { from: 1800, to: 5200, peak: 0.6, send: 0.2 });
  }),
  "level-up": stinger(0.5182, { level: -15.5, tonalAt: 0 }, (s) => {
    // A power-up: the triad climbs, a sweep carries it up the octave, a bell lands on top.
    s.tone({ freq: N("D5"), to: N("D6"), glide: 0.17, dur: 0.2, a: 0.02, gain: 0.3, type: "triangle", lp: 3000 });
    pluck(s, 0, N("D5"), 0.55, { dur: 0.07 });
    pluck(s, 0.05, N("F#5"), 0.6, { dur: 0.07 });
    pluck(s, 0.1, N("A5"), 0.65, { dur: 0.08 });
    bell(s, 0.17, N("D6"), 0.6, { dur: 0.32, ratio: 2, index: 1, send: 0.3 });
    tap(s, 0.17, 0.2, 3600, { dur: 0.01 });
  }),
  "training-done": stinger(0.3858, { level: -15, tonalAt: 0 }, (s) => {
    // Ding! — with a grace note, like a course-complete bell.
    pluck(s, 0, N("F#5"), 0.4, { dur: 0.045 });
    bell(s, 0.05, N("A5"), 0.8, { dur: 0.38, ratio: 3.5, index: 1.2, send: 0.3 });
    bell(s, 0.052, N("A6"), 0.12, { dur: 0.2, ratio: 2, index: 0.6, send: 0.3 });
  }),
  resignation: stinger(0.5861, { level: -15, tonalAt: 0.07 }, (s) => {
    // A letter lands on the desk, then B minor walks downstairs.
    s.noise({ dur: 0.045, a: 0.003, gain: 0.5, freq: 1500, q: 0.9 });
    thump(s, 0, 0.4, 165, { dur: 0.07 });
    (["F#4", "D4", "B3"] as const).forEach((note, i) => {
      buzz(s, 0.07 + i * 0.11, N(note), 0.55 + i * 0.05, { dur: i === 2 ? 0.19 : 0.105, type: "triangle", lp: 1500, lpTo: 500, send: 0.06 });
    });
  }),

  // ── World: doors, feet, chairs, keys ───────────────────────────────────────
  "door-open": world(0.317, { level: -18 }, (s) => {
    tap(s, 0, 0.7, 2600, { dur: 0.012 });
    s.tone({ freq: 390, to: 300, glide: 0.02, dur: 0.035, a: 0.002, gain: 0.5 });
    creak(s, 0.04, 0.26, 0.35, { from: 85, to: 125 });
    s.noise({ t: 0.03, dur: 0.36, a: 0.14, gain: 0.5, type: "lowpass", freq: 650, color: "pink", send: 0.2 });
  }),
  "door-close": world(0.2012, { level: -17 }, (s) => {
    creak(s, 0, 0.11, 0.3, { from: 120, to: 90 });
    thump(s, 0.11, 1, 118, { dur: 0.13, body: 0.8 });
    tap(s, 0.135, 0.5, 2200, { dur: 0.012 });
    s.tone({ t: 0.135, freq: 900, to: 700, glide: 0.015, dur: 0.03, a: 0.002, gain: 0.3 });
    // the wood of the door itself: a mid knock that small speakers can reproduce
    s.noise({ t: 0.11, dur: 0.05, a: 0.002, gain: 0.45, freq: 720, q: 1.6, pan: 0 });
    s.tone({ t: 0.11, freq: 620, to: 480, glide: 0.02, dur: 0.045, a: 0.002, gain: 0.25 });
    s.noise({ t: 0.11, dur: 0.22, a: 0.01, gain: 0.25, freq: 380, q: 1, color: "pink", send: 0.4 });
  }),
  footsteps: world(0.3686, { level: -18, minInterval: 0.2 }, (s, o) => {
    const steps = clamp(Math.round(o.steps ?? 4), 1, 6);
    const approach = clamp(o.approach ?? 0, -1, 1);
    let t = 0;
    for (let i = 0; i < steps; i += 1) {
      const left = i % 2 === 0;
      const k = steps > 1 ? i / (steps - 1) : 0;
      const distance = approach < 0 ? 1 - 0.55 * k * -approach : approach > 0 ? 1 - 0.55 * (1 - k) * approach : 1;
      const level = distance * s.range(0.85, 1.1);
      const pan = left ? -0.06 : 0.06;
      const shoe = left ? 1 : 0.88;
      // heel: a soft low thud — toe: a short scuff just after it
      s.noise({ t, dur: 0.055, a: 0.003, gain: 0.9 * level, type: "lowpass", freq: 600 * shoe, q: 0.8, color: "brown", pan, send: 0.18 });
      s.tone({ t, freq: 105 * shoe, to: 74 * shoe, glide: 0.04, dur: 0.065, a: 0.003, gain: 0.5 * level, pan });
      s.noise({ t: t + 0.055 + s.range(0, 0.012), dur: 0.035, a: 0.004, gain: 0.5 * level, freq: 1500 * shoe, q: 1, pan, send: 0.1 });
      t += s.jitter(0.3, 0.07);
    }
  }),
  "chair-sit": world(0.262, { level: -20 }, (s) => {
    s.noise({ dur: 0.17, a: 0.02, gain: 1, type: "lowpass", freq: 290, color: "brown", send: 0.15 });
    s.tone({ freq: 96, to: 70, glide: 0.08, dur: 0.12, a: 0.01, gain: 0.4 });
    creak(s, 0.06, 0.17, 0.3, { from: 105, to: 82, res: 880 });
    tap(s, 0.26, 0.2, 3000, { dur: 0.01 });
    s.noise({ t: 0.05, dur: 0.14, a: 0.03, gain: 0.12, freq: 1300, q: 0.7, color: "pink" });
  }),
  "chair-creak": world(0.223, { level: -20 }, (s) => {
    creak(s, 0, 0.2, 0.5, { from: 92, to: 132 });
    creak(s, 0.23, 0.24, 0.42, { from: 124, to: 84, res: 690 });
  }),
  "keyboard-flurry": world(0.298, { level: -18, minInterval: 0.25 }, (s, o) => {
    const count = Math.round(7 + 8 * clamp(o.intensity ?? 0.5, 0, 1));
    let t = 0;
    for (let i = 0; i < count; i += 1) {
      key(s, t, s.range(0.55, 1), { space: i > 0 && s.rand() < 0.14, pan: s.range(-0.25, 0.25) });
      t += s.rand() < 0.22 ? s.range(0.07, 0.11) : s.range(0.028, 0.055);
    }
  }),

  // ── World: people ──────────────────────────────────────────────────────────
  "hire-arrival": world(0.425, { level: -19, tonalAt: 0, cents: 10 }, (s) => {
    // The little bell over the door, knocked by the door as it opens: one tink and its
    // rebound — a shop bell, not a tune.
    bell(s, 0, N("F#6"), 0.6, { dur: 0.32, ratio: 2.76, index: 1.1, pan: -0.1, send: 0.3 });
    bell(s, s.range(0.06, 0.08), N("F#6") * 1.004, 0.3, { dur: 0.28, ratio: 2.76, index: 0.8, pan: 0.05, send: 0.35 });
    tap(s, 0, 0.15, 3200, { dur: 0.01 });
  }),
  departure: world(0.264, { level: -19 }, (s) => {
    // A sad little door: one long falling creak, a soft close, the air settling.
    creak(s, 0, 0.46, 0.4, { from: 132, to: 72, res: 640 });
    thump(s, 0.48, 0.8, 110, { dur: 0.14, body: 0.7 });
    tap(s, 0.52, 0.35, 2100, { dur: 0.012 });
    s.noise({ t: 0.5, dur: 0.34, a: 0.03, gain: 0.3, type: "lowpass", freq: 900, to: 280, color: "pink", send: 0.4 });
  }),

  // ── World: product ─────────────────────────────────────────────────────────
  "ship-ok": world(0.5067, { level: -18.5, tonalAt: 0.28, cents: 8 }, (s) => {
    // A whoosh across the room into a run of glints up the scale.
    whoosh(s, 0, 0.36, 0.55, { from: 420, to: 3200, peak: 0.7, pan: -0.35, panTo: 0.35, send: 0.2 });
    const run = [8, 10, 12, 14];
    run.forEach((step, i) => {
      const last = i === run.length - 1;
      bell(s, 0.28 + i * 0.065 + s.range(0, 0.012), pent(step), 0.34 + i * 0.04, {
        dur: last ? 0.3 : 0.15,
        ratio: s.pick([2.76, 3.5, 4.07]),
        index: 1.3,
        pan: (i % 2 ? 1 : -1) * 0.3,
        send: 0.3,
      });
    });
  }),
  "ship-fail": world(0.5003, { level: -20, tonalAt: 0 }, (s) => {
    // A glitchy fizzle…
    const sour = [N("C5"), N("F4"), N("B4"), N("F5"), N("C4")];
    let t = 0;
    for (let i = 0; i < 8; i += 1) {
      s.tone({ t, freq: s.pick(sour) * s.range(0.97, 1.03), type: "square", dur: s.range(0.02, 0.035), a: 0.003, gain: 0.4, bp: 1400, q: 0.8, lp: 3000, pan: s.range(-0.3, 0.3) });
      if (s.rand() < 0.7) tap(s, t + 0.012, 0.22, s.range(2200, 3400), { dur: 0.008 });
      t += s.range(0.022, 0.05);
    }
    // …then the air goes out of it: the deflating "wah".
    // (quietly: the store's fail buzz has already said "no"; this is the room sighing)
    s.tone({ t: 0.3, freq: N("F#4"), to: 196, glide: 0.5, type: "sawtooth", dur: 0.6, a: 0.02, gain: 0.28, lp: 1900, lpTo: 330, vib: { rate: 7, rateTo: 2.5, depth: 30 }, send: 0.2 });
    s.noise({ t: 0.3, dur: 0.55, a: 0.02, gain: 0.25, type: "lowpass", freq: 2600, to: 450, color: "pink" });
  }),
  "launch-ok": world(0.3760, { level: -20, tonalAt: 0 }, (s) => {
    // A megaphone blip (A4 → D5)…
    for (const [t, freq, dur] of [
      [0, N("A4"), 0.11],
      [0.125, N("D5"), 0.15],
    ] as const) {
      s.tone({ t, freq, type: "square", dur, a: 0.008, r: 0.04, gain: 0.5, bp: 1350, q: 1.3, hp: 500, send: 0.25 });
      s.tone({ t, freq: freq * 1.007, type: "sawtooth", dur, a: 0.008, r: 0.04, gain: 0.25, bp: 2100, q: 2 });
    }
    // …and a small crowd answering.
    crowd(s, 0.22, 0.9, 0.35);
    for (let i = 0; i < 5; i += 1) clap(s, s.range(0.38, 0.95), s.range(0.12, 0.22), { pan: s.range(-0.6, 0.6), freq: s.range(1000, 1500) });
  }),
  "launch-fail": world(0.396, { level: -17 }, (s) => {
    // Tumbleweed wind, a slow clap from the back and — of course — a cricket.
    const wind = s.noise({ dur: 1.3, a: 0.5, gain: 0.5, freq: 300, q: 2.4, color: "pink", pan: -0.45, panTo: 0.45, send: 0.2 });
    if (wind.filter) s.sweep(wind.filter.frequency, 0, [[0, 290], [0.5, 540], [1.3, 250]]);
    clap(s, 0.34, 0.9, { pan: 0.25, send: 0.5 });
    clap(s, 0.95, 0.7, { pan: 0.25, send: 0.5 });
    chirp(s, 1.15, 0.22, { pan: -0.4 });
  }),

  // ── World: investors ───────────────────────────────────────────────────────
  "phone-ring": world(0.2542, { level: -21, tonalAt: 0, cents: 6 }, (s) => {
    // One burst of a B5 ↔ D6 trill, twenty times a second — they pick up on the first ring.
    const trill = { rate: 20, depth: 150, type: "square" } as const;
    s.tone({ freq: 1078, dur: 0.33, a: 0.008, r: 0.05, gain: 0.5, vib: trill, bp: 1300, q: 0.9, am: { rate: 20, depth: 0.35 }, send: 0.25 });
    s.tone({ freq: 2156, type: "triangle", dur: 0.33, a: 0.008, r: 0.05, gain: 0.12, vib: trill });
    tap(s, 0.42, 0.5, 1800, { dur: 0.014 });
    s.tone({ t: 0.42, freq: 310, to: 240, glide: 0.03, dur: 0.05, a: 0.003, gain: 0.4 });
  }),
  "pitch-ok": world(0.708, { level: -18, tonalAt: 0 }, (s) => {
    // The investor on the other end: wah, wah-WAH. (It's a yes.) Handset down.
    squawk(s, 0, 0.12, 0.6, N("A3"), N("A3") * 1.03, 900, 1300);
    squawk(s, 0.15, 0.12, 0.6, N("A3"), N("B3"), 1000, 1400);
    squawk(s, 0.31, 0.27, 0.75, N("B3"), N("D4") * 1.02, 1100, 1700);
    tap(s, 0.64, 0.3, 1700, { dur: 0.014 });
    s.tone({ t: 0.64, freq: 280, to: 220, glide: 0.03, dur: 0.05, a: 0.003, gain: 0.25 });
  }),
  "pitch-fail": world(0.6549, { level: -18, tonalAt: 0 }, (s) => {
    // Wah… wah— (It's a no; they hang up mid-sentence.) Then the line goes dead. Level, then
    // cut off on the way up — the store's fail buzz has already done the falling.
    squawk(s, 0, 0.13, 0.6, N("E4"), N("E4") * 1.01, 1300, 1150);
    squawk(s, 0.17, 0.2, 0.7, N("E4"), N("F#4"), 1150, 1450);
    // (the hang-up is soft: the voice, not the click, carries the level)
    thump(s, 0.37, 0.3, 210, { dur: 0.06 });
    tap(s, 0.37, 0.16, 1500, { dur: 0.014 });
    s.tone({ t: 0.45, freq: 425, dur: 0.1, a: 0.006, r: 0.03, gain: 0.13, lp: 1600 });
  }),
  "raise-ok": world(0.3932, { level: -16 }, (s, o) => {
    // The drawer shoots open… (the bell itself is the `cash-in` stinger)
    tap(s, 0, 0.6, 1250, { dur: 0.02, q: 1 });
    thump(s, 0.005, 0.8, 150, { dur: 0.1 });
    s.noise({ t: 0.01, dur: 0.13, a: 0.03, gain: 0.35, freq: 900, to: 1500, q: 1.5, color: "pink" });
    // …and the coins come down.
    const count = Math.round(8 + 8 * clamp(o.intensity ?? 0.5, 0, 1));
    for (let i = 0; i < count; i += 1) {
      const t = 0.09 + 0.85 * (i / count) ** 1.25 + s.range(0, 0.03);
      const pan = s.range(-0.5, 0.5);
      const freq = s.range(2200, 3600);
      coin(s, t, s.range(0.3, 0.5), { freq, pan });
      if (s.rand() < 0.6) coin(s, t + s.range(0.035, 0.06), 0.16, { freq: freq * 1.04, pan, dur: 0.04 });
    }
  }),
  "raise-fail": world(0.3474, { level: -19.5, tonalAt: 0.06, cents: 4 }, (s) => {
    // Clunk, and a dial tone (the real 350 + 440 Hz: an F♮ under the A, as dark as it should be).
    thump(s, 0, 0.6, 220, { dur: 0.06 });
    tap(s, 0, 0.45, 1500, { dur: 0.014 });
    for (const freq of [350, 440]) s.tone({ t: 0.06, freq, dur: 0.35, a: 0.015, r: 0.06, gain: 0.19, hp: 300, lp: 2600, send: 0.08 });
    tap(s, 0.45, 0.3, 1900, { dur: 0.01 });
  }),

  // ── World: time and growth ─────────────────────────────────────────────────
  "week-advance": world(0.511, { level: -18, tonalAt: 0.82, cents: 6, minInterval: 0.6 }, (s, o) => {
    // Night: one long soft exhale and a couple of crickets…
    s.noise({ dur: 0.98, a: 0.3, gain: 0.5, type: "lowpass", freq: 2300, to: 340, color: "pink", pan: -0.2, panTo: 0.2, send: 0.25 });
    chirp(s, 0.26, 0.09, { pan: -0.5 });
    chirp(s, 0.6, 0.07, { pan: 0.45, freq: 4400 });
    // …dawn: a glow rising into a two-note chime (a different rising interval each week)…
    const pairs: ReadonlyArray<readonly [number, number]> = [
      [8, 10],
      [7, 9],
      [6, 8],
      [9, 11],
      [5, 8],
    ];
    const [low, high] = pairs[Math.abs(Math.round(o.variant ?? 0)) % pairs.length];
    s.tone({ t: 0.82, freq: pent(low) / 2, to: pent(low), glide: 0.3, dur: 0.36, a: 0.2, gain: 0.14, send: 0.3 });
    bell(s, 1.1, pent(low), 0.5, { dur: 0.4, ratio: 3.5, index: 1.1, pan: -0.15, send: 0.35 });
    bell(s, 1.24, pent(high), 0.55, { dur: 0.45, ratio: 3.5, index: 1.1, pan: 0.15, send: 0.35 });
    // …and one bird, because it is morning.
    for (const t of [1.38, 1.47]) s.tone({ t, freq: 2500, to: 3300, glide: 0.04, dur: 0.06, a: 0.006, gain: 0.1, pan: 0.5, send: 0.3 });
  }),
  "phase-change": world(0.411, { level: -14, tonalAt: 1.15, cents: 6, minInterval: 1 }, (s) => {
    // The builders are in: rumble, hammering, a ratchet…
    s.noise({ dur: 1.12, a: 0.25, gain: 0.7, type: "lowpass", freq: 150, q: 0.9, color: "brown", am: { rate: 11, depth: 0.5 }, send: 0.1 });
    s.tone({ freq: 58, dur: 1.1, a: 0.3, r: 0.25, gain: 0.3, type: "triangle", am: { rate: 11, depth: 0.6 } });
    [0.12, 0.33, 0.48, 0.76, 0.93].forEach((t, i) => {
      const pan = i % 2 ? 0.4 : -0.4;
      s.tone({ t, freq: 430, to: 300, glide: 0.03, dur: 0.05, a: 0.002, gain: 0.5, pan, send: 0.3 });
      tap(s, t, 0.4, 1800, { dur: 0.012, pan });
    });
    s.tone({ t: 0.55, freq: 38, type: "square", dur: 0.2, a: 0.01, r: 0.03, gain: 0.3, bp: 1600, q: 2.2, pan: 0.2 });
    // …then the dust sheet comes off: a D major chord with the ninth glinting on top.
    whoosh(s, 1, 0.2, 0.5, { from: 500, to: 3600, peak: 0.8, send: 0.2 });
    const chord: ReadonlyArray<readonly [NoteName, number, number]> = [
      ["D4", 0.5, -0.3],
      ["A4", 0.42, 0.25],
      ["D5", 0.42, -0.15],
      ["F#5", 0.4, 0.15],
      ["A5", 0.3, 0.3],
    ];
    chord.forEach(([note, gain, pan], i) => ep(s, 1.15 + i * 0.012, N(note), gain, 0.62, pan));
    bell(s, 1.2, N("E6"), 0.2, { dur: 0.45, index: 1.1, pan: 0.2, send: 0.35 });
    thump(s, 1.15, 0.5, 147, { dur: 0.15 });
  }),
  "stage-change": world(0.246, { level: -17, tonalAt: 0.26, cents: 6 }, (s) => {
    // Approved: a rubber stamp, then the desk bell.
    thump(s, 0, 0.9, 128, { dur: 0.1 });
    s.noise({ dur: 0.04, a: 0.002, gain: 0.5, freq: 1800, q: 0.8 });
    bell(s, 0.26, N("D6"), 0.6, { dur: 0.42, ratio: 2.76, index: 1.3, send: 0.35 });
    bell(s, 0.262, N("D7"), 0.14, { dur: 0.2, ratio: 2.4, index: 0.6, send: 0.3 });
    tap(s, 0.26, 0.15, 3200, { dur: 0.008 });
  }),

  // ── World: assets ──────────────────────────────────────────────────────────
  "asset-acquired": world(0.384, { level: -17, tonalAt: 0 }, (s) => {
    // It pops in with a springy bounce.
    const boing = s.tone({ freq: 330, dur: 0.26, a: 0.004, gain: 0.7, send: 0.2 });
    if (boing.osc) {
      const p = s.pitch;
      s.sweep(boing.osc.frequency, 0, [[0, 330 * p], [0.05, 640 * p], [0.11, 470 * p], [0.17, 570 * p], [0.24, 520 * p]]);
    }
    tap(s, 0, 0.5, 2200, { dur: 0.012 });
    bell(s, 0.15, N("E6"), 0.22, { dur: 0.18, pan: -0.3 });
    bell(s, 0.23, N("A6"), 0.22, { dur: 0.22, pan: 0.3 });
  }),
  "asset-office-upgrade": world(0.352, { level: -18, minInterval: 0.6 }, (s) => {
    // The espresso machine: pump, steam, two drips.
    s.tone({ freq: 100, type: "sawtooth", dur: 1, a: 0.05, r: 0.15, gain: 0.3, lp: 320, am: { rate: 28, depth: 0.5 } });
    s.noise({ t: 0.15, dur: 0.95, a: 0.2, gain: 0.8, freq: 3100, q: 0.8, lp: 5200, am: { rate: 22, depth: 0.35 }, pan: 0.15, send: 0.15 });
    s.noise({ t: 0.15, dur: 0.9, a: 0.25, gain: 0.35, freq: 900, q: 0.7, color: "pink" });
    for (const t of [1.12, 1.23]) s.tone({ t, freq: 900, to: 1500, glide: 0.022, dur: 0.035, a: 0.003, gain: 0.3, send: 0.3 });
  }),
  "asset-lounge": world(0.3476, { level: -18, tonalAt: 0.05, cents: 5, minInterval: 0.6 }, (s) => {
    // A lazy D6/9, rolled from the bottom over a brushed "shh".
    s.noise({ dur: 0.12, a: 0.04, gain: 0.2, freq: 3200, q: 0.6, lp: 5000 });
    (["D3", "A3", "F#4", "B4", "E5"] as const).forEach((note, i) => {
      ep(s, 0.05 + i * 0.062, N(note), 0.5 - i * 0.04, 1.15 - i * 0.08, (i - 2) * 0.14, { am: { rate: 4.6, depth: 0.25 } });
    });
  }),
  "asset-helicopter": world(0.167, { level: -17, minInterval: 0.6 }, (s) => {
    // Rotor wind-up: the chop accelerates while a turbine whines upward.
    const chop = { rate: 3.2, rateTo: 13, depth: 0.92 } as const;
    s.noise({ dur: 1.6, a: 0.5, r: 0.35, gain: 1.2, type: "lowpass", freq: 520, q: 0.8, color: "pink", am: chop, send: 0.12 });
    s.tone({ freq: 84, dur: 1.6, a: 0.5, r: 0.35, gain: 0.5, type: "triangle", am: chop });
    s.tone({ freq: 280, to: 900, glide: 1.4, type: "sawtooth", dur: 1.6, a: 0.6, r: 0.35, gain: 0.1, bp: 800, bpTo: 1900, q: 3 });
  }),
  "asset-jet": world(0.2922, { level: -19.5, minInterval: 0.6 }, (s) => {
    // A fly-by, left to right, with the pitch dropping as it passes.
    const roar = s.noise({ dur: 1.5, a: 0.8, gain: 1, freq: 700, q: 0.9, color: "pink", pan: -0.8, panTo: 0.8, send: 0.2 });
    if (roar.filter) s.sweep(roar.filter.frequency, 0, [[0, 700], [0.82, 2600], [1.5, 480]]);
    const whine = s.tone({ freq: 1520, dur: 1.4, a: 0.75, gain: 0.12, pan: -0.8, panTo: 0.8, type: "triangle" });
    if (whine.osc) s.sweep(whine.osc.frequency, 0, [[0, 1520], [0.78, 1680], [0.95, 1100], [1.4, 950]]);
    s.noise({ t: 0.75, dur: 0.75, a: 0.15, gain: 0.5, type: "lowpass", freq: 260, color: "brown", pan: 0.3 });
  }),
  "asset-yacht": world(0.2524, { level: -20, tonalAt: 0, cents: 5, minInterval: 0.6 }, (s) => {
    // A horn on the open fifth D–A, then gulls (more or less) over the water.
    for (const [freq, detune] of [
      [N("D3"), -6],
      [N("D3"), 7],
      [N("A3"), 0],
    ] as const) {
      s.tone({ freq, detune, type: "sawtooth", dur: 0.78, a: 0.07, r: 0.22, gain: 0.33, lp: 850, send: 0.3 });
    }
    for (const [t, pan] of [
      [0.86, -0.4],
      [1.08, 0.3],
      [1.27, -0.1],
    ] as const) {
      const gull = s.tone({ t, freq: 1750, dur: 0.14, a: 0.02, gain: 0.16, pan, send: 0.35, vib: { rate: 28, depth: 22 } });
      if (gull.osc) s.sweep(gull.osc.frequency, t, [[0, 1750], [0.045, 2550], [0.14, 1650]]);
    }
    s.noise({ t: 0.6, dur: 0.95, a: 0.4, gain: 0.3, type: "lowpass", freq: 700, color: "pink", pan: -0.3, panTo: 0.3 });
  }),

  // ── World: events ──────────────────────────────────────────────────────────
  "event-beacon": world(0.214, { level: -19, tonalAt: 0, cents: 5, minInterval: 0.5 }, (s) => {
    // Slow and low where `alert` is quick and high: two lighthouse sweeps on the dominant,
    // the second opening onto a fifth — a question.
    for (const [t, gain] of [
      [0, 0.6],
      [0.33, 0.7],
    ] as const) {
      const el = s.tone({ t, freq: N("A4"), type: "sawtooth", dur: 0.26, a: 0.05, gain, lp: 420, send: 0.3 });
      if (el.filter) s.sweep(el.filter.frequency, t, [[0, 420], [0.09, 1700], [0.26, 420]]);
      s.tone({ t, freq: N("A4"), dur: 0.26, a: 0.05, gain: gain * 0.5 });
    }
    s.tone({ t: 0.33, freq: N("E5"), dur: 0.3, a: 0.05, gain: 0.3, send: 0.3 });
    bell(s, 0.4, N("E6"), 0.1, { dur: 0.3, index: 0.8, send: 0.35 });
  }),
  "event-resolved": world(0.292, { level: -19, tonalAt: 0, cents: 5 }, (s) => {
    // The answer: dominant falls to tonic, and the paperwork is filed.
    pluck(s, 0, N("A4"), 0.6, { dur: 0.14, send: 0.25 });
    pluck(s, 0.11, N("D4"), 0.75, { dur: 0.3, send: 0.3 });
    s.noise({ t: 0.04, dur: 0.15, a: 0.03, gain: 0.3, freq: 2100, to: 800, q: 1.2, pan: 0.2 });
  }),
  "alarm-pulse": world(0.2568, { level: -21, tonalAt: 0, cents: 10, db: 1.2, minInterval: 0.8 }, (s) => {
    // Low runway: lub-dub. A heartbeat, not a siren. Played in short bursts by worldAudio; the
    // gap between the two thumps breathes a little from beat to beat.
    const dub = s.jitter(0.19, 0.03);
    s.tone({ freq: N("D4"), type: "triangle", dur: 0.13, a: 0.012, gain: 0.8, lp: s.range(800, 1000), send: 0.2 });
    s.tone({ t: dub, freq: N("A3"), type: "triangle", dur: 0.17, a: 0.012, gain: s.range(0.5, 0.65), lp: 800, send: 0.2 });
    tap(s, 0, 0.08, 1200, { dur: 0.012 });
  }),

  // ── World: little pleasures ────────────────────────────────────────────────
  coffee: world(0.245, { level: -19, minInterval: 1.5 }, (s) => {
    // Pour, sip, and a tiny contented sigh.
    pour(s, 0, 0.62, 0.8);
    sip(s, 0.92, 0.6);
    sigh(s, 1.32, 0.5);
  }),
  "coffee-pour": world(0.237, { level: -19, minInterval: 0.5 }, (s) => {
    pour(s, 0, 0.75, 0.8);
  }),
  "coffee-sip": world(0.292, { level: -19, minInterval: 0.3, db: 0.5 }, (s) => {
    sip(s, 0, 0.8);
  }),
  "coffee-sigh": world(0.2162, { level: -19, minInterval: 0.3, db: 0.4 }, (s) => {
    sigh(s, 0, 0.8);
  }),
  "bubble-pop": world(0.262, { level: -20.5, minInterval: 0.05 }, (s) => {
    s.tone({ freq: 360, to: 1150, glide: 0.035, dur: 0.05, a: 0.003, gain: 0.8 });
    tap(s, 0.034, 0.4, 3400, { dur: 0.008 });
  }),
  "confetti-pops": world(0.364, { level: -18, minInterval: 0.3 }, (s, o) => {
    const count = Math.round(5 + 6 * clamp(o.intensity ?? 0.5, 0, 1));
    for (let i = 0; i < count; i += 1) {
      const t = s.range(0, 0.36);
      const pan = s.range(-0.7, 0.7);
      s.noise({ t, dur: 0.016, a: 0.002, gain: s.range(0.4, 0.8), freq: s.range(900, 2200), q: 1.5, pan, send: 0.2 });
      s.tone({ t, freq: s.range(420, 620), to: 250, glide: 0.02, dur: 0.03, a: 0.002, gain: 0.3, pan });
    }
    // paper drifting down afterwards
    s.noise({ t: 0.1, dur: 0.55, a: 0.1, gain: 0.14, freq: 3600, q: 0.7, lp: 5200, am: { rate: 17, depth: 0.5 } });
  }),
  "money-flutter": world(0.4657, { level: -18.5, minInterval: 0.3, db: 0.4 }, (s) => {
    let t = 0;
    for (let i = 0; i < 7; i += 1) {
      s.noise({ t, dur: 0.034, a: 0.007, gain: 0.8 * 0.86 ** i, freq: s.range(1600, 2800), q: 1.2, pan: -0.3 + i * 0.1, send: 0.12 });
      t += s.range(0.045, 0.07);
    }
    coin(s, t + 0.02, 0.2, { dur: 0.05 });
  }),
  "smoke-puff": world(0.2783, { level: -15.5, minInterval: 0.2, db: 0.4, tonalAt: 0 }, (s) => {
    s.noise({ dur: 0.36, a: 0.014, gain: 1, type: "lowpass", freq: 1900, to: 360, color: "pink", send: 0.2 });
    s.tone({ freq: 105, to: 70, glide: 0.06, dur: 0.09, a: 0.006, gain: 0.3 });
  }),
  "coins-out": world(0.432, { level: -21, minInterval: 0.3 }, (s) => {
    // Money leaving: three coins, each lower and further away.
    [3400, 2900, 2450].forEach((freq, i) => coin(s, i * 0.11, 0.5 - i * 0.12, { freq, pan: 0.1 + i * 0.15 }));
  }),
  "users-trickle": world(0.462, { level: -20.5, minInterval: 0.3 }, (s) => {
    // New users dripping into the servers.
    for (let i = 0; i < 5; i += 1) {
      s.tone({ t: i * 0.075 + s.range(0, 0.02), freq: s.range(700, 900) * (1 + i * 0.08), to: s.range(1000, 1300), glide: 0.025, dur: 0.04, a: 0.004, gain: 0.5, pan: -0.5 + i * 0.22, send: 0.2 });
    }
  }),
  "pricing-flip": world(0.571, { level: -18, minInterval: 0.3 }, (s) => {
    // The pricing board's flaps settle on a new number.
    let t = 0;
    let gap = 0.03;
    for (let i = 0; i < 7; i += 1) {
      tap(s, t, 0.6 - i * 0.04, 1800 + i * 60, { dur: 0.011, pan: 0.1 });
      s.tone({ t, freq: 700 - i * 20, dur: 0.02, a: 0.002, gain: 0.25, pan: 0.1 });
      t += gap;
      gap *= 1.2;
    }
  }),
  "setup-complete": world(0.335, { level: -18.5, tonalAt: 0.2, cents: 5, minInterval: 1 }, (s) => {
    // The lights tink on, the room hums, and there is — briefly — a company.
    for (const t of [0, 0.09, 0.15]) tap(s, t, 0.3, 2400, { dur: 0.01, pan: s.range(-0.4, 0.4) });
    s.tone({ freq: 120, dur: 0.5, a: 0.15, gain: 0.25, type: "triangle" });
    (["D4", "A4", "F#5"] as const).forEach((note, i) => {
      s.tone({ t: 0.2 + i * 0.04, freq: N(note), dur: 0.7, a: 0.22, gain: 0.4 - i * 0.07, send: 0.35, pan: (i - 1) * 0.2 });
    });
    bell(s, 0.45, N("A6"), 0.08, { dur: 0.3, index: 0.8, send: 0.35 });
  }),
  "crowd-cheer": world(0.3655, { level: -17, minInterval: 0.8 }, (s) => {
    // The whole office, briefly delighted. Noise and hands only — no pitch to fight a stinger.
    crowd(s, 0, 1.25, 0.9);
    for (let i = 0; i < 10; i += 1) clap(s, s.range(0.15, 1), s.range(0.12, 0.26), { pan: s.range(-0.7, 0.7), freq: s.range(950, 1500) });
  }),
  "power-down": world(0.289, { level: -18, minInterval: 0.8, tonalAt: 0.03 }, (s) => {
    // The breaker trips and the hum drains out of the building. (Its glides are pitch: under a
    // game-over sting they would bury the sting's low notes, so worldAudio waits for the sting.)
    thump(s, 0, 0.7, 170, { dur: 0.07 });
    tap(s, 0, 0.5, 1400, { dur: 0.016 });
    s.tone({ t: 0.03, freq: 120, to: 62, glide: 0.8, type: "triangle", dur: 0.9, a: 0.01, gain: 0.4, lp: 1200, lpTo: 180 });
    s.tone({ t: 0.03, freq: 240, to: 124, glide: 0.8, dur: 0.8, a: 0.01, gain: 0.18 });
    // the transformer's buzz, an octave and a fifth up, so small speakers hear it drain too
    s.tone({ t: 0.03, freq: 360, to: 186, glide: 0.8, dur: 0.7, a: 0.01, gain: 0.12 });
    s.noise({ t: 0.03, dur: 0.8, a: 0.02, gain: 0.4, type: "lowpass", freq: 2400, to: 300, color: "pink", send: 0.2 });
  }),

  // ── World: the board ───────────────────────────────────────────────────────
  "board-dinner": world(0.3048, { level: -20, tonalAt: 0.12, cents: 8 }, (s) => {
    // A fork meets a plate; two glasses meet each other.
    tap(s, 0, 0.5, 3800, { dur: 0.01 });
    s.tone({ freq: 2900, dur: 0.03, a: 0.002, gain: 0.3 });
    glass(s, 0.12, N("E6"), 0.7, 0.45, -0.15);
    glass(s, 0.3, N("F#6"), 0.4, 0.35, 0.2);
  }),
  "board-gift": world(0.4546, { level: -19, tonalAt: 0.43, cents: 8 }, (s) => {
    // Wrapping paper, a ribbon pulled, a small bright "for me?".
    for (let i = 0; i < 6; i += 1) {
      s.noise({ t: s.range(0, 0.24), dur: s.range(0.012, 0.028), a: 0.003, gain: s.range(0.3, 0.7), freq: s.range(2400, 4300), q: 1.6, pan: s.range(-0.3, 0.3) });
    }
    s.noise({ t: 0.25, dur: 0.18, a: 0.1, gain: 0.5, freq: 850, to: 3400, q: 2.2, send: 0.15 });
    bell(s, 0.43, N("A6"), 0.3, { dur: 0.22, index: 1, send: 0.3 });
  }),
  "board-blackmail": world(0.1623, { level: -19, tonalAt: 0.18, cents: 5 }, (s) => {
    // An envelope slides across the table. Dun… dun: a tritone on plucked bass.
    s.noise({ dur: 0.2, a: 0.05, gain: 0.4, freq: 1250, to: 620, q: 1, color: "pink", pan: -0.2 });
    for (const [t, freq] of [
      [0.18, N("B2")],
      [0.47, N("F3")],
    ] as const) {
      s.tone({ t, freq, type: "triangle", dur: 0.26, a: 0.004, gain: 0.8, lp: 900, lpTo: 300, send: 0.2 });
      s.tone({ t, freq: freq * 2, dur: 0.14, a: 0.004, gain: 0.6 });
      s.tone({ t, freq: freq * 3, dur: 0.07, a: 0.003, gain: 0.35 });
      tap(s, t, 0.2, 900, { dur: 0.012, q: 0.8 });
    }
  }),

  // ── Ambience one-shots (scheduled by the AmbienceDirector) ─────────────────
  "amb-key": amb(0.0515, { level: -36, minInterval: 0.008 }, (s) => {
    key(s, 0, 0.8, { space: s.rand() < 0.1 });
  }),
  "amb-mouse": amb(0.0793, { level: -38, minInterval: 0.2 }, (s) => {
    tap(s, 0, 0.6, 2800, { dur: 0.007, q: 2.2 });
    tap(s, s.range(0.05, 0.08), 0.45, 2500, { dur: 0.007, q: 2.2 });
  }),
  "amb-chair": amb(0.0221, { level: -38, minInterval: 2, cents: 60 }, (s) => {
    creak(s, 0, s.range(0.16, 0.3), 0.6, { from: 95, to: 125 });
  }),
  "amb-cricket": amb(0.0439, { level: -38, minInterval: 0.15, cents: 60 }, (s) => {
    chirp(s, 0, 0.7, { freq: s.range(3900, 4500), pulses: s.pick([2, 3, 3, 4]), send: 0.2 });
  }),
  "amb-car": amb(0.0281, { level: -37, minInterval: 4, cents: 80 }, (s) => {
    // A car passing somewhere outside the garage.
    const body = s.noise({ dur: 3.6, a: 1.7, gain: 1, freq: 260, q: 0.7, color: "brown" });
    if (body.filter) s.sweep(body.filter.frequency, 0, [[0, 260], [1.7, 520], [3.6, 220]]);
    s.noise({ dur: 3.4, a: 1.7, gain: 0.3, freq: 900, q: 0.6, color: "pink" });
  }),
  "amb-clink": amb(0.0374, { level: -36, minInterval: 0.3, cents: 80 }, (s) => {
    // A cup finds its saucer.
    const freq = s.range(1900, 2500);
    const strikes = s.rand() < 0.4 ? [0, s.range(0.08, 0.12)] : [0];
    strikes.forEach((t, i) => {
      s.tone({ t, freq, dur: 0.09, a: 0.002, gain: i === 0 ? 0.7 : 0.4, send: 0.3 });
      s.tone({ t, freq: freq * 1.61, dur: 0.05, a: 0.002, gain: i === 0 ? 0.35 : 0.2 });
      tap(s, t, 0.3, 3600, { dur: 0.006 });
    });
  }),
  "amb-steam": amb(0.035, { level: -38, minInterval: 3, cents: 60 }, (s) => {
    // The café's milk steamer, far across the room.
    s.noise({ dur: 1.1, a: 0.3, gain: 0.8, freq: 2900, q: 0.8, lp: 5000, am: { rate: 19, depth: 0.3 }, send: 0.3 });
  }),
  "amb-phone": amb(0.0237, { level: -37, minInterval: 5, cents: 20 }, (s) => {
    // Someone else's desk phone, a room away: a softer, lower "brr-brr" (E5 ↔ G5, sixteen times a
    // second) — not the investor's ring.
    for (const t of [0, 0.36]) {
      s.tone({ t, freq: 719, dur: 0.2, a: 0.01, r: 0.04, gain: 0.6, vib: { rate: 16, depth: 150, type: "square" }, lp: 1400, am: { rate: 16, depth: 0.3 }, send: 0.6 });
    }
  }),
  "amb-pingpong": amb(0.0499, { level: -35, minInterval: 0.1, cents: 40 }, (s, o) => {
    // Variant even = paddle, odd = table.
    const paddle = Math.abs(Math.round(o.variant ?? 0)) % 2 === 0;
    const freq = paddle ? s.range(1250, 1400) : s.range(820, 900);
    s.tone({ freq, to: freq * 0.86, glide: 0.015, dur: 0.028, a: 0.002, gain: 0.8, send: 0.35 });
    tap(s, 0, 0.4, paddle ? 2600 : 1900, { dur: 0.008 });
  }),
  "amb-ticker": amb(0.046, { level: -38, minInterval: 1, cents: 10 }, (s) => {
    // The stock ticker in the lobby chattering out a few characters.
    const count = 3 + Math.floor(s.rand() * 4);
    const notes = [N("F#6"), N("A6"), N("B6"), N("D7")];
    for (let i = 0; i < count; i += 1) s.tone({ t: i * 0.072, freq: s.pick(notes), dur: 0.03, a: 0.004, gain: 0.6, send: 0.3 });
  }),
  "amb-step": amb(0.0481, { level: -36, minInterval: 0.15, cents: 80 }, (s) => {
    // A hard heel on marble, somewhere across the lobby.
    tap(s, 0, 0.7, 1500, { dur: 0.014, send: 0.8 });
    s.tone({ freq: 210, to: 160, glide: 0.02, dur: 0.035, a: 0.002, gain: 0.5, send: 0.6 });
  }),
  "amb-ding": amb(0.0275, { level: -38, minInterval: 5, cents: 10 }, (s) => {
    // The lift arriving: ding… dong, a falling third.
    bell(s, 0, N("A5"), 0.6, { dur: 0.8, ratio: 3.5, index: 0.8, send: 0.8 });
    bell(s, 0.42, N("F#5"), 0.5, { dur: 0.9, ratio: 3.5, index: 0.8, send: 0.8 });
  }),

  // ── Music (optional, default OFF — scheduled by the MusicDirector) ─────────
  "music-pad": mus(0.149, { level: -30, minInterval: 0.5 }, (s, o) => {
    const notes = o.notes && o.notes.length > 0 ? o.notes : [N("D3"), N("A3"), N("F#4"), N("E5")];
    const dur = clamp(o.dur ?? 10, 2, 30);
    const bright = clamp(o.intensity ?? 0.5, 0, 1);
    // Quick-ish in, very slow out (only −36 dB by the end): consecutive chords, overlapped by the
    // release time, cross-fade without the level sagging between them.
    const a = Math.min(1.8, dur * 0.25);
    const r = Math.min(4.5, dur * 0.45);
    notes.forEach((freq, i) => {
      const pan = notes.length > 1 ? -0.4 + (0.8 * i) / (notes.length - 1) : 0;
      const gain = (0.3 / Math.sqrt(notes.length)) * (i === 0 ? 1.2 : 1);
      // The bass pair is detuned less, so it shimmers instead of wobbling.
      for (const detune of i === 0 ? [-2, 2] : [-5, 6]) {
        s.tone({ freq, detune, type: "triangle", dur, a, r, floor: -36, gain, lp: 600 + 900 * bright, pan, send: 0.4 });
      }
      s.tone({ freq: freq * 2, dur, a: a * 1.3, r, floor: -36, gain: gain * 0.15 * bright, pan: -pan, send: 0.4 });
    });
  }),
  "music-pluck": mus(0.123, { level: -31, db: 1 }, (s, o) => {
    const freq = o.notes?.[0] ?? N("A4");
    const dur = clamp(o.dur ?? 1.6, 0.3, 4);
    ep(s, 0, freq, 0.6, dur, 0, { send: 0.45 });
    // one soft echo, off to a side
    ep(s, 0.375, freq, 0.2, dur * 0.8, Math.abs(Math.round(o.variant ?? 0)) % 2 === 0 ? -0.3 : 0.3, { send: 0.5 });
  }),
} satisfies Record<string, SoundDef>;

export type SoundName = keyof typeof LIBRARY;

export const SOUNDS: Readonly<Record<SoundName, SoundDef>> = LIBRARY;
export const SOUND_NAMES = Object.keys(LIBRARY) as SoundName[];

export const isSoundName = (name: string): name is SoundName => Object.prototype.hasOwnProperty.call(LIBRARY, name);

/** Sound names on one bus, in library order. */
export const soundsOnBus = (bus: BusName): SoundName[] => SOUND_NAMES.filter((name) => SOUNDS[name].bus === bus);
