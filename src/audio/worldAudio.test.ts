import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFX } from "../ui/sound";
import type { EndingType } from "../types/game";
import type { WorldEvent, WorldEventType } from "../world/types";
import { PAIRS, storeStingersFor } from "./dev/labPairs";
import { SOUNDS, type SoundName } from "./sounds";
import { mulberry32 } from "./synth";
import { FakeBufferSource, FakeNode, FakeOscillator, makeHarness, reaches, type Harness } from "./testing/fakeAudio";
import { SAMPLE_EVENTS, WORLD_EVENT_TYPES, describeEvent, makeSnapshot } from "./testing/fixtures";
import {
  CLICK_LIKE,
  HEARTBEAT,
  LOW_RUNWAY_WEEKS,
  MAX_CUES_PER_BATCH,
  MAX_MECHANICS_PER_BATCH,
  MECHANICS_SPACING,
  MECHANICS_STINGERS,
  STINGER_CLEARANCE,
  STING_DELAY,
  STING_LENGTH,
  STORE_STINGERS,
  SUPPORTING_EVENTS,
  SUPPORT_GAIN,
  ambienceStateFor,
  createWorldAudio,
  cuesForEvent,
  planCues,
  tonalOnset,
  type WorldAudio,
} from "./worldAudio";

/**
 * The mapping, written out: for every WorldEvent type, the sounds each sample in
 * SAMPLE_EVENTS produces (same order as the samples). Typed as a Record so that adding an
 * event type without deciding what it sounds like fails the build.
 */
const EXPECTED: Record<WorldEventType, SoundName[][]> = {
  "run-reset": [[]],
  "setup-completed": [["setup-complete", "door-open", "footsteps", "chair-sit"]],
  "week-advanced": [["week-advance"]],
  hired: [
    ["door-open", "hire-arrival", "footsteps", "door-close", "chair-sit"],
    ["door-open", "hire-arrival", "footsteps", "footsteps", "footsteps", "chair-sit", "door-close", "chair-sit", "chair-sit"],
    ["door-open", "hire-arrival", "door-close"],
  ],
  departed: [["footsteps", "departure"]],
  ship: [
    ["keyboard-flurry", "ship-ok"],
    ["keyboard-flurry", "ship-fail", "smoke-puff"],
  ],
  launch: [["launch-ok", "users-trickle"], ["launch-ok"], ["launch-fail"]],
  pitch: [
    ["phone-ring", "pitch-ok"],
    ["phone-ring", "pitch-fail"],
  ],
  raise: [["raise-ok", "money-flutter", "confetti-pops"], ["raise-ok", "money-flutter"], ["raise-fail"]],
  "board-action": [["board-dinner"], ["board-gift"], ["board-blackmail"], ["board-blackmail", "smoke-puff"]],
  "pricing-changed": [["pricing-flip"]],
  "cash-changed": [["money-flutter"], ["coins-out"]],
  "users-changed": [["users-trickle"], []],
  "phase-changed": [["phase-change", "confetti-pops"]],
  "stage-changed": [["stage-change", "confetti-pops"]],
  "asset-acquired": [
    ["asset-acquired", "asset-office-upgrade"],
    ["asset-acquired", "asset-lounge"],
    ["asset-acquired", "asset-helicopter"],
    ["asset-acquired", "asset-jet"],
    ["asset-acquired", "asset-yacht"],
  ],
  "event-opened": [["event-beacon"]],
  "event-resolved": [["event-resolved"]],
  "easter-egg": [["footsteps", "coffee"], []],
  "command-failed": [["ui-denied"]],
  "game-over": [
    ["confetti-pops", "crowd-cheer"],
    ["confetti-pops", "crowd-cheer"],
    ["confetti-pops", "crowd-cheer"],
    ["power-down", "smoke-puff"],
    ["power-down", "smoke-puff"],
    ["power-down", "smoke-puff"],
    ["power-down", "smoke-puff"],
  ],
  // Tick-driven: heard only in a week's batch (see "a bad week is a sigh…").
  "offer-landed": [[]],
  retained: [["money-flutter"]],
  resigned: [[]],
  staffed: [[], []],
  experience: [[]],
  "energy-band": [[], [], []],
  "candidates-shown": [["neutral"]],
  "build-started": [["project-started"]],
  "build-cancelled": [["smoke-puff"]],
  released: [
    ["keyboard-flurry", "confetti-pops", "crowd-cheer"],
    ["keyboard-flurry", "confetti-pops"],
    ["keyboard-flurry", "confetti-pops"],
    ["keyboard-flurry", "ship-fail", "smoke-puff"],
  ],
  "build-progress": [[], [], []],
  surprise: [[]],
  "crunch-changed": [["coffee-pour"], []],
  "cruft-band": [["smoke-puff"], []],
  "moat-band": [[]],
};

const ALL_SAMPLES: Array<[string, WorldEvent, SoundName[]]> = WORLD_EVENT_TYPES.flatMap((type) =>
  SAMPLE_EVENTS[type].map((event, i): [string, WorldEvent, SoundName[]] => [describeEvent(event), event, EXPECTED[type][i]]),
);

const soundsOf = (events: readonly WorldEvent[]): SoundName[] => planCues(events).map((cue) => cue.sound);

describe("WorldEvent → sounds", () => {
  it("has an expectation for every sample of every event type", () => {
    for (const type of WORLD_EVENT_TYPES) expect(EXPECTED[type], type).toHaveLength(SAMPLE_EVENTS[type].length);
    expect(WORLD_EVENT_TYPES).toHaveLength(36);
  });

  it.each(ALL_SAMPLES)("%s", (_label, event, expected) => {
    const cues = planCues([event]);
    expect(cues.map((cue) => cue.sound)).toEqual(expected);
    for (const cue of cues) {
      expect(cue.sound in SOUNDS, cue.sound).toBe(true);
      expect(cue.delay).toBeGreaterThanOrEqual(0);
      expect(cue.delay).toBeLessThanOrEqual(3); // three hires walking in is the longest sequence
    }
    // In time order.
    for (let i = 1; i < cues.length; i += 1) expect(cues[i].delay).toBeGreaterThanOrEqual(cues[i - 1].delay);
  });

  it("is silent (not an exception) for an event type it has never heard of — the switch is exhaustive at compile time", () => {
    expect(cuesForEvent({ type: "meteor-strike" } as unknown as WorldEvent)).toEqual([]);
    expect(planCues([{ type: "meteor-strike" } as unknown as WorldEvent, { type: "ship", ok: true, reputationDelta: 1 }]).length).toBeGreaterThan(0);
    // A malformed hire (no personIds) still opens the door instead of throwing.
    expect(soundsOf([{ type: "hired", role: "ops" } as unknown as WorldEvent])).toContain("door-open");
  });

  it("scales the coins with the size of the raise", () => {
    const small = cuesForEvent({ type: "raise", ok: true, amount: 5_000, source: "vc" })[0];
    const large = cuesForEvent({ type: "raise", ok: true, amount: 20_000_000, source: "vc" })[0];
    expect(small.sound).toBe("raise-ok");
    expect(small.options?.intensity ?? 0).toBeLessThan(large.options?.intensity ?? 0);
    expect(large.options?.intensity).toBeLessThanOrEqual(1);
    expect(small.options?.intensity).toBeGreaterThanOrEqual(0);
  });

  it("gives each week a chime variant and each hire a stable seat", () => {
    expect(cuesForEvent({ type: "week-advanced", week: 7 })[0].options?.variant).toBe(7);
    const seat = (id: string) => cuesForEvent({ type: "hired", role: "engineering", personIds: [id] }).find((cue) => cue.sound === "chair-sit")?.options?.pan;
    expect(seat("engineering-3")).toBe(seat("engineering-3"));
    expect(Math.abs(seat("engineering-3") ?? 9)).toBeLessThanOrEqual(0.5);
  });
});

describe("no double hits", () => {
  it("knows which SFX stinger the store plays for every event type", () => {
    const facade = new Set(Object.keys(SFX));
    for (const type of WORLD_EVENT_TYPES) {
      const overlap = STORE_STINGERS[type];
      expect(["always", "sometimes", "never"]).toContain(overlap.when);
      expect(overlap.when === "never", type).toBe(overlap.which.length === 0);
      for (const name of overlap.which) expect(facade.has(name), `${type}: SFX.${name}`).toBe(true);
    }
    // The ones the store's code makes unconditional.
    expect(STORE_STINGERS["week-advanced"]).toEqual({ when: "always", which: ["tick"] });
    // Not for a chained event (one resolved and the next opened by the same choice).
    expect(STORE_STINGERS["event-opened"]).toEqual({ when: "sometimes", which: ["alert"] });
    expect(STORE_STINGERS["game-over"]).toEqual({ when: "always", which: ["gameOver"] });
    // And the moments where the world layer is the only voice.
    for (const type of ["run-reset", "setup-completed", "easter-egg", "command-failed"] as const) expect(STORE_STINGERS[type].when).toBe("never");
  });

  it.each(ALL_SAMPLES)("%s: the world layer never plays a stinger (bar the mechanics ones, where the store has none)", (_label, event) => {
    const storeIsQuiet = STORE_STINGERS[event.type].which.every((name) => CLICK_LIKE.has(name));
    for (const cue of planCues([event])) {
      const def = SOUNDS[cue.sound];
      if (def.bus === "outcome") {
        // Rule 1's exception: a generic mechanics stinger, for a moment the store meets with a click at most.
        expect(MECHANICS_STINGERS.has(cue.sound), cue.sound).toBe(true);
        expect(storeIsQuiet, `${event.type} can come with a real store stinger`).toBe(true);
        continue;
      }
      expect(def.kind, cue.sound).not.toBe("stinger");
      expect(["world", "ui"]).toContain(def.bus);
    }
  });

  it("mechanics stingers only ever voice events the store answers with a tick or a click at most", () => {
    for (const [, event] of ALL_SAMPLES) {
      for (const cue of planCues([event])) {
        if (!MECHANICS_STINGERS.has(cue.sound)) continue;
        for (const name of STORE_STINGERS[event.type].which) expect(CLICK_LIKE.has(name), `${event.type}: SFX.${name}`).toBe(true);
      }
    }
    for (const name of MECHANICS_STINGERS) expect(SOUNDS[name].bus, name).toBe("outcome");
  });

  it("a bad week is a sigh, not a fanfare of woe: mechanics stingers are capped and spaced, after the sunrise", () => {
    const week: WorldEvent[] = [
      { type: "week-advanced", week: 20 },
      { type: "build-progress", buildId: "b1", from: 60, to: 45 },
      { type: "surprise", buildId: "b2" },
      { type: "offer-landed", personId: "e4", kind: "recruiter", buildAtRisk: null },
      { type: "energy-band", personId: "e5", band: "fumes" },
    ];
    const cues = planCues(week);
    const mechanics = cues.filter((cue) => MECHANICS_STINGERS.has(cue.sound));
    expect(mechanics).toHaveLength(MAX_MECHANICS_PER_BATCH);
    const chime = cues.find((cue) => cue.sound === "week-advance");
    for (const cue of mechanics) expect(cue.delay).toBeGreaterThan((chime?.delay ?? 0) + 1.1);
    for (let i = 1; i < mechanics.length; i += 1) expect(mechanics[i].delay - mechanics[i - 1].delay).toBeGreaterThanOrEqual(MECHANICS_SPACING - 1e-9);
    // The same news arriving any other way comes with a store stinger: the world stays out of its way.
    expect(planCues([{ type: "surprise", buildId: "b2" }])).toEqual([]);
  });

  it.each([
    [{ type: "offer-landed", personId: "e4", kind: "recruiter", buildAtRisk: null }, "resignation"],
    [{ type: "build-progress", buildId: "b1", from: 88, to: 100 }, "project-progress"],
    [{ type: "build-progress", buildId: "b1", from: 60, to: 45 }, "negative-small"],
    [{ type: "surprise", buildId: "b1" }, "negative-small"],
    [{ type: "energy-band", personId: "e5", band: "burnt-out" }, "negative-small"],
  ] as Array<[WorldEvent, SoundName]>)("at a week's end: %o → %s", (event, sound) => {
    const cues = planCues([{ type: "week-advanced", week: 9 }, event]);
    expect(cues.map((c) => c.sound)).toEqual(["week-advance", sound]);
    // After the sunrise chime has had its moment.
    expect(cues[1].delay).toBeGreaterThan(1.5);
    // A week that only moved a build along is just a week.
    expect(soundsOf([{ type: "week-advanced", week: 9 }, { type: "build-progress", buildId: "b1", from: 10, to: 30 }])).toEqual(["week-advance"]);
  });

  it("a release speaks through the store's tier sound; the room adds a size-matched answer", () => {
    const pops = (tier: "breakout" | "solid" | "shrug") =>
      planCues([{ type: "released", buildId: "b1", name: "Halo", tier, reception: 70 }]).find((cue) => cue.sound === "confetti-pops")?.options?.intensity ?? 0;
    expect(pops("breakout")).toBeGreaterThan(pops("solid"));
    expect(pops("solid")).toBeGreaterThan(pops("shrug"));
    // Supporting level: the tier stinger is the loudest thing in the moment.
    for (const cue of planCues([{ type: "released", buildId: "b1", name: "Halo", tier: "breakout", reception: 96 }])) {
      expect(cue.options?.gain ?? 1, cue.sound).toBeCloseTo(SUPPORT_GAIN, 6);
    }
    // A kickoff's or a retention's price is not announced as a cash change.
    expect(soundsOf([{ type: "build-started", buildId: "b1" }, { type: "cash-changed", delta: -2_000 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "retained", personId: "e1" }, { type: "cash-changed", delta: -7_000 }])).not.toContain("coins-out");
  });

  it.each(ALL_SAMPLES)("%s: nothing pitched lands on top of the store's stinger", (_label, event) => {
    if (STORE_STINGERS[event.type].when === "never") return;
    for (const cue of planCues([event])) {
      const onset = tonalOnset(cue);
      if (onset !== null) expect(onset, `${cue.sound} is pitched ${onset.toFixed(2)} s after the event`).toBeGreaterThanOrEqual(STINGER_CLEARANCE - 1e-9);
    }
  });

  it("nothing pitched under the game-over sting: a loss's power-down waits until the sting has rung out", () => {
    for (const event of SAMPLE_EVENTS["game-over"]) {
      if (event.type !== "game-over") continue;
      const clear = STING_DELAY + STING_LENGTH[event.ending];
      for (const cue of planCues([event])) {
        const onset = tonalOnset(cue);
        if (onset !== null) expect(onset, `${event.ending}: ${cue.sound}`).toBeGreaterThanOrEqual(clear - 1e-9);
      }
    }
  });

  it("the world layer of a moment the store always answers with a real stinger plays as a supporting layer", () => {
    for (const type of WORLD_EVENT_TYPES) {
      const overlap = STORE_STINGERS[type];
      if (overlap.when !== "always" || overlap.which.every((name) => CLICK_LIKE.has(name))) continue;
      expect(SUPPORTING_EVENTS.has(type), type).toBe(true);
    }
    // The week's tick is a click, not a stinger: the sunrise is the week's own moment.
    expect(SUPPORTING_EVENTS.has("week-advanced")).toBe(false);
    for (const event of SAMPLE_EVENTS.ship) {
      for (const cue of planCues([event])) expect(cue.options?.gain, cue.sound).toBeCloseTo(SUPPORT_GAIN, 6);
    }
    expect(planCues([{ type: "week-advanced", week: 3 }])[0].options?.gain).toBeUndefined();
  });

  it("the only non-diegetic sounds the world layer uses are the UI thud for a refused command and the mechanics stingers", () => {
    const used = new Set(ALL_SAMPLES.flatMap(([, event]) => soundsOf([event])));
    const nonDiegetic = [...used].filter((name) => SOUNDS[name].kind !== "diegetic" && !MECHANICS_STINGERS.has(name));
    expect(nonDiegetic).toEqual(["ui-denied"]);
  });
});

describe("batches of events", () => {
  it("run-reset silences the whole batch", () => {
    expect(planCues([{ type: "run-reset" }, { type: "ship", ok: true, reputationDelta: 2 }])).toEqual([]);
  });

  it("the weekly burn and user drift are not announced on top of the week itself", () => {
    const week: WorldEvent[] = [
      { type: "week-advanced", week: 9 },
      { type: "cash-changed", delta: -14_000 },
      { type: "users-changed", delta: 120 },
    ];
    expect(soundsOf(week)).toEqual(["week-advance"]);
    // Outside a week they do speak.
    expect(soundsOf(week.slice(1))).toEqual(["coins-out", "users-trickle"]);
  });

  it("a command's own price is not announced: a hire, a launch or a board action costs what it costs", () => {
    expect(soundsOf([{ type: "hired", role: "engineering", personIds: ["engineering-1"] }, { type: "cash-changed", delta: -3_000 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "launch", ok: true, usersDelta: 10 }, { type: "cash-changed", delta: -1_800 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "launch", ok: false, usersDelta: 0 }, { type: "cash-changed", delta: -900 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "board-action", action: "dinner", ok: true }, { type: "cash-changed", delta: -2_000 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "board-action", action: "gift", ok: true }, { type: "cash-changed", delta: -5_000 }])).not.toContain("coins-out");
    // A cash change with no command to explain it still speaks.
    expect(soundsOf([{ type: "event-resolved" }, { type: "cash-changed", delta: -5_000 }])).toContain("coins-out");
  });

  it("money and users are not announced twice: a raise, a purchase or a launch already tell that story", () => {
    expect(soundsOf([{ type: "raise", ok: true, amount: 50_000, source: "vc" }, { type: "cash-changed", delta: 50_000 }]).filter((s) => s === "money-flutter")).toHaveLength(1);
    expect(soundsOf([{ type: "asset-acquired", assetId: "jet" }, { type: "cash-changed", delta: -900_000 }])).not.toContain("coins-out");
    expect(soundsOf([{ type: "launch", ok: true, usersDelta: 300 }, { type: "users-changed", delta: 300 }]).filter((s) => s === "users-trickle")).toHaveLength(1);
    // A failed raise moves no money, so any cash change beside it still speaks.
    expect(soundsOf([{ type: "raise", ok: false, amount: 0, source: "vc" }, { type: "cash-changed", delta: -2_000 }])).toContain("coins-out");
  });

  it("an event that opens with the new week waits for the sunrise", () => {
    const alone = planCues([{ type: "event-opened", title: "x" }])[0];
    const withWeek = planCues([{ type: "week-advanced", week: 3 }, { type: "event-opened", title: "x" }]).find((cue) => cue.sound === "event-beacon");
    expect(alone.delay).toBeLessThan(1);
    expect(withWeek?.delay).toBeGreaterThan(1.5);
  });

  it("several roles hired at once share one door and one bell", () => {
    const sounds = soundsOf([
      { type: "hired", role: "engineering", personIds: ["engineering-0"] },
      { type: "hired", role: "design", personIds: ["design-0"] },
    ]);
    expect(sounds.filter((name) => name === "door-open")).toHaveLength(1);
    expect(sounds.filter((name) => name === "hire-arrival")).toHaveLength(1);
    expect(sounds.filter((name) => name === "footsteps")).toHaveLength(2);
    expect(sounds.filter((name) => name === "chair-sit")).toHaveLength(2);
  });

  it("a stage change that comes with a raise waits for the coins and brings no second confetti", () => {
    const cues = planCues([
      { type: "stage-changed", from: "seed", to: "series-a" },
      { type: "raise", ok: true, amount: 2_000_000, source: "vc" },
    ]);
    const stage = cues.find((cue) => cue.sound === "stage-change");
    const coins = cues.find((cue) => cue.sound === "raise-ok");
    expect(stage && coins && stage.delay > coins.delay + 1).toBe(true);
    expect(cues.filter((cue) => cue.sound === "confetti-pops")).toHaveLength(1);
  });

  it("caps how much one batch can schedule", () => {
    const flood: WorldEvent[] = [];
    for (const type of WORLD_EVENT_TYPES) if (type !== "run-reset") flood.push(...SAMPLE_EVENTS[type]);
    expect(planCues(flood).length).toBe(MAX_CUES_PER_BATCH);
  });

  it("a final `end` is unpitched from start to finish: no sunrise under the game-over sting", () => {
    // What deriveWorldEvents emits when the last week ends the run.
    const finale: WorldEvent[] = [
      { type: "phase-changed", from: "office", to: "unicorn" },
      { type: "departed", role: "design", personIds: ["design-0"] },
      { type: "week-advanced", week: 40 },
      { type: "event-resolved" },
      { type: "cash-changed", delta: -40_000 },
      { type: "event-opened", title: "x" },
      { type: "game-over", ending: "bankruptcy" },
    ];
    const cues = planCues(finale);
    // Nothing pitched until the sting has rung out — and then only the power going.
    for (const cue of cues) {
      const onset = tonalOnset(cue);
      if (onset !== null) expect(onset, cue.sound).toBeGreaterThanOrEqual(STING_DELAY + STING_LENGTH.bankruptcy - 1e-9);
    }
    // The room still reacts: people leave, the power goes.
    expect(cues.map((cue) => cue.sound)).toEqual(expect.arrayContaining(["footsteps", "departure", "power-down", "smoke-puff"]));
    expect(cues.some((cue) => cue.sound === "week-advance")).toBe(false);
  });

  it("a new office replaces the sunrise chime when both arrive with the same week", () => {
    const sounds = soundsOf([
      { type: "phase-changed", from: "coworking", to: "office" },
      { type: "week-advanced", week: 14 },
    ]);
    expect(sounds).toContain("phase-change");
    expect(sounds).not.toContain("week-advance");
    expect(soundsOf([{ type: "week-advanced", week: 14 }])).toEqual(["week-advance"]);
  });
});

/** SFX facade method for a stinger sound name. */
const facadeOf = (sound: SoundName): string => (sound.startsWith("gameover-") ? "gameOver" : sound === "cash-in" ? "cashIn" : sound);

describe("stinger + world pairs (the batches the lab renders together)", () => {
  it("every pair names stingers the store really plays for those events", () => {
    for (const spec of PAIRS) {
      expect(spec.stingers.length, spec.label).toBeGreaterThan(0);
      for (const s of spec.stingers) {
        expect(SOUNDS[s.sound].bus, `${spec.label}: ${s.sound}`).toBe("outcome");
        const allowed = spec.events.flatMap((event) => STORE_STINGERS[event.type].which);
        expect(allowed, `${spec.label}: SFX.${facadeOf(s.sound)}`).toContain(facadeOf(s.sound));
      }
    }
  });

  it("storeStingersFor mirrors the store: one result sound, + tick, + alert, + the sting 200 ms late", () => {
    expect(storeStingersFor([{ type: "raise", ok: true, amount: 1, source: "vc" }, { type: "stage-changed", from: "seed", to: "series-a" }])).toEqual([
      { sound: "cash-in", delay: 0 },
    ]);
    expect(storeStingersFor([{ type: "week-advanced", week: 2 }, { type: "event-opened", title: "x" }])).toEqual([
      { sound: "tick", delay: 0 },
      { sound: "alert", delay: 0 },
    ]);
    expect(storeStingersFor([{ type: "week-advanced", week: 9 }, { type: "game-over", ending: "ipo" }])).toEqual([
      { sound: "tick", delay: 0 },
      { sound: "gameover-ipo", delay: 0.2 },
    ]);
    expect(storeStingersFor([{ type: "easter-egg", command: "coffee" }])).toEqual([]);
  });

  it.each(PAIRS.map((spec): [string, (typeof PAIRS)[number]] => [spec.label, spec]))("%s: nothing pitched from the world lands on any of its stingers", (_label, spec) => {
    const cues = planCues(spec.events);
    expect(cues.length, "the world layer has something to say").toBeGreaterThan(0);
    for (const cue of cues) {
      expect(SOUNDS[cue.sound].bus, cue.sound).not.toBe("outcome");
      const onset = tonalOnset(cue);
      if (onset === null) continue;
      for (const s of spec.stingers) {
        // A game-over sting owns its whole length; any other stinger its first STINGER_CLEARANCE.
        const ending = s.sound.startsWith("gameover-") ? (s.sound.slice("gameover-".length) as EndingType) : null;
        const guard = ending ? STING_LENGTH[ending] : STINGER_CLEARANCE;
        const inside = onset >= s.delay - 1e-9 && onset < s.delay + guard - 1e-9;
        expect(inside, `${cue.sound} is pitched at ${onset.toFixed(2)} s, under ${s.sound} (${s.delay}–${(s.delay + guard).toFixed(2)} s)`).toBe(false);
      }
    }
  });
});

describe("ambienceStateFor", () => {
  it("derives dusk from action points until the world provides it", () => {
    const fresh = makeSnapshot({ ap: 3, maxAp: 3 });
    const spent = makeSnapshot({ ap: 0, maxAp: 3 });
    expect(ambienceStateFor(fresh, null, true).dusk).toBe(0);
    expect(ambienceStateFor(spent, null, true).dusk).toBe(1);
    expect(ambienceStateFor(spent, 0.25, true).dusk).toBe(0.25);
    expect(ambienceStateFor(makeSnapshot({ ap: 1, maxAp: 0 }), null, true).dusk).toBe(0);
  });

  it("maps the snapshot's flags", () => {
    const state = ambienceStateFor(
      makeSnapshot({ phase: "unicorn", teamSize: 31, morale: 12, stress: 88, runwayWeeks: LOW_RUNWAY_WEEKS, pendingEventTitle: "Audit", gameOver: "bankruptcy", setupComplete: false }),
      null,
      false,
    );
    expect(state).toMatchObject({ phase: "unicorn", teamSize: 31, morale: 12, stress: 88, runwayLow: true, pendingEvent: true, gameOver: true, setupComplete: false, worldVisible: false });
    expect(ambienceStateFor(makeSnapshot({ runwayWeeks: LOW_RUNWAY_WEEKS + 1 }), null, true).runwayLow).toBe(false);
  });
});

describe("createWorldAudio", () => {
  let h: Harness;
  let audio: WorldAudio;

  const busNode = (bus: "world" | "ui" | "ambience" | "music" | "outcome"): FakeNode => h.engine.tap(bus)?.dry as unknown as FakeNode;
  const newSources = (action: () => void): Array<FakeOscillator | FakeBufferSource> => {
    const before = new Set(h.ctx.started);
    action();
    return h.ctx.started.filter((source) => !before.has(source));
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    h = makeHarness();
    await h.unlock();
    // Keep the generative bed out of the way: these tests are about events.
    h.settings.setBusMuted("ambience", true);
    audio = createWorldAudio({ engine: h.engine, rand: () => 0.5 });
  });

  afterEach(() => {
    audio.dispose();
    h.engine.dispose();
    vi.useRealTimers();
  });

  it("plays the diegetic layer for events on the world bus", () => {
    const snapshot = makeSnapshot();
    const sources = newSources(() => audio.handleEvents([{ type: "ship", ok: true, reputationDelta: 3 }], snapshot));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => reaches(source, busNode("world")))).toBe(true);
    expect(sources.some((source) => reaches(source, busNode("outcome")))).toBe(false);
    expect(h.engine.voiceCount("world")).toBe(2); // keyboard flurry + ship-ok
    expect(h.engine.voiceCount("outcome")).toBe(0);
  });

  it("schedules cues at their delays", () => {
    audio.handleEvents([{ type: "pitch", ok: true }], makeSnapshot());
    const starts = h.ctx.started.map((source) => source.startedAt ?? 0);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(h.ctx.currentTime + 0.25);
    expect(Math.max(...starts)).toBeGreaterThan(h.ctx.currentTime + 1.2);
  });

  it("handles every sample event without error", () => {
    for (const type of WORLD_EVENT_TYPES) {
      for (const event of SAMPLE_EVENTS[type]) {
        expect(() => audio.handleEvents([event], makeSnapshot())).not.toThrow();
        h.ctx.advance(4);
        vi.advanceTimersByTime(300);
      }
    }
    expect(h.engine.error).toBeNull();
  });

  it("a refused command gets the UI thud — the only sound it gets", () => {
    const sources = newSources(() => audio.handleEvents([{ type: "command-failed", command: "ship" }], makeSnapshot()));
    expect(sources.some((source) => reaches(source, busNode("ui")))).toBe(true);
    expect(sources.some((source) => reaches(source, busNode("world")))).toBe(false);
  });

  it("with the 3D view hidden there are no diegetic sounds, but UI sounds still work", () => {
    audio.setWorldVisible(false);
    expect(newSources(() => audio.handleEvents([{ type: "raise", ok: true, amount: 1e6, source: "vc" }], makeSnapshot()))).toHaveLength(0);
    expect(newSources(() => audio.play("door-open"))).toHaveLength(0);
    expect(newSources(() => audio.ui.select()).length).toBeGreaterThan(0);
    audio.setWorldVisible(true);
    h.ctx.advance(1);
    expect(newSources(() => audio.play("door-open")).length).toBeGreaterThan(0);
  });

  it("hiding the view stops what was playing in the world", () => {
    audio.handleEvents([{ type: "phase-changed", from: "garage", to: "coworking" }], makeSnapshot());
    expect(h.engine.voiceCount("world")).toBeGreaterThan(0);
    audio.setWorldVisible(false);
    h.ctx.advance(0.5);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount("world")).toBe(0);
  });

  it("run-reset stops world sounds and plays nothing", () => {
    audio.handleEvents([{ type: "asset-acquired", assetId: "yacht" }], makeSnapshot());
    expect(h.engine.voiceCount("world")).toBeGreaterThan(0);
    expect(newSources(() => audio.handleEvents([{ type: "run-reset" }], makeSnapshot({ runId: 2 })))).toHaveLength(0);
    h.ctx.advance(0.5);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount("world")).toBe(0);
  });

  it.each(["hover", "select", "open", "close", "press", "prefill", "denied"] as const)("ui.%s plays on the ui bus", (method) => {
    const sources = newSources(() => audio.ui[method]());
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => reaches(source, busNode("ui")))).toBe(true);
    expect(h.engine.voiceCount("ui")).toBe(1);
  });

  it("ui.toggle and ui.zoom pick the direction", () => {
    expect(newSources(() => audio.ui.toggle(true)).length).toBeGreaterThan(0);
    h.ctx.advance(1);
    expect(newSources(() => audio.ui.toggle(false)).length).toBeGreaterThan(0);
    h.ctx.advance(1);
    expect(newSources(() => audio.ui.zoom(1)).length).toBeGreaterThan(0);
    expect(newSources(() => audio.ui.zoom(-1)).length).toBeGreaterThan(0);
  });

  it("hover cannot machine-gun", () => {
    let played = 0;
    for (let i = 0; i < 20; i += 1) {
      played += newSources(() => audio.ui.hover()).length > 0 ? 1 : 0;
      h.ctx.advance(0.005);
    }
    expect(played).toBeLessThanOrEqual(3);
    expect(played).toBeGreaterThanOrEqual(1);
  });

  describe("low-runway heartbeat", () => {
    const pulses = (): number => h.ctx.started.filter((source) => source instanceof FakeOscillator && source.frequency.events[0].value > 280 && source.frequency.events[0].value < 300).length;
    const wait = (seconds: number): void => {
      for (let t = 0; t < seconds; t += 0.25) {
        h.ctx.advance(0.25);
        vi.advanceTimersByTime(250);
      }
    };

    it("beats a short burst when the runway turns short, then falls silent — never a loop", () => {
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 12 }));
      expect(vi.getTimerCount()).toBe(0);
      audio.setSnapshot(makeSnapshot({ runwayWeeks: LOW_RUNWAY_WEEKS }));
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
      wait(60);
      expect(pulses()).toBe(HEARTBEAT.onset);
      // A minute later: silence, and no timer left running for it.
      wait(60);
      expect(pulses()).toBe(HEARTBEAT.onset);
    });

    it("reminds briefly at each new week while the runway stays short, and when it gets worse", () => {
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 4 }));
      wait(30);
      const afterOnset = pulses();
      audio.handleEvents([{ type: "week-advanced", week: 13 }], makeSnapshot({ runwayWeeks: 4, week: 13 }));
      wait(30);
      expect(pulses() - afterOnset).toBe(HEARTBEAT.weekly);
      const afterWeek = pulses();
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 2, week: 13 }));
      wait(30);
      expect(pulses() - afterWeek).toBe(HEARTBEAT.worse);
    });

    it("each burst starts strong and eases off; the gaps between beats are not identical", () => {
      const levels = (): number[] => {
        const gains: number[] = [];
        for (const node of h.ctx.nodes) {
          // The voice's own gain is the one connected straight to the world bus (or its panner).
          if (node.kind === "gain" && node.everConnected.includes(busNode("world"))) gains.push((node as unknown as { gain: { value: number } }).gain.value);
        }
        return gains;
      };
      const audioJitter = createWorldAudio({ engine: h.engine, rand: mulberry32(3) });
      audio.dispose();
      audio = audioJitter;
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 3 }));
      const starts: number[] = [];
      for (let i = 0; i < 400; i += 1) {
        const before = pulses();
        h.ctx.advance(0.05);
        vi.advanceTimersByTime(50);
        if (pulses() > before) starts.push(h.ctx.currentTime);
      }
      const heard = levels();
      expect(heard.length).toBe(HEARTBEAT.onset);
      expect(heard[heard.length - 1]).toBeLessThan(heard[0] * 0.8);
      expect(heard[heard.length - 1]).toBeGreaterThan(heard[0] * 0.35);
      const gaps = starts.slice(1).map((t, i) => t - starts[i]);
      expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(1);
    });

    it("is off before setup, after game over, with an event card open, with the view hidden, and while muted", () => {
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 2, setupComplete: false }));
      expect(vi.getTimerCount()).toBe(0);
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 2, gameOver: "bankruptcy" }));
      expect(vi.getTimerCount()).toBe(0);
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 2, pendingEventTitle: "Audit" }));
      wait(20);
      expect(pulses()).toBe(0);
      audio.setSnapshot(makeSnapshot({ runwayWeeks: 2 }));
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
      audio.setWorldVisible(false);
      vi.advanceTimersByTime(300);
      expect(vi.getTimerCount()).toBe(0);
      audio.setWorldVisible(true);
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
      h.settings.setBusMuted("world", true);
      vi.advanceTimersByTime(300);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("one click that selects and opens a card plays one blip, not two", () => {
    expect(newSources(() => audio.ui.select()).length).toBeGreaterThan(0);
    expect(newSources(() => audio.ui.open())).toHaveLength(0);
    vi.advanceTimersByTime(200);
    h.ctx.advance(0.2);
    expect(newSources(() => audio.ui.open()).length).toBeGreaterThan(0);
  });

  it("never throws into the caller, whatever it is fed", () => {
    expect(() => audio.handleEvents([{ type: "office-flooded" } as unknown as WorldEvent], makeSnapshot())).not.toThrow();
    expect(() => audio.handleEvents([null as unknown as WorldEvent], makeSnapshot())).not.toThrow();
    expect(() => audio.handleEvents(undefined as unknown as WorldEvent[], makeSnapshot())).not.toThrow();
    expect(() => audio.setSnapshot({} as unknown as ReturnType<typeof makeSnapshot>)).not.toThrow();
    expect(() => audio.setDusk(Number.NaN)).not.toThrow();
  });

  it("leaves out the sounds the world says it will play itself", () => {
    const own = createWorldAudio({ engine: h.engine, omit: ["footsteps", "chair-sit"] });
    own.handleEvents([{ type: "hired", role: "engineering", personIds: ["engineering-0"] }], makeSnapshot());
    // door, bell and the door closing remain; the steps and the chair are the world's to trigger.
    expect(h.engine.voiceCount("world")).toBe(3);
    expect(newSources(() => own.play("footsteps", { steps: 2 })).length).toBeGreaterThan(0);
    own.dispose();
  });

  it("dispose: nothing the world had queued starts afterwards, and the bed fades instead of cutting", () => {
    h.settings.setBusMuted("ambience", false);
    audio.setSnapshot(makeSnapshot({ phase: "office", teamSize: 20, runwayWeeks: 2 }));
    h.ctx.advance(5);
    vi.advanceTimersByTime(5000);
    audio.handleEvents([{ type: "hired", role: "sales", personIds: ["sales-0", "sales-1", "sales-2"] }], makeSnapshot({ teamSize: 23, runwayWeeks: 2 }));
    const disposedAt = h.ctx.currentTime;
    // The bed's output gain feeds its warmth filter, which feeds the ambience bus.
    const bedGains = h.ctx.nodes.filter((node) => node.kind === "gain" && node.everConnected.some((next) => next instanceof FakeNode && next.kind === "biquad" && next.everConnected.includes(busNode("ambience"))));
    expect(bedGains.length).toBeGreaterThan(0);
    audio.dispose();
    // Every world voice still to come was dropped (cut loose from the bus before it could
    // start); those already sounding fade out within 0.15 s.
    const queued = h.ctx.started.filter((source) => (source.startedAt ?? 0) > disposedAt + 0.2 && reaches(source, busNode("world"), true));
    expect(queued.length).toBeGreaterThan(0);
    for (const source of queued) expect(reaches(source, busNode("world")), `a source due at +${((source.startedAt ?? 0) - disposedAt).toFixed(2)} s`).toBe(false);
    h.ctx.advance(0.2);
    vi.advanceTimersByTime(300);
    expect(h.engine.voiceCount("world")).toBe(0);
    // The bed was faded toward zero, not stopped mid-waveform.
    expect(bedGains.some((gain) => (gain as unknown as { gain: { events: Array<{ type: string; value: number }> } }).gain.events.some((e) => e.type === "target" && e.value === 0))).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose leaves no timers and ignores everything afterwards", () => {
    h.settings.setBusMuted("ambience", false);
    h.settings.setMusicEnabled(true);
    audio.setSnapshot(makeSnapshot({ runwayWeeks: 2 }));
    audio.handleEvents([{ type: "hired", role: "sales", personIds: ["sales-0"] }], makeSnapshot({ runwayWeeks: 2 }));
    expect(vi.getTimerCount()).toBeGreaterThan(1); // heartbeat, ambience scheduler, music scheduler, sweeper
    audio.dispose();
    h.ctx.advance(1);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.engine.voiceCount()).toBe(0);
    const count = h.ctx.started.length;
    audio.setSnapshot(makeSnapshot());
    audio.handleEvents([{ type: "ship", ok: true, reputationDelta: 1 }], makeSnapshot());
    audio.ui.select();
    audio.setDusk(1);
    audio.setWorldVisible(false);
    expect(h.ctx.started.length).toBe(count);
    expect(() => audio.dispose()).not.toThrow();
    // The shared engine is still alive for everyone else.
    expect(h.engine.state).toBe("running");
  });

  it("works before audio is unlocked, and in node with no audio at all", () => {
    const locked = makeHarness();
    const early = createWorldAudio({ engine: locked.engine });
    expect(() => {
      early.setSnapshot(makeSnapshot({ runwayWeeks: 1 }));
      early.handleEvents([{ type: "week-advanced", week: 2 }], makeSnapshot());
      early.ui.hover();
      early.setDusk(0.5);
      early.dispose();
    }).not.toThrow();
    expect(locked.created()).toBe(0);
    locked.engine.dispose();

    const silent = makeHarness({ activated: true, createContext: () => null });
    const none = createWorldAudio({ engine: silent.engine });
    expect(() => {
      none.setSnapshot(makeSnapshot());
      none.handleEvents(SAMPLE_EVENTS.hired, makeSnapshot());
      none.dispose();
    }).not.toThrow();
    silent.engine.dispose();
  });
});
