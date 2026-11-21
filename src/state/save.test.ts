import { describe, expect, it } from "vitest";
import type { GameState, LogEntry, TeamRole } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { calcBurn } from "../engine/economy";
import { listRoster } from "../engine/people";
import { parseSave, SAVE_VERSION, serializeSave } from "./save";

// The store's save format (guide d1): version 3, with every older save migrated by the
// engine's migrateState. Runs in node: parseSave never touches `window`.

/** Runs commands in order; a pending event is answered with `choose 1` first, as a player would. */
const play = (state: GameState, commands: string[]): GameState =>
  commands.reduce((s, cmd) => {
    const ready = s.pendingEvent ? executeCommand(s, "choose 1").state : s;
    return executeCommand(ready, cmd).state;
  }, state);

/** A real run a few weeks in: setup, some hires, a patch, a campaign and two week closes. */
const liveRun = (): GameState =>
  play(createInitialState(), [
    "seed 4242",
    "name Ada",
    "company Loopwell",
    "founder hacker",
    "cofounder builder",
    "raise friends",
    "raise loan",
    "hire eng 1",
    "hire ux 1",
    "end",
    "ship login page",
    "end",
    "pitch",
    "end",
  ]);

/** What the pre-tycoon game stored: the same state with no `people` / `product` slices. */
const legacyState = (s: GameState): GameState => {
  const copy: Partial<GameState> = { ...s };
  delete copy.people;
  delete copy.product;
  return copy as GameState;
};

const withoutSlices = (s: GameState): Omit<GameState, "people" | "product"> => {
  const copy: Partial<GameState> = { ...s };
  delete copy.people;
  delete copy.product;
  return copy as Omit<GameState, "people" | "product">;
};

const LOG: LogEntry[] = [{ id: "l1", text: "> status", kind: "user" } as LogEntry];

const stored = (version: number, state: GameState, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version, state, log: LOG, commandHistory: ["status"], ...extra });

const ROLES: TeamRole[] = ["engineering", "design", "marketing", "sales", "ops", "hr", "legal", "data", "product", "executive"];

describe("save format", () => {
  it("is version 3, from the engine", () => {
    expect(SAVE_VERSION).toBe(3);
    expect(JSON.parse(serializeSave(liveRun(), LOG, [])).version).toBe(3);
  });

  it("starts fresh games with both tycoon slices", () => {
    const fresh = createInitialState();
    expect(fresh.people).toBeDefined();
    expect(fresh.product).toBeDefined();
  });

  it("round-trips a current save unchanged", () => {
    const s = liveRun();
    const loaded = parseSave(serializeSave(s, LOG, ["end"]));
    expect(loaded).not.toBeNull();
    expect(loaded!.fromVersion).toBe(3);
    expect(loaded!.state).toEqual(s);
    expect(loaded!.log).toEqual(LOG);
    expect(loaded!.commandHistory).toEqual(["end"]);
  });
});

describe("loading a version 2 save (before named people and builds)", () => {
  const v2 = legacyState(liveRun());

  it("is a real pre-tycoon shape: head counts, no slices, a run in progress", () => {
    expect(v2.week).toBe(4);
    expect(v2.gameOver).toBeFalsy();
    expect(v2.cash).toBeGreaterThan(10_000);
    expect(v2.team.engineering + v2.team.design).toBeGreaterThanOrEqual(2);
    expect(v2.people).toBeUndefined();
    expect(v2.product).toBeUndefined();
  });

  it("gets a roster equal to the whole heads per role and an empty product", () => {
    const loaded = parseSave(stored(2, v2))!;
    expect(loaded.version).toBe(3);
    expect(loaded.fromVersion).toBe(2);
    const roster = loaded.state.people!.roster;
    for (const role of ROLES) {
      expect(roster.filter((e) => e.role === role).length).toBe(Math.floor(v2.team[role]));
    }
    expect(roster.every((e) => /^e\d+$/.test(e.id) && e.name.length > 0)).toBe(true);
    expect(loaded.state.product!.active).toEqual([]);
    expect(loaded.state.product!.shippedCount).toBe(0);
  });

  it("changes nothing the old game had, and costs the same to run", () => {
    const loaded = parseSave(stored(2, v2))!;
    expect(withoutSlices(loaded.state)).toEqual(v2);
    expect(calcBurn(loaded.state)).toBe(calcBurn(v2));
    expect(loaded.log).toEqual(LOG);
    expect(loaded.commandHistory).toEqual(["status"]);
  });

  it("keeps playing: legacy commands match the old state, new commands work", () => {
    const loaded = parseSave(stored(2, v2))!.state;
    let a = v2;
    let b = loaded;
    for (const cmd of ["hire eng 1", "ship search", "end"]) {
      a = play(a, [cmd]);
      b = play(b, [cmd]);
      expect(withoutSlices(b)).toEqual(withoutSlices(a));
    }
    if (b.pendingEvent) b = executeCommand(b, "choose 1").state;
    const team = executeCommand(b, "team");
    expect(team.logs.some((l) => l.kind === "error")).toBe(false);
    const name = listRoster(b)[0].name.split(" ")[0];
    expect(executeCommand(b, `team ${name}`).logs.some((l) => l.kind === "error")).toBe(false);

    const started = executeCommand(b, "build feature s Atlas");
    expect(started.logs.filter((l) => l.kind === "error").map((l) => l.text)).toEqual([]);
    expect(started.state.product!.active.map((x) => x.slug)).toEqual(["atlas"]);
  });

  it("is idempotent: loading the written-back save changes nothing", () => {
    const once = parseSave(stored(2, v2))!;
    const twice = parseSave(serializeSave(once.state, once.log, once.commandHistory))!;
    expect(twice.fromVersion).toBe(3);
    expect(twice.state).toEqual(once.state);
  });

  it("leaves a save an interim build stamped 2 while it already held slices alone", () => {
    const live = liveRun();
    expect(parseSave(stored(2, live))!.state).toEqual(live);
  });
});

describe("loading a version 1 save (before assets)", () => {
  it("gets `assets: []` and both slices", () => {
    const v1: Partial<GameState> = { ...legacyState(liveRun()) };
    delete v1.assets;
    const loaded = parseSave(stored(1, v1 as GameState))!;
    expect(loaded.version).toBe(3);
    expect(loaded.state.assets).toEqual([]);
    expect(loaded.state.people!.roster.length).toBe(Math.floor(v1.team!.engineering) + Math.floor(v1.team!.design));
    expect(loaded.state.product).toBeDefined();
  });
});

describe("unusable saves start a fresh run", () => {
  const s = liveRun();
  it.each([
    ["nothing stored", null],
    ["empty string", ""],
    ["not JSON", "{oops"],
    ["JSON null", "null"],
    ["a future version", stored(4, s)],
    ["version 0", stored(0, s)],
    ["a fractional version", stored(2.5, s)],
    ["a string version", JSON.stringify({ version: "3", state: s, log: [], commandHistory: [] })],
    ["no version", JSON.stringify({ state: s, log: [], commandHistory: [] })],
    ["no seed", stored(3, { ...s, seed: undefined as unknown as number })],
    ["no state", JSON.stringify({ version: 3, log: [], commandHistory: [] })],
  ])("%s", (_label, raw) => {
    expect(parseSave(raw)).toBeNull();
  });

  it("drops malformed log and history entries instead of crashing", () => {
    const loaded = parseSave(stored(3, s, { log: [LOG[0], 7, { text: 1 }], commandHistory: ["end", 3, null] }))!;
    expect(loaded.log).toEqual(LOG);
    expect(loaded.commandHistory).toEqual(["end"]);
    const noArrays = parseSave(stored(3, s, { log: "x", commandHistory: {} }))!;
    expect(noArrays.log).toEqual([]);
    expect(noArrays.commandHistory).toEqual([]);
  });
});
