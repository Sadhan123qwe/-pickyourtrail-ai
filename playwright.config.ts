import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against production builds (`npm run test:e2e` builds first).
 *  - :3100 → forced mock AI mode (AI_MODE=mock), fresh database
 *  - :3101 → a configured-but-unreachable AI provider, to test graceful recovery
 */
const common = { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "node scripts/e2e-server.mjs 3100 data/e2e.db",
      url: "http://localhost:3100/api/health",
      timeout: 180_000,
      reuseExistingServer: false,
      // Forced mock mode: deterministic even when .env.local holds a real key (next start loads .env.local).
      env: { ...common, OPENAI_API_KEY: "", AI_MODE: "mock" },
    },
    {
      command: "node scripts/e2e-server.mjs 3101 data/e2e-provider-error.db",
      url: "http://localhost:3101/api/health",
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...common,
        OPENAI_API_KEY: "sk-e2e-unreachable-provider-key",
        OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
        AI_MAX_RETRIES: "0",
        AI_TIMEOUT_MS: "3000",
        SEED_BUSINESS_DATA: "false",
      },
    },
  ],
});
