import type { Workflow, WorkflowGraph, WorkflowSaveWarning, WorkflowVersion, PublishError, WorkflowVersionSummary } from "@journeyman/core";
import { api, ApiError } from "./client.ts";

export type { WorkflowVersionSummary } from "@journeyman/core";

const wsBase = (wsId: string) => `/api/workspaces/${encodeURIComponent(wsId)}/workflows`;

export interface UnpublishWarning {
  inFlightRunCount: number;
  activeTriggers: { webhooks: number; schedules: number };
}

export async function promoteFlow(
  wsId: string,
  workflowId: string,
): Promise<{ ok: true; workflow: Workflow; warnings: PublishError[] } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ workflow: Workflow; warnings?: PublishError[] }>(
      `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/promote`,
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

export async function rollbackFlow(
  wsId: string,
  workflowId: string,
  versionId: string,
): Promise<{ ok: true; workflow: Workflow } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ workflow: Workflow }>(
      `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/rollback`,
      { method: "POST", body: JSON.stringify({ versionId }) },
    );
    return { ok: true, workflow: res.workflow };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const body = e.body as { errors?: PublishError[] } | null;
      return { ok: false, errors: body?.errors ?? [] };
    }
    throw e;
  }
}

export async function listWorkflowVersions(wsId: string, workflowId: string): Promise<WorkflowVersionSummary[]> {
  const res = await api<{ versions: WorkflowVersionSummary[] }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/versions`,
  );
  return res.versions;
}

export async function unpublishFlow(
  wsId: string,
  workflowId: string,
  confirm: boolean,
): Promise<{ ok: true; workflow: Workflow } | { ok: false; warning: UnpublishWarning }> {
  try {
    const res = await api<{ workflow: Workflow }>(
      `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/unpublish`,
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

export async function listFlows(wsId: string): Promise<Workflow[]> {
  const res = await api<{ workflows: Workflow[] }>(wsBase(wsId));
  return res.workflows;
}

export interface PagedFlows {
  workflows: Workflow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listFlowsPaged(wsId: string, args: {
  page: number;
  pageSize: number;
}): Promise<PagedFlows> {
  const params = new URLSearchParams();
  params.set("page", String(args.page));
  params.set("page_size", String(args.pageSize));
  return await api<PagedFlows>(`${wsBase(wsId)}?${params.toString()}`);
}

export async function getFlow(wsId: string, id: string): Promise<Workflow | null> {
  try {
    const res = await api<{ workflow: Workflow }>(`${wsBase(wsId)}/${encodeURIComponent(id)}`);
    return res.workflow;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function createFlow(wsId: string, args: {
  name: string;
  description?: string;
  definition: WorkflowGraph;
}): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(wsBase(wsId), {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function updateFlowDefinition(wsId: string, workflowId: string, definition: WorkflowGraph): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

export async function updateFlowMeta(
  wsId: string,
  workflowId: string,
  meta: { name?: string; description?: string },
): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify(meta) },
  );
}

export async function runFlow(wsId: string, workflowId: string, inputs: Record<string, unknown>): Promise<{ workflowInstanceId: string; engineWorkflowId: string }> {
  return await api<{ workflowInstanceId: string; engineWorkflowId: string }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/workflow-instances`,
    { method: "POST", body: JSON.stringify({ inputs }) },
  );
}

export async function getCurrentWorkflowVersion(wsId: string, workflowId: string): Promise<WorkflowVersion> {
  const res = await api<{ version: WorkflowVersion }>(`${wsBase(wsId)}/${encodeURIComponent(workflowId)}/versions/current`);
  return res.version;
}

export interface FlowValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings: WorkflowSaveWarning[];
}

export async function validateFlowDefinition(wsId: string, definition: WorkflowGraph): Promise<FlowValidationReport> {
  return await api<FlowValidationReport>(
    `${wsBase(wsId)}/validate`,
    { method: "POST", body: JSON.stringify({ definition }) },
  );
}

export async function deleteFlow(wsId: string, id: string): Promise<void> {
  await api(`${wsBase(wsId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
