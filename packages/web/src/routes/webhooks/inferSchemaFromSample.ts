type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Mirror of @journeyman/webhooks/inferSchema, rewritten here because that
 * package is backend-only. Produces a permissive JSON Schema (draft-07).
 */
export function inferSchemaFromSample(sample: unknown, maxDepth = 6): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...inferNode(sample as Json, maxDepth),
  };
}

function inferNode(value: Json, depth: number): Record<string, unknown> {
  if (depth <= 0) return {};
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "string") return { type: "string" };
  if (Array.isArray(value)) {
    const items = value.length === 0 ? {} : inferNode(value[0] as Json, depth - 1);
    return { type: "array", items };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    properties[k] = inferNode(v as Json, depth - 1);
    required.push(k);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}
