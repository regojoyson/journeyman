import type { Workflow, WorkflowGraph, WorkflowSaveWarning, WorkflowVersion, PublishError } from "@journeyman/core";
import { api, ApiError } from "./client.ts";

export interface UnpublishWarning {
  inFlightRunCount: number;
  activeTriggers: { webhooks: number; schedules: number };
}

export async function publishFlow(
  workflowId: string,
): Promise<{ ok: true; workflow: Workflow; warnings: PublishError[] } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ workflow: Workflow; warnings?: PublishError[] }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/publish`,
      { method: "POST", body: "{}" },
    );
    return { ok: true, workflow: res.workflow, warnings: res.warnings ?? [] };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const body = e.body as { errors?: PublishError[] } | null;
      return { ok: false, errors: body?.errors ?? [] };
    }
    throw e;
  }
}

export async function unpublishFlow(
  workflowId: string,
  confirm: boolean,
): Promise<{ ok: true; workflow: Workflow } | { ok: false; warning: UnpublishWarning }> {
  try {
    const res = await api<{ workflow: Workflow }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/unpublish`,
      { method: "POST", body: JSON.stringify({ confirm }) },
    );
    return { ok: true, workflow: res.workflow };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = e.body as { warning?: UnpublishWarning } | null;
      if (body?.warning) return { ok: false, warning: body.warning };
    }
    throw e;
  }
}

export async function listFlows(): Promise<Workflow[]> {
  const res = await api<{ workflows: Workflow[] }>("/api/workflows");
  return res.workflows;
}

export interface PagedFlows {
  workflows: Workflow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFlowsPaged(args: {
  page: number;
  pageSize: number;
}): Promise<PagedFlows> {
  const params = new URLSearchParams();
  params.set("page", String(args.page));
  params.set("page_size", String(args.pageSize));
  return await api<PagedFlows>(`/api/workflows?${params.toString()}`);
}

export async function getFlow(id: string): Promise<Workflow | null> {
  try {
    const res = await api<{ workflow: Workflow }>(`/api/workflows/${encodeURIComponent(id)}`);
    return res.workflow;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function createFlow(args: {
  name: string;
  description?: string;
  definition: WorkflowGraph;
}): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
  return await api<{ workflow: Workflow; version: WorkflowVersion }>("/api/workflows", {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function updateFlowDefinition(workflowId: string, definition: WorkflowGraph): Promise<{ workflow: Workflow; version: WorkflowVersion | null }> {
  return await api<{ workflow: Workflow; version: WorkflowVersion | null }>(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

export async function updateFlowMeta(
  workflowId: string,
  meta: { name?: string; description?: string },
): Promise<{ workflow: Workflow; version: WorkflowVersion | null }> {
  return await api<{ workflow: Workflow; version: WorkflowVersion | null }>(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify(meta) },
  );
}

export async function runFlow(workflowId: string, inputs: Record<string, unknown>): Promise<{ workflowInstanceId: string; engineWorkflowId: string }> {
  return await api<{ workflowInstanceId: string; engineWorkflowId: string }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/workflow-instances`,
    { method: "POST", body: JSON.stringify({ inputs }) },
  );
}

export async function getCurrentWorkflowVersion(workflowId: string): Promise<WorkflowVersion> {
  const res = await api<{ version: WorkflowVersion }>(`/api/workflows/${encodeURIComponent(workflowId)}/versions/current`);
  return res.version;
}

export interface FlowValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings: WorkflowSaveWarning[];
}

export async function validateFlowDefinition(definition: WorkflowGraph): Promise<FlowValidationReport> {
  return await api<FlowValidationReport>(
    "/api/workflows/validate",
    { method: "POST", body: JSON.stringify({ definition }) },
  );
}
