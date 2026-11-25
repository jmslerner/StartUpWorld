// One turn of the game: (state, every company's plan, seed) → (new state, turn log).
//
// Pure. Nothing here reads a clock, a global or Math.random; every roll comes from a stream keyed
// by (seed, turn, purpose, company). The order of the steps is the order in
// docs/turn-based-design.md, "Order of a turn".

import { CONFIG } from "../config";
import { NEUTRAL_MODIFIERS, applyEvent, drawEvent, type EventContext } from "./events";
import {
  churnRate,
  clamp,
  departmentWork,
  effectiveWork,
  founderStake,
  hiringCapacity,
  newUsersForTurn,
  nextQuality,
  poachChance,
  poachFloor,
  pullOf,
  qualityGain,
  raiseAmount,
  revenueOf,
  round4,
  round6,
  runwayOf,
  valuationOf,
} from "./formulas";
import { byHypeOrder, handOutCandidates } from "./hiring";
import { resolveMarket } from "./market";
import { normalizePlan } from "./plan";
import { STREAM, firstFloat } from "./rng";
import type {
  Climate,
  Company,
  CompanyId,
  CompanyReport,
  CostBreakdown,
  GameState,
  Outcome,
  OutReason,
  Plan,
  PlanSet,
  RulesConfig,
  TurnLog,
} from "./types";

export interface TurnResult {
  readonly state: GameState;
  readonly log: TurnLog;
}

/** One company's working figures while the turn resolves. Local to this file, so it may be mutable. */
interface Desk {
  /** The company as the turn started. */
  readonly company: Company;
  plan: Plan;
  readonly notes: string[];
  /** People on payroll this turn: headcount less layoffs. */
  readonly payroll: number;
  readonly raise: CompanyReport["raise"];
  readonly equity: number;
  readonly investorSeats: number;
  effective: number;
  productWork: number;
  growthWork: number;
  recruitingWork: number;
  catchUp: boolean;
  gain: number;
  quality: number;
  launched: boolean;
  launchedNow: boolean;
  pull: number;
  churned: number;
  won: number;
  users: number;
  share: number;
  poach: CompanyReport["poach"];
  poachFee: number;
  poachedIn: number;
  poachedOut: number;
  capacity: number;
  wanted: number;
  hired: number;
  revenue: number;
  costs: CostBreakdown;
  cash: number;
  profitable: boolean;
  runway: number | null;
  hype: CompanyReport["hype"];
  headcountEnd: number;
  valuation: number;
  board: CompanyReport["board"];
  out: OutReason | null;
}

const NO_COSTS: CostBreakdown = { salaries: 0, marketing: 0, hiring: 0, poaching: 0, severance: 0, total: 0 };

/** Steps 1–3: check the plan, lay people off, close the raise. */
const openDesk = (state: GameState, company: Company, plan: Plan | null, config: RulesConfig): Desk => {
  const checked = normalizePlan(state, company.id, plan, config);
  const percent = checked.plan.raisePercent;
  let raise: Desk["raise"] = null;
  if (percent > 0) {
    const valuation = valuationOf(company.users, company.hype, state.climate.multiplier, config);
    raise = { percent, valuation, amount: raiseAmount(valuation, percent) };
  }
  return {
    company,
    plan: checked.plan,
    notes: [...checked.notes],
    payroll: company.headcount - checked.plan.layoffs,
    raise,
    equity: raise ? round6(company.founderEquity * (1 - percent / 100)) : company.founderEquity,
    investorSeats: company.investorSeats + (raise ? 1 : 0),
    effective: 0,
    productWork: 0,
    growthWork: 0,
    recruitingWork: 0,
    catchUp: false,
    gain: 0,
    quality: company.quality,
    launched: company.launched,
    launchedNow: false,
    pull: 0,
    churned: 0,
    won: 0,
    users: company.users,
    share: 0,
    poach: null,
    poachFee: 0,
    poachedIn: 0,
    poachedOut: 0,
    capacity: 0,
    wanted: 0,
    hired: 0,
    revenue: 0,
    costs: NO_COSTS,
    cash: company.cash,
    profitable: false,
    runway: null,
    hype: { start: company.hype, end: company.hype, launch: 0, raise: 0, growth: 0, layoffs: 0 },
    headcountEnd: company.headcount,
    valuation: 0,
    board: null,
    out: null,
  };
};

/** Steps 4–5: do the work, then gain, decay and the launch test. */
const build = (desk: Desk, bestRivalQuality: number, marketingModifier: number, config: RulesConfig): void => {
  const { company, plan, payroll } = desk;
  const archetype = config.archetypes[company.archetype];
  desk.effective = effectiveWork(payroll, archetype.workExponent);
  desk.productWork = departmentWork(desk.effective, plan.allocation.product, payroll);
  desk.growthWork = departmentWork(desk.effective, plan.allocation.growth, payroll);
  desk.recruitingWork = departmentWork(desk.effective, plan.allocation.recruiting, payroll);

  desk.catchUp = archetype.catchUpMultiplier > 1 && company.quality < bestRivalQuality;
  desk.gain = qualityGain(company.quality, desk.productWork, desk.catchUp ? archetype.catchUpMultiplier : 1, config);
  desk.quality = nextQuality(company.quality, desk.gain, config);
  desk.launchedNow = !company.launched && desk.quality >= config.quality.launchAt;
  desk.launched = company.launched || desk.launchedNow;
  desk.pull = desk.launched
    ? pullOf({ quality: desk.quality, growthWork: desk.growthWork, marketing: plan.marketing, tier: plan.price, hype: company.hype, marketingModifier }, config)
    : 0;
};

/** The best of a list by the given keys, highest first; the lowest id breaks a full tie. */
const best = (desks: readonly Desk[], ...keys: ((desk: Desk) => number)[]): Desk =>
  [...desks].sort((a, b) => {
    for (const key of keys) {
      const diff = key(b) - key(a);
      if (diff !== 0) return diff;
    }
    return a.company.id - b.company.id;
  })[0];

const tickClimate = (climate: Climate): Climate =>
  climate.turnsLeft <= 1 ? { multiplier: 1, turnsLeft: 0 } : { multiplier: climate.multiplier, turnsLeft: climate.turnsLeft - 1 };

const reportOf = (desk: Desk, config: RulesConfig): CompanyReport => {
  const { company } = desk;
  return {
    companyId: company.id,
    plan: desk.plan,
    notes: desk.notes,
    headcount: {
      start: company.headcount,
      lostToEvent: Math.max(0, company.headcountAtLastClose - company.headcount),
      laidOff: desk.plan.layoffs,
      hired: desk.hired,
      poachedIn: desk.poachedIn,
      poachedOut: desk.poachedOut,
      end: desk.headcountEnd,
    },
    work: { effective: desk.effective, product: desk.productWork, growth: desk.growthWork, recruiting: desk.recruitingWork },
    quality: {
      start: company.quality,
      gain: desk.gain,
      decay: config.quality.decay,
      end: desk.quality,
      catchUp: desk.catchUp,
      launchedNow: desk.launchedNow,
    },
    users: {
      open: company.usersAtLastClose,
      lostToEvent: Math.max(0, company.usersAtLastClose - company.users),
      churned: desk.churned,
      won: desk.won,
      end: desk.users,
      pull: desk.pull,
      share: desk.share,
    },
    revenue: desk.revenue,
    costs: desk.costs,
    raise: desk.raise,
    cash: { start: company.cash, end: desk.cash },
    profitable: desk.profitable,
    runway: desk.runway,
    hype: desk.hype,
    poach: desk.poach,
    hiring: { capacity: desk.capacity, wanted: desk.wanted, hired: desk.hired },
    board: desk.board,
    valuation: desk.valuation,
    equity: desk.equity,
    out: desk.out,
  };
};

const closedLog = (state: GameState): TurnLog => ({
  turn: state.turn,
  event: state.event,
  climateMultiplier: state.climate.multiplier,
  market: { newUsers: 0, carriedIn: 0, churned: 0, pool: 0, carriedOut: 0 },
  hiring: { candidates: 0, picks: [] },
  companies: state.companies.map(() => null),
  nextEvent: null,
  outcome: state.outcome,
});

export const resolveTurn = (state: GameState, plans: PlanSet, seed: number, config: RulesConfig = CONFIG): TurnResult => {
  if (state.outcome !== null) return { state, log: closedLog(state) };

  const turn = state.turn;
  const climate = state.climate.multiplier;

  // 1–3. Plans, layoffs, raise.
  const desks = state.companies.filter((company) => company.out === null).map((company) => openDesk(state, company, plans[company.id] ?? null, config));
  const deskOf = (id: CompanyId): Desk | undefined => desks.find((desk) => desk.company.id === id);

  // 4–5. Work and product. The catch-up bonus looks at rivals' quality as the turn started.
  for (const desk of desks) {
    const rivals = desks.filter((other) => other !== desk && other.company.launched).map((other) => other.company.quality);
    build(desk, rivals.length > 0 ? Math.max(...rivals) : -1, state.modifiers.marketing, config);
  }

  // 6. Market: churn, then the pool is split by pull among launched companies.
  const entrants = desks.filter((desk) => desk.launched);
  const market = resolveMarket(
    entrants.map((desk) => ({ id: desk.company.id, users: desk.company.users, churnRate: churnRate(desk.quality, desk.plan.price, config), pull: desk.pull })),
    newUsersForTurn(turn, state.modifiers.newUsers, config),
    state.carryOverUsers,
  );
  for (const [i, desk] of entrants.entries()) {
    const share = market.companies[i];
    desk.churned = share.churned;
    desk.won = share.won;
    desk.users = share.users;
    desk.share = share.share;
  }

  // 7. Poach attempts, highest hype first.
  const poachers = desks
    .filter((desk) => desk.plan.poachTarget !== null)
    .map((desk) => ({ desk, id: desk.company.id, hype: desk.company.hype, tieKey: firstFloat(seed, turn, STREAM.poachOrder, desk.company.id) }))
    .sort(byHypeOrder);
  for (const { desk } of poachers) {
    const target = deskOf(desk.plan.poachTarget as CompanyId);
    if (target === undefined || target.payroll - target.poachedOut < poachFloor(config)) {
      desk.notes.push(`Poach dropped: ${target ? target.company.name : "that company"} is too small to lose anyone.`);
      desk.plan = { ...desk.plan, poachTarget: null };
      continue;
    }
    const chance = poachChance(desk.company.hype, target.company.hype, config);
    const success = firstFloat(seed, turn, STREAM.poach, desk.company.id) < chance;
    desk.poach = { targetId: target.company.id, chance, success };
    desk.poachFee = config.poach.cost;
    if (success) {
      desk.poachedIn += 1;
      target.poachedOut += 1;
    }
  }

  // 8. Hiring: one candidate at a time in hype order.
  const laidOff = desks.reduce((sum, desk) => sum + desk.plan.layoffs, 0);
  const candidates = config.hiring.candidatesPerTurn + state.modifiers.extraCandidates + state.freedPeople + laidOff;
  for (const desk of desks) {
    desk.capacity = hiringCapacity(desk.recruitingWork, config);
    desk.wanted = Math.min(desk.capacity, desk.plan.hireLimit ?? desk.capacity);
  }
  const hiring = handOutCandidates(
    candidates,
    desks.map((desk) => ({ id: desk.company.id, hype: desk.company.hype, tieKey: firstFloat(seed, turn, STREAM.hiringOrder, desk.company.id), wanted: desk.wanted })),
  );

  // 9–10. Revenue and costs, then hype.
  for (const desk of desks) {
    const { company, plan } = desk;
    desk.hired = hiring.hired[company.id] ?? 0;
    desk.headcountEnd = desk.payroll + desk.hired + desk.poachedIn - desk.poachedOut;

    desk.revenue = revenueOf(desk.users, plan.price, config);
    const salaries = desk.payroll * config.salary;
    const hiringFees = desk.hired * config.hiring.fee;
    const severance = plan.layoffs * config.layoff.severance;
    desk.costs = {
      salaries,
      marketing: plan.marketing,
      hiring: hiringFees,
      poaching: desk.poachFee,
      severance,
      total: salaries + plan.marketing + hiringFees + desk.poachFee + severance,
    };
    desk.cash = company.cash + (desk.raise?.amount ?? 0) + desk.revenue - desk.costs.total;
    desk.profitable = desk.revenue >= desk.costs.total;
    desk.runway = runwayOf(desk.cash, desk.revenue, desk.costs.total);

    const launch = desk.launchedNow ? config.hype.launch : 0;
    const raise = desk.raise ? config.hype.raise : 0;
    const grew = company.usersAtLastClose > 0 && desk.users >= company.usersAtLastClose * (1 + config.hype.growthThreshold);
    const growth = grew ? config.hype.growth : 0;
    const layoffs = plan.layoffs > 0 ? config.layoff.hype : 0;
    const end = round4(clamp(company.hype * (1 - config.hype.decay) + launch + raise + growth + layoffs, 0, 100));
    desk.hype = { start: company.hype, end, launch, raise, growth, layoffs };
    desk.valuation = valuationOf(desk.users, end, climate, config);
  }

  // 11–13. Endings. An IPO ends the game at once; otherwise bankruptcy, the board, then who is left.
  const stakeOf = (desk: Desk): number => founderStake(desk.equity, desk.valuation);
  let outcome: Outcome | null = null;
  const listing = desks.filter((desk) => desk.users >= config.ipo.users && desk.profitable);
  if (listing.length > 0) {
    outcome = { kind: "ipo", turn, winnerId: best(listing, (d) => d.valuation, stakeOf).company.id };
  } else {
    for (const desk of desks) {
      if (desk.cash < 0) {
        desk.out = "bankrupt";
        continue;
      }
      if (desk.investorSeats <= desk.company.founderSeats) continue;
      const usersFell = desk.users < desk.company.usersAtLastClose;
      const lowRunway = desk.runway !== null && desk.runway < config.board.runwayTurns;
      const fired = (usersFell || lowRunway) && firstFloat(seed, turn, STREAM.board, desk.company.id) < config.board.fireChance;
      desk.board = { usersFell, lowRunway, fired };
      if (fired) desk.out = "fired";
    }
    const survivors = desks.filter((desk) => desk.out === null);
    if (survivors.length === 0) outcome = { kind: "wipeout", turn, winnerId: null };
    else if (survivors.length === 1) outcome = { kind: "lastStanding", turn, winnerId: survivors[0].company.id };
    else if (turn >= config.game.maxTurns) outcome = { kind: "turnLimit", turn, winnerId: best(survivors, stakeOf, (d) => d.valuation).company.id };
  }

  // Close the books: every company as it stands after this turn. Companies that go out release
  // their users to the next pool and their people to next turn's candidates.
  const gone = desks.filter((desk) => desk.out !== null);
  const carryOverUsers = market.carriedOut + gone.reduce((sum, desk) => sum + desk.users, 0);
  const freedPeople = gone.reduce((sum, desk) => sum + desk.headcountEnd, 0);
  const closed: Company[] = state.companies.map((company) => {
    const desk = deskOf(company.id);
    if (desk === undefined) return company;
    const left = desk.out !== null;
    return {
      ...company,
      cash: desk.cash,
      headcount: left ? 0 : desk.headcountEnd,
      users: left ? 0 : desk.users,
      quality: desk.quality,
      launched: desk.launched,
      hype: desk.hype.end,
      price: desk.plan.price,
      founderEquity: desk.equity,
      investorSeats: desk.investorSeats,
      lastRaise: desk.raise ? { turn, percent: desk.raise.percent, amount: desk.raise.amount } : company.lastRaise,
      lastQuarter: {
        qualityAtOpen: company.quality,
        hypeAtOpen: company.hype,
        usersAtOpen: company.usersAtLastClose,
        usersLostToEvent: Math.max(0, company.usersAtLastClose - company.users),
        usersChurned: desk.churned,
        usersWon: desk.won,
        joined: desk.hired + desk.poachedIn,
        left: desk.plan.layoffs + desk.poachedOut + Math.max(0, company.headcountAtLastClose - company.headcount),
      },
      out: desk.out !== null ? { turn, reason: desk.out, users: desk.users, headcount: desk.headcountEnd } : null,
      lastPlan: desk.plan,
      usersAtLastClose: left ? 0 : desk.users,
      headcountAtLastClose: left ? 0 : desk.headcountEnd,
      lastRevenue: desk.revenue,
      lastCosts: desk.costs.total,
      lastPull: desk.launched ? desk.pull : null,
    };
  });

  // 14. If the game goes on: the climate ticks down, and next turn's event is drawn and applied.
  let next: GameState = { ...state, companies: closed, carryOverUsers, freedPeople, outcome };
  if (outcome === null) {
    const event = drawEvent(closed, turn + 1, seed, config);
    let context: EventContext = { companies: closed, climate: tickClimate(state.climate), modifiers: NEUTRAL_MODIFIERS, carryOverUsers };
    if (event !== null) context = applyEvent(context, event, config);
    next = {
      turn: turn + 1,
      companies: context.companies,
      carryOverUsers: context.carryOverUsers,
      freedPeople,
      climate: context.climate,
      event,
      modifiers: context.modifiers,
      outcome: null,
    };
  }

  const log: TurnLog = {
    turn,
    event: state.event,
    climateMultiplier: climate,
    // Carried out = the part of the pool nobody took, plus the users of companies that went out this turn.
    market: { newUsers: market.newUsers, carriedIn: market.carriedIn, churned: market.churned, pool: market.pool, carriedOut: carryOverUsers },
    hiring: { candidates, picks: hiring.picks },
    companies: state.companies.map((company) => {
      const desk = deskOf(company.id);
      return desk === undefined ? null : reportOf(desk, config);
    }),
    nextEvent: next.outcome === null ? next.event : null,
    outcome,
  };

  return { state: next, log };
};
