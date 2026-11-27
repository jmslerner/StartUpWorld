import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSharedAudioEngine } from "../audio/engine";
import { makeHarness, type Harness } from "../audio/testing/fakeAudio";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { eraIndexOf, upcomingShift } from "../engine/career";
import type { CareerRecord, Milestone } from "../state/careerRecord";
import { beatSoundFor, careerWorldSound, resetSoundOnce, soundOnce, soundsHeard, YEAR_SOUNDS, yearSoundFor } from "./careerSound";

const at = (turn: number, record: CareerRecord = [], over = false) => ({ turn, record, over });
const m = (milestone: Milestone): CareerRecord => [milestone];
const career = CAREER.career!;

describe("a year's sound", () => {
  it("each milestone has its sound", () => {
    expect(YEAR_SOUNDS).toEqual({
      listed: "crowd-cheer",
      rescued: "negative-big",
      office: "asset-office-upgrade",
      launch: "launch-ok",
      era: "phase-change",
      shift: "event-beacon",
      rivalOut: "power-down",
      rivalIn: "neutral",
    });
  });

  it("plays the most important of the year's milestones, only that one", () => {
    const year = [{ kind: "launch", turn: 3 }, { kind: "office", turn: 3, from: 0, to: 1 }, { kind: "listed", turn: 3, amount: 1 }] as const;
    expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, [...year]) })).toBe("crowd-cheer");
    expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, year.slice(0, 2)) })).toBe("asset-office-upgrade");
    // 1992 → 1993 announces the first platform shift in the shipped career, which outranks a rival: a quiet year
    // (1996 → 1997, no new era, no shift newly announced) leaves the newcomer's sound.
    expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, m({ kind: "rivalIn", turn: 4, seat: 2, name: "N", pitch: "p" })) })).toBe("event-beacon");
    expect(yearSoundFor({ config: CAREER, before: at(7), after: at(8, m({ kind: "rivalIn", turn: 8, seat: 2, name: "N", pitch: "p" })) })).toBe("neutral");
  });

  it("hears only what this year added", () => {
    const old = m({ kind: "launch", turn: 2 });
    expect(yearSoundFor({ config: CAREER, before: at(7, old), after: at(8, old) })).toBeNull();
  });

  it("a new era, or a platform shift newly announced, when nothing else happened", () => {
    // 1994 → 1995 crosses from dial-up to gold-rush (turn 6 is 1995).
    expect(yearSoundFor({ config: CAREER, before: at(5), after: at(6) })).toBe("phase-change");
    let shiftTurn = 2;
    while (!(upcomingShift(shiftTurn, CAREER) !== null && upcomingShift(shiftTurn - 1, CAREER) === null)) shiftTurn += 1;
    expect(shiftTurn).toBeLessThanOrEqual(CAREER.game.maxTurns);
    expect(yearSoundFor({ config: CAREER, before: at(shiftTurn - 1), after: at(shiftTurn) })).toBe(
      eraIndexOf(shiftTurn - 1, career) !== eraIndexOf(shiftTurn, career) ? "phase-change" : "event-beacon",
    );
  });

  it("a second shift announced while the first is still to come counts as new", () => {
    for (let t = 2; t <= CAREER.game.maxTurns; t++) {
      const was = upcomingShift(t - 1, CAREER)?.cardId;
      const now = upcomingShift(t, CAREER)?.cardId;
      const sameEra = eraIndexOf(t - 1, career) === eraIndexOf(t, career);
      if (!sameEra) continue;
      expect(yearSoundFor({ config: CAREER, before: at(t - 1), after: at(t) }), `turn ${t}`).toBe(
        now !== undefined && now !== was ? "event-beacon" : null,
      );
    }
  });

  it("is silent for a year that ends the career, and in a race", () => {
    expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, m({ kind: "listed", turn: 3, amount: 1 }), true) })).toBeNull();
    expect(yearSoundFor({ config: DESIGN, before: at(3), after: at(4, m({ kind: "listed", turn: 3, amount: 1 })) })).toBeNull();
  });

  it("the market beat streams users; no other beat makes a sound of its own", () => {
    expect((["leave", "move", "arrive", "year", "market"] as const).map((kind) => beatSoundFor({ kind, seconds: 1, count: 1, office: null }))).toEqual([
      null,
      null,
      null,
      null,
      "users-trickle",
    ]);
  });
});

describe("through the audio engine", () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers();
    h = makeHarness();
    setSharedAudioEngine(h.engine);
    await h.unlock();
  });
  afterEach(() => {
    h.engine.dispose();
    setSharedAudioEngine(null);
    vi.useRealTimers();
  });

  it("plays a year's sound once, however often it is asked, and remembers what it asked for", () => {
    const before = h.ctx.started.length;
    const heard = () => soundsHeard().filter((name) => name === "crowd-cheer").length;
    const was = heard();
    soundOnce("a:12", "crowd-cheer");
    soundOnce("a:12", "crowd-cheer");
    expect(h.engine.voiceCount("world")).toBe(1);
    expect(h.ctx.started.length).toBeGreaterThan(before);
    expect(soundsHeard().at(-1)).toBe("crowd-cheer");
    soundOnce("a:13", null);
    expect(heard() - was).toBe(1);
    // Another career reaching the same year is another key: it is heard.
    soundOnce("b:12", "crowd-cheer");
    expect(heard() - was).toBe(2);
    // A null call stores its key too: the same key with a sound afterwards plays nothing.
    soundOnce("c:5", null);
    soundOnce("c:5", "crowd-cheer");
    expect(heard() - was).toBe(2);
  });

  it("forgets the last key when a new career screen opens, so the same seed's first year is heard again", () => {
    const heard = () => soundsHeard().filter((name) => name === "launch-ok").length;
    const was = heard();
    soundOnce("7:0:1990:0", "launch-ok");
    resetSoundOnce();
    soundOnce("7:0:1990:0", "launch-ok");
    expect(heard() - was).toBe(2);
  });

  it("turns the world's footsteps and chairs into sounds on the world bus", () => {
    careerWorldSound.onFootsteps?.({ pan: -0.3, steps: 4, approach: 1, panTo: 0.2 });
    careerWorldSound.onChairSit?.({ pan: 0.1 });
    expect(soundsHeard().slice(-2)).toEqual(["footsteps", "chair-sit"]);
    expect(h.engine.voiceCount("world")).toBe(2);
    expect(h.engine.error).toBeNull();
  });

  it("keeps only the last twenty sounds asked for", () => {
    for (let i = 0; i < 25; i++) careerWorldSound.onChairSit?.({ pan: 0 });
    expect(soundsHeard()).toHaveLength(20);
  });
});
