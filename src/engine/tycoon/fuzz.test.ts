import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { executeCommand } from "../commands";
import { createInitialState } from "../actions";
import { refreshDerivedNoLog } from "../derived";
import { makeState } from "../testHelpers";
import { mulberry } from "../__golden__/legacyBots";
import { POLISH_MAX, RELEASE_LOG_MAX, ROSTER_CAP, SURPRISE_MAX } from "./constants";
import { buildsOf, rosterInvariantHolds, rosterOf } from "./roster";

// Invariants and properties (TYCOON-SPEC §12.3). CI subset: 8 seeds x 200 commands (E3 runs 24 x 400).
// Against the stub modules this exercises the hooks and the wiring; it gains teeth as STAFF and PROJECTS land.

const NEW_COMMANDS = new Set(["team", "recruit", "retain", "fire", "build", "project", "projects", "staff"]);
const ROLES = ["eng", "ux", "marketing", "sales", "ops", "hr", "legal", "data", "pm", "exec", "wizard"];
const TYPES = ["feature", "growth", "premium", "plumbing", "moonshot", "feat", "loop", "infra", "moon", "banana"];
const SIZES = ["s", "m", "l", "xl", "huge", "tiny", ""];
const NAMES = ["Atlas", "Referral Loop", "phoenix", "e12", "b3", "#3", "12", "on", "off", "ship", "crunch", "x".repeat(30), "Plan B", "!!!", "eng"];

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Plain JSON only: finite numbers, strings, booleans, null, arrays and plain objects; no undefined anywhere. */
const isPlainJson = (v: unknown): boolean => {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlainJson);
  if (typeof v === "object") {
    if (Object.getPrototypeOf(v) !== Object.prototype) return false;
    return Object.values(v as Record<string, unknown>).every((x) => x !== undefined && isPlainJson(x));
  }
  return false;
};

const boundsHold = (s: GameState): boolean => {
  const people = s.people;
  const product = s.product;
  if (!people || !product) return false;
  if (people.roster.length > ROSTER_CAP) return false;
  for (const e of people.roster) {
    if (![e.pace, e.craft].every((x) => Number.isInteger(x) && x >= 1 && x <= 5)) return false;
    if (!Number.isInteger(e.energy) || e.energy < 0 || e.energy > 100) return false;
    if ((e.offerKind === null) !== (e.offerDueWeek === 0)) return false;
    if (e.offerDueWeek === 0 && e.leadOnNotice !== null) return false;
  }
  for (const pool of Object.values(people.candidates)) if ((pool ?? []).length > 3) return false;
  if (product.active.length > 3 || product.shipped.length > RELEASE_LOG_MAX) return false;
  for (const b of product.active) {
    if (b.progress < 0 || b.progress > b.scope || b.polish < 0 || b.polish > POLISH_MAX || b.surprises < 0 || b.surprises > SURPRISE_MAX) return false;
  }
  if (product.cruft < 0 || product.cruft > 100 || product.moat < 0 || product.moat > 100) return false;
  return product.arpuCarry >= 0 && product.arpuCarry < 1;
};

const firstNames = (s: GameState): string[] => rosterOf(s).map((e) => e.name.split(" ")[0]);

const randomCommand = (s: GameState, r: () => number): string => {
  if (s.pendingEvent && r() < 0.7) return `choose ${1 + Math.floor(r() * 4)}`;
  if (s.ap === 0 && r() < 0.6) return "end";
  const people = [...firstNames(s), ...rosterOf(s).map((e) => e.id), "nobody", "", "m"];
  const slugs = [...buildsOf(s).map((b) => b.slug), ...buildsOf(s).map((b) => `${b.slug.slice(0, -1)}x`), ...buildsOf(s).map((b) => b.slug.slice(0, 3)), "atlas", "zzz"];
  const x = r();
  if (x < 0.1) return "end";
  if (x < 0.16) return `hire ${pick(r, ROLES)} ${pick(r, ["1", "2", "1.5", "0.5", "0", "-1", "abc", "5000", "44"])}`;
  if (x < 0.21) return pick(r, ["ship", `ship feature-${Math.floor(r() * 99)}`, "ship onboarding"]);
  if (x < 0.25) return pick(r, ["launch x", "pitch", "raise friends", "raise vc 500k", "pricing enterprise", "pricing consumer", "status", "help", "board", "buy office", "perks"]);
  if (x < 0.31) return pick(r, ["team", "team all", `team ${pick(r, ROLES)}`, `team ${pick(r, people)}`]);
  if (x < 0.38) return pick(r, [`recruit ${pick(r, ROLES)}`, `recruit ${pick(r, ROLES)} ${1 + Math.floor(r() * 4)}`, "recruit"]);
  if (x < 0.42) return pick(r, [`retain ${pick(r, people)}`, "retain"]);
  if (x < 0.48) return pick(r, ["fire", `fire ${pick(r, people)}`, `fire ${pick(r, ROLES)} ${pick(r, ["1", "2", "1.5", "0", "x", ""])}`]);
  if (x < 0.62) {
    return pick(r, [
      "build", "build list", "project", "projects",
      `build ${pick(r, TYPES)} ${pick(r, SIZES)} ${pick(r, NAMES)}`.trim(),
      `build start ${pick(r, TYPES)}`, `build new ${pick(r, TYPES)} ${pick(r, SIZES)}`,
      `build crunch ${pick(r, slugs)} ${pick(r, ["on", "off", ""])}`.trim(),
      `build cancel ${pick(r, slugs)}`, `build ship ${pick(r, slugs)}`,
    ]);
  }
  if (x < 0.74) {
    return pick(r, [
      `staff ${pick(r, slugs)} auto`, `staff ${pick(r, slugs)} ${pick(r, people)}`, `staff ${pick(r, slugs)} ${pick(r, ROLES)} ${1 + Math.floor(r() * 3)}`,
      `staff off ${pick(r, people)}`, `staff off ${pick(r, slugs)}`, "staff", "staff off", `staff off ${pick(r, ROLES)} 2`,
    ]);
  }
  if (x < 0.84) return `ship ${pick(r, slugs)}`;
  return pick(r, ["choose 1", "choose 2", "fire", "taem", "biuld", "sudo", "", "   ", "build feature xl", "end"]);
};

const startRun = (seed: number): GameState => {
  let s = refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
  const founders = ["visionary", "hacker", "sales-animal", "philosopher"];
  const cofounders = ["operator", "builder", "rainmaker", "powderkeg"];
  for (const cmd of ["name Fuzz", "company FuzzCo", `founder ${founders[seed % 4]}`, `cofounder ${cofounders[(seed >> 2) % 4]}`]) {
    s = executeCommand(s, cmd).state;
  }
  return { ...s, cash: s.cash + 400_000 };
};

describe("fuzz: invariants after every command", () => {
  it("holds I1-I4, plain JSON, finite numbers and an untouched state.rng for tycoon commands (8 seeds x 200 commands)", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const r = mulberry(seed * 977);
      let s = startRun(seed);
      for (let i = 0; i < 200; i++) {
        if (s.gameOver && r() < 0.3) s = startRun(seed + 100 * (i + 1));
        const input = randomCommand(s, r);
        const before = s;
        const result = executeCommand(s, input);
        s = result.state;
        const token = input.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        const releasesBuild = token === "ship" && buildsOf(before).some((b) => input.trim().split(/\s+/).slice(1).join(" ") === b.slug);
        const where = `seed ${seed} #${i} "${input}"`;
        if (!rosterInvariantHolds(s)) failures.push(`${where}: roster invariant`);
        if (!isPlainJson(s)) failures.push(`${where}: not plain JSON`);
        if (!boundsHold(s)) failures.push(`${where}: bounds`);
        if (![s.cash, s.users, s.arpu, s.mrr, s.burn].every(Number.isFinite)) failures.push(`${where}: non-finite number`);
        if ((NEW_COMMANDS.has(token) || releasesBuild) && s.rng !== before.rng) failures.push(`${where}: state.rng moved`);
        if (failures.length > 5) break;
      }
    }
    expect(failures).toEqual([]);
  });

  it("is deterministic: the same seed and script twice give deep-equal states and identical log texts", () => {
    const play = (): { state: GameState; log: string[] } => {
      const r = mulberry(4242);
      let s = startRun(77);
      const log: string[] = [];
      let weeks = 0;
      for (let i = 0; i < 2000 && weeks < 60 && !s.gameOver; i++) {
        const input = randomCommand(s, r);
        const res = executeCommand(s, input);
        s = res.state;
        if (input === "end") weeks += 1;
        log.push(...res.logs.map((l) => l.text));
      }
      return { state: s, log };
    };
    const a = play();
    const b = play();
    expect(b.state).toEqual(a.state);
    expect(b.log).toEqual(a.log);
  });
});

describe("legacy states stay legacy", () => {
  it("200 random legacy commands on a slice-less makeState() never create slices", () => {
    const r = mulberry(31337);
    let s = makeState({ cash: 300_000 });
    const legacy = ["end", "hire eng 1", "hire ux 1.5", "hire sales 2", "ship x", "ship", "launch y", "pitch", "raise friends", "status", "help",
      "fire", "board", "pricing prosumer", "buy office", "choose 1", "choose 2", "perks", "phases", "assets", "hire hr 1", "sudo"];
    for (let i = 0; i < 200; i++) {
      s = executeCommand(s, pick(r, legacy)).state;
      expect(s.people).toBeUndefined();
      expect(s.product).toBeUndefined();
    }
  });
});
