import { z } from "zod";
import { parseBody, requirePermission, route } from "@/lib/http";
import { getAiSettings, monthToDateSpendUsd, updateAiSettings } from "@/lib/ai/usage";
import { aiStatus } from "@/lib/ai/run";
import { recordAudit } from "@/lib/repos/audit";

export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "settings:manage");
  return { settings: getAiSettings(), monthToDateUsd: monthToDateSpendUsd(), ai: aiStatus() };
});

const PatchSchema = z.object({
  monthlyBudgetUsd: z.number().min(0).max(10_000).optional(),
  dailyRequestsPerActor: z.number().int().min(0).max(10_000).optional(),
  liveAiEnabled: z.boolean().optional(),
});

/** Admin-configurable AI usage budget and limits. */
export const PATCH = route({}, async ({ req, actor }) => {
  const user = requirePermission(actor, "settings:manage");
  const body = await parseBody(req, PatchSchema);
  const before = getAiSettings();
  const settings = updateAiSettings(body);
  recordAudit({ userId: user.id, label: user.name }, "settings", "ai", "updated", before, settings);
  return { settings, monthToDateUsd: monthToDateSpendUsd() };
});
