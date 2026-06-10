# aisdk Multi-Model Coding Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `aisdk` coding-cli provider (in `@journeyman/agent-runtime`) that implements `ICodingCLI` on top of Vercel AI SDK 6, with Claude-parity tools/MCP/skills/structured-output/logs across any model vendor.

**Architecture:** A thin coding-agent layer over AI SDK 6. AI SDK supplies the model call, tool loop (`generateText` + `stopWhen`), structured output (`Output.object` + `jsonSchema`), the MCP client, and per-step callbacks. We supply: a provider class, ~6 tool implementations, a config-driven model loader (pre-bundled `@ai-sdk/*` allow-list), an MCP→tools bridge, a skills loader, and structured/logging mappers. `scanRepos`/`checkoutRepo` reuse `runCustomPrompt`.

**Tech Stack:** TypeScript (ESM, `.ts` extensions in imports), vitest, `ai` + `@ai-sdk/*`, `@modelcontextprotocol/sdk` (already a dep), `@journeyman/core`.

**Conventions for this plan (per user):** NO commit steps. The plan ends with a single typecheck (`npm run check`). Follow TDD: write the failing test, see it fail, implement, see it pass.

**Spec:** `docs/superpowers/specs/2026-06-09-aisdk-provider-design.md`

**Two plan-level decisions (from spec §15):**
- `STEP_CAP = 40` (agent-loop step cap).
- `web-fetch` ships in v1; `web-search` is unsupported (mapped to `null`).
- AI SDK structured-output key: this plan uses `experimental_output` for the call and reads `result.experimental_output ?? result.output`. If the installed `ai` version uses the stable `output` key, change the one line in `run-custom-prompt.ts` noted in Task 12.

---

## File map

**Create**
- `packages/core/src/registries/aisdk-packages.ts` — allow-list constant
- `packages/agent-runtime/src/providers/aisdk/tool-mapping.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/tools/bash.ts`
- `packages/agent-runtime/src/providers/aisdk/tools/fs.ts` (read/write/edit/search)
- `packages/agent-runtime/src/providers/aisdk/tools/web.ts`
- `packages/agent-runtime/src/providers/aisdk/tools/index.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/model.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/mcp.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/skills.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/structured.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/utils/sdk-logger.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts` (+`.test.ts`)
- `packages/agent-runtime/src/providers/aisdk/operations/scan-repos.ts`
- `packages/agent-runtime/src/providers/aisdk/operations/checkout-repo.ts`
- `packages/agent-runtime/src/providers/aisdk/index.ts`

**Modify**
- `packages/core/src/index.ts` — export aisdk-packages
- `packages/core/src/registries/provider-catalog.ts` — add aisdk entry
- `packages/core/src/registries/opencode-slots.ts` — add `codingModelSlots` alias
- `packages/coding-models/src/validate-config.ts` — validate aisdk
- `packages/agent-runtime/src/providers/tool-maps.ts` — register aisdk
- `packages/agent-runtime/src/providers/factory.ts` — `case "aisdk"`
- `packages/agent-runtime/src/index.ts` — export `AiSdkProvider`
- `packages/agent-runtime/package.json` — deps + esbuild externals
- `packages/api-server/src/routes/flows.ts` — slot surfacing for aisdk
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — slot surfacing for aisdk
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — form gates + npm dropdown

---

## Task 1: Allow-list constant in core

**Files:**
- Create: `packages/core/src/registries/aisdk-packages.ts`
- Test: `packages/core/src/registries/aisdk-packages.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/registries/aisdk-packages.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "./aisdk-packages.ts";

describe("AISDK_PROVIDER_PACKAGES", () => {
  it("includes the four bundled adapters", () => {
    const npms = AISDK_PROVIDER_PACKAGES.map((p) => p.npm);
    expect(npms).toEqual([
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/openai-compatible",
    ]);
  });

  it("flags openai-compatible as requiring a baseUrl", () => {
    const compat = AISDK_PROVIDER_PACKAGES.find((p) => p.npm === "@ai-sdk/openai-compatible");
    expect(compat?.requiresBaseUrl).toBe(true);
  });

  it("isAiSdkPackage recognizes only allow-listed packages", () => {
    expect(isAiSdkPackage("@ai-sdk/anthropic")).toBe(true);
    expect(isAiSdkPackage("@ai-sdk/cohere")).toBe(false);
    expect(isAiSdkPackage(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- aisdk-packages`
Expected: FAIL — cannot find module `./aisdk-packages.ts`.

- [ ] **Step 3: Implement**

`packages/core/src/registries/aisdk-packages.ts`
```ts
export interface AiSdkPackage {
  /** The @ai-sdk/* npm package name. Must be bundled into agent-runtime. */
  npm: string;
  /** Human label for the admin dropdown. */
  label: string;
  /** When true, a Base URL is mandatory (the generic OpenAI-compatible adapter). */
  requiresBaseUrl?: boolean;
}

/**
 * The pre-bundled AI-SDK provider packages the `aisdk` coding provider can load.
 * Single source of truth for the admin dropdown, config validation, and the
 * runtime model loader. Adding a vendor here also requires adding the dep to
 * agent-runtime and rebuilding the runner image.
 */
export const AISDK_PROVIDER_PACKAGES: AiSdkPackage[] = [
  { npm: "@ai-sdk/anthropic",         label: "Anthropic (Claude)" },
  { npm: "@ai-sdk/openai",            label: "OpenAI (GPT)" },
  { npm: "@ai-sdk/google",            label: "Google (Gemini)" },
  { npm: "@ai-sdk/openai-compatible", label: "OpenAI-compatible (local / gateway / Azure)", requiresBaseUrl: true },
];

export function isAiSdkPackage(npm: string | undefined): boolean {
  return Boolean(npm) && AISDK_PROVIDER_PACKAGES.some((p) => p.npm === npm);
}
```

Append to `packages/core/src/index.ts` (next to the other registry exports):
```ts
export { AISDK_PROVIDER_PACKAGES, isAiSdkPackage, type AiSdkPackage } from "./registries/aisdk-packages.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/core -- aisdk-packages`
Expected: PASS (3 tests).

---

## Task 2: Register the provider in the catalog

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts:31`

- [ ] **Step 1: Add the catalog entry**

In `PROVIDER_CATALOG`, immediately after the `opencode` entry, add:
```ts
  { kind: "coding-cli", value: "aisdk", label: "AI SDK (multi-model)", implemented: true, slots: [] },
```

- [ ] **Step 2: Verify the catalog test still passes**

Run: `npm test -w @journeyman/core -- provider-catalog`
Expected: PASS (existing tests unaffected; one default per kind still holds — `claude` keeps `isDefault`).

---

## Task 3: Generalize secret-slot surfacing

**Files:**
- Modify: `packages/core/src/registries/opencode-slots.ts`
- Test: `packages/core/src/registries/coding-model-slots.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/registries/coding-model-slots.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { codingModelSlots } from "./opencode-slots.ts";

describe("codingModelSlots", () => {
  it("returns the declared key slot", () => {
    expect(codingModelSlots({ apiKeySlot: "ANTHROPIC_API_KEY" })).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] for a keyless model", () => {
    expect(codingModelSlots({})).toEqual([]);
    expect(codingModelSlots(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- coding-model-slots`
Expected: FAIL — `codingModelSlots` is not exported.

- [ ] **Step 3: Implement (add alias, keep the old name)**

In `packages/core/src/registries/opencode-slots.ts`, add below the existing `openCodeModelSlots` function:
```ts
/**
 * Generic alias of openCodeModelSlots: any coding model that declares a key on
 * its config (OpenCode or aisdk) surfaces exactly that slot. Keyless → [].
 */
export const codingModelSlots = openCodeModelSlots;
```
Export it from `packages/core/src/index.ts` wherever `openCodeModelSlots` is exported (add `codingModelSlots` to that export list).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/core -- coding-model-slots`
Expected: PASS (2 tests).

---

## Task 4: Validate aisdk model config

**Files:**
- Modify: `packages/coding-models/src/validate-config.ts`
- Test: `packages/coding-models/src/validate-config.test.ts`

- [ ] **Step 1: Write the failing test (append cases)**

Append to `packages/coding-models/src/validate-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateCodingModelConfig } from "./validate-config.ts";

describe("validateCodingModelConfig (aisdk)", () => {
  it("rejects an unsupported npm package", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/cohere" })).toMatch(/npm/);
  });
  it("requires baseUrl for openai-compatible", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/openai-compatible" })).toMatch(/baseUrl/);
  });
  it("accepts a valid anthropic config", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/anthropic", apiKeySlot: "ANTHROPIC_API_KEY" })).toBeNull();
  });
  it("accepts openai-compatible with a baseUrl", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/openai-compatible", baseUrl: "http://x/v1" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/coding-models -- validate-config`
Expected: FAIL — aisdk currently returns null (no validation), so the reject/require cases fail.

- [ ] **Step 3: Implement**

Replace the body of `validateCodingModelConfig` in `packages/coding-models/src/validate-config.ts`:
```ts
import type { CodingModelConfig } from "@journeyman/core";
import { isAiSdkPackage } from "@journeyman/core";

export function validateCodingModelConfig(
  provider: string,
  config: CodingModelConfig | undefined,
): string | null {
  if (provider === "aisdk") {
    if (!config) return null;
    if (config.npm !== undefined && !isAiSdkPackage(config.npm)) {
      return `config.npm must be a bundled AI-SDK package; got ${config.npm}`;
    }
    if ((config.npm ?? "@ai-sdk/openai-compatible") === "@ai-sdk/openai-compatible" && !config.baseUrl?.trim()) {
      return "config.baseUrl is required for @ai-sdk/openai-compatible";
    }
    if (config.baseUrl !== undefined) {
      try { new URL(config.baseUrl); } catch { return `config.baseUrl is not a valid URL: ${config.baseUrl}`; }
    }
    if (config.apiKeySlot !== undefined && !config.apiKeySlot.trim()) {
      return "config.apiKeySlot must be a non-empty string";
    }
    return null;
  }

  if (provider !== "opencode" || !config) return null;

  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
      return "config.baseUrl must be a non-empty string";
    }
    try { new URL(config.baseUrl); } catch { return `config.baseUrl is not a valid URL: ${config.baseUrl}`; }
  }
  if (config.npm !== undefined && (typeof config.npm !== "string" || !config.npm.trim())) {
    return "config.npm must be a non-empty string";
  }
  if (config.apiKeySlot !== undefined && (typeof config.apiKeySlot !== "string" || !config.apiKeySlot.trim())) {
    return "config.apiKeySlot must be a non-empty string";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/coding-models -- validate-config`
Expected: PASS (existing opencode cases + 4 new aisdk cases).

---

## Task 5: Tool mapping

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/tool-mapping.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tool-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/tool-mapping.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { AISDK_TOOL_MAP, aiSdkToolIds } from "./tool-mapping.ts";

describe("aiSdkToolIds", () => {
  it("maps canonical tools to native ids", () => {
    expect(aiSdkToolIds(["bash"])).toEqual(["bash"]);
    expect(aiSdkToolIds(["read-file", "write-file", "edit-file"])).toEqual(["read", "write", "edit"]);
    expect(aiSdkToolIds(["search"])).toEqual(["search"]);
    expect(aiSdkToolIds(["web-fetch"])).toEqual(["web_fetch"]);
  });
  it("dedupes and skips unsupported (web-search)", () => {
    expect(aiSdkToolIds(["search", "search"])).toEqual(["search"]);
    expect(aiSdkToolIds(["web-search"])).toEqual([]);
  });
  it("returns [] for a pure-prompt step", () => {
    expect(aiSdkToolIds([])).toEqual([]);
  });
  it("web-search maps to null in the map", () => {
    expect(AISDK_TOOL_MAP["web-search"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tool-mapping`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/tool-mapping.ts`
```ts
import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

/** Canonical → native aisdk tool ids. `null` = unsupported (flagged by unsupportedTools). */
export const AISDK_TOOL_MAP: ProviderToolMap = {
  "bash":       ["bash"],
  "read-file":  ["read"],
  "write-file": ["write"],
  "edit-file":  ["edit"],
  "search":     ["search"],
  "web-fetch":  ["web_fetch"],
  "web-search": null,
};

/** Native tool ids to include for the given canonical tools (deduped, order-stable). */
export function aiSdkToolIds(tools: readonly CanonicalTool[]): string[] {
  const out: string[] = [];
  for (const t of tools) {
    const native = AISDK_TOOL_MAP[t];
    if (!native) continue;
    for (const id of native) if (!out.includes(id)) out.push(id);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tool-mapping`
Expected: PASS.

---

## Task 6: Bash tool

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/tools/bash.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tools/bash.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/tools/bash.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { runBash } from "./bash.ts";

describe("runBash", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runBash("echo hello", {});
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
  });
  it("captures a non-zero exit code", async () => {
    const r = await runBash("exit 3", {});
    expect(r.exitCode).toBe(3);
  });
  it("injects env values", async () => {
    const r = await runBash("echo $FOO", { env: { FOO: "bar" } });
    expect(r.stdout.trim()).toBe("bar");
  });
  it("runs in the given cwd", async () => {
    const r = await runBash("pwd", { cwd: "/tmp" });
    expect(r.stdout.trim()).toMatch(/\/tmp$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/bash`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/tools/bash.ts`
```ts
import { spawn } from "node:child_process";
import { tool, jsonSchema } from "ai";

export interface ToolCtx {
  cwd?: string;
  env?: Record<string, string>;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 100_000;

export function runBash(command: string, ctx: ToolCtx, signal?: AbortSignal): Promise<BashResult> {
  return new Promise<BashResult>((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.cwd,
      env: { ...process.env, ...(ctx.env ?? {}) },
      signal,
    });
    let stdout = "";
    let stderr = "";
    const cap = (cur: string, chunk: Buffer) =>
      cur.length < MAX_OUTPUT ? cur + chunk.toString("utf8") : cur;
    child.stdout.on("data", (c) => { stdout = cap(stdout, c); });
    child.stderr.on("data", (c) => { stderr = cap(stderr, c); });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String((err as Error).message), exitCode: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export function bashTool(ctx: ToolCtx) {
  return tool({
    description: "Run a shell command in the workspace and return its stdout, stderr, and exit code.",
    inputSchema: jsonSchema<{ command: string }>({
      type: "object",
      properties: { command: { type: "string", description: "The shell command to run." } },
      required: ["command"],
    }),
    execute: async ({ command }, { abortSignal }) => runBash(command, ctx, abortSignal),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/bash`
Expected: PASS (4 tests).

---

## Task 7: Filesystem tools (read/write/edit/search)

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/tools/fs.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tools/fs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/tools/fs.test.ts`
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileImpl, writeFileImpl, editFileImpl } from "./fs.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aisdk-fs-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("fs tool impls", () => {
  it("writes then reads a file (paths resolved against cwd)", async () => {
    await writeFileImpl({ path: "a.txt", content: "hi" }, { cwd: dir });
    const r = await readFileImpl({ path: "a.txt" }, { cwd: dir });
    expect(r.content).toBe("hi");
  });
  it("edits a file by replacing a unique string", async () => {
    writeFileSync(join(dir, "b.txt"), "one two three");
    await editFileImpl({ path: "b.txt", oldString: "two", newString: "TWO" }, { cwd: dir });
    const r = await readFileImpl({ path: "b.txt" }, { cwd: dir });
    expect(r.content).toBe("one TWO three");
  });
  it("edit fails when oldString is not unique", async () => {
    writeFileSync(join(dir, "c.txt"), "x x");
    await expect(editFileImpl({ path: "c.txt", oldString: "x", newString: "y" }, { cwd: dir })).rejects.toThrow(/unique|not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/fs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/tools/fs.ts`
```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { tool, jsonSchema } from "ai";
import type { ToolCtx } from "./bash.ts";

const resolve = (ctx: ToolCtx, p: string) => (isAbsolute(p) ? p : join(ctx.cwd ?? process.cwd(), p));

export async function readFileImpl(args: { path: string }, ctx: ToolCtx): Promise<{ content: string }> {
  return { content: await readFile(resolve(ctx, args.path), "utf8") };
}

export async function writeFileImpl(args: { path: string; content: string }, ctx: ToolCtx): Promise<{ ok: true }> {
  const full = resolve(ctx, args.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, args.content, "utf8");
  return { ok: true };
}

export async function editFileImpl(
  args: { path: string; oldString: string; newString: string },
  ctx: ToolCtx,
): Promise<{ ok: true }> {
  const full = resolve(ctx, args.path);
  const cur = await readFile(full, "utf8");
  const count = cur.split(args.oldString).length - 1;
  if (count === 0) throw new Error(`edit: oldString not found in ${args.path}`);
  if (count > 1) throw new Error(`edit: oldString not unique in ${args.path} (${count} matches)`);
  await writeFile(full, cur.replace(args.oldString, args.newString), "utf8");
  return { ok: true };
}

export function searchImpl(args: { pattern: string }, ctx: ToolCtx): Promise<{ matches: string }> {
  return new Promise((resolveP) => {
    const child = spawn("rg", ["--no-heading", "-n", args.pattern], { cwd: ctx.cwd });
    let out = "";
    child.stdout.on("data", (c) => { out += c.toString("utf8"); });
    child.on("error", () => resolveP({ matches: "" }));
    child.on("close", () => resolveP({ matches: out.slice(0, 100_000) }));
  });
}

export function readTool(ctx: ToolCtx) {
  return tool({
    description: "Read a file's contents.",
    inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
    execute: (a: { path: string }) => readFileImpl(a, ctx),
  });
}
export function writeTool(ctx: ToolCtx) {
  return tool({
    description: "Write (create or overwrite) a file.",
    inputSchema: jsonSchema<{ path: string; content: string }>({ type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }),
    execute: (a: { path: string; content: string }) => writeFileImpl(a, ctx),
  });
}
export function editTool(ctx: ToolCtx) {
  return tool({
    description: "Replace a unique string in a file.",
    inputSchema: jsonSchema<{ path: string; oldString: string; newString: string }>({ type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] }),
    execute: (a: { path: string; oldString: string; newString: string }) => editFileImpl(a, ctx),
  });
}
export function searchTool(ctx: ToolCtx) {
  return tool({
    description: "Search file contents with ripgrep.",
    inputSchema: jsonSchema<{ pattern: string }>({ type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }),
    execute: (a: { pattern: string }) => searchImpl(a, ctx),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/fs`
Expected: PASS (3 tests).

---

## Task 8: Web-fetch tool

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/tools/web.ts`

- [ ] **Step 1: Implement (thin; no separate unit test — exercised via tools/index)**

`packages/agent-runtime/src/providers/aisdk/tools/web.ts`
```ts
import { tool, jsonSchema } from "ai";

export async function webFetchImpl(args: { url: string }): Promise<{ status: number; body: string }> {
  const res = await fetch(args.url);
  const body = (await res.text()).slice(0, 100_000);
  return { status: res.status, body };
}

export function webFetchTool() {
  return tool({
    description: "Fetch a URL and return its status and body text (truncated).",
    inputSchema: jsonSchema<{ url: string }>({ type: "object", properties: { url: { type: "string" } }, required: ["url"] }),
    execute: (a: { url: string }) => webFetchImpl(a),
  });
}
```

---

## Task 9: Tool assembler

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/tools/index.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tools/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/tools/index.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { buildBuiltinTools } from "./index.ts";

describe("buildBuiltinTools", () => {
  it("includes only the requested native tool ids", () => {
    const tools = buildBuiltinTools(["bash", "read"], { cwd: "/tmp" });
    expect(Object.keys(tools).sort()).toEqual(["bash", "read"]);
  });
  it("returns {} for a pure-prompt step", () => {
    expect(buildBuiltinTools([], {})).toEqual({});
  });
  it("maps web_fetch id to the web-fetch tool", () => {
    const tools = buildBuiltinTools(["web_fetch"], {});
    expect(Object.keys(tools)).toEqual(["web_fetch"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/index`
Expected: FAIL — `buildBuiltinTools` not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/tools/index.ts`
```ts
import type { ToolCtx } from "./bash.ts";
import { bashTool } from "./bash.ts";
import { readTool, writeTool, editTool, searchTool } from "./fs.ts";
import { webFetchTool } from "./web.ts";

type ToolFactory = (ctx: ToolCtx) => unknown;

const BUILTINS: Record<string, ToolFactory> = {
  bash: bashTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  search: searchTool,
  web_fetch: () => webFetchTool(),
};

/** Build the AI SDK tools record for the requested native ids. Unknown ids are skipped. */
export function buildBuiltinTools(ids: readonly string[], ctx: ToolCtx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const make = BUILTINS[id];
    if (make) out[id] = make(ctx);
  }
  return out;
}

export type { ToolCtx };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/tools/index`
Expected: PASS (3 tests).

---

## Task 10: Model loader

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/model.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/model.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/model.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { resolveModel, configError } from "./model.ts";

const fakeAnthropic = {
  createAnthropic: (o: { apiKey?: string; baseURL?: string }) => (id: string) => ({ vendor: "anthropic", id, key: o.apiKey }),
};
const fakeCompat = {
  createOpenAICompatible: (o: { baseURL?: string; apiKey?: string }) => (id: string) => ({ vendor: "compat", id, baseURL: o.baseURL }),
};

describe("resolveModel", () => {
  const importer = async (npm: string) => (npm === "@ai-sdk/anthropic" ? fakeAnthropic : fakeCompat);

  it("loads anthropic and passes the resolved api key", async () => {
    const m: any = await resolveModel(
      { modelId: "claude-sonnet-4-6", config: { npm: "@ai-sdk/anthropic", apiKeySlot: "ANTHROPIC_API_KEY" }, env: { ANTHROPIC_API_KEY: "sk-1" } },
      { importer },
    );
    expect(m).toMatchObject({ vendor: "anthropic", id: "claude-sonnet-4-6", key: "sk-1" });
  });

  it("errors when model is missing", async () => {
    await expect(resolveModel({ modelId: undefined, config: {} }, { importer })).rejects.toThrow(/requires a model/);
  });

  it("errors on an unsupported package", async () => {
    await expect(resolveModel({ modelId: "x", config: { npm: "@ai-sdk/cohere" } }, { importer })).rejects.toThrow(/Unsupported/);
  });

  it("errors when openai-compatible lacks baseUrl", async () => {
    await expect(resolveModel({ modelId: "x", config: { npm: "@ai-sdk/openai-compatible" } }, { importer })).rejects.toThrow(/baseUrl/);
  });

  it("configError carries the ConfigurationError name", () => {
    expect(configError("x").name).toBe("ConfigurationError");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/model`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/model.ts`
```ts
import type { CodingModelConfig } from "@journeyman/core";
import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "@journeyman/core";

export interface ResolveModelOpts {
  modelId: string | undefined;
  config: CodingModelConfig | undefined;
  env?: Record<string, string>;
}

export interface ResolveModelDeps {
  /** Injectable for tests; defaults to dynamic import. */
  importer?: (npm: string) => Promise<any>;
}

type ProviderFactory = (mod: any, o: { apiKey?: string; baseURL?: string }) => (modelId: string) => unknown;

const LOADERS: Record<string, ProviderFactory> = {
  "@ai-sdk/anthropic":         (m, o) => m.createAnthropic({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai":            (m, o) => m.createOpenAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/google":            (m, o) => m.createGoogleGenerativeAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai-compatible": (m, o) => m.createOpenAICompatible({ name: "custom", baseURL: o.baseURL, apiKey: o.apiKey }),
};

export function configError(message: string): Error {
  const e = new Error(message) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}

export async function resolveModel(opts: ResolveModelOpts, deps: ResolveModelDeps = {}): Promise<unknown> {
  if (!opts.modelId) throw configError("aisdk provider requires a model");
  const npm = opts.config?.npm ?? "@ai-sdk/openai-compatible";
  if (!isAiSdkPackage(npm) || !LOADERS[npm]) {
    throw configError(`Unsupported aisdk provider package: ${npm}. Allowed: ${AISDK_PROVIDER_PACKAGES.map((p) => p.npm).join(", ")}`);
  }
  if (npm === "@ai-sdk/openai-compatible" && !opts.config?.baseUrl?.trim()) {
    throw configError("@ai-sdk/openai-compatible requires config.baseUrl");
  }
  const slot = opts.config?.apiKeySlot;
  const apiKey = slot ? (opts.env?.[slot] ?? process.env[slot]) : undefined;
  const importer = deps.importer ?? ((n: string) => import(n));
  let mod: any;
  try { mod = await importer(npm); }
  catch { throw configError(`aisdk provider package not bundled: ${npm}. Add it to agent-runtime deps and rebuild the runner image.`); }
  const provider = LOADERS[npm](mod, { apiKey, baseURL: opts.config?.baseUrl });
  return provider(opts.modelId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/model`
Expected: PASS (5 tests).

---

## Task 11: MCP bridge

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/mcp.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/mcp.test.ts`

- [ ] **Step 1: Write the failing test (inject the client factory)**

`packages/agent-runtime/src/providers/aisdk/mcp.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { buildMcpTools } from "./mcp.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

function fakeClientFactory() {
  const closed: string[] = [];
  const create = async (label: string) => ({
    tools: async () => ({ search: { description: label }, fetch: { description: label } }),
    close: async () => { closed.push(label); },
  });
  return { create, closed };
}

describe("buildMcpTools", () => {
  it("prefixes tools with mcp__<name>__ and suffixes name collisions", async () => {
    const f = fakeClientFactory();
    const insts: ResolvedMcpInstance[] = [
      { id: "1", name: "files", transport: "stdio", command: "x", args: [], env: {} },
      { id: "2", name: "files", transport: "stdio", command: "y", args: [], env: {} },
    ];
    let n = 0;
    const { tools, close } = await buildMcpTools(insts, { createClient: () => f.create(`c${n++}`) });
    expect(Object.keys(tools).sort()).toEqual([
      "mcp__files-2__fetch", "mcp__files-2__search", "mcp__files__fetch", "mcp__files__search",
    ]);
    await close();
    expect(f.closed.length).toBe(2);
  });

  it("returns empty tools for no instances", async () => {
    const { tools } = await buildMcpTools([], { createClient: async () => ({ tools: async () => ({}), close: async () => {} }) });
    expect(tools).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/mcp`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/mcp.ts`
```ts
import { experimental_createMCPClient } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import type { ResolvedMcpInstance } from "@journeyman/core";

interface McpClient {
  tools: () => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}

export interface BuildMcpDeps {
  /** Injectable for tests; defaults to the AI SDK MCP client. */
  createClient?: (inst: ResolvedMcpInstance) => Promise<McpClient>;
}

function toHeaders(env: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) h[k.toUpperCase() === "AUTHORIZATION" ? "Authorization" : k] = v;
  return h;
}

async function defaultCreate(inst: ResolvedMcpInstance): Promise<McpClient> {
  const transport =
    inst.transport === "stdio"
      ? new Experimental_StdioMCPTransport({ command: inst.command ?? "", args: inst.args ?? [], env: inst.env })
      : { type: "sse" as const, url: inst.url ?? "", headers: toHeaders(inst.env) };
  return (await experimental_createMCPClient({ transport })) as unknown as McpClient;
}

export async function buildMcpTools(
  instances: ResolvedMcpInstance[],
  deps: BuildMcpDeps = {},
): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }> {
  const create = deps.createClient ?? defaultCreate;
  const clients: McpClient[] = [];
  const tools: Record<string, unknown> = {};
  const seen = new Map<string, number>();

  for (const inst of instances) {
    const client = await create(inst);
    clients.push(client);
    const n = (seen.get(inst.name) ?? 0) + 1;
    seen.set(inst.name, n);
    const key = n === 1 ? inst.name : `${inst.name}-${n}`;
    const provided = await client.tools();
    for (const [name, def] of Object.entries(provided)) tools[`mcp__${key}__${name}`] = def;
  }

  return {
    tools,
    close: async () => { for (const c of clients) await c.close().catch(() => {}); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/mcp`
Expected: PASS (2 tests).

---

## Task 12: Skills loader

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/skills.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/skills.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/skills.test.ts`
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillMenu, readSkillBody } from "./skills.ts";
import type { ResolvedSkillPackage } from "@journeyman/core";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aisdk-skills-"));
  mkdirSync(join(dir, "pdf"));
  writeFileSync(join(dir, "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Work with PDFs\n---\nDo PDF things.");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pkg = (): ResolvedSkillPackage => ({ id: "1", name: "docs", localPath: dir, enabledSkills: ["pdf"], cliType: "claude" });

describe("skills", () => {
  it("builds a menu listing enabled skills with descriptions", () => {
    const menu = buildSkillMenu([pkg()]);
    expect(menu).toContain("pdf");
    expect(menu).toContain("Work with PDFs");
  });
  it("reads a skill body by name", async () => {
    expect(await readSkillBody([pkg()], "pdf")).toContain("Do PDF things.");
  });
  it("returns a not-found message for an unknown skill", async () => {
    expect(await readSkillBody([pkg()], "nope")).toMatch(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/skills`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/skills.ts`
```ts
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tool, jsonSchema } from "ai";
import type { ResolvedSkillPackage } from "@journeyman/core";

/** Candidate SKILL.md paths for a named skill within a package dir. */
function skillPaths(localPath: string, name: string): string[] {
  return [join(localPath, name, "SKILL.md"), join(localPath, "SKILL.md")];
}

function descriptionOf(localPath: string, name: string): string {
  for (const p of skillPaths(localPath, name)) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const m = text.match(/^description:\s*(.+)$/m);
    return m ? m[1].trim() : "";
  }
  return "";
}

/** A system-prompt fragment listing the enabled skills (name + description). */
export function buildSkillMenu(skills: ResolvedSkillPackage[]): string {
  const lines: string[] = [];
  for (const pkg of skills) {
    for (const name of pkg.enabledSkills) {
      const desc = descriptionOf(pkg.localPath, name);
      lines.push(`- ${name}${desc ? `: ${desc}` : ""}`);
    }
  }
  if (lines.length === 0) return "";
  return ["## Available skills", "Call the `Skill` tool with a skill name to load its full instructions, then follow them.", ...lines].join("\n");
}

/** Read the full body for a named enabled skill, or a not-found message. */
export async function readSkillBody(skills: ResolvedSkillPackage[], name: string): Promise<string> {
  for (const pkg of skills) {
    if (!pkg.enabledSkills.includes(name)) continue;
    for (const p of skillPaths(pkg.localPath, name)) {
      if (existsSync(p)) return readFile(p, "utf8");
    }
  }
  return `Skill "${name}" not found.`;
}

export function skillTool(skills: ResolvedSkillPackage[]) {
  return tool({
    description: "Load the full instructions for a named skill from the available-skills list.",
    inputSchema: jsonSchema<{ name: string }>({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
    execute: ({ name }: { name: string }) => readSkillBody(skills, name),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/skills`
Expected: PASS (3 tests).

---

## Task 13: Structured-output + logging mappers

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/structured.ts`
- Create: `packages/agent-runtime/src/providers/aisdk/utils/sdk-logger.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/utils/sdk-logger.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent-runtime/src/providers/aisdk/utils/sdk-logger.test.ts`
```ts
import { describe, it, expect, vi } from "vitest";
import { makeStepLogger, logFinal } from "./sdk-logger.ts";

describe("makeStepLogger", () => {
  it("logs tool calls at medium, results+text only at all", () => {
    const onLog = vi.fn();
    const step = { text: "hi", toolCalls: [{ toolName: "bash", input: { command: "ls" } }], toolResults: [{ toolName: "bash", output: { exitCode: 0 } }] };

    makeStepLogger(onLog, "medium")(step as any);
    const medium = onLog.mock.calls.map((c) => c[0] as string);
    expect(medium.some((l) => l.startsWith("🔧 tool: bash"))).toBe(true);
    expect(medium.some((l) => l.startsWith("🤖 assistant"))).toBe(false);

    onLog.mockClear();
    makeStepLogger(onLog, "all")(step as any);
    const all = onLog.mock.calls.map((c) => c[0] as string);
    expect(all.some((l) => l.startsWith("🤖 assistant"))).toBe(true);
    expect(all.some((l) => l.startsWith("📥 tool_result"))).toBe(true);
  });

  it("emits nothing at level none", () => {
    const onLog = vi.fn();
    makeStepLogger(onLog, "none")({ text: "x", toolCalls: [], toolResults: [] } as any);
    expect(onLog).not.toHaveBeenCalled();
  });

  it("logFinal emits a success line at light+", () => {
    const onLog = vi.fn();
    logFinal(true, undefined, onLog, "light");
    expect(onLog.mock.calls[0][0]).toMatch(/✅ result: success/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/utils/sdk-logger`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both modules**

`packages/agent-runtime/src/providers/aisdk/utils/sdk-logger.ts`
```ts
import { createLogger, type AgentLogLevel, type CodingCliLogFn } from "@journeyman/core";

const log = createLogger("aisdk:sdk");
const MAX = 200;

function singleLine(s: string, max = MAX): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
function summarize(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.command === "string") return `$ ${singleLine(inp.command, 120)}`;
  if (typeof inp.path === "string") return singleLine(inp.path, 120);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 120);
  if (typeof inp.url === "string") return singleLine(inp.url, 120);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

interface StepLike {
  text?: string;
  toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
}

export function makeStepLogger(onLog?: CodingCliLogFn, level: AgentLogLevel = "all") {
  const ui = onLog && level !== "none" ? onLog : undefined;
  return (step: StepLike): void => {
    if (step.text) log.debug({ text: step.text }, "assistant");
    if (ui && level === "all" && step.text) ui(singleLine(`🤖 assistant: ${step.text}`), {});
    for (const c of step.toolCalls ?? []) {
      const name = c.toolName ?? "tool";
      log.debug({ tool: name }, "tool use");
      if (ui && (level === "medium" || level === "all")) {
        const a = summarize(c.input ?? c.args);
        ui(singleLine(a ? `🔧 tool: ${name}(${a})` : `🔧 tool: ${name}`), {});
      }
    }
    for (const r of step.toolResults ?? []) {
      if (ui && level === "all") {
        const out = r.output ?? r.result;
        const isErr = Boolean((out as any)?.exitCode) || Boolean((out as any)?.error);
        ui(`📥 tool_result: ${isErr ? "error" : "ok"}`, {});
      }
    }
  };
}

export function logFinal(ok: boolean, reason: string | undefined, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  log.debug({ ok, reason }, "aisdk done");
  if (!onLog || level === "none") return;
  if (level === "light" || level === "medium" || level === "all") {
    onLog(ok ? "✅ result: success" : `❌ result: ${reason ?? "failure"}`, {});
  }
}
```

`packages/agent-runtime/src/providers/aisdk/structured.ts`
```ts
import { Output, jsonSchema } from "ai";

/** Build the AI SDK structured-output spec from a raw JSON Schema, or undefined. */
export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/utils/sdk-logger`
Expected: PASS (3 tests).

---

## Task 14: runCustomPrompt (the orchestrator)

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Write the failing test (mock `ai` + `./model.ts`)**

`packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts`
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (args: unknown) => generateText(args),
  stepCountIs: (n: number) => n,
  Output: { object: (x: unknown) => x },
  jsonSchema: (x: unknown) => x,
  tool: (x: unknown) => x,
}));
vi.mock("../model.ts", () => ({
  resolveModel: vi.fn(async () => ({ fake: "model" })),
  configError: (m: string) => Object.assign(new Error(m), { name: "ConfigurationError" }),
}));

import { runCustomPrompt } from "./run-custom-prompt.ts";

beforeEach(() => generateText.mockReset());

describe("runCustomPrompt (aisdk)", () => {
  it("returns text for outputMode=text", async () => {
    generateText.mockResolvedValue({ text: "the answer", steps: [] });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "anthropic-id", modelConfig: { npm: "@ai-sdk/anthropic" } } as any);
    expect(r.result).toBe("the answer");
    expect(r.sessionId).toBeTruthy();
  });

  it("returns structured output for outputMode=structured", async () => {
    generateText.mockResolvedValue({ text: "", experimental_output: { ok: true }, steps: [] });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "structured", outputSchema: { type: "object" }, model: "x", modelConfig: {} } as any);
    expect(r.structured).toEqual({ ok: true });
  });

  it("errors when structured mode has no schema", async () => {
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "structured", model: "x", modelConfig: {} } as any);
    expect(r.error).toMatch(/outputSchema/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("captures thrown errors into result.error", async () => {
    generateText.mockRejectedValue(new Error("boom"));
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "x", modelConfig: {} } as any);
    expect(r.error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/operations/run-custom-prompt`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`
```ts
import { generateText, stepCountIs } from "ai";
import { createLogger } from "@journeyman/core";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";
import { resolveModel } from "../model.ts";
import { aiSdkToolIds } from "../tool-mapping.ts";
import { buildBuiltinTools } from "../tools/index.ts";
import { buildMcpTools } from "../mcp.ts";
import { buildSkillMenu, skillTool } from "../skills.ts";
import { buildOutput } from "../structured.ts";
import { makeStepLogger, logFinal } from "../utils/sdk-logger.ts";

const log = createLogger("aisdk:custom-prompt");
const STEP_CAP = 40;

export async function runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const level = opts.agentLogLevel ?? "all";

  if (opts.outputMode === "structured" && !opts.outputSchema) {
    return { sessionId, error: "outputMode='structured' requires outputSchema" };
  }

  log.info({ sessionId, outputMode: opts.outputMode, mcpCount: opts.mcps?.length ?? 0, skillCount: opts.skills?.length ?? 0 }, "runCustomPrompt start");

  let mcp: { tools: Record<string, unknown>; close: () => Promise<void> } = { tools: {}, close: async () => {} };
  try {
    const model = await resolveModel({ modelId: opts.model, config: opts.modelConfig, env: opts.env });
    const ctx = { cwd: opts.cwd, env: opts.env };

    const builtin = buildBuiltinTools(aiSdkToolIds(opts.tools ?? []), ctx);
    if (opts.mcps?.length) mcp = await buildMcpTools(opts.mcps);
    const skills = opts.skills ?? [];
    const skillTools = skills.length ? { Skill: skillTool(skills) } : {};
    const tools = { ...builtin, ...mcp.tools, ...skillTools };
    const hasTools = Object.keys(tools).length > 0;

    const prompt = [opts.prompt, buildSkillMenu(skills)].filter(Boolean).join("\n\n");

    const result: any = await generateText({
      model,
      prompt,
      ...(hasTools ? { tools } : {}),
      stopWhen: stepCountIs(STEP_CAP),
      // NOTE: if the installed `ai` version uses the stable `output` key, rename
      // this to `output` (and the read below to result.output only).
      ...(opts.outputMode === "structured" ? { experimental_output: buildOutput(opts.outputSchema) } : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
      onStepFinish: makeStepLogger(opts.onLog, level),
    } as any);

    logFinal(true, undefined, opts.onLog, level);
    log.info({ sessionId }, "runCustomPrompt done");

    if (opts.outputMode === "none") return { sessionId };
    if (opts.outputMode === "text") return { sessionId, result: typeof result.text === "string" ? result.text : "" };
    return { sessionId, structured: result.experimental_output ?? result.output };
  } catch (err) {
    const error = String((err as Error)?.message ?? err);
    logFinal(false, error, opts.onLog, level);
    log.error({ sessionId, error }, "runCustomPrompt threw");
    return { sessionId, error };
  } finally {
    await mcp.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/operations/run-custom-prompt`
Expected: PASS (4 tests).

---

## Task 15: scanRepos + checkoutRepo (reuse runCustomPrompt)

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/operations/scan-repos.ts`
- Create: `packages/agent-runtime/src/providers/aisdk/operations/checkout-repo.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/operations/scan-repos.test.ts`

- [ ] **Step 1: Write the failing test (mock runCustomPrompt)**

`packages/agent-runtime/src/providers/aisdk/operations/scan-repos.test.ts`
```ts
import { describe, it, expect, vi } from "vitest";

const runCustomPrompt = vi.fn();
vi.mock("./run-custom-prompt.ts", () => ({ runCustomPrompt: (o: unknown) => runCustomPrompt(o) }));

import { scanRepos } from "./scan-repos.ts";

describe("scanRepos (aisdk)", () => {
  it("drives a structured bash-only agent and maps the result", async () => {
    runCustomPrompt.mockResolvedValue({ sessionId: "s1", structured: { repos: [{ folderName: "a", repoDir: "/x/a", isGitRepo: true }] } });
    const r = await scanRepos({ parentDir: "/x", model: "anthropic-id" } as any);
    expect(r.sessionId).toBe("s1");
    expect(r.repos[0].folderName).toBe("a");
    const call = runCustomPrompt.mock.calls[0][0];
    expect(call.outputMode).toBe("structured");
    expect(call.tools).toEqual(["bash"]);
  });

  it("propagates errors as an empty repos result", async () => {
    runCustomPrompt.mockResolvedValue({ sessionId: "s2", error: "nope" });
    const r = await scanRepos({ parentDir: "/x" } as any);
    expect(r).toEqual({ repos: [], sessionId: "s2", error: "nope" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/operations/scan-repos`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both**

`packages/agent-runtime/src/providers/aisdk/operations/scan-repos.ts`
```ts
import type { ScanReposOptions, ScanReposResult, CodingModelConfig } from "@journeyman/core";
import { runCustomPrompt } from "./run-custom-prompt.ts";

const SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" }, repoDir: { type: "string" },
          url: { type: "string" }, branch: { type: "string" }, isGitRepo: { type: "boolean" },
        },
        required: ["folderName", "repoDir", "isGitRepo"],
      },
    },
  },
  required: ["repos"],
} as const;

function buildPrompt(parentDir: string): string {
  return [
    `List all immediate subdirectories of: ${parentDir}`,
    "For each subdirectory:",
    "  1. Check if it is a git repo (look for a .git folder inside it)",
    "  2. If it is, get its remote origin URL via: git -C <repoDir> remote get-url origin",
    "  3. If it is, get its current branch via: git -C <repoDir> branch --show-current",
    "Return JSON with a repos array of { folderName, repoDir, isGitRepo, url?, branch? }.",
  ].join("\n");
}

export async function scanRepos(
  opts: ScanReposOptions & { model?: string; modelConfig?: CodingModelConfig },
): Promise<ScanReposResult> {
  const r = await runCustomPrompt({
    prompt: buildPrompt(opts.parentDir),
    outputMode: "structured",
    outputSchema: SCHEMA as unknown as Record<string, unknown>,
    tools: ["bash"],
    model: opts.model,
    modelConfig: opts.modelConfig,
    sessionId: opts.sessionId,
  } as any);
  if (r.error) return { repos: [], sessionId: r.sessionId, error: r.error };
  const structured = (r.structured as { repos?: ScanReposResult["repos"] } | undefined) ?? { repos: [] };
  return { repos: structured.repos ?? [], sessionId: r.sessionId };
}
```

`packages/agent-runtime/src/providers/aisdk/operations/checkout-repo.ts`
```ts
import type { CheckoutEntry, CheckoutRepoOptions, CheckoutRepoResult, CodingModelConfig } from "@journeyman/core";
import { runCustomPrompt } from "./run-custom-prompt.ts";

const SCHEMA = {
  type: "object",
  properties: {
    newBranch: { type: "string" },
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" }, repoDir: { type: "string" },
          baseBranch: { type: "string" }, newBranch: { type: "string" },
          success: { type: "boolean" }, error: { type: "string" },
        },
        required: ["folderName", "repoDir", "baseBranch", "newBranch", "success"],
      },
    },
  },
  required: ["newBranch", "repos"],
} as const;

function normalize(opts: CheckoutRepoOptions): CheckoutEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { repoDir: r, branch: opts.branch ?? "main" } : r));
}

function buildPrompt(entries: CheckoutEntry[], issue: CheckoutRepoOptions["issue"]): string {
  const steps = entries.map(({ repoDir, branch }) => `  - ${repoDir} → baseBranch: ${branch}`).join("\n");
  const naming = issue
    ? `BRANCH NAMING: "{id-lowercased}/{2-4-word-slug}_{unix-seconds}". Issue id: ${issue.id}; title: ${issue.title}.`
    : `BRANCH NAMING: "{animal-themed-slug}_{unix-seconds}" (2-3 words incl. one animal).`;
  return [
    "Sync local repos to origin, then create ONE new feature branch used across all repos.",
    naming,
    "Run `date +%s` ONCE; use that one timestamp for every repo's branch name.",
    "PER REPO: fetch origin; stash -u; checkout <baseBranch>; pull; reset --hard origin/<baseBranch>; clean -fd; checkout -b <newBranch>.",
    "Repos:", steps,
    "Return JSON: { newBranch, repos[]: { folderName, repoDir, baseBranch, newBranch, success, error? } }.",
  ].join("\n");
}

export async function checkoutRepo(
  opts: CheckoutRepoOptions & { model?: string; modelConfig?: CodingModelConfig },
): Promise<CheckoutRepoResult> {
  const entries = normalize(opts);
  if (entries.length === 0) return { repos: [], newBranch: "", sessionId: opts.sessionId };
  const r = await runCustomPrompt({
    prompt: buildPrompt(entries, opts.issue),
    outputMode: "structured",
    outputSchema: SCHEMA as unknown as Record<string, unknown>,
    tools: ["bash"],
    model: opts.model,
    modelConfig: opts.modelConfig,
    sessionId: opts.sessionId,
  } as any);
  if (r.error) return { repos: [], newBranch: "", sessionId: r.sessionId, error: r.error };
  const s = (r.structured as Partial<CheckoutRepoResult> | undefined) ?? {};
  return { repos: s.repos ?? [], newBranch: s.newBranch ?? "", sessionId: r.sessionId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- aisdk/operations/scan-repos`
Expected: PASS (2 tests).

---

## Task 16: Provider class + factory + tool-maps + exports

**Files:**
- Create: `packages/agent-runtime/src/providers/aisdk/index.ts`
- Modify: `packages/agent-runtime/src/providers/tool-maps.ts`
- Modify: `packages/agent-runtime/src/providers/factory.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/providers/factory.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

Append to `packages/agent-runtime/src/providers/factory.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCodingProvider } from "./factory.ts";
import { AiSdkProvider } from "./aisdk/index.ts";

describe("createCodingProvider (aisdk)", () => {
  it("constructs an AiSdkProvider for key 'aisdk'", () => {
    expect(createCodingProvider("aisdk", { env: {} })).toBeInstanceOf(AiSdkProvider);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agent-runtime -- providers/factory`
Expected: FAIL — `./aisdk/index.ts` not found / unknown provider `aisdk`.

- [ ] **Step 3: Implement the provider class**

`packages/agent-runtime/src/providers/aisdk/index.ts`
```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  RunCustomPromptOptions, RunCustomPromptResult,
  IProviderMeta, CodingCLIStep, CodingCLIProviderConfig,
} from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";

export class AiSdkProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "aisdk",
    name: "AI SDK (multi-model)",
    description: "Multi-vendor AI coding via Vercel AI SDK 6",
    category: "coding-cli",
  };

  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModelId(step: CodingCLIStep): string | undefined {
    return this.config.models?.[step] ?? this.config.defaultModel;
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos({ ...opts, model: opts.model ?? this.resolveModelId("scanRepos") });
  }
  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo({ ...opts, model: opts.model ?? this.resolveModelId("checkoutRepo") });
  }
  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return runCustomPrompt({ ...opts, model: opts.model ?? this.resolveModelId("runCustomPrompt") });
  }
}
```

In `packages/agent-runtime/src/providers/tool-maps.ts`:
- add import: `import { AISDK_TOOL_MAP } from "./aisdk/tool-mapping.ts";`
- change `ProviderId`: `export type ProviderId = "claude" | "gemini" | "codex" | "opencode" | "aisdk";`
- add to `PROVIDER_TOOL_MAPS`: `aisdk: AISDK_TOOL_MAP,`

In `packages/agent-runtime/src/providers/factory.ts`:
- add import: `import { AiSdkProvider } from "./aisdk/index.ts";`
- add case before `default`:
```ts
    case "aisdk":
      // Model + per-vendor credential arrive per-operation via opts.model /
      // opts.modelConfig / opts.env; the provider loads the @ai-sdk package
      // selected by config.npm at run time.
      return new AiSdkProvider();
```

In `packages/agent-runtime/src/index.ts` add:
```ts
export { AiSdkProvider } from "./providers/aisdk/index.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agent-runtime -- providers/factory`
Expected: PASS.

---

## Task 17: Packaging (deps + esbuild externals)

**Files:**
- Modify: `packages/agent-runtime/package.json`

- [ ] **Step 1: Add dependencies**

In `packages/agent-runtime/package.json` `"dependencies"`, add:
```json
    "ai": "^6.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/google": "^2.0.0",
    "@ai-sdk/openai-compatible": "^1.0.0",
```
(Exact versions: pin to the latest stable resolved by `npm install` — see Task 17 Step 3.)

- [ ] **Step 2: Add esbuild externals**

In the `"bundle"` script, append these flags before `--outfile`:
```
--external:ai --external:@ai-sdk/anthropic --external:@ai-sdk/openai --external:@ai-sdk/google --external:@ai-sdk/openai-compatible
```

- [ ] **Step 3: Install and pin**

Run: `npm install`
Expected: installs the `ai` + `@ai-sdk/*` packages; lockfile updated. Adjust the `^` versions in `package.json` to the major versions actually resolved if they differ.

---

## Task 18: Admin form — provider gates + npm dropdown

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Import the allow-list**

Near the top imports, add:
```tsx
import { AISDK_PROVIDER_PACKAGES } from "@journeyman/core";
```

- [ ] **Step 2: Widen the three opencode-only gates**

Replace each `v.provider === "opencode"` gate for the **Authentication** section (line ~263) and the **Custom endpoint** section (line ~285) with:
```tsx
{(v.provider === "opencode" || v.provider === "aisdk") && (
```
For the Model-ID `info` prop (line ~203), leave the OpenCode tooltip as-is; it only renders for `opencode`. (Optional: add an `aisdk` branch with examples `claude-sonnet-4-6`, `gpt-5.3`.)

- [ ] **Step 3: Make the npm field a dropdown for aisdk**

Replace the existing `<Field label="npm package">…</Field>` block (inside the Custom endpoint section) with:
```tsx
<Field label="npm package">
  {v.provider === "aisdk" ? (
    <select
      className={inputCls}
      value={v.config?.npm ?? ""}
      onChange={(e) => setConfig("npm", e.target.value)}
    >
      <option value="" disabled>Select a provider package…</option>
      {AISDK_PROVIDER_PACKAGES.map((p) => (
        <option key={p.npm} value={p.npm}>{p.label} — {p.npm}</option>
      ))}
    </select>
  ) : (
    <input
      className={`${inputCls} font-mono text-sm`}
      value={v.config?.npm ?? ""}
      onChange={(e) => setConfig("npm", e.target.value)}
      placeholder="@ai-sdk/openai-compatible"
    />
  )}
</Field>
```

- [ ] **Step 4: Verify the web package builds**

Run: `npm run build:web`
Expected: builds without type errors. (No unit test for this presentational change; the typecheck in Task 20 covers types.)

---

## Task 19: Step-secret surfacing for aisdk

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:87`
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx:80-86`

- [ ] **Step 1: api-server — resolve model slots for aisdk too**

In `packages/api-server/src/routes/flows.ts`, change the gate (around line 87) from:
```ts
      if (providerValue === "opencode") {
```
to:
```ts
      if (providerValue === "opencode" || providerValue === "aisdk") {
```
and update the `findCodingModel` call to use `providerValue` instead of the hard-coded `"opencode"`:
```ts
          const cm = await findCodingModel(c.pool, providerValue, effModel);
          modelSlots = openCodeModelSlots(cm?.config);
```

- [ ] **Step 2: flow-editor — show the model's key slot for aisdk**

In `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` (around line 86), change:
```ts
      ? openCodeModelSlots(codingModels.find(m => m.modelId === effectiveModelId)?.config)
```
so the surrounding condition includes `aisdk`. Update the gate near line 80–86 from:
```ts
    effectiveProvider === "opencode"
```
to:
```ts
    effectiveProvider === "opencode" || effectiveProvider === "aisdk"
```

- [ ] **Step 3: Verify the flow-editor + api-server typecheck**

Run: `npm run typecheck -w @journeyman/api-server && npm run typecheck -w @journeyman/flow-editor`
Expected: PASS (no type errors). If `npm run typecheck` is not defined per-workspace, this is covered by the root typecheck in Task 20.

---

## Task 20: Full typecheck + test sweep (final)

**Files:** none

- [ ] **Step 1: Run the agent-runtime test suite**

Run: `npm test -w @journeyman/agent-runtime`
Expected: PASS — all new aisdk tests plus existing provider tests green.

- [ ] **Step 2: Run core + coding-models tests**

Run: `npm test -w @journeyman/core && npm test -w @journeyman/coding-models`
Expected: PASS — new allow-list, slot, and validate-config tests green.

- [ ] **Step 3: Typecheck + import boundaries (the required final gate)**

Run: `npm run check`
Expected: PASS — `npm run typecheck` and `npm run check:boundaries` both clean. Fix any reported type or boundary errors before considering the feature complete.

---

## Self-review notes (already reconciled against the spec)

- **Spec §3 layout** → Tasks 5–16 create every listed file (tools split into `bash.ts`/`fs.ts`/`web.ts`/`index.ts` for focus; `structured.ts` + `utils/sdk-logger.ts` in Task 13).
- **Spec §4 model loading** → Task 10 (`resolveModel`, LOADERS registry, required model, openai-compatible baseUrl rule, allow-list error). Allow-list constant → Task 1.
- **Spec §5 tools** → Tasks 6–9; `web-search` mapped to `null` (Task 5); `web-fetch` shipped.
- **Spec §6 structured output** → Tasks 13–14 (`Output.object(jsonSchema(...))`, `stopWhen`, outputMode mapping, missing-schema error).
- **Spec §7 MCP** → Task 11 (prefix, collision-suffix, close lifecycle, stdio/sse transports).
- **Spec §8 skills** → Task 12 (menu + Skill tool, SKILL.md read).
- **Spec §9 logging** → Task 13 (`makeStepLogger`/`logFinal`, AgentLogLevel gating, emoji format).
- **Spec §10 scan/checkout** → Task 15 (reuse runCustomPrompt).
- **Spec §11 wiring** → catalog (Task 2), tool-maps + factory + exports (Task 16), validate-config (Task 4), slot surfacing (Tasks 3 + 19), admin form (Task 18), packaging (Task 17).
- **Type consistency:** `ToolCtx` defined in `tools/bash.ts` and re-used by `fs.ts`/`tools/index.ts`; `resolveModel`/`configError` names match across model.ts, run-custom-prompt.ts, and tests; `buildMcpTools` return shape `{ tools, close }` matches its consumer in Task 14; `aiSdkToolIds` native ids (`read`/`write`/`edit`/`search`/`web_fetch`/`bash`) match `BUILTINS` keys in Task 9.
- **No placeholders:** every code step contains complete, runnable code.
