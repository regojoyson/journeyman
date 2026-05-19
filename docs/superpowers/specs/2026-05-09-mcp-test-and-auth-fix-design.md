# MCP Auth Header Fix + In-UI Connection Test

**Status:** Draft
**Date:** 2026-05-09
**Owner:** Samuel Rego

## Background

A user ran a custom phase ("Add comment on Ticket") with the GitHub MCP attached. The agent invoked `mcp__GitHub__authenticate`, the server reported *"does not support dynamic client registration"*, and the agent fell back to `gh` CLI which had no `GH_TOKEN`. The phase ended without action.

Investigation showed that PAT auth is configured correctly in the catalog (`AUTHORIZATION` env var bound to a secret, transmitted as a bearer header) but the SDK adapter has a bug: when the env var key is `AUTHORIZATION`, both header forms are written, and the raw value overwrites the bearer-formatted one due to HTTP header case-insensitivity. The remote server then sees an unprefixed token and exposes only its `authenticate` tool.

Separately, users have no way to verify that an MCP instance is configured correctly without running a full workflow. They learn about misconfiguration only when an agent fails mid-run.

## Goals

1. Fix the `Authorization` header bug so PAT-bound MCPs (GitHub, and any future bearer-auth MCP) reach the server with a valid header.
2. Provide a UI affordance on the MCP management pages to test an instance — including listing tools and invoking a chosen tool — so users can self-diagnose configuration before using the MCP in a workflow.

## Non-goals

- Persisting test history.
- Schema-driven argument form generation. Args are entered as raw JSON.
- Health-check-on-save or background polling. Test runs only on explicit user click.
- Surfacing test results in the flow editor.

## Architecture

Three deliverables:

### A. Header bug fix (`packages/mcp/src/sdk-adapter.ts`)

Current code:
```ts
for (const [k, v] of Object.entries(inst.env)) {
  if (k === "AUTHORIZATION") headers["Authorization"] = `Bearer ${v}`;
  headers[k] = v;   // always runs — collides with the line above
}
```

Fix:
```ts
for (const [k, v] of Object.entries(inst.env)) {
  if (k === "AUTHORIZATION") headers["Authorization"] = `Bearer ${v}`;
  else headers[k] = v;
}
```

Extract this loop into a named helper `buildHeaders(env)` exported from `sdk-adapter.ts` so the test runner (B) calls the same code. This guarantees test path == run path.

Add a unit test asserting:
- `buildHeaders({ AUTHORIZATION: "p" })` → `{ Authorization: "Bearer p" }` only
- `buildHeaders({ FOO: "bar" })` → `{ FOO: "bar" }`
- `buildHeaders({ AUTHORIZATION: "p", FOO: "bar" })` → `{ Authorization: "Bearer p", FOO: "bar" }`

### B. Backend test runner & route

**New file `packages/mcp/src/test-runner.ts`** exposing:

```ts
export type TestAction =
  | { kind: "list" }
  | { kind: "invoke"; tool: string; args: Record<string, unknown> };

export interface ToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type TestOutcome =
  | { ok: true; tools: ToolSummary[] }
  | { ok: true; result: unknown }
  | { ok: false; error: string; phase: "resolve" | "connect" | "list" | "invoke" };

export async function testMcpInstance(
  pool: Pool,
  ctx: { orgId: string; userId: string },
  instanceId: string,
  action: TestAction,
): Promise<TestOutcome>;
```

Behaviour:
1. Call `resolveMcpInstances(pool, ctx, [instanceId])`. Catch `MissingMcpInstancesError` / `MissingSecretsError` → `{ ok:false, phase:"resolve", error: <message naming missing items> }`. Secret *names* are echoed; secret *values* never are.
2. Build an MCP client using `@modelcontextprotocol/sdk`:
   - `transport === "stdio"` → `StdioClientTransport({ command, args, env })`
   - `transport === "sse"` → `SSEClientTransport(new URL(url), { headers: buildHeaders(env) })`
   - `transport === "http"` → `StreamableHTTPClientTransport(new URL(url), { headers: buildHeaders(env) })`
3. `await client.connect(transport)` — failures map to `phase:"connect"`.
4. For `kind:"list"`: `const { tools } = await client.listTools();` return `{ ok:true, tools }`. Failure → `phase:"list"`.
5. For `kind:"invoke"`: `const result = await client.callTool({ name: tool, arguments: args });` return `{ ok:true, result }`. Failure → `phase:"invoke"`.
6. Wrap the whole thing in a 30s `Promise.race` with a timeout. Timeout → `{ ok:false, error:"timed out after 30s", phase: <current> }`.
7. `finally` always closes the transport. Stdio child processes are killed if still alive.

**New file `packages/mcp/src/routes/test-mcp.ts`** registering:

```
POST /api/orgs/:orgId/mcp-instances/:id/test               (org-scope)
POST /api/orgs/:orgId/users/me/mcp-instances/:id/test      (user-scope)
```
These mirror the existing `mcp-instances` CRUD routes in `org-mcp.ts` / `user-mcp.ts`.

Handlers:
- Validate body shape (`zod` or hand-rolled, matching repo convention).
- Reuse the same scope/auth guard wrapper used by the existing `Edit`/`Delete` routes for these scopes.
- Call `testMcpInstance(...)` and return its outcome as JSON, always 200 (errors are domain results, not HTTP errors).

Register from `packages/mcp/src/routes/index.ts` alongside existing routes.

**Dependency:** add `@modelcontextprotocol/sdk` to `packages/mcp/package.json` if not already present.

### C. Frontend test modal

**API client additions in `packages/web/src/api/mcp.ts`:**
```ts
mcpApi.testList(orgId, scope, id): Promise<TestOutcome>
mcpApi.testInvoke(orgId, scope, id, tool, args): Promise<TestOutcome>
```
Where `scope` is `"user" | "org"` — the routes differ by scope as defined in B.

**New component `packages/web/src/components/mcp/TestMcpModal.tsx`.**
Props: `{ orgId, scope, mcp: McpInstance, onClose }`.

Internal state machine:
- `phase: "loading" | "list" | "invoking" | "result" | "error"`
- `tools: ToolSummary[]`
- `selectedTool: ToolSummary | null`
- `argsJson: string` (the textarea value)
- `lastResult: unknown | null`
- `lastError: { error, phase } | null`

Render:

**Loading** — spinner + `"Connecting to <name>…"`.

**List** — left pane: scrollable list of tool rows showing `name` (mono) and `description`. Above the list, if `tools.length === 1 && tools[0].name === "authenticate"`, show a yellow callout: *"Server returned only an `authenticate` tool. This usually means auth is missing or invalid — check the bound secret and required env."*

Selecting a tool reveals the right pane:

**Tool detail (right pane)** —
- Tool description.
- Required-keys-prefilled JSON skeleton in a `<textarea>` (mono, ~12 rows). On first selection of a tool, derive skeleton from `inputSchema.properties` filtered by `inputSchema.required`. Subsequent re-selections preserve user edits in a per-tool cache held in component state.
- Collapsed `<details>` showing the full `inputSchema` JSON for reference.
- "Invoke" button (primary). Click → `JSON.parse(argsJson)`; if parse fails, inline red text with the parser message and no request fired. Otherwise transition to `phase:"invoking"` and call `testInvoke`.

**Invoking** — overlay the right pane with a spinner.

**Result** — replaces the right pane:
- On success: pretty-printed JSON in a scrollable `<pre>` with copy-to-clipboard button. "Run again" button restores the args view with values preserved.
- On failure: red panel showing `phase: error`. "Run again" same as above.

**Error (any stage)** — red panel with `phase: error`, "Retry" button reruns `testList` from scratch.

Layout follows `EditMcpModal.tsx` conventions: full-screen overlay, centred panel, dark theme classes from `admin-styles.ts`. On stage 2/3 the modal widens to two-pane; on viewports under ~768px the panes stack.

Truncate displayed result to ~1MB with a "result truncated" notice and a download button that saves the full payload. The backend always returns the full payload; truncation is display-only.

**Wire-up in `MyMcpsPage.tsx` and `AdminMcpsPage.tsx`:** add a `Test` ghost button between `Edit` and `Delete`. Clicking sets local state `testing: McpInstance | null`. Render `<TestMcpModal scope={scope} ... onClose={() => setTesting(null)} />` when set.

## Data flow

```
User clicks Test
  → web POST .../instances/:id/test {action:"list"}
    → api-server route → testMcpInstance
      → resolveMcpInstances (DB → secret values)
      → buildHeaders(env) (shared with sdk-adapter)
      → MCP SDK client.connect → client.listTools
      → return tool list

User clicks a tool, edits JSON, clicks Invoke
  → web POST .../instances/:id/test {action:"invoke", tool, args}
    → api-server route → testMcpInstance
      → resolveMcpInstances + connect (fresh client per call)
      → client.callTool({name, arguments})
      → return result
```

Each call is fully isolated — no client reuse between calls, no shared state on the server.

## Errors & cleanup

- 30s hard timeout per test call, enforced by `Promise.race` against a timer.
- `finally` block closes the transport; for stdio, kill the child if alive.
- Concurrent tests on the same instance from the same user: no coordination, each gets its own client/process. No DB rows written for tests.
- Secret values are never returned to the client. `MissingSecretsError` returns the *names* of the missing secrets only.

## Testing

**Unit tests (`packages/mcp`):**
- `buildHeaders` — three cases listed in section A.
- `testMcpInstance` with a stub MCP client (mock `Client` and transports): list success, list failure, invoke success, invoke failure, timeout, transport cleanup called in finally. Resolver errors map to `phase:"resolve"`.

**Integration test:**
- One end-to-end call against an in-process stdio MCP server (the official `@modelcontextprotocol/server-everything` test server is suitable) confirming `tools/list` and a known tool call round-trip.

**Frontend:**
- Manual smoke test of the modal: list path, error path, tool selection, JSON validation error, invoke success/failure, "result truncated" path with a synthetic large response.

## Out of scope / follow-ups

- Schema-driven argument form (replaces JSON textarea).
- Save-time auto-test on `AddCustomModal` / `AddFromCatalogModal`.
- Test history pane.
- Org-wide MCP health dashboard.
