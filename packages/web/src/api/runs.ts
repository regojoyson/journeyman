import type { Workflow, WorkflowVersion, NodeExecution, WorkflowInstance, WorkflowInstanceEvent } from "@journeyman/core";
import type { PendingHumanTask, HumanTaskHistoryEntry } from "@journeyman/run-viewer";
import { api } from "./client.ts";

export async function listRuns(filter: {
  status?: WorkflowInstance["status"];
  workflowId?: string;
  provider?: string;
  limit?: number;
} = {}): Promise<WorkflowInstance[]> {
  const qs = new URLSearchParams();
  if (filter.status)     qs.set("status",       filter.status);
  if (filter.workflowId) qs.set("workflow_id",  filter.workflowId);
  if (filter.provider)   qs.set("provider",     filter.provider);
  if (filter.limit)      qs.set("limit",        String(filter.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await api<{ workflowInstances: WorkflowInstance[] }>(`/api/workflow-instances${suffix}`);
  return res.workflowInstances;
}

export interface PagedRuns {
  workflowInstances: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listRunsPaged(args: {
  status?: WorkflowInstance["status"];
  workflowId?: string;
  provider?: string;
  page: number;
  pageSize: number;
}): Promise<PagedRuns> {
  const qs = new URLSearchParams();
  if (args.status)     qs.set("status",       args.status);
  if (args.workflowId) qs.set("workflow_id",  args.workflowId);
  if (args.provider)   qs.set("provider",     args.provider);
  qs.set("page",       String(args.page));
  qs.set("page_size",  String(args.pageSize));
  return await api<PagedRuns>(`/api/workflow-instances?${qs.toString()}`);
}

export type WebhookEventSummary = {
  id: string;
  provider: string;
  webhookName: string | null;
  eventType: string | null;
  deliveryId: string | null;
  receivedAt: string;
  rawPayload: unknown;
};

export interface WorkflowInstanceDetail {
  workflowInstance: WorkflowInstance;
  executions: NodeExecution[];
  events: WorkflowInstanceEvent[];
  webhookEvent: WebhookEventSummary | null;
  pendingHumanTask: PendingHumanTask | null;
  humanTaskHistory: HumanTaskHistoryEntry[];
}

export async function getRun(workflowInstanceId: string): Promise<WorkflowInstanceDetail> {
  return await api<WorkflowInstanceDetail>(`/api/workflow-instances/${encodeURIComponent(workflowInstanceId)}`);
}

// Same-origin default; localhost dev value lives in packages/web/.env.development.
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export function openWorkflowInstanceEventStream(args: {
  runId: string;
  sinceId?: number;
  onEvent: (ev: WorkflowInstanceEvent) => void;
  onError?: (e: Event) => void;
  onOpen?: () => void;
}): () => void {
  const url = `${baseUrl}/api/workflow-instances/${encodeURIComponent(args.runId)}/events${args.sinceId ? `?since=${args.sinceId}` : ""}`;
  const es = new EventSource(url, { withCredentials: true });
  es.onopen = () => args.onOpen?.();
  es.onerror = (e) => args.onError?.(e);
  const types = [
    "step.started", "step.log", "step.failed", "step.retrying", "step.completed",
    "node.cycled", "run.started", "run.completed", "run.failed", "run.cancelled",
  ];
  for (const t of types) {
    es.addEventListener(t, (raw) => {
      const data = (raw as MessageEvent).data;
      try { args.onEvent(JSON.parse(data) as WorkflowInstanceEvent); }
      catch { /* ignore malformed */ }
    });
  }
  return () => es.close();
}

export async function cancelRun(runId: string, reason?: string): Promise<void> {
  await api(`/api/workflow-instances/${encodeURIComponent(runId)}/cancel`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

export async function pauseRun(runId: string): Promise<void> {
  await api(`/api/workflow-instances/${encodeURIComponent(runId)}/pause`, { method: "POST", body: "{}" });
}

export async function resumeRun(runId: string): Promise<void> {
  await api(`/api/workflow-instances/${encodeURIComponent(runId)}/resume`, { method: "POST", body: "{}" });
}

export async function retryStep(runId: string, nodeId: string): Promise<void> {
  await api(`/api/workflow-instances/${encodeURIComponent(runId)}/retry-step`, {
    method: "POST", body: JSON.stringify({ node_id: nodeId }),
  });
}

export async function resolveHumanTask(runId: string, nodeId: string, body: {
  values?: Record<string, unknown>;
  comment?: string;
  data?: unknown;
}): Promise<void> {
  await api(
    `/api/workflow-instances/${encodeURIComponent(runId)}/human-tasks/${encodeURIComponent(nodeId)}/resolve`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function rerunRun(workflowInstanceId: string): Promise<{ workflowInstanceId: string; engineWorkflowId: string }> {
  return await api(`/api/workflow-instances/${encodeURIComponent(workflowInstanceId)}/rerun`, {
    method: "POST", body: "{}",
  });
}

export async function forkRun(workflowInstanceId: string, name?: string): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
  return await api(`/api/workflow-instances/${encodeURIComponent(workflowInstanceId)}/fork`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export function exportRunUrl(runId: string): string {
  return `${baseUrl}/api/workflow-instances/${encodeURIComponent(runId)}/export`;
}
