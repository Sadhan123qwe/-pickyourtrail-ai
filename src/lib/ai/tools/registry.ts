import "server-only";
import { z, ZodError } from "zod";
import { ApiError, forbidden, notFound } from "@/lib/http";
import { recordAudit } from "@/lib/repos/audit";
import { getAiAction, insertAiAction, resolveAiAction, type AiAction, type RecordRef } from "@/lib/repos/ai-actions";
import { customerTools } from "./customer";
import { employeeTools } from "./employee";
import { ToolError, type ToolContext, type ToolDef } from "./types";

const TOOLS = new Map<string, ToolDef>([...employeeTools, ...customerTools].map((t) => [t.name, t as unknown as ToolDef]));
const APPROVAL_TTL_MS = 60 * 60 * 1000;

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.get(name);
}

/** Tools this actor may use, for prompting the model (it never sees tools it can't call). */
export function toolsFor(ctx: Pick<ToolContext, "actor">, audience: "employee" | "customer"): ToolDef[] {
  return [...TOOLS.values()].filter((t) => t.audience === audience && t.authorize(ctx.actor));
}

export function toolCatalog(tools: ToolDef[]): string {
  return tools
    .map((t) => {
      const shape = z.toJSONSchema(t.args, { unrepresentable: "any" }) as { properties?: Record<string, { type?: unknown; enum?: unknown[] }> };
      const params = Object.entries(shape.properties ?? {})
        .map(([k, v]) => `${k}${v.enum ? `: ${v.enum.join("|")}` : v.type ? `: ${String(v.type)}` : ""}`)
        .join(", ");
      return `- ${t.name}(${params})${t.kind === "write" ? " [WRITE — requires human approval]" : ""}: ${t.description}`;
    })
    .join("\n");
}

export interface ToolExecution {
  actionId: string | null;
  tool: string;
  kind: "read" | "write";
  status: "completed" | "proposed" | "failed";
  summary: string;
  records: RecordRef[];
  data?: unknown;
  description?: string;
  error?: string;
  expiresAt?: string | null;
}

function errorText(e: unknown): { code: string; message: string } {
  if (e instanceof ToolError) return { code: e.code, message: e.message };
  if (e instanceof ZodError) return { code: "invalid_arguments", message: e.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ") };
  if (e instanceof ApiError) return { code: e.code, message: e.message };
  if (e instanceof Error) return { code: "failed", message: e.message };
  return { code: "failed", message: "Unknown error" };
}

/**
 * Validates and executes one tool call. Reads (and the customer's own
 * reversible writes) run immediately. Confirmable writes are stored as
 * proposals and only run after `confirmAction`. Every call is logged.
 */
export async function executeTool(ctx: ToolContext, name: string, rawArgs: unknown, opts: { log?: boolean } = {}): Promise<ToolExecution> {
  const log = opts.log ?? true;
  const tool = getTool(name);
  const base = { source: ctx.source, conversationId: ctx.conversationId, actorUserId: ctx.actor.userId, actorKey: ctx.actor.key, tool: name };
  if (!tool) {
    return { actionId: null, tool: name, kind: "read", status: "failed", summary: `Unknown tool “${name}”.`, records: [], error: "unknown_tool" };
  }
  if (!tool.authorize(ctx.actor)) {
    // Denials are logged for audit but are not operational failures.
    const a = log ? insertAiAction({ ...base, kind: tool.kind, args: rawArgs, status: "rejected", summary: "Not authorized for this role", error: "forbidden" }) : null;
    return { actionId: a?.id ?? null, tool: name, kind: tool.kind, status: "failed", summary: `Your role doesn't have access to ${name.replace(/_/g, " ")}, so I didn't look it up.`, records: [], error: "forbidden" };
  }
  let args: unknown;
  try {
    args = tool.args.parse(rawArgs ?? {});
  } catch (e) {
    const err = errorText(e);
    const a = log ? insertAiAction({ ...base, kind: tool.kind, args: rawArgs, status: "failed", summary: "Invalid arguments", error: err.message }) : null;
    return { actionId: a?.id ?? null, tool: name, kind: tool.kind, status: "failed", summary: `Couldn't run ${name}: ${err.message}`, records: [], error: err.code };
  }

  if (tool.kind === "write" && tool.requiresConfirmation) {
    try {
      const { description, records } = tool.describe ? tool.describe(ctx, args) : { description: `Run ${name}`, records: [] };
      const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
      const a = insertAiAction({ ...base, kind: "write", args, status: "proposed", summary: description, records, requiresConfirmation: true, expiresAt });
      return { actionId: a.id, tool: name, kind: "write", status: "proposed", summary: description, description, records, expiresAt };
    } catch (e) {
      const err = errorText(e);
      const a = log ? insertAiAction({ ...base, kind: "write", args, status: "failed", summary: "Proposal rejected by validation", error: err.message }) : null;
      return { actionId: a?.id ?? null, tool: name, kind: "write", status: "failed", summary: err.message, records: [], error: err.code };
    }
  }

  try {
    const out = await tool.run(ctx, args);
    const a = log ? insertAiAction({ ...base, kind: tool.kind, args, status: "completed", summary: out.summary, records: out.records, result: tool.kind === "write" ? out.data ?? null : undefined }) : null;
    return { actionId: a?.id ?? null, tool: name, kind: tool.kind, status: "completed", summary: out.summary, records: out.records, data: out.data };
  } catch (e) {
    const err = errorText(e);
    const a = log ? insertAiAction({ ...base, kind: tool.kind, args, status: "failed", summary: `Failed: ${err.message}`, error: err.message }) : null;
    return { actionId: a?.id ?? null, tool: name, kind: tool.kind, status: "failed", summary: err.message, records: [], error: err.code };
  }
}

function loadOwnProposal(ctx: ToolContext, actionId: string): AiAction {
  const action = getAiAction(actionId);
  if (!action) throw notFound("Action not found");
  if (action.actorUserId !== ctx.actor.userId && ctx.actor.role !== "admin") throw forbidden("Only the employee who requested this action (or an admin) can decide on it");
  if (action.status === "expired") throw new ApiError(409, "expired", "This approval request has expired. Ask the AI to prepare it again.");
  if (action.status !== "proposed") throw new ApiError(409, "already_decided", `This action was already ${action.status}.`);
  return action;
}

/** Human approval: re-authorizes, re-validates and only then executes. */
export async function confirmAction(ctx: ToolContext, actionId: string): Promise<AiAction> {
  const action = loadOwnProposal(ctx, actionId);
  const tool = getTool(action.tool);
  if (!tool || !tool.authorize(ctx.actor)) throw forbidden("You're not authorized to perform this action");
  try {
    const args = tool.args.parse(action.args);
    const out = await tool.run(ctx, args);
    const done = resolveAiAction(action.id, { status: "completed", decidedBy: ctx.actor.userId, summary: out.summary, records: out.records, result: out.data ?? null, error: null });
    recordAudit({ userId: ctx.actor.userId, label: ctx.actor.user?.name ?? "Employee" }, "ai_action", action.id, "confirmed", { tool: action.tool }, { summary: out.summary });
    return done;
  } catch (e) {
    const err = errorText(e);
    const failed = resolveAiAction(action.id, { status: "failed", decidedBy: ctx.actor.userId, error: err.message });
    recordAudit({ userId: ctx.actor.userId, label: ctx.actor.user?.name ?? "Employee" }, "ai_action", action.id, "failed", { tool: action.tool }, { error: err.message });
    return failed;
  }
}

export function rejectAction(ctx: ToolContext, actionId: string): AiAction {
  const action = loadOwnProposal(ctx, actionId);
  const done = resolveAiAction(action.id, { status: "rejected", decidedBy: ctx.actor.userId });
  recordAudit({ userId: ctx.actor.userId, label: ctx.actor.user?.name ?? "Employee" }, "ai_action", action.id, "rejected", { tool: action.tool });
  return done;
}
