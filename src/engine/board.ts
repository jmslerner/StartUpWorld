import type { GameState, BoardMember, BoardPersonality, BoardState } from "../types/game";
import type { EngineContext } from "./context";
import { clamp } from "./utils";
import { nextIntInclusive } from "./rng";

export const PERSONALITY_PROFILES: Record<BoardPersonality, {
  label: string;
  tagline: string;
  mrrWeight: number;
  burnWeight: number;
  cashWeight: number;
  reputationWeight: number;
  stressWeight: number;
  baseDecay: number;
}> = {
  activist: {
    label: "Activist",
    tagline: "Show me the numbers.",
    mrrWeight: 0.6, burnWeight: 0.4, cashWeight: 0.3, reputationWeight: 0.1, stressWeight: -0.2, baseDecay: -1.5,
  },
  cheerleader: {
    label: "Cheerleader",
    tagline: "I believe in the founder.",
    mrrWeight: 0.15, burnWeight: 0.1, cashWeight: 0.1, reputationWeight: 0.4, stressWeight: -0.05, baseDecay: 0.5,
  },
  operator: {
    label: "Operator",
    tagline: "What's the process?",
    mrrWeight: 0.3, burnWeight: 0.3, cashWeight: 0.35, reputationWeight: 0.2, stressWeight: -0.3, baseDecay: -0.5,
  },
  dealmaker: {
    label: "Dealmaker",
    tagline: "When's the exit?",
    mrrWeight: 0.5, burnWeight: 0.15, cashWeight: 0.2, reputationWeight: 0.3, stressWeight: -0.1, baseDecay: -1.0,
  },
  "old-guard": {
    label: "Old Guard",
    tagline: "I've seen this before.",
    mrrWeight: 0.2, burnWeight: 0.5, cashWeight: 0.5, reputationWeight: 0.15, stressWeight: -0.35, baseDecay: -2.0,
  },
};

const boardNames = [
  "Sarah Chen", "Marcus Webb", "Priya Patel", "David Kim", "Rachel Torres",
  "James Liu", "Ana Costa", "Michael Okafor", "Elena Volkov", "Thomas Park",
];

const personalities: BoardPersonality[] = ["activist", "cheerleader", "operator", "dealmaker", "old-guard"];

export const createInitialBoard = (): BoardState => ({
  members: [],
  lastMeetingWeek: 0,
});

export const addBoardMember = (state: GameState, role: BoardMember["role"], personality?: BoardPersonality): GameState => {
  let rng = state.rng;

  let chosen = personality;
  if (!chosen) {
    const pick = nextIntInclusive(rng, 0, personalities.length - 1);
    rng = pick.rng;
    chosen = personalities[pick.value];
  }

  const usedNames = new Set(state.board.members.map(m => m.name));
  const available = boardNames.filter(n => !usedNames.has(n));
  const namePick = nextIntInclusive(rng, 0, Math.max(0, available.length - 1));
  rng = namePick.rng;
  const name = available[namePick.value] ?? `Director ${state.board.members.length + 1}`;

  const confidence = role === "founder" ? 95
    : role === "cofounder" ? clamp(Math.round(state.cofounder.trust * 0.9), 0, 100)
    : 60;

  const member: BoardMember = {
    id: `board-${role}-${state.board.members.length}`,
    name,
    role,
    personality: chosen,
    confidence,
  };

  return {
    ...state,
    rng,
    board: { ...state.board, members: [...state.board.members, member] },
  };
};

export const applyWeeklyBoardDrift = (state: GameState, ctx: EngineContext): GameState => {
  if (state.board.members.length === 0) return state;

  const mrrGrowth = clamp(ctx.mrrGrowthRate, -0.5, 0.5);
  const burnHealth = clamp(ctx.runwayWeeks / 20, 0, 1); // 0 = no runway, 1 = 20+ weeks
  const repNorm = clamp(state.reputation / 100, 0, 1);
  const stressNorm = clamp(state.stress / 100, 0, 1);

  // Cash health: boards love a fat bank account, hate low cash.
  // burnIntensity = burn / cash — low is good (sustainable), high is bad (burning through cash).
  // Invert so 1 = healthy (low burn relative to cash), 0 = cash-starved.
  const cashHealth = clamp(1 - ctx.burnIntensity, 0, 1);

  const members = state.board.members.map(m => {
    if (m.role === "founder") return m;

    if (m.role === "cofounder") {
      return { ...m, confidence: clamp(Math.round(state.cofounder.trust * 0.9), 0, 100) };
    }

    const profile = PERSONALITY_PROFILES[m.personality];
    const delta =
      profile.baseDecay +
      mrrGrowth * profile.mrrWeight * 20 +
      burnHealth * profile.burnWeight * 5 +
      cashHealth * profile.cashWeight * 6 +
      repNorm * profile.reputationWeight * 5 +
      stressNorm * profile.stressWeight * 8;

    return { ...m, confidence: clamp(Math.round(m.confidence + delta), 0, 100) };
  });

  return { ...state, board: { ...state.board, members } };
};

export const boardVote = (state: GameState): { against: number; total: number; members: { name: string; vote: "for" | "against" }[] } => {
  const votes = state.board.members.map(m => ({
    name: m.name,
    vote: (m.confidence < 40 ? "against" : "for") as "for" | "against",
  }));
  const against = votes.filter(v => v.vote === "against").length;
  return { against, total: votes.length, members: votes };
};

export const isBoardHostile = (state: GameState): boolean => {
  if (state.board.members.length < 3) return false;
  const { against, total } = boardVote(state);
  return against > total / 2;
};
