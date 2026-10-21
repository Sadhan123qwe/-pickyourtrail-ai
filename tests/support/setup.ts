import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test file gets its own throwaway database and runs in mock AI mode
// unless a test explicitly configures a provider.
const dir = mkdtempSync(join(tmpdir(), "pyt-test-"));
process.env.DATABASE_PATH = join(dir, "test.db");
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_BASE_URL;
process.env.AI_MODE = "";
