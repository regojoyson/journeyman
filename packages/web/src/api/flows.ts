import type { Flow, FlowGraph, FlowSaveWarning, FlowVersion, PublishError } from "@journeyman/core";
import { api, ApiError } from "./client.ts";

export interface UnpublishWarning {
  inFlightRunCount: number;
  activeTriggers: { webhooks: number; schedules: number };
}

export async function publishFlow(
  flowId: string,
): Promise<{ ok: true; flow: Flow } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ flow: Flow }>(
      `/flows/${encodeURIComponent(flowId)}/publish`,
      { method: "POST", body: "{}" },
    );
    return { ok: true, flow: res.flow };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const body = e.body as { errors?: PublishError[] } | null;
      return { ok: false, errors: body?.errors ?? [] };
    }
    throw e;
  }
}

/**
 * Unpublish flow. Returns the warning shape (with the flow still Ready) when
 * the server demands confirmation; returns the flipped flow when it succeeds.
 */
export async function unpublishFlow(
  flowId: string,
  confirm: boolean,
): Promise<{ ok: true; flow: Flow } | { ok: false; warning: UnpublishWarning }> {
  try {
    const res = await api<{ flow: Flow }>(
      `/flows/${encodeURIComponent(flowId)}/unpublish`,
      { method: "POST", body: JSON.stringify({ confirm }) },
    );
    return { ok: true, flow: res.flow };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = e.body as { warning?: UnpublishWarning } | null;
      if (body?.warning) return { ok: false, warning: body.warning };
    }
    throw e;
  }
}

export async function listFlows(
  filter?: { scope?: "user" | "org" | "global"; orgId?: string },
): Promise<Flow[]> {
  const params = new URLSearchParams();
  if (filter?.scope) params.set("scope", filter.scope);
  if (filter?.orgId) params.set("orgId", filter.orgId);
  const qs = params.toString();
  const res = await api<{ flows: Flow[] }>(`/flows${qs ? `?${qs}` : ""}`);
  return res.flows;
}

export async function getFlow(id: string): Promise<Flow | null> {
  try {
    const res = await api<{ flow: Flow }>(`/flows/${encodeURIComponent(id)}`);
    return res.flow;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function createFlow(args: {
  scope: "user" | "org" | "global";
  orgId?: string;
  name: string;
  description?: string;
  definition: FlowGraph;
}): Promise<{ flow: Flow; version: FlowVersion }> {
  return await api<{ flow: Flow; version: FlowVersion }>("/flows", {
    method: "POST", body: JSON.stringify(args),
  });
}

export async function updateFlowDefinition(flowId: string, definition: FlowGraph): Promise<{ flow: Flow; version: FlowVersion | null }> {
  return await api<{ flow: Flow; version: FlowVersion | null }>(
    `/flows/${encodeURIComponent(flowId)}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

export async function updateFlowMeta(
  flowId: string,
  meta: { name?: string; description?: string },
): Promise<{ flow: Flow; version: FlowVersion | null }> {
  return await api<{ flow: Flow; version: FlowVersion | null }>(
    `/flows/${encodeURIComponent(flowId)}`,
    { method: "PUT", body: JSON.stringify(meta) },
  );
}

export async function runFlow(flowId: string, inputs: Record<string, unknown>): Promise<{ runId: string; engineWorkflowId: string }> {
  return await api<{ runId: string; engineWorkflowId: string }>(
    `/flows/${encodeURIComponent(flowId)}/runs`,
    { method: "POST", body: JSON.stringify({ inputs }) },
  );
}

export async function getCurrentFlowVersion(flowId: string): Promise<FlowVersion> {
  const res = await api<{ version: FlowVersion }>(`/flows/${encodeURIComponent(flowId)}/versions/current`);
  return res.version;
}

export interface FlowValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings: FlowSaveWarning[];
}

/** Non-destructive validation. Returns the full report; never throws on validation issues. */
export async function validateFlowDefinition(definition: FlowGraph): Promise<FlowValidationReport> {
  return await api<FlowValidationReport>(
    "/flows/validate",
    { method: "POST", body: JSON.stringify({ definition }) },
  );
}
