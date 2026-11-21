import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPhase } from "../types/game";
import {
  AmbienceDirector,
  DEFAULT_AMBIENCE_STATE,
  LAYER_NAMES,
  SCATTER_NAMES,
  ambienceTargets,
  type AmbienceState,
  type LayerName,
  type ScatterName,
} from "./ambience";
import { mulberry32 } from "./synth";
import { FakeBufferSource, FakeConvolver, makeHarness, makeOfflineHarness, type Harness } from "./testing/fakeAudio";

const PHASES: CompanyPhase[] = ["garage", "coworking", "office", "unicorn", "public"];
const ACTIVE: AmbienceState = { ...DEFAULT_AMBIENCE_STATE, setupComplete: true, teamSize: 8, phase: "office" };
const at = (patch: Partial<AmbienceState>) => ambienceTargets({ ...ACTIVE, ...patch });

describe("ambienceTargets", () => {
  it("more people → more clatter and more murmur (monotonic, saturating)", () => {
    for (const phase of PHASES) {
      let prevKeys = 0;
      let prevMurmur = -1;
      for (let teamSize = 0; teamSize <= 64; teamSize += 1) {
        const t = at({ phase, teamSize });
        expect(t.rates.keys, `${phase} ${teamSize}`).toBeGreaterThan(prevKeys);
        expect(t.layers.murmur, `${phase} ${teamSize}`).toBeGreaterThanOrEqual(prevMurmur);
        prevKeys = t.rates.keys;
        prevMurmur = t.layers.murmur;
      }
      // Saturating: the 64th person adds far less than the 2nd.
      const early = at({ phase, teamSize: 2 }).rates.keys - at({ phase, teamSize: 1 }).rates.keys;
      const late = at({ phase, teamSize: 64 }).rates.keys - at({ phase, teamSize: 63 }).rates.keys;
      expect(late).toBeLessThan(early / 4);
      expect(prevKeys).toBeLessThan(14); // never a machine gun
    }
    expect(at({ teamSize: 0 }).layers.murmur).toBe(0);
    expect(at({ teamSize: 40 }).layers.murmur).toBeGreaterThan(0.5);
  });

  it("morale makes the typing livelier", () => {
    let prevEnergy = -1;
    let prevRate = 0;
    for (let morale = 0; morale <= 100; morale += 5) {
      const t = at({ morale });
      expect(t.keyEnergy).toBeGreaterThan(prevEnergy);
      expect(t.rates.keys).toBeGreaterThan(prevRate);
      prevEnergy = t.keyEnergy;
      prevRate = t.rates.keys;
    }
    expect(at({ morale: 100 }).gains.keys).toBeGreaterThan(at({ morale: 0 }).gains.keys);
  });

  it("dusk quietens and warms everything", () => {
    for (const phase of PHASES) {
      let prev = at({ phase, dusk: 0 });
      for (let dusk = 0.1; dusk <= 1.0001; dusk += 0.1) {
        const t = at({ phase, dusk });
        expect(t.master, `${phase} ${dusk}`).toBeLessThan(prev.master);
        expect(t.warmth).toBeLessThan(prev.warmth);
        expect(t.rates.keys).toBeLessThan(prev.rates.keys);
        expect(t.layers.murmur).toBeLessThanOrEqual(prev.layers.murmur);
        prev = t;
      }
      expect(prev.master).toBeGreaterThan(0.4); // quieter, not gone
      expect(prev.warmth).toBeLessThan(3000);
    }
    // Except the insects, which come out at night.
    expect(at({ phase: "garage", dusk: 1 }).rates.cricket).toBeGreaterThan(at({ phase: "garage", dusk: 0 }).rates.cricket);
  });

  it("high stress adds a barely-there tension tone; a short runway adds a little more", () => {
    for (let stress = 0; stress <= 55; stress += 5) expect(at({ stress }).layers.tension).toBe(0);
    let prev = 0;
    for (let stress = 60; stress <= 100; stress += 5) {
      const tension = at({ stress }).layers.tension;
      expect(tension).toBeGreaterThan(prev);
      prev = tension;
    }
    expect(prev).toBeLessThanOrEqual(1);
    expect(at({ stress: 20, runwayLow: true }).layers.tension).toBeGreaterThan(0);
    expect(at({ stress: 90, runwayLow: true }).layers.tension).toBeGreaterThan(at({ stress: 90 }).layers.tension);
  });

  it("an open event hushes the room", () => {
    const open = at({ pendingEvent: true, teamSize: 30 });
    const calm = at({ pendingEvent: false, teamSize: 30 });
    expect(open.rates.keys).toBeLessThan(calm.rates.keys);
    expect(open.layers.murmur).toBeLessThan(calm.layers.murmur);
    expect(open.master).toBe(calm.master);
  });

  it("is almost silent before setup and after game over, and stops with the view hidden", () => {
    for (const patch of [{ setupComplete: false }, { gameOver: true }]) {
      const t = at({ ...patch, teamSize: 40, stress: 100 });
      expect(t.master).toBeGreaterThan(0);
      expect(t.master).toBeLessThan(0.2);
      expect(t.layers.room).toBeGreaterThan(0);
      for (const name of LAYER_NAMES) if (name !== "room") expect(t.layers[name], name).toBe(0);
      for (const name of SCATTER_NAMES) expect(t.rates[name], name).toBe(0);
      expect(t.lobby).toBe(false);
    }
    const hidden = at({ worldVisible: false });
    expect(hidden.master).toBe(0);
    for (const name of SCATTER_NAMES) expect(hidden.rates[name]).toBe(0);
  });

  it("gives each phase its own colour and none of the others'", () => {
    const colour: Record<CompanyPhase, { layers: LayerName[]; scatter: ScatterName[] }> = {
      garage: { layers: ["fridge"], scatter: ["cricket", "car"] },
      coworking: { layers: ["cafe"], scatter: ["clink", "steam"] },
      office: { layers: ["hvac"], scatter: ["phone", "chair"] },
      unicorn: { layers: ["hvac", "floor"], scatter: ["pingpong", "phone", "chair"] },
      public: { layers: ["hvac", "floor"], scatter: ["ticker", "step", "ding", "phone"] },
    };
    const always: LayerName[] = ["room", "murmur", "tension"];
    const everywhere: ScatterName[] = ["keys", "mouse"];
    for (const phase of PHASES) {
      const t = at({ phase, teamSize: 20 });
      for (const name of LAYER_NAMES) {
        if (always.includes(name)) continue;
        expect(t.layers[name] > 0, `${phase} layer ${name}`).toBe(colour[phase].layers.includes(name));
      }
      for (const name of SCATTER_NAMES) {
        if (everywhere.includes(name)) continue;
        expect(t.rates[name] > 0, `${phase} scatter ${name}`).toBe(colour[phase].scatter.includes(name));
        if (t.rates[name] > 0) expect(t.gains[name], `${phase} gain ${name}`).toBeGreaterThan(0);
      }
      expect(t.lobby).toBe(phase === "public");
      expect(t.layers.room).toBeGreaterThan(0);
    }
  });

  it("never produces a negative, NaN or absurd value, whatever it is fed", () => {
    const rand = mulberry32(2024);
    for (let i = 0; i < 400; i += 1) {
      const state: AmbienceState = {
        phase: PHASES[Math.floor(rand() * PHASES.length)],
        teamSize: Math.round((rand() - 0.2) * 300),
        morale: (rand() - 0.25) * 200,
        stress: (rand() - 0.25) * 200,
        dusk: (rand() - 0.25) * 2,
        runwayLow: rand() < 0.5,
        pendingEvent: rand() < 0.5,
        gameOver: rand() < 0.1,
        setupComplete: rand() < 0.9,
        worldVisible: rand() < 0.9,
      };
      const t = ambienceTargets(state);
      const values = [t.master, t.warmth, t.keyEnergy, ...Object.values(t.layers), ...Object.values(t.rates), ...Object.values(t.gains)];
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(t.master).toBeLessThanOrEqual(1);
      expect(t.warmth).toBeGreaterThanOrEqual(2000);
      expect(t.rates.keys).toBeLessThan(14);
      for (const name of LAYER_NAMES) expect(t.layers[name]).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("AmbienceDirector", () => {
  let h: Harness;
  let director: AmbienceDirector;

  const loops = (): FakeBufferSource[] => h.ctx.started.filter((source): source is FakeBufferSource => source instanceof FakeBufferSource && source.loop && source.stoppedAt === null);
  /** Run the scheduler for a while: the clock and the timers move together. */
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 0.2) {
      h.ctx.advance(0.2);
      vi.advanceTimersByTime(200);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    h = makeHarness();
    director = new AmbienceDirector(h.engine, { rand: mulberry32(11) });
  });

  afterEach(() => {
    director.dispose();
    h.engine.dispose();
    vi.useRealTimers();
  });

  it("waits for the unlock, then starts by itself", async () => {
    director.setState(ACTIVE);
    expect(director.running).toBe(false);
    expect(h.created()).toBe(0); // never forces audio on
    expect(vi.getTimerCount()).toBe(0);
    await h.unlock();
    expect(director.running).toBe(true);
    expect(loops().length).toBeGreaterThan(0);
  });

  it("uses a handful of long-lived nodes for the bed", async () => {
    await h.unlock();
    const before = h.ctx.nodes.length;
    director.setState({ ...ACTIVE, phase: "unicorn", teamSize: 60, stress: 95 });
    const built = h.ctx.nodes.length - before;
    expect(built).toBeGreaterThan(10);
    expect(built).toBeLessThan(70);
  });

  it("schedules key taps at a rate that follows head count", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, teamSize: 2 });
    run(30);
    const small = director.oneShotCount;
    director.setState({ ...ACTIVE, teamSize: 60 });
    run(30);
    const large = director.oneShotCount - small;
    expect(small).toBeGreaterThan(20);
    expect(large).toBeGreaterThan(small * 1.8);
    // Bounded: this is a texture, not a drum roll.
    expect(large / 30).toBeLessThan(16);
    expect(h.engine.error).toBeNull();
  });

  it("frees its one-shots as it goes", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, teamSize: 60 });
    run(60);
    expect(h.engine.voiceCount("ambience")).toBeLessThan(16);
    const connected = h.ctx.connected.length;
    run(60);
    // Nothing accumulates between one minute and the next.
    expect(h.ctx.connected.length).toBeLessThan(connected + 80);
  });

  it("swaps the phase colour and retires the old layers", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, phase: "garage" });
    const garage = loops().length;
    director.setState({ ...ACTIVE, phase: "office" });
    expect(loops().length).toBeGreaterThan(garage); // hvac in, fridge still fading
    run(6);
    const settled = h.ctx.connected.length;
    director.setState({ ...ACTIVE, phase: "office" });
    run(6);
    expect(h.ctx.connected.length).toBeLessThanOrEqual(settled + 60);
  });

  it("routes the reverb to a marble lobby in the public phase only", async () => {
    await h.unlock();
    const convolvers = () => h.ctx.nodes.filter((node): node is FakeConvolver => node instanceof FakeConvolver && node.outputs.length > 0);
    director.setState({ ...ACTIVE, phase: "office" });
    expect(convolvers()).toHaveLength(1);
    director.setState({ ...ACTIVE, phase: "public" });
    expect(convolvers()).toHaveLength(2);
    const lobby = convolvers()[1];
    expect(lobby.buffer && lobby.buffer.duration).toBeGreaterThan(1.2);
    director.setState({ ...ACTIVE, phase: "unicorn" });
    run(6);
    expect(convolvers()).toHaveLength(1);
  });

  it("stops its timers and frees its nodes when hidden, muted, or not wanted", async () => {
    await h.unlock();
    const baseline = h.ctx.connected.length;
    const stopped = async (): Promise<void> => {
      expect(director.running).toBe(false);
      h.ctx.advance(1);
      vi.advanceTimersByTime(1000);
      expect(h.ctx.connected.length).toBe(baseline);
    };

    director.setState(ACTIVE);
    run(2);
    expect(director.running).toBe(true);
    director.setState({ ...ACTIVE, worldVisible: false });
    await stopped();

    director.setState(ACTIVE);
    expect(director.running).toBe(true);
    h.settings.setBusMuted("ambience", true);
    await stopped();
    h.settings.setBusMuted("ambience", false);
    expect(director.running).toBe(true);

    h.settings.setMuted(true);
    await stopped();
    h.settings.setMuted(false);
    expect(director.running).toBe(true);

    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    await stopped();
    h.doc.visibilityState = "visible";
    h.doc.dispatch("visibilitychange");
    expect(director.running).toBe(true);
  });

  it("comes straight back if it is wanted again before the fade-out finishes", async () => {
    await h.unlock();
    director.setState(ACTIVE);
    const built = h.ctx.nodes.length;
    director.setState({ ...ACTIVE, worldVisible: false });
    director.setState(ACTIVE);
    expect(director.running).toBe(true);
    expect(h.ctx.nodes.length).toBe(built); // reused, not rebuilt
  });

  it("does not queue a backlog while the clock is stopped", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, teamSize: 60 });
    run(2);
    const before = director.oneShotCount;
    // Timers keep firing but the audio clock does not move (a stalled or suspended context).
    vi.advanceTimersByTime(20_000);
    expect(director.oneShotCount).toBe(before);
  });

  it("after a long frame it draws afresh instead of firing the whole backlog on one sample", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, phase: "unicorn", teamSize: 60, morale: 100 });
    run(4);
    // The audio clock runs 3 s while the page's timers are blocked (the office rebuilding)…
    const perTick: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const count = director.oneShotCount;
      run(0.2);
      perTick.push(director.oneShotCount - count);
    }
    h.ctx.advance(3);
    const count = director.oneShotCount;
    vi.advanceTimersByTime(200); // …then one tick catches up.
    const catchUp = director.oneShotCount - count;
    // It schedules about one lookahead's worth, not the 3 s it missed piled onto "now".
    const typical = perTick.reduce((a, b) => a + b, 0) / perTick.length;
    expect(catchUp).toBeLessThanOrEqual(Math.max(14, typical * 6));
  });

  it("every noise loop drifts in speed, so the bed never comes round sample-for-sample", async () => {
    await h.unlock();
    director.setState({ ...ACTIVE, phase: "office", teamSize: 30 });
    const audible = loops().filter((source) => source.playbackRate.value > 0.05);
    expect(audible.length).toBeGreaterThan(3);
    for (const source of audible) expect(source.playbackRate.inputs.length, "a drift modulates its read speed").toBe(1);
  });

  it("dispose leaves no timers and no nodes", async () => {
    await h.unlock();
    const baseline = h.ctx.connected.length;
    director.setState({ ...ACTIVE, phase: "public", teamSize: 30 });
    run(3);
    director.setState({ ...ACTIVE, worldVisible: false }); // a teardown timer is pending
    director.dispose();
    h.engine.stopAll();
    h.ctx.advance(5);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.ctx.connected.length).toBe(baseline);
    director.setState(ACTIVE);
    expect(director.running).toBe(false);
  });

  it("renders offline with no timers at all", () => {
    const { ctx, engine } = makeOfflineHarness(4);
    const offline = new AmbienceDirector(engine, { rand: mulberry32(4) });
    offline.setState({ ...ACTIVE, teamSize: 20 });
    expect(vi.getTimerCount()).toBe(0);
    offline.renderOffline(30);
    expect(vi.getTimerCount()).toBe(0);
    expect(offline.oneShotCount).toBeGreaterThan(50);
    const starts = ctx.started.map((source) => source.startedAt ?? -1);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...starts)).toBeLessThan(31.5);
    expect(engine.error).toBeNull();
    offline.dispose();
    engine.dispose();
  });

  it("offline, a silent state renders nothing", () => {
    const { ctx, engine } = makeOfflineHarness(4);
    const offline = new AmbienceDirector(engine, { rand: mulberry32(4) });
    offline.setState({ ...ACTIVE, worldVisible: false });
    offline.renderOffline(10);
    expect(ctx.started).toHaveLength(0);
    offline.dispose();
    engine.dispose();
  });
});

describe("AmbienceDirector before it knows anything", () => {
  it("plays nothing until it has been given a state", async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const director = new AmbienceDirector(h.engine);
    await h.unlock();
    expect(director.running).toBe(false);
    expect(h.ctx.started).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    director.dispose();
    h.engine.dispose();
    vi.useRealTimers();
  });
});
