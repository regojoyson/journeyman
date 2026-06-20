import type { Agent, AgentUpdateInput, OrgAgentSettings, AgentSafetyLimits } from "@journeyman/core";

const wsBase = (wsId: string) => `/api/workspaces/${wsId}/agents`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

export interface AgentRunSummary {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentRunEnriched {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  agentId: string;
  agentName: string;
  provider: string;
  model: string | null;
}

export interface AgentRunsPage {
  runs: AgentRunEnriched[];
  total: number;
  page: number;
  pageSize: number;
}

export const agentsApi = {
  list: (wsId: string) => fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<Agent[]>),
  get: (wsId: string, id: string) => fetch(`${wsBase(wsId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<Agent>),
  create: (wsId: string, body: { name: string }) =>
    fetch(wsBase(wsId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<Agent>),
  update: (wsId: string, id: string, patch: AgentUpdateInput) =>
    fetch(`${wsBase(wsId)}/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(jsonOrThrow<Agent>),
  enable: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/enable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  disable: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/disable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  runNow: (wsId: string, id: string, inputs: Record<string, unknown>) =>
    fetch(`${wsBase(wsId)}/${id}/runs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    }).then(jsonOrThrow<{ workflowInstanceId: string }>),
  runs: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/runs`, { credentials: "include" }).then(jsonOrThrow<AgentRunSummary[]>),
  listRuns: (
    wsId: string,
    opts: { status?: string; agentId?: string; trigger?: string; page?: number; pageSize?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.status)   q.set("status",   opts.status);
    if (opts.agentId)  q.set("agentId",  opts.agentId);
    if (opts.trigger)  q.set("trigger",  opts.trigger);
    q.set("page",     String(opts.page     ?? 1));
    q.set("pageSize", String(opts.pageSize ?? 20));
    return fetch(`/api/workspaces/${wsId}/agent-runs?${q.toString()}`, { credentials: "include" })
      .then(jsonOrThrow<AgentRunsPage>);
  },
  issueApiToken: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token`, { method: "POST", credentials: "include" }).then(
      jsonOrThrow<{ id: string; token: string }>,
    ),
  listApiTokens: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token`, { credentials: "include" }).then(
      jsonOrThrow<Array<{ id: string; name: string; last_used_at: string | null; created_at: string }>>,
    ),
  revokeApiToken: (wsId: string, id: string, tokenId: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token/${tokenId}`, { method: "DELETE", credentials: "include" }).then(
      jsonOrThrow<void>,
    ),
  getSettings: (orgId: string) =>
    fetch(`/api/orgs/${orgId}/agent-settings`, { credentials: "include" }).then(jsonOrThrow<OrgAgentSettings>),
  updateSettings: (orgId: string, patch: { paused?: boolean; limits?: AgentSafetyLimits }) =>
    fetch(`/api/orgs/${orgId}/agent-settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(jsonOrThrow<OrgAgentSettings>),
  audit: (orgId: string, opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return fetch(`/api/orgs/${orgId}/audit${qs ? `?${qs}` : ""}`, { credentials: "include" }).then(
      jsonOrThrow<AuditEntry[]>,
    );
  },
};

export interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}
