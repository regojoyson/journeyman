import type { FlowVersion } from "@journeyman/core";
import { api } from "./client.ts";

export async function getFlowVersionById(id: string): Promise<FlowVersion> {
  const res = await api<{ version: FlowVersion }>(`/flow_versions/${encodeURIComponent(id)}`);
  return res.version;
}
