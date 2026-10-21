// Starts `next start` on a port with a fresh SQLite database (used by Playwright).
// Usage: node scripts/e2e-server.mjs <port> <databasePath>
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";

const [port, dbPath] = process.argv.slice(2);
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_PATH: dbPath },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
