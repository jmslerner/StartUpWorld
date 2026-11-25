// A new game: every company at its archetype's starting state, turn 1, no event.

import { CONFIG } from "../config";
import type { Company, GameSetup, GameState, RulesConfig } from "./types";

export const createGame = (setup: GameSetup, config: RulesConfig = CONFIG): GameState => {
  if (setup.seats.length < 2) throw new Error("A game needs at least two companies.");
  const companies: Company[] = setup.seats.map((seat, id) => {
    const start = config.archetypes[seat.archetype];
    return {
      id,
      name: seat.name,
      pitch: seat.pitch,
      archetype: seat.archetype,
      controller: seat.controller,
      cash: start.cash,
      headcount: start.headcount,
      users: start.users,
      quality: start.quality,
      launched: start.quality >= config.quality.launchAt,
      hype: start.hype,
      price: "standard",
      founderEquity: start.founderEquity,
      founderSeats: start.founderSeats,
      investorSeats: start.investorSeats,
      lastRaise: null,
      lastQuarter: null,
      out: null,
      lastPlan: {
        allocation: start.allocation,
        marketing: 0,
        price: "standard",
        raisePercent: 0,
        poachTarget: null,
        layoffs: 0,
        hireLimit: null,
      },
      usersAtLastClose: start.users,
      headcountAtLastClose: start.headcount,
      lastRevenue: null,
      lastCosts: null,
      lastPull: null,
    };
  });
  return {
    turn: 1,
    companies,
    carryOverUsers: 0,
    freedPeople: 0,
    climate: { multiplier: 1, turnsLeft: 0 },
    event: null,
    modifiers: { newUsers: 1, marketing: 1, extraCandidates: 0 },
    outcome: null,
  };
};
