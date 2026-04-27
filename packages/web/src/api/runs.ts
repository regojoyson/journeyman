import type { NodeExecution, Run, RunEvent } from "@journeyman/core";
import { api } from "./client.ts";

export async function listRuns(filter: { status?: Run["status"]; flowId?: string; limit?: number } = {}): Promise<Run[]> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.flowId) qs.set("flow_id", filter.flowId);
  if (filter.limit) qs.set("limit", String(filter.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await api<{ runs: Run[] }>(`/runs${suffix}`);
  return res.runs;
}

export interface RunDetail {
  run: Run;
  executions: NodeExecution[];
  events: RunEvent[];
}

export async function getRun(runId: string): Promise<RunDetail> {
  return await api<RunDetail>(`/runs/${encodeURIComponent(runId)}`);
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:4000";

export function openRunEventStream(args: {
  runId: string;
  sinceId?: number;
  onEvent: (ev: RunEvent) => void;
  onError?: (e: Event) => void;
  onOpen?: () => void;
}): () => void {
  const url = `${baseUrl}/runs/${encodeURIComponent(args.runId)}/events${args.sinceId ? `?since=${args.sinceId}` : ""}`;
  const es = new EventSource(url);
  es.onopen = () => args.onOpen?.();
  es.onerror = (e) => args.onError?.(e);
  const types = [
    "phase.started", "phase.log", "phase.failed", "phase.retrying", "phase.completed",
    "node.cycled", "run.started", "run.completed", "run.failed", "run.cancelled",
  ];
  for (const t of types) {
    es.addEventListener(t, (raw) => {
      const data = (raw as MessageEvent).data;
      try { args.onEvent(JSON.parse(data) as RunEvent); }
      catch { /* ignore malformed */ }
    });
  }
  return () => es.close();
}
