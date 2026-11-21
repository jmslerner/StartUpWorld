import { describe, expect, it } from "vitest";
import type { GameState } from "../../types/game";
import { createInitialState, executeCommand } from "../../engine";
import { makeState } from "../../engine/testHelpers";
import { preflight } from "../../engine/tycoon/preflight";
import { buildTycoonHints, shipBuildSuggestions, tycoonSuggestions, type Suggestion } from "./tycoonComplete";

const play = (state: GameState, commands: string[]): GameState =>
  commands.reduce((s, cmd) => {
    const ready = s.pendingEvent ? executeCommand(s, "choose 1").state : s;
    const result = executeCommand(ready, cmd);
    return result.state;
  }, state);

/** A real run: two hired engineers (plus the setup hire), an engineering candidate list and a Feature S kicked off. */
const run = (): GameState =>
  play(createInitialState(), [
    "seed 777",
    "name Ada",
    "company Loopwell",
    "founder hacker",
    "cofounder builder",
    "raise friends",
    "raise loan",
    "hire eng 2",
    "end",
    "recruit eng",
    "build feature s Atlas",
  ]);

const labels = (list: Suggestion[] | null): string[] => (list ?? []).map((s) => s.label);
const values = (list: Suggestion[] | null): string[] => (list ?? []).map((s) => s.nextValue);

describe("buildTycoonHints", () => {
  it("is empty for a legacy state with no slices", () => {
    const h = buildTycoonHints(makeState());
    expect(h.people).toEqual([]);
    expect(h.builds).toEqual([]);
    expect(h.candidates).toEqual({});
    expect(h.roleTokens).toEqual(["eng", "ux", "marketing", "sales", "ops", "hr", "legal"]);
  });

  it("lists the named people with handles the engine accepts", () => {
    const s = run();
    const h = buildTycoonHints(s);
    expect(h.people.length).toBe(s.people!.roster.length);
    expect(h.people.length).toBeGreaterThanOrEqual(3);
    for (const p of h.people) {
      expect(p.handle === p.id || p.name.toLowerCase().startsWith(p.handle)).toBe(true);
      const card = executeCommand(s, `team ${p.handle}`);
      expect(card.logs.filter((l) => l.kind === "error")).toEqual([]);
      expect(card.logs[0].text).toContain(p.name);
    }
  });

  it("lists the active build, this week's candidates, and unlocked types and sizes only", () => {
    const h = buildTycoonHints(run());
    expect(h.builds.map((b) => b.slug)).toEqual(["atlas"]);
    expect(h.builds[0].label).toMatch(/^Atlas \(\d+%\)$/);
    expect(h.candidates.engineering?.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(h.buildTypes.map((t) => t.token)).toEqual(["feature", "growth", "plumbing"]);
    expect(h.buildSizes.feature?.map((z) => z.token)).toEqual(["s", "m"]);
    expect(h.buildTypes[0].tooltip).toContain("All build slots are taken");
  });
});

describe("tycoonSuggestions", () => {
  const s = run();
  const h = buildTycoonHints(s);

  it("leaves other commands to the caller", () => {
    expect(tycoonSuggestions("hire ", h)).toBeNull();
    expect(tycoonSuggestions("ship x", h)).toBeNull();
    expect(tycoonSuggestions("team", h)).toBeNull(); // the command word itself is still being typed
  });

  it("team: people, then all and role tokens", () => {
    const list = tycoonSuggestions("team ", h)!;
    expect(list.length).toBeLessThanOrEqual(8);
    expect(values(list).slice(0, h.people.length)).toEqual(h.people.map((p) => `team ${p.handle}`));
    expect(values(tycoonSuggestions("team al", h))).toEqual(["team all"]);
    expect(values(tycoonSuggestions("team ux", h))).not.toContain("team ux");
    expect(tycoonSuggestions("team ux ", h)).toEqual([]);
  });

  it("retain: people holding an offer come first", () => {
    const [first, second] = s.people!.roster;
    const offered: GameState = {
      ...s,
      people: {
        ...s.people!,
        roster: s.people!.roster.map((e) => (e.id === second.id ? { ...e, offerDueWeek: s.week + 2, offerKind: "recruiter" as const } : e)),
      },
    };
    const hints = buildTycoonHints(offered);
    const list = tycoonSuggestions("retain ", hints)!;
    expect(list[0].label).toContain(second.name);
    expect(list[0].label).toContain("LEAVES IN 2W");
    expect(labels(list).some((l) => l.includes(first.name))).toBe(true);
    expect(preflight(offered, list[0].nextValue).allowed).toBe(true);
  });

  it("fire: people, then layoffs by role", () => {
    const list = tycoonSuggestions("fire ", h)!;
    expect(list[0].kind).toBe("person");
    expect(values(tycoonSuggestions("fire en", h))).toContain("fire eng ");
    expect(preflight(s, list[0].nextValue).allowed).toBe(true);
  });

  it("recruit: unlocked role tokens, then this week's candidates by number", () => {
    expect(values(tycoonSuggestions("recruit ", h))).toEqual(h.roleTokens.map((t) => `recruit ${t}`));
    expect(values(tycoonSuggestions("recruit da", h))).toEqual([]); // data unlocks at seed
    const picks = tycoonSuggestions("recruit eng ", h)!;
    expect(values(picks)).toEqual(["recruit eng 1", "recruit eng 2", "recruit eng 3"]);
    expect(picks[0].label).toMatch(/^1\) .+ — résumé pace \d craft \d, asks \$[\d,]+\/wk$/);
    expect(tycoonSuggestions("recruit ux ", h)).toEqual([]); // nobody looked at designers this week
  });

  it("build: types and verbs, sizes after a type, builds after crunch/cancel, on/off after crunch", () => {
    expect(values(tycoonSuggestions("build ", h))).toEqual([
      "build feature ", "build growth ", "build plumbing ", "build crunch ", "build cancel ", "build list",
    ]);
    expect(labels(tycoonSuggestions("build f", h))).toEqual(["feature — reputation and users"]);
    expect(labels(tycoonSuggestions("build feature ", h))[0]).toMatch(/^s — a weekend, allegedly: [\d.]+ pts, 2 seats, \$500 kickoff$/);
    expect(values(tycoonSuggestions("build c", h))).toEqual(["build crunch ", "build cancel "]);
    expect(values(tycoonSuggestions("build feature ", h))).toEqual(["build feature s ", "build feature m "]);
    expect(values(tycoonSuggestions("build feat ", h))).toEqual(["build feat s ", "build feat m "]);
    expect(tycoonSuggestions("build feature m ", h)).toEqual([]); // the name is free text
    expect(values(tycoonSuggestions("build cancel ", h))).toEqual(["build cancel atlas"]);
    expect(values(tycoonSuggestions("build crunch ", h))).toEqual(["build crunch atlas "]);
    expect(values(tycoonSuggestions("build crunch atlas ", h))).toEqual(["build crunch atlas on", "build crunch atlas off"]);
    expect(values(tycoonSuggestions("projects ", h))).toContain("projects list");
  });

  it("staff: builds and off, then auto, fitting people and roles; off lists staffed people and builds", () => {
    expect(values(tycoonSuggestions("staff ", h))).toEqual(["staff atlas ", "staff off "]);
    const onAtlas = tycoonSuggestions("staff atlas ", h)!;
    // `auto` only when it has a seat to fill (the engine refuses it otherwise).
    const atlasHint = h.builds.find((b) => b.slug === "atlas")!;
    expect(values(onAtlas).includes("staff atlas auto")).toBe(atlasHint.seatsFree > 0);
    expect(preflight(s, "staff atlas auto").allowed).toBe(atlasHint.seatsFree > 0);
    const staffed = new Set(s.product!.active[0] ? s.people!.roster.filter((e) => e.buildId === "b1").map((e) => e.id) : []);
    for (const sug of onAtlas.filter((x) => x.kind === "person")) {
      const p = h.people.find((x) => sug.nextValue.endsWith(` ${x.handle}`))!;
      expect(staffed.has(p.id)).toBe(false);
    }
    // Roles that have nothing to do on a Feature are not offered.
    const roles = labels(onAtlas.filter((x) => x.kind === "role"));
    expect(roles.every((r) => ["eng [n]", "ux [n]"].includes(r))).toBe(true);
    // Nor are roles nobody free answers to (this run has no designer).
    expect(h.people.some((p) => p.role === "design")).toBe(false);
    expect(values(onAtlas)).toContain("staff atlas eng");
    expect(values(onAtlas)).not.toContain("staff atlas ux");
    expect(values(tycoonSuggestions("staff at", h))).toEqual(["staff atlas "]);
    expect(tycoonSuggestions("staff nope ", h)).toEqual([]);

    const off = tycoonSuggestions("staff off ", h)!;
    expect(off.filter((x) => x.kind === "person").length).toBe(staffed.size);
    expect(values(off)).toContain("staff off atlas");
    for (const sug of off) expect(preflight(s, sug.nextValue).allowed).toBe(true);
  });

  it("does not offer a person twice on one staff line", () => {
    const free = h.people.find((p) => p.buildId === null && p.fitBuildIds.includes("b1"));
    if (!free) return;
    const again = tycoonSuggestions(`staff atlas ${free.handle} `, h)!;
    expect(values(again).some((v) => v.endsWith(` ${free.handle}`))).toBe(false);
  });
});

describe("shipBuildSuggestions", () => {
  it("offers active builds by slug or name prefix", () => {
    const h = buildTycoonHints(run());
    expect(values(shipBuildSuggestions("", h.builds))).toEqual(["ship atlas"]);
    expect(values(shipBuildSuggestions("at", h.builds))).toEqual(["ship atlas"]);
    expect(shipBuildSuggestions("atlas", h.builds)).toEqual([]);
    expect(shipBuildSuggestions("zzz", h.builds)).toEqual([]);
  });
});
