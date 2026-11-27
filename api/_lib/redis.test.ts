import net, { createServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

type RedisModule = typeof import("./redis.js");
type RedisClient = NonNullable<Awaited<ReturnType<RedisModule["getRedis"]>>>;

// The module keeps its client between calls, so every test starts from its own copy of the module.
let getRedis: RedisModule["getRedis"];
let withReplyDeadline: RedisModule["withReplyDeadline"];

beforeEach(async () => {
  vi.resetModules();
  ({ getRedis, withReplyDeadline } = await import("./redis.js"));
});

describe("getRedis: a connection string that does not parse", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers null instead of throwing, so the string cannot escape in an uncaught error", async () => {
    // An unescaped "/" in the password: everything after it stops being part of the host, and the port is not a number.
    const unparseable = "redis://default:pa/ss-SECRET@db.example.com:6379";
    expect(() => new URL(unparseable)).toThrow();
    vi.stubEnv("REDIS_URL", unparseable);
    await expect(getRedis()).resolves.toBeNull();
  });
});

/**
 * A stand-in for the database on a local port, for the real client to talk to. It answers every command until `silent`
 * is set. After that it still reads what arrives, so the client's writes succeed, but it never answers and never closes
 * the connection: what a hung server, or a connection the network has silently dropped, looks like from the client.
 *
 * Its URL carries a password, as the production one does. The client then starts every connection with AUTH, and that
 * changes the path it takes when it is destroyed while the handshake is still unanswered.
 */
const startStandIn = async () => {
  const sockets = new Set<Socket>();
  const waiting = new Map<string, () => void>();
  const db = {
    url: "",
    silent: false,
    /** One entry per connection the client opened: the commands it sent, and a promise for the client closing it. */
    connections: [] as { commands: string[]; closed: Promise<void> }[],
    /** Resolves when the next command with this name arrives. */
    received: (name: string) => new Promise<void>((resolve) => waiting.set(name, resolve)),
    stop: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  const server = createServer((socket) => {
    const connection = {
      commands: [] as string[],
      closed: new Promise<void>((resolve) => socket.on("close", () => resolve())),
    };
    db.connections.push(connection);
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));

    const receive = (args: string[]): void => {
      const name = args[0].toUpperCase();
      connection.commands.push(name);
      waiting.get(name)?.();
      waiting.delete(name);
      if (db.silent) return;
      if (name === "AUTH" || name === "CLIENT" || name === "SET") socket.write("+OK\r\n");
      else if (name === "GET") socket.write("$-1\r\n");
      else socket.write(`-ERR unknown command '${args[0]}'\r\n`);
    };

    // A command arrives as "*<n>" and then n pairs of lines: "$<length>" and the argument itself.
    let buffered = "";
    let args: string[] = [];
    let linesLeft = 0;
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("latin1");
      for (let end = buffered.indexOf("\r\n"); end !== -1; end = buffered.indexOf("\r\n")) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (linesLeft === 0) {
          linesLeft = Number(line.slice(1)) * 2;
          args = [];
          continue;
        }
        if (linesLeft % 2 === 1) args.push(line);
        linesLeft -= 1;
        if (linesLeft === 0) receive(args);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  db.url = `redis://default:stand-in-password@127.0.0.1:${(server.address() as AddressInfo).port}`;
  return db;
};

// These run the real client against the stand-in, because what matters is what the client does: it never gives up on a
// command by itself, destroying it has to close the connection, and a new client has to be able to connect afterwards.
describe("a database that stops answering", () => {
  const NO_REPLY = "Redis did not reply within 3000 ms";

  let db: Awaited<ReturnType<typeof startStandIn>>;
  const opened: RedisClient[] = [];

  /** A client from getRedis(), which has to be there: the stand-in is listening. */
  const connect = async (): Promise<RedisClient> => {
    const client = await getRedis();
    if (!client) throw new Error("getRedis() answered null: no connection to the stand-in");
    if (!opened.includes(client)) opened.push(client);
    return client;
  };

  /** What the promise settled with, or "still pending". */
  const peek = <T>(promise: Promise<T>): Promise<T | "still pending"> =>
    Promise.race([promise, Promise.resolve("still pending" as const)]);

  /** The message a wait was given up with, so a test can look at it without an unhandled rejection in between. */
  const failure = (reply: Promise<unknown>): Promise<string> =>
    reply.then(
      () => "replied",
      (err: Error) => err.message,
    );

  beforeEach(async () => {
    db = await startStandIn();
    vi.stubEnv("REDIS_URL", db.url);
    // Only the timers behind the two deadlines are faked. The client and the stand-in talk over a real connection.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const client of opened.splice(0)) if (client.isOpen) client.destroy();
    await db.stop();
  });

  describe("withReplyDeadline", () => {
    it("gives up on a command after 3 seconds when no reply comes", async () => {
      const redis = await connect();
      db.silent = true;
      const arrived = db.received("SET");
      const outcome = failure(withReplyDeadline(redis, redis.set("key", "value")));
      await arrived;

      await vi.advanceTimersByTimeAsync(2999);
      expect(await peek(outcome)).toBe("still pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(await peek(outcome)).toBe(NO_REPLY);
    });

    it("drops the connection that went silent, so the next getRedis() opens a new one", async () => {
      const first = await connect();
      db.silent = true;
      const arrived = db.received("SET");
      const outcome = failure(withReplyDeadline(first, first.set("key", "value")));
      await arrived;
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(outcome)).toBe(NO_REPLY);

      // The database answers again, but only a new connection can find that out.
      db.silent = false;
      const second = await connect();
      expect(second).not.toBe(first);
      await expect(withReplyDeadline(second, second.set("key", "value"))).resolves.toBe("OK");

      // The dead connection is closed rather than left open, and the write went out again on a second one.
      expect(first.isOpen).toBe(false);
      await db.connections[0].closed;
      expect(db.connections.map((connection) => connection.commands)).toEqual([
        ["AUTH", "CLIENT", "CLIENT", "SET"],
        ["AUTH", "CLIENT", "CLIENT", "SET"],
      ]);
    });

    it("leaves a newer client alone when a deadline expires on one that was already dropped", async () => {
      // A real command is rejected the moment its client is destroyed, so only a wait that outlives the client can
      // get here. A promise that never settles stands in for one.
      const unanswered = new Promise<never>(() => {});
      const first = await connect();
      const early = failure(withReplyDeadline(first, unanswered));
      await vi.advanceTimersByTimeAsync(1000);
      const late = failure(withReplyDeadline(first, unanswered));

      await vi.advanceTimersByTimeAsync(2000);
      expect(await peek(early)).toBe(NO_REPLY);
      const second = await connect();
      expect(second).not.toBe(first);

      await vi.advanceTimersByTimeAsync(1000);
      expect(await peek(late)).toBe(NO_REPLY);
      expect(second.isOpen).toBe(true);
      expect(await getRedis()).toBe(second);
    });

    it("hands a reply that comes in time straight through, keeps the connection and leaves no timer running", async () => {
      const redis = await connect();
      await expect(withReplyDeadline(redis, redis.set("key", "value"))).resolves.toBe("OK");
      await expect(withReplyDeadline(redis, redis.get("key"))).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(await getRedis()).toBe(redis);
      expect(db.connections).toHaveLength(1);
    });

    it("hands the command's own failure straight through and keeps the connection: an error reply is still a reply", async () => {
      const redis = await connect();
      await expect(withReplyDeadline(redis, redis.sendCommand(["NOPE"]))).rejects.toThrow("ERR unknown command 'NOPE'");
      expect(vi.getTimerCount()).toBe(0);
      expect(await getRedis()).toBe(redis);
      expect(redis.isOpen).toBe(true);
    });
  });

  describe("getRedis", () => {
    it("gives up connecting after 5 seconds when the handshake gets no answer, and starts from a new client next time", async () => {
      db.silent = true;
      const handshake = db.received("CLIENT");
      const connecting = getRedis();
      await handshake;
      await vi.advanceTimersByTimeAsync(4999);
      expect(await peek(connecting)).toBe("still pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(await peek(connecting)).toBeNull();

      db.silent = false;
      const next = await connect();
      await expect(withReplyDeadline(next, next.set("key", "value"))).resolves.toBe("OK");
      await db.connections[0].closed;
      expect(db.connections).toHaveLength(2);
    });

    it("answers null, not a closed client, to a request whose client was dropped while it was still connecting", async () => {
      db.silent = true;
      const handshake = db.received("CLIENT");
      const connecting = getRedis();
      await handshake;
      // A second request on the same instance is handed the same client, and its command waits for the connection.
      const shared = await connect();
      const outcome = failure(withReplyDeadline(shared, shared.get("key")));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(outcome)).toBe(NO_REPLY);
      expect(shared.isOpen).toBe(false);

      // The first request's connect() now ends without an error, although its client has been closed. The client
      // sleeps for 0 ms before it does: let that timer run whether or not it is one of the faked ones.
      await vi.advanceTimersByTimeAsync(1);
      expect(await connecting).toBeNull();
    });

    it("does not close a newer client when a connect that hung finally gives up", async () => {
      // The TCP connection itself hangs, as it does when packets to the host disappear: a socket that never connects
      // and never fails. Only the first client gets it. The client's 2 second connect timeout is switched off for it,
      // because that one is a real timer, and this test must not depend on finishing before it.
      const stuck = new net.Socket();
      onTestFinished(() => void stuck.destroy());
      vi.spyOn(stuck, "setTimeout").mockReturnValue(stuck);
      vi.spyOn(net, "createConnection").mockImplementationOnce(() => stuck);
      const hung = getRedis();
      const shared = await connect();
      const outcome = failure(withReplyDeadline(shared, shared.get("key")));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await peek(outcome)).toBe(NO_REPLY);

      // A third request starts over and reaches the database before the first request's 5 seconds are up.
      const second = await connect();
      expect(second).not.toBe(shared);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await hung).toBeNull();
      expect(second.isOpen).toBe(true);
      expect(await getRedis()).toBe(second);
    });
  });
});
