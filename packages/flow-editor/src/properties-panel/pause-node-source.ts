import type { WorkflowNode } from "@journeyman/core";
import { HUMAN_TASK_RESERVED_KEYS, WEBHOOK_WAIT_RESERVED_KEYS, pauseNodeOutputSchema } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

/**
 * Build an UpstreamSource for a `human-task` or `webhook-wait` node. Returns
 * null for any other node type. Field shapes come from the shared core helper
 * `pauseNodeOutputSchema` so the picker and the flow validator never disagree.
 * The source always has a `System` group of reserved meta keys; an `Outputs`
 * group is only included when the node declares at least one output field.
 */
export function pauseNodeSource(node: WorkflowNode): UpstreamSource | null {
  const schema = pauseNodeOutputSchema(node);
  if (!schema) return null;

  const reserved = node.type === "human-task"
    ? HUMAN_TASK_RESERVED_KEYS
    : WEBHOOK_WAIT_RESERVED_KEYS;
  const defaultLabel = node.type === "human-task" ? "Human task" : "Webhook wait";
  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const groups: UpstreamSource["groups"] = [];

  const declaredFields = declared
    .filter((d) => d?.name)
    .map((d): UpstreamField => ({
      name: d.name,
      description: d.description,
      scope: "output",
      shape: schema[d.name],
    }));
  if (declaredFields.length > 0) {
    groups.push({ title: "Outputs", scope: "output", fields: declaredFields });
  }

  groups.push({
    title: "System",
    scope: "output",
    fields: reserved.map((name): UpstreamField => ({
      name,
      scope: "output",
      shape: schema[name],
    })),
  });

  return {
    kind: "node",
    id: node.id,
    label: node.displayName ?? defaultLabel,
    groups,
  };
}
