import { describe, expect, it } from "vitest";
import type { GameState, TeamRoster } from "../../types/game";
import { calcBurn } from "../economy";
import { executeCommand } from "../commands";
import { makeBuild, makeEmployee, makeState } from "../testHelpers";
import { migrateState as migrateFromIndex, SAVE_VERSION as VERSION_FROM_INDEX } from "../index";
import { NAME_MAX, POLISH_MAX, QUIRKS, ROSTER_CAP, SURPRISE_MAX } from "./constants";
import { migrateState, normalizePeople, normalizeProduct, normalizeTycoon, SAVE_VERSION } from "./migrate";
import { countByRole, emptyPeople, emptyProduct, rosterInvariantHolds, rosterOf, serialOf } from "./roster";

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0,
  ...counts,
});

/** A state minus the slices the migration adds (the two tycoon slices and the story pack's slice). */
const strip = (s: GameState): Omit<GameState, "people" | "product" | "story"> => {
  const { people: _p, product: _q, story: _r, ...rest } = s;
  void _p; void _q; void _r;
  return rest;
};

/** I1–I4 on a normalised state. */
const assertValid = (s: GameState): void => {
  expect(rosterInvariantHolds(s)).toBe(true);
  const people = s.people!;
  const product = s.product!;
  const ids = new Set<string>();
  for (const e of people.roster) {
    expect(ids.has(e.id)).toBe(false);
    ids.add(e.id);
    expect(e.id).toMatch(/^e\d+$/);
    expect(people.nextId).toBeGreaterThan(serialOf(e.id));
    for (const v of [e.pace, e.craft]) expect(Number.isInteger(v) && v >= 1 && v <= 5).toBe(true);
    expect(Number.isInteger(e.energy) && e.energy >= 0 && e.energy <= 100).toBe(true);
    expect(Number.isFinite(e.salary) && e.salary > 0).toBe(true);
    expect(e.quirk === null || QUIRKS.includes(e.quirk)).toBe(true);
    expect(e.offerKind === null).toBe(e.offerDueWeek === 0);
    if (e.offerDueWeek === 0) expect(e.leadOnNotice).toBeNull();
    expect(e.joinedWeek === 0).toBe(e.buildId === null);
    if (e.buildId !== null) expect(e.engaged).toBe(true);
  }
  expect(people.roster.length).toBeLessThanOrEqual(ROSTER_CAP);
  for (const pool of Object.values(people.candidates)) {
    expect((pool ?? []).length).toBeLessThanOrEqual(3);
    for (const c of pool ?? []) {
      expect(c.claimedPace).toBeGreaterThanOrEqual(c.pace);
      expect(c.claimedCraft).toBeGreaterThanOrEqual(c.craft);
      if (c.vetted) expect([c.claimedPace, c.claimedCraft]).toEqual([c.pace, c.craft]);
      expect(Number.isFinite(c.ask) && c.ask > 0).toBe(true);
    }
  }
  expect(product.active.length).toBeLessThanOrEqual(3);
  const slugs = new Set<string>();
  for (const b of product.active) {
    expect(slugs.has(b.slug)).toBe(false);
    slugs.add(b.slug);
    expect(b.slug.length).toBeLessThanOrEqual(NAME_MAX);
    expect(b.scope).toBeGreaterThan(0);
    expect(b.progress).toBeGreaterThanOrEqual(0);
    expect(b.progress).toBeLessThanOrEqual(b.scope);
    expect(b.polish).toBeGreaterThanOrEqual(0);
    expect(b.polish).toBeLessThanOrEqual(POLISH_MAX);
    expect(b.surprises).toBeLessThanOrEqual(SURPRISE_MAX);
    if (b.qPts === 0) expect(b.qSum).toBe(0);
    if (b.progress >= b.scope) expect(b.crunch).toBe(false);
    else expect(b.readyWeek).toBe(0);
    expect(product.nextId).toBeGreaterThan(serialOf(b.id));
  }
  for (const r of product.shipped) expect(product.nextId).toBeGreaterThan(serialOf(r.id));
  expect(product.shipped.length).toBeLessThanOrEqual(12);
  expect(product.shippedCount).toBeGreaterThanOrEqual(product.shipped.length);
  for (const v of [product.cruft, product.moat]) expect(v >= 0 && v <= 100).toBe(true);
  expect(product.arpuCarry >= 0 && product.arpuCarry < 1).toBe(true);
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
};

describe("save migration v2 → v3", () => {
  const v2 = (): GameState => makeState({ week: 30, team: team({ engineering: 7, design: 2, marketing: 3, sales: 2.5, hr: 1 }), seed: 2024, rng: 99 });

  it("is exported from the engine barrel", () => {
    expect(SAVE_VERSION).toBe(3);
    expect(VERSION_FROM_INDEX).toBe(3);
    expect(migrateFromIndex).toBe(migrateState);
  });

  it("builds a roster from the heads and changes nothing that exists in a v2 state", () => {
    const old = v2();
    const m = migrateState(old, 2);
    expect(countByRole(rosterOf(m))).toMatchObject({ engineering: 7, design: 2, marketing: 3, sales: 2, hr: 1 });
    expect(rosterOf(m).every((e) => e.hiredWeek === 30 && e.energy === 100 && !e.engaged && e.buildId === null)).toBe(true);
    expect(strip(m)).toEqual(old);
    expect(calcBurn(m)).toBe(calcBurn(old));
    expect(m.product).toEqual(emptyProduct());
    expect(m.rng).toBe(old.rng);
    assertValid(m);
  });

  it("is idempotent and deterministic", () => {
    const once = migrateState(v2(), 2);
    expect(migrateState(once, 3)).toEqual(once);
    expect(migrateState(v2(), 2)).toEqual(once);
  });

  it("continues the run exactly as the v2 state would", () => {
    const old = v2();
    const m = migrateState(old, 2);
    for (const cmd of ["hire eng 1", "ship thing", "launch thing", "end"]) {
      const a = executeCommand(old, cmd);
      const b = executeCommand(m, cmd);
      expect(strip(b.state)).toEqual(strip(a.state));
    }
  });

  it("adds assets for a v1 save", () => {
    const { assets: _a, ...rest } = makeState();
    void _a;
    const m = migrateState(rest as GameState, 1);
    expect(m.assets).toEqual([]);
  });

  it("keeps a pending event and a finished run untouched", () => {
    const pending = makeState({ pendingEvent: { id: "x", title: "T", prompt: "P", choices: [{ id: "a", text: "A" }] } });
    expect(migrateState(pending, 2).pendingEvent).toEqual(pending.pendingEvent);
    const over = makeState({ gameOver: { ending: "bankruptcy", week: 9, headline: "Done" } });
    expect(strip(migrateState(over, 2))).toEqual(over);
  });
});

describe("normalizer", () => {
  const goodPeople = () => ({
    ...emptyPeople(),
    rng: 12345,
    nextId: 4,
    roster: [
      makeEmployee({ id: "e1", name: "A One", buildId: "b1", joinedWeek: 3, engaged: true, offerDueWeek: 12, offerKind: "recruiter", leadOnNotice: "b1" }),
      makeEmployee({ id: "e2", name: "B Two", role: "design", salary: 2800 }),
      makeEmployee({ id: "e3", name: "C Three", role: "marketing", salary: 2600, quirk: "glue" }),
    ],
    candidates: {
      engineering: [{ id: "c1", name: "Cand One", role: "engineering" as const, pace: 3, craft: 2, claimedPace: 4, claimedCraft: 2, quirk: null, vetted: false, ask: 3600 }],
    },
    candidatesWeek: 10,
    nextCandidateId: 2,
  });
  const goodProduct = () => ({
    ...emptyProduct(),
    rng: 777,
    nextId: 3,
    active: [makeBuild({ progress: 5, qSum: 300, qPts: 5 })],
    shipped: [{ id: "b2", name: "Kale", type: "growth" as const, size: "s" as const, week: 8, reception: 66, tier: "solid" as const, quality: 60, leadName: "A One" }],
    shippedCount: 1,
    shippedByType: { feature: 0, growth: 1, premium: 0, plumbing: 0, moonshot: 0 },
    cruft: 4.2,
    moat: 3.1,
  });
  const base = (): GameState => ({ ...makeState({ week: 10, team: team({ engineering: 1, design: 1, marketing: 1 }) }), people: goodPeople(), product: goodProduct() });

  it("keeps a valid v3 state exactly", () => {
    const s = base();
    const n = normalizeTycoon(s);
    expect(n.people).toEqual(s.people);
    expect(n.product).toEqual(s.product);
    assertValid(n);
  });

  it("turns anything at all into the empty slices", () => {
    for (const junk of [undefined, null, 3, "x", [], [1, 2], true]) {
      expect(normalizePeople(junk, 5)).toEqual(emptyPeople());
      expect(normalizeProduct(junk, 5)).toEqual(emptyProduct());
    }
  });

  it("survives every field of either slice replaced by junk, before and after a following `end`", () => {
    const JUNK: unknown[] = [null, Number.NaN, "str", [], [null, 1], {}, -5, 1e12, Number.POSITIVE_INFINITY];
    const s = base();
    const fieldsP = Object.keys(goodPeople());
    const fieldsQ = Object.keys(goodProduct());
    for (const junk of JUNK) {
      for (const f of fieldsP) {
        const n = normalizeTycoon({ ...s, people: { ...goodPeople(), [f]: junk } as never });
        assertValid(n);
        assertValid(executeCommand(n, "end").state);
      }
      for (const f of fieldsQ) {
        const n = normalizeTycoon({ ...s, product: { ...goodProduct(), [f]: junk } as never });
        assertValid(n);
        assertValid(executeCommand(n, "end").state);
      }
      for (const f of Object.keys(makeEmployee())) {
        const roster = goodPeople().roster.map((e, i) => (i === 0 ? { ...e, [f]: junk } : e));
        assertValid(normalizeTycoon({ ...s, people: { ...goodPeople(), roster } as never }));
      }
      for (const f of Object.keys(makeBuild())) {
        const active = [{ ...goodProduct().active[0], [f]: junk }];
        assertValid(normalizeTycoon({ ...s, product: { ...goodProduct(), active } as never }));
      }
    }
  });

  it("drops junk and duplicate entries, trims an oversized roster, and clamps a build past its scope", () => {
    const s = base();
    const roster = [
      ...goodPeople().roster,
      makeEmployee({ id: "e2", name: "Duplicate" }),
      { id: "zz", role: "engineering" },
      { id: "e50", role: "wizard" },
      42,
      null,
    ];
    const active = [
      makeBuild({ progress: 50, scope: 12, crunch: true, readyWeek: 0 }),
      makeBuild({ id: "b7", slug: "atlas" }),
      makeBuild({ id: "b8", slug: "Not A Slug" }),
      makeBuild({ id: "b9", slug: "x".repeat(30) }),
      makeBuild({ id: "b10", slug: "ok", type: "nope" as never }),
    ];
    const n = normalizeTycoon({ ...s, people: { ...goodPeople(), roster } as never, product: { ...goodProduct(), active } as never });
    assertValid(n);
    expect(rosterOf(n).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(n.product!.active).toHaveLength(1);
    expect(n.product!.active[0]).toMatchObject({ progress: 12, crunch: false, readyWeek: 10 });

    const big = Array.from({ length: 130 }, (_, i) => makeEmployee({ id: `e${i + 1}`, name: `P ${i}`, engaged: i >= 100 }));
    const capped = normalizeTycoon({ ...makeState({ week: 10, team: team({ engineering: 130 }) }), people: { ...emptyPeople(), roster: big }, product: emptyProduct() });
    assertValid(capped);
    expect(rosterOf(capped)).toHaveLength(ROSTER_CAP);
    expect(rosterOf(capped).filter((e) => e.engaged)).toHaveLength(30);
    expect(rosterOf(capped).some((e) => e.id === "e91")).toBe(false);
  });

  it("keeps product.nextId above every shipped serial (I3)", () => {
    const s = base();
    const n = normalizeTycoon({ ...s, product: { ...goodProduct(), nextId: 1, active: [], shipped: [{ ...goodProduct().shipped[0], id: "b41" }] } });
    expect(n.product!.nextId).toBe(42);
  });

  it("gives a v3 save from before leadOnNotice a null, and forces engaged for anyone on a build", () => {
    const { leadOnNotice: _l, ...old } = makeEmployee({ id: "e1", buildId: "b1", joinedWeek: 2, engaged: false });
    void _l;
    const n = normalizeTycoon({ ...base(), people: { ...goodPeople(), roster: [old, ...goodPeople().roster.slice(1)] } as never });
    expect(rosterOf(n)[0]).toMatchObject({ leadOnNotice: null, engaged: true, buildId: "b1", joinedWeek: 2 });
  });
});
