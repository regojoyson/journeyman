import type { WorkflowNode } from "../types/flow.types.ts";
import type { OutputSchema, Shape } from "../types/shape.types.ts";
import { WEBHOOK_WAIT_RESERVED_KEYS } from "../types/webhook-wait.types.ts";
import { HUMAN_TASK_RESERVED_KEYS } from "../types/human-task.types.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

function shapeForDeclared(t: DeclaredFieldType): Shape {
  if (t === "json") return { type: "object", fields: {} };
  if (t === "date") return { type: "string" };
  return { type: t };
}

function shapeForReserved(name: string): Shape {
  if (name === "payload") return { type: "object", fields: {} };
  return { type: "string" };
}

/**
 * The output schema a `webhook-wait` / `human-task` node exposes to downstream
 * refs: the user-declared `config.outputs` plus the always-present reserved
 * meta keys. Reserved keys are applied last so they win on a name clash, mirroring
 * the runtime artifact (`{ ...declared, source, resolvedAt, ... }`). Returns
 * `null` for any non-pause node.
 */
export function pauseNodeOutputSchema(node: WorkflowNode): OutputSchema | null {
  if (node.type !== "webhook-wait" && node.type !== "human-task") return null;

  const reserved =
    node.type === "webhook-wait" ? WEBHOOK_WAIT_RESERVED_KEYS : HUMAN_TASK_RESERVED_KEYS;
  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const schema: OutputSchema = {};
  for (const d of declared) {
    if (d?.name) schema[d.name] = shapeForDeclared(d.type);
  }
  for (const name of reserved) {
    schema[name] = shapeForReserved(name);
  }
  return schema;
}
