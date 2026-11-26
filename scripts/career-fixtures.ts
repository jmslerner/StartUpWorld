// Career saves for the browser check (scripts/career-check.mjs): each one a game at the point where one of the
// career's events is about to happen on screen.
//
//   npx tsx scripts/career-fixtures.ts
//
// Prints one JSON object to stdout: for each fixture the save (as the store writes it under the career's key) and
// the year it opens on. `listing` also carries the amount going public brings, as the plan writes it. Every save is
// read back with the store's own check before it is printed. Exits 1 when a search finds nothing within 200 seeds
// or a crafted fixture does not show its event.

import { baselinePlan } from "../src/ai/baselineBot";
import { choosePlans } from "../src/ai/choosePlans";
import { newGameSetup } from "../src/ai/names";
import { CAREER } from "../src/config";
import {
  CAREER_PITCHES,
  createGame,
  datedCardFor,
  defaultPlan,
  hiresWithinCap,
  listingOf,
  projectTurn,
  resolveTurn,
  rulesForTurn,
  viewFor,
  yearOf,
} from "../src/engine";
import { applyEvent } from "../src/engine/events";
import type { Company, GameState, Plan } from "../src/engine/types";
import { parseCareerSave, serializeCareerSave } from "../src/state/careerSave";
import { money } from "../src/ui/format";

const PLAYER = 0;
const NAME = "Check Co";
const SEARCH = 200;

interface Fixture {
  readonly save: string;
  readonly year: number;
}

const fail = (why: string): never => {
  console.error(`career-fixtures: ${why}`);
  process.exit(1);
};

const year = (turn: number): number => yearOf(turn, CAREER.career);

const newCareer = (seed: number): GameState => createGame(newGameSetup(seed, NAME, "human", CAREER_PITCHES), CAREER);

/**
 * A new career moved on to `turn`, as if its years had passed quietly: neutral climate and modifiers, and that
 * year's dated card dealt as a new game deals the first year's, or no card (always none when `deal` is false).
 */
const datedTo = (game: GameState, turn: number, deal = true): GameState => {
  const moved: GameState = {
    ...game,
    turn,
    climate: { multiplier: 1, turnsLeft: 0 },
    event: null,
    modifiers: { newUsers: 1, marketing: 1, extraCandidates: 0 },
    wave: { multiplier: 1, turnsLeft: 0 },
  };
  const card = deal ? datedCardFor(turn, CAREER) : null;
  if (card === null) return moved;
  const event = { cardId: card.id, targetId: null };
  const dealt = applyEvent(moved, event, CAREER);
  return {
    ...moved,
    companies: dealt.companies,
    carryOverUsers: dealt.carryOverUsers,
    climate: dealt.climate,
    event,
    modifiers: dealt.modifiers,
    wave: dealt.wave ?? moved.wave,
  };
};

/** The game with the player's company changed. */
const withPlayer = (game: GameState, change: (self: Company) => Company): GameState => ({
  ...game,
  companies: game.companies.map((company) => (company.id === PLAYER ? change(company) : company)),
});

/** The year resolved as the store resolves it, with `draft` as the player's plan. */
const playYear = (game: GameState, seed: number, draft: Plan) => {
  const human = game.companies.map((company) => (company.id === PLAYER ? draft : null));
  return resolveTurn(game, choosePlans(game, seed, CAREER, human), seed, CAREER);
};

/** The save the store writes, checked as the store reads it. */
const saveOf = (what: string, seed: number, game: GameState, draft: Plan = defaultPlan(game.companies[PLAYER])): Fixture => {
  const save = serializeCareerSave({ seed, game, draft, lastLog: null, reportOpen: false, record: [] });
  if (parseCareerSave(save, CAREER) === null) fail(`the ${what} save does not pass the career save's check`);
  return { save, year: year(game.turn) };
};

// ---------------------------------------------------------------------------------------------------------------
// Going public: the first opening, over seeds from 1, in which the player may go public and has not.

const listing = (() => {
  for (let seed = 1; seed <= SEARCH; seed++) {
    let state = newCareer(seed);
    while (state.outcome === null && state.companies[PLAYER].out === null) {
      const self = state.companies[PLAYER];
      if (self.career?.qualified === true && self.career.listed === null) {
        const amount = money(listingOf(self, state.climate.multiplier, rulesForTurn(CAREER, state.turn)).amount);
        return { ...saveOf("listing", seed, state), amount };
      }
      const plans = [...choosePlans(state, seed, CAREER)];
      plans[PLAYER] = baselinePlan(viewFor(state, PLAYER), CAREER);
      state = resolveTurn(state, plans, seed, CAREER).state;
    }
  }
  return fail(`no career within ${SEARCH} seeds reaches a year in which the player may go public`);
})();

// ---------------------------------------------------------------------------------------------------------------
// The rescue: 2001 with $1,000 in hand and nobody on Product, so the company cannot launch: the plan expects the year
// to end below $0, and it does, with the rescue unused.

const RESCUE_SEED = 1;
const RESCUE_TURN = 12;

const broke = withPlayer(datedTo(newCareer(RESCUE_SEED), RESCUE_TURN), (self) => ({ ...self, cash: 1000 }));
const idle = (game: GameState): Plan => {
  const self = game.companies[PLAYER];
  return { ...defaultPlan(self), allocation: { product: 0, growth: self.headcount, recruiting: 0 } };
};
const brokeDraft = idle(broke);
if (projectTurn(viewFor(broke, PLAYER), brokeDraft, CAREER).cash >= 0) fail("the rescue fixture's plan does not expect the year to end below $0");
const rescued = playYear(broke, RESCUE_SEED, brokeDraft);
if (rescued.log.companies[PLAYER]?.career?.rescue == null || rescued.state.companies[PLAYER].out !== null) {
  fail("the rescue fixture's year does not end in a rescue");
}
const rescue = saveOf("rescue", RESCUE_SEED, broke, brokeDraft);

// ---------------------------------------------------------------------------------------------------------------
// The second failure: the same, with the rescue used in 1994.

const brokeAgain = withPlayer(broke, (self) => ({ ...self, career: { ...self.career!, rescue: { turn: 5, reason: "bankrupt" } } }));
const ended = playYear(brokeAgain, RESCUE_SEED, brokeDraft);
if (ended.state.companies[PLAYER].out === null) fail("the failure fixture's year does not end the career");
const failure = saveOf("failure", RESCUE_SEED, brokeAgain, brokeDraft);

// ---------------------------------------------------------------------------------------------------------------
// The board: 2009, investors hold the board, users far below last year's, cash for years. The seed decides the vote.

const BOARD_TURN = 20;

const boardGame = (seed: number): GameState => {
  const game = datedTo(newCareer(seed), BOARD_TURN);
  const rules = rulesForTurn(CAREER, BOARD_TURN);
  return withPlayer(game, (self) => ({
    ...self,
    launched: true,
    quality: Math.max(self.quality, rules.quality.launchAt + 10),
    users: 2000,
    usersAtLastClose: 200000,
    founderSeats: 1,
    investorSeats: 3,
    cash: 20 * self.headcount * rules.salary + 1000000,
  }));
};

const board = (() => {
  for (let seed = 1; seed <= SEARCH; seed++) {
    const game = boardGame(seed);
    const { log } = playYear(game, seed, defaultPlan(game.companies[PLAYER]));
    const report = log.companies[PLAYER];
    if (report?.board?.fired === true && report.career?.rescue != null && report.cash.end >= 0) return saveOf("board", seed, game);
  }
  return fail(`no seed within ${SEARCH} makes the board fire the founder`);
})();

// ---------------------------------------------------------------------------------------------------------------
// An office move: 1990, four people in the garage, a plan that recruits past it, with hires capped so the team fits
// the shared office: the move is from the garage to the shared office.

const OFFICE_SEED = 1;
const SHARED = 1;
const officeStart = withPlayer(newCareer(OFFICE_SEED), (self) => ({
  ...self,
  headcount: 4,
  headcountAtLastClose: 4,
  cash: Math.max(self.cash, 10 * 4 * rulesForTurn(CAREER, 1).salary),
  career: { ...self.career!, office: 0 },
}));
const recruiting: Plan = {
  ...defaultPlan(officeStart.companies[PLAYER]),
  allocation: { product: 1, growth: 0, recruiting: 3 },
  hireLimit: CAREER.career.offices[SHARED].capacity - 4,
};
if (projectTurn(viewFor(officeStart, PLAYER), recruiting, CAREER).career?.office?.to !== SHARED) {
  fail("the office fixture's projection shows no move to the shared office");
}
if (playYear(officeStart, OFFICE_SEED, recruiting).log.companies[PLAYER]?.career?.office?.to !== SHARED) {
  fail("the office fixture's year ends without a move to the shared office");
}
const office = saveOf("office", OFFICE_SEED, officeStart, recruiting);

// ---------------------------------------------------------------------------------------------------------------
// A full campus: 2019, 150 people on the campus.

const CAMPUS_SEED = 1;
const CAMPUS_TURN = 30;
const campusRules = rulesForTurn(CAREER, CAMPUS_TURN);
const campusGame = withPlayer(datedTo(newCareer(CAMPUS_SEED), CAMPUS_TURN), (self) => ({
  ...self,
  headcount: 150,
  headcountAtLastClose: 150,
  cash: 3 * 150 * campusRules.salary,
  career: { ...self.career!, office: 4 },
}));
if (hiresWithinCap(1, campusGame.companies[PLAYER].headcount, campusRules) !== 0) fail("the campus fixture's team still has room");
const campus = saveOf("campus", CAMPUS_SEED, campusGame);

// ---------------------------------------------------------------------------------------------------------------
// Every era's look for the 3D check (scripts/office-check.mjs), each office half full, with cash for ten years of its
// salaries: 1994 (dial-up) in the shared office, 1997 (gold rush) in the shared office, 2004 (bust) in the third office,
// 2010 (phones) in the third, 2017 (cheap money) and 2023 (winter and AI) and 2029 (agents) in the fourth, 2035 (ambient)
// in the fifth. 2004's dated card is left undealt, so that one of the check's pages shows no news card.

const LOOKS_SEED = 1;
const decade = (what: string, turn: number, officeIndex: number, deal = true): Fixture => {
  const rules = rulesForTurn(CAREER, turn);
  const capacity = rules.career?.offices[officeIndex]?.capacity ?? fail(`the ${what} fixture's office ${officeIndex} has no capacity`);
  const headcount = Math.max(1, Math.floor(capacity / 2));
  const game = withPlayer(datedTo(newCareer(LOOKS_SEED), turn, deal), (self) => ({
    ...self,
    headcount,
    headcountAtLastClose: headcount,
    cash: Math.max(self.cash, 10 * headcount * rules.salary),
    career: { ...self.career!, office: officeIndex },
  }));
  return saveOf(what, LOOKS_SEED, game);
};
const nineties = decade("nineties", 5, 1);
const noughties = decade("noughties", 15, 2, false);
if (JSON.parse(noughties.save).game?.event != null) fail("the noughties fixture has a card in force");
const twenties = decade("twenties", 34, 3);
const goldRush = decade("gold-rush", 8, 1);
const phones = decade("phones", 21, 2);
const cheapMoney = decade("cheap-money", 28, 3);
const agents = decade("agents", 40, 3);
const ambient = decade("ambient", 46, 4);
for (const [what, fixture, want] of [
  ["nineties", nineties, 1994],
  ["noughties", noughties, 2004],
  ["twenties", twenties, 2023],
  ["gold-rush", goldRush, 1997],
  ["phones", phones, 2010],
  ["cheap-money", cheapMoney, 2017],
  ["agents", agents, 2029],
  ["ambient", ambient, 2035],
] as const) {
  if (fixture.year !== want) fail(`the ${what} fixture opens on ${fixture.year}, not ${want}`);
}

console.log(JSON.stringify({ listing, rescue, failure, board, office, campus, nineties, noughties, twenties, goldRush, phones, cheapMoney, agents, ambient }));
