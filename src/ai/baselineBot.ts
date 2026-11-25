// The simulator's stand-in for a new player: a simple, fixed policy with no look-ahead.
// Everyone builds until launch, then 40 / 40 / 20; Standard price; no marketing; raises 20% when
// runway drops under 3 turns; hires only while it keeps 3 turns of runway.
//
// Its numbers are those of the turn being planned: the config itself in a race, the config with the year's era laid
// over it in a career. In a career it also goes public in the first year it may.

import { CONFIG, type PlayConfig } from "../config";
import { listingBlocker, rulesForTurn } from "../engine/career";
import { splitByWeights } from "../engine/formulas";
import { raiseBlocker } from "../engine/plan";
import type { Allocation, Company, CompanyView, Plan } from "../engine/types";
import { companyRunway } from "../engine/view";

/** The most it can hire, of the people on the market, and still have `hireRunway` turns of cash at the new, higher burn. */
const affordableHires = (self: Company, onTheMarket: number, rules: PlayConfig): number => {
  const burn = (self.lastCosts ?? self.headcount * rules.salary) - (self.lastRevenue ?? 0);
  let hires = 0;
  while (hires < onTheMarket) {
    const next = hires + 1;
    const newBurn = burn + next * rules.salary;
    const cashAfterFees = self.cash - next * rules.hiring.fee;
    if (newBurn > 0 && cashAfterFees / newBurn < rules.baseline.hireRunway) break;
    hires = next;
  }
  return hires;
};

export const baselinePlan = (view: CompanyView, config: PlayConfig = CONFIG): Plan => {
  const rules = rulesForTurn(config, view.turn);
  const { self } = view;
  const policy = rules.baseline;

  // In a career it lists in the first year it may. The rules drop a raise asked for in that year, so it asks for
  // none and sets nobody aside for one.
  const goPublic = rules.career !== undefined && listingBlocker(self, view.turn, config) === null;
  const runway = companyRunway(self, rules);
  const raises = !goPublic && runway !== null && runway < policy.raiseRunway && raiseBlocker(self, view.turn, config) === null;
  const available = self.headcount - (raises ? 1 : 0);

  let allocation: Allocation = { product: available, growth: 0, recruiting: 0 };
  if (self.launched) {
    const [product, growth, recruiting] = splitByWeights(available, [policy.split.product, policy.split.growth, policy.split.recruiting]);
    allocation = { product, growth, recruiting };
  }

  const plan: Plan = {
    allocation,
    marketing: policy.marketing,
    price: policy.price,
    raisePercent: raises ? policy.raisePercent : 0,
    poachTarget: null,
    layoffs: 0,
    hireLimit: affordableHires(self, rules.hiring.candidatesPerTurn + view.modifiers.extraCandidates + view.freedPeople, rules),
  };
  // A career plan always says whether the company goes public, as its last key. A race plan has no such key.
  return rules.career === undefined ? plan : { ...plan, goPublic };
};
