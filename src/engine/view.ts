// What a company may know. Planners and the rivals panel go through these, so "same public info
// as the player" is a matter of types, not discipline.

import type { Company, CompanyId, CompanyView, GameState, PublicCompany } from "./types";

/** A copy with the public fields only. Cash, plans and bookkeeping never leave the company. */
export const publicCompany = (company: Company): PublicCompany => ({
  id: company.id,
  name: company.name,
  pitch: company.pitch,
  users: company.users,
  headcount: company.headcount,
  hype: company.hype,
  quality: company.quality,
  launched: company.launched,
  price: company.price,
  founderEquity: company.founderEquity,
  founderSeats: company.founderSeats,
  investorSeats: company.investorSeats,
  lastRaise: company.lastRaise,
  lastQuarter: company.lastQuarter,
  out: company.out,
});

export const viewFor = (state: GameState, id: CompanyId): CompanyView => ({
  turn: state.turn,
  self: state.companies[id],
  rivals: state.companies.filter((company) => company.id !== id).map(publicCompany),
  climate: state.climate,
  event: state.event,
  modifiers: state.modifiers,
  carryOverUsers: state.carryOverUsers,
  freedPeople: state.freedPeople,
});
