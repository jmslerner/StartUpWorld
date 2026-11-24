// One plan per company for the coming turn: the CPUs and the baseline bot decide for themselves,
// and the human's plan is passed in.

import { CONFIG, type GameConfig } from "../config";
import type { GameState, PlanSet } from "../engine/types";
import { viewFor } from "../engine/view";
import { baselinePlan } from "./baselineBot";
import { chooseCpuPlan } from "./cpu";

/** `human` holds the plans of human-controlled companies by id; a missing one repeats that company's last plan. */
export const choosePlans = (state: GameState, seed: number, config: GameConfig = CONFIG, human: PlanSet = []): PlanSet =>
  state.companies.map((company) => {
    if (company.out !== null) return null;
    switch (company.controller) {
      case "human":
        return human[company.id] ?? null;
      case "baseline":
        return baselinePlan(viewFor(state, company.id), config);
      default:
        return chooseCpuPlan(viewFor(state, company.id), company.controller, seed, config);
    }
  });
