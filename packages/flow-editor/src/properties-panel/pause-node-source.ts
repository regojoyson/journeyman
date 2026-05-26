import type { WorkflowNode, Shape } from "@journeyman/core";
import { HUMAN_TASK_RESERVED_KEYS, WEBHOOK_WAIT_RESERVED_KEYS } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

type DeclaredFieldType = "string" | "number" | "boolean" | "json" | "date";

interface DeclaredOutput {
  name: string;
  type: DeclaredFieldType;
  description?: string;
}

function shapeForDeclared(t: DeclaredFieldType): Shape {
  if (t === "json") return { type: "object", fields: {} } as Shape;
  if (t === "date") return { type: "string" } as Shape;
  return { type: t } as Shape;
}

function shapeForReserved(name: string): Shape {
  if (name === "payload") return { type: "object", fields: {} } as Shape;
  return { type: "string" } as Shape;
}

/**
 * Build an UpstreamSource for a `human-task` or `webhook-wait` node. Returns
 * null for any other node type. The source always has a `System` group of
 * reserved meta keys; an `Outputs` group is only included when the node
 * declares at least one output field in `config.outputs`.
 */
export function pauseNodeSource(node: WorkflowNode): UpstreamSource | null {
  if (node.type !== "human-task" && node.type !== "webhook-wait") return null;

  const reserved = node.type === "human-task"
    ? HUMAN_TASK_RESERVED_KEYS
    : WEBHOOK_WAIT_RESERVED_KEYS;
  const defaultLabel = node.type === "human-task" ? "Human task" : "Webhook wait";

  const declared = ((node.config ?? {}) as { outputs?: DeclaredOutput[] }).outputs ?? [];

  const groups: UpstreamSource["groups"] = [];
  if (declared.length > 0) {
    groups.push({
      title: "Outputs",
      scope: "output",
      fields: declared.map((d): UpstreamField => ({
        name: d.name,
        description: d.description,
        scope: "output",
        shape: shapeForDeclared(d.type),
      })),
    });
  }
  groups.push({
    title: "System",
    scope: "output",
    fields: reserved.map((name): UpstreamField => ({
      name,
      scope: "output",
      shape: shapeForReserved(name),
    })),
  });

  return {
    kind: "node",
    id: node.id,
    label: node.displayName ?? defaultLabel,
    groups,
  };
}
