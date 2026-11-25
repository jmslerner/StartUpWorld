// What a company may know. Planners and the rivals panel go through these, so "same public info
// as the player" is a matter of types, not discipline.

import { runwayOf } from "./formulas";
import type { Company, CompanyId, CompanyReport, CompanyView, GameState, PublicCompany, PublicReport, RulesConfig } from "./types";

/**
 * A copy with the public fields only. Cash, plans and bookkeeping never leave the company. A company with a
 * career shows its public career facts and keeps the career's bookkeeping to itself; a race company has no
 * career facts, and its copy has no such key.
 */
export const publicCompany = (company: Company): PublicCompany => {
  const shown: PublicCompany = {
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
  };
  if (company.career === undefined) return shown;
  const { founded, office, listed, rescue } = company.career;
  return { ...shown, career: { founded, office, listed, rescue } };
};

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

/** The part of a company's quarterly report its rivals can see: its moves, not its books or its plan. */
export const publicReport = (report: CompanyReport): PublicReport => ({
  companyId: report.companyId,
  price: report.plan.price,
  headcount: report.headcount,
  quality: { start: report.quality.start, end: report.quality.end, launchedNow: report.quality.launchedNow },
  users: {
    open: report.users.open,
    lostToEvent: report.users.lostToEvent,
    churned: report.users.churned,
    won: report.users.won,
    end: report.users.end,
  },
  raise: report.raise,
  hype: { start: report.hype.start, end: report.hype.end },
  poach: report.poach ? { targetId: report.poach.targetId, success: report.poach.success } : null,
  boardFired: report.board?.fired ?? false,
  valuation: report.valuation,
  equity: report.equity,
  out: report.out,
});

/**
 * A company's runway as a turn starts: cash ÷ last quarter's burn, or null when that quarter was
 * profitable. Before its first quarter the burn is its payroll.
 */
export const companyRunway = (company: Company, config: RulesConfig): number | null =>
  company.lastCosts === null || company.lastRevenue === null
    ? runwayOf(company.cash, 0, company.headcount * config.salary)
    : runwayOf(company.cash, company.lastRevenue, company.lastCosts);
