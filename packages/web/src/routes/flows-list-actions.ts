import type { WorkflowStatus } from "@journeyman/core";

/**
 * Whether the per-row Run action should appear in the workflow list.
 * Run is meaningful only for published workflows, and the run route
 * requires resource.write — so it shows only to editors of a ready flow.
 */
export function runActionVisible(editable: boolean, status: WorkflowStatus): boolean {
  return editable && status === "ready";
}
