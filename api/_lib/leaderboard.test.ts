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

/** Hands the handler a request as it is, for the ones that take more than a method and a body. */
const send = async (req: object): Promise<{ status: number; body: unknown }> => {
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

const call = (method: string, body?: unknown) => send({ method, body });

/** A command that was sent and is never answered. */
const unanswered = () => new Promise<never>(() => {});

/** What the promise settled with, or "still pending". */
const peek = <T>(promise: Promise<T>): Promise<T | "still pending"> =>
  Promise.race([promise, Promise.resolve("still pending" as const)]);

/**
 * The console methods that write by themselves. The rest of the console (trace, table, group, assert, count and the
 * timers) prints through one of these. A write straight to process.stdout or process.stderr is not seen here.
 */
const CONSOLE_METHODS = ["error", "warn", "info", "log", "debug", "dir", "dirxml"] as const;

/**
 * Everything the handler printed with the console: one [method, line] pair per call. The line is spelled out the way
 * the console prints it, so an error object handed to the console counts with all it carries, not only its message.
 */
const logged = (): [method: string, line: string][] =>
  CONSOLE_METHODS.flatMap((method) =>
    vi.mocked(console[method]).mock.calls.map((args): [string, string] => [method, format(...args)]),
  );

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
  // A failure is reported with console.error, so that one is silenced. The others are only watched: the handler
  // should not use them, and a line written with one still shows up in the test output.
  for (const method of CONSOLE_METHODS) vi.spyOn(console, method);
  vi.mocked(console.error).mockImplementation(() => {});
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
    expect(logged()).toEqual([["error", "leaderboard: request failed: Redis did not reply within 3000 ms"]]);
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
      expect(logged()).toEqual([["error", "leaderboard: request failed: Redis did not reply within 3000 ms"]]);
    },
  );
});

describe("leaderboard: a failed request leaves one line in the log", () => {
  it("answers 500 when the list fails, and says why without the connection strings the error carries", async () => {
    const redis = fakeRedis();
    redis.zRange.mockRejectedValue(
      new Error("primary rediss://default:s3cret@db.example.com:6379 failed, replica REDIS://default:0ther@db2.example.com:6380 too"),
    );
    useRedis(redis);
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toEqual([["error", "leaderboard: request failed: primary [redis url] failed, replica [redis url] too"]]);
    for (const secret of ["s3cret", "0ther", "db.example.com", "db2.example.com"]) {
      expect(logged().flat().join("\n")).not.toContain(secret);
    }
  });

  it("answers 500 when a submitted score cannot be stored, and logs the reason but nothing the player sent", async () => {
    const redis = fakeRedis();
    redis.zAdd.mockRejectedValue(new Error("READONLY You can't write against a read only replica."));
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toEqual([["error", "leaderboard: request failed: READONLY You can't write against a read only replica."]]);
    for (const sent of ["Acme", "Ada", "4242"]) expect(logged().flat().join("\n")).not.toContain(sent);
  });

  it("answers 500 when the database does not know the command, and leaves out the arguments its reply repeats", async () => {
    // What redis-server 7 answers when ZADD has been taken away from it. For this command the arguments are the entry.
    const redis = fakeRedis();
    redis.zAdd.mockRejectedValue(
      new Error(
        `ERR unknown command 'ZADD', with args beginning with: 'leaderboard' '90' '{"id":"4242-1795521600000","companyName":"Acme","founderName":"Ada","ending":"ipo","grade":"A","sc' `,
      ),
    );
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toEqual([
      ["error", "leaderboard: request failed: ERR unknown command 'ZADD', with args beginning with: [not logged]"],
    ]);
    for (const sent of ["Acme", "Ada", "4242"]) expect(logged().flat().join("\n")).not.toContain(sent);
  });

  it("answers 500 when a stored entry is not valid JSON, and names its place instead of quoting it", async () => {
    // Node's own message for this entry quotes it: Unexpected token 'G', ..."nderName":Gavin Bels"... is not valid JSON
    const broken = '{"id":"7-1","companyName":"Hooli","founderName":Gavin Belson,"ending":"ipo","score":40}';
    useRedis(fakeRedis({ zRange: [JSON.stringify(ENTRY), broken] }));
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toEqual([["error", "leaderboard: request failed: the stored entry at index 1 is not valid JSON"]]);
    expect(logged().flat().join("\n")).not.toContain("Gavin");
  });

  it("answers 500 when the request body cannot be read, and says so without repeating what the reader threw", async () => {
    // Vercel parses the body when it is first read, and that read throws when it cannot. Its message today is a fixed
    // "Invalid JSON", but the wording is Vercel's to change, and a parser's message can quote what it choked on.
    const request = {
      method: "POST",
      get body(): unknown {
        throw new SyntaxError(`Unexpected token 'A', ..."nderName":Ada Lovela"... is not valid JSON`);
      },
    };
    useRedis(fakeRedis());
    expect(await send(request)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toEqual([["error", "leaderboard: request failed: the request body could not be read"]]);
    expect(logged().flat().join("\n")).not.toContain("Ada");
  });

  it("writes the line before it answers", async () => {
    // The order has no effect as long as answering cannot fail. It is pinned so that the reason is already on record
    // if it ever does.
    const redis = fakeRedis();
    redis.zRange.mockRejectedValue(new Error("Socket closed unexpectedly"));
    useRedis(redis);
    const order: string[] = [];
    vi.mocked(console.error).mockImplementation(() => void order.push("logged"));
    const res = {
      status() {
        return res;
      },
      json() {
        order.push("answered");
        return res;
      },
    };
    await handler({ method: "GET" } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(order).toEqual(["logged", "answered"]);
  });

  it("logs nothing when a request does not fail, whether it is answered or refused", async () => {
    useRedis(fakeRedis({ zRange: [JSON.stringify(ENTRY)] }));
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST", SUBMISSION)).status).toBe(200);
    expect((await call("POST", { ...SUBMISSION, companyName: "" })).status).toBe(400);
    expect((await call("DELETE")).status).toBe(405);
    useRedis(fakeRedis({ get: "1" }));
    expect((await call("POST", SUBMISSION)).status).toBe(409);
    expect(logged()).toEqual([]);
  });
});
