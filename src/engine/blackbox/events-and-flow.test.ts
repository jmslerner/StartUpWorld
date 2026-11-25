// Black-box tests of the events and of the flow of a game.
//
// Written from docs/turn-based-design.md alone (the "Events" section, "Order of a turn" and rulings 1, 2, 7,
// 9 to 12, 16, 18, 20 and 24 to 26), on the design's starting numbers (src/config.design.ts). The
// implementation was not read. Every expected number is worked out by hand in the comment above its assertion.
//
// Two devices keep the arithmetic exact:
//   - A deck that holds only the card under test, drawn with chance 1 (or chance 0 to switch events off).
//   - HUMAN plus a bystander. With one company left the game would be over ("last company standing wins"),
//     so BOOT stays in as one person who never builds: it never launches, has no pull, hires nobody and,
//     with a team of 1, can be hit by neither burnout nor a breach.

import { describe, expect, it } from "vitest";

import { DESIGN } from "../../config.design";
import { PRICE_TIERS, defaultPlan, publicCompany, publicReport, replayGame, resolveTurn, viewFor } from "../index";
import type {
  Allocation,
  CompanyId,
  CompanyReport,
  EventCard,
  GameRecord,
  GameState,
  Plan,
  PlanSet,
  RulesConfig,
  TurnLog,
  TurnResult,
} from "../index";
import { STREAM, firstFloat } from "../rng";
import {
  BLITZ,
  BOOT,
  FOUR_SEATS,
  HUMAN,
  INCUMBENT,
  launchedCompany,
  newGame,
  onlyActive,
  plansOf,
  reportFor,
  resolve,
  seedWhere,
  usersInSystem,
  withCompany,
  withState,
} from "../testKit";

// ── Helpers ──

type Patches = Readonly<Record<number, Partial<Plan>>>;

const split = (product: number, growth: number, recruiting: number): Allocation => ({ product, growth, recruiting });

const card = (id: string): EventCard => {
  const found = DESIGN.events.deck.find((entry) => entry.id === id);
  if (!found) throw new Error(`the design's deck has no card "${id}"`);
  return found;
};

/** The design's numbers with another deck. Chance 1 makes the draw certain. */
const withDeck = (deck: readonly EventCard[], chance = 1, firstTurn = DESIGN.events.firstTurn): RulesConfig => ({
  ...DESIGN,
  events: { firstTurn, chance, deck },
});
const only = (id: string): RulesConfig => withDeck([card(id)]);
/** The design's deck, never drawn. */
const QUIET = withDeck(DESIGN.events.deck, 0);
/** The design's deck, drawn every turn. */
const SURE = withDeck(DESIGN.events.deck, 1);

const NEUTRAL = { newUsers: 1, marketing: 1, extraCandidates: 0 };
const NORMAL = { multiplier: 1, turnsLeft: 0 };

/** A fresh game moved to the given turn. */
const at = (turn: number): GameState => withState(newGame(), { turn });

/**
 * HUMAN and the bystander (see the top of the file). HUMAN gets $5M: on its $500K, three salaries a turn and
 * no revenue would bankrupt it on the fifth turn played and end the game under the test.
 */
const duo = (state: GameState): GameState =>
  withCompany(
    withCompany(onlyActive(state, [HUMAN, BOOT]), BOOT, { headcount: 1, headcountAtLastClose: 1 }),
    HUMAN,
    { cash: 5_000_000 },
  );
const BYSTANDER: Partial<Plan> = { allocation: split(0, 1, 0), marketing: 0, price: "standard", hireLimit: 0 };

/** Everyone on Growth: no product work, so quality only decays and an unlaunched product stays unlaunched; nobody is hired. */
const idle = (people: number): Partial<Plan> => ({
  allocation: split(0, people, 0),
  marketing: 0,
  price: "standard",
  hireLimit: 0,
});

/** One turn of the duo. */
const play = (state: GameState, human: Partial<Plan>, config: RulesConfig, seed = 1): TurnResult =>
  resolve(state, { [HUMAN]: human, [BOOT]: BYSTANDER }, seed, config);

/** HUMAN launched at quality 40 with 10,000 users now and at the last close. */
const goingConcern = (state: GameState): GameState => launchedCompany(state, HUMAN, { quality: 40 });

/**
 * HUMAN opens this turn launched with 10,000 users and 20 hype, and sells 10%: one person raises, two work.
 * The waiting pool is emptied so that the market gives HUMAN exactly this turn's new users.
 */
const raiseNow = (state: GameState): CompanyReport => {
  const ready = withState(
    withCompany(state, HUMAN, {
      launched: true,
      quality: 40,
      users: 10_000,
      usersAtLastClose: 10_000,
      hype: 20,
      cash: 1_000_000,
    }),
    { carryOverUsers: 0 },
  );
  return reportFor(play(ready, { ...idle(2), raisePercent: 10 }, QUIET), HUMAN);
};

/** Every key that appears anywhere inside a value. */
const keysDeep = (value: unknown, found: Set<string> = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, found));
  else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysDeep(inner, found);
    }
  }
  return found;
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The log with one company's notes blanked; every other company's notes stay and are compared. */
const withoutNotesOf = (log: TurnLog, id: CompanyId) => ({
  ...log,
  companies: log.companies.map((report) => (report && report.companyId === id ? { ...report, notes: [] } : report)),
});

/**
 * "Anything illegal is fixed up or dropped at no cost, and the report says so": apart from that company's
 * notes, the turn is exactly the one the legal plan gives.
 */
const expectFixedUp = (state: GameState, illegal: Patches, legal: Patches, id: CompanyId = HUMAN, seed = 1): TurnResult => {
  const fixed = resolve(state, illegal, seed, QUIET);
  const clean = resolve(state, legal, seed, QUIET);
  expect(reportFor(clean, id).notes).toEqual([]);
  expect(reportFor(fixed, id).notes.length).toBeGreaterThan(0);
  for (const note of reportFor(fixed, id).notes) expect(note.trim().length).toBeGreaterThan(0);
  expect(fixed.state).toEqual(clean.state);
  expect(withoutNotesOf(fixed.log, id)).toEqual(withoutNotesOf(clean.log, id));
  return fixed;
};

/** A fixed script of legal plans: defaults, with HUMAN varying its marketing and its price. */
const scripted = (state: GameState): PlanSet =>
  plansOf(state, { [HUMAN]: { marketing: 25_000 * (state.turn % 3), price: PRICE_TIERS[state.turn % 3] } });

const playScript = (seed: number, turns: number, config: RulesConfig = DESIGN) => {
  let state = newGame(config);
  const plans: PlanSet[] = [];
  const logs: TurnLog[] = [];
  const states: GameState[] = [state];
  while (!state.outcome && logs.length < turns) {
    const set = scripted(state);
    const result = resolveTurn(state, set, seed, config);
    plans.push(set);
    logs.push(result.log);
    states.push(result.state);
    state = result.state;
  }
  return { state, plans, logs, states };
};

// ── Events: when they happen ──

describe("events: when they happen", () => {
  it("a new game opens on turn 1 with no event, a normal climate and neutral modifiers", () => {
    const state = newGame();
    expect(state.turn).toBe(1);
    expect(state.event).toBeNull();
    expect(state.climate).toEqual(NORMAL);
    expect(state.modifiers).toEqual(NEUTRAL);
  });

  it("there is no event before turn 3, even at a 100% chance", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const first = resolve(newGame(), {}, seed, SURE);
      expect(first.log.event).toBeNull();
      expect(first.log.nextEvent).toBeNull();
      expect(first.state.turn).toBe(2);
      expect(first.state.event).toBeNull();
      expect(first.state.modifiers).toEqual(NEUTRAL);
      expect(first.state.climate).toEqual(NORMAL);

      const second = resolve(first.state, {}, seed, SURE);
      expect(second.log.event).toBeNull();
      expect(second.state.turn).toBe(3);
      // Turn 3 is the first turn that can have one, and at 100% it does.
      expect(second.state.event).not.toBeNull();
    }
  });

  it("the state a turn returns holds the next turn's event, log.nextEvent names it and the next log reports it", () => {
    let state = at(2);
    for (let turn = 2; turn <= 6; turn++) {
      const before = state;
      const result = resolve(before, {}, 3, SURE);
      expect(result.log.turn).toBe(turn);
      expect(result.log.event).toEqual(before.event);
      expect(result.state.turn).toBe(turn + 1);
      expect(result.state.event).not.toBeNull();
      expect(result.log.nextEvent).toEqual(result.state.event);
      expect(DESIGN.events.deck.map((entry) => entry.id)).toContain(result.state.event?.cardId);
      state = result.state;
    }
  });

  it("at a 0% chance no turn ever has an event", () => {
    let state = newGame();
    for (let turn = 1; turn <= 8; turn++) {
      const result = resolve(state, {}, 5, QUIET);
      expect(result.log.nextEvent).toBeNull();
      expect(result.state.event).toBeNull();
      expect(result.state.modifiers).toEqual(NEUTRAL);
      expect(result.state.climate).toEqual(NORMAL);
      state = result.state;
    }
  });

  it("50% chance: turn 3 has an event exactly when the turn-3 event roll is under 0.5, about half the time", () => {
    const state = at(2);
    let events = 0;
    for (let seed = 1; seed <= 1_000; seed++) {
      const drawn = resolve(state, {}, seed, DESIGN).state.event !== null;
      expect(drawn).toBe(firstFloat(seed, 3, STREAM.eventRoll) < 0.5);
      if (drawn) events++;
    }
    // 1,000 fair coins: mean 500, standard deviation 15.8. 420 to 580 is five standard deviations either way.
    expect(events).toBeGreaterThan(420);
    expect(events).toBeLessThan(580);
  });

  it("every later turn rolls for itself: turn T has an event exactly when its own roll is under 0.5", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let state = newGame();
      while (!state.outcome && state.turn < 8) {
        state = resolve(state, {}, seed, DESIGN).state;
        if (state.outcome) break;
        const expected = state.turn >= 3 && firstFloat(seed, state.turn, STREAM.eventRoll) < 0.5;
        expect(state.event !== null).toBe(expected);
      }
    }
  });

  it("the nine cards of the starting deck are equally likely (every card has weight 1)", () => {
    const state = at(2);
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 900; seed++) {
      const id = resolve(state, {}, seed, SURE).state.event?.cardId ?? "none";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(DESIGN.events.deck.map((entry) => entry.id).sort());
    // 900 draws over 9 cards: mean 100 each, standard deviation 9.4. 55 to 145 is almost five either way.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(55);
      expect(count).toBeLessThan(145);
    }
  });

  it("a card with three times the weight is drawn three times as often", () => {
    const deck = withDeck([{ ...card("talent-glut"), weight: 3 }, card("market-boom")]);
    const state = at(2);
    let heavy = 0;
    for (let seed = 1; seed <= 400; seed++) {
      if (resolve(state, {}, seed, deck).state.event?.cardId === "talent-glut") heavy++;
    }
    // 400 draws at 3 in 4: mean 300, standard deviation 8.7.
    expect(heavy).toBeGreaterThan(255);
    expect(heavy).toBeLessThan(345);
  });

  it("the first event turn is a number in config", () => {
    const late = withDeck(DESIGN.events.deck, 1, 5);
    let state = newGame();
    const seen: boolean[] = [];
    for (let turn = 1; turn <= 5; turn++) {
      state = resolve(state, {}, 2, late).state;
      seen.push(state.event !== null);
    }
    // States of turns 2, 3, 4, 5 and 6: nothing before turn 5.
    expect(seen).toEqual([false, false, false, true, true]);
  });

  it("the game's last turn draws no event for a turn that will not be played", () => {
    const result = play(goingConcern(duo(at(20))), idle(3), only("viral-moment"));
    expect(result.log.turn).toBe(20);
    expect(result.state.outcome?.kind).toBe("turnLimit");
    expect(result.state.outcome?.turn).toBe(20);
    expect(result.log.outcome).toEqual(result.state.outcome);
    // "Stays on the final turn once the game is over."
    expect(result.state.turn).toBe(20);
    expect(result.log.nextEvent).toBeNull();
    expect(result.state.event).toBeNull();
  });
});

// ── Funding climate ──

describe("events: funding winter and hot market", () => {
  it("funding winter lasts 3 turns, counting the one it is revealed in", () => {
    const reveal = play(duo(at(2)), idle(3), only("funding-winter"));
    // Turn 2 itself is still normal.
    expect(reveal.log.climateMultiplier).toBe(1);
    expect(reveal.state.event).toEqual({ cardId: "funding-winter", targetId: null });
    expect(reveal.log.nextEvent).toEqual({ cardId: "funding-winter", targetId: null });
    expect(reveal.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });

    const turn3 = play(reveal.state, idle(3), QUIET);
    expect(turn3.log.event).toEqual({ cardId: "funding-winter", targetId: null });
    expect(turn3.log.climateMultiplier).toBe(0.6);
    expect(turn3.state.event).toBeNull();
    expect(turn3.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 2 });

    const turn4 = play(turn3.state, idle(3), QUIET);
    expect(turn4.log.climateMultiplier).toBe(0.6);
    expect(turn4.state.climate).toEqual({ multiplier: 0.6, turnsLeft: 1 });

    const turn5 = play(turn4.state, idle(3), QUIET);
    expect(turn5.log.climateMultiplier).toBe(0.6);
    expect(turn5.state.climate).toEqual(NORMAL);

    const turn6 = play(turn5.state, idle(3), QUIET);
    expect(turn6.log.climateMultiplier).toBe(1);
    expect(turn6.state.climate).toEqual(NORMAL);
  });

  it("a raise in each of the 3 winter turns is priced at x0.6, and at full price on the 4th", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const turn4 = play(turn3, idle(3), QUIET).state;
    const turn5 = play(turn4, idle(3), QUIET).state;
    const turn6 = play(turn5, idle(3), QUIET).state;
    for (const state of [turn3, turn4, turn5]) {
      const raise = raiseNow(state).raise;
      // Valuation = 10,000 users × $150 × (1 + 20/100) × 0.6 = $1,080,000. 10% of it = $108,000.
      expect(raise?.percent).toBe(10);
      expect(raise?.valuation).toBeCloseTo(1_080_000, 0);
      expect(raise?.amount).toBeCloseTo(108_000, 0);
    }
    // Turn 6: 10,000 × $150 × 1.2 × 1 = $1,800,000. 10% = $180,000.
    const after = raiseNow(turn6).raise;
    expect(after?.valuation).toBeCloseTo(1_800_000, 0);
    expect(after?.amount).toBeCloseTo(180_000, 0);
  });

  it("the money raised in a winter arrives at the winter price", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const report = raiseNow(turn3);
    // Users end at 10,000 + 24,200 new (turn 3; the only launched product takes the whole pool, its own churn
    // included) = 34,200. Revenue = 34,200 × $3 = $102,600. Costs = 3 salaries = $120,000.
    // Cash = $1,000,000 + $108,000 raised + $102,600 − $120,000 = $1,090,600.
    expect(report.users.end).toBe(34_200);
    expect(report.cash.start).toBe(1_000_000);
    expect(report.cash.end).toBe(1_090_600);
  });

  it("the end-of-turn valuation carries the winter through its third turn and not into the fourth", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const turn4 = play(turn3, idle(3), QUIET).state;
    const turn5 = play(turn4, idle(3), QUIET).state;
    const turn6 = play(turn5, idle(3), QUIET).state;
    // End-of-turn hype: 20 × 0.8 = 16, +10 for the raise, +5 for growing 25%+ = 31.
    // Turn 3: users 10,000 + 24,200 = 34,200. 34,200 × $150 × 1.31 × 0.6 = $4,032,180.
    expect(Math.abs(raiseNow(turn3).valuation - 4_032_180)).toBeLessThanOrEqual(1);
    // Turn 5: users 10,000 + 29,282 = 39,282. 39,282 × $150 × 1.31 × 0.6 = $4,631,347.80.
    expect(Math.abs(raiseNow(turn5).valuation - 4_631_347.8)).toBeLessThanOrEqual(1);
    // Turn 6: users 10,000 + 32,210 = 42,210. 42,210 × $150 × 1.31 × 1 = $8,294,265.
    expect(Math.abs(raiseNow(turn6).valuation - 8_294_265)).toBeLessThanOrEqual(1);
  });

  it("hot market lasts 2 turns at x1.4", () => {
    const reveal = play(duo(at(2)), idle(3), only("hot-market"));
    expect(reveal.state.event).toEqual({ cardId: "hot-market", targetId: null });
    expect(reveal.state.climate).toEqual({ multiplier: 1.4, turnsLeft: 2 });

    const turn3 = play(reveal.state, idle(3), QUIET);
    expect(turn3.log.climateMultiplier).toBe(1.4);
    expect(turn3.state.climate).toEqual({ multiplier: 1.4, turnsLeft: 1 });

    const turn4 = play(turn3.state, idle(3), QUIET);
    expect(turn4.log.climateMultiplier).toBe(1.4);
    expect(turn4.state.climate).toEqual(NORMAL);

    for (const state of [reveal.state, turn3.state]) {
      const raise = raiseNow(state).raise;
      // 10,000 × $150 × 1.2 × 1.4 = $2,520,000. 10% = $252,000.
      expect(raise?.valuation).toBeCloseTo(2_520_000, 0);
      expect(raise?.amount).toBeCloseTo(252_000, 0);
    }
    // Turn 5 is back to 10,000 × $150 × 1.2 = $1,800,000.
    expect(raiseNow(turn4.state).raise?.valuation).toBeCloseTo(1_800_000, 0);
  });

  it("a hot market replaces a running winter", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const turn4 = play(turn3, idle(3), only("hot-market")).state;
    expect(turn4.event).toEqual({ cardId: "hot-market", targetId: null });
    expect(turn4.climate).toEqual({ multiplier: 1.4, turnsLeft: 2 });
    const turn5 = play(turn4, idle(3), QUIET).state;
    expect(turn5.climate).toEqual({ multiplier: 1.4, turnsLeft: 1 });
    // Turn 5 would have been the winter's third turn; it is the hot market's second instead.
    expect(raiseNow(turn5).raise?.valuation).toBeCloseTo(2_520_000, 0);
    const turn6 = play(turn5, idle(3), QUIET).state;
    expect(turn6.climate).toEqual(NORMAL);
    expect(raiseNow(turn6).raise?.valuation).toBeCloseTo(1_800_000, 0);
  });

  it("a winter replaces a running hot market and runs its own 3 turns", () => {
    const turn3 = play(duo(at(2)), idle(3), only("hot-market")).state;
    const turn4 = play(turn3, idle(3), only("funding-winter")).state;
    expect(turn4.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });
    // The hot market's second turn is priced as winter.
    expect(raiseNow(turn4).raise?.valuation).toBeCloseTo(1_080_000, 0);
    const turn5 = play(turn4, idle(3), QUIET).state;
    expect(turn5.climate).toEqual({ multiplier: 0.6, turnsLeft: 2 });
    const turn6 = play(turn5, idle(3), QUIET).state;
    expect(turn6.climate).toEqual({ multiplier: 0.6, turnsLeft: 1 });
    expect(raiseNow(turn6).raise?.valuation).toBeCloseTo(1_080_000, 0);
    const turn7 = play(turn6, idle(3), QUIET).state;
    expect(turn7.climate).toEqual(NORMAL);
  });

  it("a second winter starts the 3 turns again", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const turn4 = play(turn3, idle(3), only("funding-winter")).state;
    expect(turn4.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });
    const turn5 = play(turn4, idle(3), QUIET).state;
    const turn6 = play(turn5, idle(3), QUIET).state;
    expect(turn6.climate).toEqual({ multiplier: 0.6, turnsLeft: 1 });
    expect(play(turn6, idle(3), QUIET).state.climate).toEqual(NORMAL);
  });

  it("an event of another kind leaves the running climate alone", () => {
    const turn3 = play(duo(at(2)), idle(3), only("funding-winter")).state;
    const turn4 = play(turn3, idle(3), only("talent-glut")).state;
    expect(turn4.event).toEqual({ cardId: "talent-glut", targetId: null });
    expect(turn4.climate).toEqual({ multiplier: 0.6, turnsLeft: 2 });
    const turn5 = play(turn4, idle(3), QUIET).state;
    expect(turn5.climate).toEqual({ multiplier: 0.6, turnsLeft: 1 });
    expect(play(turn5, idle(3), QUIET).state.climate).toEqual(NORMAL);
  });
});

// ── Viral moment ──

describe("events: viral moment", () => {
  const viral = only("viral-moment");
  const start = duo(at(2));
  const targetOf = (seed: number) => play(start, idle(3), viral, seed).state.event?.targetId;

  it("gives one company +20 hype and nobody else anything", () => {
    const hitsHuman = seedWhere((seed) => targetOf(seed) === HUMAN);
    const hitsBoot = seedWhere((seed) => targetOf(seed) === BOOT);

    const first = play(start, idle(3), viral, hitsHuman).state;
    expect(first.event).toEqual({ cardId: "viral-moment", targetId: HUMAN });
    // Both companies close turn 2 on 10 × 0.8 = 8 hype (nothing launched, raised, grew or was laid off).
    // The target: 8 + 20 = 28.
    expect(first.companies[HUMAN].hype).toBeCloseTo(28, 4);
    expect(first.companies[BOOT].hype).toBeCloseTo(8, 4);

    const second = play(start, idle(3), viral, hitsBoot).state;
    expect(second.event).toEqual({ cardId: "viral-moment", targetId: BOOT });
    expect(second.companies[BOOT].hype).toBeCloseTo(28, 4);
    expect(second.companies[HUMAN].hype).toBeCloseTo(8, 4);
  });

  it("is a one-off: the hype is there at the start of the turn and then decays like any other", () => {
    const hitsHuman = seedWhere((seed) => targetOf(seed) === HUMAN);
    const revealed = play(start, idle(3), viral, hitsHuman).state;
    const next = play(revealed, idle(3), QUIET, hitsHuman);
    expect(reportFor(next, HUMAN).hype.start).toBeCloseTo(28, 4);
    // 28 × 0.8 = 22.4, and no second +20.
    expect(reportFor(next, HUMAN).hype.end).toBeCloseTo(22.4, 4);
    expect(next.state.companies[HUMAN].hype).toBeCloseTo(22.4, 4);
    expect(next.state.event).toBeNull();
    // What rivals are shown of that quarter: the hype it opened on, after its event (ruling 18).
    expect(next.state.companies[HUMAN].lastQuarter?.hypeAtOpen).toBeCloseTo(28, 4);
  });

  it("picks at random among all the companies in the game", () => {
    const state = at(2);
    const hits = [0, 0, 0, 0];
    for (let seed = 1; seed <= 400; seed++) {
      const result = resolve(state, {}, seed, viral).state;
      const quiet = resolve(state, {}, seed, QUIET).state;
      const target = result.event?.targetId;
      if (target === null || target === undefined) throw new Error("a viral moment needs a target");
      hits[target]++;
      for (const company of result.companies) {
        // The same turn without the card, plus 20 for the target (nobody is near the 100 cap here).
        const bonus = company.id === target ? 20 : 0;
        expect(company.hype).toBeCloseTo(quiet.companies[company.id].hype + bonus, 4);
      }
    }
    // 400 draws over 4 companies: mean 100 each, standard deviation 8.7.
    for (const count of hits) {
      expect(count).toBeGreaterThan(57);
      expect(count).toBeLessThan(143);
    }
  });

  it("never picks a company that is out", () => {
    const state = onlyActive(at(2), [BLITZ, INCUMBENT]);
    const seen = new Set<number | null | undefined>();
    for (let seed = 1; seed <= 60; seed++) seen.add(resolve(state, {}, seed, viral).state.event?.targetId);
    expect([...seen].sort()).toEqual([BLITZ, INCUMBENT]);
  });

  it("cannot push hype past 100", () => {
    const hyped = withCompany(start, HUMAN, { hype: 100 });
    const build: Partial<Plan> = { allocation: split(3, 0, 0), marketing: 0, price: "standard", hireLimit: 0 };
    const seed = seedWhere((candidate) => play(hyped, build, viral, candidate).state.event?.targetId === HUMAN);
    // Three people on Product: quality 0 + 5 × 3^0.9 (2.6879) − 2 = 11.44, so it launches this turn.
    // Hype closes at 100 × 0.8 + 15 for the launch = 95.
    expect(play(hyped, build, QUIET, seed).state.companies[HUMAN].hype).toBeCloseTo(95, 4);
    // 95 + 20 = 115, held at 100.
    expect(play(hyped, build, viral, seed).state.companies[HUMAN].hype).toBe(100);
  });
});

// ── Burnout ──

describe("events: burnout", () => {
  const burnout = only("burnout");

  it("takes one person from a team of 2+, for good, and that person is not a candidate", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const revealed = play(duo(at(2)), idle(3), burnout, seed).state;
      // The bystander has a team of 1, so HUMAN (3 people) is the only valid target.
      expect(revealed.event).toEqual({ cardId: "burnout", targetId: HUMAN });
      expect(revealed.companies[HUMAN].headcountAtLastClose).toBe(3);
      expect(revealed.companies[HUMAN].headcount).toBe(2);
      expect(revealed.companies[BOOT].headcount).toBe(1);
    }
    const revealed = play(duo(at(2)), idle(3), burnout).state;
    const turn3 = play(revealed, idle(2), QUIET);
    const report = reportFor(turn3, HUMAN);
    expect(report.headcount.start).toBe(2);
    expect(report.headcount.lostToEvent).toBe(1);
    expect(report.headcount.laidOff).toBe(0);
    expect(report.headcount.end).toBe(2);
    // Two salaries, not three: 2 × $40,000.
    expect(report.costs.salaries).toBe(80_000);
    expect(report.costs.severance).toBe(0);
    // Effective work = 2^0.9 = 1.866066.
    expect(report.work.effective).toBeCloseTo(1.866066, 5);
    // Candidates = 6: nobody was laid off, and burnout is not a layoff.
    expect(turn3.log.hiring.candidates).toBe(6);
    expect(turn3.state.companies[HUMAN].headcount).toBe(2);
    // What rivals are shown of that quarter: one person left, nobody joined.
    expect(turn3.state.companies[HUMAN].lastQuarter).toMatchObject({ joined: 0, left: 1 });
  });

  it("never takes a company's last person, and with no team of 2+ the card is not drawn", () => {
    const turn3 = play(duo(at(2)), idle(3), burnout);
    const turn4 = play(turn3.state, idle(2), burnout);
    const turn5 = play(turn4.state, idle(1), burnout);
    // 3 → 2 → 1, and then nobody has 2 people left.
    expect([turn3, turn4, turn5].map((result) => result.state.companies[HUMAN].headcount)).toEqual([2, 1, 1]);
    expect(turn4.state.event).toEqual({ cardId: "burnout", targetId: HUMAN });
    expect(turn5.state.event).toBeNull();
    expect(turn5.log.nextEvent).toBeNull();
    expect(turn5.state.companies[BOOT].headcount).toBe(1);
  });

  it("picks at random among the teams of 2+ and costs exactly one person", () => {
    const state = at(2);
    const hits = [0, 0, 0, 0];
    for (let seed = 1; seed <= 200; seed++) {
      const result = resolve(state, {}, seed, burnout).state;
      const quiet = resolve(state, {}, seed, QUIET).state;
      const target = result.event?.targetId;
      if (target === null || target === undefined) throw new Error("burnout needs a target");
      hits[target]++;
      for (const company of result.companies) {
        const lost = company.id === target ? 1 : 0;
        expect(company.headcount).toBe(quiet.companies[company.id].headcount - lost);
      }
    }
    // 200 draws over 4 companies: mean 50 each, standard deviation 6.1.
    for (const count of hits) expect(count).toBeGreaterThan(25);
  });
});

// ── Press feature ──

describe("events: press feature", () => {
  const press = only("press-feature");
  const idlePair: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3) };

  it("gives the best launched product +15 hype, whatever the seed", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ]);
    state = launchedCompany(state, HUMAN, { quality: 30, users: 0 });
    state = launchedCompany(state, BLITZ, { quality: 60, users: 0 });
    for (let seed = 1; seed <= 12; seed++) {
      const revealed = resolve(state, idlePair, seed, press).state;
      // No product work: quality 30 − 2 = 28 and 60 − 2 = 58. BLITZ has the best product.
      expect(revealed.event).toEqual({ cardId: "press-feature", targetId: BLITZ });
      // Both close on 10 × 0.8 = 8 (no users at the last close, so no growth bonus). BLITZ: 8 + 15 = 23.
      expect(revealed.companies[BLITZ].hype).toBeCloseTo(23, 4);
      expect(revealed.companies[HUMAN].hype).toBeCloseTo(8, 4);
    }
  });

  it("passes over a better product that has not launched", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ]);
    state = launchedCompany(state, HUMAN, { quality: 8, users: 0 });
    state = withCompany(state, BLITZ, { quality: 9 });
    for (let seed = 1; seed <= 12; seed++) {
      const revealed = resolve(state, idlePair, seed, press).state;
      // HUMAN: launched, 8 − 2 = 6. BLITZ: 9 − 2 = 7, under the launch bar of 10, so still not launched.
      expect(revealed.companies[BLITZ].launched).toBe(false);
      expect(revealed.event).toEqual({ cardId: "press-feature", targetId: HUMAN });
      expect(revealed.companies[HUMAN].hype).toBeCloseTo(23, 4);
      expect(revealed.companies[BLITZ].hype).toBeCloseTo(8, 4);
    }
  });

  it("is not drawn while nobody has launched", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const result = play(duo(at(2)), idle(3), press, seed);
      expect(result.state.event).toBeNull();
      expect(result.log.nextEvent).toBeNull();
      // Nobody got the hype either: 10 × 0.8 = 8.
      expect(result.state.companies[HUMAN].hype).toBeCloseTo(8, 4);
    }
  });
});

// ── Security breach ──

describe("events: security breach", () => {
  const breach = only("security-breach");

  it("costs a launched company under quality 50 a tenth of its users and 10 hype; the users wait in the pool", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const revealed = play(goingConcern(duo(at(2))), idle(3), breach, seed).state;
      const human = revealed.companies[HUMAN];
      expect(revealed.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
      // Turn 2: quality 40 − 2 = 38. Churn = 12% − 0.08 × 38 = 8.96% of 10,000 = 896.
      // Pool = 22,000 new + 896 churned = 22,896, all to the only launched product: 10,000 − 896 + 22,896 = 32,000.
      expect(human.quality).toBeCloseTo(38, 4);
      expect(human.usersAtLastClose).toBe(32_000);
      // The breach: 10% of 32,000 = 3,200 leave. 32,000 − 3,200 = 28,800.
      expect(human.users).toBe(28_800);
      expect(revealed.carryOverUsers).toBe(3_200);
      expect(usersInSystem(revealed)).toBe(32_000);
      // Hype closed turn 2 on 10 × 0.8 + 5 (users grew 25%+) = 13. 13 − 10 = 3.
      expect(human.hype).toBeCloseTo(3, 4);
      expect(revealed.companies[BOOT].hype).toBeCloseTo(8, 4);
    }
  });

  it("the lost users rejoin the next market split", () => {
    const revealed = play(goingConcern(duo(at(2))), idle(3), breach).state;
    const turn3 = play(revealed, idle(3), QUIET);
    // Turn 3: quality 38 − 2 = 36. Churn = 12% − 0.08 × 36 = 9.12% of 28,800 = 2,626.56 → 2,627.
    // Pool = 24,200 new + 2,627 churned + 3,200 from the breach = 30,027.
    expect(turn3.log.market).toEqual({ newUsers: 24_200, carriedIn: 3_200, churned: 2_627, pool: 30_027, carriedOut: 0 });
    // 28,800 − 2,627 + 30,027 = 56,200.
    expect(reportFor(turn3, HUMAN).users).toMatchObject({
      open: 32_000,
      lostToEvent: 3_200,
      churned: 2_627,
      won: 30_027,
      end: 56_200,
    });
    expect(turn3.state.carryOverUsers).toBe(0);
    expect(turn3.state.companies[HUMAN].users).toBe(56_200);
    // What everyone sees of that quarter (ruling 18).
    expect(turn3.state.companies[HUMAN].lastQuarter).toMatchObject({
      usersAtOpen: 32_000,
      usersLostToEvent: 3_200,
      usersChurned: 2_627,
      usersWon: 30_027,
    });
  });

  it("cannot push hype below 0", () => {
    const start = withCompany(goingConcern(duo(at(2))), HUMAN, { hype: 5 });
    // Hype closes turn 2 on 5 × 0.8 + 5 = 9.
    expect(play(start, idle(3), QUIET).state.companies[HUMAN].hype).toBeCloseTo(9, 4);
    // 9 − 10 = −1, held at 0.
    const revealed = play(start, idle(3), breach).state;
    expect(revealed.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
    expect(revealed.companies[HUMAN].hype).toBe(0);
  });

  it("growth after a breach is still measured from last quarter's close", () => {
    const start = launchedCompany(duo(at(2)), HUMAN, { quality: 40, users: 128_000 });
    const revealed = play(start, idle(3), breach).state;
    // Turn 2: 128,000 + 22,000 = 150,000 at the close. That is +17%, so no growth bonus: hype 10 × 0.8 = 8.
    // The breach: 15,000 leave and 135,000 stay; hype 8 − 10 → 0.
    expect(revealed.companies[HUMAN].usersAtLastClose).toBe(150_000);
    expect(revealed.companies[HUMAN].users).toBe(135_000);
    expect(revealed.companies[HUMAN].hype).toBe(0);

    const turn3 = play(revealed, idle(3), QUIET);
    // Turn 3: 135,000 + 24,200 new + 15,000 back from the breach = 174,200.
    // Over last quarter's close of 150,000 that is +16%: no bonus. (Over the 135,000 left after the breach it
    // would be +29%.) Hype stays 0 × 0.8 = 0.
    expect(turn3.state.companies[HUMAN].users).toBe(174_200);
    expect(reportFor(turn3, HUMAN).users.open).toBe(150_000);
    expect(reportFor(turn3, HUMAN).hype.growth).toBe(0);
    expect(turn3.state.companies[HUMAN].hype).toBe(0);
  });

  it("needs quality under 50: a product at exactly 50 is safe, one at 49.9 is not", () => {
    // 52 − 2 = 50: not under 50, so there is no valid target and no event.
    const safe = play(launchedCompany(duo(at(2)), HUMAN, { quality: 52 }), idle(3), breach);
    expect(safe.state.companies[HUMAN].quality).toBeCloseTo(50, 4);
    expect(safe.state.event).toBeNull();
    expect(safe.state.companies[HUMAN].users).toBe(32_000);
    expect(safe.state.carryOverUsers).toBe(0);
    // 51.9 − 2 = 49.9.
    const shaky = play(launchedCompany(duo(at(2)), HUMAN, { quality: 51.9 }), idle(3), breach);
    expect(shaky.state.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
    expect(shaky.state.companies[HUMAN].users).toBe(28_800);
  });

  it("needs users: a launched product nobody uses is not a target", () => {
    // Quality 1 − 2 → 0, so its pull is 0, nobody joins and the pool of 22,000 waits.
    const result = play(launchedCompany(duo(at(2)), HUMAN, { quality: 1, users: 0 }), idle(3), breach);
    expect(result.state.companies[HUMAN].users).toBe(0);
    expect(result.state.carryOverUsers).toBe(22_000);
    expect(result.state.event).toBeNull();
  });

  it("needs a launched product", () => {
    const result = play(duo(at(2)), idle(3), breach);
    expect(result.state.event).toBeNull();
  });

  it("picks at random among the companies it can hit", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ]);
    state = launchedCompany(state, HUMAN, { quality: 40 });
    state = launchedCompany(state, BLITZ, { quality: 45 });
    const hits = [0, 0, 0, 0];
    for (let seed = 1; seed <= 100; seed++) {
      const target = resolve(state, { [HUMAN]: idle(3), [BLITZ]: idle(3) }, seed, breach).state.event?.targetId;
      if (target === null || target === undefined) throw new Error("a breach needs a target");
      hits[target]++;
    }
    // Both close under 50 with users. 100 draws over 2 companies: mean 50 each, standard deviation 5.
    expect(hits[HUMAN]).toBeGreaterThan(25);
    expect(hits[BLITZ]).toBeGreaterThan(25);
    expect(hits[HUMAN] + hits[BLITZ]).toBe(100);
  });

  it("never hits a company at quality 50 or more", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ]);
    state = launchedCompany(state, HUMAN, { quality: 40 });
    state = launchedCompany(state, BLITZ, { quality: 80 });
    const plans: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3) };
    for (let seed = 1; seed <= 30; seed++) {
      const revealed = resolve(state, plans, seed, breach).state;
      const quiet = resolve(state, plans, seed, QUIET).state;
      // HUMAN closes at 38, BLITZ at 78.
      expect(revealed.event).toEqual({ cardId: "security-breach", targetId: HUMAN });
      expect(revealed.companies[BLITZ].users).toBe(quiet.companies[BLITZ].users);
      expect(revealed.companies[BLITZ].hype).toBeCloseTo(quiet.companies[BLITZ].hype, 4);
      const lost = quiet.companies[HUMAN].users - revealed.companies[HUMAN].users;
      expect(Math.abs(lost - quiet.companies[HUMAN].users * 0.1)).toBeLessThanOrEqual(0.5);
      expect(revealed.carryOverUsers).toBe(quiet.carryOverUsers + lost);
    }
  });
});

// ── Talent glut ──

describe("events: talent glut", () => {
  const recruit = (people: number): Partial<Plan> => ({
    allocation: split(0, 0, people),
    marketing: 0,
    price: "standard",
    hireLimit: null,
  });
  const big = withCompany(duo(at(2)), HUMAN, { headcount: 12, headcountAtLastClose: 12, cash: 5_000_000 });

  it("adds 4 candidates in the turn it is revealed in, and only in that one", () => {
    const reveal = play(big, idle(12), only("talent-glut"));
    expect(reveal.state.event).toEqual({ cardId: "talent-glut", targetId: null });
    expect(reveal.state.modifiers).toEqual({ newUsers: 1, marketing: 1, extraCandidates: 4 });

    const turn3 = play(reveal.state, recruit(12), QUIET);
    // Candidates = 6 + 4 = 10. Capacity = 2 × 12^0.9 (9.3597) = 18.72 → 19, so HUMAN takes all 10.
    expect(turn3.log.hiring.candidates).toBe(10);
    expect(reportFor(turn3, HUMAN).hiring).toEqual({ capacity: 19, wanted: 19, hired: 10 });
    expect(turn3.log.hiring.picks).toEqual(Array.from({ length: 10 }, () => HUMAN));
    // 10 hires × $10,000.
    expect(reportFor(turn3, HUMAN).costs.hiring).toBe(100_000);
    expect(turn3.state.companies[HUMAN].headcount).toBe(22);
    expect(turn3.state.modifiers).toEqual(NEUTRAL);

    const turn4 = play(turn3.state, recruit(22), QUIET);
    // Back to 6. Capacity = 2 × 22^0.9 (16.15) = 32.3 → 32, so all 6 are hired.
    expect(turn4.log.hiring.candidates).toBe(6);
    expect(reportFor(turn4, HUMAN).hiring.hired).toBe(6);
  });

  it("without the card the same turn has 6 candidates", () => {
    const reveal = play(big, idle(12), QUIET);
    const turn3 = play(reveal.state, recruit(12), QUIET);
    expect(turn3.log.hiring.candidates).toBe(6);
    expect(reportFor(turn3, HUMAN).hiring).toEqual({ capacity: 19, wanted: 19, hired: 6 });
  });
});

// ── Market boom ──

describe("events: market boom", () => {
  it("multiplies the new users by 1.5 in the turn it is revealed in, and only in that one", () => {
    const reveal = play(goingConcern(duo(at(2))), idle(3), only("market-boom"));
    expect(reveal.state.event).toEqual({ cardId: "market-boom", targetId: null });
    expect(reveal.state.modifiers).toEqual({ newUsers: 1.5, marketing: 1, extraCandidates: 0 });
    // Nothing instant: HUMAN still closes turn 2 on 10,000 + 22,000 = 32,000 users.
    expect(reveal.log.market.newUsers).toBe(22_000);
    expect(reveal.state.companies[HUMAN].users).toBe(32_000);

    const turn3 = play(reveal.state, idle(3), QUIET);
    // New users in turn 3 = 20,000 × 1.1² = 24,200. × 1.5 = 36,300.
    // Churn (quality 36) = 9.12% of 32,000 = 2,918.4 → 2,918, and churned users are not multiplied.
    expect(turn3.log.market).toEqual({ newUsers: 36_300, carriedIn: 0, churned: 2_918, pool: 39_218, carriedOut: 0 });
    // 32,000 + 36,300 = 68,300.
    expect(turn3.state.companies[HUMAN].users).toBe(68_300);
    expect(turn3.state.modifiers).toEqual(NEUTRAL);

    const turn4 = play(turn3.state, idle(3), QUIET);
    // Turn 4 = 20,000 × 1.1³ = 26,620: the boom is not built into the base.
    expect(turn4.log.market.newUsers).toBe(26_620);
    // 68,300 + 26,620 = 94,920.
    expect(turn4.state.companies[HUMAN].users).toBe(94_920);
  });
});

// ── Ad prices spike ──

describe("events: ad prices spike", () => {
  it("halves the marketing term of pull in the turn it is revealed in, and only in that one", () => {
    const pair: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3) };
    const reveal = resolve(onlyActive(at(2), [HUMAN, BLITZ]), pair, 1, only("ad-prices-spike"));
    expect(reveal.state.event).toEqual({ cardId: "ad-prices-spike", targetId: null });
    expect(reveal.state.modifiers).toEqual({ newUsers: 1, marketing: 0.5, extraCandidates: 0 });

    // Two identical launched products with no users, no hype and an empty waiting pool.
    let state = withState(reveal.state, { carryOverUsers: 0 });
    for (const id of [HUMAN, BLITZ]) {
      state = withCompany(state, id, { launched: true, quality: 52, users: 0, usersAtLastClose: 0, hype: 0, cash: 1_000_000 });
    }
    // Everyone on Recruiting with a hire limit of 0: no product work, no growth work, no hires.
    const bench: Partial<Plan> = { allocation: split(0, 0, 3), price: "standard", hireLimit: 0 };
    const plans: Patches = { [HUMAN]: { ...bench, marketing: 100_000 }, [BLITZ]: { ...bench, marketing: 0 } };

    const turn3 = resolve(state, plans, 1, QUIET);
    // Quality 52 − 2 = 50. Marketing term = 0.5 × √($100K ÷ $25K) = 1, halved to 0.5.
    // HUMAN's pull = 50 × (1 + 0.5) × 1 × 1 = 75 (it would be 100 in a normal turn). BLITZ's = 50 × 1 = 50.
    expect(reportFor(turn3, HUMAN).users.pull).toBeCloseTo(75, 4);
    expect(reportFor(turn3, BLITZ).users.pull).toBeCloseTo(50, 4);
    // Pool = 24,200 new users. HUMAN: 75/125 = 60% = 14,520. BLITZ: 40% = 9,680.
    expect(reportFor(turn3, HUMAN).users.won).toBe(14_520);
    expect(reportFor(turn3, BLITZ).users.won).toBe(9_680);
    expect(reportFor(turn3, HUMAN).users.share).toBeCloseTo(0.6, 6);
    // The spend is still paid in full.
    expect(reportFor(turn3, HUMAN).costs.marketing).toBe(100_000);
    expect(turn3.state.modifiers).toEqual(NEUTRAL);

    // Only the marketing term is halved. With HUMAN's three people on Growth instead: growth work = 3^0.9 =
    // 2.687875, growth term = 0.3 × 2.687875 = 0.806363. Pull = 50 × (1 + 0.806363 + 0.5) = 115.3181.
    const growing: Partial<Plan> = { allocation: split(0, 3, 0), price: "standard", hireLimit: 0, marketing: 100_000 };
    const grown = resolve(state, { ...plans, [HUMAN]: growing }, 1, QUIET);
    expect(reportFor(grown, HUMAN).users.pull).toBeCloseTo(115.3181, 3);

    const turn4 = resolve(turn3.state, plans, 1, QUIET);
    // Quality 50 − 2 = 48, hype still 0 (0 × 0.8; no users at the last close, so no growth bonus).
    // HUMAN's pull = 48 × (1 + 1) = 96. BLITZ's = 48. Share 96/144 = 2/3.
    expect(reportFor(turn4, HUMAN).users.pull).toBeCloseTo(96, 4);
    expect(reportFor(turn4, BLITZ).users.pull).toBeCloseTo(48, 4);
    // Churn at quality 48 = 12% − 3.84% = 8.16%: 14,520 → 1,184.8 → 1,185 and 9,680 → 789.9 → 790.
    // Pool = 26,620 + 1,185 + 790 = 28,595. Two thirds = 19,063.33 → 19,063; one third = 9,531.67 → 9,532
    // (the odd user goes to the largest remainder).
    expect(turn4.log.market.pool).toBe(28_595);
    expect(reportFor(turn4, HUMAN).users.won).toBe(19_063);
    expect(reportFor(turn4, BLITZ).users.won).toBe(9_532);
  });
});

// ── The turn runs on what the event changed ──

describe("events: revealed before planning, so the turn runs on what they changed", () => {
  const viral = only("viral-moment");

  it("a raise in the turn of a viral moment is priced on the new hype", () => {
    const start = duo(at(2));
    const seed = seedWhere((candidate) => play(start, idle(3), viral, candidate).state.event?.targetId === HUMAN);
    const revealed = play(start, idle(3), viral, seed).state;
    const ready = withCompany(revealed, HUMAN, { launched: true, quality: 40, users: 10_000, usersAtLastClose: 10_000 });
    const raise = reportFor(play(ready, { ...idle(2), raisePercent: 10 }, QUIET, seed), HUMAN).raise;
    // HUMAN opens turn 3 on 8 + 20 = 28 hype. 10,000 × $150 × 1.28 = $1,920,000. 10% = $192,000.
    expect(raise?.valuation).toBeCloseTo(1_920_000, 0);
    expect(raise?.amount).toBeCloseTo(192_000, 0);
  });

  it("a raise in the turn of a breach is priced on the users and the hype that are left", () => {
    const revealed = play(goingConcern(duo(at(2))), idle(3), only("security-breach")).state;
    const report = reportFor(play(revealed, { ...idle(2), raisePercent: 10 }, QUIET), HUMAN);
    expect(report.notes).toEqual([]);
    // HUMAN opens turn 3 with 28,800 users on 3 hype. 28,800 × $150 × 1.03 = $4,449,600. 10% = $444,960.
    expect(report.raise?.valuation).toBeCloseTo(4_449_600, 0);
    expect(report.raise?.amount).toBeCloseTo(444_960, 0);
  });

  it("a company an event leaves under 1,000 users cannot raise that turn", () => {
    const exodus: EventCard = {
      id: "test-exodus",
      name: "Exodus",
      text: "A test card: 97% of a company's users leave.",
      weight: 1,
      target: { pick: "random", minUsers: 1 },
      effects: [{ kind: "targetUsers", fraction: 0.97 }],
    };
    const revealed = play(goingConcern(duo(at(2))), idle(3), withDeck([exodus])).state;
    // 97% of 32,000 = 31,040 leave and 960 stay, though the quarter closed on 32,000.
    expect(revealed.companies[HUMAN].usersAtLastClose).toBe(32_000);
    expect(revealed.companies[HUMAN].users).toBe(960);
    // "Needs 1,000+ users at the start of the turn", and the turn starts after the event.
    const fixed = expectFixedUp(
      revealed,
      { [HUMAN]: { ...idle(2), raisePercent: 10 }, [BOOT]: BYSTANDER },
      { [HUMAN]: idle(3), [BOOT]: BYSTANDER },
    );
    expect(reportFor(fixed, HUMAN).raise).toBeNull();
  });

  it("pull runs on the hype after the event", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ]);
    for (const id of [HUMAN, BLITZ]) {
      state = withCompany(state, id, { launched: true, quality: 54, users: 0, usersAtLastClose: 0, hype: 0 });
    }
    // Everyone on Recruiting with a hire limit of 0: no product work, no growth work, no hires.
    const bench: Partial<Plan> = { allocation: split(0, 0, 3), marketing: 0, price: "standard", hireLimit: 0 };
    const plans: Patches = { [HUMAN]: bench, [BLITZ]: bench };
    const seed = seedWhere((candidate) => resolve(state, plans, candidate, viral).state.event?.targetId === HUMAN);
    const reveal = resolve(state, plans, seed, viral).state;
    // Turn 2: quality 54 − 2 = 52 each and equal pull, so the 22,000 new users split 11,000 each.
    // Hype 0 × 0.8 = 0 (no users at the last close, so no growth bonus); HUMAN + 20 = 20.
    expect(reveal.companies.map((company) => company.users)).toEqual([11_000, 11_000, 0, 0]);
    expect(reveal.companies[HUMAN].hype).toBeCloseTo(20, 4);
    expect(reveal.companies[BLITZ].hype).toBeCloseTo(0, 4);

    const turn3 = resolve(reveal, plans, seed, QUIET);
    // Turn 3: quality 50. Churn = 12% − 0.08 × 50 = 8% of 11,000 = 880 each. Pool = 24,200 + 1,760 = 25,960.
    // Pull: HUMAN 50 × (1 + 20/100) = 60, BLITZ 50. HUMAN wins 60/110 × 25,960 = 14,160; BLITZ 11,800.
    expect(reportFor(turn3, HUMAN).users.pull).toBeCloseTo(60, 4);
    expect(reportFor(turn3, BLITZ).users.pull).toBeCloseTo(50, 4);
    expect(reportFor(turn3, HUMAN).users.won).toBe(14_160);
    expect(reportFor(turn3, BLITZ).users.won).toBe(11_800);
    // 11,000 − 880 + 14,160 = 24,280 and 11,000 − 880 + 11,800 = 21,920.
    expect(turn3.state.companies[HUMAN].users).toBe(24_280);
    expect(turn3.state.companies[BLITZ].users).toBe(21_920);
  });

  it("a poach's odds run on the hype after the event", () => {
    const state = onlyActive(at(2), [HUMAN, BLITZ]);
    const plans: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3) };
    const seed = seedWhere((candidate) => resolve(state, plans, candidate, viral).state.event?.targetId === HUMAN);
    const reveal = resolve(state, plans, seed, viral).state;
    const turn3 = resolve(reveal, { [HUMAN]: { ...idle(3), poachTarget: BLITZ }, [BLITZ]: idle(3) }, seed, QUIET);
    // HUMAN opens turn 3 on 28 hype, BLITZ on 8. Chance = 50% + (28 − 8) ÷ 2 = 60%.
    expect(reportFor(turn3, HUMAN).poach?.chance).toBeCloseTo(0.6, 10);
    expect(reportFor(turn3, HUMAN).costs.poaching).toBe(50_000);
  });

  it("candidates are handed out in the hype order after the event", () => {
    const state = onlyActive(at(2), [HUMAN, BLITZ]);
    const quiet: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3) };
    const recruit: Partial<Plan> = { allocation: split(0, 0, 3), marketing: 0, price: "standard", hireLimit: null };
    for (const lucky of [HUMAN, BLITZ]) {
      const other = lucky === HUMAN ? BLITZ : HUMAN;
      const seed = seedWhere((candidate) => resolve(state, quiet, candidate, viral).state.event?.targetId === lucky);
      const reveal = resolve(state, quiet, seed, viral).state;
      const turn3 = resolve(reveal, { [HUMAN]: recruit, [BLITZ]: recruit }, seed, QUIET);
      // Each wants 2 × 3^0.9 (2.6879) = 5.38 → 5 of the 6 candidates. Hype 28 against 8: the viral company
      // picks first, then they take turns.
      expect(turn3.log.hiring.picks).toEqual([lucky, other, lucky, other, lucky, other]);
      // 3 hires × $10,000 each.
      expect(reportFor(turn3, lucky).costs.hiring).toBe(30_000);
      expect(reportFor(turn3, other).costs.hiring).toBe(30_000);
    }
  });

  it("a missing plan after a burnout is refitted to the people who are left", () => {
    const thirds: Partial<Plan> = { allocation: split(1, 1, 1), marketing: 0, price: "standard", hireLimit: 0 };
    const revealed = play(duo(at(2)), thirds, only("burnout")).state;
    expect(revealed.companies[HUMAN].headcount).toBe(2);
    const set = plansOf(revealed, { [BOOT]: BYSTANDER }).map((plan, id) => (id === HUMAN ? null : plan));
    const turn3 = resolveTurn(revealed, set, 1, QUIET);
    const report = reportFor(turn3, HUMAN);
    expect(report.headcount.start).toBe(2);
    // 2 people over last turn's 1/1/1: 0.67 each → 0, 0, 0 and two people left over, who go to Product and
    // then Growth (ties, ruling 25).
    expect(report.plan.allocation).toEqual(split(1, 1, 0));
    expect(report.costs.salaries).toBe(80_000);
  });

  it("a company that goes out this turn is not a target of the next event", () => {
    let state = onlyActive(at(2), [HUMAN, BLITZ, BOOT]);
    state = withCompany(state, BOOT, { headcount: 1, headcountAtLastClose: 1 });
    state = withCompany(state, BLITZ, { cash: 0 });
    const plans: Patches = { [HUMAN]: idle(3), [BLITZ]: idle(3), [BOOT]: BYSTANDER };
    for (let seed = 1; seed <= 60; seed++) {
      const result = resolve(state, plans, seed, viral);
      // BLITZ: $0 − 3 salaries = −$120,000, so it is bankrupt (step 12) before the event is drawn (step 14).
      expect(result.state.companies[BLITZ].out?.reason).toBe("bankrupt");
      expect([HUMAN, BOOT]).toContain(result.state.event?.targetId);
      expect(result.state.companies[BLITZ].hype).toBeLessThan(20);
    }
    // And its three people are freed, not burned out: with the others on teams of 1 there is no valid target.
    const lone = withCompany(state, HUMAN, { headcount: 1, headcountAtLastClose: 1 });
    const result = resolve(lone, { ...plans, [HUMAN]: idle(1) }, 1, only("burnout"));
    expect(result.state.event).toBeNull();
    expect(result.state.freedPeople).toBe(3);
  });

  it("two booms in a row do not compound", () => {
    const boom = only("market-boom");
    const turn3 = play(goingConcern(duo(at(2))), idle(3), boom).state;
    const turn4 = play(turn3, idle(3), boom);
    expect(turn4.state.modifiers).toEqual({ newUsers: 1.5, marketing: 1, extraCandidates: 0 });
    // Turn 4's new users = 26,620 × 1.5 = 39,930 (not × 2.25).
    expect(play(turn4.state, idle(3), QUIET).log.market.newUsers).toBe(39_930);
  });
});

// ── The deck is config ──

describe("events: the deck lives in config", () => {
  it("a card with no valid target is left out of the draw, so another card always comes up", () => {
    const deck = withDeck([card("burnout"), card("talent-glut")]);
    const ones = withCompany(duo(at(2)), HUMAN, { headcount: 1, headcountAtLastClose: 1 });
    for (let seed = 1; seed <= 40; seed++) {
      // Nobody has a team of 2+, so the draw is among talent glut alone, at chance 1.
      expect(play(ones, idle(1), deck, seed).state.event).toEqual({ cardId: "talent-glut", targetId: null });
    }
    // With a team of 3 in the game both cards come up.
    const seen = new Set<string | undefined>();
    for (let seed = 1; seed <= 40; seed++) seen.add(play(duo(at(2)), idle(3), deck, seed).state.event?.cardId);
    expect([...seen].sort()).toEqual(["burnout", "talent-glut"]);
  });

  it("a new card that mixes this-turn effects works with no code change", () => {
    const windfall: EventCard = {
      id: "test-windfall",
      name: "Windfall",
      text: "A test card: twice the new users, 3 extra candidates, ads at a quarter strength.",
      weight: 1,
      effects: [
        { kind: "newUsers", multiplier: 2 },
        { kind: "candidates", extra: 3 },
        { kind: "marketingEffect", multiplier: 0.25 },
      ],
    };
    const reveal = play(goingConcern(duo(at(2))), idle(3), withDeck([windfall]));
    expect(reveal.state.event).toEqual({ cardId: "test-windfall", targetId: null });
    expect(reveal.log.nextEvent).toEqual({ cardId: "test-windfall", targetId: null });
    expect(reveal.state.modifiers).toEqual({ newUsers: 2, marketing: 0.25, extraCandidates: 3 });

    const turn3 = play(reveal.state, idle(3), QUIET);
    // 24,200 × 2 = 48,400 new users; 6 + 3 = 9 candidates. HUMAN: 32,000 + 48,400 = 80,400.
    expect(turn3.log.market.newUsers).toBe(48_400);
    expect(turn3.log.hiring.candidates).toBe(9);
    expect(turn3.state.companies[HUMAN].users).toBe(80_400);
    expect(turn3.state.modifiers).toEqual(NEUTRAL);
  });

  it("a new climate card runs for its own multiplier and length", () => {
    const bubble: EventCard = {
      id: "test-bubble",
      name: "Bubble",
      text: "A test card: valuations ×2 for 4 turns.",
      weight: 1,
      effects: [{ kind: "fundingClimate", multiplier: 2, turns: 4 }],
    };
    let state = play(duo(at(2)), idle(3), withDeck([bubble])).state;
    expect(state.event).toEqual({ cardId: "test-bubble", targetId: null });
    const seen = [state.climate];
    // 10,000 × $150 × 1.2 × 2 = $3,600,000.
    expect(raiseNow(state).raise?.valuation).toBeCloseTo(3_600_000, 0);
    for (let turn = 3; turn <= 6; turn++) {
      state = play(state, idle(3), QUIET).state;
      seen.push(state.climate);
    }
    expect(seen).toEqual([
      { multiplier: 2, turnsLeft: 4 },
      { multiplier: 2, turnsLeft: 3 },
      { multiplier: 2, turnsLeft: 2 },
      { multiplier: 2, turnsLeft: 1 },
      NORMAL,
    ]);
  });

  it("a new card with its own target rule and effects works with no code change", () => {
    const raid: EventCard = {
      id: "test-raid",
      name: "Raid",
      text: "A test card: a company with 5,000+ users loses half of them and 2 people, and gains 50 hype.",
      weight: 1,
      target: { pick: "random", minUsers: 5_000 },
      effects: [
        { kind: "targetUsers", fraction: 0.5 },
        { kind: "targetHeadcount", delta: -2 },
        { kind: "targetHype", delta: 50 },
      ],
    };
    for (let seed = 1; seed <= 10; seed++) {
      const revealed = play(goingConcern(duo(at(2))), idle(3), withDeck([raid]), seed).state;
      // Only HUMAN has 5,000+ users (32,000 at the close of turn 2, on 13 hype with 3 people).
      expect(revealed.event).toEqual({ cardId: "test-raid", targetId: HUMAN });
      // Half of 32,000 = 16,000 leave for the pool; 3 − 2 = 1 person; 13 + 50 = 63 hype.
      expect(revealed.companies[HUMAN].users).toBe(16_000);
      expect(revealed.carryOverUsers).toBe(16_000);
      expect(revealed.companies[HUMAN].headcount).toBe(1);
      expect(revealed.companies[HUMAN].hype).toBeCloseTo(63, 4);
      expect(revealed.companies[BOOT].headcount).toBe(1);
    }
  });

  it("a new card can add people, and one that takes more people than a team has leaves its last person", () => {
    const people = (delta: number): EventCard => ({
      id: "test-people",
      name: "People",
      text: "A test card.",
      weight: 1,
      target: { pick: "random", minHeadcount: 2 },
      effects: [{ kind: "targetHeadcount", delta }],
    });
    // HUMAN has 3 people; the bystander's team of 1 is not a valid target.
    const hired = play(duo(at(2)), idle(3), withDeck([people(2)])).state;
    expect(hired.event).toEqual({ cardId: "test-people", targetId: HUMAN });
    // 3 + 2 = 5.
    expect(hired.companies[HUMAN].headcount).toBe(5);
    // 3 − 5 would be −2: "nobody falls below 1 person" (ruling 11).
    const gutted = play(duo(at(2)), idle(3), withDeck([people(-5)])).state;
    expect(gutted.event).toEqual({ cardId: "test-people", targetId: HUMAN });
    expect(gutted.companies[HUMAN].headcount).toBe(1);
  });

  it("whatever a card adds or takes, hype stays within 0 to 100", () => {
    const hypeCard = (delta: number): EventCard => ({
      id: "test-hype",
      name: "Hype swing",
      text: "A test card.",
      weight: 1,
      target: { pick: "highestQuality", launched: true },
      effects: [{ kind: "targetHype", delta }],
    });
    const start = goingConcern(duo(at(2)));
    // HUMAN closes turn 2 on 13 hype. 13 + 95 = 108 → 100. 13 − 95 = −82 → 0.
    expect(play(start, idle(3), withDeck([hypeCard(95)])).state.companies[HUMAN].hype).toBe(100);
    expect(play(start, idle(3), withDeck([hypeCard(-95)])).state.companies[HUMAN].hype).toBe(0);
    // 13 + 50 = 63: an ordinary swing is applied in full.
    expect(play(start, idle(3), withDeck([hypeCard(50)])).state.companies[HUMAN].hype).toBeCloseTo(63, 4);
  });
});

// ── Flow: turns and default plans ──

describe("flow: turns and default plans", () => {
  it("turn numbers advance by one and each log carries the turn it resolved", () => {
    let state = newGame();
    for (let turn = 1; turn <= 6; turn++) {
      expect(state.turn).toBe(turn);
      const result = resolve(state, {}, 1, QUIET);
      expect(result.log.turn).toBe(turn);
      expect(result.state.outcome).toBeNull();
      expect(result.state.turn).toBe(turn + 1);
      state = result.state;
    }
  });

  it("on turn 1 a missing plan is the starting split with nothing else switched on", () => {
    const start = newGame();
    const missing = resolveTurn(start, [null, null, null, null], 7, QUIET);
    const explicit = resolveTurn(start, plansOf(start), 7, QUIET);
    expect(missing).toEqual(explicit);
    for (const id of [HUMAN, BLITZ, BOOT]) {
      expect(reportFor(missing, id).plan).toMatchObject({
        allocation: split(3, 0, 0),
        marketing: 0,
        raisePercent: 0,
        poachTarget: null,
        layoffs: 0,
      });
      expect(reportFor(missing, id).notes).toEqual([]);
    }
    expect(reportFor(missing, INCUMBENT).plan).toMatchObject({
      allocation: split(5, 2, 1),
      marketing: 0,
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
    });
  });

  it("a missing plan repeats last turn's split, marketing, price and hire limit", () => {
    const mine: Plan = {
      allocation: split(1, 1, 1),
      marketing: 25_000,
      price: "budget",
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
      hireLimit: 0,
    };
    const first = resolveTurn(newGame(), [mine, null, null, null], 5, QUIET);
    expect(reportFor(first, HUMAN).plan).toEqual(mine);
    expect(first.state.companies[HUMAN].lastPlan).toEqual(mine);
    expect(defaultPlan(first.state.companies[HUMAN])).toEqual(mine);

    const repeated = resolveTurn(first.state, [null, null, null, null], 5, QUIET);
    const explicit = resolveTurn(first.state, [mine, null, null, null], 5, QUIET);
    expect(reportFor(repeated, HUMAN).plan).toEqual(mine);
    expect(reportFor(repeated, HUMAN).notes).toEqual([]);
    // The marketing budget stays in force and is paid again (ruling 26).
    expect(reportFor(repeated, HUMAN).costs.marketing).toBe(25_000);
    expect(repeated).toEqual(explicit);
  });

  it("a raise, a poach and layoffs are one-off: a missing plan does not repeat them", () => {
    let start = launchedCompany(newGame(), HUMAN, { hype: 50, cash: 2_000_000 });
    start = withCompany(start, HUMAN, { headcount: 6, headcountAtLastClose: 6 });
    // Legal: 6 people − 1 laid off − 1 raising = 4 = 2 + 1 + 1.
    const busy: Plan = {
      allocation: split(2, 1, 1),
      marketing: 50_000,
      price: "premium",
      raisePercent: 10,
      poachTarget: BLITZ,
      layoffs: 1,
      hireLimit: 1,
    };
    const first = resolveTurn(start, [busy, null, null, null], 9, QUIET);
    const report1 = reportFor(first, HUMAN);
    expect(report1.notes).toEqual([]);
    // Valuation = 10,000 × $150 × (1 + 50/100) = $2,250,000. 10% = $225,000.
    expect(report1.raise?.valuation).toBeCloseTo(2_250_000, 0);
    expect(report1.raise?.amount).toBeCloseTo(225_000, 0);
    expect(report1.headcount.laidOff).toBe(1);
    expect(report1.poach?.targetId).toBe(BLITZ);
    expect(report1.costs.severance).toBe(20_000);
    expect(report1.costs.poaching).toBe(50_000);
    expect(report1.costs.marketing).toBe(50_000);

    // The default for the next turn keeps what stays as set and switches the one-offs off.
    expect(defaultPlan(first.state.companies[HUMAN])).toMatchObject({
      marketing: 50_000,
      price: "premium",
      hireLimit: 1,
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
    });

    const second = resolveTurn(first.state, [null, null, null, null], 9, QUIET);
    const report2 = reportFor(second, HUMAN);
    expect(report2.plan).toMatchObject({
      marketing: 50_000,
      price: "premium",
      hireLimit: 1,
      raisePercent: 0,
      poachTarget: null,
      layoffs: 0,
    });
    expect(report2.raise).toBeNull();
    expect(report2.poach).toBeNull();
    expect(report2.headcount.laidOff).toBe(0);
    expect(report2.costs.severance).toBe(0);
    expect(report2.costs.poaching).toBe(0);
    expect(report2.costs.marketing).toBe(50_000);
    // Everyone works: nobody is raising or leaving.
    const { product, growth, recruiting } = report2.plan.allocation;
    expect(product + growth + recruiting).toBe(report2.headcount.start);
    // One raise only: equity 1 × 0.9, one investor seat, dated turn 1.
    expect(second.state.companies[HUMAN].founderEquity).toBeCloseTo(0.9, 10);
    expect(second.state.companies[HUMAN].investorSeats).toBe(1);
    expect(second.state.companies[HUMAN].lastRaise?.turn).toBe(1);
  });

  it("a missing plan repeats the plan as it was fixed up, with no new note", () => {
    const first = resolve(newGame(), { [HUMAN]: { allocation: split(2, 2, 2), hireLimit: 0 } }, 1, QUIET);
    expect(reportFor(first, HUMAN).notes.length).toBeGreaterThan(0);
    // 3 people over 2/2/2 is 1/1/1, and that is the split the next turn starts from.
    expect(first.state.companies[HUMAN].lastPlan.allocation).toEqual(split(1, 1, 1));
    const second = resolveTurn(first.state, [null, null, null, null], 1, QUIET);
    expect(reportFor(second, HUMAN).plan.allocation).toEqual(split(1, 1, 1));
    expect(reportFor(second, HUMAN).notes).toEqual([]);
  });

  it("after a raise a missing plan puts the fundraiser back to work, in proportion to last turn's split", () => {
    const state = launchedCompany(newGame(), HUMAN, { hype: 20 });
    const first = resolve(state, { [HUMAN]: { allocation: split(0, 1, 1), raisePercent: 10, hireLimit: 0 } }, 1, QUIET);
    expect(reportFor(first, HUMAN).notes).toEqual([]);
    expect(reportFor(first, HUMAN).raise?.percent).toBe(10);
    const second = resolveTurn(first.state, [null, null, null, null], 1, QUIET);
    expect(reportFor(second, HUMAN).raise).toBeNull();
    // 3 people over last turn's 0/1/1: 0, 1.5, 1.5 → 0, 1, 1 and the third person to Growth (tie).
    expect(reportFor(second, HUMAN).plan.allocation).toEqual(split(0, 2, 1));
  });

  it("entries for companies that are out are ignored", () => {
    const state = onlyActive(newGame(), [HUMAN, BOOT]);
    const wild: Plan = {
      allocation: split(9, 9, 9),
      marketing: 500_000,
      price: "premium",
      raisePercent: 30,
      poachTarget: HUMAN,
      layoffs: 2,
      hireLimit: 5,
    };
    const withWild = resolveTurn(state, [null, wild, null, wild], 4, QUIET);
    const withNull = resolveTurn(state, [null, null, null, null], 4, QUIET);
    expect(withWild).toEqual(withNull);
    expect(withWild.log.companies[BLITZ]).toBeNull();
    expect(withWild.log.companies[INCUMBENT]).toBeNull();
    expect(withWild.log.companies[HUMAN]).not.toBeNull();
    expect(withWild.state.companies[BLITZ]).toEqual(state.companies[BLITZ]);
    expect(withWild.state.companies[HUMAN].headcount).toBe(3);
  });
});

// ── Flow: plans that break a rule ──

describe("flow: plans that break a rule are fixed up at no cost, with a note", () => {
  it("a raise under 1,000 users is dropped and the fundraiser goes back to work", () => {
    const state = launchedCompany(newGame(), HUMAN, { users: 999, hype: 20 });
    const fixed = expectFixedUp(
      state,
      { [HUMAN]: { raisePercent: 20, allocation: split(2, 0, 0) } },
      { [HUMAN]: { raisePercent: 0, allocation: split(3, 0, 0) } },
    );
    const report = reportFor(fixed, HUMAN);
    expect(report.raise).toBeNull();
    expect(report.plan.raisePercent).toBe(0);
    expect(report.plan.allocation).toEqual(split(3, 0, 0));
    expect(fixed.state.companies[HUMAN].founderEquity).toBe(1);
    expect(fixed.state.companies[HUMAN].investorSeats).toBe(0);
    expect(fixed.state.companies[HUMAN].lastRaise).toBeNull();
  });

  it("a raise at exactly 1,000 users goes through", () => {
    const state = launchedCompany(newGame(), HUMAN, { users: 1_000, hype: 20 });
    const result = resolve(state, { [HUMAN]: { raisePercent: 20, allocation: split(2, 0, 0) } }, 1, QUIET);
    const report = reportFor(result, HUMAN);
    expect(report.notes).toEqual([]);
    // Valuation = 1,000 × $150 × 1.2 = $180,000. 20% = $36,000.
    expect(report.raise?.percent).toBe(20);
    expect(report.raise?.valuation).toBeCloseTo(180_000, 0);
    expect(report.raise?.amount).toBeCloseTo(36_000, 0);
    expect(result.state.companies[HUMAN].founderEquity).toBeCloseTo(0.8, 10);
    expect(result.state.companies[HUMAN].investorSeats).toBe(1);
    expect(result.state.companies[HUMAN].lastRaise).toEqual({ turn: 1, percent: 20, amount: 36_000 });
  });

  it.each([15, 25, 50, 5, -10, 100])("a raise of %i percent is not on offer: it is fixed up with a note", (percent) => {
    const state = launchedCompany(newGame(), HUMAN, { hype: 20 });
    const result = resolve(state, { [HUMAN]: { raisePercent: percent, allocation: split(2, 0, 0) } }, 1, QUIET);
    const report = reportFor(result, HUMAN);
    expect(report.notes.length).toBeGreaterThan(0);
    // Whatever the fix, what is sold is nothing or one of the sizes on offer: 10%, 20% or 30%.
    expect([0, 10, 20, 30]).toContain(report.plan.raisePercent);
    expect(report.raise?.percent ?? 0).toBe(report.plan.raisePercent);
    const sold = report.plan.raisePercent / 100;
    expect(result.state.companies[HUMAN].founderEquity).toBeCloseTo(1 - sold, 10);
    expect(result.state.companies[HUMAN].investorSeats).toBe(sold > 0 ? 1 : 0);
    // Valuation = 10,000 × $150 × 1.2 = $1,800,000.
    expect(report.raise?.amount ?? 0).toBeCloseTo(1_800_000 * sold, 0);
  });

  describe("a raise on turn 5 allows the next on turn 8", () => {
    const raisedOn5 = (turn: number): GameState =>
      withCompany(launchedCompany(at(turn), HUMAN, { hype: 20 }), HUMAN, {
        lastRaise: { turn: 5, percent: 10, amount: 180_000 },
        founderEquity: 0.9,
        investorSeats: 1,
      });
    const again: Patches = { [HUMAN]: { raisePercent: 10, allocation: split(2, 0, 0) } };

    it.each([6, 7])("on turn %i the raise is dropped at no cost", (turn) => {
      const fixed = expectFixedUp(raisedOn5(turn), again, { [HUMAN]: { allocation: split(3, 0, 0) } });
      expect(reportFor(fixed, HUMAN).raise).toBeNull();
      expect(reportFor(fixed, HUMAN).plan.raisePercent).toBe(0);
      expect(fixed.state.companies[HUMAN].lastRaise).toEqual({ turn: 5, percent: 10, amount: 180_000 });
      expect(fixed.state.companies[HUMAN].founderEquity).toBe(0.9);
      expect(fixed.state.companies[HUMAN].investorSeats).toBe(1);
    });

    it("on turn 8 it goes through", () => {
      const result = resolve(raisedOn5(8), again, 1, QUIET);
      const report = reportFor(result, HUMAN);
      expect(report.notes).toEqual([]);
      // Valuation = 10,000 × $150 × 1.2 = $1,800,000. 10% = $180,000. Equity 0.9 × 0.9 = 0.81.
      expect(report.raise?.valuation).toBeCloseTo(1_800_000, 0);
      expect(report.raise?.amount).toBeCloseTo(180_000, 0);
      expect(result.state.companies[HUMAN].founderEquity).toBeCloseTo(0.81, 10);
      expect(result.state.companies[HUMAN].investorSeats).toBe(2);
      expect(result.state.companies[HUMAN].lastRaise).toEqual({ turn: 8, percent: 10, amount: 180_000 });
    });

    it("played through: asked every turn from 5, the raise closes on 5 and 8 and is turned down on 6 and 7", () => {
      let state = launchedCompany(at(5), HUMAN, { hype: 20 });
      const closed: (number | null)[] = [];
      for (let turn = 5; turn <= 8; turn++) {
        const result = resolve(state, { [HUMAN]: { raisePercent: 10, allocation: split(2, 0, 0), hireLimit: 0 } }, 1, QUIET);
        const report = reportFor(result, HUMAN);
        closed.push(report.raise?.percent ?? null);
        // A note exactly when the raise was turned down.
        expect(report.notes.length > 0).toBe(report.raise === null);
        state = result.state;
      }
      expect(closed).toEqual([10, null, null, 10]);
      // Two raises of 10%: equity 0.9 × 0.9 = 0.81, two investor seats, the last one dated turn 8.
      expect(state.companies[HUMAN].founderEquity).toBeCloseTo(0.81, 10);
      expect(state.companies[HUMAN].investorSeats).toBe(2);
      expect(state.companies[HUMAN].lastRaise?.turn).toBe(8);
    });
  });

  it("more layoffs than headcount − 1 are cut back to headcount − 1", () => {
    const state = withCompany(newGame(), HUMAN, { hype: 50 });
    const fixed = expectFixedUp(
      state,
      { [HUMAN]: { layoffs: 5, allocation: split(1, 0, 0) } },
      { [HUMAN]: { layoffs: 2, allocation: split(1, 0, 0) } },
    );
    const report = reportFor(fixed, HUMAN);
    expect(report.plan.layoffs).toBe(2);
    expect(report.headcount.laidOff).toBe(2);
    expect(report.headcount.end).toBe(1);
    // 2 × $20,000 severance; one salary of $40,000 for the person who stays.
    expect(report.costs.severance).toBe(40_000);
    expect(report.costs.salaries).toBe(40_000);
    // Hype: 50 × 0.8 = 40, −10 once for the layoffs = 30. (One person on Product: 0 + 5 × 1 − 2 = 3, no launch.)
    expect(fixed.state.companies[HUMAN].hype).toBeCloseTo(30, 4);
    expect(fixed.state.companies[HUMAN].headcount).toBe(1);
  });

  // Refitted in proportion; leftover people go to the largest remainders; ties to Product, then Growth,
  // then Recruiting (rulings 2 and 25).
  it.each<[string, CompanyId, Allocation, Allocation]>([
    // 3 people over 2/2/2: 1 each.
    ["2/2/2 for 3 people", HUMAN, split(2, 2, 2), split(1, 1, 1)],
    // 3 over 1/1/0: 1.5, 1.5, 0 → 1, 1, 0 and the third person to Product (tie).
    ["1/1/0 for 3 people", HUMAN, split(1, 1, 0), split(2, 1, 0)],
    // 3 over 0/1/1: 0, 1.5, 1.5 → 0, 1, 1 and the third person to Growth (tie, Growth before Recruiting).
    ["0/1/1 for 3 people", HUMAN, split(0, 1, 1), split(0, 2, 1)],
    // 3 over 7/2/0: 2.33, 0.67, 0 → 2, 0, 0 and the third person to Growth (largest remainder).
    ["7/2/0 for 3 people", HUMAN, split(7, 2, 0), split(2, 1, 0)],
    // 8 over 10/5/1: 5, 2.5, 0.5 → 5, 2, 0 and the eighth person to Growth (tie).
    ["10/5/1 for 8 people", INCUMBENT, split(10, 5, 1), split(5, 3, 0)],
    // 8 over 3/3/3: 2.67 each → 2, 2, 2 and two more, to Product and then Growth (ties).
    ["3/3/3 for 8 people", INCUMBENT, split(3, 3, 3), split(3, 3, 2)],
    // A plan that places nobody puts everyone on Product.
    ["0/0/0 for 3 people", HUMAN, split(0, 0, 0), split(3, 0, 0)],
    ["0/0/0 for 8 people", INCUMBENT, split(0, 0, 0), split(8, 0, 0)],
  ])("a split that does not add up is refitted: %s", (_name, id, given, refitted) => {
    const fixed = expectFixedUp(newGame(), { [id]: { allocation: given } }, { [id]: { allocation: refitted } }, id);
    expect(reportFor(fixed, id).plan.allocation).toEqual(refitted);
  });

  it("a split has to cover the people free to work: not the fundraiser, not those laid off", () => {
    const funded = launchedCompany(newGame(), HUMAN, { hype: 20 });
    // 3 people − 1 raising = 2, so 3/0/0 becomes 2/0/0 and the raise still closes.
    const raising = expectFixedUp(
      funded,
      { [HUMAN]: { raisePercent: 10, allocation: split(3, 0, 0) } },
      { [HUMAN]: { raisePercent: 10, allocation: split(2, 0, 0) } },
    );
    expect(reportFor(raising, HUMAN).plan.allocation).toEqual(split(2, 0, 0));
    expect(reportFor(raising, HUMAN).raise?.percent).toBe(10);
    // 3 people − 1 laid off = 2, so 1/1/1 (0.67 each) becomes 1/1/0: the two go to Product, then Growth.
    const shrinking = expectFixedUp(
      newGame(),
      { [HUMAN]: { layoffs: 1, allocation: split(1, 1, 1) } },
      { [HUMAN]: { layoffs: 1, allocation: split(1, 1, 0) } },
    );
    expect(reportFor(shrinking, HUMAN).plan.allocation).toEqual(split(1, 1, 0));
    expect(reportFor(shrinking, HUMAN).headcount.laidOff).toBe(1);
  });

  it("a fundraiser with nobody else left to place is a legal plan, and nothing breaks", () => {
    const allFinite = (value: unknown): boolean => {
      if (typeof value === "number") return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(allFinite);
      if (value !== null && typeof value === "object") return Object.values(value).every(allFinite);
      return true;
    };
    const nobody: Partial<Plan> = { raisePercent: 10, allocation: split(0, 0, 0), hireLimit: 0 };

    // Three people: two are laid off and the third raises, so 3 − 2 − 1 = 0 people are free to work.
    const trio = launchedCompany(newGame(), HUMAN, { hype: 20 });
    const lean = resolve(trio, { [HUMAN]: { ...nobody, layoffs: 2 } }, 1, QUIET);
    const report = reportFor(lean, HUMAN);
    expect(report.notes).toEqual([]);
    expect(report.plan.allocation).toEqual(split(0, 0, 0));
    // 10,000 × $150 × 1.2 = $1,800,000. 10% = $180,000.
    expect(report.raise?.amount).toBeCloseTo(180_000, 0);
    expect(report.headcount.laidOff).toBe(2);
    // One salary of $40,000 and two severances of $20,000.
    expect(report.costs.salaries).toBe(40_000);
    expect(report.costs.severance).toBe(40_000);
    // One person on payroll: effective work 1^0.9 = 1, and the fundraiser's share of it is lost.
    expect(report.work.effective).toBeCloseTo(1, 6);
    expect(report.work).toMatchObject({ product: 0, growth: 0, recruiting: 0 });
    // No product work: quality 50 − 2 = 48.
    expect(report.quality.end).toBeCloseTo(48, 4);
    expect(allFinite(lean)).toBe(true);
    expect(jsonCopy(lean)).toStrictEqual(lean);

    // A founder alone: the only person raises.
    const solo = withCompany(trio, HUMAN, { headcount: 1, headcountAtLastClose: 1 });
    const alone = resolve(solo, { [HUMAN]: nobody }, 1, QUIET);
    expect(reportFor(alone, HUMAN).notes).toEqual([]);
    expect(reportFor(alone, HUMAN).raise?.amount).toBeCloseTo(180_000, 0);
    expect(reportFor(alone, HUMAN).work).toMatchObject({ product: 0, growth: 0, recruiting: 0 });
    expect(reportFor(alone, HUMAN).quality.end).toBeCloseTo(48, 4);
    expect(reportFor(alone, HUMAN).costs.salaries).toBe(40_000);
    expect(allFinite(alone)).toBe(true);
    expect(jsonCopy(alone)).toStrictEqual(alone);
  });

  it("the plan in the report is a legal plan, and playing it gives the same turn", () => {
    const state = launchedCompany(newGame(), HUMAN, { hype: 20 });
    const messy: Partial<Plan>[] = [
      { raisePercent: 15, allocation: split(2, 0, 0) },
      { raisePercent: 20, layoffs: 9, allocation: split(5, 5, 5) },
      { poachTarget: HUMAN, allocation: split(0, 0, 0) },
      { raisePercent: 30, poachTarget: BLITZ, layoffs: 1, allocation: split(4, 1, 1), marketing: 50_000 },
    ];
    for (const plan of messy) {
      const played = reportFor(resolve(state, { [HUMAN]: plan }, 1, QUIET), HUMAN).plan;
      expectFixedUp(state, { [HUMAN]: plan }, { [HUMAN]: played });
    }
  });

  it("a poach on a company that is out is dropped", () => {
    const state = onlyActive(newGame(), [HUMAN, BOOT, INCUMBENT]);
    const fixed = expectFixedUp(state, { [HUMAN]: { poachTarget: BLITZ } }, {});
    expect(reportFor(fixed, HUMAN).poach).toBeNull();
    expect(reportFor(fixed, HUMAN).costs.poaching).toBe(0);
    expect(reportFor(fixed, HUMAN).plan.poachTarget).toBeNull();
  });

  it("a poach on a team of 1 is dropped; a team of 2 can be raided", () => {
    const alone = withCompany(newGame(), BOOT, { headcount: 1, headcountAtLastClose: 1 });
    const one: Partial<Plan> = { allocation: split(1, 0, 0) };
    const fixed = expectFixedUp(alone, { [HUMAN]: { poachTarget: BOOT }, [BOOT]: one }, { [BOOT]: one });
    expect(reportFor(fixed, HUMAN).poach).toBeNull();
    expect(reportFor(fixed, HUMAN).costs.poaching).toBe(0);
    expect(fixed.state.companies[BOOT].headcount).toBe(1);

    const pair = withCompany(newGame(), BOOT, { headcount: 2, headcountAtLastClose: 2 });
    const result = resolve(pair, { [HUMAN]: { poachTarget: BOOT }, [BOOT]: { allocation: split(2, 0, 0) } }, 1, QUIET);
    const report = reportFor(result, HUMAN);
    expect(report.notes).toEqual([]);
    expect(report.poach?.targetId).toBe(BOOT);
    // Chance = 50% + (10 − 10) ÷ 2 = 50%. $50,000 whether or not it works.
    expect(report.poach?.chance).toBeCloseTo(0.5, 10);
    expect(report.costs.poaching).toBe(50_000);
  });

  it("a poach on yourself is dropped", () => {
    const fixed = expectFixedUp(newGame(), { [HUMAN]: { poachTarget: HUMAN } }, {});
    expect(reportFor(fixed, HUMAN).poach).toBeNull();
    expect(reportFor(fixed, HUMAN).costs.poaching).toBe(0);
    expect(fixed.state.companies[HUMAN].headcount).toBe(3);
  });

  it("a poach on a team that its own layoffs leave at 1 is dropped at no cost", () => {
    const state = withCompany(newGame(), BOOT, { headcount: 2, headcountAtLastClose: 2 });
    const shrink: Partial<Plan> = { layoffs: 1, allocation: split(1, 0, 0) };
    const tried = resolve(state, { [HUMAN]: { poachTarget: BOOT }, [BOOT]: shrink }, 1, QUIET);
    const clean = resolve(state, { [BOOT]: shrink }, 1, QUIET);
    const report = reportFor(tried, HUMAN);
    expect(report.poach).toBeNull();
    expect(report.costs.poaching).toBe(0);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.costs.total).toBe(reportFor(clean, HUMAN).costs.total);
    expect(report.cash.end).toBe(reportFor(clean, HUMAN).cash.end);
    // BOOT: 2 − 1 laid off = 1, and nobody took its last person.
    expect(tried.state.companies[BOOT].headcount).toBe(1);
    expect(tried.state.companies[HUMAN].headcount).toBe(3);
  });

  it("a second poacher who finds the target down to 1 person pays nothing and is told", () => {
    let state = withCompany(newGame(), BOOT, { headcount: 2, headcountAtLastClose: 2, hype: 0 });
    state = withCompany(state, HUMAN, { hype: 90 });
    state = withCompany(state, BLITZ, { hype: 50 });
    const plans: Patches = {
      [HUMAN]: { poachTarget: BOOT },
      [BLITZ]: { poachTarget: BOOT },
      [BOOT]: { allocation: split(2, 0, 0) },
    };
    const humanPoach = (seed: number) => reportFor(resolve(state, plans, seed, QUIET), HUMAN).poach;
    const firstWins = seedWhere((seed) => humanPoach(seed)?.success === true);
    const firstFails = seedWhere((seed) => humanPoach(seed)?.success === false);

    // HUMAN has the most hype, so it goes first. Chance = 50% + (90 − 0) ÷ 2 = 95%, held at 90%.
    const won = resolve(state, plans, firstWins, QUIET);
    expect(reportFor(won, HUMAN).poach?.chance).toBeCloseTo(0.9, 10);
    expect(reportFor(won, HUMAN).costs.poaching).toBe(50_000);
    // BOOT is down to 1 person at that moment, so BLITZ's attempt is dropped at no cost.
    expect(reportFor(won, BLITZ).poach).toBeNull();
    expect(reportFor(won, BLITZ).costs.poaching).toBe(0);
    expect(reportFor(won, BLITZ).notes.length).toBeGreaterThan(0);
    expect(won.state.companies[BOOT].headcount).toBe(1);
    expect(won.state.companies[HUMAN].headcount).toBe(4);
    expect(won.state.companies[BLITZ].headcount).toBe(3);

    // When HUMAN misses, BLITZ gets its try: chance = 50% + (50 − 0) ÷ 2 = 75%, and it pays.
    const lost = resolve(state, plans, firstFails, QUIET);
    expect(reportFor(lost, BLITZ).poach?.chance).toBeCloseTo(0.75, 10);
    expect(reportFor(lost, BLITZ).costs.poaching).toBe(50_000);
    expect(reportFor(lost, HUMAN).costs.poaching).toBe(50_000);
  });
});

// ── Public information ──

describe("flow: what is public about a rival (ruling 18)", () => {
  const PUBLIC_COMPANY_KEYS = [
    "founderEquity",
    "founderSeats",
    "headcount",
    "hype",
    "id",
    "investorSeats",
    "lastQuarter",
    "lastRaise",
    "launched",
    "name",
    "out",
    "pitch",
    "price",
    "quality",
    "users",
  ];
  const PRIVATE_KEYS = [
    "cash",
    "controller",
    "archetype",
    "lastPlan",
    "plan",
    "allocation",
    "marketing",
    "hireLimit",
    "poachTarget",
    "lastRevenue",
    "lastCosts",
    "lastPull",
    "costs",
    "revenue",
    "runway",
    "work",
    "notes",
    "pull",
    "share",
    "chance",
  ];

  // A turn in which every rival does something it would rather keep to itself.
  const start = launchedCompany(newGame(), BLITZ, { hype: 30 });
  const played = resolve(
    start,
    {
      [BLITZ]: { allocation: split(1, 1, 0), raisePercent: 20, marketing: 75_000, price: "budget", hireLimit: 2 },
      [BOOT]: { allocation: split(2, 0, 1), marketing: 25_000, price: "premium" },
      [INCUMBENT]: { poachTarget: HUMAN, marketing: 100_000 },
    },
    3,
    QUIET,
  );

  it("publicCompany keeps the public fields and drops cash, plans and the controller", () => {
    const full = played.state.companies[BLITZ];
    const shown = publicCompany(full);
    expect(Object.keys(shown).sort()).toEqual(PUBLIC_COMPANY_KEYS);
    for (const key of PRIVATE_KEYS) expect(keysDeep(shown).has(key)).toBe(false);
    // What is public is the truth.
    expect(shown).toMatchObject({
      id: BLITZ,
      name: full.name,
      users: full.users,
      headcount: full.headcount,
      hype: full.hype,
      quality: full.quality,
      launched: true,
      price: "budget",
      founderSeats: 2,
      investorSeats: 1,
    });
    // Last raise: its turn, percent and amount. 10,000 × $150 × 1.3 = $1,950,000; 20% = $390,000.
    expect(shown.lastRaise).toEqual({ turn: 1, percent: 20, amount: 390_000 });
    expect(shown.founderEquity).toBeCloseTo(0.8, 10);
    expect(shown.lastQuarter).toEqual(full.lastQuarter);
    // The owner's record does hold the private fields, so there was something to hide.
    expect(full.lastPlan.marketing).toBe(75_000);
    expect(full.controller).toBe("blitzscaler");
  });

  it("viewFor shows a company itself in full and its rivals in public only", () => {
    const view = viewFor(played.state, HUMAN);
    expect(view.self).toEqual(played.state.companies[HUMAN]);
    expect(view.self.cash).toBe(played.state.companies[HUMAN].cash);
    expect(view.rivals.map((rival) => rival.id)).toEqual([BLITZ, BOOT, INCUMBENT]);
    for (const rival of view.rivals) {
      expect(Object.keys(rival).sort()).toEqual(PUBLIC_COMPANY_KEYS);
      expect(rival).toEqual(publicCompany(played.state.companies[rival.id]));
    }
    for (const key of PRIVATE_KEYS) expect(keysDeep(view.rivals).has(key)).toBe(false);
    expect(view.turn).toBe(played.state.turn);
    expect(view.climate).toEqual(played.state.climate);
    expect(view.event).toEqual(played.state.event);
    expect(view.modifiers).toEqual(played.state.modifiers);
    expect(view.carryOverUsers).toBe(played.state.carryOverUsers);
    expect(view.freedPeople).toBe(played.state.freedPeople);
  });

  it("viewFor shows the turn's event, so everyone can react to it", () => {
    const revealed = play(duo(at(2)), idle(3), only("funding-winter")).state;
    for (const id of [HUMAN, BOOT]) {
      const view = viewFor(revealed, id);
      expect(view.turn).toBe(3);
      expect(view.event).toEqual({ cardId: "funding-winter", targetId: null });
      expect(view.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });
      expect(view.self.id).toBe(id);
    }
  });

  it("viewFor still lists rivals that are out", () => {
    const state = onlyActive(newGame(), [HUMAN, BOOT]);
    const view = viewFor(state, BOOT);
    expect(view.rivals.map((rival) => rival.id)).toEqual([HUMAN, BLITZ, INCUMBENT]);
    expect(view.rivals[1].out).toEqual({ turn: 0, reason: "bankrupt", users: 0, headcount: 0 });
    expect(view.rivals[0].out).toBeNull();
  });

  it("publicReport keeps what everyone may see of a rival's quarter and nothing else", () => {
    const report = reportFor(played, BLITZ);
    const shown = publicReport(report);
    expect(Object.keys(shown).sort()).toEqual(
      ["boardFired", "companyId", "equity", "headcount", "hype", "out", "poach", "price", "quality", "raise", "users", "valuation"].sort(),
    );
    expect(Object.keys(shown.quality).sort()).toEqual(["end", "launchedNow", "start"]);
    expect(Object.keys(shown.users).sort()).toEqual(["churned", "end", "lostToEvent", "open", "won"]);
    expect(Object.keys(shown.hype).sort()).toEqual(["end", "start"]);
    for (const key of PRIVATE_KEYS) expect(keysDeep(shown).has(key)).toBe(false);
    expect(shown.companyId).toBe(BLITZ);
    expect(shown.price).toBe("budget");
    expect(shown.raise).toEqual(report.raise);
    expect(shown.headcount).toEqual(report.headcount);
    expect(shown.users.end).toBe(report.users.end);
    expect(shown.valuation).toBe(report.valuation);
    // The private report does hold the plan and the spend.
    expect(report.plan.marketing).toBe(75_000);
    expect(report.costs.marketing).toBe(75_000);
  });

  it("publicReport shows that a rival poached and whether it worked, not its odds", () => {
    const shown = publicReport(reportFor(played, INCUMBENT));
    expect(shown.poach).not.toBeNull();
    expect(Object.keys(shown.poach ?? {}).sort()).toEqual(["success", "targetId"]);
    expect(shown.poach?.targetId).toBe(HUMAN);
    expect(shown.poach?.success).toBe(reportFor(played, INCUMBENT).poach?.success);
    for (const key of PRIVATE_KEYS) expect(keysDeep(shown).has(key)).toBe(false);
  });
});

// ── Determinism, replay and JSON ──

describe("flow: determinism, replay and JSON", () => {
  it("the same seed and plans give an identical state and log, turn after turn", () => {
    const first = playScript(11, 12);
    const second = playScript(11, 12);
    expect(first.logs.length).toBeGreaterThan(5);
    expect(second.states).toStrictEqual(first.states);
    expect(second.logs).toStrictEqual(first.logs);
    expect(JSON.stringify(second.states)).toBe(JSON.stringify(first.states));
    expect(JSON.stringify(second.logs)).toBe(JSON.stringify(first.logs));
  });

  it("the result does not depend on which copy of the state and plans it is given", () => {
    const { states, plans } = playScript(8, 6);
    const state = states[4];
    const set = plans[4];
    const original = resolveTurn(state, set, 8, DESIGN);
    const copy = resolveTurn(jsonCopy(state), jsonCopy(set), 8, DESIGN);
    expect(copy).toStrictEqual(original);
  });

  it("resolving a turn changes neither the state nor the plans it was given", () => {
    const { states, plans } = playScript(8, 6);
    const state = deepFreeze(jsonCopy(states[4]));
    const set = deepFreeze(jsonCopy(plans[4]));
    const before = JSON.stringify({ state, set });
    const result = resolveTurn(state, set, 8, DESIGN);
    expect(JSON.stringify({ state, set })).toBe(before);
    expect(result.state).not.toBe(state);
    expect(result.state.turn).toBe(state.turn + 1);
  });

  it("any number works as a seed, a timestamp included", () => {
    const state = at(2);
    for (const seed of [0, -7, 2 ** 31, 2 ** 32 + 3, 1_764_000_000_000]) {
      const first = resolve(state, {}, seed, DESIGN);
      const second = resolve(state, {}, seed, DESIGN);
      expect(second).toStrictEqual(first);
      expect(first.state.turn).toBe(3);
      expect(first.state.event !== null).toBe(firstFloat(seed, 3, STREAM.eventRoll) < 0.5);
      expect(jsonCopy(first)).toStrictEqual(first);
    }
  });

  it("another seed gives another game", () => {
    const games = [1, 2, 3, 4, 5].map((seed) => JSON.stringify(playScript(seed, 12).logs));
    expect(new Set(games).size).toBe(5);
  });

  it("a company's choices do not shift the event that is drawn", () => {
    const state = at(2);
    for (let seed = 1; seed <= 60; seed++) {
      const plain = resolve(state, {}, seed, SURE).state.event;
      const busy = resolve(
        state,
        { [HUMAN]: { allocation: split(1, 1, 1), marketing: 100_000, price: "premium" } },
        seed,
        SURE,
      ).state.event;
      // Every card has a valid target either way, so the same seed and turn draw the same card.
      expect(busy?.cardId).toBe(plain?.cardId);
    }
  });

  it("one company's choices do not shift another company's roll", () => {
    const state = newGame();
    let successes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const alone = reportFor(resolve(state, { [BLITZ]: { poachTarget: BOOT } }, seed, QUIET), BLITZ).poach;
      const crowded = reportFor(
        resolve(
          state,
          { [BLITZ]: { poachTarget: BOOT }, [HUMAN]: { poachTarget: INCUMBENT, marketing: 50_000, price: "budget" } },
          seed,
          QUIET,
        ),
        BLITZ,
      ).poach;
      // BLITZ on BOOT: 50% + (10 − 10) ÷ 2 = 50%, and the same answer whatever HUMAN does (ruling 20).
      expect(alone?.chance).toBeCloseTo(0.5, 10);
      expect(crowded).toEqual(alone);
      if (alone?.success) successes++;
    }
    // 40 coin flips: mean 20, standard deviation 3.2. Both outcomes happen.
    expect(successes).toBeGreaterThan(5);
    expect(successes).toBeLessThan(35);
  });

  it("replayGame rebuilds a game from its setup, seed and plans", () => {
    for (const seed of [4, 21]) {
      const game = playScript(seed, 20);
      const record: GameRecord = { setup: FOUR_SEATS, seed, plans: game.plans };
      const replay = replayGame(record, DESIGN);
      expect(replay.state).toStrictEqual(game.state);
      expect(replay.logs).toStrictEqual(game.logs);
    }
  });

  it("replayGame also rebuilds a game in progress, and one played on missing plans", () => {
    const game = playScript(6, 20);
    expect(game.plans.length).toBeGreaterThan(5);
    const partial = replayGame({ setup: FOUR_SEATS, seed: 6, plans: game.plans.slice(0, 5) }, DESIGN);
    expect(partial.state).toStrictEqual(game.states[5]);
    expect(partial.logs).toStrictEqual(game.logs.slice(0, 5));

    let state = newGame();
    const plans: PlanSet[] = [];
    const logs: TurnLog[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      const set: PlanSet = [null, null, null, null];
      const result = resolveTurn(state, set, 6, DESIGN);
      plans.push(set);
      logs.push(result.log);
      state = result.state;
    }
    const replay = replayGame({ setup: FOUR_SEATS, seed: 6, plans }, DESIGN);
    expect(replay.state).toStrictEqual(state);
    expect(replay.logs).toStrictEqual(logs);
  });

  it("state and log survive JSON.stringify / JSON.parse unchanged, and the game goes on from the copy", () => {
    for (const seed of [3, 17]) {
      const game = playScript(seed, 20);
      expect(game.logs.length).toBeGreaterThan(5);
      game.states.forEach((state) => expect(jsonCopy(state)).toStrictEqual(state));
      game.logs.forEach((log) => expect(jsonCopy(log)).toStrictEqual(log));
      game.plans.forEach((set, index) => {
        const fromCopy = resolveTurn(jsonCopy(game.states[index]), set, seed, DESIGN);
        expect(fromCopy.state).toStrictEqual(game.states[index + 1]);
        expect(fromCopy.log).toStrictEqual(game.logs[index]);
      });
    }
  });

  it("a state holding an event and a climate survives JSON too", () => {
    const winter = play(duo(at(2)), idle(3), only("funding-winter"));
    expect(jsonCopy(winter.state)).toStrictEqual(winter.state);
    expect(jsonCopy(winter.log)).toStrictEqual(winter.log);
    const breach = play(goingConcern(duo(at(2))), idle(3), only("security-breach"));
    expect(jsonCopy(breach.state)).toStrictEqual(breach.state);
    expect(jsonCopy(breach.log)).toStrictEqual(breach.log);
  });
});

// ── Whole games ──

describe("whole games on the design's numbers keep to the event rules", () => {
  const CLIMATE_CARDS: Readonly<Record<string, { multiplier: number; turnsLeft: number }>> = {
    "funding-winter": { multiplier: 0.6, turnsLeft: 3 },
    "hot-market": { multiplier: 1.4, turnsLeft: 2 },
  };
  const MODIFIER_CARDS: Readonly<Record<string, typeof NEUTRAL>> = {
    "talent-glut": { newUsers: 1, marketing: 1, extraCandidates: 4 },
    "market-boom": { newUsers: 1.5, marketing: 1, extraCandidates: 0 },
    "ad-prices-spike": { newUsers: 1, marketing: 0.5, extraCandidates: 0 },
  };

  /** Plays games to the end and checks every turn against the rules. Returns the cards and the exits it saw. */
  const expectGamesKeepTheRules = (seeds: number, planner: (state: GameState) => PlanSet) => {
    const cardsSeen = new Set<string>();
    const exits = new Set<string>();
    for (let seed = 1; seed <= seeds; seed++) {
      let state = newGame();
      while (!state.outcome) {
        const before = state;
        const { state: after, log } = resolveTurn(before, planner(before), seed, DESIGN);
        expect(jsonCopy(after)).toStrictEqual(after);
        expect(jsonCopy(log)).toStrictEqual(log);
        for (const report of log.companies) if (report?.out) exits.add(report.out);

        expect(log.turn).toBe(before.turn);
        expect(log.event).toEqual(before.event);
        expect(log.climateMultiplier).toBe(before.climate.turnsLeft > 0 ? before.climate.multiplier : 1);
        log.companies.forEach((report, id) => expect(report === null).toBe(before.companies[id].out !== null));

        // New users = 20,000 × 1.1^(turn − 1), times the boom if there is one, in whole users.
        const newUsers = 20_000 * 1.1 ** (before.turn - 1) * before.modifiers.newUsers;
        expect(Math.abs(log.market.newUsers - newUsers)).toBeLessThanOrEqual(1);
        // Users are conserved: nobody leaves the system, and only the new users join it.
        expect(usersInSystem(after)).toBe(usersInSystem(before) + log.market.newUsers);
        // Candidates = 6 + the event's bonus + staff freed last turn + everyone laid off this turn.
        const laidOff = log.companies.reduce((sum, report) => sum + (report?.headcount.laidOff ?? 0), 0);
        expect(log.hiring.candidates).toBe(6 + before.modifiers.extraCandidates + before.freedPeople + laidOff);

        for (const company of after.companies) {
          expect(company.hype).toBeGreaterThanOrEqual(0);
          expect(company.hype).toBeLessThanOrEqual(100);
          expect(company.quality).toBeGreaterThanOrEqual(0);
          expect(company.quality).toBeLessThanOrEqual(100);
          if (company.out === null) expect(company.headcount).toBeGreaterThanOrEqual(1);
        }

        if (after.outcome) {
          expect(after.turn).toBe(before.turn);
          expect(log.nextEvent).toBeNull();
          expect(log.outcome).toEqual(after.outcome);
        } else {
          expect(after.turn).toBe(before.turn + 1);
          expect(log.nextEvent).toEqual(after.event);
          // From turn 3, an event exactly when that turn's roll is under 50%.
          const rolled = after.turn >= 3 && firstFloat(seed, after.turn, STREAM.eventRoll) < 0.5;
          expect(after.event !== null).toBe(rolled);

          const cardId = after.event?.cardId ?? "none";
          cardsSeen.add(cardId);
          // This-turn effects belong to the card of this turn only.
          expect(after.modifiers).toEqual(MODIFIER_CARDS[cardId] ?? NEUTRAL);
          // A climate card starts its own count; otherwise the running climate ticks down.
          const ticked =
            before.climate.turnsLeft > 1
              ? { multiplier: before.climate.multiplier, turnsLeft: before.climate.turnsLeft - 1 }
              : NORMAL;
          expect(after.climate).toEqual(CLIMATE_CARDS[cardId] ?? ticked);

          const targetId = after.event?.targetId ?? null;
          const needsTarget = ["viral-moment", "burnout", "press-feature", "security-breach"].includes(cardId);
          expect(targetId !== null).toBe(needsTarget);
          if (targetId !== null) {
            const target = after.companies[targetId];
            expect(target.out).toBeNull();
            if (cardId === "burnout") {
              expect(target.headcountAtLastClose).toBeGreaterThanOrEqual(2);
              expect(target.headcount).toBe(target.headcountAtLastClose - 1);
            }
            if (cardId === "security-breach") {
              expect(target.launched).toBe(true);
              expect(target.quality).toBeLessThan(50);
              expect(target.usersAtLastClose).toBeGreaterThanOrEqual(1);
              const lost = target.usersAtLastClose - target.users;
              expect(Math.abs(lost - target.usersAtLastClose * 0.1)).toBeLessThanOrEqual(0.5);
            }
            if (cardId === "press-feature") {
              expect(target.launched).toBe(true);
              for (const other of after.companies) {
                if (other.out === null && other.launched) expect(target.quality).toBeGreaterThanOrEqual(other.quality);
              }
            }
          }
          // Whoever was not the target kept the users and people it closed the quarter with.
          for (const company of after.companies) {
            if (company.out !== null || company.id === targetId) continue;
            expect(company.users).toBe(company.usersAtLastClose);
            expect(company.headcount).toBe(company.headcountAtLastClose);
          }
        }
        state = after;
      }
      expect(state.turn).toBeLessThanOrEqual(20);
    }
    return { cardsSeen, exits };
  };

  it("over 30 quiet games: turns, events, climate, modifiers, targets, hype bounds and users all add up", () => {
    const { cardsSeen } = expectGamesKeepTheRules(30, scripted);
    // 30 games are enough to see every card of the deck, and turns without one.
    expect([...cardsSeen].sort()).toEqual([...DESIGN.events.deck.map((entry) => entry.id), "none"].sort());
  });

  it("the same holds over 30 rough games, with raises, poaching, layoffs and companies going out", () => {
    // Every company asks for a raise every turn (dropped whenever it is not allowed), poaches and spends.
    const rough = (state: GameState): PlanSet =>
      plansOf(state, {
        [HUMAN]: { raisePercent: 30, poachTarget: BLITZ, layoffs: state.turn % 4 === 0 ? 1 : 0, marketing: 50_000 },
        [BLITZ]: { raisePercent: 30, poachTarget: INCUMBENT, marketing: 150_000, price: "budget" },
        [BOOT]: { raisePercent: 10, layoffs: state.turn % 5 === 0 ? 1 : 0, price: "premium" },
        [INCUMBENT]: { raisePercent: 20, poachTarget: HUMAN, marketing: 100_000 },
      });
    const { cardsSeen, exits } = expectGamesKeepTheRules(30, rough);
    expect(cardsSeen.size).toBeGreaterThan(5);
    // The point of the rough script: companies do go out, so freed staff and released users are exercised.
    expect(exits.size).toBeGreaterThan(0);
  });
});
