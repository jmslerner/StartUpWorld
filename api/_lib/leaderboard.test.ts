// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import { format } from "node:util";
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

/** Hands the handler a request and collects what it answers. */
const answer = async (req: object): Promise<{ status: number; body: unknown }> => {
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
  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
  return reply;
};

const call = (method: string, body?: unknown) => answer({ method, body });

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

/**
 * The console methods that write by themselves. The others (trace, table, assert, group, count, time) write through
 * one of these, so "nothing else was logged" covers the whole console.
 */
const CONSOLE_METHODS = ["debug", "dir", "dirxml", "error", "info", "log", "warn"] as const;
/** What the handler wrote to the console, as the console prints it, with the method in front: "error: the line". */
let logged: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getRedis).mockReset();
  logged = [];
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(`${method}: ${format(...args)}`);
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  it("answers 500 after 3 seconds when the list gets no reply, closes that connection and logs why", async () => {
    const redis = fakeRedis();
    redis.zRange.mockImplementation(unanswered);
    useRedis(redis);
    const pending = call("GET");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(redis.destroy).toHaveBeenCalledTimes(1);
    expect(logged).toEqual(["error: leaderboard: request failed: Redis did not reply within 3000 ms"]);
  });

  it.each(["get", "zAdd", "zCard", "zRemRangeByRank", "set", "zRevRank"] as const)(
    "answers 500 after 3 seconds when %s gets no reply to a submitted score, closes that connection and logs why",
    async (silent) => {
      const redis = fakeRedis();
      redis[silent].mockImplementation(unanswered);
      useRedis(redis);
      const pending = call("POST", SUBMISSION);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
      expect(redis[silent]).toHaveBeenCalledTimes(1);
      expect(redis.destroy).toHaveBeenCalledTimes(1);
      expect(logged).toEqual(["error: leaderboard: request failed: Redis did not reply within 3000 ms"]);
    },
  );
});

describe("leaderboard: a failed request says why in the log", () => {
  it("answers 500 when a command fails, with one line that gives the reason and never a connection string", async () => {
    const redis = fakeRedis();
    redis.zRange.mockRejectedValue(
      // The second one is long, has another user, escapes and punctuation in the password, and is in upper case.
      new Error(
        "primary rediss://default:s3cret@db.example.com:6379 failed, " +
          "replica REDIS://app-user:pa%2Fss%2Bw0rd%3D~-_.0123456789abcdefghijklmnopqrstuvwxyz@db2.example.com:6380/0 too",
      ),
    );
    useRedis(redis);
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: leaderboard: request failed: primary [redis url] failed, replica [redis url] too"]);
    for (const secret of ["s3cret", "w0rd", "app-user", "db.example.com", "db2.example.com"]) expect(logged.join("\n")).not.toContain(secret);
  });

  it("answers 500 when a submitted score cannot be stored, with a line that holds nothing the player sent", async () => {
    const redis = fakeRedis();
    redis.zAdd.mockRejectedValue(new Error("READONLY You can't write against a read only replica."));
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: leaderboard: request failed: READONLY You can't write against a read only replica."]);
    for (const sent of ["Acme", "Ada", "4242"]) expect(logged.join("\n")).not.toContain(sent);
  });

  it("answers 500 when the request's body cannot be read, with the reason in the line", async () => {
    // What Vercel does when the handler reads req.body and the body is not the JSON its Content-Type promised.
    useRedis(fakeRedis());
    const unreadable = {
      method: "POST",
      get body(): never {
        throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
      },
    };
    expect(await answer(unreadable)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: leaderboard: request failed: Invalid JSON"]);
  });

  it("answers 500 when the database does not know a command, with a line that stops before the arguments it quotes back", async () => {
    // What redis-server 7 answers to a command it does not know. For ZADD the arguments are the player's entry.
    const redis = fakeRedis();
    redis.zAdd.mockRejectedValue(
      new Error(
        `ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"4242-1795521600000","companyName":"Acme","founderName":"Ada","ending":"ipo","grade":"A","score":90,"fi' `,
      ),
    );
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: leaderboard: request failed: ERR unknown command 'ZADD', with args beginning with: [not logged]"]);
    for (const sent of ["Acme", "Ada", "4242"]) expect(logged.join("\n")).not.toContain(sent);
  });

  it("answers 500 when a stored entry is not JSON, and says which one without quoting it", async () => {
    // What JSON.parse says about this entry quotes it: Unexpected token 'A', "Acme Corp,"... is not valid JSON
    useRedis(fakeRedis({ zRange: [JSON.stringify(ENTRY), "Acme Corp, founded by Ada Lovelace"] }));
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: leaderboard: request failed: stored entry at index 1 is not valid JSON"]);
    for (const stored of ["Acme", "Corp", "Ada", "Lovelace"]) expect(logged.join("\n")).not.toContain(stored);
  });

  it("has the reason in the log before it answers, so it is not lost when answering fails as well", async () => {
    const redis = fakeRedis();
    redis.zRange.mockRejectedValue(new Error("Socket closed unexpectedly"));
    useRedis(redis);
    const res = {
      status: () => res,
      json: () => {
        throw new Error("the response is already closed");
      },
    };
    const answering = handler({ method: "GET" } as unknown as VercelRequest, res as unknown as VercelResponse);
    await expect(answering).rejects.toThrow("the response is already closed");
    expect(logged).toEqual(["error: leaderboard: request failed: Socket closed unexpectedly"]);
  });

  it("logs nothing for a request it answers without a 500: a list, a new score, a refused submission, another method, a seed sent twice, no connection", async () => {
    useRedis(fakeRedis());
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST", SUBMISSION)).status).toBe(200);
    expect((await call("POST", { ...SUBMISSION, companyName: "" })).status).toBe(400);
    expect((await call("DELETE", SUBMISSION)).status).toBe(405);
    useRedis(fakeRedis({ get: "1" }));
    expect((await call("POST", SUBMISSION)).status).toBe(409);
    useRedis(null);
    expect((await call("POST", SUBMISSION)).status).toBe(503);
    expect(logged).toEqual([]);
  });
});
