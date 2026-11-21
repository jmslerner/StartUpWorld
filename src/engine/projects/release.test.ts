import { describe, expect, it } from "vitest";
import type { Build, GameState } from "../../types/game";
import { productRng, rosterOf, setProduct } from "../tycoon/roster";
import { applyRelease, releaseBuild, rollLuck, scoreRelease } from "./release";
import type { ShopOptions } from "./testkit";
import { build, person, shop, staffed } from "./testkit";

/** A build at `progress` points of `scope`, all of it worked at `quality`. */
const worked = (quality: number, overrides: Partial<Build> = {}): Build => {
  const b = build(overrides);
  const progress = overrides.progress ?? b.scope;
  return { ...b, progress, qPts: progress, qSum: progress * quality };
};

const director = { id: "d1", name: "Vera", role: "investor" as const, personality: "activist" as const, confidence: 50 };

describe("worked example B: the S feature release (§5.8)", () => {
  const onboarding = worked(56, { id: "b1", name: "onboarding", slug: "onboarding", size: "s", units: 1, baseScope: 5, scope: 5, polish: 3, dueWeek: 5 });
  const s = shop({
    roster: staffed([person(1, { name: "Lotte Zhao", quirk: "cowboy" }), person(2, { name: "Mei Kowalski" })], "b1", 1),
    builds: [onboarding],
    week: 4,
    pricingModel: "prosumer",
    stress: 44,
    volatility: 22,
    users: 43,
    arpu: 10,
  });

  it("scores 59 x 1.00 + fit 6 − stress 3 + luck 6 = 68, SOLID, m = 0.76", () => {
    const score = scoreRelease(s, onboarding, 6);
    expect(score).toMatchObject({ quality: 59, fit: 6, stress: 3, late: 0, reception: 68, tier: "solid" });
    expect(score.m).toBeCloseTo(0.76, 10);
  });

  it("pays reputation +3, users +31, ARPU $0.152 banked, moat +1.5, cruft +1.2, morale +1; credits both, Mei led it", () => {
    const out = applyRelease(s, onboarding, scoreRelease(s, onboarding, 6));
    const n = out.state;
    expect(n.reputation).toBe(s.reputation + 3);
    expect(n.users).toBe(43 + 31);
    expect(n.arpu).toBe(10);
    expect(n.product?.arpuCarry).toBeCloseTo(0.152, 10);
    expect(n.product?.moat).toBe(1.5);
    expect(n.product?.cruft).toBe(1.2);
    expect(n.culture.morale).toBe(s.culture.morale + 1);
    expect(n.culture.cohesion).toBe(s.culture.cohesion + 1); // round(1 x 0.5) = 1 (0.5 rounds up)
    expect(n.mrr).toBe(74 * 10);
    const texts = out.lines.map((l) => l.text);
    expect(texts[0]).toBe("Shipping onboarding — Feature S, 100% built, quality 59.");
    expect(texts[2]).toBe("RECEPTION 68/100 — SOLID. Support tickets go down. Nobody can explain it. Nobody tries.");
    expect(texts[3]).toBe("  quality 59 x 1.00 complete · fit +6 · luck +6 · stress -3");
    expect(texts[4]).toBe("Reputation +3. Users +31. ARPU +$0.15 banked. Moat +1.5 → 1.5. Cruft +1.2 → 1.2. Morale +1. Cohesion +1.");
    expect(texts).toContain("Mei Kowalski led it. Recruiters have noticed.");
    expect(texts).toContain("Lotte Zhao and 1 other add a line to their LinkedIn. (Experience +1: they build better here now.)");
    expect(rosterOf(n).map((e) => [e.shipped, e.buildId, e.joinedWeek])).toEqual([[1, null, 0], [1, null, 0]]);
    expect(rosterOf(n).find((e) => e.id === "e2")?.ledWeek).toBe(4);
    expect(n.product?.active).toEqual([]);
    expect(n.product?.shipped[0]).toEqual({ id: "b1", name: "onboarding", type: "feature", size: "s", week: 4, reception: 68, tier: "solid", quality: 59, leadName: "Mei Kowalski" });
    expect(n.product?.shippedCount).toBe(1);
    expect(n.product?.shippedByType.feature).toBe(1);
    expect(out.sound).toBe("success");
  });
});

describe("worked example D: a premium tier on enterprise pricing", () => {
  const premium = worked(70, { type: "premium", size: "m", units: 2.5 });
  const d = (overrides: ShopOptions = {}) =>
    shop({
      builds: [premium],
      companyPhase: "coworking",
      stage: "seed",
      founder: { name: "F", archetype: "sales-animal" },
      pricingModel: "enterprise",
      arpu: 120,
      users: 400,
      mrr: 48_000,
      stress: 30,
      board: { members: [director], lastMeetingWeek: 0 },
      ...overrides,
    });

  it("reception 79, SOLID, m = 0.98; ARPU $130 with $0.64 carried; MRR $52,000; the rest of the payoff", () => {
    const s = d();
    const score = scoreRelease(s, premium, 0);
    expect(score).toMatchObject({ reception: 79, tier: "solid", fit: 11, stress: 2 });
    const out = applyRelease(s, premium, score);
    expect(out.state.arpu).toBe(130);
    expect(out.state.product?.arpuCarry).toBeCloseTo(0.64, 2);
    expect(out.state.mrr).toBe(52_000);
    expect(out.state.reputation).toBe(s.reputation + 2);
    expect(out.state.vcReputation).toBe(s.vcReputation + 1);
    expect(out.state.product?.moat).toBe(3.7);
    expect(out.state.product?.cruft).toBe(2.3);
    expect(out.state.culture.morale).toBe(s.culture.morale + 2);
    expect(out.state.culture.cohesion).toBe(s.culture.cohesion + 1);
    expect(out.state.board.members[0].confidence).toBe(51);
    expect(out.state.cofounder.trust).toBe(s.cofounder.trust + 1);
    expect(out.lines[4].text).toBe("Reputation +2. ARPU +$10 → $130. VC rep +1. Moat +3.7 → 3.7. Cruft +2.3 → 2.3. Morale +2. Cohesion +1. Board +1.");
  });

  it("the ARPU gain tapers to nothing near the model's max: $480 → $482", () => {
    const s = d({ arpu: 480 });
    const out = applyRelease(s, premium, scoreRelease(s, premium, 0));
    expect(out.state.arpu).toBe(482);
  });

  it("an XL premium at reception 100 is capped at +35% ARPU: $120 → $162", () => {
    const xl = worked(100, { type: "premium", size: "xl", units: 10, scope: 64, baseScope: 64, polish: 9 });
    const s = d({ builds: [xl] });
    const score = { ...scoreRelease(s, xl, 0), reception: 100, tier: "breakout" as const, m: 1.4 };
    expect(applyRelease(s, xl, score).state.arpu).toBe(162);
  });

  it("on consumer pricing the same build fits −6 and earns half the ARPU", () => {
    const s = d({ pricingModel: "consumer", arpu: 10 });
    expect(scoreRelease(s, premium, 0).fit).toBe(-6 + 4 + 3);
    const score = { ...scoreRelease(s, premium, 0), reception: 79, tier: "solid" as const, m: 0.98 };
    const out = applyRelease(s, premium, score);
    // headroom (25 − 10) / (25 − 5) = 0.75; 0.04 x 2.5 x 0.98 x 0.5 x 0.75 = 3.675% of $10
    expect(out.state.product?.arpuCarry).toBeCloseTo(10 * 0.04 * 2.5 * 0.98 * 0.5 * 0.75, 10);
  });
});

describe("payoff caps", () => {
  const big = (type: Build["type"]) => worked(100, { type, size: "xl", units: 10, scope: 64, baseScope: 64 });
  const breakout = (s: GameState, b: Build) => applyRelease(s, b, { ...scoreRelease(s, b, 0), reception: 100, tier: "breakout", m: 1.4 });

  it("reputation <= 25, users% <= 50%, VC reputation <= 6 per release", () => {
    const s = shop({ companyPhase: "office", users: 1000, reputation: 10, vcReputation: 10 });
    expect(breakout(s, big("feature")).state.reputation).toBe(35);
    const growth = breakout(s, big("growth")).state;
    expect(growth.users).toBe(1000 + Math.round(80 * 10 * 1.4) + 500);
    expect(breakout(s, big("moonshot")).state.vcReputation).toBe(16);
    expect(breakout(s, big("moonshot")).state.volatility).toBe(s.volatility + 3);
  });
});

describe("flops, rushing and plumbing", () => {
  it("a flop pays nothing, takes no users, stings reputation by 2 x weight and credits nobody", () => {
    const s = shop({ roster: staffed([person(1)], "b1"), builds: [worked(20, { size: "s", units: 1, scope: 5, baseScope: 5 })], week: 4, board: { members: [director], lastMeetingWeek: 0 } });
    const b = s.product?.active[0] as Build;
    const score = scoreRelease(s, b, 0);
    expect(score.tier).toBe("flop");
    const out = applyRelease(s, b, score);
    expect(out.state.users).toBe(s.users);
    expect(out.state.reputation).toBe(s.reputation - 1);
    expect(out.state.culture.morale).toBe(s.culture.morale - 1); // round(-1.5) = -1
    expect(out.state.culture.cohesion).toBe(s.culture.cohesion); // round(-0.5) = 0
    expect(Object.is(out.state.culture.cohesion, -0)).toBe(false);
    expect(out.state.board.members[0].confidence).toBe(49);
    expect(rosterOf(out.state)[0].shipped).toBe(0);
    expect(out.lines.map((l) => l.text)).toContain("It pays nothing. It also costs nothing you can't earn back.");
    expect(out.sound).toBe("fail");
  });

  it("rushing leaves cruft: 3 x units x (1 − Q) + 8 x units x (1 − C); payoff x C", () => {
    const b = worked(60, { progress: 7.2 }); // 60% of 12
    const s = shop({ builds: [b] });
    const score = scoreRelease(s, b, 0);
    expect(score.c).toBeCloseTo(0.6, 10);
    expect(score.u).toBeCloseTo(1.5, 10);
    const out = applyRelease(s, b, score);
    expect(out.state.product?.cruft).toBe(Math.round((3 * 2.5 * (1 - score.quality / 100) + 8 * 2.5 * 0.4) * 10) / 10);
  });

  it("growth adds 0.5 cruft per unit on top; plumbing pays cruft down by 4 x u x (0.5 + m)", () => {
    const g = worked(100, { type: "growth" });
    const sg = shop({ builds: [g] });
    expect(applyRelease(sg, g, { ...scoreRelease(sg, g, 0), quality: 100, reception: 80, tier: "solid", m: 1 }).state.product?.cruft).toBe(1.3);
    const p = worked(70, { type: "plumbing" });
    const sp = setProduct(shop({ builds: [p] }), { cruft: 30 });
    const out = applyRelease(sp, p, { ...scoreRelease(sp, p, 0), reception: 80, tier: "solid", m: 1 });
    expect(out.state.product?.cruft).toBe(15);
    expect(out.lines[4].text).toContain("Cruft -15 → 15");
  });
});

describe("credit, the lead, and the log", () => {
  it("credits only members with fit who joined before this week; the lead must be one of them", () => {
    const star = person(3, { craft: 5 });
    const s = shop({
      roster: [...staffed([person(1), person(2, { role: "design" })], "b1", 1), ...staffed([star], "b1", 6)],
      builds: [worked(70)],
      week: 6,
    });
    const b = s.product?.active[0] as Build;
    const out = applyRelease(s, b, { ...scoreRelease(s, b, 0), reception: 80, tier: "solid", m: 1 });
    const byId = Object.fromEntries(rosterOf(out.state).map((e) => [e.id, e]));
    expect([byId.e1.shipped, byId.e2.shipped, byId.e3.shipped]).toEqual([1, 1, 0]);
    expect(byId.e3.ledWeek).toBe(0);
    expect(out.release.leadName).not.toBe(star.name);
    expect(rosterOf(out.state).every((e) => e.buildId === null)).toBe(true);
  });

  it("ledWeek only on SOLID or BREAKOUT", () => {
    const s = shop({ roster: staffed([person(1)], "b1", 1), builds: [worked(50)], week: 6 });
    const b = s.product?.active[0] as Build;
    const shrug = applyRelease(s, b, { ...scoreRelease(s, b, 0), reception: 50, tier: "shrug", m: 0.4 });
    expect(rosterOf(shrug.state)[0].ledWeek).toBe(0);
    expect(rosterOf(shrug.state)[0].shipped).toBe(1);
  });

  it("the release log keeps the 12 most recent; shippedCount keeps counting", () => {
    const old = Array.from({ length: 12 }, (_, i) => ({ id: `b${i + 2}`, name: `Old ${i}`, type: "feature" as const, size: "s" as const, week: 1, reception: 50, tier: "shrug" as const, quality: 50, leadName: null }));
    const b = worked(70, { id: "b20" });
    const s = setProduct(shop({ builds: [b] }), { shipped: old, shippedCount: 12 });
    const out = applyRelease(s, b, scoreRelease(s, b, 0));
    expect(out.state.product?.shipped).toHaveLength(12);
    expect(out.state.product?.shipped[0].id).toBe("b20");
    expect(out.state.product?.shippedCount).toBe(13);
  });
});

describe("releaseBuild: the roll", () => {
  it("draws only from product.rng and writes it back; state.rng is untouched", () => {
    const b = worked(70);
    const s = shop({ builds: [b] });
    const out = releaseBuild(s, b);
    const roll = rollLuck(s, b, productRng(s));
    expect(out.state.rng).toBe(s.rng);
    expect(out.state.product?.rng).toBe(roll.rng);
    expect(out.score.luck).toBe(roll.luck);
    expect(Math.abs(roll.luck)).toBeLessThanOrEqual(Math.round((8 + 12 * 0.3) * 1));
  });

  it("is deterministic and plain JSON", () => {
    const b = worked(70);
    const s = shop({ roster: staffed([person(1)], "b1"), builds: [b], week: 3 });
    const a = releaseBuild(s, b);
    expect(releaseBuild(s, b)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a.state))).toEqual(a.state);
  });
});
