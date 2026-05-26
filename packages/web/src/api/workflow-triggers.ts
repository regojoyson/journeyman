import { api } from "./client.ts";

export interface TriggerSummary {
  id: string;
  type: "trigger-manual" | "trigger-webhook" | "trigger-human";
  webhook?: { id: string; name: string } | null;
}

export async function getWorkflowTriggers(workflowId: string): Promise<TriggerSummary[]> {
  const res = await api<{ triggers: TriggerSummary[] }>(
    `/workflows/${encodeURIComponent(workflowId)}/triggers`,
  );
  return res.triggers;
}
