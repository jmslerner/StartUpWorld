import { describe, expect, it } from "vitest";
import type { BoardMember, GameState, InvestorLead } from "../../types/game";
import { parseSave, serializeSave } from "../../state/save";
import { createInitialState } from "../actions";
import { executeCommand } from "../commands";
import type { EngineContext } from "../context";
import { generateEndingSummary } from "../endingSummary";
import { eventPool } from "../events/pool";
import { raise, stageRaiseCaps } from "../investors";
import { mix32 } from "../../world/hash";
import { playStockWeek } from "../__golden__/legacyBots";
import { refreshDerivedNoLog } from "../derived";
import { makeCtx, makeState, makeTycoonState } from "../testHelpers";
import { endWeekTick } from "../tick";
import { migrateState } from "../tycoon/migrate";
import { BARK_EVERY, BARKS, barkFor } from "./barks";
import { CALLBACKS, playDueCallback } from "./callbacks";
import { storyConfig } from "./config";
import { applyFx } from "./effects";
import { closeStoryRound } from "./financing";
import { EPILOGUES, pickEpilogue } from "./epilogues";
import { storyEvents } from "./events";
import { INTERLUDES, countSeriesRound, interludeFor } from "./interludes";
import { CHAIN_WEIGHT_MULT, STORY_CHAINS, STORY_EVENT_IDS, STORY_TITLES } from "./meta";
import type { StoryEventId } from "./meta";
import { STORY_PICK_SHARE, withStoryShare } from "./share";
import { CALLBACK_GRACE_WEEKS, emptyStory, normalizeStory, recordStoryChoice } from "./state";

// Tests that switch the pack off need no cleanup: src/test/setup.ts switches it back on before every test.

const director = (id: string, role: BoardMember["role"], confidence = 60): BoardMember => ({ id, name: id, role, personality: "operator", confidence });
const lead = (id: string, relationship: number): InvestorLead => ({ id, name: `Fund ${id}`, riskTolerance: 50, trendBias: "ai", relationship });

/** A Series A company on which every story event is eligible. */
const ripe = (overrides: Partial<GameState> = {}): GameState =>
  makeTycoonState({
    week: 30,
    stage: "series-a",
    companyPhase: "office",
    users: 50_000,
    arpu: 10,
    mrr: 500_000,
    cash: 3_000_000,
    burn: 200_000,
    valuation: 500_000_000,
    pricingModel: "prosumer",
    team: { ...makeState().team, engineering: 10, sales: 4, marketing: 3, data: 1, product: 2 },
    reputation: 60,
    stress: 50,
    volatility: 0,
    board: { members: [director("f", "founder", 95), director("i1", "investor"), director("x1", "independent")], lastMeetingWeek: 0 },
    investors: { pipeline: [lead("a", 70), lead("b", 50)] },
    totalRaised: 10_000_000,
    capTable: { founderPct: 0.4, investorPct: 0.6 },
    ...overrides,
  });

const ctxFor = (overrides: Partial<EngineContext> = {}): EngineContext =>
  makeCtx({ runwayWeeks: 6, usersGrowthRate: 0.05, mrrGrowthRate: 0.06, teamSize: 25, profitable: false, ...overrides });

const byId = (id: StoryEventId) => {
  const def = storyEvents.find((e) => e.id === id);
  if (!def) throw new Error(`missing ${id}`);
  return def;
};

describe("story events: registration", () => {
  it("are the 14 pack events, last in eventPool, after the tycoon events", () => {
    expect(storyEvents.map((e) => e.id)).toEqual(STORY_EVENT_IDS);
    expect(eventPool.slice(-storyEvents.length).map((e) => e.id)).toEqual(STORY_EVENT_IDS);
    expect(eventPool.slice(0, -storyEvents.length).some((e) => (STORY_EVENT_IDS as string[]).includes(e.id))).toBe(false);
    for (const def of storyEvents) {
      expect(def.title).toBe(STORY_TITLES[def.id as StoryEventId]);
      expect(def.choices).toHaveLength(3);
    }
  });

  it("every choice has exactly one later scene, and every later scene belongs to a choice", () => {
    const keys = storyEvents.flatMap((e) => e.choices.map((c) => `${e.id}:${c.id}`));
    expect(keys).toHaveLength(42);
    expect(Object.keys(CALLBACKS).sort()).toEqual([...keys].sort());
    for (const def of Object.values(CALLBACKS)) {
      expect(def.delay).toBeGreaterThanOrEqual(4);
      expect(def.delay).toBeLessThanOrEqual(10);
      expect(def.text.length).toBeGreaterThan(20);
    }
  });
});

describe("story events: eligibility", () => {
  it("every event is eligible on a ripe Series A state", () => {
    const s = ripe();
    for (const def of storyEvents) expect(def.when(s, ctxFor()), def.id).toBe(true);
  });

  it("none is eligible with the pack off, before its first week, or once it has run", () => {
    const s = ripe();
    storyConfig.enabled = false;
    for (const def of storyEvents) expect(def.when(s, ctxFor()), `${def.id} off`).toBe(false);
    storyConfig.enabled = true;
    const early = ripe({ week: 7 });
    for (const def of storyEvents) expect(def.when(early, ctxFor()), `${def.id} week 7`).toBe(false);
    for (const def of storyEvents) {
      const seen = ripe({ eventHistory: [{ id: def.id, week: 20 }] });
      expect(def.when(seen, ctxFor()), `${def.id} seen`).toBe(false);
      const chosen = recordStoryChoice(ripe(), def.id, def.choices[0].id, null, false);
      expect(def.when(chosen, ctxFor()), `${def.id} chosen`).toBe(false);
    }
  });

  it("a garage company with no board sees none of the board or financing events", () => {
    const s = makeTycoonState({ week: 20, users: 3000, mrr: 30_000, cash: 400_000, burn: 60_000 });
    const ctx = ctxFor({ teamSize: 18 });
    for (const id of ["waterfront-property", "agent-has-receipts", "ten-megawatts-of-powerpoint", "unicorn-terms-trap", "vc-rescue-board-control", "circular-compute-revenue"] as StoryEventId[]) {
      expect(byId(id).when(s, ctx), id).toBe(false);
    }
  });

  it("the rescue needs a short runway, and the unicorn offer a valuation under a billion", () => {
    expect(byId("vc-rescue-board-control").when(ripe(), ctxFor({ runwayWeeks: 20 }))).toBe(false);
    expect(byId("vc-rescue-board-control").when(ripe(), ctxFor({ profitable: true }))).toBe(false);
    expect(byId("unicorn-terms-trap").when(ripe({ valuation: 1_200_000_000 }), ctxFor())).toBe(false);
    expect(byId("unicorn-terms-trap").when(ripe({ investors: { pipeline: [lead("a", 70)] } }), ctxFor())).toBe(false);
  });
});

describe("story events: choices", () => {
  it("every choice prints its outcome and an effects line, records itself and schedules its later scene", () => {
    for (const def of storyEvents) {
      for (const choice of def.choices) {
        const before = ripe();
        const { state, logs } = choice.apply(before, ctxFor());
        const key = `${def.id}:${choice.id}`;
        expect(logs[0].length, key).toBeGreaterThan(40);
        expect(logs[1].length, key).toBeGreaterThan(5);
        expect(state.story?.choices[0], key).toEqual({ eventId: def.id, choiceId: choice.id, week: 30 });
        expect(state.story?.callbacks, key).toContainEqual({ key, dueWeek: 30 + CALLBACKS[key].delay });
        expect(state.rng, key).toBe(before.rng);
        expect(state.cash, key).toBeGreaterThanOrEqual(0);
        for (const v of [state.cash, state.users, state.arpu, state.mrr, state.capTable.founderPct, state.reputation]) expect(Number.isFinite(v), key).toBe(true);
      }
    }
  });

  it("protecting the story counts toward spin; the honest options do not", () => {
    const spins = storyEvents.flatMap((e) => e.choices.filter((c) => (c.apply(ripe(), ctxFor()).state.story?.spin ?? 0) > 0).map((c) => `${e.id}:${c.id}`));
    expect(spins.sort()).toEqual(
      [
        "single-source-of-revenue:keep",
        "state-of-the-slide:headline",
        "silent-training-opt-in:defend",
        "circular-compute-revenue:defend",
        "agent-has-receipts:retime",
        "founder-personal-brand-spiral:double-down",
      ].sort(),
    );
  });

  it("costs never take a balance below zero nor raise a negative one", () => {
    const broke = ripe({ cash: 50_000 });
    const out = byId("ten-megawatts-of-powerpoint").choices[1].apply(broke, ctxFor()).state;
    expect(out.cash).toBe(0);
    const negative = ripe({ cash: -20_000 });
    expect(byId("apology-indexed").choices[0].apply(negative, ctxFor()).state.cash).toBe(-20_000);
  });

  it("the unicorn headline prices the round at a billion; the clean deal at the company's value; both funds leave", () => {
    const s = ripe();
    const amount = 12_000_000; // series-a soft cap (6% of $500M is more)
    const head = byId("unicorn-terms-trap").choices[0].apply(s, ctxFor());
    expect(head.state.totalRaised).toBe(s.totalRaised + amount);
    expect(head.state.lastRound).toMatchObject({ amount, preMoney: 1_000_000_000, investorName: "Fund a" });
    expect(head.state.capTable.founderPct).toBeCloseTo(0.4 * (1 - amount / 1_012_000_000), 10);
    expect(head.state.investors.pipeline).toEqual([]);
    expect(head.state.story?.rounds).toBe(1);
    expect(head.logs).toContain("SERIES A — ADULT SUPERVISION");

    const clean = byId("unicorn-terms-trap").choices[1].apply(s, ctxFor());
    expect(clean.state.lastRound).toMatchObject({ amount, preMoney: 500_000_000, investorName: "Fund b" });
    expect(clean.state.capTable.founderPct).toBeLessThan(head.state.capTable.founderPct);
    expect(clean.state.investors.pipeline).toEqual([]);

    const later = playDueCallback({ ...head.state, week: 38 }, ctxFor());
    expect(later.fired).toBe(true);
    expect(later.state.capTable.founderPct).toBeCloseTo(head.state.capTable.founderPct * 0.92, 10);
  });

  it("negotiating closes the round only when a fund is still at the table", () => {
    const s = byId("unicorn-terms-trap").choices[2].apply(ripe(), ctxFor()).state;
    expect(s.totalRaised).toBe(10_000_000);
    const fired = playDueCallback({ ...s, week: 34 }, ctxFor());
    expect(fired.fired).toBe(true);
    expect(fired.state.lastRound).toMatchObject({ preMoney: 550_000_000, investorName: "Fund a" });
    expect(fired.state.investors.pipeline.map((l) => l.id)).toEqual(["b"]);
    const empty = playDueCallback({ ...s, week: 34, investors: { pipeline: [] } }, ctxFor());
    expect(empty.fired).toBe(false);
    expect(empty.state.story?.callbacks).toHaveLength(1);
  });

  it("the rescue dilutes at a discount and seats Trent once; the prepayment sells no shares", () => {
    const s = ripe({ cash: 600_000, mrr: 200_000 });
    const rescue = byId("vc-rescue-board-control").choices[0].apply(s, ctxFor());
    expect(rescue.state.lastRound?.investorName).toBe("Apex Predatory Capital");
    expect(rescue.state.lastRound?.preMoney).toBe(300_000_000);
    expect(rescue.state.board.members.filter((m) => m.name === "Trent Voss")).toHaveLength(1);
    const again = byId("vc-rescue-board-control").choices[0].apply(rescue.state, ctxFor());
    expect(again.state.board.members.filter((m) => m.name === "Trent Voss")).toHaveLength(1);
    const prepay = byId("vc-rescue-board-control").choices[2].apply(s, ctxFor());
    expect(prepay.state.capTable).toEqual(s.capTable);
    expect(prepay.state.cash).toBeGreaterThan(s.cash);
    expect(prepay.state.arpu).toBeLessThan(s.arpu);
  });
});

describe("later scenes", () => {
  const scheduled = (key: string, dueWeek: number, week: number): GameState =>
    ripe({ week, story: { ...emptyStory(), callbacks: [{ key, dueWeek }] } });

  it("play when due, once, with a LATER heading; not before", () => {
    expect(playDueCallback(scheduled("gpu-landlord:reserve", 20, 19), ctxFor()).fired).toBe(false);
    const r = playDueCallback(scheduled("gpu-landlord:reserve", 20, 20), ctxFor());
    expect(r.fired).toBe(true);
    expect(r.logs.slice(0, 3)).toEqual(["", "LATER: The GPU Landlord", CALLBACKS["gpu-landlord:reserve"].text]);
    expect(r.logs[3]).toMatch(/^Cash -\$700,000\. Stress \+4\.$/);
    expect(r.state.story?.callbacks).toEqual([]);
  });

  it("a scene whose condition is false waits, then is dropped silently after the grace period", () => {
    const key = "vc-rescue-board-control:rescue";
    const waiting = playDueCallback(scheduled(key, 20, 25), ctxFor({ profitable: true }));
    expect(waiting.fired).toBe(false);
    expect(waiting.state.story?.callbacks).toHaveLength(1);
    const late = playDueCallback(scheduled(key, 20, 20 + CALLBACK_GRACE_WEEKS + 1), ctxFor({ profitable: false }));
    expect(late.fired).toBe(false);
    expect(late.logs).toEqual([]);
    expect(late.state.story?.callbacks).toEqual([]);
  });

  it("at most one plays per week, the oldest first; unknown keys are dropped", () => {
    const s = ripe({
      week: 30,
      story: {
        ...emptyStory(),
        callbacks: [
          { key: "state-of-the-slide:publish", dueWeek: 29 },
          { key: "gpu-landlord:meter", dueWeek: 27 },
          { key: "no-such-event:never", dueWeek: 20 },
        ],
      },
    });
    const r = playDueCallback(s, ctxFor());
    expect(r.logs[1]).toBe("LATER: The GPU Landlord");
    expect(r.state.story?.callbacks).toEqual([{ key: "state-of-the-slide:publish", dueWeek: 29 }]);
  });

  it("do nothing with the pack off", () => {
    storyConfig.enabled = false;
    const s = scheduled("gpu-landlord:reserve", 20, 20);
    const r = playDueCallback(s, ctxFor());
    expect(r.state).toBe(s);
    expect(r.logs).toEqual([]);
  });

  it("play inside the week's tick, before the week's event", () => {
    const s = makeState({ week: 20, cash: 2_000_000, story: { ...emptyStory(), callbacks: [{ key: "moat-download-button:adopt", dueWeek: 21 }] } });
    const { state, logs } = endWeekTick(s);
    expect(logs).toContain("LATER: The Moat Has a Download Button");
    const later = logs.indexOf("LATER: The Moat Has a Download Button");
    const event = logs.findIndex((l) => l.startsWith("EVENT:"));
    if (event >= 0) expect(event).toBeGreaterThan(later);
    expect(state.story?.callbacks).toEqual([]);
  });
});

describe("chains and cadence", () => {
  it("a chained event's weight is multiplied once its predecessor has run", () => {
    for (const [id, before] of Object.entries(STORY_CHAINS) as [StoryEventId, StoryEventId][]) {
      const plain = byId(id).weight(ripe(), ctxFor());
      const after = byId(id).weight(ripe({ eventHistory: [{ id: before, week: 25 }] }), ctxFor());
      expect(after, id).toBeCloseTo(plain * CHAIN_WEIGHT_MULT, 10);
    }
  });

  it("story events together get the story share of the pick, never less than their own weight", () => {
    const ids = ["outage-2am", "gpu-landlord", "poached", "agent-all-hands"];
    const w = withStoryShare(ids, [400, 3, 400, 1]);
    expect((w[1] + w[3]) / w.reduce((a, b) => a + b, 0)).toBeCloseTo(STORY_PICK_SHARE, 10);
    expect(w[1] / w[3]).toBeCloseTo(3, 10);
    expect(w[0]).toBe(400);
    expect(withStoryShare(["gpu-landlord", "poached"], [50, 1])).toEqual([50, 1]);
    expect(withStoryShare(["poached", "outage-2am"], [5, 6])).toEqual([5, 6]);
    storyConfig.enabled = false;
    expect(withStoryShare(ids, [400, 3, 400, 1])).toEqual([400, 3, 400, 1]);
  });
});

describe("fundraising interludes", () => {
  it("run Series A through N, then the recurring exchange", () => {
    let s = makeState();
    const headings: string[] = [];
    for (let i = 0; i < 16; i++) {
      const r = countSeriesRound(s);
      s = r.state;
      headings.push(r.lines[1]);
    }
    expect(headings.slice(0, 14)).toEqual(INTERLUDES.map((i) => i.heading));
    expect(headings[0]).toBe("SERIES A — ADULT SUPERVISION");
    expect(headings[13]).toBe("SERIES N — NEXT CHAPTER");
    expect(headings.slice(14)).toEqual(["ANOTHER ROUND", "ANOTHER ROUND"]);
    expect(s.story?.rounds).toBe(16);
    expect(interludeFor(2).lines[1]).toBe("Lena: “Which opportunity? We currently have four and one deployment pipeline.”");
  });

  it("change nothing but the story slice, and nothing at all with the pack off", () => {
    const s = makeState();
    const { state } = countSeriesRound(s);
    expect({ ...state, story: undefined }).toEqual({ ...s, story: undefined });
    storyConfig.enabled = false;
    const off = countSeriesRound(s);
    expect(off.state).toBe(s);
    expect(off.lines).toEqual([]);
  });

  /** A raise that succeeds on some dice (the raise's own roll); returns the first success. */
  const raiseUntilOk = (s: GameState, amount: number) => {
    for (let i = 1; i <= 2000; i += 1) {
      const r = raise({ ...s, rng: mix32(i) || 1 }, amount);
      if (r.ok) return r;
    }
    throw new Error("no seed closed the round");
  };

  it("a raise into Series A plays Series A; a garage-to-seed raise plays nothing", () => {
    const seed = makeState({
      stage: "seed",
      companyPhase: "office",
      valuation: 60_000_000,
      mrr: 400_000,
      vcReputation: 90,
      investors: { pipeline: [lead("a", 95)] },
    });
    const a = raiseUntilOk(seed, 6_000_000);
    expect(a.state.stage).toBe("series-a");
    expect(a.logs).toContain("SERIES A — ADULT SUPERVISION");
    expect(a.state.story?.rounds).toBe(1);

    const garage = makeState({ valuation: 8_000_000, mrr: 50_000, vcReputation: 90, investors: { pipeline: [lead("a", 95)] } });
    const g = raiseUntilOk(garage, 600_000);
    expect(g.state.stage).toBe("seed");
    expect(g.logs.some((l) => l.startsWith("SERIES"))).toBe(false);
    expect(g.state.story).toBeUndefined();
  });
});

describe("news lines", () => {
  const week = (w: number, overrides: Partial<GameState> = {}) => ripe({ week: w, ...overrides });

  it("are deterministic, sparse, and start after week 5", () => {
    const lines = Array.from({ length: 200 }, (_, i) => barkFor(week(i + 1), ctxFor()));
    expect(lines).toEqual(Array.from({ length: 200 }, (_, i) => barkFor(week(i + 1), ctxFor())));
    expect(lines.slice(0, 5).every((l) => l === null)).toBe(true);
    const slots = lines.filter((l) => l !== null);
    expect(slots.length).toBeGreaterThanOrEqual(35);
    expect(slots.length).toBeLessThanOrEqual(40);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === null) continue;
      expect(lines[i]).toMatch(/^NEWS: /);
      for (let j = i + 1; j < Math.min(lines.length, i + BARK_EVERY); j++) expect(lines[j]).toBeNull();
    }
  });

  it("work through every line before repeating, when all are eligible", () => {
    const all = week(1, { story: { ...emptyStory(), rounds: 12 }, valuation: 50_000_000 });
    const seen = new Set<string>();
    for (let w = 6; seen.size < BARKS.length && w < 6 + BARK_EVERY * BARKS.length; w++) {
      const line = barkFor({ ...all, week: w }, ctxFor());
      if (line) {
        expect(seen.has(line)).toBe(false);
        seen.add(line);
      }
    }
    expect(seen.size).toBe(BARKS.length);
  });

  it("skip lines that need context; vary with the seed; stop with the pack off", () => {
    const seriesJ = "NEWS: The company has reached Series J. Profitability has reached committee.";
    const early = Array.from({ length: 300 }, (_, i) => barkFor(week(i + 1), ctxFor()));
    expect(early).not.toContain(seriesJ);
    const other = Array.from({ length: 60 }, (_, i) => barkFor(week(i + 1, { seed: 777 }), ctxFor()));
    expect(other).not.toEqual(early.slice(0, 60));
    storyConfig.enabled = false;
    expect(Array.from({ length: 60 }, (_, i) => barkFor(week(i + 1), ctxFor())).every((l) => l === null)).toBe(true);
  });
});

describe("epilogues", () => {
  const over = (ending: NonNullable<GameState["gameOver"]>["ending"], overrides: Partial<GameState> = {}) =>
    ripe({ gameOver: { ending, week: 60, headline: "The end." }, ...overrides });
  const story = (patch: Partial<NonNullable<GameState["story"]>>) => ({ story: { ...emptyStory(), ...patch } });
  const profitable = { mrr: 2_000_000, burn: 100_000 };

  it("The Archive: bankrupt after spinning twice", () => {
    expect(pickEpilogue(over("bankruptcy", story({ spin: 2 })))?.id).toBe("archive");
    expect(pickEpilogue(over("bankruptcy", story({ spin: 1 })))).toBeNull();
  });

  it("The Next Chapter: survived with 15% or less, after four Series rounds or the rescue", () => {
    expect(pickEpilogue(over("ipo", { capTable: { founderPct: 0.12, investorPct: 0.88 }, ...story({ rounds: 4 }) }))?.id).toBe("next-chapter");
    const rescued = recordStoryChoice(over("acquisition", { capTable: { founderPct: 0.15, investorPct: 0.85 } }), "vc-rescue-board-control", "rescue", null, false);
    expect(pickEpilogue(rescued)?.id).toBe("next-chapter");
    expect(pickEpilogue(over("ipo", { capTable: { founderPct: 0.2, investorPct: 0.8 }, ...story({ rounds: 6 }) }))?.id).not.toBe("next-chapter");
    expect(pickEpilogue(over("bankruptcy", { capTable: { founderPct: 0.1, investorPct: 0.9 }, ...story({ rounds: 6 }) }))).toBeNull();
  });

  it("The Boring Miracle: a profitable, unspun exit on at most one Series round", () => {
    expect(pickEpilogue(over("zombie-saas", { ...profitable, ...story({ rounds: 1 }) }))?.id).toBe("boring-miracle");
    expect(pickEpilogue(over("ipo", { ...profitable, ...story({ rounds: 0 }) }))?.id).toBe("boring-miracle");
    expect(pickEpilogue(over("ipo", { ...profitable, ...story({ rounds: 2 }) }))).toBeNull();
    expect(pickEpilogue(over("ipo", { ...profitable, ...story({ spin: 1 }) }))).toBeNull();
    expect(pickEpilogue(over("ipo", { ...profitable, reputation: 40 }))).toBeNull();
    expect(pickEpilogue(over("ipo", story({})))).toBeNull(); // not profitable
    expect(pickEpilogue(over("founder-removal", profitable))).toBeNull();
  });

  it("reach the ending summary, and vanish with the pack off or a game still running", () => {
    const s = over("bankruptcy", story({ spin: 3 }));
    expect(generateEndingSummary(s)?.epilogue).toEqual({ title: "The Archive", lines: EPILOGUES.archive.lines, tagline: EPILOGUES.archive.tagline });
    expect(pickEpilogue(ripe(story({ spin: 3 })))).toBeNull();
    storyConfig.enabled = false;
    expect(generateEndingSummary(s)?.epilogue).toBeNull();
  });
});

describe("story slice: saves", () => {
  it("a save from before the pack loads with an empty slice", () => {
    const old = makeTycoonState({ week: 14 });
    delete old.story;
    const loaded = parseSave(serializeSave(old, [], []));
    expect(loaded?.state.story).toEqual(emptyStory());
  });

  it("a corrupt slice is normalized; a valid one round-trips", () => {
    const raw = {
      choices: [{ eventId: "BAD ID", choiceId: "x" }, { eventId: "gpu-landlord", choiceId: "meter", week: 9999 }, "junk"],
      callbacks: [{ key: "nope", dueWeek: 3 }, { key: "gpu-landlord:meter", dueWeek: 12.6 }, { key: "a:b" }],
      rounds: -5,
      spin: "x",
    };
    expect(normalizeStory(raw, 14)).toEqual({
      choices: [{ eventId: "gpu-landlord", choiceId: "meter", week: 14 }],
      callbacks: [{ key: "gpu-landlord:meter", dueWeek: 13 }],
      rounds: 0,
      spin: 0,
    });
    expect(normalizeStory(null, 3)).toEqual(emptyStory());
    expect(normalizeStory([1, 2], 3)).toEqual(emptyStory());
    const valid = { choices: [{ eventId: "moat-download-button", choiceId: "adopt", week: 20 }], callbacks: [{ key: "moat-download-button:adopt", dueWeek: 25 }], rounds: 3, spin: 1 };
    expect(normalizeStory(valid, 22)).toEqual(valid);
    const s = makeTycoonState({ week: 22, story: valid });
    expect(parseSave(serializeSave(s, [], []))?.state.story).toEqual(valid);
    expect(migrateState(migrateState(s, 3), 3).story).toEqual(valid);
  });

  it("a new game starts with an empty slice", () => {
    expect(createInitialState().story).toEqual(emptyStory());
  });
});

describe("the whole pack, end to end", () => {
  /** A whole game played by the legacy stock bot (pitch, raise, hire, ship, launch, choose 1). */
  const play = (seed: number, weeks: number): GameState => {
    let s: GameState = refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
    for (const c of ["name Ada", "company Loopwell", "founder hacker", "cofounder builder"]) s = executeCommand(s, c).state;
    for (let w = 0; w < weeks && !s.gameOver; w++) s = playStockWeek(s);
    return s;
  };
  const isStory = (id: string): boolean => (STORY_EVENT_IDS as string[]).includes(id);
  const SEEDS = [11, 23, 97, 131, 257, 1009];

  it("with the pack off, no story event or slice change ever appears", () => {
    storyConfig.enabled = false;
    let longest = 0;
    for (const seed of SEEDS) {
      const s = play(seed, 120);
      longest = Math.max(longest, s.week);
      expect(s.eventHistory.some((h) => isStory(h.id))).toBe(false);
      expect(s.story).toEqual(emptyStory());
      if (s.gameOver) expect(generateEndingSummary(s)?.epilogue).toBeNull();
    }
    expect(longest).toBeGreaterThan(40);
  });

  it("with the pack on, games meet its events and their later scenes", () => {
    let seen = 0;
    let scheduled = 0;
    for (const seed of SEEDS) {
      const s = play(seed, 120);
      seen += s.eventHistory.filter((h) => isStory(h.id)).length;
      scheduled += s.story?.choices.length ?? 0;
    }
    expect(seen).toBeGreaterThan(0);
    expect(scheduled).toBeGreaterThan(0);
  });

  it("a quiet week on a news slot prints its news line; with the pack off it never does", () => {
    const base = makeState({ week: 19, cash: 2_000_000, seed: 12345 }); // the tick plays week 20, a slot for seed 12345
    expect(barkFor({ ...base, week: 20 }, ctxFor())).not.toBeNull();
    let quiet: string[] | null = null;
    for (let i = 1; i <= 200 && !quiet; i++) {
      const r = endWeekTick({ ...base, rng: mix32(i) || 1 });
      if (!r.logs.some((l) => l.startsWith("EVENT:"))) quiet = r.logs;
    }
    expect(quiet?.some((l) => l.startsWith("NEWS: "))).toBe(true);
    storyConfig.enabled = false;
    for (let i = 1; i <= 50; i++) expect(endWeekTick({ ...base, rng: mix32(i) || 1 }).logs.some((l) => l.startsWith("NEWS:"))).toBe(false);
  });

  it("applyFx describes exactly what it changed", () => {
    const s = ripe({ cash: 100_000, users: 1000, arpu: 10, volatility: 0 });
    const r = applyFx(s, { cash: -30_000, users: -0.05, arpu: 0.06, rep: 2, board: -3 });
    expect(r.line).toBe("Cash -$30,000. Users -50. ARPU +$1 → $11. Reputation +2. Board confidence -3.");
    expect(r.state).toMatchObject({ cash: 70_000, users: 950, arpu: 11, mrr: 10_450, reputation: 62 });
    expect(r.state.board.members.map((m) => m.confidence)).toEqual([95, 57, 57]);
  });

  it("applyFx prints the volatility-scaled change it applied, not the nominal one", () => {
    // volatility 50: impactMultiplier 2, so soft stats move twice their nominal step; stress is never scaled.
    const s = ripe({ volatility: 50, reputation: 40, vcReputation: 40, stress: 40 });
    const r = applyFx(s, { rep: 2, vcRep: -3, morale: 1, stress: 2 });
    expect(r.line).toBe("Reputation +4. VC rep -6. Morale +2. Stress +2.");
    expect(r.state.reputation).toBe(44);
    expect(r.state.vcReputation).toBe(34);
    expect(r.state.culture.morale).toBe(s.culture.morale + 2);
    expect(r.state.stress).toBe(42);
  });

  it("applyFx prints what is left after the 0..100 clamp, and nothing for a change clamped away", () => {
    const s = ripe({ volatility: 0, reputation: 99, stress: 100 });
    const r = applyFx(s, { rep: 5, stress: 3 });
    expect(r.line).toBe("Reputation +1.");
    expect(r.state.reputation).toBe(100);
    expect(r.state.stress).toBe(100);
    expect(applyFx({ ...s, reputation: 100 }, { rep: 5, stress: 3 }).line).toBe("Nothing measurable changes.");
  });

  it("applyFx names board and lead steps only when someone actually moved", () => {
    const s = ripe({ volatility: 0 });
    const maxed = { ...s, board: { ...s.board, members: s.board.members.map((m) => (m.role === "founder" ? m : { ...m, confidence: 100 })) } };
    expect(applyFx(maxed, { board: 4 }).line).toBe("Nothing measurable changes.");
    expect(applyFx(maxed, { board: -4 }).line).toBe("Board confidence -4.");
  });
});

describe("story rounds: the stage's hard cap", () => {
  it("a story round never books more than the stage's hard cap, as `raise` refuses to", () => {
    const s = ripe({ stage: "seed", cash: 0, debtOutstanding: 0, totalRaised: 1_000_000 });
    const cap = stageRaiseCaps.seed.hardCap;
    const r = closeStoryRound(s, cap * 3, 20_000_000, "Big Fund");
    expect(r.state.cash).toBe(cap);
    expect(r.state.totalRaised).toBe(1_000_000 + cap);
    expect(r.state.lastRound?.amount).toBe(cap);
    expect(r.state.lastRound?.postMoney).toBe(20_000_000 + cap);
  });

  it("a round under the cap is booked as offered", () => {
    const s = ripe({ stage: "series-a", cash: 0, debtOutstanding: 0 });
    const r = closeStoryRound(s, 1_000_000, 50_000_000, "Small Fund");
    expect(r.state.cash).toBe(1_000_000);
    expect(r.state.lastRound?.amount).toBe(1_000_000);
  });

  it("the rescue's prompt quotes the capped amounts it would book", () => {
    const def = storyEvents.find((e) => e.id === "vc-rescue-board-control");
    expect(def).toBeDefined();
    // A seed company burning $1M a week: 16 weeks of burn is far above the seed hard cap.
    const s = ripe({ stage: "seed", burn: 1_000_000, cash: 2_000_000, mrr: 0 });
    const cap = stageRaiseCaps.seed.hardCap;
    const prompt = def!.prompt(s, ctxFor());
    expect(prompt).toContain("Rescue: $" + cap.toLocaleString("en-US") + " at");
    const after = def!.choices[0].apply(s, ctxFor()).state;
    expect(after.lastRound?.amount).toBe(cap);
  });
});
