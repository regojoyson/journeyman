# OpenCode Provider Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the OpenCode coding provider to full parity with Claude — `runCustomPrompt` plus the existing `scanRepos`/`checkoutRepo`, in both the local and Docker backends, with MCP, native skills, tools, and structured output, selected purely by the provider chosen for a step.

**Architecture:** The OpenCode SDK (`@opencode-ai/sdk` v2) spawns the `opencode` binary as a managed server (one per operation), passing an OpenCode `Config` (permissions, MCP) at spawn and per-prompt params (model, tools, format, system, directory). We translate Journeyman's options → OpenCode shapes in small, unit-tested helpers, wire the provider into the shared factory so `RunnerRequest.provider="opencode"` routes correctly, deliver skills into OpenCode's native skill directory, and bake the `opencode` binary into the runner image (and `node_modules` for local).

**Tech Stack:** TypeScript (ESM, explicit `.ts` import extensions), Vitest, `@opencode-ai/sdk/v2`, `opencode-ai` CLI binary, Docker (node:22-slim), npm workspaces.

---

## Reference facts (verified against the installed SDK — do not re-derive)

- `createOpencode({ hostname, port, timeout, config })` → `{ client, server }`. `server.close()` stops the spawned `opencode serve`. The binary must be on `PATH`. Config reaches the binary via `OPENCODE_CONFIG_CONTENT`; the spawn forwards **only** `process.env` (no per-call env option).
- `createOpencodeClient({ baseUrl })` → client only (external mode; nothing to close).
- `client.session.create({ title })` → `{ data?: { id } }`.
- `client.session.prompt({ sessionID, parts, model, tools, format, system, directory })` → `{ data?: { info: AssistantMessage, parts: Part[] } }`.
  - `model`: `{ providerID: string; modelID: string }`.
  - `tools`: `Record<string, boolean>` (enable map).
  - `format`: `{ type: "json_schema", schema }` → result on `info.structured`.
  - `system`: extra system prompt string. `directory`: project root (use as cwd).
  - Text output: concatenate `parts` where `part.type === "text"` (`TextPart.text`).
  - Errors: `info.error` (string or object).
- OpenCode `Config`: `permission` (keys incl. `bash`, `edit`, `webfetch`, `websearch`, `skill`, each `"ask"|"allow"|"deny"`), `mcp` (`Record<string, McpLocalConfig | McpRemoteConfig>`), `tools`, `instructions`, `provider`, `model`.
  - `McpLocalConfig = { type:"local"; command: string[]; environment?: Record<string,string>; enabled?; timeout? }`.
  - `McpRemoteConfig = { type:"remote"; url: string; headers?: Record<string,string>; enabled?; timeout? }`.
- OpenCode discovers project skills from `<projectRoot>/.opencode/skill/<skillName>/SKILL.md`. `client.skill.list()` lists discovered skills (used for verification).
- Core option types (`packages/core/src/types/`): `RunCustomPromptOptions` and `ScanReposOptions`/`CheckoutRepoOptions` all carry `model?: string` (format `"providerID/modelID"`), plus `env?`, `signal?`, `cwd?` (custom-prompt only), `mcps?`, `skills?`, `tools?`.
- The runner factory is called as `createCodingProvider(key, { env: process.env })` — **no model is passed at construction**. Model arrives per-operation via `opts.model`. Therefore the OpenCode provider must treat model as per-operation, not constructor-required.
- Docker backend (`packages/sandbox/src/backends/docker/docker-execution-environment.ts`) passes per-call secret env as the **exec environment** of `journeyman-runner` (`...(op.env ? { env: op.env } : {})`). So inside a container, `process.env` already contains the step's secrets, and any child the runner spawns (incl. `opencode serve`) inherits them. The local backend runs in-process and does **not** put `opts.env` on `process.env` — so the local path must inject env around the spawn.

---

## File structure

**New files**
- `packages/agent-runtime/src/providers/opencode/model.ts` — `parseOpenCodeModel`, `resolveOpenCodeModel`.
- `packages/agent-runtime/src/providers/opencode/model.test.ts`
- `packages/agent-runtime/src/providers/opencode/mcp-adapter.ts` — `toOpenCodeMcpConfigs`.
- `packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts`
- `packages/agent-runtime/src/providers/opencode/server-config.ts` — `buildServerConfig`, `applyEnv`, `freePort`.
- `packages/agent-runtime/src/providers/opencode/server-config.test.ts`
- `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`
- `packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`

**Modified files**
- `packages/agent-runtime/package.json` — add `opencode-ai` dep.
- `packages/agent-runtime/src/providers/opencode/tool-mapping.ts` — fill map + `openCodeToolsEnableMap`.
- `packages/agent-runtime/src/providers/opencode/client.ts` — `startServer` returning `{ client, close }` with free port + env injection.
- `packages/agent-runtime/src/providers/opencode/client.test.ts` — adapt to new return shape.
- `packages/agent-runtime/src/providers/opencode/index.ts` — optional model, per-op start/close, wire `runCustomPrompt`.
- `packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts` + `checkout-repo.ts` — resolve model from `opts.model`.
- `packages/agent-runtime/src/providers/factory.ts` — add `case "opencode"`.
- `packages/agent-runtime/src/providers/factory.test.ts` — opencode case test.
- `packages/orchestrator/src/workers/skill-placement.ts` — add `case "opencode"`.
- `packages/orchestrator/src/workers/skill-placement.test.ts` — opencode case test.
- `docker/runner-base.Dockerfile` — glibc runtime + `opencode` on PATH.
- `docker/runner-bundle.Dockerfile` — `opencode` on PATH in relocatable bundle.

**Conventions:** all relative imports use explicit `.ts` extensions. Run a single test file with `npx vitest run <path>` from the repo root. Typecheck a workspace with `npm run typecheck -w @journeyman/agent-runtime`. Boundaries: `npm run check:boundaries`.

---

## Task 1: Add the `opencode-ai` dependency

**Files:**
- Modify: `packages/agent-runtime/package.json`

- [ ] **Step 1: Install the CLI package (pinned to the SDK's major)**

Run:
```bash
npm install -w @journeyman/agent-runtime opencode-ai@1.16.2
```

- [ ] **Step 2: Verify the binary landed in node_modules**

Run:
```bash
ls node_modules/.bin/opencode && node_modules/.bin/opencode --version
```
Expected: the path prints and a version string is shown (the platform binary resolved via optional deps). If `--version` errors, the platform binary for this OS/arch failed to install — re-run `npm install` and check `npm ls opencode-ai`.

- [ ] **Step 3: Confirm `package.json` records the dep**

Run:
```bash
grep '"opencode-ai"' packages/agent-runtime/package.json
```
Expected: a `"opencode-ai": "^1.16.2"` (or pinned) entry under `dependencies`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/package.json package-lock.json
git commit -m "build(agent-runtime): add opencode-ai CLI dependency"
```

---

## Task 2: Tools — fill `OPENCODE_TOOL_MAP` + enable-map helper

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/tool-mapping.ts`
- Test: `packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CANONICAL_TOOLS } from "@journeyman/core";
import { OPENCODE_TOOL_MAP, openCodeToolsEnableMap } from "./tool-mapping.ts";

describe("openCodeToolsEnableMap", () => {
  it("maps canonical tools to an OpenCode enable map", () => {
    expect(openCodeToolsEnableMap(["bash"])).toEqual({ bash: true });
    expect(openCodeToolsEnableMap(["read-file"])).toEqual({ read: true });
    expect(openCodeToolsEnableMap(["write-file"])).toEqual({ write: true });
    expect(openCodeToolsEnableMap(["edit-file"])).toEqual({ edit: true });
    expect(openCodeToolsEnableMap(["search"])).toEqual({ grep: true, glob: true });
    expect(openCodeToolsEnableMap(["web-fetch"])).toEqual({ webfetch: true });
  });

  it("merges multiple canonical tools into one enable map", () => {
    expect(openCodeToolsEnableMap(["bash", "search"])).toEqual({ bash: true, grep: true, glob: true });
  });

  it("returns an empty map for no tools (pure-prompt step)", () => {
    expect(openCodeToolsEnableMap([])).toEqual({});
  });

  it("skips canonical tools with no OpenCode equivalent (web-search)", () => {
    expect(openCodeToolsEnableMap(["web-search"])).toEqual({});
  });

  it("has an explicit entry for every canonical tool (null allowed for unsupported)", () => {
    for (const t of CANONICAL_TOOLS) {
      expect(Object.prototype.hasOwnProperty.call(OPENCODE_TOOL_MAP, t), `missing OPENCODE_TOOL_MAP entry for '${t}'`).toBe(true);
    }
    expect(OPENCODE_TOOL_MAP["web-search"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`
Expected: FAIL — `openCodeToolsEnableMap` is not exported.

- [ ] **Step 3: Implement the map + helper**

Replace the contents of `packages/agent-runtime/src/providers/opencode/tool-mapping.ts`:

```typescript
import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

/**
 * Canonical → native OpenCode tool ids. `null` marks a canonical tool with no
 * OpenCode equivalent (the flow-editor flags null-mapped tools as unsupported).
 * web-search has no native OpenCode tool.
 */
export const OPENCODE_TOOL_MAP: ProviderToolMap = {
  "bash":       ["bash"],
  "read-file":  ["read"],
  "write-file": ["write"],
  "edit-file":  ["edit"],
  "search":     ["grep", "glob"],
  "web-fetch":  ["webfetch"],
  "web-search": null,
};

/**
 * Build OpenCode's per-prompt `tools` enable map ({ toolId: true }) from canonical
 * tool names. Unsupported (null) and unknown tools are skipped.
 */
export function openCodeToolsEnableMap(tools: readonly CanonicalTool[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const t of tools) {
    const native = OPENCODE_TOOL_MAP[t];
    if (!native) continue;
    for (const id of native) out[id] = true;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/tool-mapping.ts packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts
git commit -m "feat(opencode): canonical→opencode tool map + enable-map helper"
```

---

## Task 3: Model parsing helper

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/model.ts`
- Test: `packages/agent-runtime/src/providers/opencode/model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/providers/opencode/model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseOpenCodeModel, resolveOpenCodeModel } from "./model.ts";

describe("parseOpenCodeModel", () => {
  it("splits 'providerID/modelID' on the first slash", () => {
    expect(parseOpenCodeModel("anthropic/claude-sonnet-4-6")).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-6" });
  });
  it("keeps later slashes inside the modelID", () => {
    expect(parseOpenCodeModel("openrouter/meta/llama-3.1")).toEqual({ providerID: "openrouter", modelID: "meta/llama-3.1" });
  });
  it("returns undefined for a string without a slash", () => {
    expect(parseOpenCodeModel("claude-sonnet-4-6")).toBeUndefined();
  });
  it("returns undefined for empty/undefined", () => {
    expect(parseOpenCodeModel("")).toBeUndefined();
    expect(parseOpenCodeModel(undefined)).toBeUndefined();
  });
});

describe("resolveOpenCodeModel", () => {
  it("prefers the per-call model string", () => {
    expect(resolveOpenCodeModel("openai/gpt-4o", { providerID: "anthropic", modelID: "x" }))
      .toEqual({ providerID: "openai", modelID: "gpt-4o" });
  });
  it("falls back to the config model", () => {
    expect(resolveOpenCodeModel(undefined, { providerID: "anthropic", modelID: "x" }))
      .toEqual({ providerID: "anthropic", modelID: "x" });
  });
  it("returns undefined when neither is set", () => {
    expect(resolveOpenCodeModel(undefined, undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/providers/opencode/model.ts`:

```typescript
export interface OpenCodeModel {
  providerID: string;
  modelID: string;
}

/** Parse a "providerID/modelID" string (split on the first slash). */
export function parseOpenCodeModel(model: string | undefined): OpenCodeModel | undefined {
  if (!model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0 || i === model.length - 1) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

/** Per-call model string wins; otherwise the provider-config model object. */
export function resolveOpenCodeModel(
  perCall: string | undefined,
  fallback: OpenCodeModel | undefined,
): OpenCodeModel | undefined {
  return parseOpenCodeModel(perCall) ?? fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/model.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/model.ts packages/agent-runtime/src/providers/opencode/model.test.ts
git commit -m "feat(opencode): model string parse/resolve helpers"
```

---

## Task 4: MCP adapter

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/mcp-adapter.ts`
- Test: `packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

const stdio: ResolvedMcpInstance = {
  id: "1", name: "fs", transport: "stdio",
  command: "npx", args: ["-y", "server-fs"], env: { TOKEN: "t" }, systemPrompt: null,
};
const http: ResolvedMcpInstance = {
  id: "2", name: "remote", transport: "http",
  url: "https://mcp.example.com", env: { AUTHORIZATION: "Bearer abc" }, systemPrompt: null,
};

describe("toOpenCodeMcpConfigs", () => {
  it("maps a stdio instance to a local config (command+args combined)", () => {
    expect(toOpenCodeMcpConfigs([stdio])).toEqual({
      fs: { type: "local", command: ["npx", "-y", "server-fs"], environment: { TOKEN: "t" }, enabled: true },
    });
  });

  it("maps an http/sse instance to a remote config with headers", () => {
    expect(toOpenCodeMcpConfigs([http])).toEqual({
      remote: { type: "remote", url: "https://mcp.example.com", headers: { Authorization: "Bearer abc" }, enabled: true },
    });
  });

  it("de-duplicates colliding names with a numeric suffix", () => {
    const out = toOpenCodeMcpConfigs([stdio, { ...stdio, id: "3" }]);
    expect(Object.keys(out)).toEqual(["fs", "fs-2"]);
  });

  it("returns an empty object for no instances", () => {
    expect(toOpenCodeMcpConfigs([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/providers/opencode/mcp-adapter.ts`:

```typescript
import type { ResolvedMcpInstance } from "@journeyman/core";
import type { McpLocalConfig, McpRemoteConfig } from "./types.ts";

/**
 * Convert resolved MCP instances into OpenCode's `Config.mcp` map.
 *  - stdio  → { type:"local", command:[command, ...args], environment }
 *  - http/sse → { type:"remote", url, headers }
 * Names collide-suffixed (-2, -3, …) to keep keys unique. AUTHORIZATION env on a
 * remote instance becomes a proper `Authorization` header.
 */
export function toOpenCodeMcpConfigs(
  instances: ResolvedMcpInstance[],
): Record<string, McpLocalConfig | McpRemoteConfig> {
  const out: Record<string, McpLocalConfig | McpRemoteConfig> = {};
  const seen = new Map<string, number>();

  for (const inst of instances) {
    const base = inst.name;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}-${n}`;

    if (inst.transport === "stdio") {
      out[key] = {
        type: "local",
        command: [inst.command ?? "", ...(inst.args ?? [])].filter(Boolean),
        ...(Object.keys(inst.env).length ? { environment: inst.env } : {}),
        enabled: true,
      };
    } else {
      out[key] = {
        type: "remote",
        url: inst.url ?? "",
        ...(Object.keys(inst.env).length ? { headers: toHeaders(inst.env) } : {}),
        enabled: true,
      };
    }
  }
  return out;
}

function toHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    headers[k.toUpperCase() === "AUTHORIZATION" ? "Authorization" : k] = v;
  }
  return headers;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/mcp-adapter.ts packages/agent-runtime/src/providers/opencode/mcp-adapter.test.ts
git commit -m "feat(opencode): MCP instance → OpenCode mcp config adapter"
```

---

## Task 5: Server-config helpers (buildServerConfig, applyEnv, freePort)

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/server-config.ts`
- Test: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/providers/opencode/server-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildServerConfig, applyEnv, freePort } from "./server-config.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

const cfg: OpenCodeProviderConfig = { mode: "managed", model: { providerID: "anthropic", modelID: "x" } };

describe("buildServerConfig", () => {
  it("sets bypass-style permissions including skill", () => {
    const c = buildServerConfig(cfg, undefined);
    expect(c.permission).toMatchObject({ bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow" });
  });
  it("includes mcp only when instances are present", () => {
    expect(buildServerConfig(cfg, undefined).mcp).toBeUndefined();
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    expect(buildServerConfig(cfg, mcps).mcp).toHaveProperty("fs");
  });
});

describe("applyEnv", () => {
  it("sets vars then restores prior values on close", () => {
    const KEY = "JM_TEST_OC_ENV";
    delete process.env[KEY];
    const restore = applyEnv({ [KEY]: "v" });
    expect(process.env[KEY]).toBe("v");
    restore();
    expect(process.env[KEY]).toBeUndefined();
  });
  it("is a no-op for undefined env", () => {
    expect(typeof applyEnv(undefined)).toBe("function");
    applyEnv(undefined)(); // does not throw
  });
});

describe("freePort", () => {
  it("returns a usable port number", async () => {
    const p = await freePort();
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/providers/opencode/server-config.ts`:

```typescript
import { createServer } from "node:net";
import type { ResolvedMcpInstance } from "@journeyman/core";
import type { OpenCodeProviderConfig } from "./types.ts";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";

const BYPASS_PERMISSION = {
  bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow",
} as const;

/**
 * Assemble the OpenCode `Config` passed at managed-server spawn. Permissions are
 * bypass-style (parity with Claude's bypassPermissions). MCP is merged from
 * static config + the per-call resolved instances. Tools/model/format are NOT here
 * — those are per-prompt params.
 */
export function buildServerConfig(
  config: OpenCodeProviderConfig,
  mcps: ResolvedMcpInstance[] | undefined,
): Record<string, unknown> {
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(mcps?.length ? toOpenCodeMcpConfigs(mcps) : {}) };
  return {
    permission,
    ...(Object.keys(mcp).length ? { mcp } : {}),
  };
}

/**
 * Temporarily set env vars on process.env (the only channel the SDK forwards to
 * the spawned `opencode` process) and return a restore fn. Needed for the LOCAL
 * backend, where per-call secrets are not already on process.env. In the Docker
 * backend the runner's process.env already carries them, so this is a harmless
 * re-set. NOTE: process.env is process-global — concurrent local-backend ops can
 * race; acceptable for dev (Docker is the isolated production path).
 */
export function applyEnv(env: Record<string, string> | undefined): () => void {
  if (!env || !Object.keys(env).length) return () => {};
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, old] of Object.entries(prev)) {
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }
  };
}

/** Grab a free ephemeral TCP port so concurrent local managed servers don't collide. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/server-config.ts packages/agent-runtime/src/providers/opencode/server-config.test.ts
git commit -m "feat(opencode): server-config + env-injection + free-port helpers"
```

---

## Task 6: Refactor `client.ts` → per-operation `startServer`

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/client.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/client.test.ts`

- [ ] **Step 1: Update the test to the new return shape**

Replace the contents of `packages/agent-runtime/src/providers/opencode/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { startServer } from "./client.ts";

// External mode does not spawn a daemon — it only constructs an HTTP client.
describe("startServer (opencode, external mode)", () => {
  it("returns a client with a session namespace and a no-op close", async () => {
    const handle = await startServer(
      { mode: "external", baseUrl: "http://localhost:4096", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
      { permission: {} },
      undefined,
    );
    expect(handle.client).toBeTruthy();
    expect(typeof handle.client.session).toBe("object");
    expect(typeof handle.close).toBe("function");
    handle.close(); // must not throw
  });

  it("uses a default baseUrl when none is provided", async () => {
    const handle = await startServer(
      { mode: "external", model: { providerID: "openai", modelID: "gpt-4o" } },
      { permission: {} },
      undefined,
    );
    expect(handle.client).toBeTruthy();
    handle.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/client.test.ts`
Expected: FAIL — `startServer` is not exported.

- [ ] **Step 3: Implement the refactor**

Replace the contents of `packages/agent-runtime/src/providers/opencode/client.ts`:

```typescript
import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeProviderConfig } from "./types.ts";
import { applyEnv, freePort } from "./server-config.ts";

export type OpenCodeClient = OpencodeClient;

export interface OpenCodeServerHandle {
  client: OpenCodeClient;
  /** Stop the managed server (no-op in external mode) and restore injected env. */
  close: () => void;
}

/**
 * Start (or connect to) an OpenCode server for ONE operation. Managed mode spawns
 * `opencode serve` on a free port with the given Config, injecting `env` into the
 * process for the server's lifetime; close() stops it and restores env.
 */
export async function startServer(
  config: OpenCodeProviderConfig,
  serverConfig: Record<string, unknown>,
  env: Record<string, string> | undefined,
): Promise<OpenCodeServerHandle> {
  if (config.mode === "external") {
    return {
      client: createOpencodeClient({ baseUrl: config.baseUrl ?? "http://localhost:4096" }),
      close: () => {},
    };
  }

  const restore = applyEnv(env);
  try {
    const port = config.port ?? (await freePort());
    const { client, server } = await createOpencode({
      hostname: config.hostname ?? "127.0.0.1",
      port,
      timeout: config.timeout,
      config: serverConfig as never,
    });
    return {
      client,
      close: () => {
        try {
          server.close();
        } finally {
          restore();
        }
      },
    };
  } catch (err) {
    restore();
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/client.ts packages/agent-runtime/src/providers/opencode/client.test.ts
git commit -m "refactor(opencode): per-operation startServer with close + free port + env"
```

---

## Task 7: Implement the `runCustomPrompt` operation

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`

This operation takes an already-started `client` (injected by `index.ts`), so it is unit-testable with a fake client.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runCustomPrompt } from "./run-custom-prompt.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";

const cfg: OpenCodeProviderConfig = { mode: "managed", model: { providerID: "anthropic", modelID: "x" } };

function fakeClient(promptImpl: (params: any) => any): OpenCodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockImplementation(async (p: any) => promptImpl(p)),
    },
  } as unknown as OpenCodeClient;
}

describe("opencode runCustomPrompt", () => {
  it("structured mode passes the schema and returns info.structured", async () => {
    let captured: any;
    const client = fakeClient((p) => { captured = p; return { data: { info: { structured: { ok: true } }, parts: [] } }; });
    const r = await runCustomPrompt(client, cfg, {
      prompt: "do it", outputMode: "structured", outputSchema: { type: "object" },
      model: "openai/gpt-4o", tools: ["bash", "search"], cwd: "/workspace",
    });
    expect(captured.model).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    expect(captured.tools).toEqual({ bash: true, grep: true, glob: true });
    expect(captured.directory).toBe("/workspace");
    expect(captured.format).toEqual({ type: "json_schema", schema: { type: "object" } });
    expect(r.structured).toEqual({ ok: true });
    expect(r.error).toBeUndefined();
  });

  it("structured mode without a schema returns an error", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "structured" });
    expect(r.error).toMatch(/requires outputSchema/);
  });

  it("text mode concatenates text parts", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [
      { type: "text", text: "hello " }, { type: "text", text: "world" }, { type: "tool", tool: "bash" },
    ] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text" });
    expect(r.result).toBe("hello world");
  });

  it("none mode returns just the sessionId", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "none", sessionId: "abc" });
    expect(r).toEqual({ sessionId: "abc" });
  });

  it("surfaces info.error", async () => {
    const client = fakeClient(() => ({ data: { info: { error: "boom" }, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text" });
    expect(r.error).toBe("boom");
  });

  it("errors when no model is resolvable", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, { mode: "managed" } as OpenCodeProviderConfig, { prompt: "x", outputMode: "text" });
    expect(r.error).toMatch(/no model/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`:

```typescript
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import { openCodeToolsEnableMap } from "../tool-mapping.ts";
import { resolveOpenCodeModel } from "../model.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";

const log = createLogger("opencode:custom-prompt");

/** Concatenate the text of all text parts in a prompt response. */
function extractText(data: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (data.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Merge MCP + skill system prompts (if any) into one OpenCode `system` string. */
function buildSystem(opts: RunCustomPromptOptions): string | undefined {
  const parts: string[] = [];
  for (const m of opts.mcps ?? []) if (m.systemPrompt) parts.push(m.systemPrompt);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Run a custom prompt through OpenCode. `client` is an already-started server
 * client (index.ts owns start/close). Honors outputMode none|text|structured,
 * tools, cwd (as `directory`), and MCP system prompts.
 */
export async function runCustomPrompt(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: RunCustomPromptOptions,
): Promise<RunCustomPromptResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();

  const model = resolveOpenCodeModel(opts.model, config.model);
  if (!model) return { sessionId, error: "opencode: no model configured (set opts.model as 'providerID/modelID')" };

  if (opts.outputMode === "structured" && !opts.outputSchema) {
    return { sessionId, error: "outputMode='structured' requires outputSchema" };
  }

  log.info(
    { sessionId, outputMode: opts.outputMode, mcpCount: opts.mcps?.length ?? 0, skillCount: opts.skills?.length ?? 0 },
    "runCustomPrompt start",
  );

  const tools = openCodeToolsEnableMap(opts.tools ?? []);
  const system = buildSystem(opts);

  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) return { sessionId, error: "opencode session.create returned no data" };

  const res = await client.session.prompt({
    sessionID: session.data.id,
    parts: [{ type: "text", text: opts.prompt }],
    model,
    ...(Object.keys(tools).length ? { tools } : {}),
    ...(opts.cwd ? { directory: opts.cwd } : {}),
    ...(system ? { system } : {}),
    ...(opts.outputMode === "structured" && opts.outputSchema
      ? { format: { type: "json_schema", schema: opts.outputSchema } }
      : {}),
  });
  if (!res.data) return { sessionId, error: "opencode session.prompt returned no data" };

  const info = res.data.info as { error?: unknown; structured?: unknown };
  logSessionEvent(log, sessionId, info as never);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }

  if (opts.outputMode === "none") return { sessionId };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never) };
  return { sessionId, structured: info.structured };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts
git commit -m "feat(opencode): runCustomPrompt operation (text/structured/none, tools, mcp)"
```

---

## Task 8: Wire `index.ts` — optional model, per-op start/close, route all three ops

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/index.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/types.ts`

- [ ] **Step 1: Make `model` optional in the provider config type**

In `packages/agent-runtime/src/providers/opencode/types.ts`, change the `OpenCodeProviderConfig` so `model` is optional (model now arrives per-operation via `opts.model`):

```typescript
export type OpenCodeProviderConfig = OpenCodeMode & {
  model?: { providerID: string; modelID: string }
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig>
  tools?: Record<string, boolean>
  permission?: OpenCodePermission
}
```

- [ ] **Step 2: Resolve model per-operation in scan-repos**

In `packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts`:

Add the import near the top (after the existing imports):
```typescript
import { resolveOpenCodeModel } from "../model.ts";
```

Replace the `client.session.prompt({ ... model: config.model, ... })` call's `model` line. Change:
```typescript
    model: config.model,
```
to:
```typescript
    model: resolveOpenCodeModel(opts.model, config.model),
```

- [ ] **Step 3: Resolve model per-operation in checkout-repo**

Apply the identical change in `packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts`:

Add import:
```typescript
import { resolveOpenCodeModel } from "../model.ts";
```
Change `model: config.model,` to:
```typescript
    model: resolveOpenCodeModel(opts.model, config.model),
```

- [ ] **Step 4: Rewrite `index.ts` to start/close a server per operation**

Replace the contents of `packages/agent-runtime/src/providers/opencode/index.ts`:

```typescript
// packages/agent-runtime/src/providers/opencode/index.ts
import type { ICodingCLI, IProviderMeta, CodingCLIProviderConfig } from "@journeyman/core";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  RunCustomPromptOptions, RunCustomPromptResult,
  ResolvedMcpInstance,
} from "@journeyman/core";
import { startServer } from "./client.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import { buildServerConfig } from "./server-config.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

export type { OpenCodeProviderConfig } from "./types.ts";

export class OpenCodeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "opencode",
    name: "OpenCode CLI",
    description: "AI coding via OpenCode SDK (model-agnostic: Anthropic, OpenAI, Gemini…)",
    category: "coding-cli",
  };

  readonly #config: OpenCodeProviderConfig;

  constructor(config: OpenCodeProviderConfig, private _providerConfig: CodingCLIProviderConfig = {}) {
    if (!config.mode) throw new Error("OpenCodeProvider: config.mode is required ('managed' | 'external')");
    this.#config = config;
  }

  /** Start a managed server with op-specific config, run `fn`, always close. */
  async #withServer<T>(
    mcps: ResolvedMcpInstance[] | undefined,
    env: Record<string, string> | undefined,
    fn: (client: Awaited<ReturnType<typeof startServer>>["client"]) => Promise<T>,
  ): Promise<T> {
    const serverConfig = buildServerConfig(this.#config, mcps);
    const handle = await startServer(this.#config, serverConfig, env);
    try {
      return await fn(handle.client);
    } finally {
      handle.close();
    }
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return this.#withServer(undefined, undefined, (client) => scanRepos(client, this.#config, opts));
  }

  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return this.#withServer(undefined, undefined, (client) => checkoutRepo(client, this.#config, opts));
  }

  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(opts.mcps, opts.env, (client) => runCustomPrompt(client, this.#config, opts));
  }
}
```

- [ ] **Step 5: Typecheck the workspace**

Run: `npm run typecheck -w @journeyman/agent-runtime`
Expected: no errors. (If `scanRepos`/`checkoutRepo` complain that `model` may be undefined when passed to `client.session.prompt`, that is acceptable — the SDK's `model` param is optional; if a strict error appears, it indicates the operation should guard, but `resolveOpenCodeModel` returning `undefined` is valid for the SDK param.)

- [ ] **Step 6: Run the full agent-runtime test suite**

Run: `npx vitest run packages/agent-runtime`
Expected: PASS (all opencode + existing tests).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/index.ts packages/agent-runtime/src/providers/opencode/types.ts packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts
git commit -m "feat(opencode): per-op managed server, optional model, wire runCustomPrompt"
```

---

## Task 9: Factory `case "opencode"`

**Files:**
- Modify: `packages/agent-runtime/src/providers/factory.ts`
- Modify: `packages/agent-runtime/src/providers/factory.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/agent-runtime/src/providers/factory.test.ts` — add the import and two cases inside the existing `describe`:

```typescript
import { OpenCodeProvider } from "./opencode/index.ts";
```

```typescript
  it("returns an OpenCodeProvider for 'opencode' (managed mode)", () => {
    const p = createCodingProvider("opencode", { env: {} });
    expect(p).toBeInstanceOf(OpenCodeProvider);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/factory.test.ts`
Expected: FAIL — opencode returns the unknown-provider error.

- [ ] **Step 3: Implement the case**

In `packages/agent-runtime/src/providers/factory.ts`, add the import:
```typescript
import { OpenCodeProvider } from "./opencode/index.ts";
```

Add the case before `default:`:
```typescript
    case "opencode":
      // Model arrives per-operation via opts.model ("providerID/modelID"); the
      // managed server spawns the bundled `opencode` binary. Per-call secret env
      // reaches the spawn via process.env (Docker) or applyEnv (local).
      return new OpenCodeProvider({ mode: "managed" });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/factory.test.ts`
Expected: PASS.

- [ ] **Step 5: Boundary + typecheck**

Run: `npm run typecheck -w @journeyman/agent-runtime && npm run check:boundaries`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime/src/providers/factory.ts packages/agent-runtime/src/providers/factory.test.ts
git commit -m "feat(opencode): wire OpenCodeProvider into createCodingProvider"
```

---

## Task 10: Skills delivery into the container (`placeSkills` opencode case)

**Files:**
- Modify: `packages/orchestrator/src/workers/skill-placement.ts`
- Modify: `packages/orchestrator/src/workers/skill-placement.test.ts`

OpenCode discovers project skills at `<workspace>/.opencode/skill/`. The custom-AI step handler already calls `placeSkills(provider, …)` with the runner's `materialize`, and the operation passes `directory: cwd` (= `/workspace`), so staged skills are discovered automatically.

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/workers/skill-placement.test.ts` a new describe block:

```typescript
describe("placeSkills (opencode)", () => {
  it("materializes package dirs into the opencode skill dir and rewrites localPath", async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    const skills = [{ id: "p1", name: "pkg", localPath: "/home/.journeyman/skills/pkg-ab12", enabledSkills: ["alpha"], gitUrl: "", cliType: "opencode" }] as any;
    const rewritten = await placeSkills("opencode", skills, { materialize });
    expect(materialize).toHaveBeenCalledWith("/workspace/.opencode/skill", expect.anything());
    expect(rewritten[0].localPath).toBe("/workspace/.opencode/skill/pkg-ab12");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/orchestrator/src/workers/skill-placement.test.ts`
Expected: FAIL — opencode falls through `default` (no materialize call).

- [ ] **Step 3: Implement the case**

In `packages/orchestrator/src/workers/skill-placement.ts`, add a constant near `CLAUDE_SKILLS_DIR`:

```typescript
const OPENCODE_SKILLS_DIR = "/workspace/.opencode/skill";
```

Replace the `default:` fall-through region so OpenCode is handled. The switch becomes:

```typescript
  switch (provider ?? "claude") {
    case "claude": {
      const { bundle, mapping } = bundleEnabledSkills(skills, CLAUDE_SKILLS_DIR);
      await deps.materialize(CLAUDE_SKILLS_DIR, bundle);
      const byId = new Map(mapping.map((m) => [m.id, m.containerPath]));
      return skills.map((s) => ({ ...s, localPath: byId.get(s.id) ?? s.localPath }));
    }
    case "opencode": {
      const { bundle, mapping } = bundleEnabledSkills(skills, OPENCODE_SKILLS_DIR);
      await deps.materialize(OPENCODE_SKILLS_DIR, bundle);
      const byId = new Map(mapping.map((m) => [m.id, m.containerPath]));
      return skills.map((s) => ({ ...s, localPath: byId.get(s.id) ?? s.localPath }));
    }
    default:
      return skills;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/orchestrator/src/workers/skill-placement.test.ts`
Expected: PASS (claude + opencode + no-op).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/workers/skill-placement.ts packages/orchestrator/src/workers/skill-placement.test.ts
git commit -m "feat(opencode): deliver skills into .opencode/skill for the docker backend"
```

---

## Task 11: Bake `opencode` into the runner images

**Files:**
- Modify: `docker/runner-base.Dockerfile`
- Modify: `docker/runner-bundle.Dockerfile`

The build stage is `node:22-slim` (glibc), so `npm ci` resolves the glibc `opencode` binary into `node_modules`. The runtime stage must also be glibc and must put `node_modules/.bin` (and `node`) on PATH.

- [ ] **Step 1: Switch `runner-base` runtime to glibc**

In `docker/runner-base.Dockerfile`, change the runtime stage base. Replace:
```dockerfile
FROM node:22-alpine AS runner-base
```
with:
```dockerfile
FROM node:22-slim AS runner-base
```

- [ ] **Step 2: Replace the Alpine package install with apt**

In `docker/runner-base.Dockerfile`, replace:
```dockerfile
RUN apk add --no-cache git openssh-client ca-certificates
```
with:
```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 3: Put the opencode binary on PATH**

In `docker/runner-base.Dockerfile`, immediately after the line
`COPY --from=build /app/node_modules ./node_modules`, add:
```dockerfile
# opencode CLI binary ships in node_modules/.bin (opencode-ai dep); the SDK spawns
# it by bare name, so it must be on PATH for the managed-server mode.
ENV PATH="/opt/journeyman/node_modules/.bin:${PATH}"
```

- [ ] **Step 4: Put opencode on PATH in the relocatable bundle**

In `docker/runner-bundle.Dockerfile`, the launcher script is generated by a `printf`. Replace:
```dockerfile
 && printf '#!/bin/sh\nexport NODE_ENV=production\nexec /opt/journeyman/node /opt/journeyman/runner.js "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
```
with:
```dockerfile
 && printf '#!/bin/sh\nexport NODE_ENV=production\nexport PATH="/opt/journeyman/bin:/opt/journeyman/node_modules/.bin:$PATH"\nexec /opt/journeyman/node /opt/journeyman/runner.js "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
```

- [ ] **Step 5: Build the runner-base image and verify opencode is present**

Run:
```bash
docker build -f docker/runner-base.Dockerfile -t jm-runner-base:opencode-check .
docker run --rm --entrypoint sh jm-runner-base:opencode-check -c "opencode --version && journeyman-runner --selftest || opencode --version"
```
Expected: the `opencode` version prints (proves the binary is on PATH and runs on glibc). If `command not found`, recheck the `ENV PATH` line and that Task 1 added the dep before the build context was assembled.

- [ ] **Step 6: Commit**

```bash
git add docker/runner-base.Dockerfile docker/runner-bundle.Dockerfile
git commit -m "build(docker): ship opencode binary in runner images (glibc + PATH)"
```

---

## Task 12: Cross-cutting verification (typecheck, boundaries, full tests, parity smoke)

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + boundaries**

Run: `npm run check`
Expected: no errors across workspaces.

- [ ] **Step 2: Full test suites for the two touched workspaces**

Run:
```bash
npx vitest run packages/agent-runtime
npx vitest run packages/orchestrator/src/workers/skill-placement.test.ts
```
Expected: PASS. (If pre-existing unrelated failures appear in orchestrator, scope the run to the files touched in this plan and confirm no new failures — see the deps-campaign no-regressions gate.)

- [ ] **Step 3: Manual parity smoke — text mode (requires `opencode` installed locally + a provider key)**

Create a throwaway script `/tmp/oc-smoke.mjs`:
```javascript
import { createCodingProvider } from "./packages/agent-runtime/src/index.ts";
const p = createCodingProvider("opencode", { env: process.env });
const r = await p.runCustomPrompt({
  prompt: "Reply with exactly: PARITY_OK",
  outputMode: "text",
  model: "anthropic/claude-sonnet-4-6",
});
console.log(JSON.stringify(r, null, 2));
```
Run: `ANTHROPIC_API_KEY=... npx tsx /tmp/oc-smoke.mjs`
Expected: `result` contains `PARITY_OK`, no `error`. (Skip if no provider key is available; the unit tests already cover the logic. Delete the script afterward.)

- [ ] **Step 4: Manual parity smoke — structured mode + skills discovery (optional)**

Extend the script to call `runCustomPrompt` with `outputMode: "structured"`, `outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }`. Confirm `structured.value` is set. To verify skill discovery, start a server manually and call `client.skill.list()` after staging a skill under `<cwd>/.opencode/skill/`.

- [ ] **Step 5: Update the implementation-status note (optional docs)**

In `CLAUDE.md`, the Implementation Status table lists `OpenCodeProvider | Implemented`. If desired, add a row noting `runCustomPrompt` + MCP/skills/tools parity. Commit any doc change separately.

- [ ] **Step 6: Final commit (if any verification-driven fixes were made)**

```bash
git add -A
git commit -m "test(opencode): parity verification fixes"
```

---

## Self-review notes (spec coverage)

- runCustomPrompt (text/structured/none) → Task 7. scan/checkout model wiring → Task 8.
- Local + Docker backends → no backend code changes needed; the provider/factory are backend-agnostic (Task 8/9). Local concurrency port handling → Task 5/6 (`freePort`). Local env injection → Task 5/6 (`applyEnv`); Docker env via existing exec env (documented, no code).
- MCP → Task 4 + wired in Tasks 5/8. Skills (native) → Task 10 (Docker delivery) + `directory` in Task 7; `cliType` filtering already handled upstream by the skills resolver. Tools → Task 2. Structured output → Task 7.
- Provider switching → Task 9 (factory); runner dispatch already provider-agnostic (no change).
- Docker packaging (opencode-ai dep, glibc, PATH) → Tasks 1 + 11. Multi-arch (ECS Graviton) is a build-matrix concern: build the image per target arch with buildx; `npm ci` resolves the matching opencode binary automatically — no code change.

**Known limitation (documented in code + spec):** local-backend `applyEnv` mutates process-global `process.env`; truly parallel local-backend operations can race on overlapping env keys. The Docker backend is unaffected (isolated per-container env). Acceptable for dev; revisit only if local parallel runs become a supported production mode.
