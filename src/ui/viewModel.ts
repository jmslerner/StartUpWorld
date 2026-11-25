// What each screen shows, worked out from the game state. Pure functions, no React: the screens
// only lay these out. Everything about a rival comes through its public record, so the screens
// cannot show what the player is not supposed to know.

import { findCard } from "../engine/events";
import { effectiveWork, founderStake, hiringCapacity, marketingPull, poachChance, poachFloor, raiseAmount, revenueOf, round6, runwayOf, valuationOf } from "../engine/formulas";
import { raiseBlocker, type RaiseBlocker } from "../engine/plan";
import { projectTurn, type Projection } from "../engine/project";
import { PRICE_TIERS } from "../engine/types";
import type {
  ActiveEvent,
  Climate,
  Company,
  CompanyId,
  CompanyReport,
  Controller,
  CostBreakdown,
  Exit,
  GameState,
  LastRaise,
  OutReason,
  Plan,
  PriceTier,
  QuarterStats,
  RulesConfig,
  TurnLog,
} from "../engine/types";
import { companyRunway, publicCompany, publicReport, viewFor } from "../engine/view";
import { PLAYER_ID } from "../state/player";
import { peopleAvailable, unassigned } from "./draft";
import { count, money, percent, quarter } from "./format";
import type { GameEndSound } from "./sound";

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

/**
 * How a company's users changed over its last quarter, close to close: what its report showed and
 * what a board means by "users fell". null before its first quarter.
 */
const usersChange = (last: QuarterStats | null): number | null => (last === null ? null : last.usersWon - last.usersChurned - last.usersLostToEvent);

// ── Resource bar ──

export interface BoardView {
  readonly founderSeats: number;
  readonly investorSeats: number;
  readonly control: "founders" | "tied" | "investors";
}

export interface ResourceView {
  readonly companyName: string;
  readonly turn: number;
  readonly maxTurns: number;
  readonly cash: number;
  /** Turns of cash at last quarter's burn; null when it was profitable. */
  readonly runway: number | null;
  readonly headcount: number;
  /** What the team gets done after coordination drag. */
  readonly effectiveWork: number;
  readonly users: number;
  readonly usersChange: number | null;
  /** Users needed to go public. */
  readonly ipoUsers: number;
  readonly hype: number;
  readonly quality: number;
  readonly launched: boolean;
  readonly launchAt: number;
  readonly valuation: number;
  readonly equity: number;
  /** Founder's stake = equity × valuation: what decides a game that reaches the last turn. */
  readonly stake: number;
  readonly board: BoardView;
  /** The funding climate, when it is not the normal one. */
  readonly climate: Climate | null;
}

const boardOf = (company: Pick<Company, "founderSeats" | "investorSeats">): BoardView => ({
  founderSeats: company.founderSeats,
  investorSeats: company.investorSeats,
  control: company.investorSeats > company.founderSeats ? "investors" : company.investorSeats === company.founderSeats ? "tied" : "founders",
});

export const resourceView = (game: GameState, config: RulesConfig): ResourceView => {
  const self = game.companies[PLAYER_ID];
  const valuation = valuationOf(self.users, self.hype, game.climate.multiplier, config);
  return {
    companyName: self.name,
    turn: game.turn,
    maxTurns: config.game.maxTurns,
    cash: self.cash,
    runway: companyRunway(self, config),
    headcount: self.headcount,
    effectiveWork: effectiveWork(self.headcount, config.archetypes[self.archetype].workExponent),
    users: self.users,
    usersChange: usersChange(self.lastQuarter),
    ipoUsers: config.ipo.users,
    hype: self.hype,
    quality: self.quality,
    launched: self.launched,
    launchAt: config.quality.launchAt,
    valuation,
    equity: self.founderEquity,
    stake: founderStake(self.founderEquity, valuation),
    board: boardOf(self),
    climate: game.climate.turnsLeft > 0 ? game.climate : null,
  };
};

// ── Planning panel ──

export type WarningLevel = "danger" | "caution" | "note";

export interface Warning {
  readonly level: WarningLevel;
  readonly text: string;
}

export interface PriceOption {
  readonly tier: PriceTier;
  /** Dollars per user per quarter. */
  readonly price: number;
  readonly pullFactor: number;
  readonly churnDelta: number;
  readonly selected: boolean;
}

export interface RaiseOption {
  readonly percent: number;
  /** Exactly what the raise brings in this quarter. */
  readonly amount: number;
  readonly equityAfter: number;
  readonly investorSeatsAfter: number;
  /** This raise is the one that gives investors the majority of the board. */
  readonly handsOverBoard: boolean;
  readonly selected: boolean;
}

export interface RaiseView {
  readonly blocked: RaiseBlocker | null;
  readonly blockedText: string | null;
  readonly valuation: number;
  readonly options: readonly RaiseOption[];
}

export interface PoachOption {
  readonly id: CompanyId;
  readonly name: string;
  readonly headcount: number;
  /** Odds of success, 0–1. */
  readonly chance: number;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly selected: boolean;
}

export interface PlanningView {
  /** People who can be put to work this quarter, and how many of them have no department yet. */
  readonly available: number;
  readonly unassigned: number;
  /** What those people get done between them, after coordination drag. Someone off raising money adds nothing. */
  readonly workDone: number;
  /** The quarter as the engine would resolve this plan, rivals estimated from public information. */
  readonly projection: Projection;
  readonly prices: readonly PriceOption[];
  readonly raise: RaiseView;
  readonly poach: { readonly cost: number; readonly options: readonly PoachOption[] };
  readonly hiring: {
    /** Hires the recruiters can make this quarter. */
    readonly capacity: number;
    readonly wanted: number;
    /** Hires to expect once rivals with more hype have picked. */
    readonly expected: number;
    readonly fee: number;
    /** Candidates on the market this quarter, for everyone. */
    readonly candidates: number;
  };
  readonly layoffs: { readonly count: number; readonly max: number; readonly severance: number; readonly hype: number };
  readonly marketing: {
    readonly amount: number;
    readonly step: number;
    readonly max: number;
    /** What this quarter's event does to marketing: 1 normally, 0.5 when it is half as effective. */
    readonly effect: number;
    /** What the spend adds to pull, as a share, event included. */
    readonly pull: number;
  };
  /** Most serious first. */
  readonly warnings: readonly Warning[];
}

const LEVEL_ORDER: Record<WarningLevel, number> = { danger: 0, caution: 1, note: 2 };

const raiseView = (self: Company, game: GameState, draft: Plan, config: RulesConfig): RaiseView => {
  const valuation = valuationOf(self.users, self.hype, game.climate.multiplier, config);
  const blocked = raiseBlocker(self, game.turn, config);
  let blockedText: string | null = null;
  if (blocked === "users") blockedText = `Investors want to see ${config.raise.minUsers.toLocaleString("en-US")} users first.`;
  if (blocked === "cooldown" && self.lastRaise !== null) {
    const next = self.lastRaise.turn + config.raise.cooldownTurns + 1;
    blockedText =
      next > config.game.maxTurns
        ? `You raised in ${quarter(self.lastRaise.turn)}. There is no time for another raise before the game ends.`
        : `You raised in ${quarter(self.lastRaise.turn)}. You can raise again in ${quarter(next)}.`;
  }
  const investorSeatsAfter = self.investorSeats + 1;
  return {
    blocked,
    blockedText,
    valuation,
    options: config.raise.options.map((option) => ({
      percent: option,
      amount: raiseAmount(valuation, option),
      equityAfter: round6(self.founderEquity * (1 - option / 100)),
      investorSeatsAfter,
      handsOverBoard: investorSeatsAfter > self.founderSeats && self.investorSeats <= self.founderSeats,
      selected: draft.raisePercent === option,
    })),
  };
};

/**
 * The quarter if fewer new users arrive than expected. The expected figure runs a little high more
 * often than not, so a threshold the plan only just clears is one it could miss.
 */
const cautiousCase = (self: Company, projection: Projection, config: RulesConfig) => {
  const users = projection.users - Math.round(projection.usersWon * config.projection.cautiousShortfall);
  const revenue = revenueOf(users, projection.plan.price, config);
  const runway = runwayOf(projection.cash - (projection.revenue - revenue), revenue, projection.costs.total);
  return {
    users,
    profitable: revenue >= projection.costs.total,
    usersFell: users < self.usersAtLastClose,
    lowRunway: runway !== null && runway < config.board.runwayTurns,
  };
};

export const planningView = (game: GameState, draft: Plan, config: RulesConfig): PlanningView => {
  const self = game.companies[PLAYER_ID];
  const view = viewFor(game, PLAYER_ID);
  const projection = projectTurn(view, draft, config);
  const cautious = cautiousCase(self, projection, config);
  const idle = unassigned(self, draft);
  const raise = raiseView(self, game, draft, config);

  const warnings: Warning[] = [];
  const warn = (level: WarningLevel, text: string): void => {
    warnings.push({ level, text });
  };

  if (projection.cash < 0) {
    warn("danger", `This plan is expected to end the quarter at ${money(projection.cash)}. Below $0 you go bankrupt.`);
  } else if (projection.cashFloor < 0) {
    warn("caution", `Cash only stays above $0 if you win new users. With none, the quarter would end at ${money(projection.cashFloor)}.`);
  }
  // Clears the bar and turns a profit even in the cautious case: the company lists, and a listing ends the game
  // before any board gets to vote.
  const listing = projection.users >= config.ipo.users && projection.profitable && cautious.users >= config.ipo.users && cautious.profitable;
  if (listing) {
    // Nothing to say about the board.
  } else if (projection.boardRisk > 0) {
    warn("caution", `Investors control your board and this quarter looks bad to them: a ${percent(projection.boardRisk)} chance they fire you.`);
  } else if (projection.investorSeats > self.founderSeats && (cautious.usersFell || cautious.lowRunway)) {
    const what = cautious.usersFell ? "your users would fall" : `runway would drop under ${config.board.runwayTurns} turns`;
    warn("caution", `Close call: with ${percent(config.projection.cautiousShortfall)} fewer new users than expected, ${what}. That is a ${percent(config.board.fireChance)} chance your board fires you.`);
  }
  const chosenRaise = raise.options.find((option) => option.selected);
  if (chosenRaise?.handsOverBoard && projection.raise !== null) {
    warn("caution", `This raise gives investors the majority of your board, ${chosenRaise.investorSeatsAfter} seats to your ${self.founderSeats}. After a bad quarter they can fire you.`);
  }
  if (projection.users >= config.ipo.users) {
    const usersInHand = cautious.users >= config.ipo.users;
    if (!projection.profitable) {
      warn("caution", `${usersInHand ? "You have" : "You may reach"} the users to go public, but not the profit: revenue ${money(projection.revenue)} against costs ${money(projection.costs.total)}.`);
    } else if (listing) {
      warn("note", `On course to go public this quarter: ${count(config.ipo.users)} users and a profitable quarter.`);
    } else {
      warn("note", `You could go public this quarter: it takes ${count(config.ipo.users)} users and a profit, and this plan only gets there if you win the users you expect.`);
    }
  }
  if (!self.launched) {
    if (projection.launchedNow) warn("note", "Your product launches this quarter and starts winning users.");
    else warn("note", `Your product launches at quality ${config.quality.launchAt}. This plan takes it to ${Math.floor(projection.quality)}.`);
  }
  if (idle > 0) warn("note", `${people(idle)} unassigned: they will be put to work for you, following your split.`);
  for (const note of projection.notes) {
    // The split being refitted is what the line above already says.
    if (!note.startsWith("Team split refitted")) warn("note", note);
  }
  if (game.turn >= config.game.maxTurns) {
    warn("note", "Final quarter. If nobody goes public, the largest founder's stake (equity × valuation) wins.");
  }

  return {
    available: peopleAvailable(self, draft),
    unassigned: idle,
    workDone: projection.work.product + projection.work.growth + projection.work.recruiting,
    projection,
    prices: PRICE_TIERS.map((tier) => ({ tier, ...config.priceTiers[tier], selected: draft.price === tier })),
    raise,
    poach: {
      cost: config.poach.cost,
      options: view.rivals
        .filter((rival) => rival.out === null)
        .map((rival) => {
          const allowed = rival.headcount >= poachFloor(config);
          return {
            id: rival.id,
            name: rival.name,
            headcount: rival.headcount,
            chance: poachChance(self.hype, rival.hype, config),
            allowed,
            reason: allowed ? null : `Too small to poach from: a company needs ${people(poachFloor(config))}.`,
            selected: draft.poachTarget === rival.id,
          };
        }),
    },
    hiring: {
      capacity: hiringCapacity(projection.work.recruiting, config),
      wanted: projection.hiresWanted,
      expected: projection.hires,
      fee: config.hiring.fee,
      candidates: config.hiring.candidatesPerTurn + game.modifiers.extraCandidates + game.freedPeople + projection.plan.layoffs,
    },
    layoffs: { count: draft.layoffs, max: Math.max(0, self.headcount - 1), severance: config.layoff.severance, hype: config.layoff.hype },
    marketing: {
      amount: draft.marketing,
      step: config.pull.marketingStep,
      max: config.pull.maxMarketing,
      effect: game.modifiers.marketing,
      pull: marketingPull(projection.plan.marketing, game.modifiers.marketing, config),
    },
    warnings: warnings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]),
  };
};

// ── Rivals panel ──

export interface RivalRow {
  readonly id: CompanyId;
  readonly name: string;
  readonly pitch: string;
  readonly users: number;
  readonly usersChange: number | null;
  readonly headcount: number;
  readonly quality: number;
  readonly hype: number;
  readonly price: PriceTier;
  readonly launched: boolean;
  readonly valuation: number;
  readonly equity: number;
  readonly board: BoardView;
  readonly investorControlled: boolean;
  readonly lastRaise: LastRaise | null;
  readonly lastQuarter: QuarterStats | null;
  readonly out: Exit | null;
}

export const rivalsView = (game: GameState, config: RulesConfig): RivalRow[] =>
  game.companies
    .filter((company) => company.id !== PLAYER_ID)
    .map(publicCompany)
    .map((rival) => ({
      id: rival.id,
      name: rival.name,
      pitch: rival.pitch,
      users: rival.users,
      usersChange: rival.out === null ? usersChange(rival.lastQuarter) : null,
      headcount: rival.headcount,
      quality: rival.quality,
      hype: rival.hype,
      price: rival.price,
      launched: rival.launched,
      valuation: valuationOf(rival.users, rival.hype, game.climate.multiplier, config),
      equity: rival.founderEquity,
      board: boardOf(rival),
      investorControlled: rival.investorSeats > rival.founderSeats,
      lastRaise: rival.lastRaise,
      lastQuarter: rival.lastQuarter,
      out: rival.out,
    }));

// ── Event banner ──

export interface EventView {
  readonly cardId: string;
  readonly name: string;
  readonly text: string;
  readonly targetId: CompanyId | null;
  /** The company it hit, by name. */
  readonly target: string | null;
  readonly targetIsYou: boolean;
}

export const eventView = (event: ActiveEvent | null, game: GameState, config: RulesConfig): EventView | null => {
  if (event === null) return null;
  const card = findCard(event.cardId, config);
  if (card === undefined) return null;
  return {
    cardId: card.id,
    name: card.name,
    text: card.text,
    targetId: event.targetId,
    target: event.targetId === null ? null : (game.companies[event.targetId]?.name ?? null),
    targetIsYou: event.targetId === PLAYER_ID,
  };
};

// ── Quarterly report ──

export interface ReportView {
  /** The quarter this reports on. */
  readonly turn: number;
  /** The event that was in force, and the one revealed for the coming quarter. */
  readonly event: EventView | null;
  readonly nextEvent: EventView | null;
  readonly books: {
    readonly revenue: number;
    readonly costs: CostBreakdown;
    readonly raise: CompanyReport["raise"];
    readonly cashStart: number;
    readonly cashEnd: number;
    readonly profitable: boolean;
    readonly runway: number | null;
  };
  readonly users: CompanyReport["users"];
  readonly people: {
    /** At last quarter's close, before this quarter's event: start, less the losses, plus the arrivals, is the end. */
    readonly start: number;
    readonly lostToEvent: number;
    readonly laidOff: number;
    readonly hired: number;
    readonly hiresWanted: number;
    readonly poachedIn: number;
    readonly poachedOut: number;
    readonly end: number;
  };
  readonly product: CompanyReport["quality"];
  readonly hype: CompanyReport["hype"];
  readonly poach: { readonly target: string; readonly chance: number; readonly success: boolean } | null;
  readonly board: CompanyReport["board"];
  readonly valuation: number;
  readonly equity: number;
  readonly market: { readonly newUsers: number; readonly pool: number; readonly candidates: number };
  /** What the engine changed in the player's plan, in plain words. */
  readonly notes: readonly string[];
  /** What the rivals did, as far as anyone can see. */
  readonly moves: readonly string[];
  /** Users and staff set free by rivals that went out this quarter; null if none did. */
  readonly released: { readonly users: number; readonly people: number } | null;
  /** Set when the player's own company went out this quarter. */
  readonly out: OutReason | null;
}

const movesOf = (game: GameState, log: TurnLog): string[] => {
  const nameOf = (id: CompanyId): string => game.companies[id].name;
  const moves: string[] = [];
  for (const full of log.companies) {
    if (full === null || full.companyId === PLAYER_ID) continue;
    const report = publicReport(full);
    const name = nameOf(report.companyId);
    if (report.quality.launchedNow) moves.push(`${name} launched its product.`);
    if (report.raise !== null) moves.push(`${name} raised ${money(report.raise.amount)} for ${report.raise.percent}% of the company.`);
    if (report.poach !== null) {
      const yours = report.poach.targetId === PLAYER_ID;
      if (report.poach.success) moves.push(yours ? `${name} poached one of your people.` : `${name} poached someone from ${nameOf(report.poach.targetId)}.`);
      else moves.push(yours ? `${name} tried to poach one of your people and failed.` : `${name} tried to poach from ${nameOf(report.poach.targetId)} and failed.`);
    }
    if (report.headcount.laidOff > 0) moves.push(`${name} laid off ${people(report.headcount.laidOff)}.`);
    if (report.headcount.hired > 0) moves.push(`${name} hired ${people(report.headcount.hired)}.`);
    if (report.out === "bankrupt") moves.push(`${name} went bankrupt and shut down.`);
    if (report.out === "fired") moves.push(`${name}'s board fired its founder. The company shut down.`);
  }
  return moves;
};

/** null when the player's company took no part in that quarter. */
export const reportView = (game: GameState, log: TurnLog, config: RulesConfig): ReportView | null => {
  const report = log.companies[PLAYER_ID];
  if (!report) return null;
  const gone = game.companies.filter((company) => company.id !== PLAYER_ID && company.out !== null && company.out.turn === log.turn);
  return {
    turn: log.turn,
    event: eventView(log.event, game, config),
    nextEvent: eventView(log.nextEvent, game, config),
    books: {
      revenue: report.revenue,
      costs: report.costs,
      raise: report.raise,
      cashStart: report.cash.start,
      cashEnd: report.cash.end,
      profitable: report.profitable,
      runway: report.runway,
    },
    users: report.users,
    people: {
      start: report.headcount.start + report.headcount.lostToEvent,
      lostToEvent: report.headcount.lostToEvent,
      laidOff: report.headcount.laidOff,
      hired: report.hiring.hired,
      hiresWanted: report.hiring.wanted,
      poachedIn: report.headcount.poachedIn,
      poachedOut: report.headcount.poachedOut,
      end: report.headcount.end,
    },
    product: report.quality,
    hype: report.hype,
    poach: report.poach ? { target: game.companies[report.poach.targetId].name, chance: report.poach.chance, success: report.poach.success } : null,
    board: report.board,
    valuation: report.valuation,
    equity: report.equity,
    market: { newUsers: log.market.newUsers, pool: log.market.pool, candidates: log.hiring.candidates },
    notes: report.notes,
    moves: movesOf(game, log),
    released: gone.length === 0 ? null : { users: gone.reduce((sum, company) => sum + (company.out?.users ?? 0), 0), people: gone.reduce((sum, company) => sum + (company.out?.headcount ?? 0), 0) },
    out: report.out,
  };
};

// ── End screen ──

export type EndKind = "ipo-win" | "ipo-loss" | "stake-win" | "stake-loss" | "last-standing" | "bankrupt" | "fired";

export interface Standing {
  readonly id: CompanyId;
  readonly name: string;
  readonly pitch: string;
  readonly you: boolean;
  readonly winner: boolean;
  /** What kind of player it was, revealed now the game is over. */
  readonly type: string;
  /** For a company that went out: what it had when it did. */
  readonly users: number;
  readonly valuation: number;
  readonly equity: number;
  /** Founder's stake = equity × valuation. 0 for a company that is out. */
  readonly stake: number;
  readonly out: Exit | null;
}

export interface EndView {
  readonly kind: EndKind;
  readonly won: boolean;
  readonly sound: GameEndSound;
  /** The quarter the player's game ended in. */
  readonly turn: number;
  readonly title: string;
  readonly text: string;
  /** The winner, then the other companies still standing by founder's stake, then those that went out, latest first. */
  readonly standings: readonly Standing[];
}

const TYPE_LABEL: Record<Controller, string> = {
  human: "You",
  baseline: "Baseline bot",
  blitzscaler: "Blitzscaler",
  bootstrapper: "Bootstrapper",
  incumbent: "Incumbent",
};

const END_SOUND: Record<EndKind, GameEndSound> = {
  "ipo-win": "win",
  "stake-win": "win",
  "last-standing": "win",
  "ipo-loss": "loss",
  "stake-loss": "loss",
  bankrupt: "bankrupt",
  fired: "fired",
};

/** null while the player's game goes on. */
export const endView = (game: GameState, config: RulesConfig): EndView | null => {
  const self = game.companies[PLAYER_ID];
  const outcome = game.outcome;
  if (self.out === null && outcome === null) return null;

  const standings: Standing[] = game.companies
    .map((company) => {
      const valuation = company.out === null ? valuationOf(company.users, company.hype, game.climate.multiplier, config) : 0;
      return {
        id: company.id,
        name: company.name,
        pitch: company.pitch,
        you: company.id === PLAYER_ID,
        winner: outcome !== null && outcome.winnerId === company.id,
        type: TYPE_LABEL[company.controller],
        users: company.out?.users ?? company.users,
        valuation,
        equity: company.founderEquity,
        stake: founderStake(company.founderEquity, valuation),
        out: company.out,
      };
    })
    .sort((a, b) => {
      // Stake only decides a game that runs to the last turn: whoever won comes first, however it won.
      if (a.winner !== b.winner) return a.winner ? -1 : 1;
      if (a.out === null && b.out === null) return b.stake - a.stake || b.valuation - a.valuation || a.id - b.id;
      if (a.out !== null && b.out !== null) return b.out.turn - a.out.turn || a.id - b.id;
      return a.out === null ? -1 : 1;
    });

  const you = standings.find((standing) => standing.you);
  const winner = standings.find((standing) => standing.winner);
  const turn = self.out?.turn ?? outcome?.turn ?? game.turn;
  const when = quarter(turn);

  let kind: EndKind;
  if (self.out !== null) kind = self.out.reason;
  else if (outcome?.kind === "ipo") kind = outcome.winnerId === PLAYER_ID ? "ipo-win" : "ipo-loss";
  else if (outcome?.kind === "lastStanding") kind = "last-standing";
  else kind = outcome?.winnerId === PLAYER_ID ? "stake-win" : "stake-loss";

  const rival = winner?.name ?? "A rival";
  const copy: Record<EndKind, { title: string; text: string }> = {
    "ipo-win": {
      title: `${self.name} went public.`,
      text: `${count(self.users)} users and a profitable quarter in ${when}. You win.`,
    },
    "ipo-loss": {
      title: `${rival} went public first.`,
      text: `${rival} listed in ${when} with ${count(winner?.users ?? 0)} users. The game ends the moment anyone goes public.`,
    },
    "stake-win": {
      title: "You finished on top.",
      text: `Nobody went public in ${config.game.maxTurns} quarters. Your founder's stake, ${money(you?.stake ?? 0)}, is the largest.`,
    },
    "stake-loss": {
      title: `${rival} finished on top.`,
      text: `Nobody went public in ${config.game.maxTurns} quarters. ${rival}'s founder holds ${money(winner?.stake ?? 0)}; your stake is ${money(you?.stake ?? 0)}.`,
    },
    "last-standing": {
      title: "Last one standing.",
      text: `Every rival was out of business by ${when}. You win.`,
    },
    bankrupt: {
      title: `${self.name} ran out of cash.`,
      text: `You ended ${when} below $0. The company is bankrupt.`,
    },
    fired: {
      title: "Your board fired you.",
      text: `Investors held the majority of the board, and ${when} was a bad quarter.`,
    },
  };

  return { kind, won: kind === "ipo-win" || kind === "stake-win" || kind === "last-standing", sound: END_SOUND[kind], turn, title: copy[kind].title, text: copy[kind].text, standings };
};
