import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API tests live under api/_lib: Vercel deploys every other file in api/ as a function.
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
