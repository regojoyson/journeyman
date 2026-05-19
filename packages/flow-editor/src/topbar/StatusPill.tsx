import type { WorkflowStatus } from "@journeyman/core";

export function StatusPill({ status }: { status: WorkflowStatus }): JSX.Element {
  const cls = status === "ready" ? "fe-status-pill fe-status-ready" : "fe-status-pill fe-status-draft";
  const label = status === "ready" ? "Ready" : "Draft";
  return <span className={cls} aria-label={`Flow status: ${label}`}>{label}</span>;
}
