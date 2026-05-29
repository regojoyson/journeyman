import type { WorkflowAttributeDef } from "@journeyman/core";

/**
 * Build the `attributes` sub-map seeded into the run's `workflow.input`
 * namespace from the workflow graph's design-time attribute defs. Bindings of
 * the form `workflow.attribute.x` resolve against `workflow.input.attributes.x`.
 */
export function buildAttributeInputs(
  defs: WorkflowAttributeDef[] | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs ?? []) {
    out[def.name] = def.value;
  }
  return out;
}
