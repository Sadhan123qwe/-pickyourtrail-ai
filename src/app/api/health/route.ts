import { route } from "@/lib/http";
import { get } from "@/lib/db";
import { aiStatus } from "@/lib/ai/run";

export const GET = route({}, () => {
  const db = get<{ ok: number }>("SELECT 1 AS ok")?.ok === 1;
  return { status: db ? "ok" : "degraded", database: db ? "ok" : "error", ai: aiStatus().mode, time: new Date().toISOString() };
});
