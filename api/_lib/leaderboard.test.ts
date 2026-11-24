// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../leaderboard.js";
import { getRedis } from "./redis.js";

// Only getRedis is replaced. The handler also imports withReplyDeadline, and that has to stay the real one.
vi.mock("./redis.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redis.js")>()),
  getRedis: vi.fn(),
}));

type RedisClient = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

/** What a healthy database answers to each command the handler uses. 51 entries is one over the limit of 50. */
const HEALTHY = { zRange: [] as string[], get: null as string | null, zAdd: 1, zCard: 51, zRemRangeByRank: 1, set: "OK", zRevRank: 2 };
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

/** 30 for the valuation, 10 for half the company, 15 for users, 15 for revenue and 20 for the IPO: 90, an A. */
const SUBMISSION = {
  companyName: "Acme",
  founderName: "Ada",
  ending: "ipo",
  score: 90,
  finalValuation: 1_000_000_000,
  founderOwnership: 0.5,
  finalUsers: 100_000,
  finalMrr: 250_000,
  week: 52,
  seed: 4242,
};

const ENTRY = {
  id: `4242-${NOW.getTime()}`,
  companyName: "Acme",
  founderName: "Ada",
  ending: "ipo",
  grade: "A",
  score: 90,
  finalValuation: 1_000_000_000,
  week: 52,
  seed: 4242,
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

describe("leaderboard: a healthy database", () => {
  it("lists the entries, highest score first", async () => {
    const stored = [{ ...ENTRY, score: 90 }, { ...ENTRY, id: "7-1", score: 40, grade: "D" }];
    const redis = fakeRedis({ zRange: stored.map((entry) => JSON.stringify(entry)) });
    useRedis(redis);
    expect(await call("GET")).toEqual({ status: 200, body: { entries: stored } });
    expect(redis.zRange).toHaveBeenCalledWith("leaderboard", 0, 49, { REV: true });
  });

  it("stores a submitted score, trims the board to 50 and answers with the rank", async () => {
    const redis = fakeRedis();
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 200, body: { rank: 3, entry: ENTRY } });

    expect(redis.get).toHaveBeenCalledWith("submitted-seeds:4242");
    const [board, added] = redis.zAdd.mock.calls[0] as [string, { score: number; value: string }];
    expect(board).toBe("leaderboard");
    expect(added.score).toBe(90);
    expect(JSON.parse(added.value)).toEqual(ENTRY);
    expect(redis.zCard).toHaveBeenCalledWith("leaderboard");
    expect(redis.zRemRangeByRank).toHaveBeenCalledWith("leaderboard", 0, 0);
    expect(redis.set).toHaveBeenCalledWith("submitted-seeds:4242", "1", { EX: 86400 });
    expect(redis.zRevRank).toHaveBeenCalledWith("leaderboard", added.value);
  });

  it("refuses a seed that was already submitted, without writing", async () => {
    const redis = fakeRedis({ get: "1" });
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 409, body: { error: "Seed already submitted" } });
    expect(redis.zAdd).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe("leaderboard: a database that stops answering", () => {
  it("answers 500 after 3 seconds when the list gets no reply, and closes that connection", async () => {
    const redis = fakeRedis();
    redis.zRange.mockImplementation(unanswered);
    useRedis(redis);
    const pending = call("GET");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(redis.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(["get", "zAdd", "zCard", "zRemRangeByRank", "set", "zRevRank"] as const)(
    "answers 500 after 3 seconds when %s gets no reply to a submitted score, and closes that connection",
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
