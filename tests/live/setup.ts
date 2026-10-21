import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectEnv } from "@/lib/load-env";

// Load .env.local exactly like the app's dev server. (@next/env skips .env.local when
// NODE_ENV=test, which is why live tests previously reported "OPENAI_API_KEY is not configured".)
const { loadedFiles } = loadProjectEnv();
console.log(`[live] env files loaded: ${loadedFiles.join(", ") || "none"}`);
// Data goes to a throwaway database; the real app database is never touched.
const dir = mkdtempSync(join(tmpdir(), "pyt-live-"));
process.env.DATABASE_PATH = join(dir, "live.db");
process.env.AI_MODE = "";
