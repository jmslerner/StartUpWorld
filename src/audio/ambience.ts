/**
 * The office bed: a continuous, generative ambience that follows the game.
 *
 *   ambienceTargets(state)  — pure: game state → layer levels, one-shot rates, tone.
 *   AmbienceDirector        — the audio that chases those targets with slow crossfades.
 *
 * Built from a few long-lived nodes (filtered noise loops, gains that drift on slowed-down noise
 * rather than on LFOs, four oscillators at most) plus a lookahead scheduler that sprinkles
 * stochastic one-shots (key taps, cups, a far phone…) through the engine's ambience bus.
 * Nothing in it repeats: every noise loop's read speed wanders at random by a couple of percent
 * (inaudible on noise, but the read position drifts, so the same 11 s of buffer never comes
 * round sample-for-sample again — the lab checks the bed's waveform autocorrelation), and every
 * one-shot is a Poisson arrival.
 *
 * Layers
 *   room      room tone — always there, very low.
 *   keys      keyboard clatter in bursts: density follows head count, liveliness follows morale.
 *   murmur    indistinct voices once the team is big enough.
 *   tension   a barely-there low beating tone when stress is high or the runway is short.
 *   colour    garage: fridge hum, night insects, the odd distant car
 *             coworking: café wash, cup clinks, a far milk steamer
 *             office: HVAC, a far phone, a chair
 *             unicorn: busy floor, ping-pong rallies
 *             public: marble-lobby reverb, heels, ticker blips, the lift
 * Dusk quietens and warms everything; an open event hushes the room; before setup and after
 * game over only a whisper of room tone is left; with the 3D view hidden it stops.
 */
import type { CompanyPhase } from "../types/game";
import type { AudioEngine, BusTap } from "./engine";
import type { PlayOptions, SoundName } from "./sounds";
import { LOBBY_REVERB, NOISE_RMS, clamp, noiseBuffer, reverbImpulse } from "./synth";

// ─────────────────────────────────────────────────────────────────────────────
// Targets (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface AmbienceState {
  phase: CompanyPhase;
  /** Employees (founders not counted). */
  teamSize: number;
  /** 0–100. */
  morale: number;
  /** 0–100. */
  stress: number;
  /** 0 = bright morning … 1 = ember dusk. */
  dusk: number;
  runwayLow: boolean;
  pendingEvent: boolean;
  gameOver: boolean;
  setupComplete: boolean;
  worldVisible: boolean;
}

export const DEFAULT_AMBIENCE_STATE: AmbienceState = {
  phase: "garage",
  teamSize: 0,
  morale: 60,
  stress: 20,
  dusk: 0,
  runwayLow: false,
  pendingEvent: false,
  gameOver: false,
  setupComplete: false,
  worldVisible: true,
};

export const LAYER_NAMES = ["room", "murmur", "tension", "fridge", "cafe", "hvac", "floor"] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export const SCATTER_NAMES = [
  "keys",
  "mouse",
  "chair",
  "cricket",
  "car",
  "clink",
  "steam",
  "phone",
  "pingpong",
  "ticker",
  "step",
  "ding",
] as const;
export type ScatterName = (typeof SCATTER_NAMES)[number];

export interface AmbienceTargets {
  /** Overall level of the bed, 0..1. 0 = stopped. */
  master: number;
  /** Lowpass over the whole bed, Hz — dusk closes it. */
  warmth: number;
  /** Continuous layers, linear 0..~1. */
  layers: Record<LayerName, number>;
  /** One-shot arrivals per second (`keys` is key taps per second). */
  rates: Record<ScatterName, number>;
  /** Linear level of each one-shot family. */
  gains: Record<ScatterName, number>;
  /** 0..1 — how lively the typing is (burst length and speed). Follows morale. */
  keyEnergy: number;
  /** Reverb sends go to the marble lobby instead of the small room. */
  lobby: boolean;
}

const zeroLayers = (): Record<LayerName, number> => ({ room: 0, murmur: 0, tension: 0, fridge: 0, cafe: 0, hvac: 0, floor: 0 });
const zeroScatter = (): Record<ScatterName, number> => ({
  keys: 0,
  mouse: 0,
  chair: 0,
  cricket: 0,
  car: 0,
  clink: 0,
  steam: 0,
  phone: 0,
  pingpong: 0,
  ticker: 0,
  step: 0,
  ding: 0,
});

/** Level of the whisper of room tone left before setup and after game over. */
const DORMANT_LEVEL = 0.14;
/** Key taps per second approach this and never pass it. */
const KEY_RATE_CAP = 6.5;

export const ambienceTargets = (state: AmbienceState): AmbienceTargets => {
  const layers = zeroLayers();
  const rates = zeroScatter();
  const gains = zeroScatter();
  const dusk = clamp(state.dusk, 0, 1);
  const warmth = 7000 - 4600 * dusk;

  if (!state.worldVisible) return { master: 0, warmth, layers, rates, gains, keyEnergy: 0, lobby: false };

  if (!state.setupComplete || state.gameOver) {
    layers.room = 1;
    return { master: DORMANT_LEVEL, warmth: Math.min(warmth, 2600), layers, rates, gains, keyEnergy: 0, lobby: false };
  }

  const morale = clamp(state.morale, 0, 100) / 100;
  const stress = clamp(state.stress, 0, 100) / 100;
  const people = Math.max(0, state.teamSize) + 2; // the founders type too
  const energy = 0.3 + 0.7 * morale;
  const night = 1 - 0.5 * dusk; // fewer people still at it as the light goes
  const hush = state.pendingEvent ? 0.72 : 1; // the room holds its breath while an event is open
  const phase = state.phase;

  // Keyboards: saturating in head count (a big floor is a wash, not a machine gun), and softly
  // capped near KEY_RATE_CAP taps a second however big and busy the floor (each tap costs nodes).
  const rawKeys = (1.1 + 9.4 * (1 - Math.exp(-people / 14))) * (0.55 + 0.45 * energy) * night * hush;
  rates.keys = KEY_RATE_CAP * Math.tanh(rawKeys / KEY_RATE_CAP);
  gains.keys = 0.7 + 0.3 * energy;
  rates.mouse = Math.min(1.2, 0.04 * people) * (phase === "unicorn" ? 1.5 : 1) * night * hush;
  gains.mouse = 0.8;

  // Voices: nothing for a handful of people, a proper murmur for a floor of them.
  const crowd = clamp((people - 4) / 30, 0, 1) ** 0.7;
  const others = phase === "coworking" ? 0.35 : phase === "unicorn" ? 0.12 : phase === "public" ? 0.2 : 0;
  // Offices and the lobby are carpeted, quieter rooms: their own colour (HVAC, marble) carries more.
  const voices = phase === "office" || phase === "public" ? 0.7 : 1;
  layers.murmur = (others + crowd * (phase === "unicorn" ? 1 : 0.85)) * voices * night * hush * (0.8 + 0.2 * energy);

  layers.room = 1;
  layers.tension = clamp((stress - 0.55) / 0.45, 0, 1) ** 1.5 * 0.8 + (state.runwayLow ? 0.2 : 0);

  switch (phase) {
    case "garage":
      layers.fridge = 1.2;
      rates.cricket = 0.25 + 0.55 * dusk; // the insects come out as the light goes
      gains.cricket = 0.7 + 0.3 * dusk;
      rates.car = 1 / 22;
      gains.car = 1;
      break;
    case "coworking":
      layers.cafe = 1;
      rates.clink = 0.2 * night;
      gains.clink = 0.9;
      rates.steam = (1 / 25) * night;
      gains.steam = 0.9;
      break;
    case "office":
      layers.hvac = 1;
      rates.phone = (1 / 32) * night;
      gains.phone = 0.9;
      rates.chair = Math.min(0.08, 0.03 + 0.001 * people) * night;
      gains.chair = 0.8;
      break;
    case "unicorn":
      layers.hvac = 0.7;
      layers.floor = 1;
      rates.pingpong = (1 / 12) * night * hush;
      gains.pingpong = 1;
      rates.phone = (1 / 60) * night;
      gains.phone = 0.8;
      rates.chair = 0.06 * night;
      gains.chair = 0.8;
      break;
    case "public":
      layers.hvac = 0.6;
      layers.floor = 0.5;
      rates.ticker = 1 / 6;
      gains.ticker = 0.9;
      rates.step = 0.2 * night;
      gains.step = 1;
      rates.ding = (1 / 25) * night;
      gains.ding = 0.9;
      rates.phone = (1 / 80) * night;
      gains.phone = 0.7;
      break;
  }

  // Dusk takes the edge off the level; most of the quietening comes from the room emptying
  // (fewer keys, less murmur) and the tone closing down, so a tiny garage at dusk is still there.
  // A big floor gets busier, not louder: the whole bed eases back as the crowd fills in (about
  // −3 dB at full crowd), so a 60-person unicorn still sits well under a podcast and under the UI.
  const fullRoom = 1 - 0.3 * crowd;
  return { master: (1 - 0.2 * dusk) * fullRoom, warmth, layers, rates, gains, keyEnergy: energy, lobby: phase === "public" };
};

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────

/** Overall trim of the continuous layers. */
const BED_GAIN = 0.2;
/**
 * Level of each continuous layer inside the bed, calibrated in the lab. At a layer target of 1
 * (and default faders) each one alone measures about:
 *   room −44.5 · murmur −43.5 · cafe −41.5 · floor −42.5 · hvac −42 · fridge −45 · tension −48 dBFS RMS
 * The phase colours sit 3–4 dB higher against the murmur than they first did, so the five
 * offices sound like five places even when a big team's murmur fills the room — and the
 * murmur came down rather than everything going up, so a full floor stays under a podcast.
 */
const LAYER_GAIN: Record<LayerName, number> = { room: 0.61, murmur: 2.1, tension: 0.1, fridge: 0.2, cafe: 1.7, hvac: 0.57, floor: 2.2 };
/** How much of the bed goes to the reverb. */
const BED_SEND = 0.12;
/** The marble lobby is a big hard room: twice the send, and a stronger return. */
const LOBBY_BED_SEND = 0.24;
const LOBBY_RETURN = 1.4;
/** Furthest left/right any one-shot is placed (±0.6 ≈ 9 dB between the ears; keys closer in). */
const PAN_LIMIT = 0.6;
const KEY_PAN_LIMIT = 0.5;
/** Read-speed drift of every noise loop: RMS fraction and how fast it wanders (Hz). */
const LOOP_DRIFT = 0.02;
const LOOP_DRIFT_HZ = 0.09;

/** Seconds: how far ahead one-shots are scheduled, and how often the scheduler runs. */
const LOOKAHEAD = 0.6;
const TICK_MS = 200;
/** Crossfade time constants (seconds). */
const LEVEL_TAU = 1.2;
const HALT_TAU = 0.15;
const TEARDOWN_MS = 700;
/** A faded-out layer is destroyed this long after it was retired. */
const RETIRE_S = 4;

interface Layer {
  gain: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

interface Rig {
  ctx: BaseAudioContext;
  tap: BusTap;
  out: GainNode;
  warmth: BiquadFilterNode;
  send: GainNode;
  layers: Partial<Record<LayerName, Layer>>;
  retiring: Array<{ layer: Layer; at: number }>;
  lobby: Layer | null;
}

/** Collects the nodes of one layer so they can be torn down together. */
class LayerBuilder {
  readonly ctx: BaseAudioContext;
  readonly start: number;
  readonly gain: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, start: number) {
    this.ctx = ctx;
    this.start = start;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.nodes.push(this.gain);
  }

  gainNode(value: number): GainNode {
    const node = this.ctx.createGain();
    node.gain.value = value;
    this.nodes.push(node);
    return node;
  }

  filter(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = freq;
    node.Q.value = q;
    this.nodes.push(node);
    return node;
  }

  /** A stereo position; falls back to a plain gain where StereoPanner is missing. */
  pan(value: number): AudioNode {
    if (typeof this.ctx.createStereoPanner !== "function") return this.gainNode(1);
    const node = this.ctx.createStereoPanner();
    node.pan.value = value;
    this.nodes.push(node);
    return node;
  }

  /**
   * A looping read of a long noise buffer at its own speed and starting point. Unless `drift` is
   * false, the read speed wanders at random around `rate` (LOOP_DRIFT): the buffer is only
   * seconds long, and read at a fixed speed it would come round again sample-for-sample every
   * period — a repeating babble the ear does pick up over minutes.
   */
  loop(color: "pink" | "brown", seconds: number, rate: number, offset: number, drift = true): AudioBufferSourceNode {
    const buffer = noiseBuffer(this.ctx, color, seconds);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(this.start, (offset % 1) * buffer.duration);
    this.nodes.push(src);
    this.sources.push(src);
    if (drift) this.drift(src.playbackRate, LOOP_DRIFT_HZ, LOOP_DRIFT * rate, offset * 7.31 + 0.37);
    return src;
  }

  osc(type: OscillatorType, freq: number): OscillatorNode {
    const node = this.ctx.createOscillator();
    node.type = type;
    node.frequency.value = freq;
    node.start(this.start);
    this.nodes.push(node);
    this.sources.push(node);
    return node;
  }

  /**
   * Let a gain drift at random around its value — not an LFO (those repeat) but a noise loop
   * read so slowly that it becomes a control signal: brown noise is flat below ~140 Hz, so at
   * `speedHz / 140` of its speed it wanders about `speedHz` times a second, and nine seconds of
   * it last for many minutes. `depth` is the RMS of the drift.
   */
  wander(target: GainNode, speedHz: number, depth: number, offset: number): void {
    this.drift(target.gain, speedHz, depth, offset);
  }

  /** Add a slow random drift (RMS `depth`, about `speedHz` wide) to any parameter. */
  drift(param: AudioParam, speedHz: number, depth: number, offset: number): void {
    const src = this.loop("brown", 9, speedHz / 140, offset, false);
    const amount = this.gainNode(depth / NOISE_RMS);
    src.connect(amount);
    amount.connect(param);
  }

  done(): Layer {
    return { gain: this.gain, nodes: this.nodes, sources: this.sources };
  }
}

type LayerFactory = (b: LayerBuilder, rand: () => number) => void;

const LAYER_FACTORIES: Record<LayerName, LayerFactory> = {
  // Two reads of one long pink-noise loop at unrelated speeds, one each side.
  room: (b, rand) => {
    for (const [rate, pan] of [
      [1, -0.55],
      [0.871, 0.55],
    ] as const) {
      const src = b.loop("pink", 11, rate, rand());
      const low = b.filter("lowpass", 460, 0.5);
      const place = b.pan(pan);
      src.connect(low);
      low.connect(place);
      place.connect(b.gain);
      // a breath of air on top so the room exists on small speakers too
      const air = b.filter("bandpass", 2300, 0.4);
      const airLevel = b.gainNode(0.07);
      src.connect(air);
      air.connect(airLevel);
      airLevel.connect(place);
    }
  },
  // People you cannot make out: two formant bands of one noise loop, each drifting at about the
  // rate of speech, so it babbles rather than hisses.
  murmur: (b, rand) => {
    const src = b.loop("pink", 11, 1.13, rand());
    for (const [freq, q, speed, pan] of [
      [480, 1.5, 2.6, -0.4],
      [1250, 1.3, 3.7, 0.4],
    ] as const) {
      const band = b.filter("bandpass", freq, q);
      const level = b.gainNode(0.55);
      b.wander(level, speed, 0.17, rand());
      const place = b.pan(pan);
      src.connect(band);
      band.connect(level);
      level.connect(place);
      place.connect(b.gain);
    }
  },
  // D3 against E♭3 (they beat about nine times a second) under a hollow fifth: unease you feel
  // more than hear.
  tension: (b) => {
    const close = b.filter("lowpass", 420, 0.5);
    for (const [type, freq, level] of [
      ["sine", 146.83, 1],
      ["sine", 155.56, 0.6],
      ["triangle", 220, 0.3],
    ] as const) {
      const part = b.gainNode(level);
      b.osc(type, freq).connect(part);
      part.connect(close);
    }
    close.connect(b.gain);
  },
  // A tired fridge: 100 Hz and its first harmonics, cycling in and out, the motor's speed
  // sagging and recovering a few cents as it labours (a hum locked to one exact period is a
  // loop too).
  fridge: (b, rand) => {
    const hum = b.osc("sawtooth", 100);
    b.drift(hum.detune, 0.06, 7, rand());
    const close = b.filter("lowpass", 330, 0.6);
    const cycle = b.gainNode(0.65);
    b.wander(cycle, 0.08, 0.14, rand());
    hum.connect(close);
    close.connect(cycle);
    cycle.connect(b.gain);
  },
  // The coworking floor: a wash of other people's conversations and crockery.
  cafe: (b, rand) => {
    const src = b.loop("pink", 11, 0.93, rand());
    const band = b.filter("bandpass", 620, 0.6);
    const level = b.gainNode(0.7);
    b.wander(level, 0.5, 0.13, rand());
    src.connect(band);
    band.connect(level);
    level.connect(b.gain);
  },
  // Air conditioning: a low rush with a faint hiss from the vents (two reads of one loop at
  // unrelated speeds, so it never comes round again).
  hvac: (b, rand) => {
    const low = b.filter("lowpass", 300, 0.5);
    const vents = b.filter("bandpass", 1150, 0.5);
    const ventLevel = b.gainNode(0.6);
    for (const rate of [1, 0.831]) {
      const src = b.loop("brown", 9, rate, rand());
      src.connect(low);
      src.connect(vents);
    }
    low.connect(b.gain);
    vents.connect(ventLevel);
    ventLevel.connect(b.gain);
  },
  // A busy open-plan floor: mid-band activity that ebbs and flows.
  floor: (b, rand) => {
    const src = b.loop("pink", 11, 1.31, rand());
    const band = b.filter("bandpass", 1400, 0.7);
    const level = b.gainNode(0.7);
    b.wander(level, 0.6, 0.14, rand());
    const place = b.pan(0.25);
    src.connect(band);
    band.connect(level);
    level.connect(place);
    place.connect(b.gain);
  },
};

/** One-shots with no musical pitch: dusk may darken them. */
const DUSK_DULLED: ReadonlySet<SoundName> = new Set<SoundName>(["amb-key", "amb-mouse", "amb-chair", "amb-car", "amb-step", "amb-steam", "amb-cricket"]);

const destroyLayer = (layer: Layer): void => {
  for (const source of layer.sources) {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
  for (const node of layer.nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
};

export interface AmbienceDirectorOptions {
  /** Random source (seed it for offline renders and tests). Default Math.random. */
  rand?: () => number;
  /** Analysis only: render just the continuous layers, or just the one-shots. */
  only?: "bed" | "scatter";
  /** Analysis only: build just these continuous layers. */
  layers?: readonly LayerName[];
}

export class AmbienceDirector {
  private readonly engine: AudioEngine;
  private readonly rand: () => number;
  private readonly only: "bed" | "scatter" | null;
  private readonly layerFilter: readonly LayerName[] | null;

  private state: AmbienceState = DEFAULT_AMBIENCE_STATE;
  /** Silent until the first setState: a director that knows nothing about the game plays nothing. */
  private targets: AmbienceTargets = ambienceTargets({ ...DEFAULT_AMBIENCE_STATE, worldVisible: false });
  private rig: Rig | null = null;
  private horizon = 0;
  private readonly next: Record<ScatterName, number>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private fired = 0;

  constructor(engine: AudioEngine, options: AmbienceDirectorOptions = {}) {
    this.engine = engine;
    this.rand = options.rand ?? Math.random;
    this.only = options.only ?? null;
    this.layerFilter = options.layers ?? null;
    this.next = zeroScatter();
    for (const name of SCATTER_NAMES) this.next[name] = Number.POSITIVE_INFINITY;
    this.unsubscribe = engine.subscribe(this.sync);
  }

  /** Push the latest game state; the bed crossfades toward it. */
  setState(state: AmbienceState): void {
    this.state = state;
    this.targets = ambienceTargets(state);
    this.sync();
  }

  getState(): AmbienceState {
    return this.state;
  }

  getTargets(): AmbienceTargets {
    return this.targets;
  }

  /** True while the bed's nodes exist. */
  get running(): boolean {
    return this.rig !== null && this.timer !== null;
  }

  /** One-shots scheduled so far (lab / tests). */
  get oneShotCount(): number {
    return this.fired;
  }

  /**
   * Offline: build the bed at its target levels at time zero and schedule every one-shot
   * for the next `seconds`. Use with an engine created on an OfflineAudioContext.
   */
  renderOffline(seconds: number): void {
    if (this.disposed || this.targets.master <= 0) return;
    const tap = this.engine.tap("ambience");
    if (!tap) return;
    if (!this.rig) this.rig = this.build(tap);
    this.apply(true);
    if (this.only !== "bed") this.schedule(0, seconds, true);
  }

  /**
   * Stop for good. A live bed fades out (as when the view is hidden) and its nodes are freed a
   * moment later — never cut mid-waveform, which ticks; offline, it is torn down at once.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopTimer();
    if (this.rig && !this.engine.offline && this.engine.state === "running") {
      this.halt();
      return;
    }
    if (this.teardownTimer !== null) clearTimeout(this.teardownTimer);
    this.teardownTimer = null;
    this.teardown();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private readonly sync = (): void => {
    if (this.disposed || this.engine.offline) return;
    const wanted = this.engine.isAudible("ambience") && this.targets.master > 0.0005;
    if (!wanted) {
      this.halt();
      return;
    }
    const tap = this.engine.tap("ambience");
    if (!tap) return; // not unlocked yet — the engine will call back
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (!this.rig) {
      this.rig = this.build(tap);
      this.horizon = 0;
      for (const name of SCATTER_NAMES) this.next[name] = Number.POSITIVE_INFINITY;
    }
    this.apply(false);
    if (this.timer === null) this.timer = setInterval(this.tick, TICK_MS);
  };

  /** Fade out, stop scheduling, and free the nodes shortly after. */
  private halt(): void {
    this.stopTimer();
    const rig = this.rig;
    if (!rig || this.teardownTimer !== null) return;
    const now = rig.ctx.currentTime;
    try {
      rig.out.gain.setTargetAtTime(0, now, HALT_TAU);
    } catch {
      // The context may already be closed.
    }
    this.engine.stopAll("ambience", 0.2);
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      this.teardown();
    }, TEARDOWN_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private teardown(): void {
    const rig = this.rig;
    this.rig = null;
    if (!rig) return;
    if (rig.lobby) this.engine.routeSend("ambience", null);
    for (const name of LAYER_NAMES) {
      const layer = rig.layers[name];
      if (layer) destroyLayer(layer);
    }
    for (const { layer } of rig.retiring) destroyLayer(layer);
    if (rig.lobby) destroyLayer(rig.lobby);
    for (const node of [rig.out, rig.warmth, rig.send]) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  private build(tap: BusTap): Rig {
    const ctx = tap.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const warmth = ctx.createBiquadFilter();
    warmth.type = "lowpass";
    warmth.frequency.value = this.targets.warmth;
    warmth.Q.value = 0.5;
    const send = ctx.createGain();
    send.gain.value = BED_SEND;
    out.connect(warmth);
    warmth.connect(tap.dry);
    warmth.connect(send);
    send.connect(tap.wet);
    return { ctx, tap, out, warmth, send, layers: {}, retiring: [], lobby: null };
  }

  // ── chasing the targets ───────────────────────────────────────────────────

  private apply(immediate: boolean): void {
    const rig = this.rig;
    if (!rig) return;
    const ctx = rig.ctx;
    const now = ctx.currentTime;
    const targets = this.targets;
    const bedOn = this.only !== "scatter";

    const set = (param: AudioParam, value: number, tau: number): void => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, tau);
    };

    set(rig.out.gain, bedOn ? targets.master * BED_GAIN : 0, LEVEL_TAU);
    set(rig.warmth.frequency, targets.warmth, LEVEL_TAU);

    for (const name of LAYER_NAMES) {
      const level = this.layerFilter && !this.layerFilter.includes(name) ? 0 : targets.layers[name] * LAYER_GAIN[name];
      const existing = rig.layers[name];
      if (level > 0.0005) {
        let layer = existing;
        if (!layer) {
          const builder = new LayerBuilder(ctx, now);
          LAYER_FACTORIES[name](builder, this.rand);
          layer = builder.done();
          layer.gain.connect(rig.out);
          rig.layers[name] = layer;
        }
        set(layer.gain.gain, level, LEVEL_TAU);
      } else if (existing) {
        // Fade it, and let the scheduler destroy it once it is inaudible.
        existing.gain.gain.setTargetAtTime(0, now, LEVEL_TAU * 0.5);
        rig.retiring.push({ layer: existing, at: now + RETIRE_S });
        delete rig.layers[name];
      }
    }

    if (targets.lobby && !rig.lobby) {
      const builder = new LayerBuilder(ctx, now);
      const hall = ctx.createConvolver();
      hall.normalize = false;
      hall.buffer = reverbImpulse(ctx, LOBBY_REVERB);
      builder.gain.gain.value = 1;
      builder.gain.connect(hall);
      const back = builder.gainNode(LOBBY_RETURN);
      hall.connect(back);
      back.connect(rig.tap.mix);
      const lobby = builder.done();
      lobby.nodes.push(hall);
      rig.lobby = lobby;
      this.engine.routeSend("ambience", lobby.gain);
      set(rig.send.gain, LOBBY_BED_SEND, LEVEL_TAU);
    } else if (!targets.lobby && rig.lobby) {
      this.engine.routeSend("ambience", null);
      set(rig.send.gain, BED_SEND, LEVEL_TAU);
      rig.retiring.push({ layer: rig.lobby, at: now + RETIRE_S });
      rig.lobby = null;
    }
  }

  private readonly tick = (): void => {
    const rig = this.rig;
    if (!rig || this.disposed) return;
    const now = rig.ctx.currentTime;
    if (rig.retiring.length > 0) {
      rig.retiring = rig.retiring.filter((entry) => {
        if (entry.at > now) return true;
        destroyLayer(entry.layer);
        return false;
      });
    }
    // Never queue a backlog: if the clock is not running, or we fell behind, start from now.
    if (this.engine.state !== "running") return;
    const from = Math.max(this.horizon, now + 0.02);
    const to = now + LOOKAHEAD;
    if (to <= from) return;
    this.schedule(from, to, false);
    this.horizon = to;
  };

  // ── one-shots ─────────────────────────────────────────────────────────────

  private range(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  /** Exponential inter-arrival time for a Poisson process. */
  private gap(rate: number): number {
    return -Math.log(1 - this.rand() * 0.999999) / rate;
  }

  private shot(name: SoundName, at: number, options: PlayOptions): void {
    // Dusk dulls the small unpitched sounds as well as thinning them. Pitched ones (the ticker,
    // the lift, a phone, cups) stay in the game's key.
    const dull = DUSK_DULLED.has(name) ? 1 - 0.2 * clamp(this.state.dusk, 0, 1) : 1;
    const pan = options.pan === undefined ? undefined : clamp(options.pan, -PAN_LIMIT, PAN_LIMIT);
    const panTo = options.panTo === undefined ? undefined : clamp(options.panTo, -PAN_LIMIT, PAN_LIMIT);
    this.engine.play(name, { ...options, pan, panTo, at, gain: (options.gain ?? 1) * this.targets.master, pitch: (options.pitch ?? 1) * dull });
    this.fired += 1;
  }

  /** Arrivals per second of each family's *event* (a burst of keys is one event). */
  private eventRate(name: ScatterName): number {
    const rate = this.targets.rates[name];
    if (name === "keys") return rate / (2.5 + 3 * this.targets.keyEnergy);
    return rate;
  }

  private schedule(from: number, to: number, fresh: boolean): void {
    if (this.only === "bed") return;
    for (const name of SCATTER_NAMES) {
      const rate = this.eventRate(name);
      if (rate <= 0) {
        this.next[name] = Number.POSITIVE_INFINITY;
        continue;
      }
      if (!Number.isFinite(this.next[name]) || fresh) {
        // Rare things should not all wait a full mean interval before their first appearance.
        this.next[name] = from + this.gap(rate) * (rate < 0.1 ? this.range(0.2, 1) : 1);
      } else if (this.next[name] < from) {
        // We fell behind (a long frame, a stalled clock): what was due is gone — draw afresh
        // from now instead of firing the whole backlog on one sample.
        this.next[name] = from + this.gap(rate);
      }
      let guard = 0;
      while (this.next[name] < to && guard < 400) {
        this.fire(name, Math.max(from, this.next[name]));
        this.next[name] += this.gap(rate);
        guard += 1;
      }
    }
  }

  private fire(name: ScatterName, at: number): void {
    const gain = this.targets.gains[name];
    switch (name) {
      case "keys": {
        // One person at one desk typing one word or so.
        const energy = this.targets.keyEnergy;
        const taps = 2 + Math.floor(this.rand() * (2 + 6 * energy));
        const pan = this.range(-KEY_PAN_LIMIT, KEY_PAN_LIMIT);
        const near = this.range(0.35, 1);
        const pitch = this.range(0.85, 1.2);
        let t = at;
        for (let i = 0; i < taps; i += 1) {
          this.shot("amb-key", t, { pan, gain: gain * near * this.range(0.7, 1.1), pitch });
          t += this.range(0.065, 0.19 - 0.07 * energy);
        }
        break;
      }
      case "mouse":
        this.shot("amb-mouse", at, { pan: this.range(-KEY_PAN_LIMIT, KEY_PAN_LIMIT), gain: gain * this.range(0.5, 1) });
        break;
      case "chair":
        this.shot("amb-chair", at, { pan: this.range(-0.7, 0.7), gain: gain * this.range(0.6, 1) });
        break;
      case "cricket":
        this.shot("amb-cricket", at, { pan: this.range(-0.9, 0.9), gain: gain * this.range(0.4, 1) });
        break;
      case "car": {
        const side = this.rand() < 0.5 ? -1 : 1;
        this.shot("amb-car", at, { pan: -PAN_LIMIT * side, panTo: PAN_LIMIT * side, gain: gain * this.range(0.6, 1) });
        break;
      }
      case "clink":
        this.shot("amb-clink", at, { pan: this.range(-0.8, 0.8), gain: gain * this.range(0.5, 1) });
        break;
      case "steam":
        this.shot("amb-steam", at, { pan: this.range(0.3, 0.8), gain: gain * this.range(0.6, 1) });
        break;
      case "phone":
        this.shot("amb-phone", at, { pan: this.range(-0.8, 0.8), gain: gain * this.range(0.6, 1) });
        break;
      case "pingpong": {
        // A rally: paddle, table, paddle, table… then the ball gets away and bounces out.
        const pan = this.range(0.2, 0.5) * (this.rand() < 0.5 ? -1 : 1);
        const hits = 4 + Math.floor(this.rand() * 8);
        let t = at;
        for (let i = 0; i < hits; i += 1) {
          this.shot("amb-pingpong", t, { variant: i, pan: pan + (i % 2 === 0 ? -0.08 : 0.08), gain: gain * this.range(0.75, 1) });
          t += i % 2 === 0 ? this.range(0.17, 0.23) : this.range(0.15, 0.2);
        }
        let bounce = 0.19;
        for (let i = 0; i < 4; i += 1) {
          this.shot("amb-pingpong", t, { variant: 1, pan, gain: gain * 0.6 * 0.7 ** i });
          t += bounce;
          bounce *= 0.72;
        }
        break;
      }
      case "ticker":
        this.shot("amb-ticker", at, { pan: this.range(0.3, 0.7), gain: gain * this.range(0.6, 1) });
        break;
      case "step": {
        // Someone crossing the lobby.
        const steps = 3 + Math.floor(this.rand() * 4);
        const from = this.range(-0.8, 0.8);
        const drift = this.range(-0.12, 0.12);
        const pace = this.range(0.46, 0.58);
        const level = gain * this.range(0.5, 1);
        for (let i = 0; i < steps; i += 1) {
          this.shot("amb-step", at + i * pace, { pan: clamp(from + drift * i, -0.9, 0.9), gain: level * this.range(0.85, 1.1), pitch: i % 2 === 0 ? 1 : 0.92 });
        }
        break;
      }
      case "ding":
        this.shot("amb-ding", at, { pan: this.range(-0.6, -0.2), gain: gain * this.range(0.7, 1) });
        break;
    }
  }
}
