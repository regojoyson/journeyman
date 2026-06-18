import type { Connection, ConnectionCategory, RepoSummary } from "@journeyman/core";

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/connections`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/connections`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  const err = new Error((body as any)?.error ?? `HTTP ${r.status}`) as Error & { body?: unknown };
  err.body = body;
  throw err;
}

export interface CreateConnectionInput {
  scope: "user" | "org";
  category: ConnectionCategory;
  provider: string;
  label: string;
  baseUrl?: string;
  credential: string;
  config?: Record<string, unknown>;
}

const base = (orgId: string, scope: "user" | "org") => (scope === "user" ? userBase(orgId) : orgBase(orgId));

export const connectionsApi = {
  listMine: (orgId: string, category?: ConnectionCategory) =>
    fetch(`${userBase(orgId)}${category ? `?category=${category}` : ""}`, { credentials: "include" }).then(jsonOrThrow<Connection[]>),
  listOrg: (orgId: string, category?: ConnectionCategory) =>
    fetch(`${orgBase(orgId)}${category ? `?category=${category}` : ""}`, { credentials: "include" }).then(jsonOrThrow<Connection[]>),
  create: (orgId: string, body: CreateConnectionInput) =>
    fetch(base(orgId, body.scope), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<Connection>),
  remove: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  test: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/test`, { method: "POST", credentials: "include" }).then(
      jsonOrThrow<{ ok: boolean; repoCount?: number; error?: string; note?: string }>,
    ),
  repos: (orgId: string, id: string, search?: string) =>
    fetch(`${orgBase(orgId)}/${id}/repos${search ? `?search=${encodeURIComponent(search)}` : ""}`, {
      credentials: "include",
    }).then(jsonOrThrow<{ repos: RepoSummary[]; error?: string }>),
};
