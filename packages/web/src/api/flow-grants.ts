import { api } from "./client.ts";

export async function cloneFlow(flowId: string, name?: string): Promise<{ id: string }> {
  return await api<{ id: string }>(`/api/workflows/${encodeURIComponent(flowId)}/clone`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export async function promoteFlow(flowId: string, args: {
  targetScope: "org" | "global"; orgId?: string; name?: string;
}): Promise<{ id: string }> {
  return await api<{ id: string }>(`/api/workflows/${encodeURIComponent(flowId)}/promote`, {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function deleteFlow(flowId: string): Promise<void> {
  await api(`/api/workflows/${encodeURIComponent(flowId)}`, { method: "DELETE" });
}
