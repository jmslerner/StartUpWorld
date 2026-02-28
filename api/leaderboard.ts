import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "./_lib/redis.js";
import { validateLeaderboard } from "./_lib/validate.js";

const LEADERBOARD_KEY = "leaderboard";
const SUBMITTED_SEEDS_KEY = "submitted-seeds";
const MAX_ENTRIES = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis();
  if (!redis) {
    return res.status(503).json({ error: "Leaderboard unavailable" });
  }

  try {
    if (req.method === "GET") {
      // ZRANGE with REV returns highest scores first
      const raw = await redis.zRange(LEADERBOARD_KEY, 0, MAX_ENTRIES - 1, { REV: true });
      const entries = raw.map((e) => JSON.parse(String(e)));
      return res.json({ entries });
    }

    if (req.method === "POST") {
      const data = validateLeaderboard(req.body);
      if (!data) {
        return res.status(400).json({ error: "Invalid submission" });
      }

      // Seed dedup: one submission per seed
      const seedKey = `${SUBMITTED_SEEDS_KEY}:${data.seed}`;
      const alreadySubmitted = await redis.get(seedKey);
      if (alreadySubmitted) {
        return res.status(409).json({ error: "Seed already submitted" });
      }

      const id = `${data.seed}-${Date.now()}`;
      const entry = {
        id,
        companyName: data.companyName,
        founderName: data.founderName,
        ending: data.ending,
        grade: gradeFromScore(data.score),
        score: data.score,
        finalValuation: data.finalValuation,
        week: data.week,
        seed: data.seed,
        timestamp: Date.now(),
      };

      const member = JSON.stringify(entry);
      await redis.zAdd(LEADERBOARD_KEY, { score: entry.score, value: member });

      // Trim to top N: remove entries with lowest scores
      const count = Number(await redis.zCard(LEADERBOARD_KEY));
      if (count > MAX_ENTRIES) {
        await redis.zRemRangeByRank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1);
      }

      // Mark seed as submitted (24h TTL)
      await redis.set(seedKey, "1", { EX: 86400 });

      // Get rank (0-indexed from the top)
      const rawRank = await redis.zRevRank(LEADERBOARD_KEY, member);
      const rank = rawRank !== null && rawRank !== undefined ? Number(rawRank) + 1 : null;

      return res.json({ rank, entry });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

function gradeFromScore(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}
