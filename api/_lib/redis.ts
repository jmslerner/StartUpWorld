import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

const CONNECT_TIMEOUT_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 1;
/** Hard ceiling on getRedis() so a handler can always answer before the platform kills it. */
const OVERALL_DEADLINE_MS = 5000;
/**
 * Hard ceiling on the wait for one command's reply. Connecting and the first
 * reply together take at most 8 s, which is also how long the game waits for
 * an answer (TIMEOUT_MS in src/api/client.ts).
 */
const REPLY_DEADLINE_MS = 3000;

/**
 * Storage integrations name their connection string differently (Upstash via the
 * Vercel Marketplace sets KV_URL / REDIS_URL depending on version, and a custom
 * storage prefix changes it again), so check the known names before falling back
 * to any env value that looks like a Redis URL.
 */
const URL_ENV_CANDIDATES = [
  "REDIS_URL",
  "KV_URL",
  "UPSTASH_REDIS_URL",
  "STORAGE_REDIS_URL",
];

/** Returns the URL with surrounding quotes stripped, or null if it isn't a Redis URL. */
function normalizeRedisUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (trimmed.startsWith("redis://") || trimmed.startsWith("rediss://")) return trimmed;
  // KV_REST_API_URL and friends are https:// REST endpoints — not usable here.
  return null;
}

function resolveRedisUrl(): string | null {
  for (const key of URL_ENV_CANDIDATES) {
    const url = normalizeRedisUrl(process.env[key]);
    if (url) return url;
  }

  // Vercel storage integrations prefix their vars with the store name
  // (e.g. startup_world_game_REDIS_URL), so match on suffix too.
  for (const candidate of URL_ENV_CANDIDATES) {
    const suffix = `_${candidate}`.toLowerCase();
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.toLowerCase().endsWith(suffix)) continue;
      const url = normalizeRedisUrl(value);
      if (url) return url;
    }
  }

  // Last resort: any env value that looks like a Redis connection string.
  for (const value of Object.values(process.env)) {
    const url = normalizeRedisUrl(value);
    if (url) return url;
  }
  return null;
}

export async function getRedis(): Promise<RedisClient | null> {
  const url = resolveRedisUrl();
  if (!url) return null;

  if (!client) {
    let created: RedisClient;
    try {
      created = createClient({
        url,
        socket: {
          connectTimeout: CONNECT_TIMEOUT_MS,
          // The default strategy retries forever, which leaves connect() pending
          // indefinitely when the host is unreachable — the function then hangs
          // until Vercel kills it and the browser never gets a response.
          // Returning an Error stops retrying and rejects connect() instead.
          reconnectStrategy: (retries) =>
            retries > MAX_RECONNECT_ATTEMPTS
              ? new Error("redis unreachable")
              : Math.min(retries * 100, 500),
        },
      });
    } catch {
      // createClient parses the URL and throws when it cannot (a hand-pasted
      // password with an unescaped "/", "#" or "?", or a mistyped port). Node's
      // error carries the whole string, password included, so it must not
      // escape to the platform's logs: treat the URL as unusable instead.
      return null;
    }
    created.on("error", () => {});
    client = created;
  }

  // A reply deadline in another request can drop the shared client, and a
  // third request can put a new one in its place, while this request waits
  // below. From here on it deals only with the client it started with.
  const current = client;
  // Open is not the same as ready. A client that another request is still
  // connecting, or that is reconnecting by itself, is handed out as well, and
  // a command sent on it waits in the client's queue with its 3 s already
  // running. When connecting takes longer than that, the deadline drops the
  // client under the request that is connecting it: both fail, and the next
  // request starts over.
  if (current.isOpen) return current;

  try {
    await withDeadline(current.connect(), OVERALL_DEADLINE_MS, new Error("redis connect timed out"));
  } catch {
    // Drop the client so the next request starts from a clean one rather than
    // reusing a socket stuck mid-reconnect.
    drop(current);
    return null;
  }
  // connect() also returns normally when the client was destroyed while it was
  // still connecting, and a closed client is no use to the caller.
  return current.isOpen ? current : null;
}

/**
 * Waits for one command's reply, but not for ever:
 *
 *     const value = await withReplyDeadline(redis, redis.get(key));
 *
 * node-redis has no reply timeout. Its per-command `timeout` option and abort
 * signal only cover a command that is still queued, so a command that was sent
 * to a server that has gone silent stays pending until Vercel ends the
 * function at its maximum duration, 300 s.
 *
 * When the deadline passes, the client is destroyed and forgotten before this
 * throws. getRedis() would otherwise hand out the same connection for as long
 * as it looks open, and every later request on this instance would wait out
 * the deadline on it too.
 *
 * `socket.socketTimeout` is no substitute. It is an idle timer, and the
 * reconnectStrategy above reconnects whatever the cause, so a healthy idle
 * client would reconnect every time it fired.
 */
export async function withReplyDeadline<T>(redis: RedisClient, reply: Promise<T>): Promise<T> {
  const expired = new Error(`Redis did not reply within ${REPLY_DEADLINE_MS} ms`);
  try {
    return await withDeadline(reply, REPLY_DEADLINE_MS, expired);
  } catch (err) {
    // Only the deadline itself condemns the connection. A command that fails
    // by itself was either answered, with an error, or refused by a client
    // that already knows its connection is gone and reconnects by itself.
    if (err === expired) drop(redis);
    throw err;
  }
}

/**
 * Destroys a client that can no longer be trusted, and forgets it if it is
 * still the shared one, so the next getRedis() starts from a new client.
 *
 * Destroying closes the client's connection, with one exception that
 * node-redis (5.11) offers no way around: a connection that is still being
 * made is out of its reach, and stays open if it completes afterwards.
 */
function drop(dead: RedisClient): void {
  try {
    dead.destroy();
  } catch {
    // already closed
  }
  if (client === dead) client = null;
}

/** Settles like `promise`, unless it is still pending after `ms`: then it rejects with `expired`. */
function withDeadline<T>(promise: Promise<T>, ms: number, expired: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(expired), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
