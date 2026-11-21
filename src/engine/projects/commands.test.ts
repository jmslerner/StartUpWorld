import { describe, expect, it } from "vitest";
import type { Build, Employee, GameState } from "../../types/game";
import { shipFeature } from "../actions";
import { makeState } from "../testHelpers";
import { preflight } from "../tycoon/preflight";
import { buildsOf, productRng, rosterOf, setProduct, staffOf } from "../tycoon/roster";
import { nextIntInclusive } from "../rng";
import { CODENAMES, RESERVED_NAMES, SIZES } from "./constants";
import { buildNameProblem, drawCodename, levenshtein, slugify } from "./commands";
import { build, isRefusal, lines, person, refusal, run, shop, staffed, texts } from "./testkit";
import { etaWeeks, forecastOf } from "./work";

const PENDING = "Resolve the pending event first with `choose <n>`.";
const GAME_OVER = "Game over. Click 'Play Again' or refresh to start a new run.";
const NO_AP = "No AP left. End the week to refresh.";
const pendingEvent = { eventId: "x", title: "X", prompt: "X", choices: [{ id: "a", text: "A" }] } as unknown as GameState["pendingEvent"];
const gameOver = { kind: "bankrupt", week: 9, reason: "x" } as unknown as GameState["gameOver"];

/** What a refusal must not touch. */
const core = (s: GameState) => ({ ap: s.ap, cash: s.cash, culture: s.culture, team: s.team, rng: s.rng, people: s.people, product: s.product });

const three = (): Employee[] => [person(1), person(2), person(3)];
const garage = (overrides: Parameters<typeof shop>[0] = {}) => shop({ roster: three(), ...overrides });
const office = (overrides: Parameters<typeof shop>[0] = {}) =>
  shop({ roster: three(), companyPhase: "office", valuation: 40_000_000, users: 3000, mrr: 30_000, ...overrides });
const only = (s: GameState): Build => buildsOf(s)[0];

describe("build <type> [size] [name]: refusals, in order (§4.6)", () => {
  it("game over and a pending event come first", () => {
    expect(refusal(garage({ gameOver }), "build feature")).toBe(GAME_OVER);
    expect(refusal(garage({ pendingEvent }), "build feature")).toBe(PENDING);
  });

  it("type → type unlocked → size unlocked", () => {
    expect(refusal(garage(), "build banana")).toBe("Usage: build <feature|growth|premium|plumbing|moonshot> [s|m|l|xl] [name]. `build` shows the board.");
    expect(refusal(garage(), "build start")).toBe("Usage: build <feature|growth|premium|plumbing|moonshot> [s|m|l|xl] [name]. `build` shows the board.");
    expect(refusal(garage(), "build premium")).toBe("Premium tier builds need the coworking phase. You're in garage.");
    expect(refusal(garage(), "build moonshot m x")).toBe("Moonshot builds need the office phase. You're in garage.");
    expect(refusal(garage(), "build feature l")).toBe("L builds need the coworking phase. You're in garage.");
    expect(refusal(garage(), "build feature xl Big")).toBe("XL builds need the office phase. You're in garage.");
  });

  it("slots: one in the garage, two in the office", () => {
    expect(refusal(garage({ builds: [build()] }), "build growth s"))
      .toBe("The only build slot is taken (garage phase). Ship something, `build cancel <name>`, or grow into a bigger office.");
    const two = office({ builds: [build(), build({ id: "b2", slug: "halo", name: "Halo" })] });
    expect(refusal(two, "build growth s"))
      .toBe("All 2 build slots are taken (office phase). Ship something, `build cancel <name>`, or grow into a bigger office.");
  });

  it("AP before the name, the name before cash", () => {
    expect(refusal(garage({ ap: 0 }), "build feature m on")).toBe(NO_AP);
    expect(refusal(garage({ cash: 100 }), "build feature m on")).toContain("would be confused");
    expect(refusal(garage({ cash: 100 }), "build feature s Atlas")).toBe("Not enough cash. Kicking off a Feature S costs $500.");
    expect(refusal(garage({ cash: 1999 }), "build growth m Loop Two")).toBe("Not enough cash. Kicking off a Growth loop M costs $2,000.");
  });

  it("a refusal spends nothing and changes nothing but the log counter", () => {
    for (const input of ["build banana", "build premium", "build feature l", "build feature m on", "build feature m e12"]) {
      const s = garage();
      const r = run(s, input);
      expect(isRefusal(r), input).toBe(true);
      expect(core(r.state), input).toEqual(core(s));
    }
  });
});

describe("build names (§4.6.1)", () => {
  it("slugify: lowercase, runs of anything else become one dash, trimmed, cut to 24 without a trailing dash", () => {
    expect(slugify("Referral Loop!")).toBe("referral-loop");
    expect(slugify("  --Hello__World--  ")).toBe("hello-world");
    expect(slugify("Plan B")).toBe("plan-b");
    expect(slugify("abcdefghijklmnopqrstuvw xyz")).toBe("abcdefghijklmnopqrstuvw");
    expect(slugify("!!!")).toBe("");
  });

  it("refuses every reserved word, type/size token, role alias and id pattern", () => {
    const s = garage();
    const confused = (n: string) => `"${n}" would be confused with a command word, a role or an id. Pick another name.`;
    for (const word of [...RESERVED_NAMES, "feature", "feat", "loop", "tier", "infra", "moon", "s", "small", "xl", "huge", "eng", "ux", "pm", "vp", "e12", "b3", "c7", "p9", "#3", "12"]) {
      expect(buildNameProblem(s, word), word).toBe(confused(word));
    }
    expect(refusal(s, "build feature m e12")).toBe(confused("e12"));
    expect(refusal(s, "build feature m pm")).toBe(confused("pm"));
    expect(refusal(s, "build feature m xl")).toBe(confused("xl"));
  });

  it("refuses an empty slug, a name over 24 characters and a duplicate active slug", () => {
    const s = garage();
    expect(refusal(s, "build feature m !!!")).toBe("A build needs a name with at least one letter or digit in it.");
    expect(refusal(s, `build feature m ${"x".repeat(25)}`)).toBe("Build names are at most 24 characters. Marketing will rename it anyway.");
    expect(refusal(office({ builds: [build()] }), "build feature s ATLAS")).toBe("There is already a build called atlas.");
    expect(buildNameProblem(s, "x".repeat(24))).toBeNull();
  });

  it("keeps the typed display name and the slug", () => {
    const r = run(garage(), "build feature s Referral Loop");
    expect(only(r.state)).toMatchObject({ name: "Referral Loop", slug: "referral-loop" });
  });
});

describe("build <type>: kickoff", () => {
  it("charges 1 AP and the kickoff, auto-staffs, prints the estimate, the due week and the forecast", () => {
    const s = garage();
    const r = run(s, "build feature m Phoenix");
    const b = only(r.state);
    expect(r.sound).toBe("click");
    expect(r.state.ap).toBe(s.ap - 1);
    expect(r.state.cash).toBe(s.cash - 2000);
    expect(b).toMatchObject({ id: "b1", name: "Phoenix", slug: "phoenix", type: "feature", size: "m", units: 2.5, baseScope: 12, scope: 12, startedWeek: 1 });
    expect(staffOf(r.state, "b1").map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(staffOf(r.state, "b1").every((e) => e.engaged && e.joinedWeek === 1)).toBe(true);
    const eta = etaWeeks(r.state, b) ?? 0;
    const due = 1 + Math.min(SIZES.m.windowMax, Math.max(SIZES.m.windowMin, Math.ceil(1.25 * eta) + 1));
    expect(b.dueWeek).toBe(due);
    const f = forecastOf(r.state, b);
    expect(texts(r)).toEqual([
      "Kickoff: Phoenix — Feature M (12 pts, a sprint or three). Cash -$2,000.",
      "Staffed: Lotte Zhao, Mei Kowalski, Hiro Fontaine. (People on a build give the day job 70%.)",
      `Estimate: ~${eta} weeks. Due week ${due} (your estimate plus slack; after that, reception -3 a week).`,
      `Forecast if it ships finished and on time: ~${f.finished} (${f.tierFinished.toUpperCase()}) ±${f.spread}.`,
    ]);
    expect(r.state.rng).toBe(s.rng);
  });

  it("`build start` and `build new` are the same command; `project` and `projects` are `build`", () => {
    for (const input of ["build start feature s A1b", "build new feature s Abc", "project feature s Abc", "projects feature s Abc"]) {
      expect(buildsOf(run(garage(), input).state), input).toHaveLength(1);
    }
  });

  it("default size: the largest unlocked size the free people with fit >= 0.5 cover, at most half the cash; else S", () => {
    const sizeOf = (s: GameState, input = "build feature Thing") => only(run(s, input).state).size;
    expect(sizeOf(garage())).toBe("m");
    expect(sizeOf(shop({ roster: [person(1), person(2)] }))).toBe("s");
    expect(sizeOf(garage({ cash: 3999 }))).toBe("s");
    const seven = Array.from({ length: 7 }, (_, i) => person(i + 1));
    expect(sizeOf(office({ roster: seven }))).toBe("xl");
    expect(sizeOf(office({ roster: seven, cash: 50_000 }))).toBe("l");
    // fit >= 0.5 counts (data on a feature is 0.5); someone holding notice does not
    expect(sizeOf(shop({ roster: [person(1), person(2), person(3, { role: "data" })] }))).toBe("m");
    expect(sizeOf(shop({ roster: [person(1), person(2), person(3, { offerDueWeek: 3, offerKind: "recruiter" })] }))).toBe("s");
    expect(lines(garage(), "build feature Thing")).toContain("(Size M picked for the people you have free. `build feature <s|m|l|xl> <name>` chooses.)");
    expect(lines(garage(), "build feature m Thing").some((t) => t.startsWith("(Size"))).toBe(false);
  });

  it("auto-staff ranks by pace x fit x energy, then craft, then serial; skips HR and anyone holding notice", () => {
    const roster = [
      person(1),
      person(2, { pace: 5, craft: 1 }),
      person(3, { role: "design", pace: 4, craft: 2, energy: 30 }),
      person(4, { role: "data", pace: 5, craft: 3 }),
      person(5, { craft: 4 }),
      person(6, { role: "hr", pace: 5, craft: 5 }),
    ];
    const picked = (rs: Employee[]) => staffOf(run(shop({ roster: rs }), "build feature m Rank").state, "b1").map((e) => e.id);
    expect(picked(roster)).toEqual(["e1", "e2", "e5"]); // roster order; e3 (0.96) and e4 (0.7) rank below
    const leaving = roster.map((e) => (e.id === "e2" ? { ...e, offerDueWeek: 4, offerKind: "recruiter" as const } : e));
    expect(picked(leaving)).toEqual(["e1", "e3", "e5"]);
  });

  it("nobody suitable: a slide, with the estimate from the founders' hands", () => {
    const r = run(shop({ roster: [person(1, { role: "hr" })] }), "build feature s Slide");
    expect(texts(r)[1]).toBe("Staffed: nobody. It is currently a slide. `staff slide auto` once someone suitable is free.");
    expect(staffOf(r.state, "b1")).toEqual([]);
  });

  it("a codename when no name is typed: drawn from product.rng, which is written back; state.rng untouched", () => {
    const s = garage();
    const pick = nextIntInclusive(productRng(s), 0, CODENAMES.length - 1);
    const r = run(s, "build feature m");
    expect(only(r.state).name).toBe(CODENAMES[pick.value]);
    expect(r.state.product?.rng).toBe(pick.rng);
    expect(r.state.rng).toBe(s.rng);
    const named = run(s, "build feature m Mine");
    expect(named.state.product?.rng).toBe(0); // a typed name draws nothing
  });

  it("codenames step past slugs an active build uses, and fall back to `Build <nextId>`", () => {
    const s = office({ builds: [build()] });
    const pick = nextIntInclusive(productRng(s), 0, CODENAMES.length - 1);
    const taken = slugify(CODENAMES[pick.value]);
    const busy = setProduct(s, { active: [build({ slug: taken, name: CODENAMES[pick.value] })] });
    expect(buildsOf(run(busy, "build growth s").state)[1].name).toBe(CODENAMES[(pick.value + 1) % CODENAMES.length]);
    const all = setProduct(s, { active: CODENAMES.map((n, i) => build({ id: `b${i + 1}`, name: n, slug: slugify(n) })) });
    expect(drawCodename(all, 7, 13).name).toBe("Build 13");
  });

  it("scope inflation: the kickoff says how much and why", () => {
    const s = setProduct(garage(), { shippedByType: { feature: 1, growth: 0, premium: 0, plumbing: 0, moonshot: 0 } });
    const r = run(s, "build feature m Again");
    expect(only(r.state).scope).toBe(13.8);
    expect(texts(r)).toContain("(Scope +15%: you have shipped 1 of these. The easy wins are gone.)");
    const many = setProduct(garage(), { shippedByType: { feature: 9, growth: 0, premium: 0, plumbing: 0, moonshot: 0 } });
    expect(texts(run(many, "build feature m Again"))).toContain("(Scope +90%: you have shipped 9 of these. The easy wins are gone.)");
  });

  it("I3: a new build never reuses a shipped id", () => {
    const s = setProduct(garage(), { nextId: 5, shippedCount: 1 });
    expect(only(run(s, "build feature s Fresh").state).id).toBe("b5");
    expect(run(s, "build feature s Fresh").state.product?.nextId).toBe(6);
  });

  it("a slice-less state gets its slices and roster at the command boundary, before anyone is picked", () => {
    const s = makeState({ team: { ...makeState().team, engineering: 2 } });
    const r = run(s, "build feature s First");
    expect(rosterOf(r.state)).toHaveLength(2);
    expect(staffOf(r.state, "b1")).toHaveLength(2);
    const refused = run(s, "build banana");
    expect(refused.state.people).toBeUndefined();
  });

  it("`build ship …` points at `ship <build>`", () => {
    expect(refusal(garage(), "build ship atlas")).toBe("Releases go through `ship <build>`.");
  });
});

describe("the board", () => {
  it("reads during a pending event and after game over, adds nothing, and renders a slice-less state as empty", () => {
    for (const s of [garage({ pendingEvent }), garage({ gameOver }), makeState()]) {
      const r = run(s, "build");
      expect(r.sound).toBeUndefined();
      expect(r.logs.every((l) => l.kind !== "error")).toBe(true);
      expect(texts(r)[0]).toBe("PRODUCT — Cruft 0/100 (tidy) · Moat 0/100 (a puddle)");
      expect(r.state.product).toEqual(s.product);
    }
    expect(run(makeState(), "build list").state.product).toBeUndefined();
  });

  it("lists builds with their forecast line, the last 3 releases, and the catalogue only while a slot is free", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 5.5, qPts: 5.5, qSum: 5.5 * 69, surprises: 1, crunch: true, dueWeek: 34 });
    const s = setProduct(shop({ roster: staffed(three(), "b1"), builds: [b], week: 29 }), {
      cruft: 8.7, moat: 9.8, shippedCount: 4,
      shipped: [{ id: "b4", name: "Plan B", type: "feature", size: "m", week: 26, reception: 76, tier: "solid", quality: 70, leadName: null }],
    });
    const out = lines(s, "build");
    expect(out[0]).toBe("PRODUCT — Cruft 8.7/100 (tidy) · Moat 9.8/100 (a puddle)");
    expect(out[1]).toBe("Building (1/1 slot):");
    expect(out[2]).toMatch(/^ {2}Phoenix \[phoenix\] · Feature M · 45% built \(5\.5\/12 pts, 1 surprise\) · quality \d+ · CRUNCH$/);
    expect(out[3]).toMatch(/^ {4}team 3\/3 \(Lotte, Mei, Hiro\) · lead Lotte · ETA ~\d+w · due week 34 · not shippable until 60% · finished ≈ \d+$/);
    expect(out[4]).toBe("Shipped: 4 releases.");
    expect(out[5]).toBe("  wk 26: Plan B (Feature M) — 76/100 SOLID");
    expect(out.some((t) => t.startsWith("Start one"))).toBe(false);
    const idle = lines(garage(), "build");
    expect(idle).toContain("Nothing is being built (0/1 slot).");
    expect(idle).toContain("  types: feature, growth, plumbing  (later — premium: coworking phase, moonshot: office phase)");
    expect(idle).toContain("  sizes: S 5 pts $500 2 seats · M 12 pts $2,000 3 seats  (later — L: coworking phase, XL: office phase)");
  });
});

describe("the board: names you can type (review: duplicate first names)", () => {
  it("adds the id when a first name is shared, and flags a lead who is leaving", () => {
    const arjunA = person(1, { name: "Arjun Conti", craft: 4 });
    const arjunB = person(2, { name: "Arjun Demir" });
    const petra = person(3, { name: "Petra Sato" });
    const b = build({ dueWeek: 20 });
    const s = shop({ roster: [...staffed([arjunA, petra], "b1"), arjunB], builds: [b], week: 10 });
    const out = lines(s, "build");
    expect(out[3]).toMatch(/^ {4}team 2\/3 \(Arjun \(e1\), Petra\) · lead Arjun \(e1\) · /);
    const leaving = shop({ roster: [...staffed([{ ...arjunA, offerDueWeek: 12, offerKind: "recruiter", leadOnNotice: "b1" }, petra], "b1"), arjunB], builds: [b], week: 10 });
    expect(lines(leaving, "build")[3]).toMatch(/· lead Arjun \(e1\) \(leaving in 2w\) · /);
  });
});

describe("build crunch / build cancel", () => {
  it("crunch on, again, off, off again; built builds refuse", () => {
    const s = garage({ builds: [build()], roster: staffed(three(), "b1") });
    const on = run(s, "build crunch");
    expect(on.sound).toBe("warning");
    expect(only(on.state).crunch).toBe(true);
    expect(texts(on)).toEqual([
      "Crunch on: Atlas. [[beat]] You call it 'a push'. The team calls it something else.",
      "Per week: output x1.5, that week's quality x0.9, energy -15 for everyone on it, cruft +1. Under 30 energy people start interviewing.",
    ]);
    expect(refusal(on.state, "build crunch atlas")).toBe("Atlas is already crunching. `build crunch atlas off` to stop.");
    const off = run(on.state, "build crunch atlas off");
    expect(off.sound).toBe("click");
    expect(texts(off)).toEqual(["Crunch off: Atlas. People remember what evenings are."]);
    expect(refusal(off.state, "build crunch off")).toBe("Atlas isn't crunching.");
    const built = garage({ builds: [build({ progress: 12 })] });
    expect(refusal(built, "build crunch atlas on")).toBe("Atlas is already built. Crunching the polish is how 'pixel-perfect' becomes a resignation letter.");
    expect(on.state.ap).toBe(s.ap);
  });

  it("refuses to crunch a build nobody is staffed on (review: founders' hands crunched for free)", () => {
    const empty = garage({ builds: [build()] });
    expect(refusal(empty, "build crunch atlas")).toBe("Nobody is on Atlas. Crunching an empty crew is just called 'the weekend'. `staff atlas auto` first.");
    const hrOnly = shop({ roster: staffed([person(1, { role: "hr" })], "b1"), builds: [build()] });
    expect(refusal(hrOnly, "build crunch atlas")).toMatch(/^Nobody is on Atlas\./);
  });

  it("lookup errors: nothing active, several active without a name, an unknown name; game over", () => {
    expect(refusal(garage(), "build crunch")).toBe("Nothing is being built. `build <type> [size] [name]` starts something.");
    const two = office({ builds: [build(), build({ id: "b2", name: "Halo", slug: "halo" })] });
    expect(refusal(two, "build crunch")).toBe("Which build? `build` lists them.");
    expect(refusal(two, "build cancel zzz")).toBe("No build called \"zzz\". `build` shows the board.");
    const twoStaffed = office({ builds: [build(), build({ id: "b2", name: "Halo", slug: "halo" })], roster: staffed(three(), "b2") });
    expect(buildsOf(run(twoStaffed, "build crunch ha").state)[1].crunch).toBe(true); // unique 2+ character prefix
    expect(refusal(garage({ builds: [build()], gameOver }), "build crunch")).toBe(GAME_OVER);
    expect(refusal(garage({ builds: [build()], pendingEvent }), "build cancel")).toBe(PENDING);
  });

  it("cancel: staff back on the day job, progress gone, morale by size, kickoff not refunded", () => {
    for (const [size, morale] of [["s", 1], ["m", 2], ["l", 3], ["xl", 4]] as const) {
      const s = garage({ builds: [build({ size, progress: 8 })], roster: staffed(three(), "b1") });
      const r = run(s, "build cancel atlas");
      expect(r.sound).toBe("warning");
      expect(r.state.culture.morale).toBe(s.culture.morale - morale);
      expect(r.state.cash).toBe(s.cash);
      expect(buildsOf(r.state)).toEqual([]);
      expect(rosterOf(r.state).every((e) => e.buildId === null && e.joinedWeek === 0)).toBe(true);
      expect(texts(r)).toEqual(["Atlas is cancelled. [[beat]] The Figma file lives on, like a ghost ship.", `Morale -${morale}. 8 points of work become 'learnings'.`]);
    }
  });
});

describe("staff (§4.7)", () => {
  const withBuild = (roster: Employee[], b: Build = build()) => garage({ roster, builds: [b] });

  it("says what to do when no free person of a role is left, and points role-shaped words at the role tokens (review)", () => {
    const busy = garage({ roster: staffed(three(), "b2"), builds: [build(), build({ id: "b2", name: "Halo", slug: "halo" })] });
    expect(refusal(busy, "staff atlas eng 2")).toBe("No free engineering people for Atlas (on another build or holding notice). `staff off <name>` somewhere, or hire first.");
    expect(refusal(withBuild(three()), "staff atlas engineer")).toBe(
      'Nobody called "engineer" works here. `team` lists who does. (Roles are eng, ux, marketing, sales, ops, hr, legal (unlocks: data, product, executive): `staff atlas eng 2`.)',
    );
  });

  it("usage", () => {
    const usage = "Usage: staff <build> auto | staff <build> <name|id|role [n]>... | staff off <name|id|build>...";
    expect(refusal(withBuild(three()), "staff")).toBe(usage);
    expect(refusal(withBuild(three()), "staff off")).toBe(usage);
    expect(refusal(withBuild(three()), "staff atlas")).toBe(usage);
  });

  it("refusals: lookup, seats, fit, numbers, people", () => {
    const s = withBuild([person(1), person(2), person(3, { role: "hr" }), person(4, { role: "design" })]);
    expect(refusal(s, "staff zzz auto")).toBe("No build called \"zzz\". `build` shows the board.");
    expect(refusal(s, "staff atlas hr")).toBe("hr has nothing to do on a Feature build.");
    expect(refusal(s, "staff atlas eng 3")).toBe("Only 2 free engineering people.");
    expect(refusal(s, "staff atlas ux 2")).toBe("Only 1 free design person.");
    expect(refusal(s, "staff atlas nobody")).toBe("Nobody called \"nobody\" works here. `team` lists who does.");
    expect(refusal(s, "staff atlas e3")).toBe("Hiro Fontaine (hr) has nothing to do on a Feature build.");
    const full = withBuild([...staffed([person(1), person(2)], "b1"), person(3)], build({ size: "s" }));
    expect(refusal(full, "staff atlas auto")).toBe("Atlas has no free seat (2 for a S).");
    expect(refusal(full, "staff atlas hiro")).toBe("Atlas has 2 seats (it is a S) and they are taken. `staff off <who>` first.");
    expect(refusal(full, "staff atlas lotte")).toBe("Lotte Zhao is already on Atlas.");
    const nobody = withBuild([person(1, { role: "hr" })]);
    expect(refusal(nobody, "staff atlas auto")).toBe("Nobody suitable is free for Atlas. Hire, recruit, or pull someone off another build.");
    expect(refusal(withBuild(three(), build()), "staff off lotte")).toBe("Lotte Zhao is already on the day job.");
    expect(refusal(withBuild(three(), build()), "staff off atlas")).toBe("Nobody to pull off.");
    expect(refusal(withBuild(three(), build()), "staff off eng")).toBe("Nobody called \"eng\" works here. `team` lists who does.");
  });

  it("the first failing token refuses the whole command", () => {
    const s = withBuild(three());
    const r = run(s, "staff atlas lotte nobody");
    expect(isRefusal(r)).toBe(true);
    expect(core(r.state)).toEqual(core(s));
  });

  it("puts people on (ramp week, engaged), by name, id, role and auto", () => {
    const s = withBuild([person(1), person(2, { pace: 5 }), person(3), person(4, { role: "design" })]);
    const r = run(s, "staff atlas lotte");
    expect(r.sound).toBe("click");
    expect(texts(r)[0]).toMatch(/^Atlas \+Lotte Zhao\. First week is ramp-up \(half speed\)\. Team 1\/3 · ETA ~\d+w\.$/);
    expect(rosterOf(r.state)[0]).toMatchObject({ buildId: "b1", joinedWeek: 1, engaged: true });
    expect(staffOf(run(s, "staff atlas e4 eng 2").state, "b1").map((e) => e.id)).toEqual(["e1", "e2", "e4"]);
    expect(staffOf(run(s, "staff atlas auto").state, "b1").map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(staffOf(run(s, "staff atlas #3").state, "b1").map((e) => e.id)).toEqual(["e3"]);
  });

  it("role picks follow the auto-staff ranking and skip people holding notice; a named leaver can still be put on", () => {
    const s = withBuild([person(1), person(2, { pace: 5, offerDueWeek: 3, offerKind: "recruiter" }), person(3, { pace: 4 })]);
    expect(staffOf(run(s, "staff atlas eng 1").state, "b1").map((e) => e.id)).toEqual(["e3"]);
    expect(staffOf(run(s, "staff atlas auto").state, "b1").map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(staffOf(run(s, "staff atlas e2").state, "b1").map((e) => e.id)).toEqual(["e2"]);
  });

  it("moving someone from another build re-ramps them", () => {
    const a = build({ id: "b1", slug: "alpha", name: "Alpha" });
    const z = build({ id: "b2", slug: "zulu", name: "Zulu" });
    const s = office({ roster: [...staffed([person(1)], "b1", 2), person(2)], builds: [a, z], week: 5 });
    const r = run(s, "staff zulu lotte");
    expect(rosterOf(r.state)[0]).toMatchObject({ buildId: "b2", joinedWeek: 5 });
  });

  it("staff off: by person and by build; an exact build slug wins over a person with that prefix", () => {
    const nadia = build({ slug: "nadia", name: "Nadia" });
    const s = withBuild([...staffed([person(1), person(2)], "b1"), person(5)], nadia);
    const byBuild = run(s, "staff off nadia");
    expect(texts(byBuild)).toEqual(["Back on the day job: Lotte Zhao, Mei Kowalski."]);
    expect(rosterOf(byBuild.state).every((e) => e.buildId === null)).toBe(true);
    const byPerson = run(s, "staff off mei");
    expect(staffOf(byPerson.state, "b1").map((e) => e.id)).toEqual(["e1"]);
    expect(byPerson.sound).toBe("click");
  });

  it("refuses during a pending event (before the module) and after game over", () => {
    expect(refusal(garage({ builds: [build()], pendingEvent }), "staff atlas auto")).toBe(PENDING);
    expect(refusal(garage({ builds: [build()], gameOver }), "staff atlas auto")).toBe(GAME_OVER);
  });
});

describe("ship routing (§4.8)", () => {
  /** A state whose next patch lands (or fails), found by trying run seeds: the patch's dice are today's state.rng. */
  const patchState = (want: "success" | "fail", overrides: Parameters<typeof shop>[0] = {}): GameState => {
    for (let r = 1; r < 5000; r++) {
      const s = garage({ rng: ((r * 2654435761) >>> 0) || 1, ...overrides });
      if (shipFeature(s, "fix signup").sound === want) return s;
    }
    throw new Error(`no ${want} seed`);
  };

  it("with no active build it is exactly today's shipFeature", () => {
    for (const s of [garage(), makeState(), garage({ ap: 0 }), patchState("fail")]) {
      for (const name of ["fix signup", "", "onboarding"]) {
        const direct = shipFeature(s, name);
        const routed = run(s, `ship ${name}`.trim());
        expect(texts(routed)).toEqual(direct.logs.map((l) => l.text));
        expect(routed.state).toEqual(direct.state);
        expect(routed.sound).toBe(direct.sound);
      }
    }
  });

  it("the exact slug or the id releases it; state.rng is untouched; AP spent and the free ship marked", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 12, qPts: 12, qSum: 12 * 65 });
    const s = garage({ builds: [b], founder: { name: "F", archetype: "visionary" } });
    for (const input of ["ship phoenix", "ship Phoenix", "ship b1"]) {
      const r = run(s, input);
      expect(r.state.product?.shippedCount, input).toBe(1);
      expect(r.state.rng, input).toBe(s.rng);
      expect(r.state.ap, input).toBe(s.ap - 1);
      expect(texts(r)[0], input).toBe("Shipping Phoenix — Feature M, 100% built, quality 65.");
    }
  });

  it("a hacker's free first ship pays for a release (and is then used)", () => {
    const b = build({ progress: 12, qPts: 12, qSum: 12 * 65 });
    const s = garage({ builds: [b], ap: 0 });
    const r = run(s, "ship atlas");
    expect(r.state.product?.shippedCount).toBe(1);
    expect(texts(r)[1]).toBe("Hacker perk: first ship of the week is free.");
    expect(r.state.freeActionUsed["hacker-free-ship"]).toBe(true);
    expect(r.state.ap).toBe(0);
  });

  it("refuses under 60% and without AP, spending nothing", () => {
    const b = build({ name: "Phoenix", slug: "phoenix", progress: 5.6, qPts: 5.6, qSum: 300 });
    const s = garage({ builds: [b] });
    expect(refusal(s, "ship phoenix")).toBe("Phoenix is 46% built. Shipping it now would be a crime. (Needs 60%. Or `build cancel phoenix`.)");
    const ready = garage({ builds: [{ ...b, progress: 12, qPts: 12 }], ap: 0, freeActionUsed: { "hacker-free-ship": true } });
    expect(refusal(ready, "ship phoenix")).toBe(NO_AP);
    expect(refusal(garage({ builds: [{ ...b, progress: 12, qPts: 12 }], gameOver }), "ship phoenix")).toBe(GAME_OVER);
  });

  it("near-misses are refused and spend nothing: distance 1 on a short slug, 2 on a longer one, a 3+ character prefix", () => {
    const halo = garage({ builds: [build({ name: "Halo", slug: "halo" })] });
    expect(refusal(halo, "ship hal0")).toBe("Did you mean `ship halo`? (That releases Halo. Any other name ships a patch.)");
    expect(isRefusal(run(halo, "ship hxlx"))).toBe(false);
    const phoenix = garage({ builds: [build({ name: "Phoenix", slug: "phoenix" })] });
    for (const near of ["phenix", "fhoenyx", "pho", "phoe"]) {
      const r = run(phoenix, `ship ${near}`);
      expect(texts(r), near).toEqual(["Did you mean `ship phoenix`? (That releases Phoenix. Any other name ships a patch.)"]);
      expect(core(r.state), near).toEqual(core(phoenix));
    }
    for (const far of ["fhoenyy", "ph", "feature-w5-a3", "onboarding"]) {
      expect(isRefusal(run(phoenix, `ship ${far}`)), far).toBe(false);
    }
    expect(levenshtein("phoenix", "fhoenyx")).toBe(2);
  });

  it("an empty name with a shippable build asks which; several are listed in board order", () => {
    const one = garage({ builds: [build({ name: "Phoenix", slug: "phoenix", progress: 8.8 })] });
    expect(refusal(one, "ship")).toBe("Ship what? `ship phoenix` releases Phoenix (73% built). Any other name ships a patch.");
    const two = office({ builds: [build({ name: "Phoenix", slug: "phoenix", progress: 8.8 }), build({ id: "b2", name: "Atlas", slug: "atlas", progress: 12 })] });
    expect(refusal(two, "ship")).toBe("Ship what? `ship phoenix` (73% built) or `ship atlas` (100% built) releases one. Any other name ships a patch.");
    const notYet = garage({ builds: [build({ progress: 1 })] });
    expect(refusal(notYet, "ship")).toBe("Ship what? Provide a feature name.");
  });

  it("any other name is today's patch; the first landed patch each week pays down 1 cruft", () => {
    const base = patchState("success", { builds: [build()] });
    const dirty = setProduct(base, { cruft: 8.7 });
    const r = run(dirty, "ship fix signup");
    const direct = shipFeature(dirty, "fix signup");
    expect(texts(r)).toEqual([...direct.logs.map((l) => l.text), "Hotfix: Cruft -1 → 7.7. (First landed patch each week.)"]);
    expect(r.state.product?.cruft).toBe(7.7);
    expect(r.state.product?.lastHotfixWeek).toBe(1);
    expect(r.sound).toBe("success");
    const again = setProduct(base, { cruft: 8.7, lastHotfixWeek: 1 });
    expect(texts(run(again, "ship fix signup")).some((t) => t.startsWith("Hotfix"))).toBe(false);
    expect(texts(run(base, "ship fix signup")).some((t) => t.startsWith("Hotfix"))).toBe(false); // cruft 0
    const failed = setProduct(patchState("fail"), { cruft: 5 });
    expect(run(failed, "ship fix signup").state.product?.cruft).toBe(5);
    const half = setProduct(patchState("success"), { cruft: 0.4 });
    expect(texts(run(half, "ship fix signup")).at(-1)).toBe("Hotfix: Cruft -0.4 → 0. (First landed patch each week.)");
  });
});

describe("preflight on the new commands", () => {
  it("reports AP and cash for a kickoff and a release, the refusal reason otherwise, and nothing else", () => {
    const s = garage();
    expect(preflight(s, "build feature m Phoenix")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 2000 });
    expect(preflight(s, "build premium")).toEqual({ allowed: false, reason: "Premium tier builds need the coworking phase. You're in garage.", apCost: 0, cashCost: 0 });
    const ready = garage({ builds: [build({ progress: 12, qPts: 12, qSum: 700 })], founder: { name: "F", archetype: "visionary" } });
    expect(preflight(ready, "ship atlas")).toEqual({ allowed: true, reason: null, apCost: 1, cashCost: 0 });
    expect(preflight(ready, "build crunch atlas").allowed).toBe(false);
    expect(preflight(ready, "build")).toEqual({ allowed: true, reason: null, apCost: 0, cashCost: 0 });
    expect(preflight(ready, "staff atlas auto")).toEqual({ allowed: true, reason: null, apCost: 0, cashCost: 0 });
  });
});

describe("determinism and JSON", () => {
  const script = ["build feature m Phoenix", "build crunch", "end", "staff off lotte", "staff phoenix lotte", "end", "build crunch off", "end", "end", "ship phoenix", "build growth", "end", "ship fix", "build cancel"];
  const play = () => {
    let s = garage({ cash: 500_000 });
    const log: string[] = [];
    for (const input of script) {
      if (s.pendingEvent) {
        const c = run(s, "choose 1");
        s = c.state;
        log.push(...texts(c));
      }
      const r = run(s, input);
      expect(JSON.parse(JSON.stringify(r.state)), input).toEqual(r.state);
      s = r.state;
      log.push(...texts(r));
    }
    return { s, log };
  };

  it("the same script twice gives deep-equal states and identical logs; it releases something", () => {
    const a = play();
    const b = play();
    expect(b.s).toEqual(a.s);
    expect(b.log).toEqual(a.log);
    expect(a.s.product?.shippedCount).toBeGreaterThanOrEqual(1);
    expect(a.log.some((t) => t.startsWith("RECEPTION"))).toBe(true);
  });
});
