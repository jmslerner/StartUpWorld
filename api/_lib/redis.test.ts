import { afterEach, describe, expect, it, vi } from "vitest";
import { getRedis } from "./redis.js";

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
