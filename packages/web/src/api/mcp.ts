import type { McpCatalogEntry } from "@journeyman/flow-editor";

export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding { envVar: string; secretName: string }

export interface McpInstance {
  id: string;
  scope: "workspace" | "global";
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

export type CatalogEntry = McpCatalogEntry;

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

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

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

const wsBase = (wsId: string) => `/api/workspaces/${wsId}/mcp-instances`;

export const mcpApi = {
  list: (wsId: string) =>
    fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),

  create: (wsId: string, body: UpsertBody) =>
    fetch(wsBase(wsId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  update: (wsId: string, id: string, body: Partial<UpsertBody>) =>
    fetch(`${wsBase(wsId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<McpInstance>),

  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<void>),

  test: (wsId: string, id: string, body: { action: "list" } | { action: "invoke"; tool: string; args: Record<string, unknown> }) =>
    fetch(`${wsBase(wsId)}/${id}/test`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<TestOutcome>),

  listCatalog: () =>
    fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),

  // Aliases used by some components that expect testList/testInvoke shape
  testList: (wsId: string, _scope: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/test`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    }).then(jsonOrThrow<TestOutcome>),

  testInvoke: (wsId: string, _scope: string, id: string, tool: string, args: Record<string, unknown>) =>
    fetch(`${wsBase(wsId)}/${id}/test`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invoke", tool, args }),
    }).then(jsonOrThrow<TestOutcome>),
};
