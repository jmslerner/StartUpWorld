import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, BUS_VOICE_CAP, LIMITER, getAudioEngine, limiterMakeupGain, playSound, setSharedAudioEngine } from "./engine";
import { BUS_NAMES, LEGACY_MASTER_KEY, createAudioSettingsStore, volumeToGain, DEFAULT_AUDIO_SETTINGS } from "./settings";
import { SOUND_NAMES, SOUNDS, soundsOnBus, type SoundName } from "./sounds";
import { mulberry32 } from "./synth";
import {
  FakeCompressor,
  FakeConvolver,
  FakeGain,
  FakeNode,
  MemoryStorage,
  makeHarness,
  makeOfflineHarness,
  modulates,
  reaches,
  settle,
  type FakeAudioContext,
} from "./testing/fakeAudio";

const asFake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

/** Sources started by `action`. */
const startedBy = (ctx: FakeAudioContext, action: () => void) => {
  const before = new Set(ctx.started);
  action();
  return ctx.started.filter((source) => !before.has(source));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setSharedAudioEngine(null);
  vi.useRealTimers();
});

describe("AudioEngine lifecycle", () => {
  it("creates nothing until the page has been interacted with", () => {
    const h = makeHarness();
    expect(h.created()).toBe(0);
    expect(h.engine.state).toBe("idle");
    expect(h.engine.context).toBeNull();
    expect(h.engine.play("success")).toBeNull();
    expect(h.engine.tap("ambience")).toBeNull();
    expect(h.created()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    h.engine.dispose();
  });

  it("creates one context and resumes it on the first gesture, then stops listening", async () => {
    const h = makeHarness();
    expect(h.gestures.count()).toBe(5);
    await h.unlock();
    expect(h.created()).toBe(1);
    expect(h.ctx.resumeCalls).toBe(1);
    expect(h.engine.state).toBe("running");
    expect(h.gestures.count()).toBe(0);
    expect(h.engine.play("success")).not.toBeNull();
    // Later gestures and sounds reuse the same context.
    h.gestures.dispatch("keydown");
    h.engine.play("fail");
    expect(h.created()).toBe(1);
    h.engine.dispose();
  });

  it("unlock() can be called directly from a click handler", async () => {
    const h = makeHarness();
    h.engine.unlock();
    await settle();
    expect(h.engine.state).toBe("running");
    h.engine.dispose();
  });

  it("does not lose the first sound while resume() is still in flight", () => {
    const h = makeHarness({ activated: true });
    const voice = h.engine.play("success");
    expect(voice).not.toBeNull();
    expect(h.ctx.state).toBe("suspended");
    expect(h.ctx.started.length).toBeGreaterThan(0);
    h.engine.dispose();
  });

  it("without the userActivation API, only a gesture creates the context — never a sound or a timer", async () => {
    const h = makeHarness({ activated: undefined });
    expect(h.engine.tap("ambience")).toBeNull();
    expect(h.engine.play("click")).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(h.created()).toBe(0);
    await h.unlock();
    expect(h.created()).toBe(1);
    expect(h.engine.play("click")).not.toBeNull();
    expect(h.engine.tap("ambience")).not.toBeNull();
    h.engine.dispose();
  });

  it.each([
    ["keydown Shift", "keydown", { key: "Shift" }],
    ["keydown Escape", "keydown", { key: "Escape" }],
    ["keydown Meta", "keydown", { key: "Meta" }],
    ["a touch's pointerdown", "pointerdown", { pointerType: "touch" }],
    ["a mouse's pointerup", "pointerup", { pointerType: "mouse" }],
  ] as const)("%s is not a user activation: it creates no context", async (_label, type, init) => {
    const h = makeHarness();
    h.gestures.dispatch(type, init);
    await settle();
    expect(h.created()).toBe(0);
    expect(h.engine.state).toBe("idle");
    // The next real one does.
    h.gestures.dispatch("keydown", { key: "a" });
    await settle();
    expect(h.created()).toBe(1);
    expect(h.engine.state).toBe("running");
    h.engine.dispose();
  });

  it("a tap unlocks on its touchend", async () => {
    const h = makeHarness();
    h.gestures.dispatch("pointerdown", { pointerType: "touch" });
    h.gestures.dispatch("pointerup", { pointerType: "touch" });
    await settle();
    expect(h.created()).toBe(1);
    expect(h.engine.state).toBe("running");
    h.engine.dispose();
  });

  it("trusts navigator.userActivation.isActive over its own guess", async () => {
    let active = false;
    const h = makeHarness({ active: () => active });
    h.gestures.dispatch("keydown", { key: "a" });
    await settle();
    expect(h.created()).toBe(0);
    active = true;
    h.gestures.dispatch("keydown", { key: "Shift" });
    await settle();
    expect(h.created()).toBe(1);
    h.engine.dispose();
  });

  it("asks again on the next gesture while a refused resume() is still pending (it never settles by itself)", async () => {
    const h = makeHarness({ activated: true });
    h.ctx.resumeBehaviour = "pending";
    // Created early (the page had been active once), refused: Chrome leaves resume() pending.
    expect(h.engine.tap("ambience")).not.toBeNull();
    expect(h.ctx.resumeCalls).toBe(1);
    expect(h.engine.state).toBe("suspended");
    // Sounds are not queued onto the frozen clock to burst out later.
    vi.advanceTimersByTime(1000);
    expect(h.engine.play("success")).toBeNull();
    // A real gesture asks again, and this time the browser lets it run.
    h.ctx.resumeBehaviour = "ok";
    await h.unlock();
    expect(h.ctx.resumeCalls).toBe(2);
    expect(h.engine.state).toBe("running");
    expect(h.engine.play("success")).not.toBeNull();
    expect(h.gestures.count()).toBe(0);
    // Hidden and shown again later: it still resumes (nothing is left "pending").
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    vi.advanceTimersByTime(500);
    await settle();
    expect(h.ctx.state).toBe("suspended");
    h.doc.visibilityState = "visible";
    h.doc.dispatch("visibilitychange");
    await settle();
    expect(h.engine.state).toBe("running");
    h.engine.dispose();
  });

  it("resumes when a suspend() for a hidden tab lands after the tab came back", async () => {
    const h = makeHarness();
    await h.unlock();
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    vi.advanceTimersByTime(400); // suspend() is called…
    h.doc.visibilityState = "visible";
    h.doc.dispatch("visibilitychange"); // …the tab is back before it settles
    await settle();
    expect(h.engine.state).toBe("running");
    expect(h.engine.isAudible()).toBe(true);
    h.engine.dispose();
  });

  it("notifies subscribers when it unlocks, hides, and when settings change", async () => {
    const h = makeHarness();
    const listener = vi.fn();
    const off = h.engine.subscribe(listener);
    await h.unlock();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    expect(listener).toHaveBeenCalledTimes(1);
    h.settings.setMaster(0.5);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    h.settings.setMaster(0.6);
    expect(listener).toHaveBeenCalledTimes(2);
    h.engine.dispose();
  });
});

describe("AudioEngine when audio is blocked or missing", () => {
  it("stays silent when there is no AudioContext at all", () => {
    const h = makeHarness({ activated: true, createContext: () => null });
    expect(() => h.engine.play("success")).not.toThrow();
    expect(h.engine.play("success")).toBeNull();
    expect(h.engine.state).toBe("unavailable");
    expect(h.engine.isAudible()).toBe(false);
    expect(h.created()).toBe(1); // asked once, never again
    expect(h.gestures.count()).toBe(0);
    h.engine.dispose();
  });

  it("stays silent when constructing the context throws", () => {
    const h = makeHarness({
      activated: true,
      createContext: () => {
        throw new Error("NotSupportedError");
      },
    });
    expect(() => h.engine.play("alert")).not.toThrow();
    expect(h.engine.play("alert")).toBeNull();
    expect(h.engine.state).toBe("unavailable");
    expect(h.engine.error).toBeInstanceOf(Error);
    h.engine.dispose();
  });

  it("drops sounds while resume() is refused, and tries again on the next gesture", async () => {
    const h = makeHarness();
    h.ctx.resumeBehaviour = "reject";
    await h.unlock();
    expect(h.engine.state).toBe("suspended");
    expect(h.engine.play("success")).toBeNull();
    expect(h.ctx.started.length).toBe(0);
    expect(h.gestures.count()).toBe(5); // still waiting for a gesture that works
    h.ctx.resumeBehaviour = "ok";
    await h.unlock();
    expect(h.engine.state).toBe("running");
    expect(h.engine.play("success")).not.toBeNull();
    h.engine.dispose();
  });

  it("survives resume() throwing synchronously", async () => {
    const h = makeHarness();
    h.ctx.resumeBehaviour = "throw";
    expect(() => h.gestures.dispatch("pointerdown")).not.toThrow();
    await settle();
    expect(h.engine.play("success")).toBeNull();
    h.engine.dispose();
  });

  it("works without StereoPannerNode (older Safari)", async () => {
    const h = makeHarness();
    Object.defineProperty(h.ctx, "createStereoPanner", { value: undefined });
    await h.unlock();
    expect(h.engine.play("footsteps", { pan: -0.3, panTo: 0.4 })).not.toBeNull();
    expect(h.engine.play("ship-ok")).not.toBeNull();
    expect(h.engine.error).toBeNull();
    h.engine.dispose();
  });

  it("swallows a failing recipe and leaves nothing connected", async () => {
    const h = makeHarness();
    await h.unlock();
    const baseline = h.ctx.connected.length;
    Object.defineProperty(h.ctx, "createOscillator", {
      value: () => {
        throw new Error("out of oscillators");
      },
    });
    expect(() => h.engine.play("success")).not.toThrow();
    expect(h.engine.play("warning")).toBeNull();
    expect(h.engine.error).toBeInstanceOf(Error);
    expect(h.engine.voiceCount()).toBe(0);
    expect(h.ctx.connected.length).toBe(baseline);
    h.engine.dispose();
  });

  it("ignores unknown sound names", async () => {
    const h = makeHarness();
    await h.unlock();
    expect(h.engine.play("no-such-sound" as SoundName)).toBeNull();
    h.engine.dispose();
  });
});

describe("AudioEngine mix", () => {
  it("builds bus → master → limiter → trim → destination with a shared reverb", async () => {
    const h = makeHarness();
    await h.unlock();
    const limiters = h.ctx.nodes.filter((node): node is FakeCompressor => node instanceof FakeCompressor);
    const reverbs = h.ctx.nodes.filter((node): node is FakeConvolver => node instanceof FakeConvolver);
    expect(limiters).toHaveLength(1);
    expect(reverbs).toHaveLength(1);
    const limiter = limiters[0];
    expect(limiter.threshold.value).toBe(LIMITER.threshold);
    expect(limiter.knee.value).toBe(LIMITER.knee);
    expect(limiter.ratio.value).toBe(LIMITER.ratio);
    expect(reverbs[0].normalize).toBe(false);
    expect(reverbs[0].buffer?.numberOfChannels).toBe(2);

    // The limiter is the only way to the speakers, and it is followed by the makeup trim.
    const intoDestination = h.ctx.nodes.filter((node) => node.outputs.includes(h.ctx.destination));
    expect(intoDestination).toHaveLength(1);
    const trim = intoDestination[0] as FakeGain;
    expect(limiter.outputs).toEqual([trim]);
    expect(trim.gain.value).toBeCloseTo(1 / limiterMakeupGain(LIMITER.threshold, LIMITER.knee, LIMITER.ratio), 6);

    for (const bus of BUS_NAMES) {
      const tap = h.engine.tap(bus);
      expect(tap).not.toBeNull();
      if (!tap) continue;
      expect(reaches(asFake(tap.dry), limiter)).toBe(true);
      expect(reaches(asFake(tap.wet), reverbs[0])).toBe(true);
      expect(reaches(reverbs[0], limiter)).toBe(true);
      expect((asFake(tap.dry) as FakeGain).gain.value).toBeCloseTo(volumeToGain(DEFAULT_AUDIO_SETTINGS.volumes[bus]));
    }
    expect((asFake(h.engine.tap("ui")?.mix as AudioNode) as FakeGain).gain.value).toBeCloseTo(volumeToGain(DEFAULT_AUDIO_SETTINGS.master));
    h.engine.dispose();
  });

  it("the limiter's makeup gain matches what Chrome measures (+3.45 dB for these settings)", () => {
    expect(20 * Math.log10(limiterMakeupGain(-8, 5, 12))).toBeCloseTo(3.45, 2);
    // No compression curve, no makeup.
    expect(limiterMakeupGain(0, 0, 1)).toBeCloseTo(1, 6);
  });

  it("routes every sound to the bus it declares", async () => {
    const h = makeHarness();
    await h.unlock();
    for (const bus of BUS_NAMES) {
      const tap = h.engine.tap(bus);
      const name = soundsOnBus(bus)[0];
      const sources = startedBy(h.ctx, () => h.engine.play(name));
      expect(sources.length, name).toBeGreaterThan(0);
      const dry = asFake(tap?.dry as AudioNode);
      expect(sources.some((source) => reaches(source, dry)), `${name} → ${bus}`).toBe(true);
      // Every source either arrives at the bus or is a modulator (an LFO, an FM operator).
      for (const source of sources) expect(reaches(source, dry) || modulates(source), `${name}: a source goes nowhere`).toBe(true);
      for (const other of BUS_NAMES) {
        if (other === bus) continue;
        const otherDry = asFake(h.engine.tap(other)?.dry as AudioNode);
        expect(sources.some((source) => reaches(source, otherDry))).toBe(false);
      }
      h.ctx.advance(1);
    }
    h.engine.dispose();
  });

  it("follows fader and mute changes", async () => {
    const h = makeHarness();
    await h.unlock();
    const tap = h.engine.tap("world");
    h.settings.setVolume("world", 0.5);
    expect((asFake(tap?.dry as AudioNode) as FakeGain).gain.last).toBeCloseTo(0.25);
    expect((asFake(tap?.wet as AudioNode) as FakeGain).gain.last).toBeCloseTo(0.25);
    h.settings.setMaster(1);
    expect((asFake(tap?.mix as AudioNode) as FakeGain).gain.last).toBeCloseTo(1);
    h.settings.setMuted(true);
    expect((asFake(tap?.mix as AudioNode) as FakeGain).gain.last).toBe(0);
    h.engine.dispose();
  });
});

describe("AudioEngine voices", () => {
  it("applies a per-sound minimum retrigger interval", async () => {
    const h = makeHarness();
    await h.unlock();
    expect(h.engine.play("success")).not.toBeNull();
    expect(h.engine.play("success")).toBeNull();
    expect(h.engine.play("fail")).not.toBeNull(); // other sounds are unaffected
    h.ctx.advance(SOUNDS.success.minInterval + 0.01);
    expect(h.engine.play("success")).not.toBeNull();
    h.engine.dispose();
  });

  it("caps polyphony per bus by stealing the oldest voice", async () => {
    const h = makeHarness();
    await h.unlock();
    const stings = soundsOnBus("outcome").filter((name) => name.startsWith("gameover-"));
    expect(stings.length).toBeGreaterThan(BUS_VOICE_CAP.outcome);
    const first = h.engine.play(stings[0]);
    expect(first).not.toBeNull();
    for (let i = 1; i < BUS_VOICE_CAP.outcome; i += 1) {
      h.ctx.advance(0.02);
      expect(h.engine.play(stings[i])).not.toBeNull();
    }
    expect(h.engine.voiceCount("outcome")).toBe(BUS_VOICE_CAP.outcome);

    const gainsBefore = h.ctx.nodes.filter((node): node is FakeGain => node instanceof FakeGain);
    h.ctx.advance(0.05);
    expect(h.engine.play(stings[BUS_VOICE_CAP.outcome])).not.toBeNull();
    // The oldest voice was faded to zero, quickly but not instantly…
    const faded = gainsBefore.filter((gain) => gain.gain.events.some((event) => event.type === "linear" && event.value === 0 && event.time <= h.ctx.currentTime + 0.03));
    expect(faded.length).toBeGreaterThanOrEqual(1);
    // …and is gone at the next sweep.
    h.ctx.advance(0.2);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount("outcome")).toBe(BUS_VOICE_CAP.outcome);
    // Other buses have their own budget.
    expect(h.engine.play("door-open")).not.toBeNull();
    h.engine.dispose();
  });

  it("never exceeds the cap however fast sounds arrive", async () => {
    const h = makeHarness();
    await h.unlock();
    const names = soundsOnBus("world");
    for (const name of names) h.engine.play(name);
    h.ctx.advance(0.1);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount("world")).toBeLessThanOrEqual(BUS_VOICE_CAP.world);
    h.engine.dispose();
  });

  it("varies pitch and level a little between plays, and not at all with a fixed seed", () => {
    const render = (seed: number) => {
      const { ctx, engine } = makeOfflineHarness();
      engine.play("door-close", { at: 0, seed });
      return ctx.nodes
        .flatMap((node) => (node instanceof FakeGain ? node.gain.events : []))
        .map((event) => `${event.type}:${event.value.toFixed(6)}@${event.time.toFixed(6)}`)
        .join("|");
    };
    expect(render(3)).toBe(render(3));
    expect(render(3)).not.toBe(render(4));
  });

  it("stops and disconnects every node of a voice once it has ended", async () => {
    const h = makeHarness();
    await h.unlock();
    const baseline = h.ctx.connected.length;
    const sources = startedBy(h.ctx, () => h.engine.play("ship-ok"));
    expect(h.ctx.connected.length).toBeGreaterThan(baseline);
    expect(vi.getTimerCount()).toBe(1); // the sweeper
    h.ctx.advance(3);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount()).toBe(0);
    expect(h.ctx.connected.length).toBe(baseline);
    for (const source of sources) {
      expect(source.stoppedAt).not.toBeNull();
      expect(source.outputs).toHaveLength(0);
    }
    expect(vi.getTimerCount()).toBe(0); // the sweeper stops when there is nothing to sweep
    h.engine.dispose();
  });

  it("does not leak over a long session", async () => {
    const h = makeHarness();
    await h.unlock();
    const baseline = h.ctx.connected.length;
    const rand = mulberry32(99);
    let played = 0;
    // About two hours of game time: a sound every few seconds, the clock moving in between.
    for (let i = 0; i < 2400; i += 1) {
      const name = SOUND_NAMES[Math.floor(rand() * SOUND_NAMES.length)];
      if (h.engine.play(name, { pan: rand() * 2 - 1 })) played += 1;
      h.ctx.advance(0.5 + rand() * 5);
      vi.advanceTimersByTime(250);
      expect(h.engine.voiceCount()).toBeLessThanOrEqual(12);
    }
    expect(played).toBeGreaterThan(2000);
    h.ctx.advance(40);
    vi.advanceTimersByTime(500);
    expect(h.engine.voiceCount()).toBe(0);
    expect(h.ctx.connected.length).toBe(baseline);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.engine.error).toBeNull();
    h.engine.dispose();
  });

  it("a voice handle can stop its sound early", async () => {
    const h = makeHarness();
    await h.unlock();
    const voice = h.engine.play("asset-lounge");
    expect(voice).not.toBeNull();
    h.ctx.advance(0.2);
    voice?.stop(0.05);
    h.ctx.advance(0.2);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount()).toBe(0);
    h.engine.dispose();
  });

  it("a second, shorter fade starts from where the first one had got to — never back up at full level", async () => {
    const h = makeHarness();
    await h.unlock();
    const gainsBefore = new Set(h.ctx.nodes);
    expect(h.engine.play("asset-helicopter")).not.toBeNull();
    const voiceGains = h.ctx.nodes.filter((node): node is FakeGain => node instanceof FakeGain && !gainsBefore.has(node) && node.everConnected.some((to) => to === asFake(h.engine.tap("world")!.dry) || to === asFake(h.engine.tap("world")!.wet)));
    expect(voiceGains.length).toBe(2);
    const level = voiceGains[0].gain.value;
    h.ctx.advance(0.1);
    h.engine.stopAll("world", 1.0); // a slow fade from t = 0.1 to 1.1…
    h.ctx.advance(0.5);
    h.engine.stopAll("world", 0.05); // …cut short half-way through
    for (const gain of voiceGains) {
      const sets = gain.gain.events.filter((event) => event.type === "set");
      const last = sets[sets.length - 1];
      expect(last.time).toBeCloseTo(h.ctx.currentTime, 6);
      // Half-way down a linear fade: half the level, not the full level again.
      expect(last.value).toBeCloseTo(level * 0.5, 4);
      for (const event of sets) expect(event.value).toBeLessThanOrEqual(level + 1e-9);
    }
    h.engine.dispose();
  });
});

describe("AudioEngine mute and visibility", () => {
  it("plays nothing while muted, suspends the context, and resumes cleanly", async () => {
    const h = makeHarness();
    await h.unlock();
    h.engine.play("gameover-ipo");
    h.settings.setMuted(true);
    expect(h.engine.isAudible()).toBe(false);
    expect(h.engine.play("success")).toBeNull();
    h.ctx.advance(0.2);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount()).toBe(0);
    vi.advanceTimersByTime(400);
    await settle();
    expect(h.ctx.suspendCalls).toBe(1);
    expect(h.engine.state).toBe("suspended");
    expect(vi.getTimerCount()).toBe(0);

    h.settings.setMuted(false);
    await settle();
    expect(h.engine.state).toBe("running");
    expect(h.engine.play("success")).not.toBeNull();
    h.engine.dispose();
  });

  it("does not wake the audio hardware for a gesture while muted", async () => {
    const settings = createAudioSettingsStore(null);
    settings.setMuted(true);
    const h = makeHarness({ settings });
    await h.unlock();
    expect(h.created()).toBe(0);
    settings.setMuted(false);
    // Un-muted after a gesture has been seen: the next sound starts audio.
    expect(h.engine.play("click")).not.toBeNull();
    expect(h.created()).toBe(1);
    h.engine.dispose();
  });

  it("mutes a single bus without touching the others", async () => {
    const h = makeHarness();
    await h.unlock();
    h.settings.setBusMuted("world", true);
    expect(h.engine.isAudible("world")).toBe(false);
    expect(h.engine.play("door-open")).toBeNull();
    expect(h.engine.play("success")).not.toBeNull();
    h.settings.setVolume("ui", 0);
    expect(h.engine.play("ui-select")).toBeNull();
    h.engine.dispose();
  });

  it('honours the legacy "startupworld:sfx:master" = "0" flag', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_MASTER_KEY, "0");
    const h = makeHarness({ settings: createAudioSettingsStore(storage) });
    await h.unlock();
    expect(h.engine.play("success")).toBeNull();
    expect(h.created()).toBe(0);
    h.engine.dispose();
  });

  it("goes quiet when the tab is hidden and comes back when it is shown", async () => {
    const h = makeHarness();
    await h.unlock();
    h.engine.play("gameover-ipo");
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    expect(h.engine.isAudible()).toBe(false);
    expect(h.engine.play("success")).toBeNull();
    h.ctx.advance(0.2);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount()).toBe(0);
    vi.advanceTimersByTime(400);
    await settle();
    expect(h.ctx.suspendCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    h.doc.visibilityState = "visible";
    h.doc.dispatch("visibilitychange");
    await settle();
    expect(h.engine.state).toBe("running");
    expect(h.engine.play("success")).not.toBeNull();
    h.engine.dispose();
  });

  it("does not suspend if the tab comes straight back", async () => {
    const h = makeHarness();
    await h.unlock();
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    vi.advanceTimersByTime(100);
    h.doc.visibilityState = "visible";
    h.doc.dispatch("visibilitychange");
    vi.advanceTimersByTime(1000);
    await settle();
    expect(h.ctx.suspendCalls).toBe(0);
    h.engine.dispose();
  });

  it("starts hidden if the page is hidden", () => {
    const h = makeHarness({ activated: true });
    h.engine.dispose();
    const ctx = h.ctx;
    const doc = h.doc;
    doc.visibilityState = "hidden";
    const engine = new AudioEngine({
      settings: createAudioSettingsStore(null),
      env: { gestures: h.gestures, doc, userActivated: () => true, createContext: () => ctx as unknown as BaseAudioContext },
    });
    expect(engine.isAudible()).toBe(false);
    expect(engine.play("success")).toBeNull();
    engine.dispose();
  });
});

describe("AudioEngine teardown", () => {
  it("dispose leaves no timers, listeners or connections, and closes the context", async () => {
    const h = makeHarness();
    await h.unlock();
    h.engine.play("phase-change");
    h.engine.play("success");
    h.settings.setMuted(true); // schedules a suspend
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.gestures.count()).toBe(0);
    expect(h.doc.count()).toBe(0);
    expect(h.ctx.listenerCount("statechange")).toBe(0);
    expect(h.ctx.connected).toHaveLength(0);
    expect(h.ctx.closeCalls).toBe(1);
    expect(h.engine.state).toBe("closed");
    expect(h.engine.play("success")).toBeNull();
    expect(h.engine.tap("ui")).toBeNull();
    expect(() => h.engine.dispose()).not.toThrow();
    // Settings changes no longer reach it.
    h.settings.setMuted(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an engine that never made a sound disposes cleanly too", () => {
    const h = makeHarness();
    h.engine.dispose();
    expect(h.gestures.count()).toBe(0);
    expect(h.doc.count()).toBe(0);
    expect(h.created()).toBe(0);
  });
});

describe("offline engine", () => {
  it("schedules from time zero with no timers, listeners or unlock", () => {
    const { ctx, engine } = makeOfflineHarness();
    expect(engine.offline).toBe(true);
    expect(engine.state).toBe("idle");
    const voice = engine.play("success", { at: 0 });
    expect(voice?.start).toBe(0);
    expect(engine.state).toBe("running");
    expect(ctx.resumeCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
    expect(ctx.closeCalls).toBe(0); // not ours to close
  });
});

describe("shared engine", () => {
  it("playSound uses the shared engine", async () => {
    const h = makeHarness();
    setSharedAudioEngine(h.engine);
    expect(getAudioEngine()).toBe(h.engine);
    await h.unlock();
    expect(playSound("click")).not.toBeNull();
    h.engine.dispose();
    // A closed shared engine is replaced rather than reused.
    expect(getAudioEngine()).not.toBe(h.engine);
  });

  it("is silent and safe in node, where there is no window", () => {
    setSharedAudioEngine(null);
    const engine = getAudioEngine();
    expect(engine.state).toBe("idle");
    expect(() => playSound("success")).not.toThrow();
    expect(playSound("success")).toBeNull();
    // No gesture can ever arrive, so it never even asks for a context.
    expect(engine.state).toBe("idle");
    engine.unlock();
    expect(engine.state).toBe("unavailable");
    engine.dispose();
  });
});
