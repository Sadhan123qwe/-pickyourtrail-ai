// Fails if anything secret-looking reaches the browser bundle (.next/static).
// Prints only file names and the rule that matched — never the matched text.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".next", "static");
if (!existsSync(root)) {
  console.error("No .next/static directory — run `npm run build` first.");
  process.exit(2);
}

// Notes: a bare variable *name* may appear as a UI label (Settings shows "OPENAI_API_KEY: configured
// server-side"); what must never appear is a key value, a client read of the server env var, or a
// NEXT_PUBLIC_ variant of a secret (which Next would inline into the bundle).
const rules = [
  // Standalone sk-… token (lookbehind avoids CSS class names such as "mask-image-…").
  { name: "OpenAI-style secret key (sk-…)", test: (s) => /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_]{20,}/.test(s) },
  { name: "Client read of process.env.OPENAI_API_KEY", test: (s) => s.includes("process.env.OPENAI_API_KEY") },
  { name: "Public (inlined) OpenAI/Supabase secret variable", test: (s) => /NEXT_PUBLIC_(OPENAI|[A-Z_]*SERVICE_ROLE|[A-Z_]*SECRET)/.test(s) },
  { name: "Supabase service-role key reference", test: (s) => s.includes("process.env.SUPABASE_SERVICE_ROLE_KEY") },
];
// If a real key is configured in this environment, make sure its value is nowhere in the bundle.
const liveKey = process.env.OPENAI_API_KEY;
if (liveKey && liveKey.length >= 12) rules.push({ name: "Configured OPENAI_API_KEY value", test: (s) => s.includes(liveKey) });

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|css|json|html|map)$/.test(entry)) yield p;
  }
}

let scanned = 0;
const hits = [];
for (const file of files(root)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  for (const r of rules) if (r.test(text)) hits.push(`${file.slice(process.cwd().length + 1)} — ${r.name}`);
}

if (hits.length) {
  console.error(`Secret check FAILED (${hits.length} finding${hits.length > 1 ? "s" : ""} in ${scanned} client files):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`Secret check passed: ${scanned} client bundle files scanned, no secret values or client reads of server-only keys found.`);
