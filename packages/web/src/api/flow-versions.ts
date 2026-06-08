import type { WorkflowVersion } from "@journeyman/core";
import { api } from "./client.ts";

export async function getWorkflowVersionById(id: string): Promise<WorkflowVersion> {
  const res = await api<{ version: WorkflowVersion }>(`/api/workflow_versions/${encodeURIComponent(id)}`);
  return res.version;
}
