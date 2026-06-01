export type WorkerType =
  | "local" | "docker" | "machine-linux" | "machine-windows" | "ecs" | "ec2" | "kubernetes" | "cloud";
export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";
export type WorkerScope = "user" | "org" | "system";

export interface Worker {
  id: string;
  scope: WorkerScope;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerUpsertBody {
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/workers`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/workers`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error((body as { error?: string })?.error ?? `HTTP ${r.status}`);
}

const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const patchJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const workersApi = {
  listVisible: (orgId: string) =>
    fetch(`${orgBase(orgId)}/visible`, { credentials: "include" }).then(jsonOrThrow<Worker[]>),

  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<Worker[]>),
  createMy: (orgId: string, body: WorkerUpsertBody) =>
    postJson(userBase(orgId), body).then(jsonOrThrow<Worker>),
  updateMy: (orgId: string, id: string, body: Partial<WorkerUpsertBody>) =>
    patchJson(`${userBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<Worker[]>),
  createOrg: (orgId: string, body: WorkerUpsertBody) =>
    postJson(orgBase(orgId), body).then(jsonOrThrow<Worker>),
  updateOrg: (orgId: string, id: string, body: Partial<WorkerUpsertBody>) =>
    patchJson(`${orgBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
};
