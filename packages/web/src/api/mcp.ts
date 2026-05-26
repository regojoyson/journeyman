export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding { envVar: string; secretName: string }

export interface McpInstance {
  id: string;
  name: string;
  description: string | null;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  bindings: McpBinding[];
  systemPrompt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
  category?: string;
}

export interface PromotableRow {
  id: string;
  name: string;
  transport: McpTransport;
  ownerId: string;
  ownerEmail: string;
  /** Env-var names that need to be re-bound to org/global secrets on promote. */
  bindingEnvVars: string[];
  updatedAt: string;
}

export interface UpsertBody {
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  bindings: McpBinding[];
  systemPrompt?: string;
  enabled?: boolean;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/mcp-instances`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/mcp-instances`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error(body?.error ?? `HTTP ${r.status}`);
}

export const mcpApi = {
  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),

  listPromotable: (orgId: string) =>
    fetch(`${orgBase(orgId)}/promotable`, { credentials: "include" }).then(jsonOrThrow<PromotableRow[]>),

  catalog: () =>
    fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),

  createMy: (orgId: string, body: UpsertBody) =>
    fetch(userBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  createOrg: (orgId: string, body: UpsertBody) =>
    fetch(orgBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  updateMy: (orgId: string, id: string, body: Partial<UpsertBody>) =>
    fetch(`${userBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<{ ok: true }>),

  updateOrg: (orgId: string, id: string, body: Partial<UpsertBody>) =>
    fetch(`${orgBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<{ ok: true }>),

  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  promote: (orgId: string, userInstanceId: string, body: {
    name?: string; description?: string; systemPrompt?: string;
    bindings: McpBinding[]; enabled?: boolean;
  }) =>
    fetch(`${orgBase(orgId)}/${userInstanceId}/promote`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  testList: (orgId: string, scope: "user" | "org", id: string) =>
    fetch(testBase(orgId, scope, id), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    }).then(jsonOrThrow<TestOutcome>),

  testInvoke: (orgId: string, scope: "user" | "org", id: string, tool: string, args: Record<string, unknown>) =>
    fetch(testBase(orgId, scope, id), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invoke", tool, args }),
    }).then(jsonOrThrow<TestOutcome>),
};

// --- testing ---

export interface ToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type TestOutcome =
  | { ok: true; tools: ToolSummary[] }
  | { ok: true; result: unknown }
  | { ok: false; error: string; phase: "resolve" | "connect" | "list" | "invoke" };

const testBase = (orgId: string, scope: "user" | "org", id: string) =>
  scope === "user"
    ? `${userBase(orgId)}/${id}/test`
    : `${orgBase(orgId)}/${id}/test`;
