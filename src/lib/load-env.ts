import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { processEnv } from "@next/env";

/** Same files and precedence as the Next.js dev server (first match wins). */
const DEV_ENV_FILES = [".env.development.local", ".env.local", ".env.development", ".env"];

/**
 * Loads the project's .env files exactly as the Next.js dev server does — for
 * scripts and the LIVE test suite, so they see the same OPENAI_* configuration
 * as the app. Variables already set in the real environment keep precedence.
 *
 * Why this exists: @next/env's loadEnvConfig() skips `.env.local` whenever
 * NODE_ENV is "test" (Vitest sets it), so the live suite saw no key. We pass an
 * explicit file list to @next/env's processEnv (same parser and expansion) instead.
 * Ordinary unit tests never call this, so they never load .env.local.
 */
export function loadProjectEnv(dir = process.cwd()): { loadedFiles: string[] } {
  const files = DEV_ENV_FILES.flatMap((path) => {
    const full = join(dir, path);
    if (!existsSync(full) || !statSync(full).isFile()) return [];
    return [{ path, contents: readFileSync(full, "utf8"), env: {} }];
  });
  const quiet = { info: () => {}, error: (...a: unknown[]) => console.error(...a) } as unknown as Console;
  processEnv(files, dir, quiet, true);
  return { loadedFiles: files.map((f) => f.path) };
}
