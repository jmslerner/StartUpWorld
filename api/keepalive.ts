import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "./_lib/redis.js";

// Free Redis plans archive a database that sits unused (Upstash: after 30 days without activity), which takes the
// leaderboard and the graveyard offline until someone restores it by hand. vercel.json schedules one GET a day to this
// function, and each scheduled run writes a timestamp, so the database always has recent activity.
//
// Anyone else who opens the URL only reads that timestamp back. That makes the schedule checkable from a browser:
// `lastScheduledPing` is the last time Vercel's scheduler got through, or null if it never has.

/** Holds the ISO time of the last scheduled run. One small, fixed-size value; nothing a caller sends is stored. */
const LAST_PING_KEY = "keepalive:last-scheduled-ping";

/** Vercel's scheduler identifies itself as `vercel-cron/1.0` (Cron Jobs and Schedules both). */
const SCHEDULER_USER_AGENT_PREFIX = "vercel-cron/";

const UNAVAILABLE = { ok: false, error: "Database unavailable" } as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The request has to reach Redis every time, so nothing may answer from a cache.
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const redis = await getRedis();
  if (!redis) {
    // A non-2xx answer is what makes a broken keep-alive show up as a failed run in Vercel's cron logs.
    console.error("keepalive: Redis is not configured or cannot be reached");
    return res.status(503).json(UNAVAILABLE);
  }

  const userAgent = req.headers["user-agent"];
  const scheduled = typeof userAgent === "string" && userAgent.startsWith(SCHEDULER_USER_AGENT_PREFIX);

  try {
    if (scheduled) {
      const now = new Date().toISOString();
      await redis.set(LAST_PING_KEY, now);
      return res.json({ ok: true, scheduled: true, lastScheduledPing: now });
    }

    const last = await redis.get(LAST_PING_KEY);
    return res.json({ ok: true, scheduled: false, lastScheduledPing: last === null ? null : String(last) });
  } catch (err) {
    console.error(`keepalive: Redis command failed: ${describeError(err)}`);
    return res.status(503).json(UNAVAILABLE);
  }
}

/** An error's text with anything shaped like a connection string removed, so a password can never reach the logs. */
function describeError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/rediss?:\/\/\S+/gi, "[redis url]");
}
