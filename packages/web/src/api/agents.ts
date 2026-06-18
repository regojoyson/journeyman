import type { Agent, AgentUpdateInput, OrgAgentSettings, AgentSafetyLimits } from "@journeyman/core";

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/agents`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/agents`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

const base = (orgId: string, scope: "user" | "org") => (scope === "user" ? userBase(orgId) : orgBase(orgId));

export interface AgentRunSummary {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export const agentsApi = {
  listMine: (orgId: string) => fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<Agent[]>),
  listOrg: (orgId: string) => fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<Agent[]>),
  get: (orgId: string, id: string) => fetch(`${orgBase(orgId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<Agent>),
  create: (orgId: string, body: { scope: "user" | "org"; name: string }) =>
    fetch(base(orgId, body.scope), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<Agent>),
  update: (orgId: string, id: string, patch: AgentUpdateInput) =>
    fetch(`${orgBase(orgId)}/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(jsonOrThrow<Agent>),
  enable: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/enable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  disable: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/disable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  remove: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  runNow: (orgId: string, id: string, inputs: Record<string, unknown>) =>
    fetch(`${orgBase(orgId)}/${id}/runs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    }).then(jsonOrThrow<{ workflowInstanceId: string }>),
  runs: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/runs`, { credentials: "include" }).then(jsonOrThrow<AgentRunSummary[]>),
  issueApiToken: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/triggers/api-token`, { method: "POST", credentials: "include" }).then(
      jsonOrThrow<{ id: string; token: string }>,
    ),
  listApiTokens: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/triggers/api-token`, { credentials: "include" }).then(
      jsonOrThrow<Array<{ id: string; name: string; last_used_at: string | null; created_at: string }>>,
    ),
  revokeApiToken: (orgId: string, id: string, tokenId: string) =>
    fetch(`${orgBase(orgId)}/${id}/triggers/api-token/${tokenId}`, { method: "DELETE", credentials: "include" }).then(
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
