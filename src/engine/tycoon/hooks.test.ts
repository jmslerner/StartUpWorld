import { describe, expect, it } from "vitest";
import type { GameState, PricingModel, TeamRoster } from "../../types/game";
import { calcBurn } from "../economy";
import { computeContext } from "../context";
import { endWeekTick } from "../tick";
import { launchCampaign, shipFeature } from "../actions";
import { generateHints } from "../hints";
import { makeState } from "../testHelpers";
import { reconcileRoster, rosterInvariantHolds, rosterOf, withSlices } from "./roster";

// The formula hooks (TYCOON-SPEC §5.1, §6) on makeState() fixtures: a state with slices and a job-ad roster must give
// exactly the numbers the same state gives without slices.

const team = (counts: Partial<TeamRoster>): TeamRoster => ({
  engineering: 0, design: 0, marketing: 0, sales: 0, ops: 0, hr: 0, legal: 0, data: 0, product: 0, executive: 0,
  ...counts,
});

const strip = (s: GameState): Omit<GameState, "people" | "product"> => {
  const { people: _p, product: _q, ...rest } = s;
  void _p; void _q;
  return rest;
};

const TEAMS: TeamRoster[] = [
  team({ engineering: 1 }),
  team({ engineering: 4, marketing: 2 }),
  team({ engineering: 6.5, design: 1.5, marketing: 3, sales: 2.5, ops: 0.5 }),
  team({ engineering: 2, marketing: 6, sales: 5, hr: 2, legal: 1 }),
  team({ engineering: 12, design: 3, product: 2, data: 2, marketing: 6, sales: 6, ops: 3, hr: 2, legal: 2, executive: 1 }),
  team({ engineering: 150, marketing: 60, sales: 40 }),
];
const PRICING: PricingModel[] = ["consumer", "prosumer", "enterprise"];
const STRESS = [0, 50, 90];

const variants = (): GameState[] => {
  const out: GameState[] = [];
  TEAMS.forEach((t, i) => {
    PRICING.forEach((pricingModel, j) => {
      STRESS.forEach((stress, k) => {
        out.push(makeState({ team: t, pricingModel, stress, volatility: 10 + 20 * k, seed: 100 + i * 9 + j * 3 + k, rng: 7 + i * 9 + j * 3 + k, arpu: pricingModel === "enterprise" ? 80 : 10 }));
      });
    });
  });
  return out;
};

describe("formula hooks are invisible to a job-ad roster (G3)", () => {
  it("calcBurn, computeContext, shipFeature, launchCampaign and endWeekTick match with and without slices", () => {
    for (const legacy of variants()) {
      const named = reconcileRoster(withSlices(legacy));
      expect(rosterInvariantHolds(named)).toBe(true);
      expect(rosterOf(named).length).toBeGreaterThan(0);
      expect(calcBurn(named)).toBe(calcBurn(legacy));
      expect(computeContext(named)).toEqual(computeContext(legacy));
      expect(generateHints(named, computeContext(named))).toEqual(generateHints(legacy, computeContext(legacy)));

      const shipA = shipFeature(legacy, "x");
      const shipB = shipFeature(named, "x");
      expect(strip(shipB.state)).toEqual(strip(shipA.state));
      expect(shipB.logs.map((l) => l.text)).toEqual(shipA.logs.map((l) => l.text));

      const launchA = launchCampaign(legacy, "y");
      const launchB = launchCampaign(named, "y");
      expect(strip(launchB.state)).toEqual(strip(launchA.state));
      expect(launchB.logs.map((l) => l.text)).toEqual(launchA.logs.map((l) => l.text));

      const tickA = endWeekTick(legacy);
      const tickB = endWeekTick(named);
      expect(strip(tickB.state)).toEqual(strip(tickA.state));
      expect(tickB.logs).toEqual(tickA.logs);
      expect(tickA.state.people).toBeUndefined();
      expect(tickB.state.people?.roster).toEqual(named.people?.roster);
    }
  });

  it("endWeekTick on a slice-less state never adds slices", () => {
    for (const legacy of variants().slice(0, 9)) {
      const r = endWeekTick(legacy);
      expect(r.state.people).toBeUndefined();
      expect(r.state.product).toBeUndefined();
    }
  });
});
