import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import { DESIGN } from "./config.design";
import { EVENT_EFFECT_KINDS, PRICE_TIERS } from "./engine/types";
import { changedNumbers } from "./sim/changes";

// These tests check the shape of the config, never a tunable value: tuning must not break them.
describe("config", () => {
  it("is plain data that survives a JSON round trip", () => {
    expect(JSON.parse(JSON.stringify(CONFIG))).toEqual(CONFIG);
  });

  it("defines both archetypes with a team split that adds up to their headcount", () => {
    for (const key of ["startup", "incumbent"] as const) {
      const a = CONFIG.archetypes[key];
      expect(a.headcount).toBeGreaterThanOrEqual(1);
      expect(a.allocation.product + a.allocation.growth + a.allocation.recruiting).toBe(a.headcount);
      expect(a.founderEquity).toBeGreaterThan(0);
      expect(a.founderEquity).toBeLessThanOrEqual(1);
      expect(a.workExponent).toBeGreaterThan(0);
      expect(a.workExponent).toBeLessThanOrEqual(1);
      expect(a.catchUpMultiplier).toBeGreaterThanOrEqual(1);
    }
  });

  it("defines every price tier", () => {
    for (const tier of PRICE_TIERS) {
      expect(CONFIG.priceTiers[tier].price).toBeGreaterThan(0);
      expect(CONFIG.priceTiers[tier].pullFactor).toBeGreaterThan(0);
    }
  });

  it("keeps every probability between 0 and 1", () => {
    const probabilities = [
      CONFIG.churn.base,
      CONFIG.churn.min,
      CONFIG.board.fireChance,
      CONFIG.poach.baseChance,
      CONFIG.poach.minChance,
      CONFIG.poach.maxChance,
      CONFIG.hype.decay,
      CONFIG.events.chance,
    ];
    for (const p of probabilities) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(CONFIG.poach.minChance).toBeLessThanOrEqual(CONFIG.poach.maxChance);
  });

  it("offers raise sizes as ascending whole percentages below 100", () => {
    const options = CONFIG.raise.options;
    expect(options.length).toBeGreaterThan(0);
    for (const [i, option] of options.entries()) {
      expect(Number.isInteger(option)).toBe(true);
      expect(option).toBeGreaterThan(0);
      expect(option).toBeLessThan(100);
      if (i > 0) expect(option).toBeGreaterThan(options[i - 1]);
    }
  });

  it("uses a positive marketing step that divides the largest spend", () => {
    expect(CONFIG.pull.marketingStep).toBeGreaterThan(0);
    expect(CONFIG.pull.maxMarketing % CONFIG.pull.marketingStep).toBe(0);
  });

  it("never lets a poach take a company's last person", () => {
    expect(CONFIG.poach.minTargetHeadcount).toBeGreaterThanOrEqual(2);
  });

  it("starts events on turn 2 at the earliest: turn 1 is dealt before anything is rolled", () => {
    expect(CONFIG.events.firstTurn).toBeGreaterThanOrEqual(2);
    expect(DESIGN.events.firstTurn).toBeGreaterThanOrEqual(2);
  });

  describe("event deck", () => {
    const deck = CONFIG.events.deck;

    it("has cards with unique ids, a name, a line of text and a positive weight", () => {
      expect(deck.length).toBeGreaterThan(0);
      expect(new Set(deck.map((card) => card.id)).size).toBe(deck.length);
      for (const card of deck) {
        expect(card.name.length, card.id).toBeGreaterThan(0);
        expect(card.text.length, card.id).toBeGreaterThan(0);
        expect(card.weight, card.id).toBeGreaterThan(0);
        expect(card.effects.length, card.id).toBeGreaterThan(0);
      }
    });

    it("uses only effects the engine knows", () => {
      for (const card of deck) {
        for (const effect of card.effects) expect(EVENT_EFFECT_KINDS, card.id).toContain(effect.kind);
      }
    });

    it("gives a target rule to every card that hits one company, and only to those", () => {
      for (const card of deck) {
        const hitsOne = card.effects.some((effect) => effect.kind.startsWith("target"));
        expect(card.target !== undefined, card.id).toBe(hitsOne);
      }
    });

    it("never lets a headcount effect take a company's last person", () => {
      for (const card of deck) {
        for (const effect of card.effects) {
          if (effect.kind !== "targetHeadcount" || effect.delta >= 0) continue;
          expect(card.target?.minHeadcount ?? 0, card.id).toBeGreaterThanOrEqual(1 - effect.delta);
        }
      }
    });

    it("keeps user-loss fractions and multipliers in range", () => {
      for (const card of deck) {
        for (const effect of card.effects) {
          if (effect.kind === "targetUsers") {
            expect(effect.fraction, card.id).toBeGreaterThan(0);
            expect(effect.fraction, card.id).toBeLessThanOrEqual(1);
          }
          if (effect.kind === "fundingClimate") {
            expect(effect.multiplier, card.id).toBeGreaterThan(0);
            expect(effect.turns, card.id).toBeGreaterThanOrEqual(1);
          }
          if (effect.kind === "newUsers" || effect.kind === "marketingEffect") {
            expect(effect.multiplier, card.id).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });
});

// Tuning moves numbers. It must not turn a rival into a different kind of player, or the baseline
// bot into a different bot: those are fixed by the design. (The balance targets are numbers too;
// `npm run sim` lists every number that differs from the design, targets included.)
describe("what tuning may not change", () => {
  const { blitzscaler, bootstrapper, incumbent } = CONFIG.cpu.personalities;

  /** The largest share of its cash a rival will consider spending on marketing in a quarter. */
  const heaviest = (shares: readonly number[]): number => Math.max(...shares);

  it("Blitzscaler: Budget pricing, a 30% raise the moment it is eligible, and the heaviest marketing", () => {
    expect(blitzscaler.price).toBe("budget");
    expect(blitzscaler.raise.when).toBe("eligible");
    expect(blitzscaler.raise.percents).toEqual([30]);
    expect(heaviest(blitzscaler.marketingShares)).toBeGreaterThan(heaviest(bootstrapper.marketingShares));
    expect(heaviest(blitzscaler.marketingShares)).toBeGreaterThan(heaviest(incumbent.marketingShares));
  });

  it("Bootstrapper: Premium pricing, raises only when runway drops under 2 turns, and the smallest team", () => {
    expect(bootstrapper.price).toBe("premium");
    expect(bootstrapper.raise.when).toBe("runway");
    expect(bootstrapper.raise.runway).toBe(2);
    expect(bootstrapper.teamCap).toBeLessThan(blitzscaler.teamCap);
    expect(bootstrapper.teamCap).toBeLessThan(incumbent.teamCap);
  });

  it("Incumbent: poaches when it can afford to", () => {
    expect(incumbent.poachRunway).not.toBeNull();
  });

  it("baseline bot: 40/40/20, Standard price, raises 20% when runway drops under 3 turns", () => {
    expect(CONFIG.baseline).toMatchObject({ split: { product: 0.4, growth: 0.4, recruiting: 0.2 }, price: "standard", raisePercent: 20, raiseRunway: 3, hireRunway: 3, marketing: 0 });
  });

  it("the raise sizes on offer: 10, 20 or 30%", () => {
    expect(CONFIG.raise.options).toEqual([10, 20, 30]);
  });
});

describe("the design's starting numbers", () => {
  it("cover exactly the same numbers as the config: none missing on either side", () => {
    const oneSided = changedNumbers(DESIGN, CONFIG).filter((change) => change.start === undefined || change.now === undefined);
    expect(oneSided.map((change) => change.path)).toEqual([]);
  });
});
