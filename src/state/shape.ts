// Is this piece of parsed JSON a game this build can play? Checked field by field: a save can come
// from an older build, a damaged disk or a curious player, and the engine and the screens trust the
// state they are handed.
//
// Each shape below lists every field of its type, and the compiler insists on it: add a field to
// GameState, Plan or TurnLog and this file stops compiling until the field is checked here too.
// (Also bump SAVE_VERSION in save.ts, so saves without the new field start a new game.)

import { PRICE_TIERS } from "../engine/types";
import type {
  ActiveEvent,
  Allocation,
  Climate,
  Company,
  CompanyReport,
  Controller,
  CostBreakdown,
  EndingKind,
  Exit,
  GameState,
  LastRaise,
  OutReason,
  Outcome,
  Plan,
  QuarterStats,
  RulesConfig,
  TurnLog,
  TurnModifiers,
} from "../engine/types";

type Check = (value: unknown) => boolean;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const number: Check = (value) => typeof value === "number" && Number.isFinite(value);
/** People, users, seats, turns: a whole number, 0 or more. */
const count: Check = (value) => Number.isInteger(value) && (value as number) >= 0;
const text: Check = (value) => typeof value === "string";
const flag: Check = (value) => typeof value === "boolean";
const between =
  (min: number, max: number): Check =>
  (value) =>
    number(value) && (value as number) >= min && (value as number) <= max;
const oneOf =
  (options: readonly unknown[]): Check =>
  (value) =>
    options.includes(value);
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);

/** An object holding every field of T, each passing its check. Extra fields are ignored. */
const shape = <T>(fields: { readonly [K in keyof T]-?: Check }): Check => {
  const keys = Object.keys(fields) as (keyof T & string)[];
  return (value) => isRecord(value) && keys.every((key) => fields[key](value[key]));
};

/** Every member of a union of names, so a new one cannot be forgotten here. */
const names = <T extends string>(all: Readonly<Record<T, true>>): Check => oneOf(Object.keys(all));

const controller = names<Controller>({ human: true, baseline: true, blitzscaler: true, bootstrapper: true, incumbent: true });
const outReason = names<OutReason>({ bankrupt: true, fired: true });
const endingKind = names<EndingKind>({ ipo: true, lastStanding: true, turnLimit: true, wipeout: true });
const priceTier = oneOf(PRICE_TIERS);

const allocation = shape<Allocation>({ product: number, growth: number, recruiting: number });

/** A plan as stored. Its numbers may still break a rule: the engine's own plan check deals with that. */
const plan = shape<Plan>({
  allocation,
  marketing: number,
  price: text,
  raisePercent: number,
  poachTarget: orNull(number),
  layoffs: number,
  hireLimit: orNull(number),
});

const lastRaise = shape<LastRaise>({ turn: count, percent: number, amount: number });

const quarterStats = shape<QuarterStats>({
  qualityAtOpen: number,
  hypeAtOpen: number,
  usersAtOpen: number,
  usersLostToEvent: number,
  usersChurned: number,
  usersWon: number,
  joined: number,
  left: number,
});

const exit = shape<Exit>({ turn: count, reason: outReason, users: count, headcount: count });

const company = (config: RulesConfig): Check =>
  shape<Company>({
    // Compared with its place in the list by the game check below.
    id: count,
    name: text,
    pitch: text,
    users: count,
    headcount: count,
    hype: between(0, 100),
    quality: between(0, 100),
    launched: flag,
    price: priceTier,
    founderEquity: between(0, 1),
    founderSeats: count,
    investorSeats: count,
    lastRaise: orNull(lastRaise),
    lastQuarter: orNull(quarterStats),
    out: orNull(exit),
    archetype: (value) => typeof value === "string" && Object.hasOwn(config.archetypes, value),
    controller,
    cash: number,
    lastPlan: plan,
    usersAtLastClose: count,
    headcountAtLastClose: count,
    lastRevenue: orNull(number),
    lastCosts: orNull(number),
    lastPull: orNull(number),
  });

const climate = shape<Climate>({ multiplier: number, turnsLeft: count });
const modifiers = shape<TurnModifiers>({ newUsers: number, marketing: number, extraCandidates: number });

/** Checks that need to know how many companies are in the game. */
const seated = (seats: number) => {
  const seat: Check = (value) => count(value) && (value as number) < seats;
  const event = shape<ActiveEvent>({ cardId: text, targetId: orNull(seat) });
  const outcome = shape<Outcome>({ kind: endingKind, turn: count, winnerId: orNull(seat) });
  return { seat, event, outcome };
};

export const isPlan = (value: unknown): value is Plan => plan(value);

export const isGame = (value: unknown, config: RulesConfig): value is GameState => {
  if (!isRecord(value) || !Array.isArray(value.companies)) return false;
  const companies: readonly unknown[] = value.companies;
  // The screens are built for the player in seat 0 and at least one rival.
  if (companies.length < 2) return false;
  const { event, outcome } = seated(companies.length);
  const game = shape<GameState>({
    turn: (turn) => count(turn) && (turn as number) >= 1 && (turn as number) <= config.game.maxTurns,
    companies: listOf(company(config)),
    carryOverUsers: count,
    freedPeople: count,
    climate,
    event: orNull(event),
    modifiers,
    outcome: orNull(outcome),
  });
  if (!game(value)) return false;
  const checked = value as unknown as GameState;
  return checked.companies.every((each, index) => each.id === index) && checked.companies[0].controller === "human";
};

const costs = shape<CostBreakdown>({ salaries: number, marketing: number, hiring: number, poaching: number, severance: number, total: number });

const report = (seats: number): Check => {
  const { seat } = seated(seats);
  return shape<CompanyReport>({
    companyId: seat,
    plan,
    notes: listOf(text),
    headcount: shape<CompanyReport["headcount"]>({ start: number, lostToEvent: number, laidOff: number, hired: number, poachedIn: number, poachedOut: number, end: number }),
    work: shape<CompanyReport["work"]>({ effective: number, product: number, growth: number, recruiting: number }),
    quality: shape<CompanyReport["quality"]>({ start: number, gain: number, decay: number, end: number, catchUp: flag, launchedNow: flag }),
    users: shape<CompanyReport["users"]>({ open: number, lostToEvent: number, churned: number, won: number, end: number, pull: number, share: number }),
    revenue: number,
    costs,
    raise: orNull(shape<NonNullable<CompanyReport["raise"]>>({ percent: number, valuation: number, amount: number })),
    cash: shape<CompanyReport["cash"]>({ start: number, end: number }),
    profitable: flag,
    runway: orNull(number),
    hype: shape<CompanyReport["hype"]>({ start: number, end: number, launch: number, raise: number, growth: number, layoffs: number }),
    poach: orNull(shape<NonNullable<CompanyReport["poach"]>>({ targetId: seat, chance: number, success: flag })),
    hiring: shape<CompanyReport["hiring"]>({ capacity: number, wanted: number, hired: number }),
    board: orNull(shape<NonNullable<CompanyReport["board"]>>({ usersFell: flag, lowRunway: flag, fired: flag })),
    valuation: number,
    equity: number,
    out: orNull(outReason),
  });
};

/** A quarter's log for a game with this many companies: one report, or null, for each of them. */
export const isTurnLog = (value: unknown, seats: number): value is TurnLog => {
  const { seat, event, outcome } = seated(seats);
  const log = shape<TurnLog>({
    turn: count,
    event: orNull(event),
    climateMultiplier: number,
    market: shape<TurnLog["market"]>({ newUsers: number, carriedIn: number, churned: number, pool: number, carriedOut: number }),
    hiring: shape<TurnLog["hiring"]>({ candidates: number, picks: listOf(seat) }),
    companies: listOf(orNull(report(seats))),
    nextEvent: orNull(event),
    outcome: orNull(outcome),
  });
  if (!log(value)) return false;
  const checked = value as unknown as TurnLog;
  return checked.companies.length === seats && checked.companies.every((each, index) => each === null || each.companyId === index);
};
