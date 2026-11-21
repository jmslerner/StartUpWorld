import { describe, expect, it } from "vitest";
import type { GameState, TeamRoster } from "../../types/game";
import commandsSource from "../commands.ts?raw";
import { executeCommand } from "../commands";
import { createInitialState } from "../actions";
import { makeState, makeTycoonState } from "../testHelpers";
import { rosterOf } from "./roster";

// Wiring in commands.ts (TYCOON-SPEC §4.5, §4.9, §4.10, §12.1), tested against the stub modules.

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0,
  ...counts,
});

const texts = (s: GameState, input: string): string[] => executeCommand(s, input).logs.map((l) => l.text);
const PENDING = "Resolve the pending event first with `choose <n>`.";
const pendingEvent = { id: "x", title: "T", prompt: "P", choices: [{ id: "a", text: "A" }] };

const NEW_HELP = [
  "ship <name> - release the build called <name>, or ship a quick patch under any other name",
  "team [role|name] - who works here: pace, craft, energy, pay, offers",
  "recruit <role> [n] - this week's three candidates; sign one (1 AP + hire cost)",
  "retain <name> - bonus and a raise so they stay (1 AP); answers an outside offer",
  "fire <name> | fire <role> <count> - let people go (1 AP, two weeks' severance each)",
  "build - product board: builds in progress, forecasts, cruft, moat",
  "build <type> [size] [name] - start a build (1 AP + kickoff). types: feature, growth, premium, plumbing, moonshot; sizes: s, m, l, xl",
  "build crunch <name> [off] / build cancel <name> - push a build harder, or kill it (free)",
  "staff <build> auto|<name|role n> / staff off <name|build> - put people on a build (free; first week is ramp-up)",
];

// Today's did-you-mean list and matcher, verbatim, to prove legacy typos keep their suggestion.
const LEGACY_COMMANDS = [
  "help", "clear", "cls", "status", "seed", "name", "company",
  "founder", "cofounder", "choose", "hire", "ship", "launch",
  "pitch", "raise", "pricing", "perks", "board", "phases",
  "restart",
  "buy", "assets", "end",
];
const lev = (a: string, b: string): number => {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
};
const legacySuggestion = (input: string): string | null => {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const cmd of LEGACY_COMMANDS) {
    const d = lev(input, cmd);
    if (d < bestDist && d <= 2) {
      best = cmd;
      bestDist = d;
    }
  }
  return best;
};
const unknownLine = (input: string, suggestion: string | null): string =>
  suggestion ? `Unknown command: ${input}. Did you mean \`${suggestion}\`?` : `Unknown command: ${input}. Type \`help\` to see commands.`;

describe("help", () => {
  it("lists every new command line, right after `ship`, in both lists", () => {
    for (const s of [createInitialState(), makeState()]) {
      const lines = texts(s, "help");
      const at = lines.indexOf(NEW_HELP[0]);
      expect(at).toBeGreaterThan(0);
      expect(lines.slice(at, at + NEW_HELP.length)).toEqual(NEW_HELP);
      expect(lines).not.toContain("ship <feature> - ship a feature");
      expect(lines[at + NEW_HELP.length]).toBe("launch <campaign> - run a growth campaign");
    }
  });
});

describe("did-you-mean", () => {
  it("suggests the new commands", () => {
    const s = makeState();
    expect(texts(s, "taem")).toEqual([unknownLine("taem", "team")]);
    expect(texts(s, "recrut")).toEqual([unknownLine("recrut", "recruit")]);
    expect(texts(s, "biuld")).toEqual([unknownLine("biuld", "build")]);
    expect(texts(s, "retian")).toEqual([unknownLine("retian", "retain")]);
    expect(texts(s, "stafff")).toEqual([unknownLine("stafff", "staff")]);
    expect(texts(s, "projetc")).toEqual([unknownLine("projetc", "project")]);
  });

  it("keeps today's suggestion for legacy typos", () => {
    const s = makeState();
    const typos = ["hier", "shp", "lanch", "pich", "rasie", "statsu", "ned", "byu", "boadr", "phses", "assest", "chose", "sed", "nmae",
      "compny", "foundr", "cofonder", "perk", "restar", "hlep", "pricng", "xyzzy", "launc", "cleer"];
    for (const typo of typos) {
      expect(texts(s, typo), typo).toEqual([unknownLine(typo, legacySuggestion(typo))]);
    }
  });
});

describe("gating", () => {
  it("refuses state-changing tycoon commands during a pending event, and lets the read-only ones reach their module", () => {
    const s = makeTycoonState({ pendingEvent });
    for (const input of ["staff atlas auto", "retain mei", "fire mei", "fire eng 1", "staff off mei"]) {
      expect(texts(s, input), input).toEqual([PENDING]);
    }
    for (const input of ["team", "build", "project", "projects", "recruit eng", "build list"]) {
      const lines = texts(s, input);
      expect(lines, input).not.toContain(PENDING);
    }
  });

  it("gives every new command today's setup error before setup completes", () => {
    const s = createInitialState();
    for (const input of ["team", "recruit eng", "retain x", "fire x", "fire", "build", "build feature", "project", "projects", "staff x auto"]) {
      expect(texts(s, input), input).toEqual(["Set your name first: `name <your name>`."]);
    }
  });

  it("routes the new commands to their modules instead of the unknown-command and easter-egg paths", () => {
    // Holds for the stubs and for the real modules alike: whatever the module answers, it is not today's fallback.
    const s = makeTycoonState();
    for (const input of ["team", "recruit eng", "recruit eng 1", "retain e1", "fire e1", "fire eng 1", "build", "build feature m atlas", "project", "projects", "staff atlas auto"]) {
      const lines = texts(s, input);
      const command = input.split(" ")[0];
      expect(lines.length, input).toBeGreaterThan(0);
      expect(lines.some((t) => t.startsWith(`Unknown command: ${command}`)), input).toBe(false);
      expect(lines, input).not.toContain("HR says you need to file a PIP first. [[beat]] You don't have HR.");
    }
  });
});

describe("bare `fire`", () => {
  it("keeps the joke, adds usage, and changes nothing (not even logSeq)", () => {
    const s = makeState();
    const r = executeCommand(s, "fire");
    expect(r.logs.map((l) => l.text)).toEqual([
      "HR says you need to file a PIP first. [[beat]] You don't have HR.",
      "Usage: fire <name|id> | fire <role> <count>  (1 AP, two weeks' severance each)",
    ]);
    expect(r.state).toBe(s);
    expect(r.sound).toBeUndefined();
    expect(r.logs.some((l) => l.kind === "error")).toBe(false);
    const named = makeTycoonState({ team: team({ engineering: 2 }) });
    const r2 = executeCommand(named, "fire");
    expect(r2.state).toBe(named);
  });

  it("has HR's answer when HR exists", () => {
    const s = makeState({ team: team({ engineering: 1, hr: 1 }) });
    expect(texts(s, "fire")[0]).toBe("HR has a form for that. [[beat]] HR has a form for everything.");
  });

  it("is still a key of EASTER_EGGS (the world layer parses it out of commands.ts)", () => {
    const block = commandsSource.slice(commandsSource.indexOf("const EASTER_EGGS"));
    const body = block.slice(0, block.indexOf("};"));
    expect(body).toMatch(/\n\s+fire: "HR says you need to file a PIP first\. \[\[beat\]\] You don't have HR\.",/);
  });
});

describe("existing commands", () => {
  it("`hire eng 1` names the newcomer in its first line and logs as many lines as today", () => {
    const named = makeTycoonState({ team: team({ engineering: 1 }) });
    const legacy = makeState({ team: team({ engineering: 1 }) });
    const a = executeCommand(named, "hire eng 1");
    const b = executeCommand(legacy, "hire eng 1");
    expect(a.logs).toHaveLength(b.logs.length);
    expect(b.logs[0].text).toBe("Hired 1 engineering hire.");
    const newcomer = rosterOf(a.state).find((e) => !rosterOf(named).some((x) => x.id === e.id))!;
    expect(a.logs[0].text).toBe(
      `Hired 1 engineering hire: ${newcomer.name} (pace ${newcomer.pace}, craft ${newcomer.craft}${newcomer.quirk ? `, ${newcomer.quirk}` : ""}).`,
    );
    expect(a.logs.slice(1).map((l) => l.text)).toEqual(b.logs.slice(1).map((l) => l.text));
  });

  it("`hire eng 5` names three and counts the rest; at the cap it keeps today's line", () => {
    const r = executeCommand(makeTycoonState({ cash: 1_000_000 }), "hire eng 5");
    expect(r.logs[0].text).toMatch(/^Hired 5 engineering hires: .+ \(pace \d, craft \d(, \w+)?\), .+ \+2 more\.$/);
    const capped = executeCommand(makeTycoonState({ team: team({ engineering: 120 }), cash: 1_000_000 }), "hire eng 2");
    expect(capped.logs[0].text).toBe("Hired 2 engineering hires.");
    const partly = executeCommand(makeTycoonState({ team: team({ engineering: 118 }), cash: 1_000_000 }), "hire eng 5");
    expect(partly.logs[0].text).toMatch(/\+3 unlisted\.$/);
  });

  it("a landed patch mentions `build` in weeks 3-12 while no build was ever started, and only then", () => {
    const find = (s: GameState): string | undefined => texts(s, "ship thing").find((t) => t.startsWith("Shipped feature"));
    const eligible = (week: number, extra: Partial<GameState> = {}) => makeTycoonState({ week, culture: { cohesion: 100, morale: 100 }, ...extra });
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const line = find(eligible(5, { rng: seed * 7919 }));
      if (line) {
        landed += 1;
        expect(line).toBe("Shipped feature: thing. (Bigger bets: `build`.)");
      }
      const legacyLine = find(makeState({ week: 5, rng: seed * 7919, culture: { cohesion: 100, morale: 100 } }));
      if (legacyLine) expect(legacyLine).toBe("Shipped feature: thing.");
      const late = find(eligible(13, { rng: seed * 7919 }));
      if (late) expect(late).toBe("Shipped feature: thing.");
      const early = find(eligible(2, { rng: seed * 7919 }));
      if (early) expect(early).toBe("Shipped feature: thing.");
      const started = find(eligible(5, { rng: seed * 7919, product: { ...makeTycoonState().product!, nextId: 2 } }));
      if (started) expect(started).toBe("Shipped feature: thing.");
    }
    expect(landed).toBeGreaterThan(5);
  });

  it("`status` keeps one log entry", () => {
    const s = makeTycoonState({ team: team({ engineering: 3 }) });
    const r = executeCommand(s, "status");
    expect(r.logs).toHaveLength(1);
    expect(r.state.logSeq).toBe(s.logSeq + 1);
  });
});
