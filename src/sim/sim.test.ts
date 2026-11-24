import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { applyOverrides } from "./overrides";
import { checkTargets, formatReport, summarize, type SimSummary } from "./report";
import { runBatch, runGame } from "./runGame";

const batch = runBatch(24, 1, DESIGN);

describe("runGame", () => {
  it("plays a seeded game to an outcome within the turn limit", () => {
    for (const game of batch) {
      expect(game.turns).toBeGreaterThanOrEqual(1);
      expect(game.turns).toBeLessThanOrEqual(DESIGN.game.maxTurns);
      expect(["ipo", "lastStanding", "turnLimit", "wipeout"]).toContain(game.ending);
    }
  });

  it("puts the baseline bot in the player's seat against the three CPUs", () => {
    for (const game of batch) {
      expect(game.seats[0].controller).toBe("baseline");
      expect(game.seats.slice(1).map((seat) => seat.controller).sort()).toEqual(["blitzscaler", "bootstrapper", "incumbent"]);
    }
  });

  it("names exactly one winner, who is still in the game, unless everyone went out", () => {
    for (const game of batch) {
      const winners = game.seats.filter((seat) => seat.won);
      if (game.ending === "wipeout") {
        expect(game.winner).toBeNull();
        expect(winners).toHaveLength(0);
      } else {
        expect(winners).toHaveLength(1);
        expect(winners[0].controller).toBe(game.winner);
        expect(winners[0].out).toBeNull();
      }
    }
  });

  it("is the same for the same seed", () => {
    expect(runGame(5, DESIGN)).toEqual(batch[4]);
    expect(runBatch(3, 10, DESIGN)).toEqual(runBatch(3, 10, DESIGN));
  });

  it("uses a different seed for every game of a batch", () => {
    expect(batch.map((game) => game.seed)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });
});

describe("summarize", () => {
  const summary = summarize(batch);

  it("counts every game once in the win shares and once in the endings", () => {
    const wins = Object.values(summary.winShare).reduce((a, b) => a + b, 0);
    const endings = Object.values(summary.endingShare).reduce((a, b) => a + b, 0);
    expect(summary.games).toBe(24);
    expect(wins).toBeCloseTo(1, 9);
    expect(endings).toBeCloseTo(1, 9);
  });

  it("reports the median game length in turns", () => {
    const turns = batch.map((game) => game.turns).sort((a, b) => a - b);
    expect(summary.medianTurns).toBe((turns[11] + turns[12]) / 2);
  });

  it("reports how often each kind of player goes bankrupt or is fired", () => {
    for (const controller of ["baseline", "blitzscaler", "bootstrapper", "incumbent"] as const) {
      const seats = batch.map((game) => game.seats.find((seat) => seat.controller === controller)!);
      expect(summary.bankruptShare[controller]).toBeCloseTo(seats.filter((seat) => seat.out === "bankrupt").length / 24, 9);
      expect(summary.firedShare[controller]).toBeCloseTo(seats.filter((seat) => seat.out === "fired").length / 24, 9);
    }
  });
});

describe("targets and the printed report", () => {
  const healthy: SimSummary = {
    ...summarize(batch),
    winShare: { baseline: 0.25, blitzscaler: 0.3, bootstrapper: 0.2, incumbent: 0.25, nobody: 0 },
    endingShare: { ipo: 0.6, turnLimit: 0.35, lastStanding: 0.05, wipeout: 0 },
    medianTurns: 17,
  };

  it("checks the four balance targets", () => {
    const checks = checkTargets(healthy, DESIGN.sim.targets);
    expect(checks).toHaveLength(4);
    expect(checks.every((check) => check.pass)).toBe(true);
  });

  it("fails each target when its number is out of range", () => {
    const failing = (patch: Partial<SimSummary>) => checkTargets({ ...healthy, ...patch }, DESIGN.sim.targets).filter((check) => !check.pass).map((check) => check.id);
    expect(failing({ winShare: { ...healthy.winShare, incumbent: 0.41 } })).toEqual(["cpu-cap"]);
    expect(failing({ winShare: { ...healthy.winShare, baseline: 0.14 } })).toEqual(["baseline"]);
    expect(failing({ winShare: { ...healthy.winShare, baseline: 0.36 } })).toEqual(["baseline"]);
    expect(failing({ medianTurns: 13 })).toEqual(["length"]);
    expect(failing({ medianTurns: 20.5 })).toEqual(["length"]);
    expect(failing({ endingShare: { ...healthy.endingShare, ipo: 0.39 } })).toEqual(["ipo"]);
    expect(failing({ endingShare: { ...healthy.endingShare, ipo: 0.81 } })).toEqual(["ipo"]);
  });

  it("accepts numbers exactly on a boundary", () => {
    const edge = checkTargets(
      { ...healthy, winShare: { baseline: 0.15, blitzscaler: 0.4, bootstrapper: 0.4, incumbent: 0.05, nobody: 0 }, medianTurns: 14, endingShare: { ...healthy.endingShare, ipo: 0.8 } },
      DESIGN.sim.targets,
    );
    expect(edge.every((check) => check.pass)).toBe(true);
  });

  it("prints win rates, endings, game length, bankruptcy rate and a PASS or FAIL line per target", () => {
    const text = formatReport(healthy, checkTargets(healthy, DESIGN.sim.targets), 20);
    for (const phrase of ["Baseline bot", "Blitzscaler", "Bootstrapper", "Incumbent", "IPO", "Turn 20", "Last one standing", "Median", "bankrupt"]) {
      expect(text).toContain(phrase);
    }
    expect(text.match(/^\s*(PASS|FAIL)\b/gm)).toHaveLength(4);
    expect(text).not.toContain("FAIL");
    const bad = { ...healthy, medianTurns: 9 };
    expect(formatReport(bad, checkTargets(bad, DESIGN.sim.targets), 20)).toContain("FAIL");
  });

  it("names the turn limit it is given, not a fixed 20", () => {
    const text = formatReport(healthy, checkTargets(healthy, DESIGN.sim.targets), 12);
    expect(text).toContain("Turn 12");
    expect(text).toContain("at turn 12");
    expect(text).not.toMatch(/turn 20/i);
  });
});

describe("applyOverrides", () => {
  it("changes the named numbers and nothing else, leaving the original alone", () => {
    const changed = applyOverrides(DESIGN, { "ipo.users": 400_000, "cpu.personalities.blitzscaler.weights.users": 2, "raise.options.0": 5 });
    expect(changed.ipo.users).toBe(400_000);
    expect(changed.cpu.personalities.blitzscaler.weights.users).toBe(2);
    expect(changed.raise.options).toEqual([5, 20, 30]);
    expect(DESIGN.ipo.users).toBe(250_000);
    expect(DESIGN.raise.options).toEqual([10, 20, 30]);
    expect({ ...changed, ipo: DESIGN.ipo, cpu: DESIGN.cpu, raise: DESIGN.raise }).toEqual(DESIGN);
  });

  it("can change a price tier by name", () => {
    expect(applyOverrides(DESIGN, { "baseline.price": "budget" }).baseline.price).toBe("budget");
  });

  it("refuses a path that does not exist, is not a single value, or changes type", () => {
    expect(() => applyOverrides(DESIGN, { "ipo.user": 1 })).toThrow(/ipo\.user/);
    expect(() => applyOverrides(DESIGN, { ipo: 1 })).toThrow();
    expect(() => applyOverrides(DESIGN, { "ipo.users": "many" })).toThrow();
    expect(() => applyOverrides(DESIGN, { "events.deck.0.name.x": 1 })).toThrow();
  });

  it("changes the games it is used for", () => {
    const easy = applyOverrides(DESIGN, { "ipo.users": 30_000 });
    expect(summarize(runBatch(12, 1, easy)).medianTurns).toBeLessThan(summarize(runBatch(12, 1, DESIGN)).medianTurns);
  });
});
