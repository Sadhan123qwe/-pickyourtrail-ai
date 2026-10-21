import { z } from "zod";

type JsonSchema = Record<string, unknown>;

// Keywords dropped from the provider schema; Zod still enforces them after parsing.
const STRIP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "default"]);

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node as JsonSchema)) {
    if (STRIP.has(k)) continue;
    out[k] = normalize(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties as JsonSchema);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Converts a Zod schema into a JSON schema accepted by strict structured
 * outputs: every property required, no additional properties, and no
 * validation keywords the provider may reject.
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  return normalize(z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" })) as JsonSchema;
}
