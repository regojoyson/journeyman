import type { Flow, FlowGraph, FlowVersion } from "@journeyman/core";
import { api, ApiError } from "./client.ts";

export async function listFlows(): Promise<Flow[]> {
  const res = await api<{ flows: Flow[] }>("/flows");
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

export async function createFlow(args: { name: string; description?: string; definition: FlowGraph }): Promise<{ flow: Flow; version: FlowVersion }> {
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
