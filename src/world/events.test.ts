import { describe, expect, it } from "vitest";
import type { BoardState, GameState, PendingEvent, SoundHint, TeamRoster } from "../types/game";
import { executeCommand } from "../engine";
import commandsSource from "../engine/commands.ts?raw";
import { makeState } from "../engine/testHelpers";
import {
  CASH_EVENT_THRESHOLD,
  EASTER_EGG_COMMANDS,
  deriveWorldEvents,
  filterWorldEvents,
  findWorldEvent,
} from "./events";
import { mix32 } from "./hash";
import { buildWorldSnapshot } from "./snapshot";
import type { ActionSignal, WorldEvent, WorldEventType, WorldSnapshot } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Harness: drive the real engine the way the store does
// ─────────────────────────────────────────────────────────────────────────────

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
  ...counts,
});

/**
 * makeState() carries hand-written derived numbers (burn, valuation, phase). The
 * engine recomputes those on every command, so a first no-op command brings the
 * fixture to a state a real run could be in — otherwise the very next command
 * would appear to change valuation and phase as a side effect.
 */
const settled = (overrides: Partial<GameState> = {}): GameState => executeCommand(makeState(overrides), "status").state;

interface Step {
  state: GameState;
  prev: WorldSnapshot;
  next: WorldSnapshot;
  action: ActionSignal;
  events: WorldEvent[];
  types: WorldEventType[];
}

let seq = 0;

const signalFor = (input: string, sound: SoundHint | null, rejected: boolean): ActionSignal => {
  const [command = "", ...args] = input.trim().toLowerCase().split(/\s+/);
  seq += 1;
  return { seq, command, args, sound, rejected };
};

const step = (before: GameState, input: string): Step => {
  const result = executeCommand(before, input);
  const sound = result.sound ?? null;
  // "The engine refused": an error line and no outcome. (A backfired blackmail also
  // logs an error line, but it is an outcome and carries a sound.)
  const rejected = sound === null && result.logs.some((log) => log.kind === "error");
  const prev = buildWorldSnapshot(before);
  const next = buildWorldSnapshot(result.state);
  const action = signalFor(input, sound, rejected);
  const events = deriveWorldEvents(prev, next, action);
  return { state: result.state, prev, next, action, events, types: events.map((event) => event.type) };
};

/** The same command on up to 500 different dice, until the outcome we want comes up. */
const stepUntil = (before: GameState, input: string, wanted: (attempt: Step) => boolean): Step => {
  for (let i = 1; i <= 500; i += 1) {
    const attempt = step({ ...before, rng: mix32(i) || 1 }, input);
    if (wanted(attempt)) return attempt;
  }
  throw new Error(`no seed produced the wanted outcome for "${input}"`);
};

const snap = (overrides: Partial<GameState> = {}): WorldSnapshot => buildWorldSnapshot(makeState(overrides));

/** A snapshot with a few fields changed, for transitions the engine cannot be made to produce. */
const withChanges = (base: WorldSnapshot, changes: Partial<WorldSnapshot>): WorldSnapshot => ({ ...base, ...changes });

const noAction = null;

const pendingEvent = (id: string, title: string): PendingEvent => ({
  id,
  title,
  prompt: "…",
  choices: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
    { id: "c", text: "C" },
  ],
});

const board = (): BoardState => ({
  lastMeetingWeek: 0,
  members: [
    { id: "b-founder", name: "You", role: "founder", personality: "cheerleader", confidence: 80 },
    { id: "b-investor", name: "Dana Whitfield", role: "investor", personality: "operator", confidence: 50 },
    { id: "b-indie", name: "Lee Okoro", role: "independent", personality: "old-guard", confidence: 55 },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────

describe("deriveWorldEvents — the basics", () => {
  it("returns nothing on the initial mount", () => {
    expect(deriveWorldEvents(null, snap(), noAction)).toEqual([]);
    expect(deriveWorldEvents(null, snap(), signalFor("ship it", "success", false))).toEqual([]);
  });

  it("returns nothing when nothing changed", () => {
    const snapshot = snap();
    expect(deriveWorldEvents(snapshot, snapshot, noAction)).toEqual([]);
    expect(deriveWorldEvents(snapshot, snap(), noAction)).toEqual([]);
  });

  it("emits exactly run-reset when the run changes, whatever else differs", () => {
    const prev = snap({ seed: 1, week: 9, team: team({ engineering: 6 }), cash: 5 });
    const next = snap({ seed: 2, week: 1, team: team({ engineering: 1 }), cash: 20_000, companyPhase: "office" });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([{ type: "run-reset" }]);
    expect(deriveWorldEvents(prev, next, signalFor("ship x", "success", false))).toEqual([{ type: "run-reset" }]);
  });

  it("emits exactly run-reset when time runs backwards", () => {
    const prev = snap({ week: 14, cash: 90_000 });
    const next = snap({ week: 13, cash: 10_000, gameOver: { ending: "bankruptcy", week: 13, headline: "x" } });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([{ type: "run-reset" }]);
  });

  it("is a pure function of its arguments", () => {
    const before = settled({ cash: 50_000 });
    const first = step(before, "hire eng 1");
    const again = deriveWorldEvents(first.prev, first.next, first.action);
    expect(again).toEqual(first.events);
    expect(again).not.toBe(first.events);
  });
});

describe("informational commands", () => {
  it("emit nothing", () => {
    const state = settled({ board: board() });
    const quiet = ["status", "help", "board", "assets", "phases", "roadmap", "perks", "pricing", "raise", "seed", "buy", ""];
    for (const command of quiet) {
      expect(step(state, command).events, `"${command}"`).toEqual([]);
    }
  });

  it("emit nothing for store-level commands that never reach the engine", () => {
    // `clear` only wipes the log: same state, and whatever signal the store sends.
    const snapshot = buildWorldSnapshot(settled());
    expect(deriveWorldEvents(snapshot, snapshot, signalFor("clear", null, false))).toEqual([]);
    expect(deriveWorldEvents(snapshot, snapshot, signalFor("restart", null, false))).toEqual([]);
  });

  it("emit nothing when `end` is typed after the game is over", () => {
    const over = settled({ gameOver: { ending: "zombie-saas", week: 44, headline: "…" } });
    expect(step(over, "end").events).toEqual([]);
  });
});

describe("setup", () => {
  const fresh = (): GameState =>
    makeState({
      companyName: "",
      founder: { name: "", archetype: null },
      cofounder: { name: "Cofounder", archetype: null, trust: 72, ego: 55, ambition: 76 },
    });

  it("emits setup-completed exactly when the last choice is made", () => {
    let state = fresh();
    for (const command of ["name Ada", "company Engines", "founder hacker"]) {
      const result = step(state, command);
      expect(result.types, command).not.toContain("setup-completed");
      state = result.state;
    }
    const last = step(state, "cofounder builder");
    expect(last.types).toContain("setup-completed");
    expect(last.types.filter((type) => type === "setup-completed")).toHaveLength(1);
    expect(last.next.people.map((person) => person.id)).toContain("cofounder");
    // …and never again.
    expect(step(last.state, "status").events).toEqual([]);
  });

  it("refuses gameplay before setup and says so", () => {
    expect(step(fresh(), "hire eng 1").events).toEqual([{ type: "command-failed", command: "hire" }]);
  });

  it("treats a changed seed as a different run", () => {
    const result = step(fresh(), "seed lucky-number");
    expect(result.next.runId).not.toBe(result.prev.runId);
    expect(result.events).toEqual([{ type: "run-reset" }]);
  });
});

describe("hiring and leaving", () => {
  it("reports a hire with the new person's id, then the money", () => {
    const result = step(settled({ cash: 50_000 }), "hire eng 1");
    expect(result.events).toEqual([
      { type: "hired", role: "engineering", personIds: ["engineering-1"] },
      { type: "cash-changed", delta: -3000 },
    ]);
  });

  it("lists every new person when several are hired at once", () => {
    const result = step(settled({ cash: 50_000 }), "hire ux 3");
    expect(findWorldEvent(result.events, "hired")).toEqual({
      type: "hired",
      role: "design",
      personIds: ["design-0", "design-1", "design-2"],
    });
  });

  it("reports hires made by an event choice", () => {
    const state = settled({ cash: 50_000, team: team({ engineering: 6 }), pendingEvent: pendingEvent("bro-culture-incident", "Bro Culture Incident") });
    const result = step(state, "choose 3");
    expect(result.types).toEqual(["hired", "event-resolved", "cash-changed"]);
    expect(findWorldEvent(result.events, "hired")).toEqual({ type: "hired", role: "hr", personIds: ["hr-0"] });
  });

  it("only names hires that fit in the capped roster", () => {
    // 62 engineers + two founders fill the roster: the 63rd engineer exists but is off stage.
    const full = settled({ cash: 5_000_000, team: team({ engineering: 62 }) });
    const result = step(full, "hire eng 2");
    // Nobody new is on stage, but the event still carries the real head-count change.
    expect(findWorldEvent(result.events, "hired")).toEqual({ type: "hired", role: "engineering", personIds: [], count: 2 });
    expect(result.next.hiddenPeople).toBe(2);
  });

  it("does not call it a departure when a hire pushes somebody past the roster cap", () => {
    const crowded = settled({ cash: 5_000_000, team: team({ engineering: 30, sales: 32 }) });
    const result = step(crowded, "hire eng 1");
    expect(result.prev.people.map((person) => person.id)).toContain("sales-31");
    expect(result.next.people.map((person) => person.id)).not.toContain("sales-31");
    expect(filterWorldEvents(result.events, "departed")).toEqual([]);
    expect(filterWorldEvents(result.events, "hired")).toEqual([
      { type: "hired", role: "engineering", personIds: ["engineering-30"] },
    ]);
  });

  it("reports departures as the highest indices of the role", () => {
    const prev = snap({ team: team({ engineering: 4, sales: 2 }) });
    const next = snap({ team: team({ engineering: 2, sales: 2 }) });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([
      { type: "departed", role: "engineering", personIds: ["engineering-2", "engineering-3"] },
    ]);
  });

  it("reports departures before hires, each in canonical role order", () => {
    const prev = snap({ team: team({ engineering: 2, design: 2, sales: 1, legal: 2 }) });
    const next = snap({ team: team({ engineering: 3, design: 1, sales: 2, legal: 0, data: 1 }) });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([
      { type: "departed", role: "design", personIds: ["design-1"] },
      { type: "departed", role: "legal", personIds: ["legal-0", "legal-1"] },
      { type: "hired", role: "engineering", personIds: ["engineering-2"] },
      { type: "hired", role: "data", personIds: ["data-0"] },
      { type: "hired", role: "sales", personIds: ["sales-1"] },
    ]);
  });

  it("only names departures that were on stage, and survives absurd head counts", () => {
    const prev = snap({ team: team({ engineering: 3_000_000_000 }) });
    const next = snap({ team: team({ engineering: 60 }) });
    const started = performance.now();
    const events = deriveWorldEvents(prev, next, noAction);
    expect(performance.now() - started).toBeLessThan(50);
    expect(events).toEqual([
      { type: "departed", role: "engineering", personIds: ["engineering-60", "engineering-61"], count: 2_999_999_940 },
    ]);
  });

  it("ignores half a hire", () => {
    const prev = snap({ team: team({ engineering: 2 }) });
    const next = snap({ team: team({ engineering: 2.5 }) });
    expect(filterWorldEvents(deriveWorldEvents(prev, next, noAction), "hired")).toEqual([]);
  });
});

describe("ship", () => {
  const base = (): GameState => settled({ team: team({ engineering: 2 }), reputation: 40 });

  it("reports a shipped feature with the reputation it earned", () => {
    const shipped = stepUntil(base(), "ship dark mode", (attempt) => attempt.action.sound === "success");
    const gained = shipped.next.reputation - shipped.prev.reputation;
    expect(gained).toBeGreaterThan(0);
    expect(shipped.events).toEqual([{ type: "ship", ok: true, reputationDelta: gained }]);
  });

  it("reports a botched ship with the reputation it cost", () => {
    const botched = stepUntil(base(), "ship dark mode", (attempt) => attempt.action.sound === "fail");
    const lost = botched.next.reputation - botched.prev.reputation;
    expect(lost).toBeLessThan(0);
    expect(botched.events).toEqual([{ type: "ship", ok: false, reputationDelta: lost }]);
  });

  it("reports a refused ship as a failed command, not a failed ship", () => {
    expect(step(base(), "ship").events).toEqual([{ type: "command-failed", command: "ship" }]);
    // (A hacker's first ship of the week is free, so only another founder can be out of AP for it.)
    const outOfAp: GameState = { ...base(), ap: 0, founder: { name: "Test Founder", archetype: "philosopher" } };
    expect(step(outOfAp, "ship it").events).toEqual([{ type: "command-failed", command: "ship" }]);
  });

  it("lets a hacker ship for free with no AP left, and reports the outcome as usual", () => {
    const result = step({ ...base(), ap: 0 }, "ship it");
    expect(result.types).toEqual(["ship"]);
  });
});

describe("launch", () => {
  const base = (): GameState => settled({ team: team({ engineering: 2, marketing: 2 }), cash: 50_000, users: 1_000 });

  it("reports a successful campaign with its users, and the spend as a cash change", () => {
    const launched = stepUntil(base(), "launch spring sale", (attempt) => attempt.action.sound === "success");
    const users = launched.next.users - launched.prev.users;
    expect(users).toBeGreaterThan(0);
    expect(launched.events).toEqual([
      { type: "launch", ok: true, usersDelta: users },
      { type: "cash-changed", delta: -900 },
    ]);
  });

  it("reports a flop — which still brings a few users — without a separate users event", () => {
    const flopped = stepUntil(base(), "launch spring sale", (attempt) => attempt.action.sound === "fail");
    const users = flopped.next.users - flopped.prev.users;
    expect(users).toBeGreaterThan(0);
    expect(flopped.events).toEqual([
      { type: "launch", ok: false, usersDelta: users },
      { type: "cash-changed", delta: -900 },
    ]);
    expect(flopped.types).not.toContain("users-changed");
  });

  it("reports a campaign the company cannot afford as a failed command", () => {
    expect(step({ ...base(), cash: 100 }, "launch spring sale").events).toEqual([{ type: "command-failed", command: "launch" }]);
  });
});

describe("pitch", () => {
  const base = (): GameState => settled({ stage: "seed", mrr: 40_000, users: 4_000, vcReputation: 70 });

  it("reports a pitch that lands", () => {
    const landed = stepUntil(base(), "pitch", (attempt) => attempt.action.sound === "success");
    expect(findWorldEvent(landed.events, "pitch")).toEqual({ type: "pitch", ok: true });
    expect(landed.types.filter((type) => type === "pitch")).toHaveLength(1);
  });

  it("reports a pitch that does not", () => {
    const passed = stepUntil(base(), "pitch", (attempt) => attempt.action.sound === "fail");
    expect(passed.events).toEqual([{ type: "pitch", ok: false }]);
  });

  it("adds a cash change when an angel wires money on the spot", () => {
    const garage = settled({ stage: "garage" });
    const angel = stepUntil(garage, "pitch", (attempt) => attempt.next.cash > attempt.prev.cash);
    expect(angel.events).toEqual([
      { type: "pitch", ok: true },
      { type: "cash-changed", delta: angel.next.cash - angel.prev.cash },
    ]);
  });
});

describe("raise", () => {
  it("reports bootstrap money with the amount that landed, and no separate cash event", () => {
    const result = step(settled({ cash: 10_000 }), "raise friends");
    expect(result.action.sound).toBe("cash-in");
    expect(result.events).toEqual([{ type: "raise", ok: true, amount: 15_000, source: "bootstrap" }]);
  });

  it("recognises every bootstrap source", () => {
    const amounts: Record<string, number> = { friends: 15_000, cards: 15_000, loan: 25_000, preseed: 50_000, mortgage: 250_000 };
    for (const [source, amount] of Object.entries(amounts)) {
      const result = step(settled(), `raise ${source}`);
      expect(findWorldEvent(result.events, "raise"), source).toEqual({ type: "raise", ok: true, amount, source: "bootstrap" });
      expect(result.types, source).not.toContain("cash-changed");
    }
  });

  const fundable = (): GameState =>
    settled({
      stage: "garage",
      valuation: 6_000_000,
      mrr: 120_000,
      users: 12_000,
      vcReputation: 90,
      investors: { pipeline: [{ id: "lead-1", name: "Orchard", riskTolerance: 60, trendBias: "ai", relationship: 95 }] },
    });

  it("reports a closed round with the cash that arrived, and the new stage first", () => {
    const closed = stepUntil(fundable(), "raise vc 500k", (attempt) => attempt.action.sound === "cash-in");
    expect(closed.next.cash - closed.prev.cash).toBe(500_000);
    expect(findWorldEvent(closed.events, "raise")).toEqual({ type: "raise", ok: true, amount: 500_000, source: "vc" });
    expect(findWorldEvent(closed.events, "stage-changed")).toEqual({ type: "stage-changed", from: "garage", to: "seed" });
    expect(closed.types).not.toContain("cash-changed");
    expect(closed.types.indexOf("stage-changed")).toBeLessThan(closed.types.indexOf("raise"));
  });

  it("reports an investor who walks away", () => {
    const stalled = stepUntil(fundable(), "raise vc 900k", (attempt) => attempt.action.sound === "fail");
    expect(stalled.events).toEqual([{ type: "raise", ok: false, amount: 0, source: "vc" }]);
  });

  it("reports a round nobody would lead as a failed raise", () => {
    const noLeads = step(settled(), "raise vc 100k");
    expect(noLeads.action.sound).toBe("fail");
    expect(noLeads.events).toEqual([{ type: "raise", ok: false, amount: 0, source: "vc" }]);
  });

  it("accepts the engine's `vs` typo for `vc`", () => {
    expect(step(settled(), "raise vs 100k").events).toEqual([{ type: "raise", ok: false, amount: 0, source: "vc" }]);
  });

  it("reports only what reached the bank when the round repays debt first", () => {
    const indebted: GameState = { ...fundable(), debtOutstanding: 400_000, debtService: 1_400 };
    const closed = stepUntil(indebted, "raise vc 500k", (attempt) => attempt.action.sound === "cash-in");
    expect(findWorldEvent(closed.events, "raise")).toEqual({ type: "raise", ok: true, amount: 100_000, source: "vc" });

    const swallowed: GameState = { ...fundable(), debtOutstanding: 900_000, debtService: 1_400 };
    const nothingLeft = stepUntil(swallowed, "raise vc 500k", (attempt) => attempt.action.sound === "cash-in");
    expect(findWorldEvent(nothingLeft.events, "raise")).toEqual({ type: "raise", ok: true, amount: 0, source: "vc" });
    expect(nothingLeft.types).not.toContain("cash-changed");
  });

  it("reports malformed raises as failed commands", () => {
    expect(step(settled(), "raise vc").events).toEqual([{ type: "command-failed", command: "raise" }]);
    expect(step(settled(), "raise grandma").events).toEqual([{ type: "command-failed", command: "raise" }]);
    expect(step({ ...settled(), ap: 1 }, "raise vc 100k").events).toEqual([{ type: "command-failed", command: "raise" }]);
  });
});

describe("board actions", () => {
  const base = (): GameState => settled({ board: board(), cash: 50_000, reputation: 50 });

  it("reports a dinner and a gift, with what they cost", () => {
    expect(step(base(), "board dinner dana").events).toEqual([
      { type: "board-action", action: "dinner", ok: true },
      { type: "cash-changed", delta: -2000 },
    ]);
    expect(step(base(), "board gift lee").events).toEqual([
      { type: "board-action", action: "gift", ok: true },
      { type: "cash-changed", delta: -5000 },
    ]);
  });

  it("reports blackmail that works and blackmail that backfires", () => {
    const worked = stepUntil(base(), "board blackmail dana", (attempt) => attempt.action.sound === "success");
    expect(worked.events).toEqual([{ type: "board-action", action: "blackmail", ok: true }]);

    const backfired = stepUntil(base(), "board blackmail dana", (attempt) => attempt.action.sound === "fail");
    expect(backfired.action.rejected).toBe(false);
    expect(backfired.events).toEqual([{ type: "board-action", action: "blackmail", ok: false }]);
  });

  it("still reads a backfire as an outcome if the store flags its error line as a rejection", () => {
    const backfired = stepUntil(base(), "board blackmail dana", (attempt) => attempt.action.sound === "fail");
    const sloppy: ActionSignal = { ...backfired.action, rejected: true };
    expect(deriveWorldEvents(backfired.prev, backfired.next, sloppy)).toEqual([
      { type: "board-action", action: "blackmail", ok: false },
    ]);
  });

  it("reports board commands the engine refuses as failed commands", () => {
    expect(step(base(), "board dinner").events).toEqual([{ type: "command-failed", command: "board" }]);
    expect(step(base(), "board dinner nobody").events).toEqual([{ type: "command-failed", command: "board" }]);
    expect(step(base(), "board serenade dana").events).toEqual([{ type: "command-failed", command: "board" }]);
    expect(step(settled(), "board gift dana").events).toEqual([{ type: "command-failed", command: "board" }]);
  });
});

describe("pricing", () => {
  it("reports a pivot, and the users it shook loose", () => {
    const result = step(settled({ users: 200, mrr: 2_000, pricingModel: "consumer" }), "pricing enterprise");
    expect(result.action.sound).toBe("warning");
    expect(result.events).toEqual([{ type: "pricing-changed" }, { type: "users-changed", delta: -40 }]);
  });

  it("reports a pivot to the current model, or to nonsense, as a failed command", () => {
    const state = settled({ pricingModel: "consumer" });
    expect(step(state, "pricing consumer").events).toEqual([{ type: "command-failed", command: "pricing" }]);
    expect(step(state, "pricing freemium").events).toEqual([{ type: "command-failed", command: "pricing" }]);
  });
});

describe("ending the week", () => {
  const base = (): GameState =>
    settled({ users: 50_000, mrr: 500_000, cash: 400_000, lastWeek: { users: 49_000, mrr: 490_000, cash: 400_000, teamSize: 1 } });

  it("reports the new week, then the week's money and users", () => {
    const quiet = stepUntil(base(), "end", (attempt) => attempt.next.pendingEventTitle === null && attempt.next.phase === attempt.prev.phase);
    const cash = quiet.next.cash - quiet.prev.cash;
    const users = quiet.next.users - quiet.prev.users;
    expect(Math.abs(cash)).toBeGreaterThanOrEqual(CASH_EVENT_THRESHOLD);
    expect(users).not.toBe(0);
    expect(quiet.events).toEqual([
      { type: "week-advanced", week: 2 },
      { type: "cash-changed", delta: cash },
      { type: "users-changed", delta: users },
    ]);
  });

  it("reports an event that the week brings, after the week's numbers", () => {
    const eventful = stepUntil(base(), "end", (attempt) => attempt.next.pendingEventTitle !== null && attempt.next.gameOver === null);
    expect(eventful.types[0]).toBe("week-advanced");
    expect(eventful.types[eventful.types.length - 1]).toBe("event-opened");
    expect(findWorldEvent(eventful.events, "event-opened")).toEqual({
      type: "event-opened",
      title: eventful.state.pendingEvent?.title,
    });
  });

  it("refuses to end the week while an event is pending", () => {
    const blocked = settled({ pendingEvent: pendingEvent("poached", "Poached") });
    expect(step(blocked, "end").events).toEqual([{ type: "command-failed", command: "end" }]);
  });

  it("reports bankruptcy last", () => {
    const doomed = settled({ cash: -500_000, team: team({ engineering: 8 }) });
    const result = step(doomed, "end");
    expect(result.types[0]).toBe("week-advanced");
    expect(result.events[result.events.length - 1]).toEqual({ type: "game-over", ending: "bankruptcy" });
    expect(result.types.filter((type) => type === "game-over")).toHaveLength(1);
    // Nothing more to say once it is over.
    expect(step(result.state, "ship it").events).toEqual([{ type: "command-failed", command: "ship" }]);
  });
});

describe("phase and stage", () => {
  it("reports a phase change first, whatever command triggered it", () => {
    // A garage company whose numbers already justify more: the next action tips it over.
    const ripe: GameState = {
      ...settled({ users: 5_000, mrr: 200_000, cash: 80_000, lastWeek: { users: 4_900, mrr: 196_000, cash: 80_000, teamSize: 1 } }),
      companyPhase: "garage",
    };
    const result = step(ripe, "hire eng 1");
    expect(result.next.phase).not.toBe("garage");
    expect(result.events).toEqual([
      { type: "phase-changed", from: "garage", to: result.next.phase },
      { type: "hired", role: "engineering", personIds: ["engineering-1"] },
      { type: "cash-changed", delta: -3000 },
    ]);
  });

  it("reports falling back a phase just the same", () => {
    const prev = snap({ companyPhase: "office" });
    const next = snap({ companyPhase: "coworking" });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([{ type: "phase-changed", from: "office", to: "coworking" }]);
  });

  it("reports a stage change", () => {
    const prev = snap({ stage: "seed" });
    const next = snap({ stage: "series-a" });
    const events = deriveWorldEvents(prev, next, noAction);
    expect(findWorldEvent(events, "stage-changed")).toEqual({ type: "stage-changed", from: "seed", to: "series-a" });
  });
});

describe("assets", () => {
  it("reports a purchase, then its price", () => {
    const state = settled({ companyPhase: "coworking", users: 5_000, mrr: 200_000, cash: 200_000, lastWeek: { users: 4_900, mrr: 196_000, cash: 200_000, teamSize: 1 } });
    expect(state.companyPhase).not.toBe("garage");
    const result = step(state, "buy office upgrade");
    expect(result.events).toEqual([
      { type: "asset-acquired", assetId: "office-upgrade" },
      { type: "cash-changed", delta: -50_000 },
    ]);
  });

  it("reports each new asset once, in purchase order", () => {
    const prev = snap({ assets: [{ id: "lounge", name: "Executive Lounge", purchaseWeek: 3 }] });
    const next = snap({
      assets: [
        { id: "lounge", name: "Executive Lounge", purchaseWeek: 3 },
        { id: "yacht", name: "Company Yacht", purchaseWeek: 9 },
        { id: "helicopter", name: "Company Helicopter", purchaseWeek: 9 },
      ],
    });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([
      { type: "asset-acquired", assetId: "yacht" },
      { type: "asset-acquired", assetId: "helicopter" },
    ]);
  });

  it("reports a purchase the company cannot make as a failed command", () => {
    expect(step(settled({ cash: 10 }), "buy jet").events).toEqual([{ type: "command-failed", command: "buy" }]);
  });
});

describe("pending events", () => {
  it("reports a resolved event", () => {
    const state = settled({ pendingEvent: pendingEvent("poached", "Poached"), cash: 50_000 });
    const result = step(state, "choose 2");
    expect(result.next.pendingEventTitle).toBeNull();
    expect(result.types).toEqual(["event-resolved"]);
  });

  it("reports the consequences of a choice after the resolution", () => {
    const state = settled({ pendingEvent: pendingEvent("poached", "Poached"), cash: 50_000 });
    const result = step(state, "choose 1");
    expect(result.types).toEqual(["event-resolved", "cash-changed"]);
    expect(findWorldEvent(result.events, "cash-changed")?.delta).toBeLessThan(0);
  });

  it("reports nothing for a choice that does not exist", () => {
    const state = settled({ pendingEvent: pendingEvent("poached", "Poached") });
    const result = step(state, "choose 9");
    expect(result.next.pendingEventTitle).toBe("Poached");
    expect(result.events).toEqual([]);
  });

  it("reports resolved then opened when a choice immediately brings an acquisition offer", () => {
    const state: GameState = {
      ...settled({
        week: 30,
        stage: "growth",
        mrr: 600_000,
        users: 60_000,
        burn: 10_000,
        cash: 5_000_000,
        lastWeek: { users: 60_000, mrr: 600_000, cash: 5_000_000, teamSize: 1 },
        pendingEvent: pendingEvent("culture-memo", "Culture Memo"),
      }),
      valuation: 900_000_000,
    };
    const result = step(state, "choose 1");
    expect(result.state.pendingEvent?.title).toBe("Acquisition Offer");
    const transitions = result.events.filter((event) => event.type === "event-resolved" || event.type === "event-opened");
    expect(transitions).toEqual([{ type: "event-resolved" }, { type: "event-opened", title: "Acquisition Offer" }]);
  });

  it("reports a swapped event as resolved, then opened", () => {
    const prev = snap({ pendingEvent: pendingEvent("poached", "Poached") });
    const next = snap({ pendingEvent: pendingEvent("culture-memo", "Culture Memo") });
    expect(deriveWorldEvents(prev, next, noAction)).toEqual([
      { type: "event-resolved" },
      { type: "event-opened", title: "Culture Memo" },
    ]);
  });

  it("reports a choice that ends the company", () => {
    const state = settled({ pendingEvent: pendingEvent("acquihire", "Acqui-hire Offer"), cash: 5_000 });
    const result = step(state, "choose 1");
    expect(result.types).toEqual(["event-resolved", "cash-changed", "game-over"]);
    expect(result.events[2]).toEqual({ type: "game-over", ending: "acquisition" });
  });

  it("blocks everything but the choice while an event is pending", () => {
    const state = settled({ pendingEvent: pendingEvent("poached", "Poached") });
    expect(step(state, "hire eng 1").events).toEqual([{ type: "command-failed", command: "hire" }]);
    expect(step(state, "coffee").events).toEqual([{ type: "command-failed", command: "coffee" }]);
    expect(step(state, "status").events).toEqual([]);
  });
});

describe("easter eggs", () => {
  it("lists exactly the engine's easter eggs", () => {
    // EASTER_EGGS is private to the engine; read its keys straight from the source.
    const block = /const EASTER_EGGS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(commandsSource);
    expect(block).not.toBeNull();
    const keys = [...(block?.[1] ?? "").matchAll(/^\s*([a-z]+):/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect([...EASTER_EGG_COMMANDS].sort()).toEqual([...keys].sort());
  });

  it("reports every egg, and nothing else, when one is typed", () => {
    const state = settled();
    for (const command of EASTER_EGG_COMMANDS) {
      expect(step(state, command).events, command).toEqual([{ type: "easter-egg", command }]);
    }
    expect(step(state, "coffee").events).toEqual([{ type: "easter-egg", command: "coffee" }]);
    expect(step(state, "COFFEE please").events).toEqual([{ type: "easter-egg", command: "coffee" }]);
  });

  it("does not call an egg an egg if the world moved", () => {
    const prev = snap({ cash: 1_000 });
    const next = snap({ cash: 9_000 });
    const events = deriveWorldEvents(prev, next, signalFor("coffee", null, false));
    expect(events).toEqual([{ type: "cash-changed", delta: 8_000 }]);
  });

  it("reports an unknown word as a failed command", () => {
    expect(step(settled(), "hrie eng 1").events).toEqual([{ type: "command-failed", command: "hrie" }]);
    expect(step(settled(), "xyzzy").events).toEqual([{ type: "command-failed", command: "xyzzy" }]);
  });
});

describe("command-failed", () => {
  it("is all that is reported when the engine refuses", () => {
    // A philosopher has no free first action, so with no AP every action is refused.
    const tired: GameState = { ...settled({ cash: 50_000, founder: { name: "Test Founder", archetype: "philosopher" } }), ap: 0 };
    for (const command of ["hire eng 1", "ship it", "launch it", "pitch", "raise friends", "pricing enterprise", "buy office upgrade"]) {
      expect(step(tired, command).events, command).toEqual([{ type: "command-failed", command: command.split(" ")[0] }]);
    }
  });

  it("covers hires the company cannot make", () => {
    expect(step(settled({ cash: 100 }), "hire eng 1").events).toEqual([{ type: "command-failed", command: "hire" }]);
    expect(step(settled(), "hire data 1").events).toEqual([{ type: "command-failed", command: "hire" }]);
    expect(step(settled(), "hire wizard 1").events).toEqual([{ type: "command-failed", command: "hire" }]);
  });

  it("is not reported for an empty command", () => {
    const snapshot = snap();
    expect(deriveWorldEvents(snapshot, snapshot, signalFor("", null, true))).toEqual([]);
  });
});

describe("ambient deltas", () => {
  const base = snap({ cash: 100_000, users: 1_000 });

  it("ignores cash moves below the threshold and reports those at or above it", () => {
    expect(CASH_EVENT_THRESHOLD).toBe(500);
    expect(deriveWorldEvents(base, withChanges(base, { cash: 100_499 }), noAction)).toEqual([]);
    expect(deriveWorldEvents(base, withChanges(base, { cash: 99_501 }), noAction)).toEqual([]);
    expect(deriveWorldEvents(base, withChanges(base, { cash: 100_500 }), noAction)).toEqual([{ type: "cash-changed", delta: 500 }]);
    expect(deriveWorldEvents(base, withChanges(base, { cash: 99_500 }), noAction)).toEqual([{ type: "cash-changed", delta: -500 }]);
  });

  it("reports any change in users", () => {
    expect(deriveWorldEvents(base, withChanges(base, { users: 1_001 }), noAction)).toEqual([{ type: "users-changed", delta: 1 }]);
    expect(deriveWorldEvents(base, withChanges(base, { users: 940 }), noAction)).toEqual([{ type: "users-changed", delta: -60 }]);
  });

  it("leaves cash to the raise and users to the launch when those explain the change", () => {
    const raised = deriveWorldEvents(base, withChanges(base, { cash: 150_000, users: 1_010 }), signalFor("raise preseed", "cash-in", false));
    expect(raised).toEqual([
      { type: "raise", ok: true, amount: 50_000, source: "bootstrap" },
      { type: "users-changed", delta: 10 },
    ]);
    const launched = deriveWorldEvents(base, withChanges(base, { cash: 99_100, users: 1_300 }), signalFor("launch big one", "success", false));
    expect(launched).toEqual([
      { type: "launch", ok: true, usersDelta: 300 },
      { type: "cash-changed", delta: -900 },
    ]);
  });
});

describe("ordering and uniqueness", () => {
  const CANONICAL_ORDER: WorldEventType[] = [
    "setup-completed",
    "phase-changed",
    "stage-changed",
    "departed",
    "hired",
    "asset-acquired",
    "week-advanced",
    "event-resolved",
    "ship",
    "cash-changed",
    "users-changed",
    "event-opened",
    "game-over",
  ];

  it("emits everything that can happen at once in the documented order", () => {
    const prev = withChanges(snap({ team: team({ engineering: 2, sales: 2 }), pendingEvent: pendingEvent("poached", "Poached") }), {
      setupComplete: false,
    });
    const next = withChanges(
      snap({
        week: 2,
        companyPhase: "coworking",
        stage: "seed",
        team: team({ engineering: 3, sales: 1 }),
        assets: [{ id: "office-upgrade", name: "Office Upgrade", purchaseWeek: 2 }],
        pendingEvent: pendingEvent("culture-memo", "Culture Memo"),
        cash: 50_000,
        users: 400,
        reputation: 58,
        gameOver: { ending: "ipo", week: 2, headline: "…" },
      }),
      { setupComplete: true }
    );
    const events = deriveWorldEvents(prev, next, signalFor("ship everything", "success", false));
    expect(events.map((event) => event.type)).toEqual(CANONICAL_ORDER);
    expect(findWorldEvent(events, "ship")).toEqual({ type: "ship", ok: true, reputationDelta: 8 });
    expect(findWorldEvent(events, "week-advanced")).toEqual({ type: "week-advanced", week: 2 });
    expect(findWorldEvent(events, "game-over")).toEqual({ type: "game-over", ending: "ipo" });
  });

  it("never emits the same event twice", () => {
    const keys = (events: WorldEvent[]): string[] =>
      events.map((event) =>
        event.type === "hired" || event.type === "departed"
          ? `${event.type}:${event.role}`
          : event.type === "asset-acquired"
            ? `${event.type}:${event.assetId}`
            : event.type
      );
    let state = settled({ cash: 300_000, team: team({ engineering: 2, marketing: 1 }) });
    const script = ["hire eng 2", "ship a", "launch b", "pitch", "raise friends", "coffee", "end", "hire ux 1", "ship c", "end", "status", "nonsense"];
    for (const command of script) {
      const result = step(state, command);
      const seen = keys(result.events);
      expect(new Set(seen).size, `${command}: ${seen.join(",")}`).toBe(seen.length);
      state = result.state;
      if (state.pendingEvent) state = step(state, "choose 1").state;
      if (state.gameOver) break;
    }
  });

  it("puts at most one action outcome in a batch", () => {
    const outcomes: WorldEventType[] = ["ship", "launch", "pitch", "raise", "board-action", "pricing-changed", "easter-egg", "command-failed"];
    const state = settled({ cash: 300_000, board: board() });
    for (const command of ["ship a", "launch b", "pitch", "raise loan", "board dinner dana", "pricing enterprise", "ramen", "fly"]) {
      const result = step(state, command);
      expect(result.types.filter((type) => outcomes.includes(type)), command).toHaveLength(1);
    }
  });
});

describe("event helpers", () => {
  const events: WorldEvent[] = [
    { type: "departed", role: "sales", personIds: ["sales-1"] },
    { type: "hired", role: "engineering", personIds: ["engineering-2"] },
    { type: "hired", role: "design", personIds: [] },
    { type: "cash-changed", delta: -5500 },
  ];

  it("find the first event of a type, narrowed", () => {
    expect(findWorldEvent(events, "hired")?.role).toBe("engineering");
    expect(findWorldEvent(events, "cash-changed")?.delta).toBe(-5500);
    expect(findWorldEvent(events, "ship")).toBeUndefined();
  });

  it("filter all events of a type, narrowed", () => {
    expect(filterWorldEvents(events, "hired").map((event) => event.role)).toEqual(["engineering", "design"]);
    expect(filterWorldEvents(events, "game-over")).toEqual([]);
  });
});

describe("coverage of the WorldEvent union", () => {
  it("can produce every member", () => {
    // `true` for every type: adding a member to the union without covering it here is a compile error.
    const produced: Record<WorldEventType, boolean> = {
      "run-reset": false,
      "setup-completed": false,
      "week-advanced": false,
      hired: false,
      departed: false,
      ship: false,
      launch: false,
      pitch: false,
      raise: false,
      "board-action": false,
      "pricing-changed": false,
      "cash-changed": false,
      "users-changed": false,
      "phase-changed": false,
      "stage-changed": false,
      "asset-acquired": false,
      "event-opened": false,
      "event-resolved": false,
      "easter-egg": false,
      "command-failed": false,
      "game-over": false,
    };
    const record = (events: WorldEvent[]): void => {
      for (const event of events) produced[event.type] = true;
    };

    const base = snap({ team: team({ engineering: 2 }), cash: 100_000, users: 1_000, pendingEvent: pendingEvent("poached", "Poached") });
    record(deriveWorldEvents(base, snap({ seed: 999 }), noAction));
    record(
      deriveWorldEvents(
        withChanges(base, { setupComplete: false }),
        withChanges(
          snap({
            week: 2,
            companyPhase: "office",
            stage: "seed",
            team: team({ engineering: 1, hr: 1 }),
            assets: [{ id: "lounge", name: "Executive Lounge", purchaseWeek: 2 }],
            pendingEvent: pendingEvent("culture-memo", "Culture Memo"),
            cash: 10_000,
            users: 2_000,
            gameOver: { ending: "founder-removal", week: 2, headline: "…" },
          }),
          { setupComplete: true }
        ),
        noAction
      )
    );
    const same = snap();
    record(deriveWorldEvents(same, same, signalFor("ship x", "fail", false)));
    record(deriveWorldEvents(same, same, signalFor("launch x", "success", false)));
    record(deriveWorldEvents(same, same, signalFor("pitch", "fail", false)));
    record(deriveWorldEvents(same, same, signalFor("raise vc 1m", "fail", false)));
    record(deriveWorldEvents(same, same, signalFor("board gift sam", "success", false)));
    record(deriveWorldEvents(same, same, signalFor("pricing prosumer", "warning", false)));
    record(deriveWorldEvents(same, same, signalFor("coffee", null, false)));
    record(deriveWorldEvents(same, same, signalFor("hire", null, true)));

    const missing = Object.entries(produced)
      .filter(([, seen]) => !seen)
      .map(([type]) => type);
    expect(missing).toEqual([]);
  });
});
