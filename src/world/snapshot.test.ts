import { describe, expect, it } from "vitest";
import type { GameState, TeamRole, TeamRoster } from "../types/game";
import { createInitialState, executeCommand } from "../engine";
import { calcNetBurn, calcRunwayWeeks } from "../engine/economy";
import { makeState } from "../engine/testHelpers";
import { hashText32, mix32 } from "./hash";
import { employeeName } from "./names";
import {
  COFOUNDER_ID,
  FOUNDER_ID,
  MAX_WORLD_PEOPLE,
  ROLE_ORDER,
  buildWorldSnapshot,
  employeeId,
  headcount,
  parseEmployeeId,
} from "./snapshot";

const emptyTeam = (): TeamRoster => ({
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
});

const team = (counts: Partial<TeamRoster>): TeamRoster => ({ ...emptyTeam(), ...counts });

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

/** Run terminal commands against the real engine, the way the store does. */
const play = (state: GameState, ...commands: string[]): GameState =>
  commands.reduce((current, command) => executeCommand(current, command).state, state);

describe("ROLE_ORDER", () => {
  it("lists every role exactly once", () => {
    const roles = Object.keys(emptyTeam()).sort();
    expect([...ROLE_ORDER].sort()).toEqual(roles);
    expect(new Set(ROLE_ORDER).size).toBe(ROLE_ORDER.length);
  });
});

describe("employee ids", () => {
  it("round-trips role and index", () => {
    for (const role of ROLE_ORDER) {
      expect(parseEmployeeId(employeeId(role, 0))).toEqual({ role, index: 0 });
      expect(parseEmployeeId(employeeId(role, 41))).toEqual({ role, index: 41 });
    }
    expect(employeeId("engineering", 3)).toBe("engineering-3");
  });

  it("rejects ids that are not employees", () => {
    for (const id of [FOUNDER_ID, COFOUNDER_ID, "", "engineering", "engineering-", "engineering-x", "wizard-2", "-3", "hr-1.5", "hr--1"]) {
      expect(parseEmployeeId(id), id).toBeNull();
    }
  });
});

describe("headcount", () => {
  it("floors fractional counts and never goes negative", () => {
    expect(headcount(team({ engineering: 3.9 }), "engineering")).toBe(3);
    expect(headcount(team({ engineering: -2 }), "engineering")).toBe(0);
    expect(headcount(team({ engineering: Number.NaN }), "engineering")).toBe(0);
    expect(headcount(team({ engineering: Infinity }), "engineering")).toBe(0);
    expect(headcount(team({ sales: 7 }), "sales")).toBe(7);
  });
});

describe("buildWorldSnapshot", () => {
  it("projects the scalar state faithfully", () => {
    const state = makeState({
      week: 12,
      ap: 2,
      cash: 54_321,
      valuation: 9_000_000,
      users: 4_200,
      mrr: 42_000,
      pricingModel: "enterprise",
      burn: 12_000,
      reputation: 61,
      stress: 44,
      volatility: 37,
      culture: { cohesion: 58, morale: 71 },
      stage: "seed",
      companyPhase: "coworking",
      companyName: "Initech",
      seed: 987_654,
    });
    const snapshot = buildWorldSnapshot(state);

    expect(snapshot.runId).toBe(987_654);
    expect(snapshot.companyName).toBe("Initech");
    expect(snapshot.founderName).toBe("Test Founder");
    expect(snapshot.founderArchetype).toBe("hacker");
    expect(snapshot.cofounderArchetype).toBe("operator");
    expect(snapshot.week).toBe(12);
    expect(snapshot.ap).toBe(2);
    expect(snapshot.phase).toBe("coworking");
    expect(snapshot.stage).toBe("seed");
    expect(snapshot.cash).toBe(54_321);
    expect(snapshot.valuation).toBe(9_000_000);
    expect(snapshot.users).toBe(4_200);
    expect(snapshot.mrr).toBe(42_000);
    expect(snapshot.pricingModel).toBe("enterprise");
    expect(snapshot.reputation).toBe(61);
    expect(snapshot.morale).toBe(71);
    expect(snapshot.cohesion).toBe(58);
    expect(snapshot.stress).toBe(44);
    expect(snapshot.volatility).toBe(37);
    expect(snapshot.netBurn).toBe(calcNetBurn(state));
    expect(snapshot.netBurn).toBe(12_000 - 10_500);
    expect(snapshot.runwayWeeks).toBe(calcRunwayWeeks(state));
    expect(snapshot.pendingEventTitle).toBeNull();
    expect(snapshot.gameOver).toBeNull();
  });

  it("reports 999 weeks of runway when the company is profitable", () => {
    const snapshot = buildWorldSnapshot(makeState({ burn: 1_000, mrr: 40_000 }));
    expect(snapshot.netBurn).toBeLessThanOrEqual(0);
    expect(snapshot.runwayWeeks).toBe(999);
  });

  it("reports the effective AP cap, including archetype and stage bonuses", () => {
    expect(buildWorldSnapshot(makeState()).maxAp).toBe(3);
    expect(buildWorldSnapshot(makeState({ founder: { name: "P", archetype: "philosopher" } })).maxAp).toBe(4);
    expect(buildWorldSnapshot(makeState({ stage: "series-a" })).maxAp).toBe(4);
    expect(buildWorldSnapshot(makeState({ stage: "growth", founder: { name: "P", archetype: "philosopher" } })).maxAp).toBe(5);
  });

  it("copies the team instead of aliasing engine state", () => {
    const state = makeState({ team: team({ engineering: 2, sales: 1 }) });
    const snapshot = buildWorldSnapshot(state);
    expect(snapshot.team).toEqual(state.team);
    expect(snapshot.team).not.toBe(state.team);
    expect(snapshot.teamSize).toBe(3);
  });

  describe("setup", () => {
    it("is incomplete on a fresh run and shows no cofounder yet", () => {
      const snapshot = buildWorldSnapshot(createInitialState());
      expect(snapshot.setupComplete).toBe(false);
      expect(snapshot.founderName).toBe("");
      expect(snapshot.founderArchetype).toBeNull();
      expect(snapshot.cofounderArchetype).toBeNull();
      expect(snapshot.people[0]).toMatchObject({ id: "founder", kind: "founder", role: null, name: "Founder" });
      expect(snapshot.people.some((person) => person.kind === "cofounder")).toBe(false);
      // The engine starts every run with one engineer already on the payroll.
      expect(snapshot.people.map((person) => person.id)).toEqual(["founder", "engineering-0"]);
    });

    it("completes only when name, company, founder and cofounder are all chosen", () => {
      let state = createInitialState();
      const steps = ["name Ada", "company Analytical Engines", "founder hacker", "cofounder builder"];
      for (const [index, command] of steps.entries()) {
        expect(buildWorldSnapshot(state).setupComplete, `before "${command}"`).toBe(false);
        state = play(state, command);
        expect(buildWorldSnapshot(state).setupComplete).toBe(index === steps.length - 1);
      }
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.founderName).toBe("Ada");
      expect(snapshot.companyName).toBe("Analytical Engines");
      expect(snapshot.founderArchetype).toBe("hacker");
      expect(snapshot.cofounderArchetype).toBe("builder");
      expect(snapshot.people.slice(0, 2).map((person) => person.id)).toEqual(["founder", "cofounder"]);
      expect(snapshot.people[0].name).toBe("Ada");
      // The engine names the cofounder when the archetype is picked.
      expect(snapshot.people[1]).toMatchObject({ kind: "cofounder", role: null, name: state.cofounder.name });
      expect(state.cofounder.name).not.toBe("Cofounder");
    });

    it("treats a whitespace-only name as not set", () => {
      const snapshot = buildWorldSnapshot(makeState({ founder: { name: "   ", archetype: "hacker" } }));
      expect(snapshot.setupComplete).toBe(false);
      expect(snapshot.people[0].name).toBe("Founder");
    });

    it("falls back to a generic cofounder name if the engine's is blank", () => {
      const state = makeState({ cofounder: { name: "", archetype: "operator", trust: 50, ego: 50, ambition: 50 } });
      expect(buildWorldSnapshot(state).people[1].name).toBe("Cofounder");
    });
  });

  describe("people", () => {
    it("lists founder, cofounder, then employees grouped by role in ROLE_ORDER", () => {
      const state = makeState({
        team: team({ executive: 1, legal: 1, sales: 2, engineering: 3, design: 1, data: 2, product: 1, marketing: 1, ops: 1, hr: 1 }),
      });
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.people.map((person) => person.id)).toEqual([
        "founder",
        "cofounder",
        "engineering-0",
        "engineering-1",
        "engineering-2",
        "design-0",
        "product-0",
        "data-0",
        "data-1",
        "marketing-0",
        "sales-0",
        "sales-1",
        "ops-0",
        "hr-0",
        "legal-0",
        "executive-0",
      ]);
      expect(snapshot.hiddenPeople).toBe(0);
      expect(snapshot.teamSize).toBe(14);
      for (const person of snapshot.people.slice(2)) {
        expect(person.kind).toBe("employee");
        expect(parseEmployeeId(person.id)?.role).toBe(person.role);
      }
    });

    it("names employees from the run seed and gives everyone a well-mixed uint32 look", () => {
      const state = makeState({ seed: 4242, team: team({ engineering: 2, hr: 1 }) });
      const snapshot = buildWorldSnapshot(state);
      const byId = new Map(snapshot.people.map((person) => [person.id, person]));

      expect(byId.get("engineering-1")?.name).toBe(employeeName(4242, "engineering", 1).full);
      expect(byId.get("hr-0")?.name).toBe(employeeName(4242, "hr", 0).full);
      for (const person of snapshot.people) {
        expect(Number.isInteger(person.look)).toBe(true);
        expect(person.look).toBeGreaterThanOrEqual(0);
        expect(person.look).toBeLessThanOrEqual(0xffffffff);
        expect(person.look).toBe(hashText32(4242, person.id));
      }
    });

    it("keeps everyone's id, name and look when somebody else is hired", () => {
      const before = buildWorldSnapshot(makeState({ team: team({ engineering: 2, design: 1, sales: 1 }) }));
      const after = buildWorldSnapshot(makeState({ team: team({ engineering: 3, design: 1, sales: 1, product: 2 }) }));
      const afterById = new Map(after.people.map((person) => [person.id, person]));
      for (const person of before.people) {
        expect(afterById.get(person.id), person.id).toEqual(person);
      }
      expect(after.people.length).toBe(before.people.length + 3);
    });

    it("gives a different cast to a different run", () => {
      const roster = team({ engineering: 6, design: 3, marketing: 3 });
      const a = buildWorldSnapshot(makeState({ seed: 1, team: roster }));
      const b = buildWorldSnapshot(makeState({ seed: 2, team: roster }));
      expect(a.people.map((person) => person.id)).toEqual(b.people.map((person) => person.id));
      expect(a.people.map((person) => person.name).slice(2)).not.toEqual(b.people.map((person) => person.name).slice(2));
      expect(a.people.map((person) => person.look)).not.toEqual(b.people.map((person) => person.look));
    });

    it("gives everyone in a full office a distinct name and look", () => {
      const snapshot = buildWorldSnapshot(
        makeState({ team: team({ engineering: 12, design: 6, product: 5, data: 5, marketing: 8, sales: 8, ops: 6, hr: 4, legal: 4, executive: 4 }) })
      );
      expect(snapshot.people).toHaveLength(MAX_WORLD_PEOPLE);
      expect(new Set(snapshot.people.map((person) => person.name)).size).toBe(MAX_WORLD_PEOPLE);
      expect(new Set(snapshot.people.map((person) => person.look)).size).toBe(MAX_WORLD_PEOPLE);
      expect(new Set(snapshot.people.map((person) => person.id)).size).toBe(MAX_WORLD_PEOPLE);
    });

    it("spreads looks evenly over all 32 bits", () => {
      const ids = ["founder", "cofounder"];
      for (const role of ROLE_ORDER) for (let i = 0; i < 40; i += 1) ids.push(employeeId(role, i));
      const set = new Array<number>(32).fill(0);
      for (const id of ids) {
        const look = hashText32(77, id);
        for (let bit = 0; bit < 32; bit += 1) if ((look >>> bit) & 1) set[bit] += 1;
      }
      // Every bit should be on for roughly half of the 402 ids.
      for (const count of set) {
        expect(count / ids.length).toBeGreaterThan(0.38);
        expect(count / ids.length).toBeLessThan(0.62);
      }
      // …and neighbouring ids must not look alike: at least a quarter of the bits differ.
      const differing = (a: number, b: number): number => {
        let x = (a ^ b) >>> 0;
        let bits = 0;
        while (x) {
          bits += x & 1;
          x >>>= 1;
        }
        return bits;
      };
      for (let i = 0; i < 30; i += 1) {
        expect(differing(hashText32(77, employeeId("engineering", i)), hashText32(77, employeeId("engineering", i + 1)))).toBeGreaterThanOrEqual(8);
        expect(differing(hashText32(i, "founder"), hashText32(i + 1, "founder"))).toBeGreaterThanOrEqual(8);
      }
      expect(mix32(0)).toBe(0);
      expect(mix32(1)).not.toBe(1);
    });
  });

  describe("the people cap", () => {
    it("caps people at MAX_WORLD_PEOPLE and counts the rest as hidden", () => {
      expect(MAX_WORLD_PEOPLE).toBe(64);
      const state = makeState({ team: team({ engineering: 40, design: 10, sales: 30, executive: 5 }) });
      const snapshot = buildWorldSnapshot(state);

      expect(snapshot.people).toHaveLength(64);
      expect(snapshot.hiddenPeople).toBe(85 - 62);
      expect(snapshot.teamSize).toBe(85);
      expect(snapshot.team.sales).toBe(30);
      // Canonical order decides who is visible: all engineers and designers, the first 12 in sales, no executives.
      const ids = snapshot.people.map((person) => person.id);
      expect(ids[2]).toBe("engineering-0");
      expect(ids[41]).toBe("engineering-39");
      expect(ids[42]).toBe("design-0");
      expect(ids[52]).toBe("sales-0");
      expect(ids[63]).toBe("sales-11");
      expect(ids).not.toContain("sales-12");
      expect(ids).not.toContain("executive-0");
    });

    it("leaves room for one more employee before the cofounder exists", () => {
      const state = makeState({
        team: team({ engineering: 70 }),
        cofounder: { name: "Cofounder", archetype: null, trust: 50, ego: 50, ambition: 50 },
      });
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.people).toHaveLength(64);
      expect(snapshot.people[63].id).toBe("engineering-62");
      expect(snapshot.hiddenPeople).toBe(7);
    });

    it("stays fast and correct for absurd head counts", () => {
      const state = makeState({ team: team({ engineering: 2_000_000_000, legal: 1e15 }) });
      const started = performance.now();
      const snapshot = buildWorldSnapshot(state);
      expect(performance.now() - started).toBeLessThan(50);
      expect(snapshot.people).toHaveLength(64);
      expect(snapshot.hiddenPeople).toBe(2_000_000_000 - 62 + 1e15);
    });

    it("ignores the fractional part of a head count", () => {
      // `hire eng 1.5` is accepted by the engine and leaves 2.5 engineers on the books.
      const state = play(makeState({ cash: 1_000_000 }), "hire eng 1.5");
      expect(state.team.engineering).toBe(2.5);
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.people.filter((person) => person.role === "engineering").map((person) => person.id)).toEqual([
        "engineering-0",
        "engineering-1",
      ]);
      expect(snapshot.hiddenPeople).toBe(0);
    });
  });

  describe("assets", () => {
    it("lists owned assets in purchase order and what the phase puts on sale", () => {
      const garage = buildWorldSnapshot(makeState({ companyPhase: "garage" }));
      expect(garage.ownedAssets).toEqual([]);
      expect(garage.availableAssets).toEqual([]);

      const coworking = buildWorldSnapshot(makeState({ companyPhase: "coworking" }));
      expect(coworking.availableAssets).toEqual(["office-upgrade"]);

      const office = buildWorldSnapshot(
        makeState({
          companyPhase: "office",
          assets: [
            { id: "helicopter", name: "Company Helicopter", purchaseWeek: 9 },
            { id: "office-upgrade", name: "Office Upgrade", purchaseWeek: 4 },
          ],
        })
      );
      expect(office.ownedAssets).toEqual(["helicopter", "office-upgrade"]);
      expect(office.availableAssets).toEqual(["lounge"]);

      const publicCo = buildWorldSnapshot(makeState({ companyPhase: "public" }));
      expect([...publicCo.availableAssets].sort()).toEqual(["helicopter", "jet", "lounge", "office-upgrade", "yacht"]);
    });

    it("keeps showing assets the company can no longer buy after falling back a phase", () => {
      const fallen = buildWorldSnapshot(
        makeState({ companyPhase: "garage", assets: [{ id: "jet", name: "Private Jet", purchaseWeek: 30 }] })
      );
      expect(fallen.ownedAssets).toEqual(["jet"]);
      expect(fallen.availableAssets).toEqual([]);
    });

    it("picks up a real purchase", () => {
      const state = play(makeState({ companyPhase: "coworking", valuation: 6_000_000, users: 300, cash: 200_000 }), "buy office upgrade");
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.ownedAssets).toEqual(["office-upgrade"]);
      expect(snapshot.availableAssets).not.toContain("office-upgrade");
    });
  });

  it("surfaces the pending event and the ending", () => {
    const pending = buildWorldSnapshot(
      makeState({ pendingEvent: { id: "poached", title: "Poached", prompt: "…", choices: [{ id: "counter", text: "Counter" }] } })
    );
    expect(pending.pendingEventTitle).toBe("Poached");

    const over = buildWorldSnapshot(makeState({ gameOver: { ending: "bankruptcy", week: 20, headline: "Bankrupt." } }));
    expect(over.gameOver).toBe("bankruptcy");
  });

  describe("purity", () => {
    it("returns structurally equal output for identical state", () => {
      const state = makeState({ team: team({ engineering: 5, marketing: 2 }), seed: 31337 });
      const first = buildWorldSnapshot(state);
      expect(buildWorldSnapshot(state)).toEqual(first);
      expect(buildWorldSnapshot(structuredClone(state))).toEqual(first);
      expect(JSON.stringify(buildWorldSnapshot(structuredClone(state)))).toBe(JSON.stringify(first));
    });

    it("never mutates the state it reads", () => {
      const state = deepFreeze(makeState({ team: team({ engineering: 3 }), assets: [{ id: "lounge", name: "Executive Lounge", purchaseWeek: 2 }] }));
      expect(() => buildWorldSnapshot(state)).not.toThrow();
    });

    it("reflects in-place edits on the next call (no hidden cache)", () => {
      const state = makeState({ cash: 10 });
      expect(buildWorldSnapshot(state).cash).toBe(10);
      state.cash = 20;
      state.team.design = 2;
      const snapshot = buildWorldSnapshot(state);
      expect(snapshot.cash).toBe(20);
      expect(snapshot.people.map((person) => person.id)).toContain("design-1");
    });

    it("is plain serialisable data", () => {
      const snapshot = buildWorldSnapshot(makeState({ team: team({ engineering: 4, ops: 2 }) }));
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    });

    it("follows a real run from setup through hiring", () => {
      let state = play(createInitialState(), "seed test-run", "name Grace", "company Compilers Inc", "founder visionary", "cofounder operator");
      const start = buildWorldSnapshot(state);
      expect(start.setupComplete).toBe(true);
      expect(start.runId).toBe(state.seed);
      expect(start.people.map((person) => person.id)).toEqual(["founder", "cofounder", "engineering-0"]);

      state = play(state, "hire ux 1", "hire eng 2");
      const later = buildWorldSnapshot(state);
      expect(later.people.map((person) => person.id)).toEqual([
        "founder",
        "cofounder",
        "engineering-0",
        "engineering-1",
        "engineering-2",
        "design-0",
      ]);
      // The first engineer is still the same person.
      expect(later.people[2]).toEqual(start.people[2]);
      expect(later.ap).toBe(start.ap - 2);
      expect(later.cash).toBeLessThan(start.cash);
      const roles: Array<TeamRole | null> = later.people.map((person) => person.role);
      expect(roles).toEqual([null, null, "engineering", "engineering", "engineering", "design"]);
    });
  });
});
