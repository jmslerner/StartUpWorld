import type { LeaderboardEntry, GraveyardEntry } from "../types/social";

const API_BASE = "/api";
const TIMEOUT_MS = 8000;

/** Entries plus a reason when the fetch failed, so the UI can tell "empty" from "broken". */
export interface ListResult<T> {
  entries: T[];
  error: string | null;
}

const UNAVAILABLE = "Leaderboard server is offline. Scores aren't being recorded right now.";
const UNREACHABLE = "Couldn't reach the leaderboard. Check your connection and try again.";

async function getJson(path: string): Promise<{ data: unknown; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
    if (res.status === 503) return { data: null, error: UNAVAILABLE };
    if (!res.ok) return { data: null, error: UNREACHABLE };
    return { data: await res.json(), error: null };
  } catch {
    return { data: null, error: UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLeaderboard(): Promise<ListResult<LeaderboardEntry>> {
  const { data, error } = await getJson("/leaderboard");
  if (error) return { entries: [], error };
  return { entries: (data as { entries?: LeaderboardEntry[] })?.entries ?? [], error: null };
}

export async function fetchGraveyard(): Promise<ListResult<GraveyardEntry>> {
  const { data, error } = await getJson("/graveyard");
  if (error) return { entries: [], error };
  return { entries: (data as { entries?: GraveyardEntry[] })?.entries ?? [], error: null };
}

export interface SubmitResult {
  rank: number | null;
  error: string | null;
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
}): Promise<SubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/leaderboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
      signal: controller.signal,
    });
    if (res.status === 409) {
      return { rank: null, error: "This run was already submitted." };
    }
    if (res.status === 503) return { rank: null, error: UNAVAILABLE };
    if (!res.ok) return { rank: null, error: UNREACHABLE };
    const data = await res.json();
    return { rank: data.rank ?? null, error: null };
  } catch {
    return { rank: null, error: UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}

export async function submitGraveyardEntry(submission: {
  companyName: string;
  ending: string;
  epitaph: string;
  grade: string;
  week: number;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${API_BASE}/graveyard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
      signal: controller.signal,
    });
  } catch {
    // Fire-and-forget — game works without backend
  } finally {
    clearTimeout(timer);
  }
}
