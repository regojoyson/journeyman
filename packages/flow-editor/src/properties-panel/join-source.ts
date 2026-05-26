import type { WorkflowNode, Shape, JoinMode } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

function field(name: string, shape: Shape): UpstreamField {
  return { name, scope: "output", shape };
}

/**
 * Build an UpstreamSource for a `join` node, exposing only the fields unique
 * to the Join. Branch outputs are referenceable directly by branch-node id,
 * so we don't surface them again here. Returns null for non-Join nodes and
 * for `fail-fast` joins (which contribute no Join-level fields).
 */
export function joinSource(node: WorkflowNode): UpstreamSource | null {
  if (node.type !== "join") return null;

  const cfg = (node.config ?? {}) as { mode?: JoinMode };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  if (mode === "fail-fast") return null;

  const fields: UpstreamField[] = [];
  if (mode === "first-wins") {
    fields.push(field("winner", { type: "string" } as Shape));
    fields.push(field("output", { type: "object", fields: {} } as Shape));
  }
  fields.push(field("results", { type: "object", fields: {} } as Shape));

  return {
    kind: "node",
    id: node.id,
    label: node.displayName ?? "Join",
    groups: [{ title: "Outputs", scope: "output", fields }],
  };
}
