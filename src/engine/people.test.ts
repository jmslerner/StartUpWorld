import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { poachChance } from "./formulas";
import { STREAM, firstFloat } from "./rng";
import { BLITZ, BOOT, HUMAN, INCUMBENT, newGame, onlyActive, reportFor, resolve, seedWhere, withCompany, withState } from "./testKit";

const RECRUIT = { product: 2, growth: 0, recruiting: 1 };

describe("layoffs", () => {
  const big = withCompany(newGame(), HUMAN, { headcount: 6, headcountAtLastClose: 6, hype: 50 });

  it("pay $20K severance a head", () => {
    expect(reportFor(resolve(big, { [HUMAN]: { layoffs: 1 } }), HUMAN).costs.severance).toBe(20_000);
    expect(reportFor(resolve(big, { [HUMAN]: { layoffs: 3 } }), HUMAN).costs.severance).toBe(60_000);
  });

  it("cost 10 hype once, however many people go", () => {
    expect(reportFor(resolve(big, { [HUMAN]: { layoffs: 1 } }), HUMAN).hype.layoffs).toBe(-10);
    expect(reportFor(resolve(big, { [HUMAN]: { layoffs: 3 } }), HUMAN).hype.layoffs).toBe(-10);
    expect(reportFor(resolve(big), HUMAN).hype.layoffs).toBe(0);
  });

  it("shrink the team from this turn on", () => {
    const result = resolve(big, { [HUMAN]: { layoffs: 2 } });
    expect(reportFor(result, HUMAN).headcount).toMatchObject({ start: 6, laidOff: 2, end: 4 });
    expect(result.state.companies[HUMAN].headcount).toBe(4);
    expect(result.state.companies[HUMAN].lastQuarter?.left).toBe(2);
  });

  it("put the laid-off people among this turn's candidates", () => {
    expect(resolve(big).log.hiring.candidates).toBe(6);
    expect(resolve(big, { [HUMAN]: { layoffs: 3 } }).log.hiring.candidates).toBe(9);
  });
});

describe("hiring in a turn", () => {
  it("counts 6 candidates, plus the event's, plus people freed last turn, plus this turn's layoffs", () => {
    let state = withCompany(newGame(), HUMAN, { headcount: 4, headcountAtLastClose: 4 });
    state = withState(state, { freedPeople: 3, modifiers: { newUsers: 1, marketing: 1, extraCandidates: 4 } });
    expect(resolve(state, { [HUMAN]: { layoffs: 1 } }).log.hiring.candidates).toBe(6 + 4 + 3 + 1);
  });

  it("can hire 2 × recruiting work, rounded", () => {
    const one = reportFor(resolve(newGame(), { [HUMAN]: { allocation: RECRUIT } }), HUMAN);
    expect(one.hiring).toEqual({ capacity: 2, wanted: 2, hired: 2 });
    const none = reportFor(resolve(newGame()), HUMAN);
    expect(none.hiring).toEqual({ capacity: 0, wanted: 0, hired: 0 });
  });

  it("serves the highest hype first, one candidate at a time", () => {
    const everyone = { [HUMAN]: { allocation: RECRUIT }, [BLITZ]: { allocation: RECRUIT }, [BOOT]: { allocation: RECRUIT } };
    const result = resolve(withCompany(newGame(), BOOT, { hype: 15 }), everyone);
    const picks = result.log.hiring.picks;
    // Hype: Incumbent 20, Bootstrapper 15, the other two 10. The Incumbent's one recruiter can hire 1.
    expect(picks.slice(0, 2)).toEqual([INCUMBENT, BOOT]);
    expect([...picks.slice(2, 4)].sort()).toEqual([HUMAN, BLITZ]);
    expect(picks[4]).toBe(BOOT);
    expect(picks).toHaveLength(6);
    expect(reportFor(result, INCUMBENT).hiring.hired).toBe(1);
    expect(reportFor(result, BOOT).hiring.hired).toBe(2);
    expect(reportFor(result, HUMAN).hiring.hired + reportFor(result, BLITZ).hiring.hired).toBe(3);
  });

  it("orders equal hype by the seeded roll: the same every time for a seed, different across seeds", () => {
    const everyone = { [HUMAN]: { allocation: RECRUIT }, [BLITZ]: { allocation: RECRUIT }, [BOOT]: { allocation: RECRUIT } };
    const firstStartup = (seed: number) => resolve(newGame(), everyone, seed).log.hiring.picks[1];
    expect(firstStartup(11)).toBe(firstStartup(11));
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) seen.add(firstStartup(seed));
    expect([...seen].sort()).toEqual([HUMAN, BLITZ, BOOT]);
  });

  it("charges $10K per hire made, not per hire wanted", () => {
    const everyone = { [HUMAN]: { allocation: RECRUIT }, [BLITZ]: { allocation: RECRUIT }, [BOOT]: { allocation: RECRUIT } };
    const result = resolve(newGame(), everyone);
    for (const id of [HUMAN, BLITZ, BOOT, INCUMBENT]) {
      const report = reportFor(result, id);
      expect(report.costs.hiring).toBe(report.hiring.hired * 10_000);
      expect(report.hiring.hired).toBeLessThanOrEqual(report.hiring.wanted);
    }
    const total = [HUMAN, BLITZ, BOOT, INCUMBENT].reduce((n, id) => n + reportFor(result, id).hiring.hired, 0);
    expect(total).toBe(6);
  });

  it("respects the hire limit", () => {
    expect(reportFor(resolve(newGame(), { [HUMAN]: { allocation: RECRUIT, hireLimit: 1 } }), HUMAN).hiring).toEqual({ capacity: 2, wanted: 1, hired: 1 });
    expect(reportFor(resolve(newGame(), { [HUMAN]: { allocation: RECRUIT, hireLimit: 0 } }), HUMAN).hiring).toEqual({ capacity: 2, wanted: 0, hired: 0 });
    expect(reportFor(resolve(newGame(), { [HUMAN]: { allocation: RECRUIT, hireLimit: 9 } }), HUMAN).hiring).toEqual({ capacity: 2, wanted: 2, hired: 2 });
  });

  it("does not carry unhired candidates or used-up freed people into the next turn", () => {
    const state = withState(newGame(), { freedPeople: 5 });
    const first = resolve(state);
    expect(first.log.hiring.candidates).toBe(11);
    expect(first.state.freedPeople).toBe(0);
    expect(resolve(first.state).log.hiring.candidates).toBe(6);
  });

  it("records joiners in the public quarter stats", () => {
    const result = resolve(newGame(), { [HUMAN]: { allocation: RECRUIT } });
    expect(result.state.companies[HUMAN].lastQuarter).toMatchObject({ joined: 2, left: 0 });
  });
});

describe("poaching", () => {
  const chance = poachChance(20, 10, DESIGN);
  const rollOf = (seed: number, poacher: number, turn = 1) => firstFloat(seed, turn, STREAM.poach, poacher);
  const winning = seedWhere((seed) => rollOf(seed, INCUMBENT) < chance);
  const losing = seedWhere((seed) => rollOf(seed, INCUMBENT) >= chance);

  it("has a 50% chance plus half the hype gap in points", () => {
    expect(reportFor(resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }), INCUMBENT).poach?.chance).toBeCloseTo(0.55, 9);
    expect(reportFor(resolve(newGame(), { [HUMAN]: { poachTarget: INCUMBENT } }), HUMAN).poach?.chance).toBeCloseTo(0.45, 9);
  });

  it("succeeds exactly when its roll is under the chance", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const report = reportFor(resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, seed), INCUMBENT);
      expect(report.poach?.success, `seed ${seed}`).toBe(rollOf(seed, INCUMBENT) < chance);
    }
  });

  it("costs $50K whether or not it works", () => {
    expect(reportFor(resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, winning), INCUMBENT).costs.poaching).toBe(50_000);
    expect(reportFor(resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, losing), INCUMBENT).costs.poaching).toBe(50_000);
    expect(reportFor(resolve(newGame()), INCUMBENT).costs.poaching).toBe(0);
  });

  it("moves one person from next turn: both sides work and pay as before this turn", () => {
    const quiet = resolve(newGame(), {}, winning);
    const result = resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, winning);
    expect(reportFor(result, INCUMBENT).poach).toMatchObject({ targetId: HUMAN, success: true });
    expect(reportFor(result, INCUMBENT).headcount).toMatchObject({ start: 8, poachedIn: 1, poachedOut: 0 });
    expect(reportFor(result, HUMAN).headcount).toMatchObject({ start: 3, poachedIn: 0, poachedOut: 1, end: 2 });
    expect(result.state.companies[HUMAN].headcount).toBe(2);
    expect(result.state.companies[INCUMBENT].headcount).toBe(quiet.state.companies[INCUMBENT].headcount + 1);
    expect(reportFor(result, HUMAN).work).toEqual(reportFor(quiet, HUMAN).work);
    expect(reportFor(result, HUMAN).costs.salaries).toBe(120_000);
    expect(reportFor(result, INCUMBENT).costs.salaries).toBe(320_000);
    expect(result.state.companies[HUMAN].lastQuarter?.left).toBe(1);
    expect(result.state.companies[INCUMBENT].lastQuarter?.joined).toBe(quiet.state.companies[INCUMBENT].lastQuarter!.joined + 1);
  });

  it("moves nobody when it fails", () => {
    const result = resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, losing);
    expect(reportFor(result, INCUMBENT).poach).toMatchObject({ targetId: HUMAN, success: false });
    expect(result.state.companies[HUMAN].headcount).toBe(3);
  });

  it("is dropped at no cost when layoffs have left the target with one person", () => {
    const state = withCompany(newGame(), HUMAN, { headcount: 2, headcountAtLastClose: 2 });
    const result = resolve(state, { [HUMAN]: { layoffs: 1 }, [INCUMBENT]: { poachTarget: HUMAN } }, winning);
    const report = reportFor(result, INCUMBENT);
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    expect(report.notes.join(" ")).toMatch(/Poach dropped/);
    expect(result.state.companies[HUMAN].headcount).toBe(1);
  });

  it("resolves attempts in hype order, so a team of two can only lose one person", () => {
    // Blitzscaler (hype 30) and Incumbent (hype 20) both go for the two-person human team.
    const state = withCompany(withCompany(newGame(), HUMAN, { headcount: 2, headcountAtLastClose: 2 }), BLITZ, { hype: 30 });
    const blitzChance = poachChance(30, 10, DESIGN);
    const seed = seedWhere((s) => rollOf(s, BLITZ) < blitzChance && rollOf(s, INCUMBENT) < chance);
    const result = resolve(state, { [BLITZ]: { poachTarget: HUMAN }, [INCUMBENT]: { poachTarget: HUMAN } }, seed);
    expect(reportFor(result, BLITZ).poach?.success).toBe(true);
    expect(reportFor(result, INCUMBENT).poach).toBeNull();
    expect(reportFor(result, INCUMBENT).costs.poaching).toBe(0);
    expect(result.state.companies[HUMAN].headcount).toBe(1);
  });

  it("lets the second poacher try when the first one fails", () => {
    const state = withCompany(withCompany(newGame(), HUMAN, { headcount: 2, headcountAtLastClose: 2 }), BLITZ, { hype: 30 });
    const blitzChance = poachChance(30, 10, DESIGN);
    const seed = seedWhere((s) => rollOf(s, BLITZ) >= blitzChance && rollOf(s, INCUMBENT) < chance);
    const result = resolve(state, { [BLITZ]: { poachTarget: HUMAN }, [INCUMBENT]: { poachTarget: HUMAN } }, seed);
    expect(reportFor(result, BLITZ).poach?.success).toBe(false);
    expect(reportFor(result, INCUMBENT).poach?.success).toBe(true);
    expect(result.state.companies[HUMAN].headcount).toBe(1);
  });

  it("gives each poacher its own roll: another company's plan cannot change it", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const alone = reportFor(resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN } }, seed), INCUMBENT).poach?.success;
      const busy = reportFor(
        resolve(newGame(), { [INCUMBENT]: { poachTarget: HUMAN }, [BLITZ]: { poachTarget: BOOT, marketing: 100_000 }, [BOOT]: { allocation: RECRUIT } }, seed),
        INCUMBENT,
      ).poach?.success;
      expect(busy, `seed ${seed}`).toBe(alone);
    }
  });

  it("cannot target a company that is out", () => {
    const state = onlyActive(newGame(), [HUMAN, INCUMBENT]);
    const report = reportFor(resolve(state, { [INCUMBENT]: { poachTarget: BLITZ } }), INCUMBENT);
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
  });

  it("never takes a company's last person, even if the config's floor is set to 1 or 0", () => {
    for (const floor of [1, 0]) {
      const loose = { ...DESIGN, poach: { ...DESIGN.poach, minTargetHeadcount: floor } };
      const state = withCompany(newGame(), HUMAN, { headcount: 1, headcountAtLastClose: 1 });
      const result = resolve(state, { [HUMAN]: { allocation: { product: 1, growth: 0, recruiting: 0 } }, [INCUMBENT]: { poachTarget: HUMAN } }, winning, loose);
      expect(reportFor(result, INCUMBENT).poach, `floor ${floor}`).toBeNull();
      expect(reportFor(result, INCUMBENT).costs.poaching, `floor ${floor}`).toBe(0);
      expect(result.state.companies[HUMAN].headcount, `floor ${floor}`).toBe(1);
      // A team of two can still lose one.
      const pair = withCompany(newGame(), HUMAN, { headcount: 2, headcountAtLastClose: 2 });
      expect(resolve(pair, { [INCUMBENT]: { poachTarget: HUMAN } }, winning, loose).state.companies[HUMAN].headcount, `floor ${floor}`).toBe(1);
    }
  });
});
