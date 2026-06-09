# OpenCode Observability & Reliable Structured Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCode coding provider observable (live-stream session events into `step.log`) and make its structured (`json_schema`) results reliable (opencode retry → validate → salvage → fail clearly), and make an empty tool list actually mean *no tools*.

**Architecture:** All changes are in the `@journeyman/agent-runtime` OpenCode provider. `run-custom-prompt.ts` orchestrates: it now (a) always sends an explicit tools enable/disable map, (b) subscribes to the opencode SSE event stream and pumps session-scoped events through `opts.onLog` (gated by `agentLogLevel`, mirroring the Claude `logSdkMessage` pattern), and (c) validates/salvages the structured result. Two new pure helpers (`structured.ts`, plus functions in `tool-mapping.ts` and `utils/sdk-logger.ts`) keep the orchestration thin and unit-testable.

**Tech Stack:** TypeScript (Node, ESM, `.ts` extension imports), `@opencode-ai/sdk/v2`, Vitest, pino logging via `@journeyman/core` `createLogger`.

---

## Background the engineer needs

- **Canonical tools** (`CanonicalTool` in `packages/core/src/types/coding-tools.types.ts`): `bash`, `read-file`, `write-file`, `edit-file`, `search`, `web-fetch`, `web-search`. OpenCode native ids (from `tool-mapping.ts`): `bash`, `read`, `write`, `edit`, `grep`, `glob`, `webfetch`.
- **The tools bug:** opencode treats an *omitted* `tools` param as "all built-in tools enabled". So a tool-less step must send `{ <every builtin>: false }`, not nothing.
- **`AgentLogLevel`** (`packages/core/src/types/coding.types.ts`): `"none" | "light" | "medium" | "all"`. `opts.onLog` is a `CodingCliLogFn = (line: string, meta?) => void`. The Claude path gates its UI logging by level in `packages/agent-runtime/src/providers/claude/utils/sdk-logger.ts` — mirror that style.
- **OpenCode v2 SSE events** (`node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`): each event is `{ id: string; type: string; properties: { timestamp: number; sessionID: string; ... } }`. Relevant `type`s:
  - `session.next.text.ended` → `properties.text` (full assistant message text)
  - `session.next.tool.called` → `properties.tool` (name), `properties.input` (object)
  - `session.next.tool.success` → `properties.callID`
  - `session.next.tool.failed` → `properties.error`, `properties.callID`
  - `session.next.retried` → retry signal
  - `session.next.step.failed` → `properties.error`
- **SSE consumption:** `client.event.subscribe(...)` returns `{ stream: AsyncGenerator }`. Consume with `for await (const ev of stream)`. Pass an `AbortController` signal via the options arg and call `stream.return?.()` to tear down.
- **Run tests** from repo root: `npm test --workspace @journeyman/agent-runtime -- <file>` (the package uses Vitest). Type/boundary check: `npm run check`.

## File structure

- **Modify** `packages/agent-runtime/src/providers/opencode/tool-mapping.ts` — add `OPENCODE_BUILTIN_TOOL_IDS` + `openCodeToolsConfig()` (full enable/disable map).
- **Create** `packages/agent-runtime/src/providers/opencode/structured.ts` — `validateStructured()` + `salvageStructured()`.
- **Create** `packages/agent-runtime/src/providers/opencode/structured.test.ts`.
- **Modify** `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts` — add `logOpenCodeEvent()`, fix `logSessionEvent`.
- **Create** `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.test.ts`.
- **Modify** `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts` — explicit tools, `retryCount`, event subscription/teardown, validate/salvage.
- **Modify** `packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts` — cover the new function.
- **Modify** `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts` — cover new behavior.

---

## Task 1: Explicit tools-off map (prerequisite)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/tool-mapping.ts`
- Test: `packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tool-mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openCodeToolsConfig, OPENCODE_BUILTIN_TOOL_IDS } from "./tool-mapping.ts";

describe("openCodeToolsConfig", () => {
  it("empty list disables every builtin tool", () => {
    const cfg = openCodeToolsConfig([]);
    for (const id of OPENCODE_BUILTIN_TOOL_IDS) expect(cfg[id]).toBe(false);
  });

  it("selected tools are enabled, the rest disabled", () => {
    const cfg = openCodeToolsConfig(["read-file", "search"]);
    expect(cfg.read).toBe(true);
    expect(cfg.grep).toBe(true);
    expect(cfg.glob).toBe(true);
    expect(cfg.bash).toBe(false);
    expect(cfg.write).toBe(false);
    expect(cfg.edit).toBe(false);
    expect(cfg.webfetch).toBe(false);
  });

  it("never produces an empty map", () => {
    expect(Object.keys(openCodeToolsConfig([])).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @journeyman/agent-runtime -- tool-mapping`
Expected: FAIL — `openCodeToolsConfig` / `OPENCODE_BUILTIN_TOOL_IDS` not exported.

- [ ] **Step 3: Implement**

Append to `tool-mapping.ts`:

```ts
/** Every OpenCode built-in tool journeyman knows about. Used to build an
 * EXPLICIT enable/disable map: opencode treats an omitted `tools` param as
 * "all tools on", so a pure-prompt step must disable them by name. */
export const OPENCODE_BUILTIN_TOOL_IDS = [
  "bash", "read", "write", "edit", "grep", "glob", "webfetch",
] as const;

/**
 * Build OpenCode's per-prompt `tools` map with EXPLICIT booleans for every
 * known builtin: selected canonical tools → true, all other builtins → false.
 * An empty canonical list therefore yields an all-false map (no tools), which
 * is what "pure-prompt" must mean — matching the Claude provider's behavior.
 */
export function openCodeToolsConfig(tools: readonly CanonicalTool[]): Record<string, boolean> {
  const enabled = openCodeToolsEnableMap(tools); // { <native>: true } for supported tools
  const out: Record<string, boolean> = {};
  for (const id of OPENCODE_BUILTIN_TOOL_IDS) out[id] = enabled[id] === true;
  // Preserve any enabled tool that isn't in the builtin list (future-proof).
  for (const [id, on] of Object.entries(enabled)) if (!(id in out)) out[id] = on;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @journeyman/agent-runtime -- tool-mapping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/tool-mapping.ts packages/agent-runtime/src/providers/opencode/tool-mapping.test.ts
git commit -m "feat(opencode): explicit tools enable/disable map so empty list = no tools"
```

---

## Task 2: Structured-result validation + salvage helpers

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/structured.ts`
- Test: `packages/agent-runtime/src/providers/opencode/structured.test.ts`

- [ ] **Step 1: Write the failing test**

Create `structured.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateStructured, salvageStructured } from "./structured.ts";

const boolSchema = {
  type: "object",
  properties: { success: { type: "boolean" } },
  required: ["success"],
} as const;

describe("validateStructured", () => {
  it("accepts a conforming object", () => {
    const r = validateStructured({ success: true }, boolSchema);
    expect(r.ok).toBe(true);
  });
  it("rejects wrong type", () => {
    const r = validateStructured({ success: "yes please" }, boolSchema);
    expect(r.ok).toBe(false);
  });
  it("rejects missing required field", () => {
    const r = validateStructured({}, boolSchema);
    expect(r.ok).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(validateStructured("nope", boolSchema).ok).toBe(false);
    expect(validateStructured(undefined, boolSchema).ok).toBe(false);
  });
});

describe("salvageStructured", () => {
  it("extracts an embedded JSON object", () => {
    const out = salvageStructured('Sure! {"success": true} done.', boolSchema);
    expect(out).toEqual({ success: true });
  });
  it("detects a bare boolean for a single boolean field", () => {
    expect(salvageStructured("The answer is false.", boolSchema)).toEqual({ success: false });
  });
  it("returns undefined when nothing usable is present", () => {
    expect(salvageStructured("I cannot help with that.", boolSchema)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @journeyman/agent-runtime -- structured`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `structured.ts`:

```ts
type Schema = Record<string, unknown>;
type Props = Record<string, { type?: string }>;

function jsType(v: unknown): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v; // "string" | "number" | "boolean" | "object" | ...
}

function typeMatches(declared: string | undefined, value: unknown): boolean {
  if (!declared) return true;
  if (declared === "object") return jsType(value) === "object";
  if (declared === "array") return Array.isArray(value);
  return jsType(value) === declared; // string/number/boolean
}

/** Lightweight check of a value against an outputFieldsToJsonSchema()-shaped schema. */
export function validateStructured(
  value: unknown,
  schema: Schema,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (jsType(value) !== "object") return { ok: false, reason: "result is not an object" };
  const obj = value as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Props;
  const required = (schema.required ?? []) as string[];
  for (const name of required) {
    if (!(name in obj)) return { ok: false, reason: `missing required field "${name}"` };
  }
  for (const [name, def] of Object.entries(props)) {
    if (name in obj && !typeMatches(def?.type, obj[name])) {
      return { ok: false, reason: `field "${name}" should be ${def?.type}` };
    }
  }
  return { ok: true, value: obj };
}

/** Best-effort recovery of a schema-conforming object from free text. Never loosens
 * validation: a salvaged value is returned only if it passes validateStructured(). */
export function salvageStructured(text: string, schema: Schema): Record<string, unknown> | undefined {
  if (!text) return undefined;
  // 1. Embedded JSON object.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const v = validateStructured(parsed, schema);
      if (v.ok) return v.value;
    } catch { /* not JSON */ }
  }
  // 2. Single-field scalar schemas: pull the scalar out of prose.
  const props = (schema.properties ?? {}) as Props;
  const names = Object.keys(props);
  if (names.length === 1) {
    const name = names[0];
    const t = props[name]?.type;
    if (t === "boolean") {
      const m = text.match(/\b(true|false)\b/i);
      if (m) return { [name]: m[1].toLowerCase() === "true" };
    } else if (t === "number") {
      const m = text.match(/-?\d+(\.\d+)?/);
      if (m) return { [name]: Number(m[0]) };
    } else if (t === "string") {
      const v = text.trim();
      if (v) return { [name]: v };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @journeyman/agent-runtime -- structured`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/structured.ts packages/agent-runtime/src/providers/opencode/structured.test.ts
git commit -m "feat(opencode): structured-result validation + best-effort salvage"
```

---

## Task 3: Event → log-line shaping (sdk-logger)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts`
- Test: `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `utils/sdk-logger.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { logOpenCodeEvent, type OpenCodeEvent } from "./sdk-logger.ts";

function ev(type: string, properties: Record<string, unknown>): OpenCodeEvent {
  return { id: "e1", type, properties: { timestamp: 0, sessionID: "s1", ...properties } } as OpenCodeEvent;
}

describe("logOpenCodeEvent", () => {
  it("logs assistant text only at level all", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "hello" }), onLog, "all");
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toContain("hello");

    const onLog2 = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "hello" }), onLog2, "medium");
    expect(onLog2).not.toHaveBeenCalled();
  });

  it("logs tool calls at medium and all", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.tool.called", { tool: "read", input: { path: "/x" } }), onLog, "medium");
    expect(onLog.mock.calls[0][0]).toContain("read");
  });

  it("logs tool failures and never at none", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.tool.failed", { error: { name: "X" } }), onLog, "all");
    expect(onLog).toHaveBeenCalled();

    const off = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "y" }), off, "none");
    expect(off).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @journeyman/agent-runtime -- sdk-logger`
Expected: FAIL — `logOpenCodeEvent` / `OpenCodeEvent` not exported.

- [ ] **Step 3: Implement**

Replace the contents of `utils/sdk-logger.ts` with:

```ts
// packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts
import { createLogger, type AgentLogLevel, type CodingCliLogFn, type Logger } from "@journeyman/core";

const log = createLogger("opencode:sdk");
const MAX_LINE_LEN = 200;

/** Minimal shape of an OpenCode v2 SSE event we care about. */
export interface OpenCodeEvent {
  id: string;
  type: string;
  properties: { timestamp: number; sessionID: string; [k: string]: unknown };
}

function singleLine(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

function allowsAssistantText(l: AgentLogLevel): boolean { return l === "all"; }
function allowsToolUse(l: AgentLogLevel): boolean { return l === "medium" || l === "all"; }
function allowsToolResult(l: AgentLogLevel): boolean { return l === "all"; }
function allowsLight(l: AgentLogLevel): boolean { return l === "light" || l === "medium" || l === "all"; }

function summarizeInput(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.command === "string") return `$ ${singleLine(inp.command, 140)}`;
  if (typeof inp.path === "string") return singleLine(inp.path, 140);
  if (typeof inp.filePath === "string") return singleLine(inp.filePath, 140);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 140);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

/** Shape one OpenCode SSE event into a UI log line via `onLog`, gated by `level`.
 * Always debug-logs to stderr regardless of level (the runner forwards stderr). */
export function logOpenCodeEvent(
  ev: OpenCodeEvent,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  const p = ev.properties;
  const ui = onLog && level !== "none" ? onLog : undefined;
  switch (ev.type) {
    case "session.next.text.ended": {
      const text = typeof p.text === "string" ? p.text : "";
      log.debug({ text }, "assistant text");
      if (ui && allowsAssistantText(level) && text) {
        ui(singleLine(`🤖 assistant: ${text}`, MAX_LINE_LEN), { event: ev });
      }
      break;
    }
    case "session.next.tool.called": {
      const tool = typeof p.tool === "string" ? p.tool : "tool";
      log.debug({ tool, input: p.input }, "tool call");
      if (ui && allowsToolUse(level)) {
        const arg = summarizeInput(p.input);
        ui(singleLine(arg ? `🔧 tool: ${tool}(${arg})` : `🔧 tool: ${tool}`, MAX_LINE_LEN), { event: ev });
      }
      break;
    }
    case "session.next.tool.success": {
      if (ui && allowsToolResult(level)) ui(`📥 tool_result: ok`, { event: ev });
      break;
    }
    case "session.next.tool.failed":
    case "session.next.step.failed": {
      const err = p.error;
      const msg = typeof err === "string" ? err : JSON.stringify(err ?? {});
      log.warn({ err }, "opencode error event");
      if (ui) ui(singleLine(`❌ ${ev.type === "session.next.tool.failed" ? "tool_result: error" : "step failed"}: ${msg}`, MAX_LINE_LEN), { event: ev });
      break;
    }
    case "session.next.retried": {
      if (ui && allowsLight(level)) ui(`🔁 retry (structured output)`, { event: ev });
      break;
    }
    default:
      break;
  }
}

/** Final session-result diagnostic. Routed through `onLog` so it is visible
 * (the old version used log.debug, dropped at the default `info` level), and
 * inspects OpenCode's `structured` key (not the Claude-shaped structured_output). */
export function logSessionEvent(
  logger: Logger,
  sessionId: string,
  info: { error?: unknown; structured?: unknown; [k: string]: unknown },
  onLog?: CodingCliLogFn,
): void {
  logger.info(
    { sessionId, hasError: !!info.error, hasStructured: info.structured !== undefined },
    "opencode session result",
  );
  onLog?.(`📦 session result: ${info.error ? "error" : info.structured !== undefined ? "structured" : "no-structured"}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @journeyman/agent-runtime -- sdk-logger`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts packages/agent-runtime/src/providers/opencode/utils/sdk-logger.test.ts
git commit -m "feat(opencode): event log-shaping + fix session-result log level/key"
```

---

## Task 4: Wire everything into run-custom-prompt

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Read the existing test to match the fake-client shape**

Run: `sed -n '1,80p' packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`
Note how the existing tests fake `client.session.create` and `client.session.prompt` (return `{ data: ... }`). You will extend that fake with a fake `client.event.subscribe` returning `{ stream }`.

- [ ] **Step 2: Write the failing tests**

Add to `run-custom-prompt.test.ts` (reuse the existing fake-client helper; the snippets below assume a `makeClient(overrides)` builder — if the file uses inline objects, follow that style instead):

```ts
import { describe, it, expect, vi } from "vitest";
import { runCustomPrompt } from "./run-custom-prompt.ts";

// Minimal fake opencode client. `promptResult` is what session.prompt resolves to.
function fakeClient(promptResult: unknown, events: unknown[] = []) {
  async function* gen() { for (const e of events) yield e; }
  return {
    session: {
      create: vi.fn(async () => ({ data: { id: "sess-1" } })),
      prompt: vi.fn(async () => promptResult),
    },
    event: { subscribe: vi.fn(async () => ({ stream: gen() })) },
  } as any;
}

const cfg = { mode: "managed", model: { providerID: "qwen", modelID: "q3" } } as any;
const structuredOpts = {
  prompt: "is it open?",
  outputMode: "structured",
  outputSchema: { type: "object", properties: { success: { type: "boolean" } }, required: ["success"] },
  model: "qwen/q3",
} as any;

describe("runCustomPrompt structured reliability", () => {
  it("passes through a valid structured result", async () => {
    const client = fakeClient({ data: { info: { structured: { success: true } }, parts: [] } });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toEqual({ success: true });
    expect(r.error).toBeUndefined();
  });

  it("salvages a boolean from text when structured is absent", async () => {
    const client = fakeClient({
      data: { info: {}, parts: [{ type: "text", text: "Yes, the answer is true." }] },
    });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toEqual({ success: true });
  });

  it("fails clearly with the model reply when unsalvageable", async () => {
    const client = fakeClient({
      data: { info: {}, parts: [{ type: "text", text: "I cannot determine that." }] },
    });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toBeUndefined();
    expect(r.error).toContain("cannot determine");
  });

  it("sends an explicit tools map (all builtins false for a tool-less step)", async () => {
    const client = fakeClient({ data: { info: { structured: { success: true } }, parts: [] } });
    await runCustomPrompt(client, cfg, structuredOpts);
    const sent = client.session.prompt.mock.calls[0][0];
    expect(sent.tools.bash).toBe(false);
    expect(sent.tools.read).toBe(false);
  });

  it("sets retryCount on the json_schema format", async () => {
    const client = fakeClient({ data: { info: { structured: { success: true } }, parts: [] } });
    await runCustomPrompt(client, cfg, structuredOpts);
    const sent = client.session.prompt.mock.calls[0][0];
    expect(sent.format.type).toBe("json_schema");
    expect(typeof sent.format.retryCount).toBe("number");
  });

  it("streams events to onLog gated by level", async () => {
    const events = [
      { id: "1", type: "session.next.text.ended", properties: { timestamp: 0, sessionID: "sess-1", text: "hi there" } },
    ];
    const client = fakeClient({ data: { info: { structured: { success: true } }, parts: [] } }, events);
    const onLog = vi.fn();
    await runCustomPrompt(client, cfg, { ...structuredOpts, onLog, agentLogLevel: "all" });
    expect(onLog.mock.calls.some((c: any[]) => String(c[0]).includes("hi there"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --workspace @journeyman/agent-runtime -- run-custom-prompt`
Expected: FAIL (no tools map / no retryCount / no salvage / no event streaming).

- [ ] **Step 4: Implement the changes**

Edit `run-custom-prompt.ts`:

1. Update imports at the top:

```ts
import { createLogger } from "@journeyman/core";
import { logOpenCodeEvent, logSessionEvent, type OpenCodeEvent } from "../utils/sdk-logger.ts";
import { openCodeToolsConfig } from "../tool-mapping.ts";
import { validateStructured, salvageStructured } from "../structured.ts";
import { resolveOpenCodeModel } from "../model.ts";
```

2. Add a structured-retry default near the top of the file (after `const log = ...`):

```ts
/** How many times opencode itself re-asks the model to satisfy the json_schema. */
const STRUCTURED_RETRY_COUNT = Number(process.env.OPENCODE_STRUCTURED_RETRIES) || 2;
```

3. Replace the tools line and the `client.session.prompt(...)` call + result handling. The body from `const tools = ...` through the final `return` becomes:

```ts
  const tools = openCodeToolsConfig(opts.tools ?? []);
  const system = buildSystem(opts);

  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) {
    return { sessionId, error: `opencode session.create failed: ${describeSdkError((session as { error?: unknown }).error)}` };
  }
  const openSessionId = session.data.id;

  // Live event streaming → onLog, filtered to THIS session, torn down in finally.
  type EventStream = AsyncIterable<unknown> & { return?: (v?: unknown) => Promise<unknown> };
  const wantStream = !!opts.onLog && (opts.agentLogLevel ?? "all") !== "none" && !!client.event?.subscribe;
  const ac = new AbortController();
  let sub: { stream?: EventStream } | undefined;
  let pump: Promise<void> | undefined;
  if (wantStream) {
    sub = await client.event.subscribe({}, { signal: ac.signal }).catch(() => undefined);
    const stream = sub?.stream;
    if (stream) {
      pump = (async () => {
        try {
          for await (const raw of stream) {
            const ev = raw as OpenCodeEvent;
            if (ev?.properties?.sessionID && ev.properties.sessionID !== openSessionId) continue;
            logOpenCodeEvent(ev, opts.onLog, opts.agentLogLevel ?? "all");
          }
        } catch { /* aborted on teardown */ }
      })();
    }
  }

  let res: Awaited<ReturnType<typeof client.session.prompt>>;
  try {
    res = await client.session.prompt({
      sessionID: openSessionId,
      parts: [{ type: "text", text: opts.prompt }],
      model,
      tools,
      ...(opts.cwd ? { directory: opts.cwd } : {}),
      ...(system ? { system } : {}),
      ...(opts.outputMode === "structured" && opts.outputSchema
        ? { format: { type: "json_schema", schema: opts.outputSchema, retryCount: STRUCTURED_RETRY_COUNT } }
        : {}),
    });
  } finally {
    ac.abort();
    try { await sub?.stream?.return?.(undefined); } catch { /* noop */ }
    if (pump) await pump.catch(() => {});
  }

  if (!res.data) {
    const error = `opencode session.prompt failed: ${describeSdkError((res as { error?: unknown }).error)}`;
    log.error({ sessionId, error }, "runCustomPrompt failed (no data)");
    return { sessionId, error };
  }

  const info = res.data.info as { error?: unknown; structured?: unknown };
  logSessionEvent(log, sessionId, info as never, opts.onLog);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }

  if (opts.outputMode === "none") return { sessionId };
  if (opts.outputMode === "text") return { sessionId, result: extractText(res.data as never) };

  // structured: validate → salvage from text → fail clearly.
  const schema = opts.outputSchema as Record<string, unknown>;
  const valid = validateStructured(info.structured, schema);
  if (valid.ok) return { sessionId, structured: valid.value };

  const text = extractText(res.data as never);
  const salvaged = salvageStructured(text, schema);
  if (salvaged) {
    log.warn({ sessionId, reason: valid.reason }, "structured salvaged from text");
    return { sessionId, structured: salvaged };
  }

  const error = `model did not return valid structured output (${valid.reason}). Model said: ${text.slice(0, 500) || "(no text)"}`;
  log.error({ sessionId, error }, "runCustomPrompt structured invalid");
  return { sessionId, error };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace @journeyman/agent-runtime -- run-custom-prompt`
Expected: PASS (all new + existing tests).

- [ ] **Step 6: Type & boundary check**

Run: `npm run check`
Expected: PASS. If `client.event` typing complains, narrow with a local interface for the parts of the client used (`session.create`, `session.prompt`, `event.subscribe`) rather than `any`-casting the whole client.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts
git commit -m "feat(opencode): live event streaming + retryCount/validate/salvage structured results"
```

---

## Task 5: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Rebuild the runner image** (the runner bundle ships into the sandbox)

Run: `npm run images:build`
Expected: image build completes.

- [ ] **Step 2: Re-run the "Say Hi"-style workflow** against LM Studio (qwen) with `agentLogLevel: "all"`.

- [ ] **Step 3: Confirm in the run's logs panel:**
  - You now see `🤖 assistant: …`, `🔧 tool: …` (should be absent for a tool-less step), and `📦 session result: …` lines.
  - The structured output is the requested shape (e.g. `{ success: true|false }`), OR the step fails with a clear `model did not return valid structured output …` message showing the model's reply.

- [ ] **Step 4: Confirm the model no longer reads sandbox files** for a tool-less step (no file-exploration narration in the output).

---

## Self-review notes (for the planner)

- **Spec coverage:** Part A (observability) → Tasks 3+4 (event shaping + streaming + log fixes). Part B (reliable results) → Tasks 2+4 (validate/salvage + retryCount + clear failure). Prerequisite (tools-off) → Task 1. Manual verification → Task 5. All spec sections covered.
- **Type consistency:** `openCodeToolsConfig`, `OPENCODE_BUILTIN_TOOL_IDS`, `validateStructured`/`salvageStructured`, `logOpenCodeEvent`/`logSessionEvent`/`OpenCodeEvent` names are used identically across tasks.
- **Known soft spot:** the exact `client.event.subscribe(params, options)` signature and whether events are global vs location-scoped should be confirmed against `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts` in Task 4 Step 4; the session-id filter makes global-vs-scoped immaterial for correctness. The teardown marker line MUST be replaced per Step 4.4 — do not ship it.
