// Tycoon events (TYCOON-SPEC §7.2). Appended LAST to eventPool by pool.ts. This file must never import pool.ts
// (pool.ts imports it; the cycle would leave tycoonEvents undefined while eventPool is built), so it keeps its own
// copies of the volatility-scaled helpers (same formula as pool.ts). Cash and board deltas are unscaled.
//
// Every `when` is false for a state with no build in flight, no release and cruft below 30: a run that never typed
// a tycoon command sees exactly today's eligible list, weights and state.rng draws. No apply function draws from any
// RNG, and every apply re-finds its build and degrades to a harmless line when it is gone.
import type { Build, GameState } from "../../types/game";
import { clamp } from "../utils";
import { impactMultiplier } from "../volatility";
import type { EventDef } from "./types";

const scale = (s: GameState, delta: number): number => Math.round(delta * impactMultiplier(s.volatility));
const addRep = (s: GameState, d: number): GameState => ({ ...s, reputation: clamp(s.reputation + scale(s, d), 0, 100) });
const addVcRep = (s: GameState, d: number): GameState => ({ ...s, vcReputation: clamp(s.vcReputation + scale(s, d), 0, 100) });
const addMorale = (s: GameState, d: number): GameState => ({ ...s, culture: { ...s.culture, morale: clamp(s.culture.morale + scale(s, d), 0, 100) } });
const addCohesion = (s: GameState, d: number): GameState => ({ ...s, culture: { ...s.culture, cohesion: clamp(s.culture.cohesion + scale(s, d), 0, 100) } });
const addEgo = (s: GameState, d: number): GameState => ({ ...s, cofounder: { ...s.cofounder, ego: clamp(s.cofounder.ego + scale(s, d), 0, 100) } });
/**
 * Pays a cost out of the bank: never below 0 (§7.2 "not below 0") and, unlike pool.ts's `addCash`, never by RAISING a balance
 * that is already negative (that turned a $6,000 cost into a bailout, ERRATA 71). Returns what was actually paid.
 */
const pay = (s: GameState, cost: number): { state: GameState; paid: number } => {
  const paid = Math.min(cost, Math.max(0, s.cash));
  return { state: paid > 0 ? { ...s, cash: s.cash - paid } : s, paid };
};
const usd = (n: number): string => `$${Math.round(n).toLocaleString()}`;
/** "Cash -$6,000." when paid in full; the copy owns up when the bank could not cover it. */
const cashPart = (cost: number, paid: number): string =>
  paid >= cost ? `Cash -${usd(cost)}.` : paid > 0 ? `Cash -${usd(paid)} (all there was).` : "No cash changes hands (there is none; the contractor accepts exposure).";
const addBoard = (s: GameState, d: number): GameState => ({
  ...s,
  board: { ...s.board, members: s.board.members.map((m) => (m.role === "founder" ? m : { ...m, confidence: clamp(m.confidence + d, 0, 100) })) },
});
const addCruft = (s: GameState, d: number): GameState =>
  s.product ? { ...s, product: { ...s.product, cruft: Math.round(clamp(s.product.cruft + d, 0, 100) * 10) / 10 } } : s;
const patchBuild = (s: GameState, id: string, f: (b: Build) => Build): GameState =>
  s.product ? { ...s, product: { ...s.product, active: s.product.active.map((b) => (b.id === id ? f(b) : b)) } } : s;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const done = (b: Build): number => (b.scope > 0 ? b.progress / b.scope : 0);
/** The oldest build that is properly under way (20-80% built). */
const midFlight = (s: GameState): Build | null => s.product?.active.find((b) => done(b) >= 0.2 && done(b) <= 0.8) ?? null;
/** The oldest big build that is not finished. */
const bigBet = (s: GameState): Build | null => s.product?.active.find((b) => (b.size === "l" || b.size === "xl") && done(b) < 0.9) ?? null;
const freshFlop = (s: GameState): boolean => {
  const last = s.product?.shipped[0];
  return Boolean(last && last.tier === "flop" && s.week - last.week <= 1);
};

export const tycoonEvents: EventDef[] = [
  {
    id: "scope-creep",
    title: "While You're In There",
    prompt: (s) => {
      const b = midFlight(s);
      return `Sales has promised a customer that ${b?.name ?? "the build"} will also do one more thing. The thing is not small. [[beat]] Someone says "while you're in there" out loud.`;
    },
    when: (s) => midFlight(s) !== null,
    weight: (s) => 7 + Math.min(3, (s.team.sales + s.team.product) / 4),
    choices: [
      {
        id: "take-it",
        text: "Take it on. Bigger build, bigger launch.",
        apply: (s) => {
          const b = midFlight(s);
          if (!b) return { state: s, logs: ["The request evaporates. Nobody can remember who asked."] };
          const extra = round1(0.2 * b.baseScope);
          return {
            state: addCohesion(patchBuild(s, b.id, (x) => ({ ...x, scope: round1(x.scope + extra), units: round1(x.units * 1.15) })), -1),
            logs: ["The roadmap grows a new box. The date does not move. Yet.", `${b.name}: scope +${extra} pts, impact +15%. Cohesion -1.`],
          };
        },
      },
      {
        id: "refuse",
        text: "No. The scope is the scope.",
        apply: (s) => ({
          state: addMorale(addRep(s, -1), 2),
          logs: ["You say the word 'no' out loud. The team looks at you like you invented fire.", "Reputation -1. Morale +2."],
        }),
      },
      {
        id: "v2",
        text: "Put it in 'v2'. There is no v2.",
        apply: (s) => ({
          state: addEgo(addCruft(s, 2), 2),
          logs: ["A TODO is born. It will outlive the company.", "Cruft +2. Cofounder ego +2."],
        }),
      },
    ],
  },
  {
    id: "the-date",
    title: "The Board Wants a Date",
    prompt: (s) => {
      const b = bigBet(s);
      return `A director asks when ${b?.name ?? "it"} ships. 'Soon' is not accepted. [[beat]] They have a pen out.`;
    },
    when: (s) => s.board.members.length >= 3 && bigBet(s) !== null,
    weight: () => 6,
    choices: [
      {
        id: "commit",
        text: "Commit to a date two weeks sooner.",
        apply: (s) => {
          const b = bigBet(s);
          if (!b) return { state: s, logs: ["The director has moved on to asking about the burn."] };
          return {
            state: addBoard(patchBuild(s, b.id, (x) => ({ ...x, dueWeek: Math.max(s.week, x.dueWeek - 2) })), 4),
            logs: ["You have made a promise to people with pens.", `${b.name}: due week ${Math.max(s.week, b.dueWeek - 2)}. Board confidence +4.`],
          };
        },
      },
      {
        id: "pad",
        text: "Give the date you already have, with a straight face.",
        apply: (s) => ({ state: addBoard(s, -1), logs: ["They write it down. One of them underlines it.", "Board confidence -1."] }),
      },
      {
        id: "no-dates",
        text: "'We ship when it's ready.'",
        apply: (s) => ({
          state: addCohesion(addMorale(addBoard(s, -4), 3), 1),
          logs: ["The team prints the quote. The board does not.", "Board confidence -4. Morale +3. Cohesion +1."],
        }),
      },
    ],
  },
  {
    id: "post-mortem",
    title: "The Post-Mortem",
    prompt: (s) => `${s.product?.shipped[0]?.name ?? "The release"} is being discussed in a meeting titled "Learnings". [[beat]] Everyone is waiting to see what kind of company this is.`,
    when: (s) => freshFlop(s),
    weight: () => 10,
    choices: [
      {
        id: "blameless",
        text: "Blameless post-mortem. Fix the system.",
        apply: (s) => ({
          state: addRep(addCruft(addCohesion(s, 3), -3), -1),
          logs: ["The doc has a timeline, five whys, and no names. [[beat]] It is almost enjoyable.", "Cohesion +3. Cruft -3. Reputation -1."],
        }),
      },
      {
        id: "blame",
        text: "Find someone to blame.",
        apply: (s) => ({
          state: addBoard(addCohesion(addMorale(s, -4), -3), 2),
          logs: ["A name is said in a meeting. Everyone updates their private notes on you.", "Morale -4. Cohesion -3. Board confidence +2."],
        }),
      },
      {
        id: "beta",
        text: "Announce it was a beta all along.",
        apply: (s) => ({
          state: addVcRep(addRep(s, -2), 1),
          logs: ["You add the word BETA to the logo retroactively. [[beat]] Investors call it 'iterating in public'.", "Reputation -2. VC rep +1."],
        }),
      },
    ],
  },
  {
    id: "the-rewrite",
    title: "The Rewrite",
    prompt: () => "Engineering has written a 14-page doc titled 'Why We Should Rewrite Everything'. Page 1 is a meme. [[beat]] Pages 2 through 14 are, unfortunately, correct.",
    when: (s) => (s.product?.cruft ?? 0) >= 30 && s.team.engineering >= 2,
    weight: (s) => 4 + (s.product?.cruft ?? 0) / 10,
    choices: [
      {
        id: "approve",
        text: "Approve a real cleanup. Feature work can wait a beat.",
        apply: (s) => {
          const bill = pay(s, 6000);
          return {
            state: addMorale(addCruft(bill.state, -12), 3),
            logs: ["A week of archaeology. Someone finds a comment that just says 'sorry'.", `${cashPart(6000, bill.paid)} Cruft -12. Morale +3.`],
          };
        },
      },
      {
        id: "one-service",
        text: "Rewrite one service. As a treat.",
        apply: (s) => {
          const bill = pay(s, 2000);
          return { state: addCruft(bill.state, -5), logs: ["One box on the architecture diagram turns green.", `${cashPart(2000, bill.paid)} Cruft -5.`] };
        },
      },
      {
        id: "no",
        text: "No rewrites. We ship.",
        apply: (s) => ({
          state: addMorale(addCruft(s, 2), -3),
          logs: ["The doc is archived in a folder called 'Someday'.", "Cruft +2. Morale -3."],
        }),
      },
    ],
  },
];
