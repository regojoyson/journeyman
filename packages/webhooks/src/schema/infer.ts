type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type InferOptions = {
  /** Maximum object/array depth to descend. Defaults to 6. */
  maxDepth?: number;
};

/**
 * Infer a permissive JSON Schema (draft-07) from one or more samples.
 * `additionalProperties` defaults to true so future provider changes don't
 * break ingest validation when callers raise it to "reject".
 */
export function inferSchema(sample: Json, opts: InferOptions = {}): object {
  const maxDepth = opts.maxDepth ?? 6;
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...inferNode(sample, maxDepth),
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
  // object
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
