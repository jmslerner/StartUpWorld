// Lives under api/_lib on purpose: Vercel turns every other file in api/ into a function, and skips paths that contain
// "/_".
import { format } from "node:util";
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

/** Every console method that writes a line is watched, so "nothing else was logged" covers all of them. */
const CONSOLE_METHODS = ["debug", "error", "info", "log", "warn"] as const;
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
  it("answers 500 after 3 seconds when the list gets no reply, closes that connection and logs why", async () => {
    const redis = fakeRedis();
    redis.lRange.mockImplementation(unanswered);
    useRedis(redis);
    const pending = call("GET");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(redis.destroy).toHaveBeenCalledTimes(1);
    expect(logged).toEqual(["error: graveyard: request failed: Redis did not reply within 3000 ms"]);
  });

  it.each(["lPush", "lTrim"] as const)(
    "answers 500 after 3 seconds when %s gets no reply to a new entry, closes that connection and logs why",
    async (silent) => {
      const redis = fakeRedis();
      redis[silent].mockImplementation(unanswered);
      useRedis(redis);
      const pending = call("POST", SUBMISSION);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(pending)).toEqual({ status: 500, body: { error: "Internal server error" } });
      expect(redis[silent]).toHaveBeenCalledTimes(1);
      expect(redis.destroy).toHaveBeenCalledTimes(1);
      expect(logged).toEqual(["error: graveyard: request failed: Redis did not reply within 3000 ms"]);
    },
  );
});

describe("graveyard: a failed request says why in the log", () => {
  it("answers 500 when a command fails, with one line that gives the reason and never a connection string", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(
      new Error("primary rediss://default:s3cret@db.example.com:6379 failed, replica REDIS://default:0ther@db2.example.com:6380 too"),
    );
    useRedis(redis);
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: graveyard: request failed: primary [redis url] failed, replica [redis url] too"]);
    for (const secret of ["s3cret", "0ther", "db.example.com", "db2.example.com"]) expect(logged.join("\n")).not.toContain(secret);
  });

  it("answers 500 when a new entry cannot be stored, with a line that holds nothing the player sent", async () => {
    const redis = fakeRedis();
    redis.lPush.mockRejectedValue(new Error("READONLY You can't write against a read only replica."));
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: graveyard: request failed: READONLY You can't write against a read only replica."]);
    for (const sent of ["Acme", "bankruptcy", "runway"]) expect(logged.join("\n")).not.toContain(sent);
  });

  it("answers 500 when the database does not know a command, with a line that stops before the arguments it quotes back", async () => {
    // What redis-server 7 answers to a command it does not know. For LPUSH the arguments are the player's entry.
    const redis = fakeRedis();
    redis.lPush.mockRejectedValue(
      new Error(
        `ERR unknown command 'LPUSH', with args beginning with: 'graveyard' '{"id":"gv-1795521600000-adyva5","companyName":"Acme","ending":"bankruptcy","epitaph":"Ran out of runway","grade":"F"' `,
      ),
    );
    useRedis(redis);
    expect(await call("POST", SUBMISSION)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: graveyard: request failed: ERR unknown command 'LPUSH', with args beginning with: [not logged]"]);
    for (const sent of ["Acme", "bankruptcy", "runway"]) expect(logged.join("\n")).not.toContain(sent);
  });

  it("answers 500 when a stored entry is not JSON, and says which one without quoting it", async () => {
    // What JSON.parse says about this entry quotes it: Unexpected token 'I', "Initech: s"... is not valid JSON
    const valid = JSON.stringify({ id: "gv-2", companyName: "Acme", ending: "bankruptcy", epitaph: "Ran out of runway", grade: "F", week: 12, timestamp: 2 });
    useRedis(fakeRedis({ lRange: [valid, valid, "Initech: still invoicing"] }));
    expect(await call("GET")).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged).toEqual(["error: graveyard: request failed: stored entry at index 2 is not valid JSON"]);
    for (const stored of ["Initech", "invoicing"]) expect(logged.join("\n")).not.toContain(stored);
  });

  it("has the reason in the log before it answers, so it is not lost when answering fails as well", async () => {
    const redis = fakeRedis();
    redis.lRange.mockRejectedValue(new Error("Socket closed unexpectedly"));
    useRedis(redis);
    const res = {
      status: () => res,
      json: () => {
        throw new Error("the response is already closed");
      },
    };
    const answering = handler({ method: "GET" } as unknown as VercelRequest, res as unknown as VercelResponse);
    await expect(answering).rejects.toThrow("the response is already closed");
    expect(logged).toEqual(["error: graveyard: request failed: Socket closed unexpectedly"]);
  });

  it("logs nothing when nothing failed: a list, a new entry, a submission that does not validate", async () => {
    useRedis(fakeRedis());
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST", SUBMISSION)).status).toBe(200);
    expect((await call("POST", { ...SUBMISSION, epitaph: "" })).status).toBe(400);
    expect(logged).toEqual([]);
  });
});
