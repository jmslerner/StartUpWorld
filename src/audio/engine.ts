/**
 * AudioEngine — the one AudioContext for the whole app, and the mix.
 *
 *   voice ─► bus fader (ui | outcome | world | ambience | music) ─┐
 *   voice ─► bus send ─► shared room reverb ──────────────────────┤
 *                                                                 ▼
 *                          master fader ─► DC block ─► warmth shelf ─► limiter ─► trim ─► out
 *
 * Lifecycle
 *   • Nothing is created at import. The context is created lazily, and only inside an input
 *     the browser counts as a user activation (autoplay policy): a click, a tap's touchend, a
 *     key that is not Esc or a bare modifier. Shift, Esc, Cmd and the pointerdown of a touch do
 *     NOT count, so they never create a context Chrome would refuse ("The AudioContext was not
 *     allowed to start"). Until then `play()` quietly does nothing.
 *   • Every qualifying gesture asks the context to resume again while it is not running, even if
 *     an earlier resume() is still pending: a blocked resume() never settles on its own, and
 *     only a later call made inside a real activation starts the clock.
 *   • Tab hidden or audio muted → voices stop, the context is suspended; it resumes cleanly.
 *   • Voice manager: per-bus polyphony caps (oldest voice is stolen with a short fade), a
 *     per-sound minimum retrigger interval, small random pitch/level variation per play, and
 *     every node is stopped + disconnected when its voice ends.
 *
 * The same class renders offline: pass `offlineContext` and it schedules onto that context
 * with no timers or listeners (this is how the audio lab measures every sound).
 */
import { BUS_NAMES, audioSettings, type AudioSettingsStore, type BusName } from "./settings";
import { SOUNDS, isSoundName, type PlayOptions, type SoundDef, type SoundName } from "./sounds";
import { ROOM_REVERB, Synth, clamp, dbToGain, gainToDb, mulberry32, reverbImpulse } from "./synth";

// ─────────────────────────────────────────────────────────────────────────────
// Mix constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum simultaneous voices per bus; the oldest is stolen when a bus is full. */
export const BUS_VOICE_CAP: Readonly<Record<BusName, number>> = { ui: 4, outcome: 6, world: 12, ambience: 16, music: 6 };

/**
 * The safety limiter. Single sounds peak at −9 dBFS or below and never reach the threshold;
 * it only works when many things pile up or the faders are pushed to the top.
 */
export const LIMITER = { threshold: -8, knee: 5, ratio: 12, attack: 0.003, release: 0.12 } as const;

/** Return level of the shared reverb. */
const REVERB_RETURN = 0.8;
/** Scheduling safety margin for "play now". */
const SCHEDULE_AHEAD = 0.004;
/** Fade applied to a stolen voice. */
const STEAL_FADE = 0.012;
/** How often finished voices are swept up (ms). */
const SWEEP_MS = 250;
/** Grace period between going silent (hidden / muted) and suspending the context (ms). */
const SUSPEND_DELAY_MS = 400;
/** Time constant for fader moves (s). */
const FADER_TAU = 0.025;
/**
 * How long after asking for resume() sounds may still be scheduled onto a context that has not
 * started yet (ms). Long enough for a granted resume to land; short enough that a refused one
 * does not quietly pile sounds up for a burst when the clock finally starts.
 */
const RESUME_GRACE_MS = 400;

/**
 * The gain a DynamicsCompressorNode adds to quiet signals for a given static curve.
 * All three browser engines share the same kernel (WebKit's): it auto-applies a "makeup gain"
 * of (1 / saturate(1))^0.6. We undo exactly that after the limiter so 0 dB in = 0 dB out below
 * the threshold, and a full-scale pile-up still tops out near −4 dBFS.
 */
export const limiterMakeupGain = (thresholdDb: number, kneeDb: number, ratio: number): number => {
  const threshold = dbToGain(thresholdDb);
  const kneeCurve = (x: number, k: number): number => (x < threshold ? x : threshold + (1 - Math.exp(-k * (x - threshold))) / k);
  const slopeAt = (x: number, k: number): number => {
    if (x < threshold) return 1;
    const x2 = x * 1.001;
    return (gainToDb(kneeCurve(x2, k)) - gainToDb(kneeCurve(x, k))) / (gainToDb(x2) - gainToDb(x));
  };
  const kneeEndDb = thresholdDb + kneeDb;
  const kneeEnd = dbToGain(kneeEndDb);
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i += 1) {
    if (slopeAt(kneeEnd, k) < 1 / ratio) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const fullScale = kneeEnd > 1 ? kneeCurve(1, k) : dbToGain(gainToDb(kneeCurve(kneeEnd, k)) + (0 - kneeEndDb) / ratio);
  return (1 / fullScale) ** 0.6;
};

// ─────────────────────────────────────────────────────────────────────────────
// Environment (injectable for tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListenerTarget {
  addEventListener(type: string, listener: (event?: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event?: Event) => void, options?: boolean | EventListenerOptions): void;
}

export interface EngineEnv {
  /** Receives pointerdown / keydown / touchend for the autoplay unlock (normally `window`). */
  gestures: ListenerTarget | null;
  /** Receives `visibilitychange`; its `visibilityState` is read (normally `document`). */
  doc: (ListenerTarget & { readonly visibilityState?: string }) | null;
  /** `navigator.userActivation.hasBeenActive`; `undefined` where the API does not exist. */
  userActivated(): boolean | undefined;
  /** `navigator.userActivation.isActive` (a transient activation right now); `undefined` where missing. */
  userActive(): boolean | undefined;
  /** `new AudioContext()` with the `webkitAudioContext` fallback; null when unsupported. May throw. */
  createContext(): BaseAudioContext | null;
}

/**
 * Inputs that can carry a user activation (HTML "activation-triggering input events"): keydown
 * (not Esc, not a bare modifier), mousedown / a mouse pointerdown, a touch or pen pointerup,
 * touchend, click.
 */
const GESTURE_EVENTS = ["pointerdown", "pointerup", "keydown", "touchend", "click"] as const;

/** Keys whose keydown never activates the page. */
const NON_ACTIVATING_KEYS = new Set([
  "Escape",
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "NumLock",
  "ScrollLock",
  "Symbol",
  "SymbolLock",
]);

type GestureEvent = Partial<Pick<KeyboardEvent, "key">> & Partial<Pick<PointerEvent, "pointerType">> & { readonly type?: string };

/**
 * Would the browser count this input as a user activation? Used only where
 * `navigator.userActivation.isActive` cannot answer for itself.
 */
export const isActivatingInput = (event: GestureEvent | undefined): boolean => {
  if (!event?.type) return true;
  switch (event.type) {
    case "keydown":
      return event.key === undefined || !NON_ACTIVATING_KEYS.has(event.key);
    case "pointerdown":
      return event.pointerType === undefined || event.pointerType === "" || event.pointerType === "mouse";
    case "pointerup":
      return event.pointerType !== undefined && event.pointerType !== "" && event.pointerType !== "mouse";
    default:
      return true;
  }
};

const browserEnv = (): EngineEnv => {
  const hasWindow = typeof window !== "undefined";
  return {
    gestures: hasWindow ? window : null,
    doc: typeof document !== "undefined" ? document : null,
    userActivated: () => {
      try {
        if (typeof navigator === "undefined") return undefined;
        return (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
      } catch {
        return undefined;
      }
    },
    userActive: () => {
      try {
        if (typeof navigator === "undefined") return undefined;
        return (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
      } catch {
        return undefined;
      }
    },
    createContext: () => {
      if (!hasWindow) return null;
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      return Ctor ? new Ctor({ latencyHint: "interactive" }) : null;
    },
  };
};

export interface AudioEngineOptions {
  /** Defaults to the shared, persisted `audioSettings`. */
  settings?: AudioSettingsStore;
  /** Override parts of the browser environment (tests). */
  env?: Partial<EngineEnv>;
  /** Render into this context instead of a live one: no unlock, no timers, no listeners. */
  offlineContext?: BaseAudioContext;
  /** Seed the engine's random variation (offline renders, tests). Default: Math.random. */
  seed?: number;
}

export type EngineState = "idle" | "running" | "suspended" | "unavailable" | "closed";

/** Where long-lived layers (ambience, music) plug in. */
export interface BusTap {
  readonly ctx: BaseAudioContext;
  /** Dry input of the bus (follows the bus fader). */
  readonly dry: AudioNode;
  /** Reverb send input of the bus (follows the bus fader). */
  readonly wet: AudioNode;
  /** The master mix input — for effect returns whose signal has already been through a bus fader. */
  readonly mix: AudioNode;
}

export interface VoiceHandle {
  readonly name: SoundName;
  /** Context time the sound starts at. */
  readonly start: number;
  /** Context time by which everything in it has stopped. */
  readonly end: number;
  /** Fade out and free the voice early. */
  stop(fade?: number): void;
}

interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  trim: GainNode;
  reverbIn: GainNode;
  busDry: Record<BusName, GainNode>;
  busWet: Record<BusName, GainNode>;
  /** Everything above plus the fixed filters, for teardown. */
  all: AudioNode[];
}

interface Voice {
  name: SoundName;
  bus: BusName;
  start: number;
  end: number;
  level: number;
  out: GainNode;
  wet: GainNode;
  panner: StereoPannerNode | null;
  synth: Synth;
  freed: boolean;
  /** The fade-out in progress, if any (so a second, shorter fade starts from where it is). */
  fade: { from: number; at: number; until: number } | null;
}

type ContextWithLifecycle = BaseAudioContext & {
  resume?: () => Promise<void>;
  suspend?: () => Promise<void>;
  close?: () => Promise<void>;
};

const noop = (): void => {};

/** Level of a linear fade to zero at time `t`. */
const fadeLevel = (fade: { from: number; at: number; until: number }, t: number): number => {
  if (t <= fade.at) return fade.from;
  if (t >= fade.until) return 0;
  return fade.from * (1 - (t - fade.at) / (fade.until - fade.at));
};

const quietly = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Web Audio teardown is best-effort: a node may already be gone.
  }
};

export class AudioEngine {
  readonly settings: AudioSettingsStore;
  /** True when rendering into an OfflineAudioContext (no timers, no listeners). */
  readonly offline: boolean;

  private readonly env: EngineEnv;
  private readonly offlineContext: BaseAudioContext | null;
  private readonly rand: () => number;

  private graph: Graph | null = null;
  private voices: Voice[] = [];
  private readonly lastStart = new Map<SoundName, number>();
  private readonly listeners = new Set<() => void>();
  private readonly sendOverride = new Map<BusName, AudioNode>();

  private unavailable = false;
  private disposed = false;
  private visible = true;
  private gestureSeen = false;
  private resumePending = false;
  private resumesInFlight = 0;
  private resumeAskedAt = 0;
  private unlockInstalled = false;
  private lastError: unknown = null;

  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private offSettings: (() => void) | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.settings = options.settings ?? audioSettings;
    this.offlineContext = options.offlineContext ?? null;
    this.offline = this.offlineContext !== null;
    this.rand = options.seed === undefined ? Math.random : mulberry32(options.seed);
    this.env = { ...browserEnv(), ...options.env };
    if (this.offline) return;

    this.visible = this.env.doc?.visibilityState !== "hidden";
    this.env.doc?.addEventListener("visibilitychange", this.onVisibility);
    this.installUnlock();
    this.offSettings = this.settings.subscribe(this.onSettings);
  }

  // ── public: state ─────────────────────────────────────────────────────────

  get state(): EngineState {
    if (this.disposed) return "closed";
    if (this.unavailable) return "unavailable";
    if (!this.graph) return "idle";
    if (this.offline) return "running";
    return this.graph.ctx.state === "running" ? "running" : "suspended";
  }

  /** The context, once it exists. Never creates it. */
  get context(): BaseAudioContext | null {
    return this.graph?.ctx ?? null;
  }

  /** Context time in seconds (0 before the context exists). */
  now(): number {
    return this.graph?.ctx.currentTime ?? 0;
  }

  /**
   * True when sound on `bus` (or at all) is wanted right now: not disposed, tab visible, not
   * muted, fader up. Says nothing about whether the browser has let the context start yet.
   */
  isAudible(bus?: BusName): boolean {
    if (this.disposed || this.unavailable || !this.visible) return false;
    if (this.settings.isSilenced()) return false;
    return bus === undefined || this.settings.busGain(bus) > 0;
  }

  /** Called whenever audibility may have changed: unlock, context state, visibility, settings. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Voices alive right now — sounding or scheduled — optionally on one bus. With `soundingOnly`,
   * only those audible at this instant (started, not yet faded out): the number the per-bus cap
   * actually limits.
   */
  voiceCount(bus?: BusName, soundingOnly = false): number {
    const now = this.now();
    return this.voices.filter((v) => !v.freed && (bus === undefined || v.bus === bus) && (!soundingOnly || (v.start <= now && v.end > now))).length;
  }

  /** The last exception a recipe or the browser threw (swallowed; exposed for the lab and tests). */
  get error(): unknown {
    return this.lastError;
  }

  /** The final node before the speakers — tap it for meters. Null until the context exists. */
  get output(): AudioNode | null {
    return this.graph?.trim ?? null;
  }

  // ── public: playing ───────────────────────────────────────────────────────

  /**
   * Call from a user-gesture handler to start audio immediately. Optional: the engine also
   * listens for the first pointerdown / keydown / touchend on its own.
   */
  unlock(): void {
    if (this.offline || this.disposed) return;
    this.onGesture({ type: "click" });
  }

  /** Play a library sound. Never throws; returns null when nothing was scheduled. */
  play(name: SoundName, options: PlayOptions = {}): VoiceHandle | null {
    if (this.disposed || !isSoundName(name)) return null;
    const def: SoundDef = SOUNDS[name];
    let voice: Voice | null = null;
    try {
      if (!this.isAudible(def.bus)) return null;
      const graph = this.ensure("active");
      if (!graph || !this.canSchedule(graph.ctx)) return null;
      const ctx = graph.ctx;
      const now = ctx.currentTime;
      const delay = options.delay !== undefined && Number.isFinite(options.delay) ? Math.max(0, options.delay) : 0;
      const start =
        options.at !== undefined && Number.isFinite(options.at) ? Math.max(now, options.at) : now + (this.offline ? 0 : SCHEDULE_AHEAD) + delay;

      const last = this.lastStart.get(name);
      if (last !== undefined && Math.abs(start - last) < def.minInterval) return null;
      this.lastStart.set(name, start);

      this.makeRoom(def.bus, start);
      voice = this.spawn(graph, name, def, options, start);
      def.render(voice.synth, options);
      voice.end = Math.max(voice.synth.end, start + 0.02);
      if (voice.panner && options.panTo !== undefined) {
        voice.panner.pan.linearRampToValueAtTime(clamp(options.panTo, -1, 1), voice.end);
      }
      this.voices.push(voice);
      this.startSweeping();
      const live = voice;
      return {
        name,
        start,
        end: live.end,
        stop: (fade = 0.03) => this.release(live, this.now(), fade),
      };
    } catch (error) {
      this.lastError = error;
      if (voice) this.free(voice);
      return null;
    }
  }

  /** Fade out and free every voice (optionally only one bus). */
  stopAll(bus?: BusName, fade = 0.03): void {
    const now = this.now();
    for (const voice of this.voices) {
      if (bus === undefined || voice.bus === bus) this.release(voice, now, fade);
    }
    this.sweep();
  }

  // ── public: long-lived layers ─────────────────────────────────────────────

  /**
   * Inputs of a bus for long-lived nodes (ambience bed, music). Returns null until the page has
   * been interacted with — subscribe() and ask again.
   */
  tap(bus: BusName): BusTap | null {
    if (this.disposed) return null;
    const graph = this.ensure("passive");
    if (!graph) return null;
    return { ctx: graph.ctx, dry: graph.busDry[bus], wet: graph.busWet[bus], mix: graph.master };
  }

  /**
   * Send a bus's reverb sends somewhere other than the shared room (the ambience director uses
   * this for the marble-lobby reverb). Pass null to restore the shared room.
   */
  routeSend(bus: BusName, destination: AudioNode | null): void {
    if (destination) this.sendOverride.set(bus, destination);
    else this.sendOverride.delete(bus);
    const graph = this.graph;
    if (!graph) return;
    quietly(() => graph.busWet[bus].disconnect());
    quietly(() => graph.busWet[bus].connect(destination ?? graph.reverbIn));
  }

  // ── public: teardown ──────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeUnlock();
    this.env.doc?.removeEventListener("visibilitychange", this.onVisibility);
    this.offSettings?.();
    this.offSettings = null;
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    for (const voice of this.voices) this.free(voice);
    this.voices = [];
    const graph = this.graph;
    this.graph = null;
    if (graph) {
      quietly(() => graph.ctx.removeEventListener("statechange", this.onStateChange));
      for (const node of graph.all) quietly(() => node.disconnect());
      if (!this.offline) {
        const ctx = graph.ctx as ContextWithLifecycle;
        quietly(() => {
          ctx.close?.().catch(noop);
        });
      }
    }
    this.emit();
    this.listeners.clear();
  }

  // ── context + graph ───────────────────────────────────────────────────────

  /**
   * Get (or create) the graph.
   *   gesture — we are inside a user gesture: always allowed.
   *   active  — a sound was asked for: allowed once the page has been activated (a qualifying
   *             gesture reached our listeners, or the browser says so).
   *   passive — ambience / music warming up: the same rule.
   * Where the browser cannot tell us (no userActivation API) only our own gesture listener
   * counts — never a timer (the heartbeat, a scheduler) firing before the player has touched
   * anything.
   */
  private ensure(mode: "gesture" | "active" | "passive"): Graph | null {
    if (this.graph) return this.graph;
    if (this.disposed || this.unavailable) return null;
    if (this.offlineContext) {
      this.graph = this.build(this.offlineContext);
      return this.graph;
    }
    const activated = this.env.userActivated();
    const allowed = mode === "gesture" || this.gestureSeen || activated === true;
    if (!allowed) return null;

    let ctx: BaseAudioContext | null = null;
    try {
      ctx = this.env.createContext();
    } catch (error) {
      this.lastError = error;
    }
    if (!ctx) {
      this.markUnavailable();
      return null;
    }
    const created: ContextWithLifecycle = ctx;
    try {
      this.graph = this.build(created);
    } catch (error) {
      this.lastError = error;
      quietly(() => {
        created.close?.().catch(noop);
      });
      this.markUnavailable();
      return null;
    }
    quietly(() => created.addEventListener("statechange", this.onStateChange));
    this.resume();
    this.emit();
    return this.graph;
  }

  private markUnavailable(): void {
    this.unavailable = true;
    this.removeUnlock();
    this.emit();
  }

  private build(ctx: BaseAudioContext): Graph {
    const all: AudioNode[] = [];
    const keep = <T extends AudioNode>(node: T): T => {
      all.push(node);
      return node;
    };

    const master = keep(ctx.createGain());
    master.gain.value = this.settings.masterGain();

    // Removes any DC a recipe leaves behind (asymmetric waves, very slow sweeps).
    const dcBlock = keep(ctx.createBiquadFilter());
    dcBlock.type = "highpass";
    dcBlock.frequency.value = 28;
    dcBlock.Q.value = 0.707;

    // A gentle tilt: nothing in this game needs air above 6.5 kHz.
    const warmth = keep(ctx.createBiquadFilter());
    warmth.type = "highshelf";
    warmth.frequency.value = 6500;
    warmth.gain.value = -3;

    const limiter = keep(ctx.createDynamicsCompressor());
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;

    const trim = keep(ctx.createGain());
    trim.gain.value = 1 / limiterMakeupGain(LIMITER.threshold, LIMITER.knee, LIMITER.ratio);

    master.connect(dcBlock);
    dcBlock.connect(warmth);
    warmth.connect(limiter);
    limiter.connect(trim);
    trim.connect(ctx.destination);

    const reverbIn = keep(ctx.createGain());
    const reverb = keep(ctx.createConvolver());
    reverb.normalize = false;
    reverb.buffer = reverbImpulse(ctx, ROOM_REVERB);
    const reverbOut = keep(ctx.createGain());
    reverbOut.gain.value = REVERB_RETURN;
    reverbIn.connect(reverb);
    reverb.connect(reverbOut);
    reverbOut.connect(master);

    const busDry = {} as Record<BusName, GainNode>;
    const busWet = {} as Record<BusName, GainNode>;
    for (const bus of BUS_NAMES) {
      const gain = this.settings.busGain(bus);
      const dry = keep(ctx.createGain());
      dry.gain.value = gain;
      dry.connect(master);
      const wet = keep(ctx.createGain());
      wet.gain.value = gain;
      wet.connect(this.sendOverride.get(bus) ?? reverbIn);
      busDry[bus] = dry;
      busWet[bus] = wet;
    }
    return { ctx, master, limiter, trim, reverbIn, busDry, busWet, all };
  }

  private applyFaders(): void {
    const graph = this.graph;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    quietly(() => graph.master.gain.setTargetAtTime(this.settings.masterGain(), now, FADER_TAU));
    for (const bus of BUS_NAMES) {
      const gain = this.settings.busGain(bus);
      quietly(() => graph.busDry[bus].gain.setTargetAtTime(gain, now, FADER_TAU));
      quietly(() => graph.busWet[bus].gain.setTargetAtTime(gain, now, FADER_TAU));
    }
  }

  /**
   * A sound may be scheduled when the clock is running, or about to: a resume() asked for a
   * moment ago that has not landed yet. A resume() that has been pending for longer is one the
   * browser refused (it never settles by itself); sounds are dropped rather than queued onto a
   * frozen clock to burst out together later.
   */
  private canSchedule(ctx: BaseAudioContext): boolean {
    if (this.offline || ctx.state === "running") return true;
    return this.resumePending && Date.now() - this.resumeAskedAt < RESUME_GRACE_MS;
  }

  /**
   * Ask the context to run. `force` (a real user activation) asks again even while an earlier
   * request is pending — that earlier one may have been made without an activation and will
   * never settle; browsers resolve every pending resume() once the clock starts.
   */
  private resume(force = false): void {
    const ctx = this.graph?.ctx as ContextWithLifecycle | undefined;
    if (!ctx || this.offline || typeof ctx.resume !== "function") return;
    if (ctx.state === "running" || ctx.state === "closed") return;
    if (!this.visible || this.settings.isSilenced()) return;
    if (this.resumePending && !force) return;
    this.resumePending = true;
    this.resumesInFlight += 1;
    this.resumeAskedAt = Date.now();
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      this.resumesInFlight = Math.max(0, this.resumesInFlight - 1);
      if (this.resumesInFlight === 0) this.resumePending = false;
      this.afterStateChange();
    };
    try {
      ctx.resume().then(settle, settle);
    } catch (error) {
      this.lastError = error;
      settle();
    }
  }

  /** Stop paying for audio nobody can hear: suspend shortly after going hidden or muted. */
  private scheduleSuspend(): void {
    if (this.offline || this.suspendTimer !== null) return;
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      const ctx = this.graph?.ctx as ContextWithLifecycle | undefined;
      if (!ctx || typeof ctx.suspend !== "function" || ctx.state !== "running") return;
      if (this.visible && !this.settings.isSilenced()) return;
      try {
        ctx.suspend().catch(noop);
      } catch (error) {
        this.lastError = error;
      }
    }, SUSPEND_DELAY_MS);
  }

  private cancelSuspend(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }

  private afterStateChange(): void {
    if (this.disposed) return;
    const state = this.graph?.ctx.state;
    if (state === "running") {
      // Every request is answered once the clock runs (browsers resolve them all together).
      this.resumePending = false;
      this.resumesInFlight = 0;
      this.removeUnlock();
    }
    else if (state !== undefined && state !== "closed" && this.visible && !this.settings.isSilenced()) this.installUnlock();
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.lastError = error;
      }
    }
  }

  // ── listeners ─────────────────────────────────────────────────────────────

  private installUnlock(): void {
    const target = this.env.gestures;
    if (!target || this.unlockInstalled || this.disposed || this.unavailable) return;
    this.unlockInstalled = true;
    for (const type of GESTURE_EVENTS) target.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  private removeUnlock(): void {
    const target = this.env.gestures;
    if (!target || !this.unlockInstalled) return;
    this.unlockInstalled = false;
    for (const type of GESTURE_EVENTS) target.removeEventListener(type, this.onGesture, { capture: true });
  }

  /** Is this input a user activation, by the browser's own account where it can tell us? */
  private activates(event: GestureEvent | undefined): boolean {
    let active: boolean | undefined;
    try {
      active = this.env.userActive();
    } catch {
      active = undefined;
    }
    return active ?? isActivatingInput(event);
  }

  private readonly onGesture = (event?: GestureEvent): void => {
    if (this.disposed) return;
    // Shift, Esc, Cmd, a touch's pointerdown: the browser would refuse to start audio here, and
    // creating the context now would only earn a console warning and a stuck resume().
    if (!this.activates(event)) return;
    this.gestureSeen = true;
    // While muted or hidden there is no reason to wake the audio hardware.
    if (!this.isAudible()) return;
    const fresh = this.graph === null;
    this.ensure("gesture"); // a context created here has already been asked to run
    if (!fresh) this.resume(true);
    if (this.graph?.ctx.state === "running") this.removeUnlock();
  };

  private readonly onStateChange = (): void => {
    if (this.disposed) return;
    // Suspended (or interrupted, Safari) behind our back while sound is wanted — e.g. a suspend()
    // for a hidden tab that landed after the tab came back: ask to run again. (No loop: a
    // refused resume() changes no state, so it fires no further statechange.)
    const state = this.graph?.ctx.state as string | undefined;
    if ((state === "suspended" || state === "interrupted") && this.visible && !this.settings.isSilenced()) this.resume();
    this.afterStateChange();
  };

  private readonly onVisibility = (): void => {
    const visible = this.env.doc?.visibilityState !== "hidden";
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) {
      this.cancelSuspend();
      // Ask afresh even if an older request is still pending (it may never settle).
      this.resume(true);
    } else {
      this.stopAll(undefined, 0.05);
      this.scheduleSuspend();
    }
    this.emit();
  };

  private readonly onSettings = (): void => {
    this.applyFaders();
    if (this.settings.isSilenced()) {
      this.stopAll(undefined, 0.05);
      this.scheduleSuspend();
    } else {
      this.cancelSuspend();
      // Un-muting is usually a click (a user activation): ask afresh, even past a stale request.
      if (this.gestureSeen || this.graph) this.resume(true);
    }
    this.emit();
  };

  // ── voices ────────────────────────────────────────────────────────────────

  private spawn(graph: Graph, name: SoundName, def: SoundDef, options: PlayOptions, start: number): Voice {
    const ctx = graph.ctx;
    const rand = options.seed === undefined ? this.rand : mulberry32(options.seed);
    const cents = (rand() * 2 - 1) * def.cents;
    const level = def.gain * dbToGain((rand() * 2 - 1) * def.db) * clamp(options.gain ?? 1, 0, 4);
    const pitch = 2 ** (cents / 1200) * clamp(options.pitch ?? 1, 0.25, 4);

    const out = ctx.createGain();
    out.gain.value = level;
    const wet = ctx.createGain();
    wet.gain.value = level;
    let panner: StereoPannerNode | null = null;
    if ((options.pan !== undefined || options.panTo !== undefined) && typeof ctx.createStereoPanner === "function") {
      panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(options.pan ?? 0, -1, 1), start);
      out.connect(panner);
      panner.connect(graph.busDry[def.bus]);
    } else {
      out.connect(graph.busDry[def.bus]);
    }
    wet.connect(graph.busWet[def.bus]);

    const synth = new Synth({ ctx, dry: out, wet, t0: start, rand, pitch });
    return { name, bus: def.bus, start, end: start, level, out, wet, panner, synth, freed: false, fade: null };
  }

  /** Enforce the bus's polyphony cap at time `start` by stealing the oldest voices. */
  private makeRoom(bus: BusName, start: number): void {
    const cap = BUS_VOICE_CAP[bus];
    const sounding = this.voices.filter((v) => v.bus === bus && !v.freed && v.start <= start && v.end > start);
    if (sounding.length < cap) return;
    sounding.sort((a, b) => a.start - b.start);
    for (let i = 0; i <= sounding.length - cap; i += 1) this.release(sounding[i], start, STEAL_FADE);
  }

  /** Fade a voice to silence at `at` and let the sweeper free it. */
  private release(voice: Voice, at: number, fade: number): void {
    if (voice.freed) return;
    const begin = Math.max(at, this.now());
    if (voice.start >= begin) {
      // Not started yet: nothing to fade.
      this.free(voice);
      return;
    }
    const until = begin + Math.max(0.005, fade);
    if (until >= voice.end) return;
    // Start from where the gain is now: if a longer fade is already under way, cancelling it
    // would otherwise snap the voice back up to full level for an instant.
    const current = voice.fade ? fadeLevel(voice.fade, begin) : voice.level;
    for (const node of [voice.out, voice.wet]) {
      quietly(() => {
        node.gain.cancelScheduledValues(begin);
        node.gain.setValueAtTime(current, begin);
        node.gain.linearRampToValueAtTime(0, until);
      });
    }
    voice.fade = { from: current, at: begin, until };
    voice.end = until;
  }

  private free(voice: Voice): void {
    if (voice.freed) return;
    voice.freed = true;
    voice.synth.dispose();
    quietly(() => voice.out.disconnect());
    quietly(() => voice.wet.disconnect());
    if (voice.panner) {
      const panner = voice.panner;
      quietly(() => panner.disconnect());
    }
  }

  private startSweeping(): void {
    if (this.offline || this.sweepTimer !== null) return;
    this.sweepTimer = setInterval(this.sweep, SWEEP_MS);
  }

  private readonly sweep = (): void => {
    const now = this.now();
    const alive: Voice[] = [];
    for (const voice of this.voices) {
      if (voice.freed) continue;
      if (voice.end + 0.05 <= now) this.free(voice);
      else alive.push(voice);
    }
    this.voices = alive;
    if (alive.length === 0 && this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The shared engine
// ─────────────────────────────────────────────────────────────────────────────

let shared: AudioEngine | null = null;

/** The app-wide engine (created on first call; safe in node, where it simply stays silent). */
export const getAudioEngine = (): AudioEngine => {
  if (!shared || shared.state === "closed") shared = new AudioEngine();
  return shared;
};

/** Replace the shared engine (tests, the lab). Pass null to forget it. */
export const setSharedAudioEngine = (engine: AudioEngine | null): void => {
  shared = engine;
};

// Dev only: when this module is hot-replaced, close the old context instead of leaking it
// (browsers allow only a handful of AudioContexts per page).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shared?.dispose();
    shared = null;
  });
}

/** Play a library sound on the shared engine. Never throws. */
export const playSound = (name: SoundName, options?: PlayOptions): VoiceHandle | null => {
  try {
    return getAudioEngine().play(name, options);
  } catch {
    return null;
  }
};
