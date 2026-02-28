import type { EndingType, GameState } from "../types/game";
import { computeTeamSize } from "./context";

export interface EndingSummary {
  ending: EndingType;
  headline: string;
  narrative: string;
  stats: EndingStats;
  grade: string;
  score: number;
  achievements: string[];
}

export interface EndingStats {
  week: number;
  peakValuation: number;
  finalCash: number;
  finalUsers: number;
  finalMrr: number;
  finalValuation: number;
  founderOwnership: number;
  teamSize: number;
  totalRaised: number;
}

const narratives: Record<EndingType, (s: GameState) => string> = {
  ipo: (s) =>
    `The bell rings. Years of sleepless weeks, impossible deadlines, and one too many pivot decks have led to this. ${s.companyName} is public. [[beat]] The market will decide the rest. You did the thing most founders only talk about at dinner parties.`,
  acquisition: (s) =>
    `Someone bigger wrote the check. ${s.companyName} becomes a line item on a quarterly earnings call. The team disperses into open-plan offices with better snacks and worse purpose. [[beat]] You tell yourself it was strategic.`,
  bankruptcy: (s) =>
    `The account hits zero. Vendors stop answering. The Slack goes quiet, then the lights follow. ${s.companyName} becomes a cautionary tale told at demo days — by people who never shipped anything themselves.`,
  "founder-removal": (s) =>
    `The board calls it a 'leadership transition.' The team calls it a coup. You call it... actually, you don't call it anything. You're too tired to fight. [[beat]] ${s.cofounder.name} sends a text: 'No hard feelings.' There are hard feelings.`,
  "zombie-saas": (s) =>
    `The product keeps running. The story stops moving. ${s.companyName} becomes that SaaS nobody talks about at conferences but somebody's bookkeeper uses every Tuesday. [[beat]] You built a job, not a company. The hoodie still fits, though.`,
  "ai-hype-exit": () =>
    "You sold the narrative before the product caught up. An acquirer — drunk on AI FOMO — writes a check that buys you a very nice house and a very quiet LinkedIn. [[beat]] The technology? It works on demos. It always worked on demos.",
};

export const computeScore = (s: GameState): number => {
  let score = 0;

  // Valuation contribution (0-30)
  if (s.valuation >= 1_000_000_000) score += 30;
  else if (s.valuation >= 100_000_000) score += 22;
  else if (s.valuation >= 10_000_000) score += 15;
  else if (s.valuation >= 1_000_000) score += 8;

  // Ownership contribution (0-20)
  score += Math.round(s.capTable.founderPct * 20);

  // Users contribution (0-15)
  if (s.users >= 100_000) score += 15;
  else if (s.users >= 10_000) score += 10;
  else if (s.users >= 1_000) score += 6;
  else if (s.users >= 200) score += 3;

  // MRR contribution (0-15)
  if (s.mrr >= 250_000) score += 15;
  else if (s.mrr >= 50_000) score += 10;
  else if (s.mrr >= 10_000) score += 6;
  else if (s.mrr >= 2_000) score += 3;

  // Ending bonus/penalty (0-20)
  const endingScores: Record<EndingType, number> = {
    ipo: 20,
    "ai-hype-exit": 12,
    acquisition: 8,
    "zombie-saas": 4,
    "founder-removal": 2,
    bankruptcy: 0,
  };
  score += endingScores[s.gameOver?.ending ?? "bankruptcy"];

  return Math.max(0, Math.min(100, score));
};

export const gradeFromScore = (score: number): string => {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
};

const computeGrade = (s: GameState): string => gradeFromScore(computeScore(s));

const computeAchievements = (s: GameState): string[] => {
  const achievements: string[] = [];

  if (s.totalRaised === 0) achievements.push("Bootstrapped");
  if (s.totalRaised >= 10_000_000) achievements.push("Mega-Funded");
  if (s.debtOutstanding === 0 && s.debtService === 0) achievements.push("Debt-Free");
  if (s.capTable.founderPct >= 0.8) achievements.push("Majority Owner");
  if (s.capTable.founderPct <= 0.2) achievements.push("Diluted to Dust");
  if (s.week <= 20 && s.gameOver?.ending === "ipo") achievements.push("Speed Run");
  if (s.week >= 50) achievements.push("Marathon Runner");
  if (s.users >= 100_000) achievements.push("100K Users");
  if (s.mrr >= 100_000) achievements.push("$100K MRR");
  if (s.peakValuation >= 1_000_000_000) achievements.push("Unicorn");
  if (s.stress >= 90) achievements.push("Burned Out");
  if (s.culture.morale >= 80 && s.culture.cohesion >= 80) achievements.push("Great Culture");
  if (s.cofounder.trust <= 20) achievements.push("Trust Issues");
  if (s.cofounder.trust >= 80) achievements.push("Ride or Die");
  if (computeTeamSize(s) >= 20) achievements.push("Big Team");
  if (computeTeamSize(s) === 1) achievements.push("Solo Act");

  return achievements;
};

export const generateEndingSummary = (state: GameState): EndingSummary | null => {
  if (!state.gameOver) return null;

  const ending = state.gameOver.ending;

  return {
    ending,
    headline: state.gameOver.headline,
    narrative: narratives[ending](state),
    stats: {
      week: state.week,
      peakValuation: state.peakValuation,
      finalCash: state.cash,
      finalUsers: state.users,
      finalMrr: state.mrr,
      finalValuation: state.valuation,
      founderOwnership: Math.round(state.capTable.founderPct * 100),
      teamSize: computeTeamSize(state),
      totalRaised: state.totalRaised,
    },
    grade: computeGrade(state),
    score: computeScore(state),
    achievements: computeAchievements(state),
  };
};
