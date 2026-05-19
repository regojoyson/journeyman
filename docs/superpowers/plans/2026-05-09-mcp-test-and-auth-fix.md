# MCP Auth Header Fix + In-UI Connection Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `Authorization` header collision in the MCP SDK adapter so PAT-bound MCP servers (GitHub etc.) authenticate correctly, and add a "Test" button on each MCP row that connects to the server, lists tools, and lets the user invoke a chosen tool with custom JSON args.

**Architecture:** A pure helper `buildHeaders(env)` is extracted from `sdk-adapter.ts` and shared with a new server-side `testMcpInstance` runner that mounts under existing `/api/orgs/:orgId/mcp-instances/:id/test` (org) and `/api/orgs/:orgId/users/me/mcp-instances/:id/test` (user) routes. Each test call resolves secrets through the existing resolver, opens a fresh `@modelcontextprotocol/sdk` client, runs `listTools` or `callTool`, and tears down. A new `TestMcpModal` on the web side drives a connect → pick tool → invoke flow.

**Tech Stack:** TypeScript, Fastify, `@modelcontextprotocol/sdk` (new dep on `@journeyman/mcp`), pg, React, Tailwind, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-09-mcp-test-and-auth-fix-design.md](../specs/2026-05-09-mcp-test-and-auth-fix-design.md)

---

## File map

- **Modify** `packages/mcp/src/sdk-adapter.ts` — extract `buildHeaders`, fix the `else` branch.
- **Create** `packages/mcp/src/sdk-adapter.test.ts` — unit tests for `buildHeaders`.
- **Create** `packages/mcp/src/test-runner.ts` — `testMcpInstance` function, talks to MCP SDK.
- **Create** `packages/mcp/src/test-runner.test.ts` — unit tests with a mocked `Client`.
- **Create** `packages/mcp/src/routes/test-mcp.ts` — Fastify routes for org and user scope.
- **Modify** `packages/mcp/src/routes/index.ts` — register the new routes.
- **Modify** `packages/mcp/package.json` — add `@modelcontextprotocol/sdk`, add `vitest` devDep, add `test` script.
- **Modify** `packages/web/src/api/mcp.ts` — add `testList` and `testInvoke` client methods plus shared types.
- **Create** `packages/web/src/components/mcp/TestMcpModal.tsx` — modal component.
- **Modify** `packages/web/src/routes/MyMcpsPage.tsx` — Test button + modal wiring.
- **Modify** `packages/web/src/routes/AdminMcpsPage.tsx` — same as above (org scope).

---

## Task 1: Extract `buildHeaders`, fix the auth bug, test it

**Files:**
- Modify: `packages/mcp/src/sdk-adapter.ts`
- Create: `packages/mcp/src/sdk-adapter.test.ts`
- Modify: `packages/mcp/package.json`

- [ ] **Step 1: Add vitest devDep + test script to `packages/mcp/package.json`**

Update the `scripts` and `devDependencies` blocks so they read:

```json
"scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
"devDependencies": {
  "@types/node": "^25.6.0",
  "typescript": "^6.0.3",
  "vitest": "^2.1.9"
}
```

Then run from repo root: `npm install`. Expected: completes without error.

- [ ] **Step 2: Write failing tests for `buildHeaders`**

Create `packages/mcp/src/sdk-adapter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHeaders } from "./sdk-adapter.ts";

describe("buildHeaders", () => {
  it("converts AUTHORIZATION to a Bearer header and does not leak the raw key", () => {
    const headers = buildHeaders({ AUTHORIZATION: "ghp_token" });
    expect(headers).toEqual({ Authorization: "Bearer ghp_token" });
    expect(headers).not.toHaveProperty("AUTHORIZATION");
  });

  it("passes other env keys through unchanged", () => {
    const headers = buildHeaders({ FOO: "bar" });
    expect(headers).toEqual({ FOO: "bar" });
  });

  it("handles AUTHORIZATION alongside other keys", () => {
    const headers = buildHeaders({ AUTHORIZATION: "p", FOO: "bar" });
    expect(headers).toEqual({ Authorization: "Bearer p", FOO: "bar" });
  });

  it("returns an empty object for empty env", () => {
    expect(buildHeaders({})).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -w @journeyman/mcp`
Expected: FAIL — `buildHeaders` is not exported.

- [ ] **Step 4: Refactor `sdk-adapter.ts` to export `buildHeaders` with the bug fixed**

Replace the body of `buildConfig` and add `buildHeaders`. The full new file is:

```ts
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedMcpInstance } from "@journeyman/core";

/**
 * Convert resolved MCP instances into the SDK's mcpServers shape.
 *
 * The SDK keys the map by a server name. We use `instance.name`. If two
 * instances share the same name (one user-scope and one org-scope, allowed by
 * the unique-per-scope DB constraint), the second occurrence is suffixed.
 */
export function toMcpServerConfigs(
  resolved: ResolvedMcpInstance[],
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const seen = new Map<string, number>();
  for (const inst of resolved) {
    const baseCount = seen.get(inst.name) ?? 0;
    const key = baseCount === 0 ? inst.name : `${inst.name}_${baseCount + 1}`;
    seen.set(inst.name, baseCount + 1);
    out[key] = buildConfig(inst);
  }
  return out;
}

/**
 * Convert a resolved instance's env map into HTTP headers.
 *
 * Special-cases `AUTHORIZATION` → `Authorization: Bearer <value>`. Any other
 * env key is copied to the headers verbatim. We deliberately do NOT also
 * write the original `AUTHORIZATION` key — HTTP header names are
 * case-insensitive, and writing both caused the raw token to overwrite the
 * Bearer-formatted one in the underlying fetch Headers object.
 */
export function buildHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "AUTHORIZATION") headers["Authorization"] = `Bearer ${v}`;
    else headers[k] = v;
  }
  return headers;
}

function buildConfig(inst: ResolvedMcpInstance): McpServerConfig {
  if (inst.transport === "stdio") {
    return {
      type: "stdio",
      command: inst.command!,
      args: inst.args ?? [],
      env: inst.env,
    };
  }
  const headers = buildHeaders(inst.env);
  if (inst.transport === "sse") {
    return { type: "sse", url: inst.url!, headers };
  }
  return { type: "http", url: inst.url!, headers };
}

/**
 * Concatenate non-empty system prompts with `\n\n`. Returns "" if none.
 */
export function mergeSystemPrompts(resolved: ResolvedMcpInstance[]): string {
  return resolved
    .map((i) => (i.systemPrompt ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @journeyman/mcp`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck -w @journeyman/mcp`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp/src/sdk-adapter.ts packages/mcp/src/sdk-adapter.test.ts packages/mcp/package.json package-lock.json
git commit -m "fix(mcp): preserve Bearer header by not double-writing AUTHORIZATION env"
```

---

## Task 2: Add `@modelcontextprotocol/sdk` dependency

**Files:**
- Modify: `packages/mcp/package.json`

- [ ] **Step 1: Add the SDK as a dependency**

Edit `packages/mcp/package.json`'s `dependencies` block to add:

```json
"@modelcontextprotocol/sdk": "^1.0.4"
```

So the full `dependencies` block becomes:
```json
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "*",
  "@journeyman/core": "*",
  "@journeyman/identity": "*",
  "@journeyman/secrets": "*",
  "@modelcontextprotocol/sdk": "^1.0.4",
  "pg": "^8.13.0"
}
```

- [ ] **Step 2: Install**

Run from repo root: `npm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Verify typecheck still passes**

Run: `npm run typecheck -w @journeyman/mcp`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/package.json package-lock.json
git commit -m "chore(mcp): add @modelcontextprotocol/sdk dependency"
```

---

## Task 3: Implement `testMcpInstance` runner with mocked-client tests

**Files:**
- Create: `packages/mcp/src/test-runner.ts`
- Create: `packages/mcp/src/test-runner.test.ts`

- [ ] **Step 1: Write failing tests for `testMcpInstance`**

Create `packages/mcp/src/test-runner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MissingMcpInstancesError, MissingSecretsError } from "@journeyman/core";

const mockResolve = vi.fn();
vi.mock("./resolver.ts", () => ({
  resolveMcpInstances: (...args: any[]) => mockResolve(...args),
}));

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

const { testMcpInstance } = await import("./test-runner.ts");

const fakePool: any = {};
const ctx = { orgId: "org-1", userId: "user-1" };
const httpInstance = {
  id: "inst-1",
  name: "GitHub",
  transport: "http" as const,
  url: "https://api.githubcopilot.com/mcp/",
  env: { AUTHORIZATION: "ghp_x" },
  systemPrompt: null,
};

beforeEach(() => {
  mockResolve.mockReset();
  mockConnect.mockReset();
  mockClose.mockReset();
  mockListTools.mockReset();
  mockCallTool.mockReset();
});

describe("testMcpInstance", () => {
  it("returns ok:true with tools on list success", async () => {
    mockResolve.mockResolvedValue([httpInstance]);
    mockListTools.mockResolvedValue({
      tools: [{ name: "create_issue", description: "Create an issue", inputSchema: {} }],
    });

    const out = await testMcpInstance(fakePool, ctx, "inst-1", { kind: "list" });

    expect(out).toEqual({
      ok: true,
      tools: [{ name: "create_issue", description: "Create an issue", inputSchema: {} }],
    });
    expect(mockClose).toHaveBeenCalled();
  });

  it("returns ok:true with result on invoke success", async () => {
    mockResolve.mockResolvedValue([httpInstance]);
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const out = await testMcpInstance(fakePool, ctx, "inst-1", {
      kind: "invoke",
      tool: "create_issue",
      args: { owner: "o", repo: "r" },
    });

    expect(out).toEqual({ ok: true, result: { content: [{ type: "text", text: "ok" }] } });
    expect(mockCallTool).toHaveBeenCalledWith({ name: "create_issue", arguments: { owner: "o", repo: "r" } });
    expect(mockClose).toHaveBeenCalled();
  });

  it("maps MissingMcpInstancesError to phase:resolve", async () => {
    mockResolve.mockRejectedValue(new MissingMcpInstancesError(["inst-1"]));
    const out = await testMcpInstance(fakePool, ctx, "inst-1", { kind: "list" });
    expect(out).toMatchObject({ ok: false, phase: "resolve" });
  });

  it("maps MissingSecretsError to phase:resolve and includes secret names", async () => {
    mockResolve.mockRejectedValue(new MissingSecretsError(["GITHUB_PAT"]));
    const out = await testMcpInstance(fakePool, ctx, "inst-1", { kind: "list" });
    expect(out).toEqual({
      ok: false,
      phase: "resolve",
      error: expect.stringContaining("GITHUB_PAT"),
    });
  });

  it("maps connect failure to phase:connect and closes transport", async () => {
    mockResolve.mockResolvedValue([httpInstance]);
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await testMcpInstance(fakePool, ctx, "inst-1", { kind: "list" });
    expect(out).toEqual({ ok: false, phase: "connect", error: expect.stringContaining("ECONNREFUSED") });
    expect(mockClose).toHaveBeenCalled();
  });

  it("maps tools/list failure to phase:list", async () => {
    mockResolve.mockResolvedValue([httpInstance]);
    mockListTools.mockRejectedValue(new Error("boom"));
    const out = await testMcpInstance(fakePool, ctx, "inst-1", { kind: "list" });
    expect(out).toEqual({ ok: false, phase: "list", error: expect.stringContaining("boom") });
    expect(mockClose).toHaveBeenCalled();
  });

  it("maps tools/call failure to phase:invoke", async () => {
    mockResolve.mockResolvedValue([httpInstance]);
    mockCallTool.mockRejectedValue(new Error("bad arg"));
    const out = await testMcpInstance(fakePool, ctx, "inst-1", {
      kind: "invoke",
      tool: "x",
      args: {},
    });
    expect(out).toEqual({ ok: false, phase: "invoke", error: expect.stringContaining("bad arg") });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -w @journeyman/mcp`
Expected: FAIL — `./test-runner.ts` cannot be resolved.

- [ ] **Step 3: Implement `test-runner.ts`**

Create `packages/mcp/src/test-runner.ts`:

```ts
import type { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  MissingMcpInstancesError,
  MissingSecretsError,
  type ResolvedMcpInstance,
} from "@journeyman/core";
import { resolveMcpInstances } from "./resolver.ts";
import { buildHeaders } from "./sdk-adapter.ts";

export type TestPhase = "resolve" | "connect" | "list" | "invoke";

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
  | { ok: false; error: string; phase: TestPhase };

const TEST_TIMEOUT_MS = 30_000;

export async function testMcpInstance(
  pool: Pool,
  ctx: { orgId: string; userId: string },
  instanceId: string,
  action: TestAction,
): Promise<TestOutcome> {
  let resolved: ResolvedMcpInstance;
  try {
    const out = await resolveMcpInstances(pool, ctx, [instanceId]);
    resolved = out[0]!;
  } catch (err) {
    if (err instanceof MissingMcpInstancesError || err instanceof MissingSecretsError) {
      return { ok: false, phase: "resolve", error: (err as Error).message };
    }
    return { ok: false, phase: "resolve", error: errMsg(err) };
  }

  let phase: TestPhase = "connect";
  const client = new Client({ name: "journeyman-test-client", version: "0.1.0" }, {});
  let transport: { close?: () => Promise<void> | void } | null = null;

  try {
    transport = buildTransport(resolved);
    await withTimeout(client.connect(transport as any), TEST_TIMEOUT_MS, () => phase);

    if (action.kind === "list") {
      phase = "list";
      const res: any = await withTimeout(client.listTools(), TEST_TIMEOUT_MS, () => phase);
      const tools: ToolSummary[] = (res?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return { ok: true, tools };
    }

    phase = "invoke";
    const result = await withTimeout(
      client.callTool({ name: action.tool, arguments: action.args }),
      TEST_TIMEOUT_MS,
      () => phase,
    );
    return { ok: true, result };
  } catch (err) {
    return { ok: false, phase, error: errMsg(err) };
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    if (transport && typeof transport.close === "function") {
      try { await transport.close(); } catch { /* ignore */ }
    }
  }
}

function buildTransport(inst: ResolvedMcpInstance) {
  if (inst.transport === "stdio") {
    return new StdioClientTransport({
      command: inst.command!,
      args: inst.args ?? [],
      env: inst.env,
    });
  }
  const headers = buildHeaders(inst.env);
  if (inst.transport === "sse") {
    return new SSEClientTransport(new URL(inst.url!), { requestInit: { headers } });
  }
  return new StreamableHTTPClientTransport(new URL(inst.url!), { requestInit: { headers } });
}

function withTimeout<T>(p: Promise<T>, ms: number, getPhase: () => TestPhase): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms in phase:${getPhase()}`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @journeyman/mcp`
Expected: PASS — all sdk-adapter and test-runner tests green.

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck -w @journeyman/mcp`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/test-runner.ts packages/mcp/src/test-runner.test.ts
git commit -m "feat(mcp): add testMcpInstance runner for connection diagnostics"
```

---

## Task 4: Add Fastify routes for the test action

**Files:**
- Create: `packages/mcp/src/routes/test-mcp.ts`
- Modify: `packages/mcp/src/routes/index.ts`

- [ ] **Step 1: Create the route file**

Create `packages/mcp/src/routes/test-mcp.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { testMcpInstance, type TestAction } from "../test-runner.ts";

function parseAction(body: unknown): TestAction | { error: string } {
  if (!body || typeof body !== "object") return { error: "body required" };
  const b = body as any;
  if (b.action === "list") return { kind: "list" };
  if (b.action === "invoke") {
    if (typeof b.tool !== "string" || !b.tool) return { error: "invoke requires tool (string)" };
    const args = b.args ?? {};
    if (typeof args !== "object" || Array.isArray(args)) {
      return { error: "invoke requires args (object)" };
    }
    return { kind: "invoke", tool: b.tool, args: args as Record<string, unknown> };
  }
  return { error: "action must be 'list' or 'invoke'" };
}

export async function registerMcpTestRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  // User-scope: only the calling user's MCPs.
  app.post(
    "/api/orgs/:orgId/users/me/mcp-instances/:id/test",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const parsed = parseAction(req.body);
      if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

      const out = await testMcpInstance(pool, { orgId, userId: ctx.user.id }, id, parsed);
      return out;
    },
  );

  // Org-scope: org-shared MCPs. The resolver still scopes by (orgId,userId) and
  // user-scope wins for secrets; that matches how the runner reads the same
  // instance, so testing reflects what would actually happen at run time.
  app.post(
    "/api/orgs/:orgId/mcp-instances/:id/test",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

      const parsed = parseAction(req.body);
      if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

      const out = await testMcpInstance(pool, { orgId, userId: ctx.user.id }, id, parsed);
      return out;
    },
  );
}
```

- [ ] **Step 2: Register the routes**

Edit `packages/mcp/src/routes/index.ts` so the full file reads:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserMcpRoutes } from "./user-mcp.ts";
import { registerOrgMcpRoutes } from "./org-mcp.ts";
import { registerVisibleMcpRoutes } from "./visible.ts";
import { registerMcpCatalogRoute } from "./catalog.ts";
import { registerPromoteMcpRoute } from "./promote.ts";
import { registerPromotableMcpRoute } from "./promotable.ts";
import { registerMcpTestRoutes } from "./test-mcp.ts";

export async function registerMcpRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgMcpRoutes(app, pool);
  await registerUserMcpRoutes(app, pool);
  await registerVisibleMcpRoutes(app, pool);
  await registerMcpCatalogRoute(app);
  await registerPromoteMcpRoute(app, pool);
  await registerPromotableMcpRoute(app, pool);
  await registerMcpTestRoutes(app, pool);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/mcp`
Expected: clean.

- [ ] **Step 4: Smoke-test the route**

Start the API server:
```bash
npm run start:api-server
```
In another terminal, with a logged-in session cookie or test PAT (replace `<orgId>`, `<id>`, `<cookie>` accordingly):
```bash
curl -X POST "http://localhost:3000/api/orgs/<orgId>/users/me/mcp-instances/<id>/test" \
  -H "Content-Type: application/json" \
  -H "Cookie: <cookie>" \
  -d '{"action":"list"}'
```
Expected: `200` with `{ "ok": true, "tools": [...] }` for a healthy GitHub MCP, or `{ "ok": false, "phase": "...", "error": "..." }` otherwise.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/routes/test-mcp.ts packages/mcp/src/routes/index.ts
git commit -m "feat(mcp): add POST /test routes for user and org MCP instances"
```

---

## Task 5: Web API client additions

**Files:**
- Modify: `packages/web/src/api/mcp.ts`

- [ ] **Step 1: Append `TestOutcome`/`ToolSummary` types and `testList`/`testInvoke` methods**

At the bottom of `packages/web/src/api/mcp.ts`, before the closing `};` of `mcpApi`, add the new methods. Then below `mcpApi`, add the shared types.

Final relevant additions to the file:

```ts
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
```

Then add to the `mcpApi` object literal (right before the closing `}`):

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/mcp.ts
git commit -m "feat(web): mcp api client testList/testInvoke"
```

---

## Task 6: Build the `TestMcpModal` component

**Files:**
- Create: `packages/web/src/components/mcp/TestMcpModal.tsx`

- [ ] **Step 1: Create the modal**

Create `packages/web/src/components/mcp/TestMcpModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpInstance, type TestOutcome, type ToolSummary } from "../../api/mcp.ts";

export interface TestMcpModalProps {
  orgId: string;
  scope: "user" | "org";
  mcp: McpInstance;
  onClose: () => void;
}

type Stage = "loading" | "list" | "invoking" | "result" | "error";

const MAX_DISPLAY_BYTES = 1_000_000;

export function TestMcpModal(props: TestMcpModalProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selected, setSelected] = useState<ToolSummary | null>(null);
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [lastError, setLastError] = useState<{ error: string; phase: string } | null>(null);

  async function runList() {
    setStage("loading");
    setLastError(null);
    try {
      const out = await mcpApi.testList(props.orgId, props.scope, props.mcp.id);
      if (out.ok && "tools" in out) {
        setTools(out.tools);
        setStage("list");
      } else if (!out.ok) {
        setLastError({ error: out.error, phase: out.phase });
        setStage("error");
      }
    } catch (e: any) {
      setLastError({ error: e?.message ?? "request failed", phase: "connect" });
      setStage("error");
    }
  }

  useEffect(() => { runList(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  function selectTool(t: ToolSummary) {
    setSelected(t);
    if (argsByTool[t.name] === undefined) {
      setArgsByTool((prev) => ({ ...prev, [t.name]: skeletonForSchema(t.inputSchema) }));
    }
    setParseError(null);
    setLastResult(null);
  }

  async function invoke() {
    if (!selected) return;
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(argsByTool[selected.name] ?? "{}");
      if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
        throw new Error("args must be a JSON object");
      }
    } catch (e: any) {
      setParseError(e?.message ?? "invalid JSON");
      return;
    }
    setParseError(null);
    setStage("invoking");
    try {
      const out = await mcpApi.testInvoke(props.orgId, props.scope, props.mcp.id, selected.name, parsedArgs);
      if (out.ok && "result" in out) {
        setLastResult(out.result);
        setLastError(null);
        setStage("result");
      } else if (!out.ok) {
        setLastError({ error: out.error, phase: out.phase });
        setLastResult(null);
        setStage("result");
      }
    } catch (e: any) {
      setLastError({ error: e?.message ?? "request failed", phase: "invoke" });
      setLastResult(null);
      setStage("result");
    }
  }

  const onlyAuthenticate =
    tools.length === 1 && tools[0]?.name.toLowerCase() === "authenticate";

  const resultText = useMemo(() => {
    if (lastResult === null) return "";
    try { return JSON.stringify(lastResult, null, 2); }
    catch { return String(lastResult); }
  }, [lastResult]);

  const truncated = resultText.length > MAX_DISPLAY_BYTES;
  const resultDisplay = truncated ? resultText.slice(0, MAX_DISPLAY_BYTES) : resultText;

  function downloadFull() {
    const blob = new Blob([resultText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.mcp.name}-${selected?.name ?? "result"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyResult() {
    void navigator.clipboard.writeText(resultText);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Test MCP</h2>
            <div className="text-sm text-slate-400">
              <code className={codePill}>{props.mcp.name}</code>
              <span className="ml-2">transport: <code className={codePill}>{props.mcp.transport}</code></span>
            </div>
          </div>
          <button onClick={props.onClose} className={btnGhost}>Close</button>
        </div>

        {stage === "loading" && (
          <div className="p-10 text-center text-sm text-slate-400">Connecting to <code className={codePill}>{props.mcp.name}</code>…</div>
        )}

        {stage === "error" && lastError && (
          <div className="p-6 space-y-3">
            <div className="rounded border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
              <div className="font-medium">Test failed at phase: <code className={codePill}>{lastError.phase}</code></div>
              <div className="mt-1 whitespace-pre-wrap break-words">{lastError.error}</div>
            </div>
            <button onClick={runList} className={btnPrimary}>Retry</button>
          </div>
        )}

        {(stage === "list" || stage === "invoking" || stage === "result") && (
          <div className="flex flex-1 min-h-0 flex-col md:flex-row">
            <aside className="md:w-72 md:border-r md:border-slate-800 overflow-y-auto p-4 space-y-1">
              {onlyAuthenticate && (
                <div className="rounded border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 mb-2">
                  Server returned only an <code className={codePill}>authenticate</code> tool. This usually means auth is missing or invalid — check the bound secret and required env.
                </div>
              )}
              {tools.length === 0 ? (
                <div className="text-sm text-slate-500">No tools.</div>
              ) : tools.map((t) => (
                <button
                  key={t.name}
                  onClick={() => selectTool(t)}
                  className={`w-full text-left px-3 py-2 rounded text-sm ${selected?.name === t.name ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/50"}`}
                >
                  <div className="font-mono">{t.name}</div>
                  {t.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</div>}
                </button>
              ))}
            </aside>

            <section className="flex-1 overflow-y-auto p-6">
              {!selected && (
                <div className="text-sm text-slate-500">Select a tool to invoke.</div>
              )}

              {selected && stage !== "result" && (
                <div className="space-y-4">
                  <div>
                    <div className="font-mono text-slate-100">{selected.name}</div>
                    {selected.description && <div className="text-sm text-slate-400 mt-1">{selected.description}</div>}
                  </div>

                  <div>
                    <label className="text-sm text-slate-300 block mb-1">Arguments (JSON)</label>
                    <textarea
                      className={`${inputCls} font-mono`}
                      rows={12}
                      value={argsByTool[selected.name] ?? ""}
                      onChange={(e) => setArgsByTool((prev) => ({ ...prev, [selected.name]: e.target.value }))}
                    />
                    {parseError && <div className="text-sm text-rose-400 mt-1">{parseError}</div>}
                  </div>

                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer">inputSchema</summary>
                    <pre className="mt-2 bg-slate-900/60 rounded p-3 overflow-x-auto">{JSON.stringify(selected.inputSchema ?? {}, null, 2)}</pre>
                  </details>

                  <div className="flex justify-end">
                    <button onClick={invoke} disabled={stage === "invoking"} className={btnPrimary}>
                      {stage === "invoking" ? "Invoking…" : "Invoke"}
                    </button>
                  </div>
                </div>
              )}

              {selected && stage === "result" && (
                <div className="space-y-4">
                  {lastError ? (
                    <div className="rounded border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                      <div className="font-medium">Failed at phase: <code className={codePill}>{lastError.phase}</code></div>
                      <div className="mt-1 whitespace-pre-wrap break-words">{lastError.error}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-300">Result</div>
                        <div className="flex gap-2">
                          <button onClick={copyResult} className={btnGhost}>Copy</button>
                          {truncated && <button onClick={downloadFull} className={btnGhost}>Download full</button>}
                        </div>
                      </div>
                      {truncated && (
                        <div className="text-xs text-amber-300">Result truncated for display ({resultText.length.toLocaleString()} bytes). Use "Download full" for the complete payload.</div>
                      )}
                      <pre className="bg-slate-900/60 rounded p-3 overflow-auto max-h-[50vh] text-xs whitespace-pre-wrap break-words">{resultDisplay}</pre>
                    </>
                  )}
                  <div className="flex justify-end">
                    <button onClick={() => setStage("list")} className={btnPrimary}>Run again</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function skeletonForSchema(schema: unknown): string {
  const required = Array.isArray((schema as any)?.required) ? (schema as any).required as string[] : [];
  const props = ((schema as any)?.properties ?? {}) as Record<string, any>;
  const obj: Record<string, unknown> = {};
  for (const key of required) {
    const t = props[key]?.type;
    obj[key] =
      t === "number" || t === "integer" ? 0
      : t === "boolean" ? false
      : t === "array" ? []
      : t === "object" ? {}
      : "";
  }
  return JSON.stringify(obj, null, 2);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/mcp/TestMcpModal.tsx
git commit -m "feat(web): add TestMcpModal with connect/list/invoke flow"
```

---

## Task 7: Wire the Test button into the user MCP page

**Files:**
- Modify: `packages/web/src/routes/MyMcpsPage.tsx`

- [ ] **Step 1: Edit `MyMcpsPage.tsx` to add the Test button + modal**

Replace the file contents with:

```tsx
import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance } from "../api/mcp.ts";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";
import { TestMcpModal } from "../components/mcp/TestMcpModal.tsx";

export function MyMcpsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<McpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);
  const [testing, setTesting] = useState<McpInstance | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows(await mcpApi.listMy(props.orgId)); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete MCP "${row.name}"?`)) return;
    await mcpApi.removeMy(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">My MCPs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Personal MCP servers available to your runs.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Your MCPs <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No personal MCPs yet. Use "Add from catalog" or "Add custom" above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setTesting(r)} className={btnGhost}>Test</button>
                        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
                        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {modal === "catalog" && (
        <AddFromCatalogModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal orgId={props.orgId} scope="user" mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {testing && (
        <TestMcpModal orgId={props.orgId} scope="user" mcp={testing} onClose={() => setTesting(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/MyMcpsPage.tsx
git commit -m "feat(web): add Test button to My MCPs page"
```

---

## Task 8: Wire the Test button into the admin (org) MCP page

**Files:**
- Modify: `packages/web/src/routes/AdminMcpsPage.tsx`

- [ ] **Step 1: Add the same wiring at org scope**

Open `packages/web/src/routes/AdminMcpsPage.tsx`. Apply these three edits:

1. Import `TestMcpModal` next to the other component imports near the top:
   ```ts
   import { TestMcpModal } from "../components/mcp/TestMcpModal.tsx";
   ```

2. Add state for the test target near where `editing` is declared:
   ```ts
   const [testing, setTesting] = useState<McpInstance | null>(null);
   ```

3. In the per-row action group (the `<div className="flex justify-end gap-2">` near `Edit`/`Delete`), add a `Test` button as the first child of that div:
   ```tsx
   <button onClick={() => setTesting(r)} className={btnGhost}>Test</button>
   ```

4. Near the bottom, alongside the existing modal renders, add:
   ```tsx
   {testing && (
     <TestMcpModal orgId={props.orgId} scope="org" mcp={testing} onClose={() => setTesting(null)} />
   )}
   ```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/AdminMcpsPage.tsx
git commit -m "feat(web): add Test button to Org MCPs page"
```

---

## Task 9: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build the web bundle and start the API server**

```bash
npm run build:web
npm run start:api-server
```
Expected: server starts; web bundle builds with no errors.

- [ ] **Step 2: Run the dev server in another terminal**

```bash
npm run dev:web
```

- [ ] **Step 3: Test against the GitHub MCP that previously failed**

In the browser:
1. Open the "My MCPs" page.
2. Click `Test` on the GitHub MCP row.
3. Verify the modal shows a real tool list (not just `authenticate`). The yellow callout should NOT appear.
4. Pick `add_issue_comment` (or equivalent), edit the JSON args (e.g. `{ "owner": "regojoyson", "repo": "agentic-ai-revolution", "issue_number": 6, "body": "test from journeyman" }`), and click `Invoke`.
5. Verify the result panel shows a successful response.

- [ ] **Step 4: Test the failure paths**

1. Edit the GitHub MCP and unbind / break the `AUTHORIZATION` secret. Re-open the test modal.
   Expected: either `phase: resolve` error (missing secret) OR `tools.length === 1 && authenticate` with the yellow callout.
2. Re-bind the correct secret and confirm the modal returns to normal.

- [ ] **Step 5: Run the original "Add comment on Ticket" custom phase**

Run the same workflow that produced the earlier failure logs.
Expected: the phase completes without invoking `mcp__GitHub__authenticate`. The agent should call the appropriate `mcp__GitHub__*` write tool directly.

- [ ] **Step 6: Final repo-wide checks**

```bash
npm run typecheck
npm test -w @journeyman/mcp
```
Expected: both clean.

- [ ] **Step 7: Push the branch**

```bash
git push -u origin feat-01
```
