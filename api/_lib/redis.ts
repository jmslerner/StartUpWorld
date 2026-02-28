import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

export async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = createClient({ url });
    client.on("error", () => {});
    await client.connect();
  }
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}
