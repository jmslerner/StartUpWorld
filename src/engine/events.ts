// The event deck. Cards are data in the config; this file only knows the effect kinds.
// An event is drawn at the end of one turn for the next, and its instant effects are applied
// straight away, so the state a turn starts from already shows it.

import { datedCardFor, rulesForTurn } from "./career";
import { clamp, round4 } from "./formulas";
import { STREAM, firstFloat, nextIntInclusive, pickWeightedIndex, streamSeed } from "./rng";
import type { ActiveEvent, Climate, Company, CompanyId, EventCard, RulesConfig, TargetRule, TurnModifiers } from "./types";

export const NEUTRAL_MODIFIERS: TurnModifiers = { newUsers: 1, marketing: 1, extraCandidates: 0 };

/** The parts of the game state an event can touch. */
export interface EventContext {
  readonly companies: readonly Company[];
  readonly climate: Climate;
  readonly modifiers: TurnModifiers;
  readonly carryOverUsers: number;
}

/** A card by id: in the config's deck, in the deck of any of a career's eras, or among a career's dated cards. */
export const findCard = (cardId: string, config: RulesConfig): Omit<EventCard, "weight"> | undefined =>
  [config.events.deck, ...(config.career?.eras ?? []).map((era) => era.values.events?.deck ?? []), config.career?.dated ?? []]
    .flat()
    .find((card) => card.id === cardId);

/** Companies a card may hit: still in the game and matching every condition of the rule. */
export const eligibleTargets = (rule: TargetRule, companies: readonly Company[]): CompanyId[] =>
  companies
    .filter(
      (company) =>
        company.out === null &&
        (rule.launched === undefined || company.launched === rule.launched) &&
        (rule.qualityBelow === undefined || company.quality < rule.qualityBelow) &&
        (rule.minUsers === undefined || company.users >= rule.minUsers) &&
        (rule.minHeadcount === undefined || company.headcount >= rule.minHeadcount),
    )
    .map((company) => company.id);

/** The company a card hits, picked by its target rule from those that qualify; null when it needs none or none qualifies. */
const targetOf = (card: Omit<EventCard, "weight">, companies: readonly Company[], turn: number, seed: number): CompanyId | null => {
  if (card.target === undefined) return null;
  let candidates = eligibleTargets(card.target, companies);
  if (candidates.length === 0) return null;
  if (card.target.pick === "highestQuality") {
    const best = Math.max(...candidates.map((id) => companies[id].quality));
    candidates = candidates.filter((id) => companies[id].quality === best);
  }
  const index = nextIntInclusive(streamSeed(seed, turn, STREAM.eventTarget), 0, candidates.length - 1).value;
  return candidates[index];
};

/**
 * The event for `turn`, or null. A card dated to the turn's year is always the event, without a roll. Otherwise the
 * card is drawn on that turn's numbers, leaving out cards with no valid target.
 */
export const drawEvent = (companies: readonly Company[], turn: number, seed: number, config: RulesConfig): ActiveEvent | null => {
  const dated = datedCardFor(turn, config);
  if (dated !== null) return { cardId: dated.id, targetId: targetOf(dated, companies, turn, seed) };

  const { events } = rulesForTurn(config, turn);
  if (turn < events.firstTurn) return null;
  if (firstFloat(seed, turn, STREAM.eventRoll) >= events.chance) return null;

  const playable = events.deck.filter((card) => card.target === undefined || eligibleTargets(card.target, companies).length > 0);
  const picked = pickWeightedIndex(
    streamSeed(seed, turn, STREAM.eventCard),
    playable.map((card) => card.weight),
  ).value;
  if (picked === null) return null;
  const card = playable[picked];
  return { cardId: card.id, targetId: targetOf(card, companies, turn, seed) };
};

/** Apply a card's effects. Users a company loses join the pool, so users stay conserved. */
export const applyEvent = (context: EventContext, event: ActiveEvent, config: RulesConfig): EventContext => {
  const card = findCard(event.cardId, config);
  if (card === undefined) return context;

  let { climate, modifiers, carryOverUsers } = context;
  let target = event.targetId === null ? undefined : context.companies[event.targetId];

  for (const effect of card.effects) {
    switch (effect.kind) {
      case "fundingClimate":
        climate = { multiplier: effect.multiplier, turnsLeft: effect.turns };
        break;
      case "newUsers":
        modifiers = { ...modifiers, newUsers: effect.multiplier };
        break;
      case "marketingEffect":
        modifiers = { ...modifiers, marketing: effect.multiplier };
        break;
      case "candidates":
        modifiers = { ...modifiers, extraCandidates: effect.extra };
        break;
      case "targetHype":
        if (target) target = { ...target, hype: round4(clamp(target.hype + effect.delta, 0, 100)) };
        break;
      case "targetHeadcount":
        if (target) target = { ...target, headcount: Math.max(1, target.headcount + effect.delta) };
        break;
      case "targetUsers":
        if (target) {
          const lost = Math.min(target.users, Math.round(target.users * effect.fraction));
          target = { ...target, users: target.users - lost };
          carryOverUsers += lost;
        }
        break;
    }
  }

  const changed = target;
  const companies = changed === undefined ? context.companies : context.companies.map((company) => (company.id === changed.id ? changed : company));
  return { companies, climate, modifiers, carryOverUsers };
};
