import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import { EVENT_EFFECT_KINDS, PRICE_TIERS } from "./engine/types";

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
