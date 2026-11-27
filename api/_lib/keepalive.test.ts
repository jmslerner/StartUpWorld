// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../keepalive.js";
import { getRedis } from "./redis.js";

// Only getRedis is replaced. The handler also imports withReplyDeadline, and that has to stay the real one: if it were
// missing here, the handler's own try/catch would turn the missing function into a 503 and hide the mistake.
vi.mock("./redis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis.js")>()),
  getRedis: vi.fn(),
}));

type RedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/** Pinned on purpose: once this is deployed the production database holds the key, so renaming it is a deliberate act. */
const LAST_PING_KEY = "keepalive:last-scheduled-ping";

/** An in-memory stand-in for the two commands the handler uses, and for closing the connection. */
const fakeRedis = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    destroy: vi.fn(),
  };
};

/** A command that was sent and is never answered. */
const unanswered = () => new Promise<never>(() => {});

/** What the promise settled with, or "still pending". */
const peek = <T>(promise: Promise<T>): Promise<T | "still pending"> =>
  Promise.race([promise, Promise.resolve("still pending" as const)]);

const useRedis = (redis: ReturnType<typeof fakeRedis> | null): void => {
  vi.mocked(getRedis).mockResolvedValue(redis as unknown as RedisClient | null);
};

/** What getRedis() answers, one call after the other: a dropped connection is followed by a new client, or by none. */
const useRedisInTurn = (...clients: (ReturnType<typeof fakeRedis> | null)[]): void => {
  for (const redis of clients) vi.mocked(getRedis).mockResolvedValueOnce(redis as unknown as RedisClient | null);
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const call = async (init: { method?: string; userAgent?: string; headers?: Record<string, string> } = {}): Promise<Reply> => {
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
    headers: { ...init.headers, ...(init.userAgent === undefined ? {} : { "user-agent": init.userAgent }) },
  };
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
  return reply;
};

const SCHEDULER = "vercel-cron/1.0";
const NOW = new Date("2026-11-24T07:12:03.000Z");
const hoursAgo = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
/** Everything the handler wrote to the log, warnings included. */
const logged = (): string => [...errors.mock.calls, ...warnings.mock.calls].flat().join(" ");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRedis).mockReset();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  errors.mockRestore();
  warnings.mockRestore();
});

describe("keepalive: a scheduled run", () => {
  it("writes the current time, so the database sees a real request every day", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, scheduled: true, lastScheduledPing: NOW.toISOString() });
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(LAST_PING_KEY, NOW.toISOString());
    expect(redis.data.get(LAST_PING_KEY)).toBe(NOW.toISOString());
  });

  it("also writes when the scheduler sends POST, the default if the job is moved to Vercel's Schedules", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    const reply = await call({ method: "POST", userAgent: SCHEDULER });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ ok: true, scheduled: true });
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("is recognised by the schedule header alone, so a changed user agent does not stop the writes", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    const reply = await call({ userAgent: "something-new/3.0", headers: { "x-vercel-cron-schedule": "0 7 * * *" } });
    expect(reply.body).toMatchObject({ scheduled: true });
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("is recognised by a later scheduler version", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    expect((await call({ userAgent: "vercel-cron/2.0" })).body).toMatchObject({ scheduled: true });
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it("is safe to repeat: a second delivery of the same run just writes the time again", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    await call({ userAgent: SCHEDULER });
    expect((await call({ userAgent: SCHEDULER })).status).toBe(200);
    expect(redis.data.size).toBe(1);
  });
});

describe("keepalive: anyone else", () => {
  it("only reads the last scheduled time and never overwrites it", async () => {
    const earlier = hoursAgo(23.5);
    const redis = fakeRedis({ [LAST_PING_KEY]: earlier });
    useRedis(redis);
    for (const userAgent of ["Mozilla/5.0", "curl/8.5.0", "not-vercel-cron/1.0", undefined]) {
      const reply = await call({ userAgent });
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ ok: true, scheduled: false, lastScheduledPing: earlier, hoursSinceLastPing: 23.5 });
    }
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledTimes(4);
    expect(redis.data.get(LAST_PING_KEY)).toBe(earlier);
  });

  it("answers a monitor's HEAD the same way, with one read", async () => {
    const redis = fakeRedis({ [LAST_PING_KEY]: hoursAgo(2) });
    useRedis(redis);
    expect((await call({ method: "HEAD", userAgent: "UptimeMonitor/1.0" })).status).toBe(200);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("tolerates one missed run: 50 hours since the last one is still healthy", async () => {
    useRedis(fakeRedis({ [LAST_PING_KEY]: hoursAgo(50) }));
    const reply = await call();
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ ok: true, hoursSinceLastPing: 50 });
  });

  it("answers 503 once two runs in a row were missed, so a stopped schedule cannot look healthy", async () => {
    const stale = hoursAgo(50.1);
    const redis = fakeRedis({ [LAST_PING_KEY]: stale });
    useRedis(redis);
    const reply = await call();
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      ok: false,
      scheduled: false,
      error: "No scheduled run for 50.1 hours",
      lastScheduledPing: stale,
      hoursSinceLastPing: 50.1,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("answers 503 until the schedule has run once", async () => {
    useRedis(fakeRedis());
    const reply = await call();
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      ok: false,
      scheduled: false,
      error: "No scheduled run is recorded",
      lastScheduledPing: null,
      hoursSinceLastPing: null,
    });
  });

  it("treats a stored value that is not a time as no run at all", async () => {
    useRedis(fakeRedis({ [LAST_PING_KEY]: "yesterday-ish" }));
    const reply = await call();
    expect(reply.status).toBe(503);
    expect(reply.body).toMatchObject({ ok: false, lastScheduledPing: "yesterday-ish", hoursSinceLastPing: null });
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

  it("answers 503 when connecting throws, and keeps the connection string the error carries out of the logs", async () => {
    // What Node throws for a URL it cannot parse: the whole string, password included, rides along in `input`.
    const invalidUrl = Object.assign(new TypeError("Invalid URL"), {
      code: "ERR_INVALID_URL",
      input: "rediss://default:s3cret@db.example.com:6379",
    });
    vi.mocked(getRedis).mockRejectedValue(invalidUrl);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ ok: false, error: "Database unavailable" });
    expect(logged()).toContain("Invalid URL (ERR_INVALID_URL)");
    expect(logged()).not.toContain("s3cret");
    expect(logged()).not.toContain("db.example.com");
  });

  it("answers 503 when the command fails, and removes every connection string from the log line", async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(
      new Error("primary rediss://default:s3cret@db.example.com:6379 failed, replica REDIS://default:0ther@db2.example.com:6380 too"),
    );
    useRedis(redis);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ ok: false, error: "Database unavailable" });
    expect(logged()).toContain("Redis command failed: primary [redis url] failed, replica [redis url] too");
    // The write was tried twice, and the line about the first failure is scrubbed too.
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(logged()).toContain("scheduled write failed, trying once more: primary [redis url] failed, replica [redis url] too");
    for (const secret of ["s3cret", "0ther", "db.example.com", "db2.example.com"]) expect(logged()).not.toContain(secret);
  });

  it("says why when the error has no message of its own (a connection refused on every address)", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(
      new AggregateError(
        [
          Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:6379"), { code: "ECONNREFUSED" }),
          Object.assign(new Error(""), { code: "ETIMEDOUT" }),
        ],
        "",
      ),
    );
    useRedis(redis);
    expect((await call()).status).toBe(503);
    expect(logged()).toContain("AggregateError; connect ECONNREFUSED 10.0.0.1:6379; Error (ETIMEDOUT)");
  });

  it("answers 503 when the read fails with something that is not an Error", async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue("READONLY");
    useRedis(redis);
    expect((await call()).status).toBe(503);
    expect(logged()).toContain("READONLY");
  });
});

describe("keepalive: a database that stops answering", () => {
  it("writes the scheduled time on a new connection when the first one gives no reply for 3 seconds", async () => {
    const silent = fakeRedis();
    silent.set.mockImplementation(unanswered);
    const fresh = fakeRedis();
    useRedisInTurn(silent, fresh);
    const pending = call({ userAgent: SCHEDULER });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toMatchObject({
      status: 200,
      body: { ok: true, scheduled: true, lastScheduledPing: NOW.toISOString() },
    });
    expect(silent.destroy).toHaveBeenCalledTimes(1);
    expect(fresh.data.get(LAST_PING_KEY)).toBe(NOW.toISOString());
    expect(logged()).toContain("keepalive: scheduled write failed, trying once more: Redis did not reply within 3000 ms");
    expect(errors).not.toHaveBeenCalled();
  });

  it("writes the scheduled time at the second try when the first failed because the connection had closed", async () => {
    // What a warm instance meets when the database closed its idle connection: the command is refused at once, and
    // the client is already reconnecting, so getRedis() hands out the same one.
    const redis = fakeRedis();
    redis.set.mockRejectedValueOnce(new Error("Socket closed unexpectedly"));
    useRedis(redis);
    const reply = await call({ userAgent: SCHEDULER });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, scheduled: true, lastScheduledPing: NOW.toISOString() });
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.data.get(LAST_PING_KEY)).toBe(NOW.toISOString());
    expect(redis.destroy).not.toHaveBeenCalled();
    expect(logged()).toContain("keepalive: scheduled write failed, trying once more: Socket closed unexpectedly");
    expect(errors).not.toHaveBeenCalled();
  });

  it("answers 503 after 6 seconds when the second try gets no reply either, and does not try a third time", async () => {
    const first = fakeRedis();
    first.set.mockImplementation(unanswered);
    const second = fakeRedis();
    second.set.mockImplementation(unanswered);
    useRedisInTurn(first, second, fakeRedis());
    const pending = call({ userAgent: SCHEDULER });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toBe("still pending");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toMatchObject({ status: 503, body: { ok: false, error: "Database unavailable" } });
    expect(logged()).toContain("keepalive: Redis command failed: Redis did not reply within 3000 ms");
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(getRedis).toHaveBeenCalledTimes(2);
  });

  it("answers 503 when no new connection can be made for the second try", async () => {
    const silent = fakeRedis();
    silent.set.mockImplementation(unanswered);
    useRedisInTurn(silent, null);
    const pending = call({ userAgent: SCHEDULER });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toMatchObject({ status: 503, body: { ok: false, error: "Database unavailable" } });
    expect(logged()).toContain("keepalive: Redis command failed: no connection for the second try");
  });

  it("answers 503 after 3 seconds when the read gets no reply, closes that connection and does not try again", async () => {
    const redis = fakeRedis({ [LAST_PING_KEY]: hoursAgo(1) });
    redis.get.mockImplementation(unanswered);
    useRedis(redis);
    const pending = call({ userAgent: "UptimeMonitor/1.0" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toMatchObject({ status: 503, body: { ok: false, error: "Database unavailable" } });
    expect(logged()).toContain("keepalive: Redis command failed: Redis did not reply within 3000 ms");
    expect(redis.destroy).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(getRedis).toHaveBeenCalledTimes(1);
  });

  it("still takes a reply that needs most of the 3 seconds, and keeps the connection", async () => {
    const redis = fakeRedis({ [LAST_PING_KEY]: hoursAgo(1) });
    redis.get.mockImplementation(
      (key) => new Promise((resolve) => setTimeout(() => resolve(redis.data.get(key) ?? null), 2900)),
    );
    useRedis(redis);
    const pending = call();
    await vi.advanceTimersByTimeAsync(2900);
    expect(await peek(pending)).toMatchObject({ status: 200, body: { ok: true, scheduled: false } });
    expect(redis.destroy).not.toHaveBeenCalled();
  });
});

describe("keepalive: the request itself", () => {
  it("refuses other methods without touching Redis", async () => {
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const reply = await call({ method, userAgent: SCHEDULER });
      expect(reply.status).toBe(405);
      expect(reply.body).toEqual({ error: "Method not allowed" });
    }
    expect(getRedis).not.toHaveBeenCalled();
  });

  it("is never cacheable, whatever the outcome", async () => {
    useRedis(fakeRedis({ [LAST_PING_KEY]: hoursAgo(1) }));
    expect((await call({ userAgent: SCHEDULER })).headers["cache-control"]).toBe("no-store");
    expect((await call()).headers["cache-control"]).toBe("no-store");
    expect((await call({ method: "PUT" })).headers["cache-control"]).toBe("no-store");
    useRedis(null);
    expect((await call()).headers["cache-control"]).toBe("no-store");
  });
});

describe("keepalive: the schedule in vercel.json", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const config = JSON.parse(readFileSync(`${root}vercel.json`, "utf8")) as { crons?: { path: string; schedule: string }[] };
  const job = config.crons?.find((c) => c.path === "/api/keepalive");

  it("points at this function (a path with no function behind it is answered by the page rewrite with a 200)", () => {
    expect(job).toBeDefined();
    expect(existsSync(`${root}api/keepalive.ts`)).toBe(true);
  });

  it("runs exactly once a day: the Hobby plan allows no more, and Upstash's week allows little less", () => {
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
