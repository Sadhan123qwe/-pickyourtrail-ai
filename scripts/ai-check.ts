/**
 * Verifies the live OpenAI integration from the command line, using .env.local.
 * Usage: npm run ai:check
 * Prints pass/fail/blocked per check. Never prints the API key or ephemeral secrets.
 */
import { loadProjectEnv } from "../src/lib/load-env";

// Same files and precedence as the Next.js dev server (.env.development.local, .env.local, ...).
const { loadedFiles } = loadProjectEnv();

async function main(): Promise<number> {
  const { runAiHealthCheck } = await import("../src/lib/ai/health");
  const { closeDb } = await import("../src/lib/db");
  const result = await runAiHealthCheck();
  closeDb();
  console.log(`Env files loaded: ${loadedFiles.join(", ") || "none"}`);
  console.log(`AI mode: ${result.mode} — ${result.reason}`);
  console.log(`OS certificate store trusted for outbound TLS: ${result.systemCaTrusted ? "yes" : "no"}`);
  console.log(`Models: ${Object.entries(result.models).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const icon = { passed: "PASS   ", failed: "FAIL   ", blocked: "BLOCKED" } as const;
  for (const c of result.checks) console.log(`${icon[c.status]} ${c.name}${c.latencyMs !== null ? ` (${c.latencyMs} ms)` : ""}: ${c.detail}`);
  return (result.checks.some((c) => c.status === "failed") ? 1 : result.checks.some((c) => c.status === "blocked") ? 2 : 0);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`AI check could not run: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  },
);
