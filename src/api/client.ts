import type { LeaderboardEntry, GraveyardEntry } from "../types/social";

const API_BASE = "/api";

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return [];
  }
}

export async function submitScore(submission: {
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
}): Promise<{ rank: number | null }> {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!res.ok) return { rank: null };
    return await res.json();
  } catch {
    return { rank: null };
  }
}

export async function fetchGraveyard(): Promise<GraveyardEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/graveyard`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return [];
  }
}

export async function submitGraveyardEntry(submission: {
  companyName: string;
  ending: string;
  epitaph: string;
  grade: string;
  week: number;
}): Promise<void> {
  try {
    await fetch(`${API_BASE}/graveyard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
  } catch {
    // Fire-and-forget — game works without backend
  }
}
