export type ComputeTargetType =
  | "local" | "docker" | "machine-linux" | "machine-windows" | "ecs" | "ec2" | "kubernetes" | "cloud";
export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";
export type ComputeTargetScope = "user" | "org" | "system";

export interface ComputeTargetTypeDescriptor {
  type: ComputeTargetType;
  label: string;
  status: "available" | "planned";
  supportedModes: ExecutionMode[];
  supportedConnectivity: Connectivity[];
  summary: string;
}

export interface ConnectionTestResult { ok: boolean; error?: string }

export interface ComputeTarget {
  id: string;
  scope: ComputeTargetScope;
  name: string;
  type: ComputeTargetType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeTargetUpsertBody {
  name: string;
  type: ComputeTargetType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/compute-targets`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/compute-targets`;

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

export const computeTargetsApi = {
  listVisible: (orgId: string) =>
    fetch(`${orgBase(orgId)}/visible`, { credentials: "include" }).then(jsonOrThrow<ComputeTarget[]>),
  listTypes: (orgId: string) =>
    fetch(`${orgBase(orgId)}/types`, { credentials: "include" }).then(jsonOrThrow<ComputeTargetTypeDescriptor[]>),
  testConnection: (orgId: string, body: { type: ComputeTargetType; config: Record<string, unknown> }) =>
    postJson(`${orgBase(orgId)}/test-connection`, body).then(jsonOrThrow<ConnectionTestResult>),

  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<ComputeTarget[]>),
  createMy: (orgId: string, body: ComputeTargetUpsertBody) =>
    postJson(userBase(orgId), body).then(jsonOrThrow<ComputeTarget>),
  updateMy: (orgId: string, id: string, body: Partial<ComputeTargetUpsertBody>) =>
    patchJson(`${userBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<ComputeTarget[]>),
  createOrg: (orgId: string, body: ComputeTargetUpsertBody) =>
    postJson(orgBase(orgId), body).then(jsonOrThrow<ComputeTarget>),
  updateOrg: (orgId: string, id: string, body: Partial<ComputeTargetUpsertBody>) =>
    patchJson(`${orgBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
};
