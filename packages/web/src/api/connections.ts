import type { Connection, ConnectionCategory, RepoSummary } from "@journeyman/core";

const wsBase = (wsId: string) => `/api/workspaces/${wsId}/connections`;

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
  category: ConnectionCategory;
  provider: string;
  label: string;
  baseUrl?: string;
  credential: string;
  config?: Record<string, unknown>;
}

export const connectionsApi = {
  list: (wsId: string, category?: ConnectionCategory) =>
    fetch(`${wsBase(wsId)}${category ? `?category=${category}` : ""}`, { credentials: "include" }).then(jsonOrThrow<Connection[]>),
  create: (wsId: string, body: CreateConnectionInput) =>
    fetch(wsBase(wsId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<Connection>),
  get: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<Connection>),
  update: (wsId: string, id: string, body: Partial<CreateConnectionInput>) =>
    fetch(`${wsBase(wsId)}/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<Connection>),
  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  test: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/test`, { method: "POST", credentials: "include" }).then(
      jsonOrThrow<{ ok: boolean; repoCount?: number; error?: string; note?: string }>,
    ),
  repos: (wsId: string, id: string, search?: string) =>
    fetch(`${wsBase(wsId)}/${id}/repos${search ? `?search=${encodeURIComponent(search)}` : ""}`, {
      credentials: "include",
    }).then(jsonOrThrow<{ repos: RepoSummary[]; error?: string }>),
};
