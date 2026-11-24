// Scripted playthroughs (spec §12.7). They replay real sessions command by command and assert the key lines and values.
// They depend on draw order and constants: whoever retunes a constant updates the expected values here in the same change,
// deliberately. No weekly-line `≈` value is asserted (spec §1.4 critic note).
//
// ERRATA 64 mixes the tycoon stream seeds, so the names and numbers below are no longer the spec's §1.4 transcripts (those
// were drawn from the unmixed streams). The early game keeps the §1.4 script on seed 42 with re-derived values; the mid game
// uses seed 86, the first seed in 1..200 on which the no-retain bot reaches week 29 with a build lead holding an outside
// offer (spec §12.7's fallback rule). The spec's worked examples B, C and D stay pinned to the digit by the unit tests,
// which build their states by hand and do not depend on the streams.
import { beforeEach, describe, expect, it } from "vitest";
import type { GameState } from "../types/game";
import { createInitialState } from "./actions";
import { executeCommand } from "./commands";
import { refreshDerivedNoLog } from "./derived";
import { rosterInvariantHolds, rosterOf } from "./tycoon/roster";
import fixtureRaw from "./__fixtures__/seed86-week29.commands.json?raw";
import { storyConfig } from "./story/config";

interface Fixture { seed: number; founder: string; cofounder: string; commands: string[] }
const fixture = JSON.parse(fixtureRaw) as Fixture;

/** The harness start state (scripts/tycoon/bots.ts `seededInitial`, the same as scripts/balanceSim.ts). */
const seeded = (seed: number): GameState => refreshDerivedNoLog({ ...createInitialState(), seed, rng: (seed ^ 0x9e3779b9) >>> 0, logSeq: 0 });

const session = (seed: number, founder: string, cofounder: string) => {
  let s = seeded(seed);
  for (const c of ["name Ada", "company Loopwell", `founder ${founder}`, `cofounder ${cofounder}`]) s = executeCommand(s, c).state;
  const api = {
    get state() { return s; },
    run(input: string): string[] {
      const res = executeCommand(s, input);
      s = res.state;
      expect(rosterInvariantHolds(s), `invariant after "${input}"`).toBe(true);
      return res.logs.flatMap((l) => l.text.split("\n"));
    },
    /** Resolve a pending event with its last choice, as the prototype transcripts did. */
    auto(): void {
      if (s.pendingEvent) s = executeCommand(s, `choose ${s.pendingEvent.choices.length}`).state;
    },
  };
  return api;
};

const line = (lines: string[], needle: string): string => {
  const hit = lines.find((l) => l.includes(needle));
  expect(hit, `a line containing "${needle}" in:\n${lines.join("\n")}`).toBeDefined();
  return hit ?? "";
};

describe("early game: seed 42, hacker + operator (the §1.4 script)", () => {
  it("an S feature from kickoff to a SOLID release", () => {
    const g = session(42, "hacker", "operator");
    expect(g.run("team")).toContain("Team: 1 person · payroll $3,500/wk");
    g.run("raise preseed");
    expect(line(g.run("hire eng 1"), "Hired 1 engineering hire:")).toContain("Mateo Nkosi (pace 3, craft 3)");

    const kickoff = g.run("build feature onboarding");
    line(kickoff, "Kickoff: onboarding — Feature S (5 pts");
    line(kickoff, "Staffed: Idris Osei, Mateo Nkosi.");
    line(kickoff, "Due week 5");
    line(kickoff, "Forecast if it ships finished and on time: ~69 (SOLID) ±5.");

    line(g.run("end"), "onboarding: 0% → 45% built (+2.3 pts)");
    g.auto();
    line(g.run("ship fix signup"), "Shipped feature: fix signup.");
    line(g.run("end"), "onboarding: 100% built.");
    g.auto();
    line(g.run("end"), "onboarding: built, polish 5.2/9.");
    g.auto();

    expect(g.state.users).toBe(43);
    const release = g.run("ship onboarding");
    line(release, "Shipping onboarding — Feature S, 100% built, quality 70.");
    line(release, "RECEPTION 71/100 — SOLID.");
    line(release, "quality 70 x 1.00 complete · fit +6 · luck -2 · stress -3");
    expect(line(release, "Reputation +4.")).toContain("Users +34.");
    line(release, "Idris Osei led it. Recruiters have noticed.");
    expect(g.state.users).toBe(77);
    expect(g.state.product?.shipped[0]).toMatchObject({ name: "onboarding", reception: 71, tier: "solid", quality: 70, leadName: "Idris Osei" });
  });
});

describe("mid game: seed 86, hacker + builder, replayed to week 29", () => {
  // The fixture was recorded on the game before The Next Round story pack and pins exact tycoon numbers (seed 86 is the
  // first seed with a lead on notice at week 29); the pack's events and news lines would change that game, so it replays
  // with the pack switched off. The pack has its own tests in src/engine/story/.
  // Per test, not per file: the shared setup (src/test/setup.ts) switches the pack back on before every test.
  beforeEach(() => {
    storyConfig.enabled = false;
  });

  const atWeek29 = () => {
    const g = session(fixture.seed, fixture.founder, fixture.cofounder);
    // The fixture includes the four setup commands, which `session` already ran.
    for (const c of fixture.commands.slice(4)) g.run(c);
    return g;
  };

  it("reaches week 29 with Wren leading Tuesday and holding an outside offer due week 31", () => {
    const g = atWeek29();
    const s = g.state;
    expect(s.week).toBe(29);
    const tuesday = s.product?.active.find((b) => b.slug === "tuesday");
    expect(tuesday).toMatchObject({ type: "feature", size: "m", scope: 15.6, dueWeek: 34 });
    expect(tuesday?.progress).toBeCloseTo(7.31, 2);
    const wren = rosterOf(s).find((e) => e.name === "Wren Marsh");
    expect(wren).toMatchObject({ pace: 1, craft: 5, salary: 3500, shipped: 2, offerDueWeek: 31, offerKind: "recruiter", leadOnNotice: tuesday?.id, buildId: tuesday?.id });

    const board = g.run("build");
    line(board, "Tuesday [tuesday] · Feature M · 46% built (7.3/15.6 pts) · quality 76");
    // A shared first name gets its id; a lead holding notice is flagged where the lead is named.
    line(board, "team 3/3 (Wren, Rafael, Nadia (e15)) · lead Wren (leaving in 2w) · ETA ~3w · due week 34");
    const card = g.run("team wren");
    line(card, "Holding an outside offer: gone in 2 week(s) unless you `retain wren`. Tuesday loses a quarter if they go.");
    line(card, "`retain e1` (1 AP, $7,000 bonus, pay → $3,850/wk)");
  });

  it("retain, a look at the market, and a week of crunch: Tuesday 46% → 75%", () => {
    const g = atWeek29();
    const cash = g.state.cash;
    const retain = g.run("retain wren");
    line(retain, "Bonus -$7,000. Pay $3,500 → $3,850/wk.");
    expect(cash - g.state.cash).toBe(7000);
    expect(rosterOf(g.state).find((e) => e.name === "Wren Marsh")).toMatchObject({ salary: 3850, offerDueWeek: 0, leadOnNotice: null, retainedWeek: 29 });

    const rngBefore = g.state.rng;
    const look = g.run("recruit eng");
    line(look, "Candidates for engineering this week (signing $3,000, 1 AP) — unvetted");
    expect(look.filter((l) => /^\s+\d\) /.test(l))).toHaveLength(3);
    line(g.run("build crunch tuesday"), "Crunch on: Tuesday.");
    expect(g.state.rng).toBe(rngBefore); // tycoon commands never touch the legacy stream

    line(g.run("end"), "Tuesday: 46% → 75% built (+4.4 pts, crunching, lowest energy 85).");
  });

  it("letting her go: un-staffing her mid-notice does not dodge the quarter, and the build loses ONE quarter", () => {
    const g = atWeek29();
    g.run("raise friends");
    expect(line(g.run("end"), "Wren Marsh walks next week.")).toContain("Tuesday loses a quarter if they go.");
    g.auto();
    line(g.run("staff off wren"), "Back on the day job: Wren Marsh.");
    // Rafael inherits the lead, and he is holding notice too: the board says so.
    line(g.run("build"), "lead Rafael (leaving in 1w)");
    const weekLines = g.run("end");
    expect(line(weekLines, "Wren Marsh cleared out their desk.")).toContain("Tuesday lost its lead and 25% of its progress.");
    // Rafael (the lead by then) walks out in the same tick: ERRATA 65 charges Tuesday one quarter, not two.
    expect(line(weekLines, "Rafael Reyes cleared out their desk.")).not.toContain("lost its lead");
    line(weekLines, "Tuesday: 65% → 60% built");
    const after = g.state.product!.active.find((b) => b.slug === "tuesday")!;
    expect(after.progress).toBeCloseTo(9.43, 2); // (10.31 + 2.27 worked) x 0.75; two quarters would leave 7.07
    expect(rosterOf(g.state).some((e) => e.name === "Wren Marsh" || e.name === "Rafael Reyes")).toBe(false);
  });
});
