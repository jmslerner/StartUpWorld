import { describe, expect, it } from "vitest";
import { BUS_NAMES } from "./settings";
import { SOUND_NAMES, SOUNDS, isSoundName, soundsOnBus, type SoundName } from "./sounds";
import { PENTATONIC, Synth, hz, midiToHz, mulberry32, noiseBandShare, noteToMidi, pent } from "./synth";
import { FakeAudioContext, FakeBufferSource, FakeGain, FakeOscillator, makeOfflineHarness, modulates, reaches, type FakeNode } from "./testing/fakeAudio";

/** The minimum sound list from the brief, by the names this library gives them. */
const REQUIRED: Record<string, readonly SoundName[]> = {
  ui: ["ui-hover", "ui-select", "ui-open", "ui-close", "ui-press", "ui-prefill", "ui-denied", "ui-toggle-on", "ui-toggle-off", "ui-zoom-in", "ui-zoom-out"],
  outcome: [
    "success",
    "fail",
    "cash-in",
    "warning",
    "opportunity",
    "crisis",
    "tick",
    "alert",
    "click",
    "gameover-ipo",
    "gameover-acquisition",
    "gameover-bankruptcy",
    "gameover-founder-removal",
    "gameover-zombie-saas",
    "gameover-ai-hype-exit",
    "gameover-forced-acquisition",
    "positive-small",
    "positive-big",
    "negative-small",
    "negative-big",
    "neutral",
    "project-started",
    "project-progress",
    "release-flop",
    "release-ok",
    "release-hit",
    "level-up",
    "training-done",
    "resignation",
  ],
  world: [
    "door-open",
    "door-close",
    "footsteps",
    "chair-sit",
    "chair-creak",
    "keyboard-flurry",
    "hire-arrival",
    "departure",
    "ship-ok",
    "ship-fail",
    "launch-ok",
    "launch-fail",
    "phone-ring",
    "pitch-ok",
    "pitch-fail",
    "raise-ok",
    "raise-fail",
    "week-advance",
    "phase-change",
    "stage-change",
    "asset-acquired",
    "asset-office-upgrade",
    "asset-lounge",
    "asset-helicopter",
    "asset-jet",
    "asset-yacht",
    "event-beacon",
    "event-resolved",
    "coffee",
    "bubble-pop",
    "confetti-pops",
    "money-flutter",
    "smoke-puff",
    "alarm-pulse",
    "board-dinner",
    "board-gift",
    "board-blackmail",
  ],
};

/** Limits from the brief that can be read off the schedule without rendering audio. */
const MAX_SCHEDULED: Record<string, number> = { ui: 0.12, stinger: 0.7, diegetic: 2 };

/** An element's envelope: a gain scheduled from silence, with an exponential decay (FM index ramps start above zero). */
const isEnvelope = (node: FakeGain): boolean => {
  const events = node.gain.events.filter((event) => event.type !== "value");
  return events.length >= 3 && events[0].type === "set" && events[0].value === 0 && events.some((event) => event.type === "exp");
};

interface Scheduled {
  ctx: FakeAudioContext;
  bus: FakeNode;
  sources: Array<FakeOscillator | FakeBufferSource>;
  end: number;
}

const schedule = (name: SoundName, seed = 5): Scheduled => {
  const { ctx, engine } = makeOfflineHarness(seed);
  const tap = engine.tap(SOUNDS[name].bus);
  if (!tap) throw new Error("offline engine has no graph");
  const voice = engine.play(name, { at: 0, seed, steps: 6, intensity: 1 });
  if (!voice) throw engine.error instanceof Error ? engine.error : new Error(`${name}: nothing scheduled`);
  return { ctx, bus: tap.dry as unknown as FakeNode, sources: ctx.started, end: voice.end };
};

describe("sound library", () => {
  it("contains every sound the brief asks for, on the right bus", () => {
    for (const [bus, names] of Object.entries(REQUIRED)) {
      for (const name of names) {
        expect(isSoundName(name), name).toBe(true);
        expect(SOUNDS[name].bus, name).toBe(bus);
      }
    }
    expect(isSoundName("definitely-not-a-sound")).toBe(false);
    expect(isSoundName("toString")).toBe(false);
  });

  it("has sane metadata for every sound", () => {
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length);
    for (const name of SOUND_NAMES) {
      const def = SOUNDS[name];
      expect(name, name).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
      expect(BUS_NAMES, name).toContain(def.bus);
      expect(def.gain, name).toBeGreaterThan(0);
      expect(def.gain, name).toBeLessThan(8);
      expect(def.minInterval, name).toBeGreaterThan(0);
      expect(def.cents, name).toBeGreaterThanOrEqual(0);
      expect(def.db, name).toBeGreaterThanOrEqual(0);
      expect(def.db, name).toBeLessThanOrEqual(3);
      expect(def.maxDur, name).toBeGreaterThan(0);
      if (def.tonalAt !== undefined) expect(def.tonalAt, name).toBeGreaterThanOrEqual(0);
      // Kind and bus go together.
      expect(def.kind, name).toBe({ ui: "ui", outcome: "stinger", world: "diegetic", ambience: "ambient", music: "music" }[def.bus]);
    }
    for (const bus of BUS_NAMES) expect(soundsOnBus(bus).length, bus).toBeGreaterThan(0);
  });

  it("designed levels sit inside each family's loudness window", () => {
    const windows = { ui: [-30, -18], stinger: [-20, -9], diegetic: [-24, -10], ambient: [-60, -30], music: [-40, -24] } as const;
    for (const name of SOUND_NAMES) {
      const def = SOUNDS[name];
      const [min, max] = windows[def.kind];
      expect(def.level, name).toBeGreaterThanOrEqual(min + 1);
      expect(def.level, name).toBeLessThanOrEqual(max - 1);
    }
  });

  it.each(SOUND_NAMES)("%s schedules cleanly on its bus", (name) => {
    // The fake context throws on anything a browser would reject (NaN, negative times,
    // exponential ramps to zero, double starts), so getting here at all is most of the test.
    const { ctx, bus, sources, end } = schedule(name);
    const def = SOUNDS[name];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => reaches(source, bus))).toBe(true);
    for (const source of sources) {
      expect(reaches(source, bus) || modulates(source)).toBe(true);
      expect(source.startedAt).not.toBeNull();
      expect(source.stoppedAt).not.toBeNull();
      expect(source.stoppedAt as number).toBeGreaterThan(source.startedAt as number);
      expect(source.stoppedAt as number).toBeLessThanOrEqual(end + 1e-9);
      if (source instanceof FakeBufferSource) expect(source.buffer).not.toBeNull();
    }

    // Every envelope starts from silence, never goes negative, and ends in silence.
    const envelopes = ctx.nodes.filter((node): node is FakeGain => node instanceof FakeGain && isEnvelope(node));
    expect(envelopes.length).toBeGreaterThan(0);
    for (const env of envelopes) {
      const events = env.gain.events.filter((event) => event.type !== "value");
      expect(events[0].type).toBe("set");
      expect(events[0].value).toBe(0);
      expect(events[events.length - 1].type).toBe("linear");
      expect(events[events.length - 1].value).toBe(0);
      // Soft attack: at least 2 ms from silence to the peak.
      expect(events[1].time - events[0].time).toBeGreaterThanOrEqual(0.002 - 1e-9);
      for (let i = 1; i < events.length; i += 1) {
        expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
        expect(events[i].value).toBeGreaterThanOrEqual(0);
      }
    }

    const limit = MAX_SCHEDULED[def.kind];
    if (limit !== undefined) expect(end, `${name} is scheduled for ${end.toFixed(3)} s`).toBeLessThanOrEqual(Math.max(limit, def.maxDur) + 0.05);
    expect(end).toBeLessThanOrEqual(def.maxDur + 0.5);
  });

  it("is deterministic for a seed and different between seeds", () => {
    const fingerprint = (name: SoundName, seed: number): string =>
      schedule(name, seed)
        .sources.map((source) => `${source.kind}@${(source.startedAt ?? 0).toFixed(5)}-${(source.stoppedAt ?? 0).toFixed(5)}`)
        .join("|");
    for (const name of ["raise-ok", "keyboard-flurry", "ship-fail", "confetti-pops"] as const) {
      expect(fingerprint(name, 1)).toBe(fingerprint(name, 1));
      expect(fingerprint(name, 1)).not.toBe(fingerprint(name, 2));
    }
  });

  it("scales the busy sounds with intensity and steps", () => {
    const count = (name: SoundName, options: { intensity?: number; steps?: number }): number => {
      const { ctx, engine } = makeOfflineHarness(3);
      engine.play(name, { at: 0, seed: 3, ...options });
      return ctx.started.length;
    };
    expect(count("raise-ok", { intensity: 1 })).toBeGreaterThan(count("raise-ok", { intensity: 0 }));
    expect(count("confetti-pops", { intensity: 1 })).toBeGreaterThan(count("confetti-pops", { intensity: 0 }));
    expect(count("keyboard-flurry", { intensity: 1 })).toBeGreaterThan(count("keyboard-flurry", { intensity: 0 }));
    expect(count("footsteps", { steps: 6 })).toBe(count("footsteps", { steps: 1 }) * 6);
    expect(count("footsteps", { steps: 99 })).toBe(count("footsteps", { steps: 6 })); // clamped
  });
});

describe("tonal identity", () => {
  it("is D major: the pentatonic runs D E F♯ A B and keeps going up the octaves", () => {
    expect(PENTATONIC).toEqual([0, 2, 4, 7, 9]);
    expect(pent(0)).toBeCloseTo(hz("D4"), 6);
    expect(pent(1)).toBeCloseTo(hz("E4"), 6);
    expect(pent(2)).toBeCloseTo(hz("F#4"), 6);
    expect(pent(3)).toBeCloseTo(hz("A4"), 6);
    expect(pent(4)).toBeCloseTo(hz("B4"), 6);
    expect(pent(5)).toBeCloseTo(hz("D5"), 6);
    expect(pent(-1)).toBeCloseTo(hz("B3"), 6);
    expect(pent(14)).toBeCloseTo(hz("B6"), 6);
    for (let i = -10; i < 20; i += 1) expect(pent(i + 1)).toBeGreaterThan(pent(i));
  });

  it("names notes correctly", () => {
    expect(hz("A4")).toBe(440);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("F#5")).toBe(78);
    expect(noteToMidi("Bb3")).toBe(58);
    expect(midiToHz(69)).toBe(440);
  });
});

describe("synth building blocks", () => {
  const make = (pitch = 1) => {
    const ctx = new FakeAudioContext();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const synth = new Synth({ ctx: ctx as unknown as BaseAudioContext, dry: dry as unknown as AudioNode, wet: wet as unknown as AudioNode, t0: 1, rand: mulberry32(1), pitch });
    return { ctx, dry, wet, synth };
  };

  it("tracks the end of the voice and frees everything on dispose", () => {
    const { ctx, synth } = make();
    synth.tone({ freq: 440, dur: 0.2, gain: 0.5 });
    synth.noise({ t: 0.1, dur: 0.3, gain: 0.5, freq: 2000, send: 0.2, pan: 0.3 });
    synth.fm({ freq: 880, dur: 0.1, gain: 0.3, ratio: 3.5 });
    expect(synth.end).toBeCloseTo(1 + 0.1 + 0.3 + 0.01, 6);
    expect(synth.nodeCount).toBeGreaterThan(6);
    synth.dispose();
    expect(synth.nodeCount).toBe(0);
    expect(ctx.connected).toHaveLength(0);
    expect(() => synth.dispose()).not.toThrow();
  });

  it("applies the voice's pitch ratio to oscillators and noise filters alike", () => {
    const { ctx, synth } = make(2);
    synth.tone({ freq: 440, dur: 0.1, gain: 0.5 });
    const osc = ctx.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(osc?.frequency.events[0].value).toBe(880);
  });

  it("never schedules an attack shorter than 2 ms, a non-finite value, or a frequency out of range", () => {
    const { ctx, synth } = make();
    synth.tone({ freq: Number.NaN, dur: 0, a: 0, gain: Number.POSITIVE_INFINITY });
    synth.tone({ freq: 1e9, to: 0, dur: 0.05, gain: -1 });
    synth.noise({ dur: Number.NaN, gain: 0.2, freq: 5, to: 1e7 });
    for (const node of ctx.nodes) {
      if (node instanceof FakeOscillator) {
        for (const event of node.frequency.events) {
          expect(event.value).toBeGreaterThanOrEqual(20);
          expect(event.value).toBeLessThanOrEqual(16000);
        }
      }
    }
    const env = ctx.nodes.filter((node): node is FakeGain => node instanceof FakeGain && isEnvelope(node))[0];
    const events = env.gain.events.filter((event) => event.type !== "value");
    expect(events[1].time - events[0].time).toBeGreaterThanOrEqual(0.002 - 1e-9);
  });

  it("shares panners and sends between elements at the same position", () => {
    const { ctx, synth } = make();
    const before = ctx.nodes.length;
    synth.tone({ freq: 440, dur: 0.1, gain: 0.5, pan: 0.3, send: 0.2 });
    const one = ctx.nodes.length - before;
    synth.tone({ freq: 550, dur: 0.1, gain: 0.5, pan: 0.3, send: 0.2 });
    const two = ctx.nodes.length - before - one;
    expect(two).toBe(one - 2); // the second element reuses the panner and the send gain
  });

  it("knows how much of each noise colour a band holds", () => {
    const nyquist = 22050;
    expect(noiseBandShare("white", 0, nyquist, nyquist)).toBeCloseTo(1);
    expect(noiseBandShare("white", 1000, 2000, nyquist)).toBeCloseTo(1000 / nyquist);
    expect(noiseBandShare("pink", 20, nyquist, nyquist)).toBeCloseTo(1);
    // Pink has equal power per octave; brown is mostly below a few hundred hertz.
    expect(noiseBandShare("pink", 100, 200, nyquist)).toBeCloseTo(noiseBandShare("pink", 1000, 2000, nyquist));
    expect(noiseBandShare("brown", 0, 300, nyquist)).toBeGreaterThan(0.7);
    expect(noiseBandShare("brown", 3000, 6000, nyquist)).toBeLessThan(0.02);
    expect(noiseBandShare("white", 500, 400, nyquist)).toBe(0);
  });
});
