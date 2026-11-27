// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../graveyard.js";
import { getRedis } from "./redis.js";

// Only getRedis is replaced. The handler also imports withReplyDeadline, and that has to stay the real one.
vi.mock("./redis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis.js")>()),
  getRedis: vi.fn(),
}));

type RedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/** What a healthy database answers to each command the handler uses. */
const HEALTHY = { lRange: [] as string[], lPush: 1, lTrim: "OK" };
type Command = keyof typeof HEALTHY;
const COMMANDS = Object.keys(HEALTHY) as Command[];

const fakeRedis = (replies: Partial<typeof HEALTHY> = {}) => {
  const answers = { ...HEALTHY, ...replies };
  const command = (name: Command) => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => answers[name]);
  return {
    ...(Object.fromEntries(COMMANDS.map((name) => [name, command(name)])) as Record<Command, ReturnType<typeof command>>),
    destroy: vi.fn(),
  };
};

const useRedis = (redis: ReturnType<typeof fakeRedis> | null): void => {
  vi.mocked(getRedis).mockResolvedValue(redis as unknown as RedisClient | null);
};

const call = async (method: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
  const reply = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      reply.status = code;
      return res;
    },
    json(payload: unknown) {
      reply.body = payload;
      return res;
    },
  };
  await handler({ method, body } as unknown as VercelRequest, res as unknown as VercelResponse);
  return reply;
};

/** A command that was sent and is never answered. */
const unanswered = () => new Promise<never>(() => {});

/** What the promise settled with, or "still pending". */
const peek = <T>(promise: Promise<T>): Promise<T | "still pending"> =>
  Promise.race([promise, Promise.resolve("still pending" as const)]);

const NOW = new Date("2026-11-24T12:00:00.000Z");

const SUBMISSION = { companyName: "Acme", ending: "bankruptcy", epitaph: "Ran out of runway", grade: "F", week: 12 };

const ENTRY = {
  id: expect.stringMatching(new RegExp(`^gv-${NOW.getTime()}-[a-z0-9]+$`)),
  companyName: "Acme",
  ending: "bankruptcy",
  epitaph: "Ran out of runway",
  grade: "F",
  week: 12,
  timestamp: NOW.getTime(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRedis).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("graveyard: a healthy database", () => {
  it("lists the newest 30 entries", async () => {
    const stored = [
      { id: "gv-2", companyName: "Acme", ending: "bankruptcy", epitaph: "Ran out of runway", grade: "F", week: 12, timestamp: 2 },
      { id: "gv-1", companyName: "Initech", ending: "zombie-saas", epitaph: "Still invoicing", grade: "D", week: 80, timestamp: 1 },
    ];
    const redis = fakeRedis({ lRange: stored.map((entry) => JSON.stringify(entry)) });
    useRedis(redis);
    expect(await call("GET")).toEqual({ status: 200, body: { entries: stored } });
    expect(redis.lRange).toHaveBeenCalledWith("graveyard", 0, 29);
  });

  it("puts a new entry at the front and keeps 50", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 200, body: { entry: ENTRY } });

    const [list, pushed] = redis.lPush.mock.calls[0] as [string, string];
    expect(list).toBe("graveyard");
    expect(JSON.parse(pushed)).toEqual(ENTRY);
    expect(redis.lTrim).toHaveBeenCalledWith("graveyard", 0, 49);
  });
});

describe("graveyard: a database that stops answering", () => {
  it("answers 500 after 3 seconds when the list gets no reply, and closes that connection", async () => {
    const redis = fakeRedis();
    redis.lRange.mockImplementation(unanswered);
    useRedis(redis);
    const pending = call("GET");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(redis.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(["lPush", "lTrim"] as const)(
    "answers 500 after 3 seconds when %s gets no reply to a new entry, and closes that connection",
    async (silent) => {
      const redis = fakeRedis();
      redis[silent].mockImplementation(unanswered);
      useRedis(redis);
      const pending = call("POST", SUBMISSION);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
      expect(redis[silent]).toHaveBeenCalledTimes(1);
      expect(redis.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
