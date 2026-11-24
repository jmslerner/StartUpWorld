import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

const CONNECT_TIMEOUT_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 1;
/** Hard ceiling on getRedis() so a handler can always answer before the platform kills it. */
const OVERALL_DEADLINE_MS = 5000;

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

  if (client.isOpen) return client;

  try {
    await withDeadline(client.connect(), OVERALL_DEADLINE_MS);
    return client;
  } catch {
    // Drop the client so the next request starts from a clean one rather than
    // reusing a socket stuck mid-reconnect.
    try {
      await client.destroy();
    } catch {
      // already dead
    }
    client = null;
    return null;
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("redis connect timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
