import { api } from "./client.ts";

export async function deleteFlow(flowId: string): Promise<void> {
  await api(`/api/workflows/${encodeURIComponent(flowId)}`, { method: "DELETE" });
}
