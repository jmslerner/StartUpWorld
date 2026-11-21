/**
 * Synthesis building blocks. Everything a recipe in `sounds.ts` needs to schedule a sound on
 * ANY BaseAudioContext (live or offline): envelopes, oscillator / FM / noise voices, filters,
 * panning, a reverb send, cached noise buffers and the reverb impulse.
 *
 * No Web Audio object is touched at module top level; this file is safe to import in node.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Small maths
// ─────────────────────────────────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY);

/** Small, fast, deterministic PRNG (mulberry32). Returns values in [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tonal identity
//
// The whole game is in D major. Every pitched cue is drawn from this file so that
// sounds that land close together are consonant:
//   • bright family  — D major pentatonic (D E F♯ A B): success, opportunity, level-up,
//                      release-hit, cash-in, chimes, sparkles.
//   • dark family    — the relative minor (B) plus two borrowed "blue" notes, F♮ and C♮:
//                      fail, warning, crisis, flops, resignations.
//   • attention      — hangs on the dominant (A); resolution falls to the tonic (D).
// The pentatonic is also diatonic to G and A major, which is what lets the optional music
// change key by phase without ever clashing with a stinger.
// ─────────────────────────────────────────────────────────────────────────────

type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
type Accidental = "" | "#" | "b";
export type NoteName = `${Letter}${Accidental}${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

const SEMITONES: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export const noteToMidi = (note: NoteName): number => {
  const letter = note[0] as Letter;
  const accidental = note.length === 3 ? note[1] : "";
  const octave = Number(note[note.length - 1]);
  return 12 * (octave + 1) + SEMITONES[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
};

/** Note name → frequency in Hz (A4 = 440). */
export const hz = (note: NoteName): number => midiToHz(noteToMidi(note));

export const KEY_ROOT_MIDI = noteToMidi("D4");
/** Semitone offsets of the bright family above the tonic. */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;

/**
 * The n-th step of the D major pentatonic counted from D4 (step 0). Steps run on through
 * the octaves (5 → D5, −1 → B3), so `pent(i)` for rising i is always a rising, consonant run.
 */
export const pent = (step: number): number => {
  const size = PENTATONIC.length;
  const octave = Math.floor(step / size);
  const degree = ((step % size) + size) % size;
  return midiToHz(KEY_ROOT_MIDI + 12 * octave + PENTATONIC[degree]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Noise buffers (cached)
// ─────────────────────────────────────────────────────────────────────────────

export type NoiseColor = "white" | "pink" | "brown";

/** Every noise buffer is normalised to this RMS so recipe gains mean the same thing across colours. */
export const NOISE_RMS = 0.25;
const LOOP_CROSSFADE = 2048;

const noiseData = new Map<string, Float32Array>();
const contextNoise = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Below this the brown noise stops rising (it is a leaky integrator, so there is no DC wander). */
const BROWN_CORNER_HZ = 140;
/** Where the pink noise's 1/f slope is taken to start. */
const PINK_FLOOR_HZ = 20;

const generateNoise = (color: NoiseColor, length: number, seed: number, sampleRate: number): Float32Array => {
  const rand = mulberry32(seed);
  const total = length + LOOP_CROSSFADE;
  const raw = new Float32Array(total);
  if (color === "white") {
    for (let i = 0; i < total; i += 1) raw[i] = rand() * 2 - 1;
  } else if (color === "pink") {
    // Paul Kellet's refined pink filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < total; i += 1) {
      const w = rand() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    // Leaky integrator: brown noise without the DC wander.
    const k = (2 * Math.PI * BROWN_CORNER_HZ) / sampleRate;
    let last = 0;
    for (let i = 0; i < total; i += 1) {
      const w = rand() * 2 - 1;
      last = (last + k * w) / (1 + k);
      raw[i] = last;
    }
  }

  // Make it loop seamlessly: fold the extra tail back over the head with an equal-power crossfade.
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = raw[i];
  for (let i = 0; i < LOOP_CROSSFADE && i < length; i += 1) {
    const k = i / LOOP_CROSSFADE;
    out[i] = raw[i] * Math.sqrt(k) + raw[length + i] * Math.sqrt(1 - k);
  }

  let mean = 0;
  for (let i = 0; i < length; i += 1) mean += out[i];
  mean /= length;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    out[i] -= mean;
    sum += out[i] * out[i];
  }
  const scale = NOISE_RMS / Math.sqrt(sum / length || 1);
  for (let i = 0; i < length; i += 1) out[i] *= scale;
  return out;
};

const COLOR_SEED: Record<NoiseColor, number> = { white: 0x1f2e3d, pink: 0x51ab7e, brown: 0x7c0ffe };

/**
 * A looping mono noise buffer for `ctx`. Deterministic (seeded), generated once per
 * sample-rate/colour/length/variant and shared by every context at that rate.
 */
export const noiseBuffer = (ctx: BaseAudioContext, color: NoiseColor, seconds = 2, variant = 0): AudioBuffer => {
  const key = `${color}:${seconds}:${variant}`;
  let perContext = contextNoise.get(ctx);
  if (!perContext) {
    perContext = new Map();
    contextNoise.set(ctx, perContext);
  }
  const cached = perContext.get(key);
  if (cached) return cached;

  const rate = ctx.sampleRate;
  const length = Math.max(LOOP_CROSSFADE * 2, Math.round(seconds * rate));
  const dataKey = `${rate}:${key}`;
  let data = noiseData.get(dataKey);
  if (!data) {
    data = generateNoise(color, length, COLOR_SEED[color] + variant * 7919, rate);
    noiseData.set(dataKey, data);
  }
  const buffer = ctx.createBuffer(1, length, rate);
  buffer.getChannelData(0).set(data);
  perContext.set(key, buffer);
  return buffer;
};

/** Share (0..1) of a noise colour's power that lies between two frequencies. */
export const noiseBandShare = (color: NoiseColor, low: number, high: number, nyquist: number): number => {
  const lo = clamp(low, 0, nyquist);
  const hi = clamp(high, lo, nyquist);
  if (hi <= lo) return 0;
  if (color === "white") return (hi - lo) / nyquist;
  if (color === "pink") return Math.log(Math.max(hi, PINK_FLOOR_HZ) / Math.max(lo, PINK_FLOOR_HZ)) / Math.log(nyquist / PINK_FLOOR_HZ);
  return (Math.atan(hi / BROWN_CORNER_HZ) - Math.atan(lo / BROWN_CORNER_HZ)) / Math.atan(nyquist / BROWN_CORNER_HZ);
};

/** Typical peak ÷ RMS of a short burst of filtered noise. */
const NOISE_CREST = 2.6;

// ─────────────────────────────────────────────────────────────────────────────
// Reverb impulse (cached)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReverbSpec {
  /** Impulse length in seconds. */
  seconds: number;
  /** Time for the tail to fall 60 dB. */
  rt60: number;
  /** Gap before the tail starts. */
  predelay: number;
  /** One-pole lowpass on the tail, Hz (smaller = darker room). */
  damp: number;
  seed: number;
}

/** The small shared room every bus can send to: short, dark, unobtrusive. */
export const ROOM_REVERB: ReverbSpec = { seconds: 0.7, rt60: 0.5, predelay: 0.012, damp: 4200, seed: 0xa11ce };
/** A long, bright, hard-surfaced space for the public-company lobby ambience. */
export const LOBBY_REVERB: ReverbSpec = { seconds: 1.7, rt60: 1.45, predelay: 0.028, damp: 5600, seed: 0xb0bb1e };

const impulseData = new Map<string, [Float32Array, Float32Array]>();

const generateImpulse = (rate: number, spec: ReverbSpec): [Float32Array, Float32Array] => {
  const length = Math.max(64, Math.round(spec.seconds * rate));
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const earlyTimes = [
    [0.0113, 0.0171, 0.0229, 0.0311, 0.0407, 0.0533],
    [0.0127, 0.0159, 0.0251, 0.0293, 0.0431, 0.0499],
  ];
  for (let c = 0; c < 2; c += 1) {
    const rand = mulberry32(spec.seed + c * 104729);
    const data = channels[c];
    const pre = Math.round(spec.predelay * rate);
    const fadeIn = Math.max(1, Math.round(0.008 * rate));
    const a0 = 1 - Math.exp((-2 * Math.PI * spec.damp) / rate);
    let lp = 0;
    for (let i = pre; i < length; i += 1) {
      const t = (i - pre) / rate;
      const env = Math.exp((-6.908 * t) / spec.rt60);
      // The tail gets darker as it decays, like air and soft furniture would make it.
      const a = a0 * (0.3 + 0.7 * Math.sqrt(env));
      lp += a * ((rand() * 2 - 1) * env - lp);
      data[i] = lp * Math.min(1, (i - pre) / fadeIn);
    }
    earlyTimes[c].forEach((time, k) => {
      const index = Math.round((time + spec.predelay * 0.5) * rate);
      if (index < length) data[index] += (k % 2 === 0 ? 1 : -1) * 0.12 * 0.78 ** k;
    });
    const fadeOut = Math.min(length, Math.round(0.03 * rate));
    for (let i = 0; i < fadeOut; i += 1) data[length - 1 - i] *= i / fadeOut;
    // Unit energy: a steady signal comes back from the convolver at the level it went in.
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += data[i] * data[i];
    const scale = 1 / Math.sqrt(sum || 1);
    for (let i = 0; i < length; i += 1) data[i] *= scale;
  }
  return channels;
};

/** Stereo impulse response for a ConvolverNode (set `normalize = false`; the data is unit-energy). */
export const reverbImpulse = (ctx: BaseAudioContext, spec: ReverbSpec): AudioBuffer => {
  const rate = ctx.sampleRate;
  const key = `${rate}:${spec.seconds}:${spec.rt60}:${spec.predelay}:${spec.damp}:${spec.seed}`;
  let data = impulseData.get(key);
  if (!data) {
    data = generateImpulse(rate, spec);
    impulseData.set(key, data);
  }
  const buffer = ctx.createBuffer(2, data[0].length, rate);
  buffer.getChannelData(0).set(data[0]);
  buffer.getChannelData(1).set(data[1]);
  return buffer;
};

// ─────────────────────────────────────────────────────────────────────────────
// Voices
// ─────────────────────────────────────────────────────────────────────────────

const MIN_FREQ = 20;
const MAX_FREQ = 16000;
const MIN_ATTACK = 0.002;

const safeFreq = (value: number): number => clamp(Number.isFinite(value) ? value : 440, MIN_FREQ, MAX_FREQ);
const safeGain = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 8);

export interface Routing {
  /** Stereo position, −1 (left) … 1 (right). */
  pan?: number;
  /** If set, the element glides to this position over its length. */
  panTo?: number;
  /** Linear send into the shared reverb. */
  send?: number;
}

export interface Shape {
  /** Start, seconds after the voice starts. */
  t?: number;
  /** Total length in seconds, attack included. */
  dur: number;
  /** Linear attack. Default 4 ms; never shorter than 2 ms (no clicks). */
  a?: number;
  /** Stay at the peak this long before decaying. */
  hold?: number;
  /** If set: sustain at the peak and release over the last `r` seconds instead of decaying from the top. */
  r?: number;
  /** Peak linear gain. */
  gain: number;
  /** How far the exponential decay falls before the final few ms take it to zero (dB, default −60). */
  floor?: number;
}

export interface Tremolo {
  rate: number;
  /** If set, the rate glides here over the element's length. */
  rateTo?: number;
  /** 0..1 — the gain swings between 1 and 1 − depth. */
  depth: number;
  type?: OscillatorType;
}

export interface Vibrato {
  rate: number;
  rateTo?: number;
  /** Peak deviation in cents. */
  depth: number;
  type?: OscillatorType;
}

interface FilterOpts {
  /** Lowpass cutoff (Hz) and optional sweep target. */
  lp?: number;
  lpTo?: number;
  /** Highpass cutoff (Hz). */
  hp?: number;
  /** Bandpass centre (Hz) and optional sweep target. */
  bp?: number;
  bpTo?: number;
  /** Q for the bandpass / lowpass. */
  q?: number;
}

export interface ToneOpts extends Shape, Routing, FilterOpts {
  freq: number;
  /** Glide to this frequency… */
  to?: number;
  /** …over this many seconds (default: the whole length). */
  glide?: number;
  type?: OscillatorType;
  /** Cents. */
  detune?: number;
  vib?: Vibrato;
  am?: Tremolo;
}

export interface FmOpts extends Shape, Routing, FilterOpts {
  freq: number;
  to?: number;
  glide?: number;
  /** Modulator frequency ÷ carrier frequency. Non-integer = bell/metal, integer = reed/e-piano. */
  ratio?: number;
  /** Modulation index at the attack… */
  index?: number;
  /** …and where it settles (bright strike, mellow ring). */
  indexTo?: number;
  /** Seconds for the index to settle (default: 60% of the length). */
  indexDur?: number;
  type?: OscillatorType;
  am?: Tremolo;
}

/**
 * `gain` on a noise element is level-compensated: whatever the colour and however narrow the
 * filter, the burst peaks at roughly `gain` — the same scale as `tone` and `fm` — so the layers
 * of a recipe can be balanced by reading the numbers.
 */
export interface NoiseOpts extends Shape, Routing {
  color?: NoiseColor;
  /** Main filter. Default bandpass. */
  type?: BiquadFilterType;
  freq?: number;
  /** Sweep the main filter to this frequency over the element's length. */
  to?: number;
  q?: number;
  hp?: number;
  lp?: number;
  /** Playback rate of the noise loop (moves the whole spectrum). */
  rate?: number;
  am?: Tremolo;
}

export interface Element {
  readonly env: GainNode;
  readonly osc: OscillatorNode | null;
  readonly filter: BiquadFilterNode | null;
  /** Absolute context times. */
  readonly start: number;
  readonly end: number;
}

export interface SynthInit {
  ctx: BaseAudioContext;
  /** Where dry signal goes (the voice's gain). */
  dry: AudioNode;
  /** Where reverb sends go (the voice's wet gain). */
  wet: AudioNode;
  /** Absolute context time the voice starts at. */
  t0: number;
  rand: () => number;
  /** Voice-wide pitch/timbre variation as a ratio (1 = as written). */
  pitch?: number;
}

/**
 * One voice's worth of nodes. A recipe calls `tone` / `fm` / `noise` any number of times;
 * the Synth remembers every node it made so the engine can stop and disconnect the lot.
 */
export class Synth {
  readonly ctx: BaseAudioContext;
  readonly t0: number;
  readonly rand: () => number;
  /** Multiplies every frequency a recipe asks for (oscillators and noise filters alike). */
  readonly pitch: number;
  /** Latest context time at which anything in this voice is still sounding. */
  end: number;

  private readonly dry: AudioNode;
  private readonly wet: AudioNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly pans = new Map<number, AudioNode>();
  private readonly sends = new Map<number, AudioNode>();
  private disposed = false;

  constructor(init: SynthInit) {
    this.ctx = init.ctx;
    this.dry = init.dry;
    this.wet = init.wet;
    this.t0 = init.t0;
    this.rand = init.rand;
    this.pitch = init.pitch ?? 1;
    this.end = init.t0;
  }

  // ── randomness helpers ────────────────────────────────────────────────────

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  /** `value` moved by up to ±`fraction` of itself. */
  jitter(value: number, fraction: number): number {
    return value * (1 + (this.rand() * 2 - 1) * fraction);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.rand() * items.length))];
  }

  // ── node bookkeeping ──────────────────────────────────────────────────────

  /** Register a node made outside the helpers so it is cleaned up with the voice. */
  track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  /** Start and stop a source at absolute context times and remember it. */
  run(source: AudioScheduledSourceNode, start: number, stop: number, offset?: number): void {
    this.nodes.push(source);
    this.sources.push(source);
    if (offset !== undefined && "buffer" in source) {
      (source as AudioBufferSourceNode).start(start, offset);
    } else {
      source.start(start);
    }
    source.stop(stop);
    if (stop > this.end) this.end = stop;
  }

  /** Voice-relative seconds → absolute context time. */
  at(offset: number): number {
    return this.t0 + (Number.isFinite(offset) ? Math.max(0, offset) : 0);
  }

  /** The voice's dry input, for recipes that build their own graph. */
  get output(): AudioNode {
    return this.dry;
  }

  /**
   * Automate a parameter through `[secondsFromStart, value]` points, starting at voice time `t`.
   * The first point is set, the rest are ramped to. Values are used as given (no pitch scaling).
   */
  sweep(param: AudioParam, t: number, points: ReadonlyArray<readonly [number, number]>, mode: "exp" | "lin" = "exp"): void {
    const base = this.at(t);
    let last = 0;
    points.forEach(([offset, value], i) => {
      if (i === 0) {
        last = Math.max(0, offset);
        param.setValueAtTime(value, base + last);
        return;
      }
      last = Math.max(offset, last + 0.001);
      if (mode === "exp" && value > 0) param.exponentialRampToValueAtTime(value, base + last);
      else param.linearRampToValueAtTime(value, base + last);
    });
  }

  // ── elements ──────────────────────────────────────────────────────────────

  /** An oscillator through optional filters and an envelope. */
  tone(o: ToneOpts): Element {
    const ctx = this.ctx;
    const start = this.at(o.t ?? 0);
    const dur = this.length(o);
    const end = start + dur;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    this.pitchRamp(osc.frequency, start, o.freq, o.to, o.glide ?? dur);
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) this.vibrato(osc, start, end, o.vib);

    const { tail, filter } = this.filters(osc, start, end, o);
    const env = this.finish(o.am ? this.tremolo(tail, start, end, o.am) : tail, start, o);
    this.run(osc, start, end + 0.01);
    return { env, osc, filter, start, end };
  }

  /** Two-operator FM: a modulator bends the carrier's pitch, hard at the strike and less as it rings. */
  fm(o: FmOpts): Element {
    const ctx = this.ctx;
    const start = this.at(o.t ?? 0);
    const dur = this.length(o);
    const end = start + dur;
    const ratio = o.ratio ?? 2;
    const carrier = ctx.createOscillator();
    carrier.type = o.type ?? "sine";
    this.pitchRamp(carrier.frequency, start, o.freq, o.to, o.glide ?? dur);

    const modulator = ctx.createOscillator();
    this.pitchRamp(modulator.frequency, start, o.freq * ratio, o.to === undefined ? undefined : o.to * ratio, o.glide ?? dur);
    const depth = this.track(ctx.createGain());
    const modHz = safeFreq(o.freq * this.pitch * ratio);
    const index = Math.max(0.001, o.index ?? 1);
    const indexTo = Math.max(0.001, o.indexTo ?? index * 0.1);
    depth.gain.setValueAtTime(index * modHz, start);
    depth.gain.exponentialRampToValueAtTime(indexTo * modHz, start + Math.max(0.005, o.indexDur ?? dur * 0.6));
    modulator.connect(depth);
    depth.connect(carrier.frequency);

    const { tail, filter } = this.filters(carrier, start, end, o);
    const env = this.finish(o.am ? this.tremolo(tail, start, end, o.am) : tail, start, o);
    this.run(carrier, start, end + 0.01);
    this.run(modulator, start, end + 0.01);
    return { env, osc: carrier, filter, start, end };
  }

  /** A slice of looping noise through a (sweepable) filter and an envelope: anything tactile. */
  noise(o: NoiseOpts): Element {
    const ctx = this.ctx;
    const start = this.at(o.t ?? 0);
    const dur = this.length(o);
    const end = start + dur;
    const buffer = noiseBuffer(ctx, o.color ?? "white");
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (o.rate !== undefined) src.playbackRate.value = clamp(o.rate, 0.1, 4);

    let tail: AudioNode = src;
    let filter: BiquadFilterNode | null = null;
    const type = o.type ?? "bandpass";
    if (o.freq !== undefined) {
      filter = this.track(ctx.createBiquadFilter());
      filter.type = type;
      filter.Q.value = o.q ?? (type === "bandpass" ? 1.2 : 0.7);
      this.pitchRamp(filter.frequency, start, o.freq, o.to, dur);
      tail.connect(filter);
      tail = filter;
    }
    if (o.hp !== undefined) tail = this.biquad(tail, "highpass", o.hp, 0.7);
    if (o.lp !== undefined) tail = this.biquad(tail, "lowpass", o.lp, 0.7);

    const env = this.finish(o.am ? this.tremolo(tail, start, end, o.am) : tail, start, { ...o, gain: o.gain * this.noiseMakeup(o) });
    this.run(src, start, end + 0.01, this.rand() * Math.max(0, buffer.duration - 0.05));
    return { env, osc: null, filter, start, end };
  }

  /** Stop every source and disconnect every node this voice made. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped or never started.
      }
    }
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    this.pans.clear();
    this.sends.clear();
  }

  /** Number of nodes currently owned (tests / leak checks). */
  get nodeCount(): number {
    return this.nodes.length;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Gain that brings a filtered noise burst up to a peak of about 1 (see NoiseOpts). */
  private noiseMakeup(o: NoiseOpts): number {
    const nyquist = this.ctx.sampleRate / 2;
    let low = 0;
    let high = nyquist;
    let widen = 1;
    if (o.freq !== undefined) {
      const centre = o.to === undefined ? o.freq : Math.sqrt(o.freq * o.to);
      const type = o.type ?? "bandpass";
      if (type === "bandpass") {
        const q = Math.max(0.1, o.q ?? 1.2);
        const half = 1 / (2 * q);
        const root = Math.sqrt(1 + half * half);
        low = centre * (root - half);
        high = centre * (root + half);
        widen = Math.PI / 2; // a 2-pole bandpass lets through more than its −3 dB width
      } else if (type === "lowpass") {
        high = centre;
      } else if (type === "highpass") {
        low = centre;
      }
    }
    if (o.hp !== undefined) low = Math.max(low, o.hp);
    if (o.lp !== undefined) high = Math.min(high, o.lp);
    const share = clamp(noiseBandShare(o.color ?? "white", low, high, nyquist) * widen, 0.002, 1);
    return 1 / (NOISE_RMS * NOISE_CREST * Math.sqrt(share));
  }

  private length(o: Shape): number {
    const a = Math.max(MIN_ATTACK, o.a ?? 0.004);
    return Math.max(a + 0.008, Number.isFinite(o.dur) ? o.dur : 0.05);
  }

  private pitchRamp(param: AudioParam, start: number, from: number, to: number | undefined, glide: number): void {
    param.setValueAtTime(safeFreq(from * this.pitch), start);
    if (to !== undefined) param.exponentialRampToValueAtTime(safeFreq(to * this.pitch), start + Math.max(0.004, Number.isFinite(glide) ? glide : 0.05));
  }

  private biquad(input: AudioNode, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const filter = this.track(this.ctx.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = safeFreq(freq * this.pitch);
    filter.Q.value = q;
    input.connect(filter);
    return filter;
  }

  private filters(input: AudioNode, start: number, end: number, o: FilterOpts): { tail: AudioNode; filter: BiquadFilterNode | null } {
    let tail = input;
    let main: BiquadFilterNode | null = null;
    if (o.hp !== undefined) tail = this.biquad(tail, "highpass", o.hp, 0.7);
    if (o.bp !== undefined) {
      main = this.biquad(tail, "bandpass", o.bp, o.q ?? 1.2);
      main.frequency.setValueAtTime(safeFreq(o.bp * this.pitch), start);
      if (o.bpTo !== undefined) main.frequency.exponentialRampToValueAtTime(safeFreq(o.bpTo * this.pitch), end);
      tail = main;
    }
    if (o.lp !== undefined) {
      const lp = this.biquad(tail, "lowpass", o.lp, o.bp === undefined ? (o.q ?? 0.7) : 0.7);
      lp.frequency.setValueAtTime(safeFreq(o.lp * this.pitch), start);
      if (o.lpTo !== undefined) lp.frequency.exponentialRampToValueAtTime(safeFreq(o.lpTo * this.pitch), end);
      main = main ?? lp;
      tail = lp;
    }
    return { tail, filter: main };
  }

  private tremolo(input: AudioNode, start: number, end: number, am: Tremolo): AudioNode {
    const ctx = this.ctx;
    const depth = clamp(am.depth, 0, 1);
    const stage = this.track(ctx.createGain());
    stage.gain.value = 1 - depth / 2;
    const lfo = ctx.createOscillator();
    lfo.type = am.type ?? "sine";
    lfo.frequency.setValueAtTime(clamp(am.rate, 0.01, 200), start);
    if (am.rateTo !== undefined) lfo.frequency.exponentialRampToValueAtTime(clamp(am.rateTo, 0.01, 200), end);
    const amount = this.track(ctx.createGain());
    amount.gain.value = depth / 2;
    lfo.connect(amount);
    amount.connect(stage.gain);
    input.connect(stage);
    this.run(lfo, start, end + 0.01);
    return stage;
  }

  private vibrato(osc: OscillatorNode, start: number, end: number, vib: Vibrato): void {
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    lfo.type = vib.type ?? "sine";
    lfo.frequency.setValueAtTime(clamp(vib.rate, 0.01, 200), start);
    if (vib.rateTo !== undefined) lfo.frequency.exponentialRampToValueAtTime(clamp(vib.rateTo, 0.01, 200), end);
    const amount = this.track(ctx.createGain());
    amount.gain.value = vib.depth;
    lfo.connect(amount);
    amount.connect(osc.detune);
    this.run(lfo, start, end + 0.01);
  }

  /** Envelope + routing: the last stage of every element. */
  private finish(input: AudioNode, start: number, o: Shape & Routing): GainNode {
    const env = this.track(this.ctx.createGain());
    const dur = this.length(o);
    const end = start + dur;
    const a = Math.min(Math.max(MIN_ATTACK, o.a ?? 0.004), dur - 0.006);
    const peak = Math.max(1e-5, safeGain(o.gain));
    const g = env.gain;
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(peak, start + a);
    const decayFrom = o.r !== undefined ? Math.max(start + a, end - Math.max(0.005, o.r)) : Math.min(end - 0.006, start + a + Math.max(0, o.hold ?? 0));
    if (decayFrom > start + a + 1e-4) g.setValueAtTime(peak, decayFrom);
    // Exponential decay to the floor, then a few linear milliseconds down to true zero.
    const lin = Math.min(0.008, (end - decayFrom) * 0.25);
    g.exponentialRampToValueAtTime(peak * dbToGain(o.floor ?? -60), end - lin);
    g.linearRampToValueAtTime(0, end);
    input.connect(env);

    if (o.panTo !== undefined && typeof this.ctx.createStereoPanner === "function") {
      const panner = this.track(this.ctx.createStereoPanner());
      panner.pan.setValueAtTime(clamp(o.pan ?? 0, -1, 1), start);
      panner.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), end);
      env.connect(panner);
      panner.connect(this.dry);
    } else {
      env.connect(this.panBus(o.pan ?? 0));
    }
    if (o.send !== undefined && o.send > 0) env.connect(this.sendBus(o.send));
    return env;
  }

  /** Elements at the same position share one panner. */
  private panBus(pan: number): AudioNode {
    const key = Math.round(clamp(pan, -1, 1) * 20) / 20;
    if (key === 0 || typeof this.ctx.createStereoPanner !== "function") return this.dry;
    let node = this.pans.get(key);
    if (!node) {
      const panner = this.track(this.ctx.createStereoPanner());
      panner.pan.value = key;
      panner.connect(this.dry);
      node = panner;
      this.pans.set(key, node);
    }
    return node;
  }

  /** Elements with the same send amount share one send gain. */
  private sendBus(amount: number): AudioNode {
    const key = Math.round(clamp(amount, 0, 1.5) * 50) / 50;
    let node = this.sends.get(key);
    if (!node) {
      const gain = this.track(this.ctx.createGain());
      gain.gain.value = key;
      gain.connect(this.wet);
      node = gain;
      this.sends.set(key, node);
    }
    return node;
  }
}
