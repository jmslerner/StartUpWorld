// The simulator's stand-in for a new player: a simple, fixed policy with no look-ahead.
// Everyone builds until launch, then 40 / 40 / 20; Standard price; no marketing; raises 20% when
// runway drops under 3 turns; hires only while it keeps 3 turns of runway.

import { CONFIG, type GameConfig } from "../config";
import { splitByWeights } from "../engine/formulas";
import { raiseBlocker } from "../engine/plan";
import type { Allocation, Company, CompanyView, Plan } from "../engine/types";
import { companyRunway } from "../engine/view";

/** The most it can hire, of the people on the market, and still have `hireRunway` turns of cash at the new, higher burn. */
const affordableHires = (self: Company, onTheMarket: number, config: GameConfig): number => {
  const burn = (self.lastCosts ?? self.headcount * config.salary) - (self.lastRevenue ?? 0);
  let hires = 0;
  while (hires < onTheMarket) {
    const next = hires + 1;
    const newBurn = burn + next * config.salary;
    const cashAfterFees = self.cash - next * config.hiring.fee;
    if (newBurn > 0 && cashAfterFees / newBurn < config.baseline.hireRunway) break;
    hires = next;
  }
  return hires;
};

export const baselinePlan = (view: CompanyView, config: GameConfig = CONFIG): Plan => {
  const { self } = view;
  const policy = config.baseline;

  const runway = companyRunway(self, config);
  const raises = runway !== null && runway < policy.raiseRunway && raiseBlocker(self, view.turn, config) === null;
  const available = self.headcount - (raises ? 1 : 0);

  let allocation: Allocation = { product: available, growth: 0, recruiting: 0 };
  if (self.launched) {
    const [product, growth, recruiting] = splitByWeights(available, [policy.split.product, policy.split.growth, policy.split.recruiting]);
    allocation = { product, growth, recruiting };
  }

  return {
    allocation,
    marketing: policy.marketing,
    price: policy.price,
    raisePercent: raises ? policy.raisePercent : 0,
    poachTarget: null,
    layoffs: 0,
    hireLimit: affordableHires(self, config.hiring.candidatesPerTurn + view.modifiers.extraCandidates + view.freedPeople, config),
  };
};
