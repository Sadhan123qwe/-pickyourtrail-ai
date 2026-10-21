import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** LIVE OpenAI tests (real, billable requests). Run with: npm run test:live — needs OPENAI_API_KEY in .env.local. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    setupFiles: ["tests/live/setup.ts"],
    pool: "forks",
    testTimeout: 90_000,
  },
});
