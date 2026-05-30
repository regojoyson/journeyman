import type { WorkflowNode } from "../types/flow.types.ts";
import type { OutputSchema, Shape } from "../types/shape.types.ts";
import { type JoinMode, DEFAULT_JOIN_MODE } from "../types/parallel.types.ts";

/**
 * The output schema a `join` node exposes to downstream refs, by mode — mirrors
 * the runtime `JoinNodeOutput` artifact:
 *   - `fail-fast`            → no join-level fields (returns null; reference the
 *                              branch nodes directly instead).
 *   - `wait-all` / `-strict` → `{ results }` keyed by branch head id.
 *   - `first-wins`           → `{ winner, output, results }`.
 * Lets the ref-shape validator resolve `join.output.*` refs instead of
 * rejecting the join as "not a step". `json` payloads use the
 * `{ type: "object", fields: {} }` convention shared with pause-node outputs.
 * Returns `null` for any non-join node.
 */
export function joinNodeOutputSchema(node: WorkflowNode): OutputSchema | null {
  if (node.type !== "join") return null;
  const mode: JoinMode = ((node.config ?? {}) as { mode?: JoinMode }).mode ?? DEFAULT_JOIN_MODE;
  if (mode === "fail-fast") return null;

  const jsonObject: Shape = { type: "object", fields: {} };
  if (mode === "first-wins") {
    return { winner: { type: "string" }, output: jsonObject, results: jsonObject };
  }
  // wait-all / wait-all-strict
  return { results: jsonObject };
}
