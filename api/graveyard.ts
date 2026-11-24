import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describeError } from "./_lib/describeError.js";
import { getRedis, withReplyDeadline } from "./_lib/redis.js";
import { parseStoredEntries } from "./_lib/storedEntries.js";
import { validateGraveyard } from "./_lib/validate.js";

const GRAVEYARD_KEY = "graveyard";
const MAX_STORED = 50;
const RETURN_LIMIT = 30;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const redis = await getRedis();
  if (!redis) {
    return res.status(503).json({ error: "Graveyard unavailable" });
  }

  try {
    if (req.method === "GET") {
      const raw = await withReplyDeadline(redis, redis.lRange(GRAVEYARD_KEY, 0, RETURN_LIMIT - 1));
      const entries = parseStoredEntries(raw);
      return res.json({ entries });
    }

    if (req.method === "POST") {
      const data = validateGraveyard(req.body);
      if (!data) {
        return res.status(400).json({ error: "Invalid submission" });
      }

      const entry = {
        id: `gv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        companyName: data.companyName,
        ending: data.ending,
        epitaph: data.epitaph,
        grade: data.grade,
        week: data.week,
        timestamp: Date.now(),
      };

      await withReplyDeadline(redis, redis.lPush(GRAVEYARD_KEY, JSON.stringify(entry)));
      await withReplyDeadline(redis, redis.lTrim(GRAVEYARD_KEY, 0, MAX_STORED - 1));

      return res.json({ entry });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    // Says why, and only why: never the request body, and nothing else a player sent.
    console.error(`graveyard: request failed: ${describeError(err)}`);
    return res.status(500).json({ error: "Internal server error" });
  }
}
