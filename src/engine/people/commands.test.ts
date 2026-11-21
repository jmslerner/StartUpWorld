import { describe, expect, it } from "vitest";
import type { BoardMember, BoardPersonality, GameState } from "../../types/game";
import { makeBuild, makeState, makeTycoonState } from "../testHelpers";
import { preflight } from "../tycoon/preflight";
import { rosterInvariantHolds, rosterOf } from "../tycoon/roster";
import { errorOf, find, person, run, sansLogSeq, stateWith, texts, zeroTeam } from "./testKit";

// `team`, `fire <args>` and `retain` (TYCOON-SPEC §4.2, §4.4, §4.5).

const pending = { id: "x", title: "T", prompt: "P", choices: [{ id: "a", text: "A" }] };
const over = { ending: "bankruptcy" as const, week: 3, headline: "x" };
const director = (id: string, personality: BoardPersonality, role: BoardMember["role"] = "investor"): BoardMember =>
  ({ id, name: `Director ${id}`, role, personality, confidence: 50 });

describe("fire <name|id>", () => {
  const ivo = person("e1", { name: "Ivo Dunn", role: "ops", salary: 2400, engaged: true });
  const mei = person("e2", { name: "Mei Kowalski" });

  it("lets one person go: severance, payroll, morale -3, cohesion -2, 1 AP, warning", () => {
    const s = stateWith([ivo, mei]);
    const r = run(s, "fire ivo");
    expect(r.sound).toBe("warning");
    expect(texts(r)).toEqual([
      "You let Ivo Dunn go. [[beat]] You do it yourself, badly, in the only meeting room.",
      "Severance -$4,800. Payroll -$2,400/wk. Morale -3. Cohesion -2.",
    ]);
    expect(find(r.state, "e1")).toBeUndefined();
    expect(r.state.team.ops).toBe(0);
    expect(r.state.lastWeek.teamSize).toBe(1);
    expect(r.state.cash).toBe(s.cash - 4800);
    expect(r.state.ap).toBe(s.ap - 1);
    expect(r.state.culture).toEqual({ cohesion: 58, morale: 57 });
    expect(r.state.people?.departures).toBe(1);
    expect(rosterInvariantHolds(r.state)).toBe(true);
    expect(r.state.rng).toBe(s.rng);
  });

  it("with HR: HR runs it and the fallout halves", () => {
    const hr = person("e3", { name: "Uma Shah", role: "hr" });
    const r = run(stateWith([ivo, mei, hr]), "fire e1");
    expect(texts(r)).toEqual([
      "You let Ivo Dunn go. [[beat]] HR ran it. It took nine minutes and a folder.",
      "Severance -$4,800. Payroll -$2,400/wk. Morale -2. Cohesion -1.",
    ]);
  });

  it("a lead's build loses 25% of its progress, qSum and qPts, and its built status", () => {
    const lead = person("e1", { name: "Nadia Nkosi", craft: 4, engaged: true, buildId: "b1", joinedWeek: 1 });
    const other = person("e2", { name: "Hiro Ito", engaged: true, buildId: "b1", joinedWeek: 1 });
    const build = makeBuild({ progress: 12, qSum: 600, qPts: 12, readyWeek: 3 });
    const r = run(stateWith([lead, other], { builds: [build], overrides: { week: 4 } }), "fire nadia");
    expect(texts(r)[2]).toBe("Atlas lost its lead and 25% of its progress.");
    const b = r.state.product!.active[0];
    expect([b.progress, b.qSum, b.qPts, b.readyWeek]).toEqual([9, 450, 9, 0]);
  });

  it("refuses severance it cannot pay (cash never goes below zero); exactly enough is fine", () => {
    const s = stateWith([ivo], { overrides: { cash: 4799 } });
    const r = run(s, "fire ivo");
    expect(errorOf(r)).toBe("Severance is $4,800. You have $4,799. [[beat]] You cannot afford to let them go.");
    expect(sansLogSeq(r.state)).toEqual(sansLogSeq(s));
    expect(run(stateWith([ivo], { overrides: { cash: 4800 } }), "fire ivo").state.cash).toBe(0);
  });

  it("answers lookup errors, AP and game over; pending is refused before the module", () => {
    const s = stateWith([ivo, mei, person("e3", { name: "Mei Tanaka" })]);
    expect(errorOf(run(s, "fire zed"))).toBe('Nobody called "zed" works here. `team` lists who does.');
    expect(errorOf(run(s, "fire mei"))).toBe('"mei" matches 2 people: Mei Kowalski (e2), Mei Tanaka (e3). Use the id.');
    expect(errorOf(run({ ...s, ap: 0 }, "fire ivo"))).toBe("No AP left. End the week to refresh.");
    expect(errorOf(run({ ...s, gameOver: over }, "fire ivo"))).toBe("Game over. Click 'Play Again' or refresh to start a new run.");
    expect(errorOf(run({ ...s, pendingEvent: pending }, "fire ivo"))).toBe("Resolve the pending event first with `choose <n>`.");
  });

  it("works on a slice-less state by migrating it first", () => {
    const legacy = makeState({ team: zeroTeam({ engineering: 2 }) });
    const r = run(legacy, "fire e1");
    expect(r.sound).toBe("warning");
    expect(r.state.team.engineering).toBe(1);
    expect(rosterOf(r.state)).toHaveLength(1);
    expect(rosterInvariantHolds(r.state)).toBe(true);
  });

  it("preflight reports 1 AP and the severance", () => {
    expect(preflight(stateWith([ivo, mei]), "fire ivo")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 4800 });
    expect(preflight(stateWith([ivo, mei]), "fire nobody")).toMatchObject({ allowed: false, apCost: 0, cashCost: 0 });
  });
});

describe("fire <role> <count>", () => {
  it("refuses in the §4.5 order", () => {
    const s = stateWith([person("e1"), person("e2")]);
    const usage = "Usage: fire <name|id> | fire <role> <count>  (1 AP, two weeks' severance each)";
    expect(errorOf(run(s, "fire eng"))).toBe("How many? `fire <role> <count>`.");
    for (const n of ["0", "-1", "1.5", "x"]) expect(errorOf(run(s, `fire eng ${n}`)), n).toBe(usage);
    expect(errorOf(run(s, "fire sales 1"))).toBe("You have no sales people to let go.");
    expect(errorOf(run(s, "fire eng 3"))).toBe("You only have 2 people in engineering.");
    expect(errorOf(run({ ...s, ap: 0 }, "fire eng 1"))).toBe("No AP left. End the week to refresh.");
    expect(errorOf(run({ ...s, cash: 100 }, "fire eng 2"))).toBe("Severance is $14,000. You have $100. [[beat]] You cannot afford to let them go.");
  });

  it("goes in order: unlisted whole heads, then never-engaged newest first, then engaged weakest first", () => {
    const roster = [
      person("e1", { engaged: true, pace: 2, craft: 2, name: "Weak Engaged" }),
      person("e2", { engaged: true, pace: 5, craft: 5, name: "Star Engaged" }),
      person("e3", { engaged: false, name: "Old Jobad" }),
      person("e4", { engaged: false, name: "New Jobad" }),
    ];
    const capped = stateWith(roster, { overrides: { cash: 1_000_000 } });
    const order = (n: number) => {
      const r = run(capped, `fire eng ${n}`);
      return roster.filter((e) => !find(r.state, e.id)).map((e) => e.id);
    };
    expect(order(1)).toEqual(["e4"]);
    expect(order(2)).toEqual(["e3", "e4"]);
    expect(order(3)).toEqual(["e1", "e3", "e4"]);
  });

  it("fires unlisted heads first past the cap, and the line counts the ones you never met", () => {
    const s = makeTycoonState({ team: zeroTeam({ engineering: 122 }), cash: 1_000_000 });
    const r = run(s, "fire eng 3");
    expect(rosterOf(r.state)).toHaveLength(119);
    expect(r.state.team.engineering).toBe(119);
    expect(texts(r)[0]).toMatch(/^Layoff: 3 engineering roles 'impacted' \([A-Z][a-z]+ [A-Z][a-z]+ and 2 you never met\)\. The all-hands is 11 minutes long\.$/);
    expect(rosterInvariantHolds(r.state)).toBe(true);
    const unlistedOnly = run(makeTycoonState({ team: zeroTeam({ engineering: 125 }), cash: 1_000_000 }), "fire eng 3");
    expect(texts(unlistedOnly)[0]).toBe("Layoff: 3 engineering roles 'impacted'. The all-hands is 11 minutes long.");
    expect(rosterOf(unlistedOnly.state)).toHaveLength(120);
    expect(unlistedOnly.state.team.engineering).toBe(122);
  });

  it("never lays off the fractional remainder: design 1.5 with one record", () => {
    const s = stateWith([person("e1", { role: "design", salary: 2800 })], { extra: { design: 0.5 } });
    expect(errorOf(run(s, "fire ux 2"))).toBe("You only have 1 person in design.");
    const r = run(s, "fire ux 1");
    expect(r.state.team.design).toBe(0.5);
    expect(rosterOf(r.state)).toHaveLength(0);
    expect(r.state.cash).toBe(s.cash - 5600);
  });

  it("prints the layoff, the fallout and the lead line; HR halves the fallout", () => {
    const lead = person("e1", { name: "Signe Lund", role: "sales", salary: 3000, engaged: true, craft: 5, buildId: "b1", joinedWeek: 1 });
    const roster = [lead, person("e2", { name: "Oskar Pike", role: "sales", salary: 3000 })];
    const premium = makeBuild({ type: "premium", progress: 8 });
    const s = stateWith(roster, { builds: [premium], extra: { sales: 0.5 }, overrides: { week: 3 } });
    const r = run(s, "fire sales 2");
    expect(texts(r)).toEqual([
      "Layoff: 2 sales roles 'impacted' (Oskar Pike, Signe Lund). The all-hands is 11 minutes long.",
      "Severance -$12,000. Morale -5. Cohesion -4.",
      "Atlas lost its lead and 25% of its progress.",
    ]);
    expect(r.state.product!.active[0].progress).toBe(6);
    const withHr = stateWith([...roster, person("e3", { role: "hr", name: "Uma Shah" })], { builds: [premium], overrides: { week: 3 } });
    expect(texts(run(withHr, "fire sales 2"))[1]).toBe("Severance -$12,000. Morale -3. Cohesion -2.");
  });

  it("charges a build ONE quarter when the layoff takes its lead and the person who would inherit the lead (review repro)", () => {
    // The reviewers' case: a craft-heavy lead (pace 1, craft 5) goes first by pace + craft, the next in line goes too.
    // Before ERRATA 65 progress went 8 → 4.5 (0.75²) while the line still said 25%.
    const lead = person("e1", { name: "Ann Lead", pace: 1, craft: 5, engaged: true, buildId: "b1", joinedWeek: 1 });
    const two = person("e2", { name: "Bob Two", pace: 3, craft: 4, engaged: true, buildId: "b1", joinedWeek: 1 });
    const three = person("e3", { name: "Cy Three", pace: 5, craft: 3, engaged: true, buildId: "b1", joinedWeek: 1 });
    const atlas = makeBuild({ progress: 8, qSum: 480, qPts: 8 });
    const r = run(stateWith([lead, two, three], { builds: [atlas], overrides: { week: 4, cash: 100_000 } }), "fire eng 2");
    expect(texts(r)[0]).toBe("Layoff: 2 engineering roles 'impacted' (Ann Lead, Bob Two). The all-hands is 11 minutes long.");
    expect(texts(r)).toContain("Atlas lost its lead and 25% of its progress.");
    expect(r.state.product!.active[0]).toMatchObject({ progress: 6, qSum: 360, qPts: 6 });
    expect(rosterInvariantHolds(r.state)).toBe(true);
  });

  it("points a role-shaped word at the role tokens when the person lookup fails (review: `fire engineer 2`)", () => {
    const s = stateWith([person("e1", { name: "Ivo Dunn", role: "ops" }), person("e2", { name: "Mei Kowalski" })]);
    expect(errorOf(run(s, "fire engineer 2"))).toBe(
      'Nobody called "engineer 2" works here. `team` lists who does. (Roles are eng, ux, marketing, sales, ops, hr, legal (unlocks: data, product, executive): `fire eng 2` lays off two.)',
    );
    expect(errorOf(run(s, "team engineers"))).toMatch(/^Nobody called "engineers" works here\. .*\(Roles are eng, ux, .*`team eng`\.\)$/);
    expect(errorOf(run(s, "fire zed"))).toBe('Nobody called "zed" works here. `team` lists who does.');
  });

  it("moves the board only for 3+ people and only the named personalities, and prints the line only if they sit there", () => {
    const roster = [person("e1"), person("e2"), person("e3"), person("e4")];
    const board = { members: [director("d0", "activist", "founder"), director("d1", "activist"), director("d2", "cheerleader"), director("d3", "dealmaker"), director("d4", "old-guard")], lastMeetingWeek: 0 };
    const s = stateWith(roster, { overrides: { board, cash: 1_000_000 } });
    const three = run(s, "fire eng 3");
    expect(texts(three)).toContain("The activist on your board nods. The cheerleader does not.");
    expect(three.state.board.members.map((m) => m.confidence)).toEqual([50, 52, 48, 50, 52]);
    const two = run(s, "fire eng 2");
    expect(two.state.board).toEqual(s.board);
    expect(texts(two).some((t) => t.includes("board"))).toBe(false);
    const dull = stateWith(roster, { overrides: { board: { members: [director("d3", "dealmaker"), director("d5", "operator")], lastMeetingWeek: 0 }, cash: 1_000_000 } });
    const quiet = run(dull, "fire eng 3");
    expect(texts(quiet).some((t) => t.includes("board"))).toBe(false);
    expect(quiet.state.board).toEqual(dull.board);
    const oldGuard = stateWith(roster, { overrides: { board: { members: [director("d4", "old-guard")], lastMeetingWeek: 0 }, cash: 1_000_000 } });
    expect(texts(run(oldGuard, "fire eng 3"))).toContain("The old guard on your board nods. Approvingly, which is worse.");
  });

  it("a first token that is a role alias always means the role form", () => {
    const s = stateWith([person("e1", { name: "Eng Person" })]);
    expect(errorOf(run(s, "fire eng"))).toBe("How many? `fire <role> <count>`.");
  });
});

describe("retain", () => {
  const nadia = person("e3", {
    name: "Nadia Nkosi", pace: 1, craft: 4, salary: 3800, engaged: true, hiredWeek: 7, shipped: 2,
    buildId: "b1", joinedWeek: 20, offerDueWeek: 31, offerKind: "recruiter", leadOnNotice: "b1", ledWeek: 26,
  });
  const build = makeBuild({ name: "Phoenix", slug: "phoenix", scope: 17.4, progress: 8 });
  const s = stateWith([nadia], { builds: [build], overrides: { week: 29, cash: 50_000 } });

  it("worked example C: $7,600, pay $3,800 → $4,200, the offer and the lead stamp cleared, 12 quiet weeks", () => {
    const r = run(s, "retain nadia");
    expect(r.sound).toBe("success");
    expect(texts(r)).toEqual([
      "You find the money. Nadia Nkosi stays.",
      "Bonus -$7,600. Pay $3,800 → $4,200/wk.",
      'The recruiter is told "bad timing". They will try again in 12 weeks.',
    ]);
    expect(find(r.state, "e3")).toMatchObject({ salary: 4200, offerDueWeek: 0, offerKind: null, leadOnNotice: null, retainedWeek: 29, engaged: true, buildId: "b1" });
    expect(r.state.cash).toBe(50_000 - 7600);
    expect(r.state.ap).toBe(s.ap - 1);
  });

  it("works without an offer (a preemptive raise), engages the person and lifts energy to 60", () => {
    const tired = person("e1", { name: "Lotte Zhao", energy: 40, salary: 3500 });
    const r = run(stateWith([tired]), "retain lotte");
    expect(texts(r)).toEqual([
      "You find the money. Lotte Zhao stays.",
      "Bonus -$7,000. Pay $3,500 → $3,850/wk. Energy → 60 (they took the week they were owed).",
      "No recruiter gets through for 12 weeks.",
    ]);
    expect(find(r.state, "e1")).toMatchObject({ energy: 60, engaged: true, retainedWeek: 1 });
  });

  it("refuses: usage, lookup, AP, cash, game over", () => {
    expect(errorOf(run(s, "retain"))).toBe("Usage: retain <name|id>  (1 AP, a bonus of two weeks' pay and a permanent 10% raise; cancels an outside offer)");
    expect(errorOf(run(s, "retain zed"))).toBe('Nobody called "zed" works here. `team` lists who does.');
    expect(errorOf(run({ ...s, ap: 0 }, "retain nadia"))).toBe("No AP left. End the week to refresh.");
    const poor = { ...s, cash: 7599 };
    const r = run(poor, "retain e3");
    expect(errorOf(r)).toBe("A retention bonus for Nadia is $7,600. You have $7,599.");
    expect(sansLogSeq(r.state)).toEqual(sansLogSeq(poor));
    // ERRATA 73: an overdrawn bank reads "-$5,000", not "$-5,000".
    expect(errorOf(run({ ...s, cash: -5000 }, "retain e3"))).toBe("A retention bonus for Nadia is $7,600. You have -$5,000.");
    expect(errorOf(run({ ...s, gameOver: over }, "retain nadia"))).toBe("Game over. Click 'Play Again' or refresh to start a new run.");
  });

  it("preflight reports 1 AP and the bonus", () => {
    expect(preflight(s, "retain nadia")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 7600 });
  });
});

describe("team", () => {
  it("lists in the §4.2 order: offers, tired, on a build, engaged, the rest; ties by pace + craft, then serial", () => {
    const roster = [
      person("e1", { name: "Plain Jobad" }),
      person("e2", { name: "Engaged Star", engaged: true, pace: 5, craft: 4 }),
      person("e3", { name: "Builder Bee", engaged: true, buildId: "b1", joinedWeek: 1 }),
      person("e4", { name: "Tired Tom", engaged: true, energy: 50 }),
      person("e5", { name: "Leaving Lou", engaged: true, offerDueWeek: 3, offerKind: "recruiter" }),
      person("e6", { name: "Engaged Low", engaged: true, pace: 2, craft: 2 }),
      person("e7", { name: "Better Jobad", pace: 4, craft: 2 }),
    ];
    const s = stateWith(roster, { builds: [makeBuild()] });
    const r = run(s, "team");
    const lines = texts(r);
    expect(lines[0]).toBe("Team: 7 people · payroll $24,500/wk · 1 with an outside offer");
    expect(lines.slice(1, 8).map((t) => t.trim().split(/\s+/)[0])).toEqual(["e5", "e4", "e3", "e2", "e6", "e1", "e7"]);
    expect(lines[1]).toMatch(/Leaving Lou .* day job {2}OFFER: gone in 2w$/);
    expect(lines[3]).toMatch(/→ atlas \(lead\)$/);
    expect(lines[8]).toBe("`team <name>` opens a file. `recruit <role>` shows who is on the market.");
    expect(r.sound).toBeUndefined();
    expect(errorOf(r)).toBeNull();
  });

  it("caps at 12 rows; `team all` shows everyone; payroll includes real salaries", () => {
    const roster = Array.from({ length: 15 }, (_, i) => person(`e${i + 1}`, { name: `Worker ${i + 1}`, salary: i === 0 ? 4500 : 3500 }));
    const s = stateWith(roster);
    const lines = texts(run(s, "team"));
    expect(lines[0]).toBe("Team: 15 people · payroll $53,500/wk");
    expect(lines).toHaveLength(14);
    expect(lines[13]).toBe("  ... 3 more. `team <role>` filters; `team <name>` opens a file.");
    const all = texts(run(s, "team all"));
    expect(all).toHaveLength(17);
    expect(all[16]).toBe("`team <name>` opens a file. `recruit <role>` shows who is on the market.");
  });

  it("filters by role; an empty role says so; an empty company says it's just the founders", () => {
    const s = stateWith([person("e1"), person("e2", { role: "design", name: "Dee Zine" })]);
    const eng = texts(run(s, "team eng"));
    expect(eng[0]).toBe("Team (engineering): 1 person");
    expect(eng).toHaveLength(3);
    expect(texts(run(s, "team sales"))).toEqual(["Nobody in sales."]);
    expect(texts(run(stateWith([]), "team"))).toEqual(["Team: nobody. It's just the founders. `hire <role> 1` or `recruit <role>`."]);
    expect(texts(run(s, "team pm"))[0]).toBe("Nobody in product."); // locked roles are still roles
  });

  it("counts every unlisted head, fractions included, in the Plus line", () => {
    const s = stateWith([person("e1")], { extra: { design: 1.5 } }); // reconcile mints one designer; half a head stays unlisted
    const lines = texts(run(s, "team"));
    expect(lines[0]).toMatch(/^Team: 2\.5 people/);
    expect(lines).toContain("  Plus 0.5 you never learned the names of (standard issue).");
  });

  it("on a slice-less state lists no rows, only the Plus line, and adds nothing", () => {
    const legacy = makeState({ team: zeroTeam({ engineering: 2, design: 0.5 }) });
    const r = run(legacy, "team");
    expect(texts(r)).toEqual(["Team: 2.5 people · payroll $8,400/wk", "  Plus 2.5 you never learned the names of (standard issue)."]);
    expect(r.state.people).toBeUndefined();
    expect(r.state.product).toBeUndefined();
  });

  it("opens a person card", () => {
    const nadia = person("e3", {
      name: "Nadia Nkosi", pace: 1, craft: 4, salary: 3800, engaged: true, hiredWeek: 7, shipped: 2,
      buildId: "b1", joinedWeek: 20, offerDueWeek: 31, offerKind: "recruiter", leadOnNotice: "b1",
    });
    const helper = person("e4", { name: "Hiro Kealoha", engaged: true, buildId: "b1", joinedWeek: 20 });
    const build = makeBuild({ name: "Phoenix", slug: "phoenix" });
    const s = stateWith([nadia, helper], { builds: [build], overrides: { week: 29 } });
    expect(texts(run(s, "team nadia"))).toEqual([
      "Nadia Nkosi — engineering (e3), here since week 7",
      "  Pace 1/5 · Craft 4/5 · works like 0.90 standard engineering · credited on 2 releases",
      "  Energy 100/100 (fresh) · $3,800/wk (the going rate for these stats: $3,150)",
      "  No quirk. A professional. Suspicious.",
      "  On build: phoenix (lead).",
      "  Holding an outside offer: gone in 2 week(s) unless you `retain nadia`. Phoenix loses a quarter if they go.",
      "  `retain e3` (1 AP, $7,600 bonus, pay → $4,200/wk) · `fire e3` (1 AP, $7,600 severance) · `staff <build> e3`",
    ]);
    const card = texts(run(s, "team e4"));
    expect(card[3]).toBe("  No quirk. A professional. Suspicious.");
    expect(card[4]).toBe("  On build: phoenix.");
    expect(card).toHaveLength(6);
  });

  it("card variants: quirk, day job, burnout notice, ambiguous first name falls back to the id", () => {
    const a = person("e1", { name: "Mei Kowalski", quirk: "cowboy", energy: 25, engaged: true, offerDueWeek: 3, offerKind: "burnout" });
    const b = person("e2", { name: "Mei Tanaka" });
    const card = texts(run(stateWith([a, b]), "team e1"));
    expect(card[2]).toBe("  Energy 25/100 (burnt out) · $3,500/wk (the going rate for these stats: $3,500)");
    expect(card[3]).toBe("  Quirk: cowboy — builds 25% faster; their craft counts one lower.");
    expect(card[4]).toBe("  On the day job.");
    expect(card[5]).toBe("  Burnt out and interviewing: gone in 2 week(s) unless you `retain e1`.");
    expect(card[1]).toContain("works like 0.77 standard engineering · credited on 0 releases");
  });

  it("works during a pending event and after game over; lookup errors are errors", () => {
    const s = stateWith([person("e1")]);
    expect(errorOf(run({ ...s, pendingEvent: pending }, "team"))).toBeNull();
    expect(errorOf(run({ ...s, gameOver: over }, "team e1"))).toBeNull();
    expect(errorOf(run(s, "team zed"))).toBe('Nobody called "zed" works here. `team` lists who does.');
  });
});

describe("state hygiene", () => {
  it("every people command result round-trips through JSON", () => {
    const s0: GameState = makeTycoonState({ team: zeroTeam({ engineering: 4, ops: 2 }), cash: 500_000, ap: 9 });
    let s = s0;
    for (const input of ["team", "recruit eng", "recruit eng 2", "retain e1", "fire ops 1", "fire e2", "team all", "team e1"]) {
      s = run(s, input).state;
      expect(JSON.parse(JSON.stringify(s)), input).toEqual(s);
      expect(rosterInvariantHolds(s), input).toBe(true);
      expect(s.rng, input).toBe(s0.rng);
    }
  });
});
