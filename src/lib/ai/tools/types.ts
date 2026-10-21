import type { z } from "zod";
import type { Actor } from "@/lib/http";
import type { RecordRef } from "@/lib/repos/ai-actions";

export type { RecordRef };

export interface ToolContext {
  actor: Actor;
  source: "command_center" | "planner" | "support";
  conversationId: string | null;
}

export interface ToolOutput {
  /** One-line, human-readable result. Never claims more than the backend did. */
  summary: string;
  /** Records the tool read or changed, shown to the user for transparency. */
  records: RecordRef[];
  /** Compact structured data for the answer composer and the UI. */
  data?: unknown;
}

/**
 * A validated business capability the AI may use. The model only ever picks a
 * tool name and arguments; validation, authorization and execution are
 * ordinary server code. Write tools that change business records or make
 * commitments require explicit human confirmation before they run.
 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  audience: "employee" | "customer";
  kind: "read" | "write";
  requiresConfirmation: boolean;
  args: S;
  /** Role/ownership check, evaluated on every call and again on confirmation. */
  authorize(actor: Actor): boolean;
  /** For confirmable writes: validates targets exist and describes exactly what will happen. */
  describe?(ctx: ToolContext, args: z.infer<S>): { description: string; records: RecordRef[] };
  run(ctx: ToolContext, args: z.infer<S>): ToolOutput | Promise<ToolOutput>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_tool" | "forbidden" | "invalid_arguments" | "not_found" | "failed" | "not_available",
  ) {
    super(message);
  }
}

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}
