export type SandboxType =
  | "local" | "docker" | "machine-linux" | "machine-windows" | "ecs" | "ec2" | "kubernetes" | "cloud";
export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";
export type SandboxScope = "org" | "system";

export interface SandboxTypeDescriptor {
  type: SandboxType;
  label: string;
  status: "available" | "planned";
  supportedModes: ExecutionMode[];
  supportedConnectivity: Connectivity[];
  summary: string;
}

export interface ConnectionTestResult { ok: boolean; error?: string }

export type ImageState = "none" | "pending" | "building" | "ready" | "failed";

export interface Sandbox {
  id: string;
  scope: SandboxScope;
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  imageState?: ImageState;
  imageRef?: string | null;
  imageError?: string | null;
}

export interface SandboxUpsertBody {
  name: string;
  type: SandboxType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  tags?: string[];
  enabled?: boolean;
}

const orgBase = (orgId: string) => `/api/orgs/${orgId}/sandboxes`;

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

export const sandboxesApi = {
  listVisible: (orgId: string) =>
    fetch(`${orgBase(orgId)}/visible`, { credentials: "include" }).then(jsonOrThrow<Sandbox[]>),
  listTypes: (orgId: string) =>
    fetch(`${orgBase(orgId)}/types`, { credentials: "include" }).then(jsonOrThrow<SandboxTypeDescriptor[]>),
  testConnection: (orgId: string, body: { type: SandboxType; config: Record<string, unknown> }) =>
    postJson(`${orgBase(orgId)}/test-connection`, body).then(jsonOrThrow<ConnectionTestResult>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<Sandbox[]>),
  createOrg: (orgId: string, body: SandboxUpsertBody) =>
    postJson(orgBase(orgId), body).then(jsonOrThrow<Sandbox>),
  updateOrg: (orgId: string, id: string, body: Partial<SandboxUpsertBody>) =>
    patchJson(`${orgBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  rebuildOrg: (orgId: string, id: string) =>
    postJson(`${orgBase(orgId)}/${id}/rebuild`, {}).then(jsonOrThrow<{ ok: true }>),
  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
};
