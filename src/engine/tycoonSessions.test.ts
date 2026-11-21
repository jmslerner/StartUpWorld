// Properties with the real modules (TYCOON-SPEC §12.3), on scripted sessions that actually use every new command:
// determinism (two 60-week sessions, deep-equal states and identical logs), the roster <-> headcount invariant, plain-JSON
// round trips and an untouched state.rng after every tycoon command; and a v2 save that migrates and then plays on.
import { describe, expect, it } from "vitest";
import type { ActionResult, GameState } from "../types/game";
import { createInitialState } from "./actions";
import { calcBurn } from "./economy";
import { executeCommand } from "./commands";
import { refreshDerivedNoLog } from "./derived";
import { migrateState } from "./index";
import { buildsOf, rosterInvariantHolds, rosterOf, staffOf } from "./tycoon/roster";

const TYCOON = new Set(["team", "recruit", "retain", "fire", "build", "project", "projects", "staff"]);
const TYPES = ["feature", "growth", "plumbing", "feature", "premium", "moonshot"];

const strip = (s: GameState): string => {
  const rest: Record<string, unknown> = { ...(s as unknown as Record<string, unknown>) };
  delete rest.people;
  delete rest.product;
  return JSON.stringify(rest);
};

interface Session { state: GameState; log: string[]; ok: Map<string, number>; failures: string[] }

/** A scripted founder who touches every tycoon command form, checked after every single command. */
const scriptedSession = (seed: number, founder: string, cofounder: string, weeks: number): Session => {
  let s = refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });
  const log: string[] = [];
  const ok = new Map<string, number>();
  const failures: string[] = [];
  const run = (input: string): ActionResult => {
    const before = s;
    const res = executeCommand(s, input);
    s = res.state;
    log.push(...res.logs.map((l) => l.text));
    const head = input.split(" ")[0];
    const second = input.split(" ")[1] ?? "";
    const key =
      head === "build" && (second === "crunch" || second === "cancel") ? `build ${second}` : head === "staff" && second === "off" ? "staff off" : head;
    if (!res.logs.some((l) => l.kind === "error")) ok.set(key, (ok.get(key) ?? 0) + 1);
    const where = `w${before.week} "${input}"`;
    if (!rosterInvariantHolds(s)) failures.push(`${where}: invariant`);
    if (JSON.stringify(JSON.parse(JSON.stringify(s))) !== JSON.stringify(s)) failures.push(`${where}: JSON`);
    const releases = head === "ship" && buildsOf(before).some((b) => input === `ship ${b.slug}`);
    if ((TYCOON.has(head) || releases) && s.rng !== before.rng) failures.push(`${where}: state.rng moved`);
    return res;
  };
  for (const c of ["name Ada", "company Loopwell", `founder ${founder}`, `cofounder ${cofounder}`]) run(c);
  s = { ...s, cash: s.cash + 2_000_000 };
  let kickoffs = 0;
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    if (s.pendingEvent) run("choose 1");
    if (w % 9 === 0) run("team");
    if (w % 9 === 1) run("team all");
    if (w % 4 === 2) {
      run("recruit eng");
      run(`recruit eng ${1 + (w % 3)}`);
    }
    if (w % 6 === 3) run("hire eng 2");
    if (w % 8 === 5) run("hire marketing 1");
    // Builds: start one when a slot is free; release at 60%+ (sometimes waiting for 100%); crunch on and off; a cancel.
    const active = buildsOf(s);
    if (active.length === 0 || (w % 10 === 7 && active.length < 2)) {
      run(`build ${TYPES[kickoffs % TYPES.length]} ${w % 3 === 0 ? "m" : "s"} Bet ${kickoffs + 1}`);
      kickoffs += 1;
    }
    for (const b of buildsOf(s)) {
      const done = b.progress / b.scope;
      if (done >= 1 || (done >= 0.6 && w % 2 === 0)) run(`ship ${b.slug}`);
      else if (w % 7 === 1 && !b.crunch) run(`build crunch ${b.slug}`);
      else if (b.crunch && w % 7 === 3) run(`build crunch ${b.slug} off`);
      if (staffOf(s, b.id).length === 0 && buildsOf(s).some((x) => x.id === b.id)) run(`staff ${b.slug} auto`);
    }
    if (w % 11 === 4) {
      const b = buildsOf(s)[0];
      const member = b ? staffOf(s, b.id)[0] : undefined;
      if (b && member) {
        run(`staff off ${member.id}`);
        run(`staff ${b.slug} ${member.id}`);
      }
    }
    if (w % 19 === 12 && buildsOf(s).length > 0) run(`build cancel ${buildsOf(s)[0].slug}`);
    // People: answer every other offer, let the rest walk; a firing and a small layoff now and then.
    for (const e of rosterOf(s)) if (e.offerDueWeek > 0 && e.retainedWeek === 0 && Number(e.id.slice(1)) % 2 === 0) run(`retain ${e.id}`);
    if (w % 13 === 6) {
      const idle = rosterOf(s).find((e) => !e.engaged);
      if (idle) run(`fire ${idle.id}`);
    }
    if (w % 17 === 10 && s.team.marketing >= 2) run("fire marketing 1");
    if (w % 5 === 0) run(`ship patch-${w}`);
    if (w % 10 === 9) run("status");
    run("build");
    run("end");
  }
  return { state: s, log, ok, failures };
};

describe("scripted tycoon sessions (real modules)", () => {
  it("are deterministic over 60 weeks: deep-equal states and identical log texts", () => {
    for (const [seed, f, c] of [[11, "hacker", "operator"], [29, "visionary", "builder"]] as const) {
      const a = scriptedSession(seed, f, c, 60);
      const b = scriptedSession(seed, f, c, 60);
      expect(b.state).toEqual(a.state);
      expect(b.log).toEqual(a.log);
      expect(a.state.week).toBeGreaterThanOrEqual(40); // long enough to exercise everything (an ending may close it)
    }
  });

  it("keep every invariant after every command and use every new command form successfully", () => {
    const seen = new Map<string, number>();
    for (const [seed, f, c] of [[11, "hacker", "operator"], [29, "visionary", "builder"], [5, "sales-animal", "powderkeg"]] as const) {
      const run = scriptedSession(seed, f, c, 60);
      expect(run.failures).toEqual([]);
      for (const [k, v] of run.ok) seen.set(k, (seen.get(k) ?? 0) + v);
      expect(run.state.product!.shippedCount).toBeGreaterThan(3);
    }
    for (const form of ["team", "recruit", "retain", "fire", "build", "build crunch", "build cancel", "staff", "staff off", "ship"]) {
      expect(seen.get(form) ?? 0, `successful "${form}" commands`).toBeGreaterThan(0);
    }
  });
});

describe("a v2 save with the real modules", () => {
  it("migrates without moving a legacy number, then plays on with the new commands", () => {
    // A v2 save: a mid-run legacy state from today's commands only, with the slices stripped as an old build saved it.
    let s = refreshDerivedNoLog({ ...createInitialState(), seed: 314, rng: (314 ^ 0x9e3779b9) >>> 0, logSeq: 0 });
    for (const c of ["name Old", "company OldCo", "founder hacker", "cofounder builder", "raise preseed", "hire eng 2", "hire ux 1.5", "end", "hire marketing 1", "ship onboarding", "end"]) {
      s = executeCommand(s, c).state;
      if (s.pendingEvent) s = executeCommand(s, `choose ${s.pendingEvent.choices.length}`).state;
    }
    expect(s.gameOver).toBeNull();
    const v2 = JSON.parse(JSON.stringify({ ...s, cash: 400_000, people: undefined, product: undefined })) as GameState;
    expect(v2.people).toBeUndefined();
    const m = migrateState(v2, 2);
    expect(strip(m)).toBe(strip(v2));
    expect(calcBurn(m)).toBe(calcBurn(v2));
    expect(rosterInvariantHolds(m)).toBe(true);
    expect(rosterOf(m)).toHaveLength(Math.floor(v2.team.engineering) + Math.floor(v2.team.design) + Math.floor(v2.team.marketing));
    expect(migrateState(m, 3)).toEqual(m);
    // The next legacy week is today's week; then the new systems work on the migrated roster.
    const legacyNext = executeCommand(v2, "end").state;
    const migratedNext = executeCommand(m, "end").state;
    expect(strip(migratedNext)).toBe(strip(legacyNext));
    let t = migratedNext.pendingEvent ? executeCommand(migratedNext, `choose ${migratedNext.pendingEvent.choices.length}`).state : migratedNext;
    for (const c of ["team", "build feature s Rescue", "end"]) {
      const res = executeCommand(t, c);
      expect(res.logs.filter((l) => l.kind === "error").map((l) => l.text), c).toEqual([]);
      t = res.state;
      expect(rosterInvariantHolds(t)).toBe(true);
    }
    expect(buildsOf(t)[0]?.progress ?? 0).toBeGreaterThan(0);
  });
});
