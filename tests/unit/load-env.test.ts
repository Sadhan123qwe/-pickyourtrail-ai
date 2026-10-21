import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import { loadProjectEnv } from "@/lib/load-env";

describe("project env loading for scripts and live tests", () => {
  it("loads .env.local even though Vitest sets NODE_ENV=test, then restores NODE_ENV", () => {
    const dir = mkdtempSync(join(tmpdir(), "pyt-env-"));
    writeFileSync(join(dir, ".env.local"), "PYT_ENV_PROBE=from-local\r\n");
    expect(process.env.NODE_ENV).toBe("test");
    // The root cause: Next's loader deliberately ignores .env.local in test mode.
    loadEnvConfig(dir, false, { info: () => {}, error: () => {} } as unknown as Console, true);
    expect(process.env.PYT_ENV_PROBE).toBeUndefined();
    const { loadedFiles } = loadProjectEnv(dir);
    expect(loadedFiles).toContain(".env.local");
    expect(process.env.PYT_ENV_PROBE).toBe("from-local");
    expect(process.env.NODE_ENV).toBe("test");
  });
});
