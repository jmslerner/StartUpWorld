import { describe, expect, it } from "vitest";
import type { GameState, TeamRole, TeamRoster } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { launchCampaign, shipFeature } from "../engine/actions";
import { calcBurn } from "../engine/economy";
import { eventPool } from "../engine/events/pool";
import { makeCtx, makeState } from "../engine/testHelpers";
import { endWeekTick } from "../engine/tick";
import { mix32 } from "./hash";
import {
  FIRST_NAME_COUNT,
  LAST_NAME_COUNT,
  ROLE_BLURBS,
  ROLE_HIRE_TOKENS,
  ROLE_TEAM_NAMES,
  ROLE_TITLES,
  UNIQUE_NAME_COUNT,
  employeeName,
  roleBlurb,
  roleTitle,
} from "./names";

const ROLES: TeamRole[] = ["engineering", "design", "product", "data", "marketing", "sales", "ops", "hr", "legal", "executive"];

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0,
  design: 0,
  marketing: 0,
  sales: 0,
  ops: 0,
  hr: 0,
  legal: 0,
  data: 0,
  product: 0,
  executive: 0,
  ...counts,
});

const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
  return true;
};

/** Every name the first `perRole` hires of every role get in one run. */
const cast = (seed: number, perRole: number): string[] => {
  const names: string[] = [];
  for (const role of ROLES) for (let i = 0; i < perRole; i += 1) names.push(employeeName(seed, role, i).full);
  return names;
};

describe("employeeName", () => {
  it("is deterministic", () => {
    expect(employeeName(123, "engineering", 0)).toEqual(employeeName(123, "engineering", 0));
    expect(employeeName(123, "sales", 7)).toEqual(employeeName(123, "sales", 7));
  });

  it("reads as a first name and a last name", () => {
    for (const role of ROLES) {
      for (let i = 0; i < 12; i += 1) {
        const name = employeeName(99, role, i);
        expect(name.full).toBe(`${name.first} ${name.last}`);
        expect(name.short).toBe(`${name.first} ${name.last.charAt(0)}.`);
        // ASCII, capitalised, no stray whitespace: safe for canvas labels and the monospace UI.
        expect(name.full).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      }
    }
  });

  it("draws on big, relatively prime pools", () => {
    expect(FIRST_NAME_COUNT).toBeGreaterThanOrEqual(80);
    expect(LAST_NAME_COUNT).toBeGreaterThanOrEqual(60);
    // The no-collision guarantee rests on the pool sizes being two different primes.
    expect(isPrime(FIRST_NAME_COUNT)).toBe(true);
    expect(isPrime(LAST_NAME_COUNT)).toBe(true);
    expect(FIRST_NAME_COUNT).not.toBe(LAST_NAME_COUNT);
    expect(UNIQUE_NAME_COUNT).toBe(FIRST_NAME_COUNT * LAST_NAME_COUNT);
  });

  it("uses every name in both pools, with no duplicates in either", () => {
    // 100 consecutive ordinals walk the whole first-name pool; 70 walk the last names.
    const firsts = new Set<string>();
    const lasts = new Set<string>();
    for (const role of ROLES) {
      for (let i = 0; i < 10; i += 1) {
        const name = employeeName(5, role, i);
        firsts.add(name.first);
        lasts.add(name.last);
      }
    }
    expect(firsts.size).toBe(FIRST_NAME_COUNT);
    expect(lasts.size).toBe(LAST_NAME_COUNT);
  });

  it("never repeats a full name within a run, far beyond what an office can hold", () => {
    for (const seed of [0, 1, 2, 12345, 0xdeadbeef, 0xffffffff, 20261120]) {
      // 10 roles × 64 people: more than MAX_WORLD_PEOPLE in every single role.
      const names = cast(seed, 64);
      expect(new Set(names).size, `seed ${seed}`).toBe(names.length);
    }
  });

  it("does not even repeat a first name while every role has at most nine people", () => {
    for (const seed of [3, 4242, 987654321]) {
      const firsts: string[] = [];
      for (const role of ROLES) for (let i = 0; i < 9; i += 1) firsts.push(employeeName(seed, role, i).first);
      expect(new Set(firsts).size, `seed ${seed}`).toBe(firsts.length);
    }
  });

  it("exhausts every combination before lapping, then keeps names unique with a suffix", () => {
    const seed = 2024;
    const perRole = UNIQUE_NAME_COUNT / 10;
    expect(Number.isInteger(perRole)).toBe(false);
    // One full lap of the sequence: engineering indices 0 … ceil(perRole).
    const seen = new Set<string>();
    const laps = Math.ceil(perRole);
    for (const role of ROLES) for (let i = 0; i < laps; i += 1) seen.add(employeeName(seed, role, i).full);
    expect(seen.size).toBe(laps * 10);

    const first = employeeName(seed, "engineering", 0);
    // The same slot one lap later: same person's name, second of that name.
    const lapped = employeeName(seed, "engineering", UNIQUE_NAME_COUNT);
    expect(lapped.first).toBe(first.first);
    expect(lapped.last).toBe(`${first.last} XI`);
    expect(lapped.full).not.toBe(first.full);
  });

  it("gives different runs different casts", () => {
    const casts = new Set<string>();
    for (let seed = 1; seed <= 50; seed += 1) casts.add(cast(seed, 2).join("|"));
    expect(casts.size).toBeGreaterThanOrEqual(49);
  });

  it("mixes the pool differently per run instead of always starting with the same people", () => {
    const firstHires = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) firstHires.add(employeeName(seed, "engineering", 0).first);
    // 300 runs should have met most of the 97 first names as their very first engineer.
    expect(firstHires.size).toBeGreaterThan(FIRST_NAME_COUNT * 0.8);
  });

  it("tolerates nonsense indices", () => {
    expect(employeeName(1, "hr", -5)).toEqual(employeeName(1, "hr", 0));
    expect(employeeName(1, "hr", 2.9)).toEqual(employeeName(1, "hr", 2));
    expect(employeeName(1, "hr", Number.NaN)).toEqual(employeeName(1, "hr", 0));
    expect(employeeName(1, "hr", 1e12).full.length).toBeGreaterThan(0);
  });

  it("never reuses a name the engine can give the cofounder", () => {
    // Collect cofounder names from the engine itself rather than restating its list.
    const cofounderNames = new Set<string>();
    for (const archetype of ["operator", "builder", "rainmaker", "powderkeg"]) {
      for (let i = 1; i <= 80; i += 1) {
        let state: GameState = { ...createInitialState(), rng: mix32(i) || 1 };
        for (const command of ["name A", "company B", "founder hacker", `cofounder ${archetype}`]) {
          state = executeCommand(state, command).state;
        }
        cofounderNames.add(state.cofounder.name);
      }
    }
    expect(cofounderNames.size).toBe(24);

    const firsts = new Set<string>();
    for (const role of ROLES) for (let i = 0; i < 10; i += 1) firsts.add(employeeName(1, role, i).first);
    for (const name of cofounderNames) expect(firsts.has(name), name).toBe(false);
  });
});

describe("role vocabulary", () => {
  it("has a title, a team name, a hire token and a blurb for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_TITLES[role].singular.length).toBeGreaterThan(0);
      expect(ROLE_TITLES[role].plural.length).toBeGreaterThan(0);
      expect(ROLE_TEAM_NAMES[role].length).toBeGreaterThan(0);
      expect(ROLE_HIRE_TOKENS[role].length).toBeGreaterThan(0);
      expect(roleBlurb(role)).toBe(ROLE_BLURBS[role]);
    }
    expect(Object.keys(ROLE_TITLES).sort()).toEqual([...ROLES].sort());
  });

  it("titles people the way the brief asks", () => {
    expect(roleTitle("engineering")).toBe("Engineer");
    expect(roleTitle("hr")).toBe("People Ops");
    expect(roleTitle("executive")).toBe("VP");
    expect(roleTitle("engineering", 3)).toBe("Engineers");
    expect(roleTitle("executive", 2)).toBe("VPs");
    expect(roleTitle("design", 1)).toBe("Designer");
    expect(roleTitle("design", 0)).toBe("Designers");
  });

  it("keeps blurbs to one readable line", () => {
    for (const role of ROLES) {
      const blurb = ROLE_BLURBS[role];
      expect(blurb).not.toMatch(/\n/);
      expect(blurb.length, role).toBeLessThanOrEqual(120);
      expect(blurb.length, role).toBeGreaterThan(20);
      expect(blurb.endsWith("."), role).toBe(true);
    }
  });

  it("offers hire tokens the engine actually accepts", () => {
    for (const role of ROLES) {
      const before = makeState({ stage: "growth", cash: 1_000_000, team: team({ engineering: 1 }) });
      const result = executeCommand(before, `hire ${ROLE_HIRE_TOKENS[role]} 1`);
      expect(result.sound, role).toBe("success");
      expect(result.state.team[role], role).toBe(before.team[role] + 1);
    }
  });
});

// The blurbs are promises to the player. Each test below holds one promise up
// against the real engine, so a rebalance that breaks a promise fails here.
describe("role blurbs are true to the engine", () => {
  const SEEDS = 400;
  const seedAt = (i: number): number => mix32(i + 1) || 1;

  const shipWins = (roster: TeamRoster, extra: Partial<GameState> = {}): number => {
    let wins = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      if (shipFeature(makeState({ team: roster, rng: seedAt(i), ...extra }), "feature").sound === "success") wins += 1;
    }
    return wins;
  };

  const launchWins = (roster: TeamRoster): number => {
    let wins = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      if (launchCampaign(makeState({ team: roster, rng: seedAt(i) }), "campaign").sound === "success") wins += 1;
    }
    return wins;
  };

  /** Users gained by one successful launch, using a seed on which the smaller team already succeeds. */
  const launchUsers = (roster: TeamRoster, baseline: TeamRoster): number => {
    for (let i = 0; i < SEEDS; i += 1) {
      const state = makeState({ team: baseline, rng: seedAt(i) });
      if (launchCampaign(state, "campaign").sound !== "success") continue;
      const result = launchCampaign(makeState({ team: roster, rng: seedAt(i) }), "campaign");
      return result.state.users - state.users;
    }
    throw new Error("no successful launch found");
  };

  /** Users after one quiet week (no volatility, so the only difference is the team). */
  const usersAfterWeek = (roster: TeamRoster): number =>
    endWeekTick(makeState({ team: roster, users: 100_000, mrr: 1_000_000, volatility: 0, cash: 50_000_000, lastWeek: { users: 100_000, mrr: 1_000_000, cash: 50_000_000, teamSize: 1 } })).state.users;

  it("engineering: better ship odds, more reputation per ship, more growth", () => {
    expect(shipWins(team({ engineering: 5 }))).toBeGreaterThan(shipWins(team({ engineering: 1 })) + 20);

    // Find a seed where the small team ships, then compare the reputation earned.
    let compared = 0;
    for (let i = 0; i < SEEDS && compared < 5; i += 1) {
      const small = shipFeature(makeState({ team: team({ engineering: 1 }), rng: seedAt(i), reputation: 20 }), "feature");
      if (small.sound !== "success") continue;
      const big = shipFeature(makeState({ team: team({ engineering: 6 }), rng: seedAt(i), reputation: 20 }), "feature");
      expect(big.sound).toBe("success");
      expect(big.state.reputation).toBeGreaterThan(small.state.reputation);
      compared += 1;
    }
    expect(compared).toBe(5);
    expect(usersAfterWeek(team({ engineering: 6 }))).toBeGreaterThan(usersAfterWeek(team({ engineering: 1 })));
  });

  it("design: build capacity stops go-to-market from outrunning delivery", () => {
    const lopsided = team({ engineering: 1, marketing: 3, sales: 3 });
    const balanced = team({ engineering: 1, marketing: 3, sales: 3, design: 5 });
    expect(shipWins(balanced)).toBeGreaterThan(shipWins(lopsided) + 10);
    expect(usersAfterWeek(balanced)).toBeGreaterThan(usersAfterWeek(lopsided));
    // …and with nothing to balance, a designer changes neither.
    expect(shipWins(team({ engineering: 2, design: 4 }))).toBe(shipWins(team({ engineering: 2 })));
  });

  it("product: +2.5% ship success each", () => {
    const without = shipWins(team({ engineering: 1 }), { stage: "series-a" });
    const withFour = shipWins(team({ engineering: 1, product: 4 }), { stage: "series-a" });
    // Four product managers are worth ten points of ship odds: about 40 of 400 seeds.
    expect(withFour - without).toBeGreaterThan(20);
    expect(withFour - without).toBeLessThan(65);
  });

  it("data: the strongest retention hire", () => {
    const base = usersAfterWeek(team({ engineering: 1 }));
    const gainFrom = (role: TeamRole): number => usersAfterWeek(team({ engineering: 1, [role]: 1 })) - base;
    expect(gainFrom("data")).toBeGreaterThan(0);
    for (const role of ["engineering", "ops", "legal", "design", "product", "hr", "executive"] as TeamRole[]) {
      expect(gainFrom("data"), `data vs ${role}`).toBeGreaterThan(gainFrom(role));
    }
  });

  it("marketing and sales: launch odds, users per launch and weekly growth — marketing the most", () => {
    const base = team({ engineering: 3, ops: 3 });
    const withMarketing = team({ engineering: 3, ops: 3, marketing: 3 });
    const withSales = team({ engineering: 3, ops: 3, sales: 3 });

    expect(launchWins(withMarketing)).toBeGreaterThan(launchWins(withSales));
    expect(launchWins(withSales)).toBeGreaterThan(launchWins(base) + 10);

    expect(launchUsers(withMarketing, base)).toBeGreaterThan(launchUsers(withSales, base));
    expect(launchUsers(withSales, base)).toBeGreaterThan(launchUsers(base, base));

    expect(usersAfterWeek(withMarketing)).toBeGreaterThan(usersAfterWeek(base));
    expect(usersAfterWeek(withSales)).toBeGreaterThan(usersAfterWeek(base));
  });

  it("ops: retention, growth, build capacity, and cheaper go-to-market", () => {
    expect(usersAfterWeek(team({ engineering: 1, ops: 3 }))).toBeGreaterThan(usersAfterWeek(team({ engineering: 1 })));
    // Build capacity: ops offsets a go-to-market-heavy team when shipping.
    expect(shipWins(team({ engineering: 1, marketing: 3, sales: 3, ops: 5 }))).toBeGreaterThan(
      shipWins(team({ engineering: 1, marketing: 3, sales: 3 })) + 10
    );
    // Burn: an ops hire costs less on top of a sales-and-marketing team than on its own.
    const burn = (roster: TeamRoster): number => calcBurn(makeState({ team: roster }));
    const costAlone = burn(team({ engineering: 1, ops: 1 })) - burn(team({ engineering: 1 }));
    const costWithGtm = burn(team({ engineering: 1, marketing: 2, sales: 2, ops: 1 })) - burn(team({ engineering: 1, marketing: 2, sales: 2 }));
    expect(costWithGtm).toBeLessThan(costAlone);
  });

  it("hr: cleaner people crises, slightly slower everything else", () => {
    const complaint = eventPool.find((event) => event.id === "employee-complaint");
    const investigate = complaint?.choices.find((choice) => choice.id === "investigate");
    expect(investigate).toBeDefined();
    const withHr = investigate!.apply(makeState({ team: team({ engineering: 5, hr: 1 }) }), makeCtx()).state;
    const withoutHr = investigate!.apply(makeState({ team: team({ engineering: 5 }) }), makeCtx()).state;
    expect(withHr.culture.morale).toBeGreaterThan(withoutHr.culture.morale);
    expect(withHr.culture.cohesion).toBeGreaterThan(withoutHr.culture.cohesion);
    expect(withHr.reputation).toBeGreaterThan(withoutHr.reputation);

    expect(shipWins(team({ engineering: 2, hr: 4 }))).toBeLessThan(shipWins(team({ engineering: 2 })));
    expect(launchWins(team({ engineering: 2, hr: 6 }))).toBeLessThan(launchWins(team({ engineering: 2 })));
    expect(usersAfterWeek(team({ engineering: 1, hr: 3 }))).toBeLessThan(usersAfterWeek(team({ engineering: 1 })));
  });

  it("legal: small boosts all round, and legal scares cost far less", () => {
    expect(shipWins(team({ engineering: 2, legal: 5 }))).toBeGreaterThan(shipWins(team({ engineering: 2 })));
    expect(launchWins(team({ engineering: 2, legal: 5 }))).toBeGreaterThan(launchWins(team({ engineering: 2 })));
    expect(usersAfterWeek(team({ engineering: 1, legal: 3 }))).toBeGreaterThan(usersAfterWeek(team({ engineering: 1 })));

    const letter = eventPool.find((event) => event.id === "cease-and-desist");
    const respond = letter?.choices.find((choice) => choice.id === "lawyer-up");
    expect(respond).toBeDefined();
    const before = makeState({ cash: 100_000 });
    const costWith = before.cash - respond!.apply({ ...before, team: team({ engineering: 1, legal: 1 }) }, makeCtx()).state.cash;
    const costWithout = before.cash - respond!.apply({ ...before, team: team({ engineering: 1 }) }, makeCtx()).state.cash;
    expect(costWith).toBeGreaterThan(0);
    expect(costWithout).toBeGreaterThan(costWith * 3);
  });

  it("executive: 5% off stage overhead each, up to 15%", () => {
    const burn = (executives: number): number => calcBurn(makeState({ stage: "growth", team: team({ engineering: 1, executive: executives }) }));
    const first = burn(1) - burn(0);
    const second = burn(2) - burn(1);
    const third = burn(3) - burn(2);
    const fourth = burn(4) - burn(3);
    // The first three each save the same slice of overhead; the fourth saves nothing more.
    expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
    expect(Math.abs(second - third)).toBeLessThanOrEqual(1);
    expect(fourth).toBeGreaterThan(first);
    // Growth-stage overhead is $18,000 less the 20% stage perk; 5% of that is $720, before burn multipliers.
    expect(fourth - first).toBeGreaterThan(720 * 0.9);
    expect(fourth - first).toBeLessThan(720 * 1.4);
  });
});
