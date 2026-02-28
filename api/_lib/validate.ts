const VALID_ENDINGS = [
  "ipo",
  "acquisition",
  "bankruptcy",
  "founder-removal",
  "zombie-saas",
  "ai-hype-exit",
] as const;

type EndingType = (typeof VALID_ENDINGS)[number];

const ENDING_SCORES: Record<EndingType, number> = {
  ipo: 20,
  "ai-hype-exit": 12,
  acquisition: 8,
  "zombie-saas": 4,
  "founder-removal": 2,
  bankruptcy: 0,
};

/** Re-compute the numeric score server-side from submitted stats. */
export function recomputeScore(data: {
  finalValuation: number;
  founderOwnership: number;
  finalUsers: number;
  finalMrr: number;
  ending: string;
}): number {
  let score = 0;

  if (data.finalValuation >= 1_000_000_000) score += 30;
  else if (data.finalValuation >= 100_000_000) score += 22;
  else if (data.finalValuation >= 10_000_000) score += 15;
  else if (data.finalValuation >= 1_000_000) score += 8;

  score += Math.round(data.founderOwnership * 20);

  if (data.finalUsers >= 100_000) score += 15;
  else if (data.finalUsers >= 10_000) score += 10;
  else if (data.finalUsers >= 1_000) score += 6;
  else if (data.finalUsers >= 200) score += 3;

  if (data.finalMrr >= 250_000) score += 15;
  else if (data.finalMrr >= 50_000) score += 10;
  else if (data.finalMrr >= 10_000) score += 6;
  else if (data.finalMrr >= 2_000) score += 3;

  const ending = data.ending as EndingType;
  score += ENDING_SCORES[ending] ?? 0;

  return Math.max(0, Math.min(100, score));
}

export interface LeaderboardSubmission {
  companyName: string;
  founderName: string;
  ending: string;
  score: number;
  finalValuation: number;
  founderOwnership: number;
  finalUsers: number;
  finalMrr: number;
  week: number;
  seed: number;
}

export interface GraveyardSubmission {
  companyName: string;
  ending: string;
  epitaph: string;
  grade: string;
  week: number;
}

export function validateLeaderboard(body: unknown): LeaderboardSubmission | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const companyName = typeof b.companyName === "string" ? b.companyName.trim().slice(0, 40) : "";
  const founderName = typeof b.founderName === "string" ? b.founderName.trim().slice(0, 32) : "";
  const ending = typeof b.ending === "string" ? b.ending : "";
  const score = typeof b.score === "number" ? b.score : -1;
  const finalValuation = typeof b.finalValuation === "number" ? b.finalValuation : -1;
  const founderOwnership = typeof b.founderOwnership === "number" ? b.founderOwnership : -1;
  const finalUsers = typeof b.finalUsers === "number" ? b.finalUsers : -1;
  const finalMrr = typeof b.finalMrr === "number" ? b.finalMrr : -1;
  const week = typeof b.week === "number" ? b.week : -1;
  const seed = typeof b.seed === "number" ? b.seed : -1;

  if (!companyName || !founderName) return null;
  if (!(VALID_ENDINGS as readonly string[]).includes(ending)) return null;
  if (score < 0 || score > 100) return null;
  if (finalValuation < 0 || founderOwnership < 0 || founderOwnership > 1) return null;
  if (finalUsers < 0 || finalMrr < 0) return null;
  if (week < 1 || week > 200) return null;
  if (seed < 0) return null;

  // Re-compute score to prevent fabricated high scores
  const expected = recomputeScore({ finalValuation, founderOwnership, finalUsers, finalMrr, ending });
  if (Math.abs(expected - score) > 1) return null; // allow ±1 for rounding

  return { companyName, founderName, ending, score, finalValuation, founderOwnership, finalUsers, finalMrr, week, seed };
}

export function validateGraveyard(body: unknown): GraveyardSubmission | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const companyName = typeof b.companyName === "string" ? b.companyName.trim().slice(0, 40) : "";
  const ending = typeof b.ending === "string" ? b.ending : "";
  const epitaph = typeof b.epitaph === "string" ? b.epitaph.trim().slice(0, 160) : "";
  const grade = typeof b.grade === "string" ? b.grade.trim().slice(0, 2) : "";
  const week = typeof b.week === "number" ? b.week : -1;

  if (!companyName || !epitaph || !grade) return null;
  if (!(VALID_ENDINGS as readonly string[]).includes(ending)) return null;
  if (week < 1 || week > 200) return null;

  return { companyName, ending, epitaph, grade, week };
}
