import { describe, expect, it } from "vitest";
import type { BoardMember, Build, GameState, Release } from "../../types/game";
import { computeContext } from "../context";
import { makeBuild, makeState, makeTycoonState } from "../testHelpers";
import { eventPool } from "./pool";
import { tycoonEvents } from "./tycoonPool";

const IDS = ["scope-creep", "the-date", "post-mortem", "the-rewrite"];

const director = (id: string, role: BoardMember["role"], confidence = 50): BoardMember => ({
  id,
  name: id,
  role,
  personality: "operator",
  confidence,
});

const release = (overrides: Partial<Release> = {}): Release => ({
  id: "b1",
  name: "Atlas",
  type: "feature",
  size: "m",
  week: 9,
  reception: 31,
  tier: "flop",
  quality: 40,
  leadName: null,
  ...overrides,
});

const withProduct = (s: GameState, patch: Partial<NonNullable<GameState["product"]>>): GameState => ({
  ...s,
  product: { ...s.product!, ...patch },
});

/** A state on which every one of the four events is eligible. */
const engaged = (): GameState => {
  const base = makeTycoonState({
    week: 10,
    volatility: 0,
    team: { ...makeState().team, engineering: 4, sales: 2, product: 1 },
    board: { members: [director("f", "founder"), director("i1", "investor"), director("i2", "independent")], lastMeetingWeek: 0 },
  });
  const mid = makeBuild({ id: "b2", slug: "kale", name: "Kale", progress: 6, scope: 12, baseScope: 12 });
  const big = makeBuild({ id: "b3", slug: "atlas", name: "Atlas", size: "xl", units: 10, scope: 64, baseScope: 64, progress: 10, dueWeek: 20 });
  return withProduct(base, { active: [mid, big], shipped: [release()], shippedCount: 1, cruft: 42, nextId: 4 });
};

const byId = (id: string) => {
  const def = tycoonEvents.find((e) => e.id === id);
  if (!def) throw new Error(`missing ${id}`);
  return def;
};

describe("tycoon events: legacy play never sees them", () => {
  it("are the last four entries of eventPool, in order", () => {
    expect(tycoonEvents.map((e) => e.id)).toEqual(IDS);
    expect(eventPool.slice(-4).map((e) => e.id)).toEqual(IDS);
    expect(eventPool.slice(0, -4).some((e) => IDS.includes(e.id))).toBe(false);
  });

  it("every `when` is false on a slice-less state, whatever its team or board", () => {
    const s = makeState({
      week: 40,
      team: { ...makeState().team, engineering: 30, sales: 10, product: 4 },
      board: { members: [director("f", "founder"), director("a", "investor"), director("b", "investor")], lastMeetingWeek: 0 },
    });
    const ctx = computeContext(s);
    for (const def of tycoonEvents) expect(def.when(s, ctx), def.id).toBe(false);
  });

  it("every `when` is false with slices but no build, no release and cruft below 30", () => {
    for (const cruft of [0, 12.5, 29.9]) {
      const s = withProduct(makeTycoonState({ week: 30, team: { ...makeState().team, engineering: 9 } }), { cruft, moat: 20 });
      const ctx = computeContext(s);
      for (const def of tycoonEvents) expect(def.when(s, ctx), `${def.id} cruft ${cruft}`).toBe(false);
    }
  });
});

describe("tycoon events: eligibility", () => {
  it("scope-creep needs a build 20-80% done", () => {
    const def = byId("scope-creep");
    const s = engaged();
    expect(def.when(s, computeContext(s))).toBe(true);
    const early = withProduct(s, { active: [makeBuild({ progress: 1, scope: 12 })] });
    expect(def.when(early, computeContext(early))).toBe(false);
    const late = withProduct(s, { active: [makeBuild({ progress: 11, scope: 12 })] });
    expect(def.when(late, computeContext(late))).toBe(false);
  });

  it("the-date needs three directors and an unfinished L/XL build", () => {
    const def = byId("the-date");
    const s = engaged();
    expect(def.when(s, computeContext(s))).toBe(true);
    const twoDirectors = { ...s, board: { ...s.board, members: s.board.members.slice(0, 2) } };
    expect(def.when(twoDirectors, computeContext(twoDirectors))).toBe(false);
    const onlyM = withProduct(s, { active: [makeBuild({ progress: 6 })] });
    expect(def.when(onlyM, computeContext(onlyM))).toBe(false);
  });

  it("post-mortem follows a flop from this week or last only", () => {
    const def = byId("post-mortem");
    const s = engaged();
    expect(def.when(s, computeContext(s))).toBe(true);
    const old = withProduct(s, { shipped: [release({ week: 8 })] });
    expect(def.when(old, computeContext(old))).toBe(false);
    const solid = withProduct(s, { shipped: [release({ tier: "solid", reception: 70 })] });
    expect(def.when(solid, computeContext(solid))).toBe(false);
  });

  it("the-rewrite needs cruft 30+ and two engineers, and weighs more with more cruft", () => {
    const def = byId("the-rewrite");
    const s = engaged();
    expect(def.when(s, computeContext(s))).toBe(true);
    expect(def.weight(s, computeContext(s))).toBeCloseTo(4 + 4.2);
    const oneEng = { ...s, team: { ...s.team, engineering: 1 } };
    expect(def.when(oneEng, computeContext(oneEng))).toBe(false);
  });
});

describe("tycoon events: every choice", () => {
  /** Each choice on the engaged state and on a state whose builds are gone. */
  const cases = tycoonEvents.flatMap((def) => def.choices.map((choice) => ({ def, choice })));

  it.each(cases.map((c) => [`${c.def.id}/${c.choice.id}`, c] as const))("%s applies cleanly, draws nothing, stays JSON", (_name, { choice }) => {
    for (const s of [engaged(), withProduct(engaged(), { active: [] })]) {
      const before = JSON.stringify(s);
      const out = choice.apply(s, computeContext(s));
      expect(JSON.stringify(s)).toBe(before); // input untouched
      expect(out.logs.length).toBeGreaterThan(0);
      expect(out.state.rng).toBe(s.rng);
      expect(out.state.people?.rng).toBe(s.people?.rng);
      expect(out.state.product?.rng).toBe(s.product?.rng);
      expect(JSON.parse(JSON.stringify(out.state))).toEqual(out.state);
      const p = out.state.product!;
      expect(p.cruft).toBeGreaterThanOrEqual(0);
      expect(p.cruft).toBeLessThanOrEqual(100);
      expect(out.state.cash).toBeGreaterThanOrEqual(0);
    }
  });

  it("take-it grows the mid-flight build: scope +20% of base, impact +15%, cohesion -1", () => {
    const s = engaged();
    const out = byId("scope-creep").choices[0].apply(s, computeContext(s));
    const kale = out.state.product!.active.find((b: Build) => b.id === "b2")!;
    expect(kale.scope).toBe(14.4);
    expect(kale.units).toBe(2.9);
    expect(out.state.culture.cohesion).toBe(s.culture.cohesion - 1);
    expect(out.logs[1]).toContain("Kale: scope +2.4 pts");
  });

  it("take-it degrades to a harmless line when no build is mid-flight", () => {
    const s = withProduct(engaged(), { active: [] });
    const out = byId("scope-creep").choices[0].apply(s, computeContext(s));
    expect(out.state).toBe(s);
    expect(out.logs).toEqual(["The request evaporates. Nobody can remember who asked."]);
  });

  it("commit pulls the big build's date in by two weeks (never before this week) and moves only non-founder directors", () => {
    const s = engaged();
    const out = byId("the-date").choices[0].apply(s, computeContext(s));
    expect(out.state.product!.active.find((b: Build) => b.id === "b3")!.dueWeek).toBe(18);
    expect(out.state.board.members.map((m) => m.confidence)).toEqual([50, 54, 54]);
    const tight = withProduct(s, { active: [makeBuild({ id: "b3", size: "l", progress: 1, scope: 28, dueWeek: 11 })] });
    const out2 = byId("the-date").choices[0].apply(tight, computeContext(tight));
    expect(out2.state.product!.active[0].dueWeek).toBe(10);
  });

  it("the cleanup never drives cash below zero and pays cruft down", () => {
    const s = { ...engaged(), cash: 1000 };
    const out = byId("the-rewrite").choices[0].apply(s, computeContext(s));
    expect(out.state.cash).toBe(0);
    expect(out.state.product!.cruft).toBe(30);
    expect(out.logs[1]).toBe("Cash -$1,000 (all there was). Cruft -12. Morale +3.");
    const rich = { ...engaged(), cash: 50_000 };
    const paid = byId("the-rewrite").choices[0].apply(rich, computeContext(rich));
    expect(paid.state.cash).toBe(44_000);
    expect(paid.logs[1]).toBe("Cash -$6,000. Cruft -12. Morale +3.");
  });

  it("a cost never RAISES a negative balance (review: cash -$40,000 became $0, a $40,000 bailout; ERRATA 71)", () => {
    const broke = { ...engaged(), cash: -40_000 };
    for (const i of [0, 1]) {
      const out = byId("the-rewrite").choices[i].apply(broke, computeContext(broke));
      expect(out.state.cash).toBe(-40_000);
      expect(out.logs[1]).toMatch(/^No cash changes hands/);
    }
  });

  it("volatility scales the soft deltas like every other event", () => {
    const calm = engaged();
    const wild = { ...engaged(), volatility: 100 };
    const a = byId("post-mortem").choices[0].apply(calm, computeContext(calm));
    const b = byId("post-mortem").choices[0].apply(wild, computeContext(wild));
    expect(a.state.culture.cohesion - calm.culture.cohesion).toBe(3);
    expect(b.state.culture.cohesion - wild.culture.cohesion).toBe(9);
    expect(b.state.product!.cruft).toBe(39); // cruft is not scaled
  });
});
