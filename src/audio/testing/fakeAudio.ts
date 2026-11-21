/**
 * A small fake Web Audio API for node tests. It makes no sound; it records which nodes were
 * created, how they were connected and what was scheduled — and it is as strict as a browser
 * about bad arguments (NaN, negative times, exponential ramps to zero, starting twice), so a
 * recipe that would throw in Chrome throws here too.
 */
import { AudioEngine, type AudioEngineOptions, type ListenerTarget } from "../engine";
import { createAudioSettingsStore, type AudioSettingsStore, type StorageLike } from "../settings";

export interface ParamEvent {
  type: "value" | "set" | "linear" | "exp" | "target" | "cancel";
  value: number;
  time: number;
}

const finite = (value: number, what: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${what} must be a finite number, got ${String(value)}`);
};

const validTime = (time: number, what: string): void => {
  finite(time, what);
  if (time < 0) throw new RangeError(`${what} must not be negative, got ${time}`);
};

export class FakeParam {
  readonly events: ParamEvent[] = [];
  /** Nodes modulating this parameter. */
  readonly inputs: FakeNode[] = [];
  readonly label: string;
  private current: number;
  private readonly ctx: FakeAudioContext;

  constructor(ctx: FakeAudioContext, label: string, defaultValue: number) {
    this.ctx = ctx;
    this.label = label;
    this.current = defaultValue;
  }

  get value(): number {
    return this.current;
  }

  set value(next: number) {
    finite(next, `${this.label}.value`);
    this.current = next;
    this.events.push({ type: "value", value: next, time: this.ctx.currentTime });
  }

  setValueAtTime(value: number, time: number): this {
    finite(value, `${this.label}.setValueAtTime value`);
    validTime(time, `${this.label}.setValueAtTime time`);
    this.events.push({ type: "set", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    finite(value, `${this.label}.linearRampToValueAtTime value`);
    validTime(time, `${this.label}.linearRampToValueAtTime time`);
    this.events.push({ type: "linear", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    finite(value, `${this.label}.exponentialRampToValueAtTime value`);
    validTime(time, `${this.label}.exponentialRampToValueAtTime time`);
    if (value === 0) throw new RangeError(`${this.label}: an exponential ramp cannot end at 0`);
    this.events.push({ type: "exp", value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    finite(value, `${this.label}.setTargetAtTime value`);
    validTime(time, `${this.label}.setTargetAtTime time`);
    finite(timeConstant, `${this.label}.setTargetAtTime timeConstant`);
    if (timeConstant < 0) throw new RangeError(`${this.label}: timeConstant must not be negative`);
    this.events.push({ type: "target", value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    validTime(time, `${this.label}.cancelScheduledValues time`);
    this.events.push({ type: "cancel", value: 0, time });
    return this;
  }

  /** The value most recently asked for (by any means). */
  get last(): number {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (this.events[i].type !== "cancel") return this.events[i].value;
    }
    return this.current;
  }
}

export type FakeNodeKind =
  | "destination"
  | "gain"
  | "oscillator"
  | "bufferSource"
  | "biquad"
  | "stereoPanner"
  | "convolver"
  | "compressor";

export class FakeNode {
  readonly kind: FakeNodeKind;
  readonly context: FakeAudioContext;
  readonly outputs: Array<FakeNode | FakeParam> = [];
  /** Every node or param this node was ever connected to (survives disconnect). */
  readonly everConnected: Array<FakeNode | FakeParam> = [];
  disconnects = 0;

  constructor(context: FakeAudioContext, kind: FakeNodeKind) {
    this.context = context;
    this.kind = kind;
    context.nodes.push(this);
  }

  connect<T extends FakeNode | FakeParam>(destination: T): T {
    if (!(destination instanceof FakeNode) && !(destination instanceof FakeParam)) throw new TypeError("connect(): not an AudioNode or AudioParam");
    this.outputs.push(destination);
    this.everConnected.push(destination);
    if (destination instanceof FakeParam) destination.inputs.push(this);
    return destination;
  }

  disconnect(destination?: FakeNode | FakeParam): void {
    this.disconnects += 1;
    if (destination === undefined) {
      this.outputs.length = 0;
      return;
    }
    const index = this.outputs.indexOf(destination);
    if (index < 0) throw new Error("disconnect(): not connected to that destination");
    this.outputs.splice(index, 1);
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(context: FakeAudioContext) {
    super(context, "gain");
    this.gain = new FakeParam(context, "gain", 1);
  }
}

class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  startOffset: number | null = null;

  start(when = 0, offset?: number): void {
    validTime(when, "start time");
    if (this.startedAt !== null) throw new Error("InvalidStateError: cannot call start more than once");
    if (offset !== undefined) validTime(offset, "start offset");
    this.startedAt = when;
    this.startOffset = offset ?? null;
  }

  stop(when = 0): void {
    validTime(when, "stop time");
    if (this.startedAt === null) throw new Error("InvalidStateError: cannot call stop without calling start first");
    this.stoppedAt = when;
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = "sine";
  readonly frequency: FakeParam;
  readonly detune: FakeParam;
  constructor(context: FakeAudioContext) {
    super(context, "oscillator");
    this.frequency = new FakeParam(context, "frequency", 440);
    this.detune = new FakeParam(context, "detune", 0);
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    if (!(channels >= 1) || !(length >= 1) || !(sampleRate > 0)) throw new RangeError("createBuffer: bad arguments");
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`getChannelData: no channel ${channel}`);
    return data;
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate: FakeParam;
  readonly detune: FakeParam;
  constructor(context: FakeAudioContext) {
    super(context, "bufferSource");
    this.playbackRate = new FakeParam(context, "playbackRate", 1);
    this.detune = new FakeParam(context, "detune", 0);
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  readonly detune: FakeParam;
  constructor(context: FakeAudioContext) {
    super(context, "biquad");
    this.frequency = new FakeParam(context, "frequency", 350);
    this.Q = new FakeParam(context, "Q", 1);
    this.gain = new FakeParam(context, "gain", 0);
    this.detune = new FakeParam(context, "detune", 0);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(context: FakeAudioContext) {
    super(context, "stereoPanner");
    this.pan = new FakeParam(context, "pan", 0);
  }
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
  constructor(context: FakeAudioContext) {
    super(context, "convolver");
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeParam;
  readonly knee: FakeParam;
  readonly ratio: FakeParam;
  readonly attack: FakeParam;
  readonly release: FakeParam;
  readonly reduction = 0;
  constructor(context: FakeAudioContext) {
    super(context, "compressor");
    this.threshold = new FakeParam(context, "threshold", -24);
    this.knee = new FakeParam(context, "knee", 30);
    this.ratio = new FakeParam(context, "ratio", 12);
    this.attack = new FakeParam(context, "attack", 0.003);
    this.release = new FakeParam(context, "release", 0.25);
  }
}

export type ResumeBehaviour = "ok" | "reject" | "throw" | "pending";

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  /** What `resume()` does: resolve and run, reject (blocked), throw, or never settle. */
  resumeBehaviour: ResumeBehaviour = "ok";
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    this.destination = new FakeNode(this, "destination");
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumeBehaviour === "throw") throw new Error("NotAllowedError: resume() blocked");
    if (this.resumeBehaviour === "reject") return Promise.reject(new Error("NotAllowedError: resume() blocked"));
    if (this.resumeBehaviour === "pending") return new Promise<void>(() => {});
    return Promise.resolve().then(() => {
      if (this.state !== "closed") this.setState("running");
    });
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    return Promise.resolve().then(() => {
      if (this.state !== "closed") this.setState("suspended");
    });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.setState("closed");
    return Promise.resolve();
  }

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  /** Move the audio clock forward. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  private setState(next: "suspended" | "running" | "closed"): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of [...(this.listeners.get("statechange") ?? [])]) listener();
  }

  // ── inspection ────────────────────────────────────────────────────────────

  /** Sources that have been started. */
  get started(): Array<FakeOscillator | FakeBufferSource> {
    return this.nodes.filter((node): node is FakeOscillator | FakeBufferSource => node instanceof FakeSource && node.startedAt !== null);
  }

  /** Nodes that still have at least one outgoing connection. */
  get connected(): FakeNode[] {
    return this.nodes.filter((node) => node.outputs.length > 0);
  }
}

/** Can signal from `from` arrive at `to` through node-to-node connections that still exist? */
export const reaches = (from: FakeNode, to: FakeNode, everConnected = false): boolean => {
  const seen = new Set<FakeNode>();
  const queue: FakeNode[] = [from];
  while (queue.length > 0) {
    const node = queue.pop() as FakeNode;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of everConnected ? node.everConnected : node.outputs) {
      if (next instanceof FakeNode) queue.push(next);
    }
  }
  return false;
};

/** Does `from` end up modulating a parameter (an LFO, an FM operator) through existing connections? */
export const modulates = (from: FakeNode): boolean => {
  const seen = new Set<FakeNode>();
  const queue: FakeNode[] = [from];
  while (queue.length > 0) {
    const node = queue.pop() as FakeNode;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of node.outputs) {
      if (next instanceof FakeParam) return true;
      queue.push(next);
    }
  }
  return false;
};

/** The parts of an input event the engine looks at. */
export interface FakeEvent {
  type: string;
  key?: string;
  pointerType?: string;
}

export class FakeTarget implements ListenerTarget {
  visibilityState = "visible";
  private readonly listeners = new Map<string, Set<(event?: Event) => void>>();

  addEventListener(type: string, listener: (event?: Event) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event?: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Fire an event; `init` adds the key / pointer type (a real browser would). */
  dispatch(type: string, init: Omit<FakeEvent, "type"> = {}): void {
    const event = { type, ...init } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  /** Listeners registered (for one event type, or in total). */
  count(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Let pending promise callbacks (resume / suspend settling) run. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

export interface HarnessOptions {
  /** What `navigator.userActivation.hasBeenActive` reports; `undefined` = the API is missing. Default false. */
  activated?: boolean | undefined;
  /**
   * What `navigator.userActivation.isActive` reports while an input is dispatched; `undefined`
   * (the default) = the API is missing and the engine judges the input itself.
   */
  active?: () => boolean | undefined;
  settings?: AudioSettingsStore;
  /** Replace the context factory (to return null or throw). */
  createContext?: () => BaseAudioContext | null;
  seed?: number;
}

export interface Harness {
  ctx: FakeAudioContext;
  gestures: FakeTarget;
  doc: FakeTarget;
  settings: AudioSettingsStore;
  engine: AudioEngine;
  /** How many times the engine asked for a context. */
  created(): number;
  /** Fire a user gesture and let the resume() promise settle. */
  unlock(): Promise<void>;
}

/** An AudioEngine wired to fakes: the standard fixture for audio tests. */
export const makeHarness = (options: HarnessOptions = {}): Harness => {
  const ctx = new FakeAudioContext();
  const gestures = new FakeTarget();
  const doc = new FakeTarget();
  const settings = options.settings ?? createAudioSettingsStore(null);
  let created = 0;
  const activated = "activated" in options ? options.activated : false;
  const engineOptions: AudioEngineOptions = {
    settings,
    seed: options.seed ?? 1,
    env: {
      gestures,
      doc,
      userActivated: () => activated,
      userActive: () => options.active?.(),
      createContext: () => {
        created += 1;
        return options.createContext ? options.createContext() : (ctx as unknown as BaseAudioContext);
      },
    },
  };
  const engine = new AudioEngine(engineOptions);
  return {
    ctx,
    gestures,
    doc,
    settings,
    engine,
    created: () => created,
    unlock: async () => {
      gestures.dispatch("pointerdown");
      await settle();
    },
  };
};

/** An AudioEngine on a fake context in offline mode (no timers, no listeners, clock at zero). */
export const makeOfflineHarness = (seed = 1): { ctx: FakeAudioContext; engine: AudioEngine } => {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine({ offlineContext: ctx as unknown as BaseAudioContext, settings: createAudioSettingsStore(null), seed });
  return { ctx, engine };
};
