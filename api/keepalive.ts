import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis, withReplyDeadline } from "./_lib/redis.js";

// A free Redis database is taken away when nothing uses it: Upstash archives one after 30 days without activity, and
// its terms allow deleting one after a week without requests. That has taken the leaderboard and the graveyard offline
// twice. vercel.json schedules one request a day to this function, and each scheduled run writes a timestamp, so the
// database always has a recent request.
//
// Every other caller only reads that timestamp back, which makes the schedule checkable from a browser or an uptime
// monitor: the answer is 200 while the last scheduled run is recent, and 503 once it is not.

/**
 * Holds the ISO time of the last request that identified itself as the scheduler (a manual run from Vercel's dashboard
 * counts too). One small, fixed-size value; nothing a caller sends is stored.
 */
const LAST_PING_KEY = "keepalive:last-scheduled-ping";

/** Vercel's scheduler sends this user agent (Cron Jobs and Schedules both)... */
const SCHEDULER_USER_AGENT_PREFIX = "vercel-cron/";
/** ...and names the expression that fired in this header. Either one marks a scheduled run. */
const SCHEDULER_HEADER = "x-vercel-cron-schedule";

/** GET is what Cron Jobs send, POST is the default for Schedules, and HEAD is what many uptime monitors send. */
const ALLOWED_METHODS = ["GET", "HEAD", "POST"];

/**
 * Runs are a day apart and may land at any minute of their hour, so a healthy gap is under 25 hours. 50 hours means two
 * runs in a row were missed, and still leaves most of the week Upstash allows.
 */
const STALE_AFTER_HOURS = 50;

const UNAVAILABLE = { ok: false, error: "Database unavailable" } as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The request has to reach Redis every time, so nothing may answer from a cache.
  res.setHeader("Cache-Control", "no-store");

  if (!ALLOWED_METHODS.includes(req.method ?? "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const redis = await getRedis();
    if (!redis) {
      // A non-2xx answer is what makes a broken keep-alive show up as a failed run in Vercel's cron logs.
      console.error("keepalive: Redis is not configured or cannot be reached");
      return res.status(503).json(UNAVAILABLE);
    }

    if (isScheduledRun(req)) {
      const now = new Date().toISOString();
      try {
        await withReplyDeadline(redis, redis.set(LAST_PING_KEY, now));
      } catch (err) {
        // This write is all a scheduled run is for, and the scheduler does not come back until tomorrow, so it gets
        // a second try. A connection that had stopped answering was dropped by the deadline, and getRedis() opens a
        // new one; one that had been closed is reconnecting by now. Readers get no second try: a monitor asks again
        // by itself.
        console.warn(`keepalive: scheduled write failed, trying once more: ${describeError(err)}`);
        const again = await getRedis();
        if (!again) throw new Error("no connection for the second try");
        await withReplyDeadline(again, again.set(LAST_PING_KEY, now));
      }
      return res.json({ ok: true, scheduled: true, lastScheduledPing: now });
    }

    const stored = await withReplyDeadline(redis, redis.get(LAST_PING_KEY));
    const lastScheduledPing = stored === null ? null : String(stored);
    const hoursSinceLastPing = lastScheduledPing === null ? null : hoursSince(lastScheduledPing);

    if (hoursSinceLastPing === null || hoursSinceLastPing > STALE_AFTER_HOURS) {
      const error =
        hoursSinceLastPing === null
          ? "No scheduled run is recorded"
          : `No scheduled run for ${hoursSinceLastPing} hours`;
      return res.status(503).json({ ok: false, scheduled: false, error, lastScheduledPing, hoursSinceLastPing });
    }
    return res.json({ ok: true, scheduled: false, lastScheduledPing, hoursSinceLastPing });
  } catch (err) {
    console.error(`keepalive: Redis command failed: ${describeError(err)}`);
    return res.status(503).json(UNAVAILABLE);
  }
}

/** The request identifies itself as Vercel's scheduler. Both signs can be imitated, so this is not authentication. */
function isScheduledRun(req: VercelRequest): boolean {
  const userAgent = req.headers["user-agent"];
  const byUserAgent = typeof userAgent === "string" && userAgent.startsWith(SCHEDULER_USER_AGENT_PREFIX);
  return byUserAgent || req.headers[SCHEDULER_HEADER] !== undefined;
}

/** Hours since an ISO time, to one decimal place; null when the stored value is not a readable time. */
function hoursSince(iso: string): number | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.round(((Date.now() - then) / 3_600_000) * 10) / 10;
}

/**
 * What went wrong, for the log: the message (or the error's name when the message is empty), its code, and the same for
 * each cause inside an AggregateError. Anything shaped like a connection string is removed, so a password can never
 * reach the logs through this line.
 */
function describeError(err: unknown): string {
  const parts: string[] = [];
  const add = (e: unknown): void => {
    if (!(e instanceof Error)) {
      parts.push(String(e));
      return;
    }
    const code = (e as { code?: unknown }).code;
    const text = e.message || e.name;
    parts.push(typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text);
    if (e instanceof AggregateError) e.errors.forEach(add);
  };
  add(err);
  return parts.join("; ").replace(/rediss?:\/\/\S+/gi, "[redis url]");
}
