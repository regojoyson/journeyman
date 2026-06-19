import type { Workflow, WorkflowVersion, NodeExecution, WorkflowInstance, WorkflowInstanceEvent } from "@journeyman/core";
import type { PendingHumanTask, HumanTaskHistoryEntry } from "@journeyman/run-viewer";
import { api } from "./client.ts";

const wsBase = (wsId: string) => `/api/workspaces/${encodeURIComponent(wsId)}/workflow-instances`;

export async function listRuns(wsId: string, filter: {
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
  const res = await api<{ workflowInstances: WorkflowInstance[] }>(`${wsBase(wsId)}${suffix}`);
  return res.workflowInstances;
}

export interface PagedRuns {
  workflowInstances: WorkflowInstance[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listRunsPaged(wsId: string, args: {
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
  return await api<PagedRuns>(`${wsBase(wsId)}?${qs.toString()}`);
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

export async function getRun(wsId: string, workflowInstanceId: string): Promise<WorkflowInstanceDetail> {
  return await api<WorkflowInstanceDetail>(`${wsBase(wsId)}/${encodeURIComponent(workflowInstanceId)}`);
}

// Same-origin default; localhost dev value lives in packages/web/.env.development.
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export function openWorkflowInstanceEventStream(args: {
  wsId: string;
  runId: string;
  sinceId?: number;
  onEvent: (ev: WorkflowInstanceEvent) => void;
  onError?: (e: Event) => void;
  onOpen?: () => void;
}): () => void {
  const url = `${baseUrl}${wsBase(args.wsId)}/${encodeURIComponent(args.runId)}/events${args.sinceId ? `?since=${args.sinceId}` : ""}`;
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

export async function cancelRun(wsId: string, runId: string, reason?: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(runId)}/cancel`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

export async function pauseRun(wsId: string, runId: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(runId)}/pause`, { method: "POST", body: "{}" });
}

export async function resumeRun(wsId: string, runId: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(runId)}/resume`, { method: "POST", body: "{}" });
}

export async function retryStep(wsId: string, runId: string, nodeId: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(runId)}/retry-step`, {
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

export async function rerunRun(wsId: string, workflowInstanceId: string): Promise<{ workflowInstanceId: string; engineWorkflowId: string }> {
  return await api(`${wsBase(wsId)}/${encodeURIComponent(workflowInstanceId)}/rerun`, {
    method: "POST", body: "{}",
  });
}

export async function forkRun(wsId: string, workflowInstanceId: string, name?: string): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
  return await api(`${wsBase(wsId)}/${encodeURIComponent(workflowInstanceId)}/fork`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export function exportRunUrl(wsId: string, runId: string): string {
  return `${baseUrl}${wsBase(wsId)}/${encodeURIComponent(runId)}/export`;
}
