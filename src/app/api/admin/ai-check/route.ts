import { requirePermission, route } from "@/lib/http";
import { runAiHealthCheck } from "@/lib/ai/health";
import { recordAudit } from "@/lib/repos/audit";

/** Admin-only: verifies the live OpenAI integration (makes a few small, billable requests). */
export const POST = route({ rateLimit: "ai" }, async ({ actor }) => {
  const user = requirePermission(actor, "settings:manage");
  const result = await runAiHealthCheck(`user:${user.id}`);
  recordAudit({ userId: user.id, label: user.name }, "ai_integration", "openai", "health_check", undefined, {
    results: result.checks.map((c) => `${c.name}: ${c.status}`),
  });
  return result;
});
