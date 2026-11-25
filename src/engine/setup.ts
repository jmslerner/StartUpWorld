// A new game: every company at its archetype's starting state, turn 1, no event.
// With a career's config each company also gets its career facts, and the state its wave of new users.

import { CONFIG } from "../config";
import { officeFor } from "./career";
import type { Company, GameSetup, GameState, RulesConfig } from "./types";

export const createGame = (setup: GameSetup, config: RulesConfig = CONFIG): GameState => {
  if (setup.seats.length < 2) throw new Error("A game needs at least two companies.");
  const { career } = config;
  const companies: Company[] = setup.seats.map((seat, id) => {
    const start = config.archetypes[seat.archetype];
    const company: Company = {
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
    // Career facts come last, and only in a career: a race company has no such key.
    if (career === undefined) return company;
    return {
      ...company,
      career: { founded: 1, office: officeFor(start.headcount, career), listed: null, rescue: null, qualityAtLastClose: start.quality, qualified: false },
    };
  });
  const state: GameState = {
    turn: 1,
    companies,
    carryOverUsers: 0,
    freedPeople: 0,
    climate: { multiplier: 1, turnsLeft: 0 },
    event: null,
    modifiers: { newUsers: 1, marketing: 1, extraCandidates: 0 },
    outcome: null,
  };
  // The same for the state's wave of new users: at rest until a platform shift sets one off.
  return career === undefined ? state : { ...state, wave: { multiplier: 1, turnsLeft: 0 } };
};
