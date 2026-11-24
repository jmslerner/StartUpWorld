// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that start
// with an underscore.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../keepalive.js";
import { getRedis } from "./redis.js";

vi.mock("./redis.js", () => ({ getRedis: vi.fn() }));

type RedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/** Pinned on purpose: the production database already holds this key, so renaming it is a deliberate act. */
const LAST_PING_KEY = "keepalive:last-scheduled-ping";

/** An in-memory stand-in for the two commands the handler uses. */
const fakeRedis = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => data.get(key) ?? null),
  };
};

const useRedis = (redis: ReturnType<typeof fakeRedis> | null): void => {
  vi.mocked(getRedis).mockResolvedValue(redis as unknown as RedisClient | null);
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const call = async (init: { method?: string; userAgent?: string } = {}): Promise<Reply> => {
  const reply: Reply = { status: 200, headers: {}, body: undefined };
  const res = {
    setHeader(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      reply.status = code;
      return res;
    },
    json(body: unknown) {
      reply.body = body;
      return res;
    },
  };
  const req = {
    method: init.method ?? "GET",
    headers: init.userAgent === undefined ? {} : { "user-agent": init.userAgent },
  };
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
  return reply;
};

const SCHEDULER = "vercel-cron/1.0";
const NOW = new Date("2026-11-24T07:12:03.000Z");

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRedis).mockReset();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
});

describe("keepalive: a scheduled run", () => {
  it("writes the current time, so the database sees a real command every day", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, scheduled: true, lastScheduledPing: NOW.toISOString() });
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(LAST_PING_KEY, NOW.toISOString());
    expect(redis.data.get(LAST_PING_KEY)).toBe(NOW.toISOString());
  });

  it("is safe to repeat: a second delivery of the same run just writes the time again", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    await call({ userAgent: SCHEDULER });
    const again = await call({ userAgent: SCHEDULER });
    expect(again.status).toBe(200);
    expect(redis.data.size).toBe(1);
  });

  it("recognises a later scheduler version by its prefix", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    const reply = await call({ userAgent: "vercel-cron/2.0" });
    expect(reply.body).toMatchObject({ scheduled: true });
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});

describe("keepalive: anyone else", () => {
  it("only reads the last scheduled time and never overwrites it", async () => {
    const earlier = "2026-11-23T07:40:00.000Z";
    const redis = fakeRedis({ [LAST_PING_KEY]: earlier });
    useRedis(redis);
    for (const userAgent of ["Mozilla/5.0", "curl/8.5.0", "not-vercel-cron/1.0", undefined]) {
      const reply = await call({ userAgent });
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ ok: true, scheduled: false, lastScheduledPing: earlier });
    }
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledTimes(4);
    expect(redis.data.get(LAST_PING_KEY)).toBe(earlier);
  });

  it("reports null until the schedule has run once", async () => {
    useRedis(fakeRedis());
    expect((await call()).body).toEqual({ ok: true, scheduled: false, lastScheduledPing: null });
  });
});

describe("keepalive: failures are loud", () => {
  it("answers 503 when Redis is not configured or not reachable, scheduled or not", async () => {
    useRedis(null);
    for (const userAgent of [SCHEDULER, "Mozilla/5.0"]) {
      const reply = await call({ userAgent });
      expect(reply.status).toBe(503);
      expect(reply.body).toEqual({ ok: false, error: "Database unavailable" });
    }
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("answers 503 when the command fails, and never logs a connection string", async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error("connect failed for redis://default:s3cret@db.example.com:6379 (ECONNRESET)"));
    useRedis(redis);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ ok: false, error: "Database unavailable" });
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain("Redis command failed");
    expect(logged).toContain("[redis url]");
    expect(logged).not.toContain("s3cret");
    expect(logged).not.toContain("db.example.com");
  });

  it("answers 503 when the read fails", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue("READONLY");
    useRedis(redis);
    expect((await call()).status).toBe(503);
  });
});

describe("keepalive: the request itself", () => {
  it("refuses anything but GET without touching Redis", async () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      const reply = await call({ method, userAgent: SCHEDULER });
      expect(reply.status).toBe(405);
      expect(reply.body).toEqual({ error: "Method not allowed" });
    }
    expect(getRedis).not.toHaveBeenCalled();
  });

  it("is never cacheable, whatever the outcome", async () => {
    useRedis(fakeRedis());
    expect((await call({ userAgent: SCHEDULER })).headers["cache-control"]).toBe("no-store");
    expect((await call()).headers["cache-control"]).toBe("no-store");
    expect((await call({ method: "POST" })).headers["cache-control"]).toBe("no-store");
    useRedis(null);
    expect((await call()).headers["cache-control"]).toBe("no-store");
  });
});

describe("keepalive: the schedule in vercel.json", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const config = JSON.parse(readFileSync(`${root}vercel.json`, "utf8")) as { crons?: { path: string; schedule: string }[] };
  const job = config.crons?.find((c) => c.path === "/api/keepalive");

  it("points at this function", () => {
    expect(job).toBeDefined();
    expect(existsSync(`${root}api/keepalive.ts`)).toBe(true);
  });

  it("runs exactly once a day, which is all the Hobby plan allows (anything more often fails the deployment)", () => {
    const fields = job!.schedule.split(" ");
    expect(fields).toHaveLength(5);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
    expect(minute).toMatch(/^\d{1,2}$/);
    expect(Number(minute)).toBeLessThanOrEqual(59);
    expect(hour).toMatch(/^\d{1,2}$/);
    expect(Number(hour)).toBeLessThanOrEqual(23);
    expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "*"]);
  });
});
