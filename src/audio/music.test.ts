import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPhase } from "../types/game";
import { MusicDirector, MusicPlanner, type MusicEvent, type MusicMood } from "./music";
import { mulberry32 } from "./synth";
import { makeHarness, reaches, type FakeNode, type Harness } from "./testing/fakeAudio";

const mood = (patch: Partial<MusicMood> = {}): MusicMood => ({ phase: "office", stress: 20, active: true, ...patch });

const pitchClass = (freq: number): number => ((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12;

/** D E F♯ A B. */
const D_PENTATONIC = new Set([2, 4, 6, 9, 11]);
/** Pitch classes of each key the music visits. */
const MAJOR_SCALE = (tonic: number): Set<number> => new Set([0, 2, 4, 5, 7, 9, 11].map((step) => (tonic + step) % 12));
/** Every phase stays in D major (pads in G or A would put C♮ / G♯ under the D-major stingers). */
const KEY_OF_PHASE: Record<CompanyPhase, number> = { garage: 2, coworking: 2, office: 2, unicorn: 2, public: 2 };

const pads = (events: MusicEvent[]) => events.filter((event): event is Extract<MusicEvent, { type: "pad" }> => event.type === "pad");
const plucks = (events: MusicEvent[]) => events.filter((event): event is Extract<MusicEvent, { type: "pluck" }> => event.type === "pluck");

describe("MusicPlanner", () => {
  it("is deterministic for a seed", () => {
    const a = new MusicPlanner(mulberry32(7)).plan(0, 120, mood());
    const b = new MusicPlanner(mulberry32(7)).plan(0, 120, mood());
    const c = new MusicPlanner(mulberry32(8)).plan(0, 120, mood());
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("gives the same music whether planned in one go or in small windows", () => {
    const whole = new MusicPlanner(mulberry32(3)).plan(0, 60, mood());
    const planner = new MusicPlanner(mulberry32(3));
    const pieces: MusicEvent[] = [];
    for (let t = 0; t < 60; t += 1.5) pieces.push(...planner.plan(t, t + 1.5, mood()));
    // (a phrase of plucks can run past the window it started in, so sort before comparing)
    expect(pieces.sort((a, b) => a.at - b.at)).toEqual(whole);
  });

  it("returns events inside the window, in order", () => {
    const planner = new MusicPlanner(mulberry32(1));
    let previousEnd = 0;
    for (let window = 0; window < 40; window += 1) {
      const from = previousEnd;
      const to = from + 1.5;
      const events = planner.plan(from, to, mood());
      for (let i = 0; i < events.length; i += 1) {
        // A phrase of plucks may run a little past the window it started in.
        expect(events[i].at).toBeGreaterThanOrEqual(from);
        expect(events[i].at).toBeLessThan(to + 2.5);
        if (i > 0) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
      }
      previousEnd = to;
    }
  });

  it("is a slow chord cycle with overlapping pads and sparse plucks — no pulse", () => {
    const events = new MusicPlanner(mulberry32(5)).plan(0, 300, mood());
    const chords = pads(events);
    expect(chords.length).toBeGreaterThan(25);
    expect(chords.length).toBeLessThan(45);
    for (let i = 1; i < chords.length; i += 1) {
      const gap = chords[i].at - chords[i - 1].at;
      expect(gap).toBeGreaterThan(6);
      expect(gap).toBeLessThan(13);
      // Each chord is still sounding when the next one starts.
      expect(chords[i - 1].at + chords[i - 1].dur).toBeGreaterThan(chords[i].at + 3);
    }
    for (const chord of chords) {
      expect(chord.notes).toHaveLength(4);
      expect(Math.min(...chord.notes)).toBeGreaterThan(90); // nothing boomy
      expect(Math.max(...chord.notes)).toBeLessThan(800);
      expect(chord.bright).toBeGreaterThan(0);
      expect(chord.bright).toBeLessThanOrEqual(1);
    }
    const notes = plucks(events);
    expect(notes.length / 300).toBeLessThan(0.6); // sparse
    expect(notes.length).toBeGreaterThan(10);
    // No pulse: the gaps between plucks are all different.
    const gaps = notes.slice(1).map((note, i) => (note.at - notes[i].at).toFixed(4));
    expect(new Set(gaps).size).toBeGreaterThan(gaps.length * 0.9);
  });

  it("goes well over two minutes without repeating itself", () => {
    const events = new MusicPlanner(mulberry32(21)).plan(0, 600, mood());
    const chords = pads(events);
    // No two chords are the same voicing held for the same time…
    const signatures = chords.map((chord) => `${chord.chord}:${chord.notes.map((n) => n.toFixed(2)).join(",")}:${chord.dur.toFixed(5)}`);
    expect(new Set(signatures).size).toBe(signatures.length);
    // …and the chord sequence has no period: no stretch of four chords ever comes round again.
    const names = chords.map((chord) => `${chord.chord}:${chord.notes.map((n) => n.toFixed(1)).join(",")}`);
    const seen = new Set<string>();
    for (let i = 0; i + 4 <= names.length; i += 1) {
      const window = names.slice(i, i + 4).join(" | ");
      expect(seen.has(window), `chords ${i}…${i + 3} repeat an earlier stretch`).toBe(false);
      seen.add(window);
    }
    // The first two minutes and the next two are different music.
    const firstHalf = pads(events.filter((event) => event.at < 120)).map((chord) => chord.chord).join(" ");
    const secondHalf = pads(events.filter((event) => event.at >= 120 && event.at < 240)).map((chord) => chord.chord).join(" ");
    expect(firstHalf).not.toBe(secondHalf);
  });

  it("every pluck is a note of the game's D-major pentatonic, in every phase", () => {
    for (const phase of Object.keys(KEY_OF_PHASE) as CompanyPhase[]) {
      const events = new MusicPlanner(mulberry32(9)).plan(0, 400, mood({ phase }));
      const notes = plucks(events);
      expect(notes.length).toBeGreaterThan(5);
      for (const note of notes) {
        expect(D_PENTATONIC.has(pitchClass(note.freq)), `${phase}: ${note.freq.toFixed(1)} Hz`).toBe(true);
        expect(note.freq).toBeGreaterThan(250);
        expect(note.freq).toBeLessThan(1400);
        expect(Math.abs(note.pan)).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it("stays in D major in every phase — no pad tone a D-major stinger could rub against", () => {
    for (const [phase, tonic] of Object.entries(KEY_OF_PHASE) as Array<[CompanyPhase, number]>) {
      const scale = MAJOR_SCALE(tonic);
      for (const pc of D_PENTATONIC) expect(scale.has(pc), `${phase}: pentatonic note ${pc} is in the key`).toBe(true);
      const chords = pads(new MusicPlanner(mulberry32(13)).plan(0, 300, mood({ phase })));
      for (const chord of chords) {
        for (const freq of chord.notes) expect(scale.has(pitchClass(freq)), `${phase} ${chord.chord}: ${freq.toFixed(1)} Hz`).toBe(true);
      }
    }
    // The phases still differ: each leans toward its own home chord.
    const share = (phase: CompanyPhase, name: string): number => {
      const chords = pads(new MusicPlanner(mulberry32(21)).plan(0, 3000, mood({ phase, stress: 0 })));
      return chords.filter((chord) => chord.chord === name).length / chords.length;
    };
    expect(share("coworking", "IVmaj9")).toBeGreaterThan(share("office", "IVmaj9"));
    expect(share("unicorn", "Vsus")).toBeGreaterThan(share("office", "Vsus"));
  });

  it("stress leans on the minor chords, darkens the pad and thins the plucks", () => {
    const calm = new MusicPlanner(mulberry32(17)).plan(0, 3000, mood({ stress: 0 }));
    const tense = new MusicPlanner(mulberry32(17)).plan(0, 3000, mood({ stress: 100 }));
    const minorShare = (events: MusicEvent[]): number => {
      const chords = pads(events);
      return chords.filter((chord) => /^(vi|ii|iii)/.test(chord.chord)).length / chords.length;
    };
    const brightness = (events: MusicEvent[]): number => pads(events).reduce((sum, chord) => sum + chord.bright, 0) / pads(events).length;
    expect(minorShare(tense)).toBeGreaterThan(minorShare(calm) + 0.15);
    expect(brightness(tense)).toBeLessThan(brightness(calm) - 0.15);
    expect(plucks(tense).length).toBeLessThan(plucks(calm).length);
  });

  it("starts again cleanly after a reset", () => {
    const planner = new MusicPlanner(mulberry32(2));
    planner.plan(0, 50, mood());
    planner.reset();
    const events = planner.plan(100, 110, mood());
    expect(pads(events)[0].at).toBeGreaterThanOrEqual(100);
    expect(pads(events)[0].at).toBeLessThan(100.5);
  });

  it("after a stalled clock it carries on from now instead of replaying the backlog", () => {
    const planner = new MusicPlanner(mulberry32(4));
    planner.plan(0, 12, mood());
    // The context was interrupted for three minutes while the tab stayed visible.
    const events = planner.plan(192, 193.5, mood());
    expect(pads(events).length).toBeLessThanOrEqual(1);
    expect(plucks(events).length).toBeLessThanOrEqual(3);
    for (const event of events) expect(event.at).toBeGreaterThanOrEqual(192);
    // …and keeps going at its usual pace afterwards.
    const later = planner.plan(193.5, 260, mood());
    expect(pads(later).length).toBeGreaterThan(4);
    expect(pads(later).length).toBeLessThan(10);
  });
});

describe("MusicDirector", () => {
  let h: Harness;
  let director: MusicDirector;

  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 0.5) {
      h.ctx.advance(0.5);
      vi.advanceTimersByTime(500);
    }
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    h = makeHarness();
    await h.unlock();
    director = new MusicDirector(h.engine, { rand: mulberry32(6) });
  });

  afterEach(() => {
    director.dispose();
    h.engine.dispose();
    vi.useRealTimers();
  });

  it("ships off: nothing plays until the player turns it on", () => {
    expect(h.settings.get().musicEnabled).toBe(false);
    director.setMood(mood());
    run(20);
    expect(director.running).toBe(false);
    expect(h.ctx.started).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("plays on the music bus once enabled, and stops when disabled", () => {
    director.setMood(mood());
    h.settings.setMusicEnabled(true);
    expect(director.running).toBe(true);
    run(15);
    const music = h.engine.tap("music")?.dry as unknown as FakeNode;
    expect(h.ctx.started.length).toBeGreaterThan(0);
    expect(h.ctx.started.some((source) => reaches(source, music, true))).toBe(true);
    expect(h.engine.voiceCount("music")).toBeGreaterThan(0);
    for (const bus of ["ui", "outcome", "world", "ambience"] as const) expect(h.engine.voiceCount(bus)).toBe(0);

    h.settings.setMusicEnabled(false);
    expect(director.running).toBe(false);
    run(4);
    expect(h.engine.voiceCount("music")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rests before setup and after game over, and when muted or hidden", () => {
    h.settings.setMusicEnabled(true);
    director.setMood(mood({ active: false }));
    expect(director.running).toBe(false);
    director.setMood(mood());
    expect(director.running).toBe(true);
    h.settings.setBusMuted("music", true);
    expect(director.running).toBe(false);
    h.settings.setBusMuted("music", false);
    expect(director.running).toBe(true);
    h.doc.visibilityState = "hidden";
    h.doc.dispatch("visibilitychange");
    expect(director.running).toBe(false);
  });

  it("stays within the bus's voice budget over a long stretch", () => {
    h.settings.setMusicEnabled(true);
    director.setMood(mood({ phase: "unicorn" }));
    for (let i = 0; i < 40; i += 1) {
      run(10);
      // At any instant (voices already scheduled a beat ahead are counted when they start).
      expect(h.engine.voiceCount("music", true)).toBeLessThanOrEqual(6);
      expect(h.engine.voiceCount("music")).toBeLessThanOrEqual(9);
    }
    expect(h.engine.error).toBeNull();
  });

  it("dispose leaves no timers", () => {
    h.settings.setMusicEnabled(true);
    director.setMood(mood());
    run(5);
    director.dispose();
    h.ctx.advance(30);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    director.setMood(mood());
    expect(director.running).toBe(false);
  });
});
