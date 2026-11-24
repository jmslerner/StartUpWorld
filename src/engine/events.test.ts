import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { NEUTRAL_MODIFIERS, applyEvent, drawEvent, eligibleTargets, type EventContext } from "./events";
import { BLITZ, BOOT, HUMAN, INCUMBENT, newGame, onlyActive, withCompany } from "./testKit";
import type { EventCard, GameState, RulesConfig } from "./types";

const contextOf = (state: GameState): EventContext => ({
  companies: state.companies,
  climate: state.climate,
  modifiers: state.modifiers,
  carryOverUsers: state.carryOverUsers,
});

/** Everyone launched and sizeable, with one shaky product, so every card has a valid target. */
const busyGame = (): GameState => {
  let state = newGame();
  state = withCompany(state, HUMAN, { launched: true, quality: 60, users: 20_000, headcount: 6, hype: 30 });
  state = withCompany(state, BLITZ, { launched: true, quality: 35, users: 40_000, headcount: 9, hype: 45 });
  state = withCompany(state, BOOT, { launched: true, quality: 70, users: 8_000, headcount: 4, hype: 12 });
  return withCompany(state, INCUMBENT, { quality: 82, users: 90_000, headcount: 12, hype: 25 });
};

const withDeck = (deck: readonly EventCard[]): RulesConfig => ({ ...DESIGN, events: { ...DESIGN.events, chance: 1, deck } });
const card = (id: string): EventCard => {
  const found = DESIGN.events.deck.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

describe("drawEvent", () => {
  it("draws nothing before turn 3", () => {
    const state = busyGame();
    for (let seed = 1; seed <= 300; seed++) {
      expect(drawEvent(state.companies, 1, seed, DESIGN)).toBeNull();
      expect(drawEvent(state.companies, 2, seed, DESIGN)).toBeNull();
    }
  });

  it("draws an event on about half the turns from turn 3", () => {
    const state = busyGame();
    let hits = 0;
    let draws = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (let turn = 3; turn <= 20; turn++) {
        if (drawEvent(state.companies, turn, seed, DESIGN) !== null) hits++;
        draws++;
      }
    }
    expect(hits / draws).toBeGreaterThan(0.46);
    expect(hits / draws).toBeLessThan(0.54);
  });

  it("is the same for the same seed and turn", () => {
    const state = busyGame();
    for (let turn = 3; turn <= 20; turn++) {
      expect(drawEvent(state.companies, turn, 77, DESIGN)).toEqual(drawEvent(state.companies, turn, 77, DESIGN));
    }
  });

  it("draws every card of the deck, roughly equally often", () => {
    const state = busyGame();
    const always = withDeck(DESIGN.events.deck);
    const counts = new Map<string, number>();
    const draws = 4_500;
    for (let seed = 1; seed <= draws; seed++) {
      const event = drawEvent(state.companies, 5, seed, always);
      expect(event).not.toBeNull();
      counts.set(event!.cardId, (counts.get(event!.cardId) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(DESIGN.events.deck.map((c) => c.id).sort());
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan((draws / 9) * 0.8);
      expect(count).toBeLessThan((draws / 9) * 1.2);
    }
  });

  it("leaves out cards that have no valid target", () => {
    // Nobody launched: no best product to feature and nobody to breach.
    const unlaunched = onlyActive(newGame(), [HUMAN, BLITZ, BOOT]);
    // Everyone launched is at quality 50 or more: nobody to breach.
    const solid = withCompany(busyGame(), BLITZ, { quality: 50 });
    const always = withDeck(DESIGN.events.deck);
    for (let seed = 1; seed <= 1_500; seed++) {
      const a = drawEvent(unlaunched.companies, 4, seed, always);
      expect(["press-feature", "security-breach"]).not.toContain(a?.cardId);
      expect(drawEvent(solid.companies, 4, seed, always)?.cardId).not.toBe("security-breach");
    }
  });

  it("draws nothing when no card can be played", () => {
    const unlaunched = onlyActive(newGame(), [HUMAN, BLITZ, BOOT]);
    const onlyBreach = withDeck([card("security-breach")]);
    for (let seed = 1; seed <= 200; seed++) expect(drawEvent(unlaunched.companies, 4, seed, onlyBreach)).toBeNull();
  });

  it("gives targeted cards a target and the others none", () => {
    const state = busyGame();
    const always = withDeck(DESIGN.events.deck);
    for (let seed = 1; seed <= 600; seed++) {
      const event = drawEvent(state.companies, 6, seed, always)!;
      const targeted = card(event.cardId).target !== undefined;
      expect(event.targetId !== null, event.cardId).toBe(targeted);
    }
  });

  it("picks a random company in the game for the viral moment, each about equally often", () => {
    const state = onlyActive(busyGame(), [HUMAN, BLITZ, INCUMBENT]);
    const config = withDeck([card("viral-moment")]);
    const counts = [0, 0, 0, 0];
    for (let seed = 1; seed <= 3_000; seed++) counts[drawEvent(state.companies, 4, seed, config)!.targetId!]++;
    expect(counts[BOOT]).toBe(0);
    for (const id of [HUMAN, BLITZ, INCUMBENT]) {
      expect(counts[id]).toBeGreaterThan(850);
      expect(counts[id]).toBeLessThan(1_150);
    }
  });

  it("features the best launched product", () => {
    const state = busyGame();
    const config = withDeck([card("press-feature")]);
    for (let seed = 1; seed <= 100; seed++) expect(drawEvent(state.companies, 4, seed, config)!.targetId).toBe(INCUMBENT);
  });

  it("only breaches a launched product under quality 50 that has users", () => {
    const state = busyGame();
    const config = withDeck([card("security-breach")]);
    for (let seed = 1; seed <= 100; seed++) expect(drawEvent(state.companies, 4, seed, config)!.targetId).toBe(BLITZ);
    const noUsers = withCompany(state, BLITZ, { users: 0 });
    for (let seed = 1; seed <= 100; seed++) expect(drawEvent(noUsers.companies, 4, seed, config)).toBeNull();
  });

  it("never burns out a one-person company", () => {
    const state = withCompany(withCompany(busyGame(), HUMAN, { headcount: 1 }), BOOT, { headcount: 1 });
    const config = withDeck([card("burnout")]);
    for (let seed = 1; seed <= 400; seed++) expect([BLITZ, INCUMBENT]).toContain(drawEvent(state.companies, 4, seed, config)!.targetId);
  });
});

describe("eligibleTargets", () => {
  it("never includes a company that is out", () => {
    const state = onlyActive(busyGame(), [HUMAN, INCUMBENT]);
    expect(eligibleTargets({ pick: "random" }, state.companies)).toEqual([HUMAN, INCUMBENT]);
  });
});

describe("applyEvent", () => {
  it("funding winter: valuations ×0.6 for 3 turns", () => {
    const next = applyEvent(contextOf(busyGame()), { cardId: "funding-winter", targetId: null }, DESIGN);
    expect(next.climate).toEqual({ multiplier: 0.6, turnsLeft: 3 });
  });

  it("hot market: valuations ×1.4 for 2 turns, replacing a running climate", () => {
    const winter = { ...contextOf(busyGame()), climate: { multiplier: 0.6, turnsLeft: 2 } };
    expect(applyEvent(winter, { cardId: "hot-market", targetId: null }, DESIGN).climate).toEqual({ multiplier: 1.4, turnsLeft: 2 });
  });

  it("viral moment: +20 hype for the target, never above 100", () => {
    const next = applyEvent(contextOf(busyGame()), { cardId: "viral-moment", targetId: HUMAN }, DESIGN);
    expect(next.companies[HUMAN].hype).toBe(50);
    const hot = withCompany(busyGame(), HUMAN, { hype: 95 });
    expect(applyEvent(contextOf(hot), { cardId: "viral-moment", targetId: HUMAN }, DESIGN).companies[HUMAN].hype).toBe(100);
  });

  it("burnout: the target loses one person", () => {
    const next = applyEvent(contextOf(busyGame()), { cardId: "burnout", targetId: BLITZ }, DESIGN);
    expect(next.companies[BLITZ].headcount).toBe(8);
  });

  it("press feature: +15 hype for the target", () => {
    const next = applyEvent(contextOf(busyGame()), { cardId: "press-feature", targetId: INCUMBENT }, DESIGN);
    expect(next.companies[INCUMBENT].hype).toBe(40);
  });

  it("security breach: the target loses 10% of its users to the pool and 10 hype", () => {
    const before = contextOf(busyGame());
    const next = applyEvent(before, { cardId: "security-breach", targetId: BLITZ }, DESIGN);
    expect(next.companies[BLITZ].users).toBe(36_000);
    expect(next.companies[BLITZ].hype).toBe(35);
    expect(next.carryOverUsers).toBe(before.carryOverUsers + 4_000);
    // The previous close is untouched, so the loss shows up as "users fell" this quarter.
    expect(next.companies[BLITZ].usersAtLastClose).toBe(before.companies[BLITZ].usersAtLastClose);
  });

  it("security breach: hype never goes below 0", () => {
    const low = withCompany(busyGame(), BLITZ, { hype: 4 });
    expect(applyEvent(contextOf(low), { cardId: "security-breach", targetId: BLITZ }, DESIGN).companies[BLITZ].hype).toBe(0);
  });

  it("talent glut: 4 extra candidates this turn", () => {
    expect(applyEvent(contextOf(busyGame()), { cardId: "talent-glut", targetId: null }, DESIGN).modifiers).toEqual({ ...NEUTRAL_MODIFIERS, extraCandidates: 4 });
  });

  it("market boom: new users ×1.5 this turn", () => {
    expect(applyEvent(contextOf(busyGame()), { cardId: "market-boom", targetId: null }, DESIGN).modifiers).toEqual({ ...NEUTRAL_MODIFIERS, newUsers: 1.5 });
  });

  it("ad prices spike: marketing half as effective this turn", () => {
    expect(applyEvent(contextOf(busyGame()), { cardId: "ad-prices-spike", targetId: null }, DESIGN).modifiers).toEqual({ ...NEUTRAL_MODIFIERS, marketing: 0.5 });
  });

  it("touches nobody but the target, and does not change what it was given", () => {
    const state = busyGame();
    const before = contextOf(state);
    const snapshot = JSON.stringify(before);
    const next = applyEvent(before, { cardId: "security-breach", targetId: BLITZ }, DESIGN);
    expect(JSON.stringify(before)).toBe(snapshot);
    for (const id of [HUMAN, BOOT, INCUMBENT]) expect(next.companies[id]).toBe(state.companies[id]);
  });

  it("plays a card added to the deck without any new code", () => {
    const custom: EventCard = {
      id: "tax-credit",
      name: "Tax credit",
      text: "Everyone hires; one company gets a lift.",
      weight: 1,
      target: { pick: "random", minUsers: 10_000 },
      effects: [
        { kind: "candidates", extra: 2 },
        { kind: "newUsers", multiplier: 2 },
        { kind: "targetHype", delta: 5 },
      ],
    };
    const config = withDeck([custom]);
    const state = busyGame();
    const event = drawEvent(state.companies, 3, 9, config)!;
    expect(event.cardId).toBe("tax-credit");
    expect([HUMAN, BLITZ, INCUMBENT]).toContain(event.targetId);
    const next = applyEvent(contextOf(state), event, config);
    expect(next.modifiers).toEqual({ newUsers: 2, marketing: 1, extraCandidates: 2 });
    expect(next.companies[event.targetId!].hype).toBe(state.companies[event.targetId!].hype + 5);
  });

  it("ignores a card it does not know", () => {
    const before = contextOf(busyGame());
    expect(applyEvent(before, { cardId: "meteor", targetId: null }, DESIGN)).toEqual(before);
  });
});
