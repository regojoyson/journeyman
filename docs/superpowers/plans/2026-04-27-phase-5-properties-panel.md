# Phase 5 — Properties Panel Completion

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference: skip unit-test steps, no per-task commits, run typecheck only at the end of the phase, parallel writes wherever possible.

**Goal:** Make every per-phase configuration field reachable from the properties panel — not just the `Config` tab. After this phase, a user can build "a flow that uses a Jira MCP server, retries on `RateLimitError` up to 3 times with exponential backoff, routes `ValidationError` to a Notify node via the error edge" entirely in the UI. The Run button reflects validation across all five tabs.

**Architecture:** The properties panel grows from one enabled tab to five (Config / MCP & Tools / Credentials / Retry & Errors / Inputs / Outputs). The data lands on the FlowNode itself: `node.config.mcp`, `node.config.allowedTools`, `node.config.credentials`, `node.config.inputs`, `node.config.outputSchema`, and the existing `node.retry` field gets a real shape. The flow-level retry policy lives on the start node's `config.flowRetry`. Two engine-side changes: (a) the converter emits Conductor `retryCount`/`retryLogic`/`retryDelaySeconds` from `node.retry`; (b) the worker harness resolves declared credentials via `ICredentialStore` and classifies failures `RETRYABLE` vs `FATAL` against `retry.retryOn`/`retry.stopOn` patterns.

**Tech Stack:** No new dependencies. Same `@xyflow/react`, zod for runtime validation. The MCP catalog is a static built-in for now; user/flow-supplied MCP definitions are in scope for the **types and UI**, but the runtime *delivery* of MCP servers to phase handlers is a Phase 7 concern (alongside per-user workspace and credential vault).

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. Implements **Section 12 → "Phase 5 — Properties panel completion"** plus the spec's Section 5 (node anatomy details, all five tabs). Out of scope:

- Real per-user credential vault (persistence, encryption) — Phase 7
- Org-level MCP marketplace catalog — out of v0
- Visual subflow drill-in — Phase 6
- Resume/fork/cancel/export run actions — Phase 6
- `retry-block` and `try-catch` region nodes — Phase 6

## What Changes

| Layer | Package | Change |
|---|---|---|
| Types | `@journeyman/core` | + `RetryPolicy` shape · `McpServerConfig` · `NodeInputBinding` · `FlowRetryPolicy`. `FlowNode.retry` now typed as `RetryPolicy`. |
| Converter | `@journeyman/orchestrator` | `emitPhase` reads `node.retry` and emits Conductor `retryCount` / `retryLogic` / `retryDelaySeconds` / `backoffScaleFactor` / `timeoutSeconds`. Workflow-level retry pulled from start node's `config.flowRetry`. |
| Worker | `@journeyman/orchestrator` | `WorkerHarness.processOnce` classifies failures against `retryOn` / `stopOn` regex patterns and chooses `FAILED` (retryable) vs `FAILED_WITH_TERMINAL_ERROR`. Resolves declared credentials via `ICredentialStore` and merges them into `PhaseContext.env`. |
| Components | `@journeyman/flow-editor` | Properties panel grows from 1 tab to 5. New per-tab forms: MCP & Tools, Credentials, Retry & Errors, Inputs / Outputs. Special "Flow Settings" view replaces tabs when the **start node** is selected (flow-level retry, default cycle visit limit). |
| Catalogs | `@journeyman/flow-editor` | + built-in MCP catalog (filesystem/git stdio + Jira/Slack HTTP placeholders) re-exported the same way as `defaultControlCatalog`. |
| Schemas | `@journeyman/api-server` | zod schemas for nodes accept the `retry`, `flowRetry`, and the various `config.*` fields without enumerating them (they're stored opaquely). |
| Shell | `@journeyman/web` | Re-export the MCP catalog and pass it into `<FlowEditor>`. |

## File Structure

```
packages/
├── core/                                                     (types extended)
│   └── src/types/flow.types.ts                               + RetryPolicy / McpServerConfig / NodeInputBinding / FlowRetryPolicy; FlowNode.retry typed
│
├── orchestrator/
│   └── src/
│       ├── flow-json/conductor-converter.ts                  + emitPhase reads node.retry; toEngineJson reads start.config.flowRetry
│       └── workers/worker-harness.ts                         + retry classification + credential resolution
│
├── api-server/
│   └── src/schemas/
│       ├── flow.ts                                            + retry: z.record(z.unknown()).optional()
│       └── update-flow.ts                                     same
│
├── flow-editor/
│   └── src/
│       ├── properties-panel/
│       │   ├── PropertiesPanel.tsx                            tab strip becomes interactive; 5 tabs
│       │   ├── tabs-shell.tsx                                 active tab is now controlled, all 5 enabled
│       │   ├── ConfigTab.tsx                                  (no change)
│       │   ├── McpToolsTab.tsx                                NEW
│       │   ├── CredentialsTab.tsx                             NEW
│       │   ├── RetryTab.tsx                                   NEW
│       │   ├── IoTab.tsx                                      NEW
│       │   └── FlowSettingsView.tsx                           NEW — shown when start node is selected
│       ├── catalogs/
│       │   └── built-in-mcp-catalog.ts                        NEW
│       ├── types.ts                                            + McpCatalog / McpCatalogEntry; FlowEditorProps gets mcpCatalog?
│       └── index.ts                                            re-exports
│
└── web/
    └── src/
        ├── catalogs/
        │   └── built-in-mcp-catalog.ts                        NEW (re-export)
        └── routes/FlowEditorPage.tsx                          passes mcpCatalog
```

## Public API additions

### `@journeyman/core`

```typescript
// flow.types.ts — new shapes

export type BackoffStrategy = "fixed" | "linear" | "exponential";

export interface RetryPolicy {
  enabled?: boolean;
  maxAttempts?: number;
  backoff?: BackoffStrategy;
  backoffSeconds?: number;
  backoffMultiplier?: number;
  timeoutSeconds?: number;
  /** Retry only when the failure's errorClass matches one of these (regex strings). */
  retryOn?: string[];
  /** Permanently fail if the errorClass matches one of these. Beats retryOn. */
  stopOn?: string[];
  /** What to do when retries are exhausted. */
  onFailure?: "error-edge" | "fail-flow";
}

export interface FlowRetryPolicy {
  /** How many times the whole flow may restart on infra-level failure. Default 1. */
  maxAttempts?: number;
  /** Backoff between flow restarts in seconds. */
  backoffSeconds?: number;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  /** Display label. */
  label?: string;
  source: "builtin" | "provided" | "custom";
  transport: McpTransport;
  /** stdio: command + args.  http/sse: url. */
  command?: string;
  args?: string[];
  url?: string;
  /** Env vars passed to the MCP server. Each value is a CredentialRef ("env:FOO"). */
  env?: Record<string, string>;
}

export interface NodeInputBinding {
  /** Path expression: "<sourceNodeId>.output.<jsonpath>" or "$flow.input.<name>" or a literal. */
  from: string;
}

// FlowNode extension — non-breaking
export interface FlowNode {
  // existing fields…
  retry?: RetryPolicy;
}
```

### `@journeyman/flow-editor`

```typescript
export interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string; args?: string[];
  url?: string;
  /** Required env-var names so the Credentials tab can prompt the user. */
  requiredEnv?: string[];
  description?: string;
}
export type McpCatalog = McpCatalogEntry[];

export interface FlowEditorProps {
  // existing fields…
  mcpCatalog?: McpCatalog;
}

// new export
export const defaultMcpCatalog: McpCatalog;
```

---

## Task 1: Type extensions in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1.1: append the new types**

After the existing `FlowEdge` interface, append:

```typescript
// === Phase 5 additions ===

export type BackoffStrategy = "fixed" | "linear" | "exponential";

export interface RetryPolicy {
  enabled?: boolean;
  maxAttempts?: number;
  backoff?: BackoffStrategy;
  backoffSeconds?: number;
  backoffMultiplier?: number;
  timeoutSeconds?: number;
  retryOn?: string[];
  stopOn?: string[];
  onFailure?: "error-edge" | "fail-flow";
}

export interface FlowRetryPolicy {
  maxAttempts?: number;
  backoffSeconds?: number;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string;
  label?: string;
  source: "builtin" | "provided" | "custom";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface NodeInputBinding {
  from: string;
}
```

Then change the existing `FlowNode.retry?` field's type from `Record<string, unknown>` to `RetryPolicy`:

```typescript
// inside FlowNode
retry?: RetryPolicy;
```

(All callers using `node.retry` today access it through `as` casts or treat it as opaque, so this is non-breaking.)

---

## Task 2: Schema relax in `@journeyman/api-server`

**Files:**
- Modify: `packages/api-server/src/schemas/flow.ts`
- Modify: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Step 2.1: add `retry` to the node schema in both files**

Inside the inner `z.object({ ... })` for nodes, add:

```typescript
retry: z.record(z.unknown()).optional(),
```

(Keep the `config: z.record(z.unknown()).optional()` field as-is — the new `mcp` / `allowedTools` / `credentials` / `inputs` / `outputSchema` / `flowRetry` all live inside `config` and pass through opaquely.)

---

## Task 3: Built-in MCP catalog

**Files:**
- Create: `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts`
- Create: `packages/web/src/catalogs/built-in-mcp-catalog.ts`

- [ ] **Step 3.1: write the flow-editor catalog**

```typescript
import type { McpCatalog } from "../types.ts";

export const defaultMcpCatalog: McpCatalog = [
  {
    id: "filesystem",
    label: "Filesystem",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    description: "Read/write files via the official MCP filesystem server.",
  },
  {
    id: "git",
    label: "Git",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    description: "Run git commands via the official MCP git server.",
  },
  {
    id: "jira",
    label: "Jira",
    source: "provided",
    transport: "http",
    url: "https://mcp.atlassian.com/jira",
    requiredEnv: ["JIRA_API_TOKEN", "JIRA_EMAIL"],
    description: "Atlassian Jira via HTTP MCP. Requires JIRA_API_TOKEN + JIRA_EMAIL.",
  },
  {
    id: "slack",
    label: "Slack",
    source: "provided",
    transport: "http",
    url: "https://mcp.slack.com",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    description: "Slack via HTTP MCP. Requires SLACK_BOT_TOKEN.",
  },
];
```

- [ ] **Step 3.2: web re-export**

```typescript
// packages/web/src/catalogs/built-in-mcp-catalog.ts
export { defaultMcpCatalog } from "@journeyman/flow-editor";
```

---

## Task 4: Extend `flow-editor` types and barrel

**Files:**
- Modify: `packages/flow-editor/src/types.ts`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 4.1: extend `types.ts`**

Append the new types (alongside the existing `PhaseCatalogEntry` / `ControlNodeCatalogEntry`):

```typescript
import type { McpTransport } from "@journeyman/core";

export interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
}
export type McpCatalog = McpCatalogEntry[];
```

And extend `FlowEditorProps`:

```typescript
mcpCatalog?: McpCatalog;
```

- [ ] **Step 4.2: extend `index.ts`**

Replace with:

```typescript
export { FlowEditor } from "./FlowEditor.tsx";
export { createBlankFlow, isLinearAndComplete, isValidPhase4Graph } from "./state/flow-graph.ts";
export type {
  FlowEditorProps, PhaseCatalog, PhaseCatalogEntry,
  ControlNodeCatalog, ControlNodeCatalogEntry,
  McpCatalog, McpCatalogEntry,
} from "./types.ts";
export { defaultControlCatalog } from "./palette/built-in-categories.ts";
export { defaultMcpCatalog } from "./catalogs/built-in-mcp-catalog.ts";
export { nodeTypes, edgeTypes } from "./canvas/node-registry.ts";
```

---

## Task 5: Tabs shell becomes interactive (all 5 enabled)

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`

Replace the file:

```tsx
import type { ReactNode } from "react";

export type TabId = "config" | "mcp" | "credentials" | "retry" | "io";

export interface TabShellProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  children: ReactNode;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",      label: "Config"      },
  { id: "mcp",         label: "MCP & Tools" },
  { id: "credentials", label: "Credentials" },
  { id: "retry",       label: "Retry"       },
  { id: "io",          label: "I/O"         },
];

export function TabsShell({ active, onChange, children }: TabShellProps) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <div
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: "6px 8px",
              borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
              color: t.id === active ? "#4a9eff" : "#aaa",
              fontWeight: t.id === active ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {t.label}
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
```

---

## Task 6: New tab content components

**Files (all under `packages/flow-editor/src/properties-panel/`):**
- Create: `McpToolsTab.tsx`
- Create: `CredentialsTab.tsx`
- Create: `RetryTab.tsx`
- Create: `IoTab.tsx`
- Create: `FlowSettingsView.tsx`

All five share a common pattern: read from `node.config` / `node.retry`, write back via `onChange`. They never reach into the rest of the graph except for `IoTab` which lists upstream node ids for input wiring.

- [ ] **Step 6.1: `McpToolsTab.tsx`**

```tsx
import type { FlowNode, McpServerConfig } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";

export interface McpToolsTabProps {
  node: FlowNode;
  catalog: McpCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getServers(node: FlowNode): McpServerConfig[] {
  const cfg = (node.config ?? {}) as { mcp?: McpServerConfig[] };
  return cfg.mcp ?? [];
}
function getAllowedTools(node: FlowNode): string[] {
  const cfg = (node.config ?? {}) as { allowedTools?: string[] };
  return cfg.allowedTools ?? [];
}
function setMcp(node: FlowNode, servers: McpServerConfig[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), mcp: servers } };
}
function setAllowedTools(node: FlowNode, tools: string[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), allowedTools: tools } };
}

export function McpToolsTab({ node, catalog, onChange, readOnly }: McpToolsTabProps) {
  const servers = getServers(node);
  const tools = getAllowedTools(node);
  const enabledIds = new Set(servers.map(s => s.id));

  const toggle = (id: string) => {
    const entry = catalog.find(e => e.id === id);
    if (!entry) return;
    if (enabledIds.has(id)) {
      onChange(setMcp(node, servers.filter(s => s.id !== id)));
    } else {
      const cfg: McpServerConfig = {
        id: entry.id, label: entry.label, source: entry.source, transport: entry.transport,
        command: entry.command, args: entry.args, url: entry.url,
      };
      onChange(setMcp(node, [...servers, cfg]));
    }
  };

  return (
    <div>
      <div className="je-props__field">
        <label>MCP servers</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {catalog.map(c => (
            <label
              key={c.id}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#1f1f2c", border: `1px solid ${enabledIds.has(c.id) ? "#4a9eff" : "#2a2a3a"}`,
                borderRadius: 6, padding: "6px 8px", cursor: readOnly ? "not-allowed" : "pointer",
                opacity: readOnly ? 0.6 : 1,
              }}
              title={c.description ?? ""}
            >
              <input
                type="checkbox"
                checked={enabledIds.has(c.id)}
                disabled={readOnly}
                onChange={() => toggle(c.id)}
              />
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 10, color: "#888" }}>{c.transport}</span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
          User-supplied custom MCP servers will land in Phase 7 (per-user vault).
        </div>
      </div>

      <div className="je-props__field">
        <label>Allowed tools (one per line)</label>
        <textarea
          value={tools.join("\n")}
          disabled={readOnly}
          placeholder="Bash&#10;Read&#10;mcp__jira__*"
          onChange={e => onChange(setAllowedTools(node, e.target.value.split("\n").map(s => s.trim()).filter(Boolean)))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2: `CredentialsTab.tsx`**

```tsx
import type { FlowNode } from "@journeyman/core";

export interface CredentialsTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getCredentials(node: FlowNode): Record<string, string> {
  const cfg = (node.config ?? {}) as { credentials?: Record<string, string> };
  return cfg.credentials ?? {};
}
function setCredentials(node: FlowNode, creds: Record<string, string>): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), credentials: creds } };
}

export function CredentialsTab({ node, onChange, readOnly }: CredentialsTabProps) {
  const creds = getCredentials(node);
  const rows = Object.entries(creds);

  const setRow = (oldKey: string | null, key: string, value: string) => {
    const next = { ...creds };
    if (oldKey && oldKey !== key) delete next[oldKey];
    if (key) next[key] = value;
    onChange(setCredentials(node, next));
  };
  const removeRow = (key: string) => {
    const next = { ...creds };
    delete next[key];
    onChange(setCredentials(node, next));
  };
  const addRow = () => {
    const next = { ...creds, "": "env:" };
    onChange(setCredentials(node, next));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Credential bindings</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 && (
            <div style={{ color: "#666", fontSize: 11, fontStyle: "italic" }}>(none)</div>
          )}
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 4 }}>
              <input
                type="text"
                value={k}
                disabled={readOnly}
                placeholder="ENV_VAR"
                style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(k, e.target.value, v)}
              />
              <input
                type="text"
                value={v}
                disabled={readOnly}
                placeholder="env:NAME or user:NAME"
                style={{ flex: 2, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(null, k, e.target.value)}
              />
              <button
                disabled={readOnly}
                onClick={() => removeRow(k)}
                style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            style={{ marginTop: 6, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >+ Add</button>
        )}
        <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
          v1: <code>env:NAME</code> resolves to <code>process.env.NAME</code>. <code>user:</code> and <code>flow:</code> arrive in Phase 7.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.3: `RetryTab.tsx`**

```tsx
import type { BackoffStrategy, FlowNode, RetryPolicy } from "@journeyman/core";

export interface RetryTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const BACKOFFS: BackoffStrategy[] = ["fixed", "linear", "exponential"];

function setRetry(node: FlowNode, retry: RetryPolicy): FlowNode {
  return { ...node, retry };
}

export function RetryTab({ node, onChange, readOnly }: RetryTabProps) {
  const r = node.retry ?? {};
  const set = (next: RetryPolicy) => onChange(setRetry(node, next));

  return (
    <div>
      <div className="je-props__field">
        <label style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none" }}>
          <input
            type="checkbox"
            checked={!!r.enabled}
            disabled={readOnly}
            onChange={e => set({ ...r, enabled: e.target.checked })}
          />
          Retry enabled
        </label>
      </div>

      <div className="je-props__field">
        <label>Max attempts</label>
        <input
          type="number" min={1}
          value={r.maxAttempts ?? 3}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <label>Backoff strategy</label>
        <select
          value={r.backoff ?? "exponential"}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}
        >
          {BACKOFFS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="je-props__field">
        <label>Backoff base seconds</label>
        <input
          type="number" min={0}
          value={r.backoffSeconds ?? 5}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <label>Backoff multiplier (exponential)</label>
        <input
          type="number" min={1} step={0.1}
          value={r.backoffMultiplier ?? 2}
          disabled={readOnly || !r.enabled}
          onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })}
        />
      </div>

      <div className="je-props__field">
        <label>Per-attempt timeout (seconds)</label>
        <input
          type="number" min={0}
          value={r.timeoutSeconds ?? 600}
          disabled={readOnly}
          onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="je-props__field">
        <label>Retry only on errors matching (one per line)</label>
        <textarea
          value={(r.retryOn ?? []).join("\n")}
          disabled={readOnly || !r.enabled}
          placeholder="RateLimitError&#10;NetworkError"
          onChange={e => set({ ...r, retryOn: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
        />
      </div>

      <div className="je-props__field">
        <label>Stop on errors matching (one per line)</label>
        <textarea
          value={(r.stopOn ?? []).join("\n")}
          disabled={readOnly}
          placeholder="AuthError&#10;ValidationError"
          onChange={e => set({ ...r, stopOn: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
        />
      </div>

      <div className="je-props__field">
        <label>On permanent failure</label>
        <select
          value={r.onFailure ?? "error-edge"}
          disabled={readOnly}
          onChange={e => set({ ...r, onFailure: e.target.value as RetryPolicy["onFailure"] })}
        >
          <option value="error-edge">Route via error edge</option>
          <option value="fail-flow">Fail the whole flow</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.4: `IoTab.tsx`**

```tsx
import type { FlowGraph, FlowNode, NodeInputBinding } from "@journeyman/core";

export interface IoTabProps {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getInputs(node: FlowNode): Record<string, NodeInputBinding> {
  const cfg = (node.config ?? {}) as { inputs?: Record<string, NodeInputBinding> };
  return cfg.inputs ?? {};
}
function getOutputSchema(node: FlowNode): unknown {
  const cfg = (node.config ?? {}) as { outputSchema?: unknown };
  return cfg.outputSchema ?? {};
}
function setInputs(node: FlowNode, inputs: Record<string, NodeInputBinding>): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), inputs } };
}
function setOutputSchema(node: FlowNode, schema: unknown): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), outputSchema: schema } };
}

/** Crude "upstream" computation: any node we can reach by walking edges in reverse from `node.id`. */
function upstreamNodeIds(flow: FlowGraph, nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const src of incoming.get(cur) ?? []) {
      if (!out.has(src)) { out.add(src); stack.push(src); }
    }
  }
  return [...out];
}

export function IoTab({ flow, node, onChange, readOnly }: IoTabProps) {
  const inputs = getInputs(node);
  const upstream = upstreamNodeIds(flow, node.id);

  const setRow = (oldKey: string | null, key: string, from: string) => {
    const next = { ...inputs };
    if (oldKey && oldKey !== key) delete next[oldKey];
    if (key) next[key] = { from };
    onChange(setInputs(node, next));
  };
  const removeRow = (key: string) => {
    const next = { ...inputs };
    delete next[key];
    onChange(setInputs(node, next));
  };
  const addRow = () => onChange(setInputs(node, { ...inputs, "": { from: "" } }));

  return (
    <div>
      <div className="je-props__field">
        <label>Inputs (wire from upstream nodes)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.entries(inputs).map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 4 }}>
              <input
                type="text" value={k}
                disabled={readOnly}
                placeholder="inputName"
                style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(k, e.target.value, v.from)}
              />
              <input
                type="text" value={v.from}
                disabled={readOnly}
                placeholder="step1.output.foo"
                style={{ flex: 2, fontFamily: "ui-monospace, monospace" }}
                onChange={e => setRow(null, k, e.target.value)}
              />
              <button
                disabled={readOnly}
                onClick={() => removeRow(k)}
                style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
              >×</button>
            </div>
          ))}
        </div>
        {!readOnly && (
          <button
            onClick={addRow}
            style={{ marginTop: 6, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
          >+ Add</button>
        )}
        {upstream.length > 0 && (
          <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
            Upstream: {upstream.join(", ")} · also <code>$flow.input.&lt;name&gt;</code>
          </div>
        )}
      </div>

      <div className="je-props__field">
        <label>Output schema (JSON)</label>
        <textarea
          value={JSON.stringify(getOutputSchema(node), null, 2)}
          disabled={readOnly}
          onChange={e => {
            try { onChange(setOutputSchema(node, JSON.parse(e.target.value || "{}"))); }
            catch { /* invalid JSON — leave as-is */ }
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6.5: `FlowSettingsView.tsx`** — replaces the tab strip when the start node is selected.

```tsx
import type { FlowNode, FlowRetryPolicy } from "@journeyman/core";

export interface FlowSettingsViewProps {
  startNode: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getFlowRetry(node: FlowNode): FlowRetryPolicy {
  const cfg = (node.config ?? {}) as { flowRetry?: FlowRetryPolicy };
  return cfg.flowRetry ?? {};
}
function setFlowRetry(node: FlowNode, p: FlowRetryPolicy): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), flowRetry: p } };
}
function getCycleVisits(node: FlowNode): number {
  const cfg = (node.config ?? {}) as { maxCycleVisits?: number };
  return cfg.maxCycleVisits ?? 100;
}
function setCycleVisits(node: FlowNode, n: number): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), maxCycleVisits: n } };
}

export function FlowSettingsView({ startNode, onChange, readOnly }: FlowSettingsViewProps) {
  const fr = getFlowRetry(startNode);
  const visits = getCycleVisits(startNode);

  return (
    <div>
      <div className="je-props__title">Flow settings</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
        These apply to the whole flow, not just one node.
      </div>

      <div className="je-props__field">
        <label>Flow-level retry: max attempts</label>
        <input
          type="number" min={1}
          value={fr.maxAttempts ?? 1}
          disabled={readOnly}
          onChange={e => onChange(setFlowRetry(startNode, { ...fr, maxAttempts: Number(e.target.value) || 1 }))}
        />
      </div>
      <div className="je-props__field">
        <label>Flow-level retry: backoff seconds</label>
        <input
          type="number" min={0}
          value={fr.backoffSeconds ?? 30}
          disabled={readOnly}
          onChange={e => onChange(setFlowRetry(startNode, { ...fr, backoffSeconds: Number(e.target.value) || 0 }))}
        />
      </div>

      <div className="je-props__field">
        <label>Max visits per node (cycle guard)</label>
        <input
          type="number" min={1}
          value={visits}
          disabled={readOnly}
          onChange={e => onChange(setCycleVisits(startNode, Number(e.target.value) || 1))}
        />
      </div>
    </div>
  );
}
```

---

## Task 7: Wire all five tabs into `PropertiesPanel`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`
- Modify: `packages/flow-editor/src/FlowEditor.tsx` (pass `flow` and `mcpCatalog` down)

- [ ] **Step 7.1: replace `PropertiesPanel.tsx`**

```tsx
import { useState } from "react";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import type { McpCatalog, PhaseCatalog } from "../types.ts";
import { TabsShell, type TabId } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";
import { McpToolsTab } from "./McpToolsTab.tsx";
import { CredentialsTab } from "./CredentialsTab.tsx";
import { RetryTab } from "./RetryTab.tsx";
import { IoTab } from "./IoTab.tsx";
import { FlowSettingsView } from "./FlowSettingsView.tsx";

export interface PropertiesPanelProps {
  flow: FlowGraph;
  node: FlowNode | null;
  catalog: PhaseCatalog;
  mcpCatalog: McpCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { flow, node, catalog, mcpCatalog, onChange, readOnly } = props;
  const [active, setActive] = useState<TabId>("config");

  if (!node) {
    return (
      <aside className="je-editor__props">
        <div className="je-empty">Select a node to configure it.</div>
      </aside>
    );
  }

  if (node.type === "start") {
    return (
      <aside className="je-editor__props">
        <FlowSettingsView startNode={node} onChange={onChange} readOnly={readOnly} />
      </aside>
    );
  }

  const isPhase = node.type === "phase";

  return (
    <aside className="je-editor__props">
      <div className="je-props__title">{node.displayName ?? node.type}</div>
      {isPhase ? (
        <TabsShell active={active} onChange={setActive}>
          {active === "config"      && <ConfigTab    node={node} catalog={catalog} onChange={onChange} readOnly={readOnly} />}
          {active === "mcp"         && <McpToolsTab  node={node} catalog={mcpCatalog} onChange={onChange} readOnly={readOnly} />}
          {active === "credentials" && <CredentialsTab node={node} onChange={onChange} readOnly={readOnly} />}
          {active === "retry"       && <RetryTab     node={node} onChange={onChange} readOnly={readOnly} />}
          {active === "io"          && <IoTab        flow={flow} node={node} onChange={onChange} readOnly={readOnly} />}
        </TabsShell>
      ) : (
        <div className="je-empty">
          {node.type === "end" ? "End node — set the outcome label in the Inspector (Phase 6)." : "Control nodes have no per-tab config in v0."}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 7.2: thread `flow` and `mcpCatalog` through `FlowEditor.tsx`**

In `FlowEditor.tsx`, change the `<PropertiesPanel>` element to:

```tsx
<PropertiesPanel
  flow={props.flow}
  node={s.selectedNode}
  catalog={props.phaseCatalog}
  mcpCatalog={props.mcpCatalog ?? []}
  onChange={onUpdateNode}
  readOnly={props.readOnly}
/>
```

(No other changes in `FlowEditor.tsx`.)

---

## Task 8: Converter emits per-phase retry into Conductor SIMPLE tasks

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-types.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 8.1: extend `SimpleTask` shape**

In `conductor-types.ts`, change `SimpleTask`:

```typescript
export interface SimpleTask {
  type: "SIMPLE";
  name: string;
  taskReferenceName: string;
  inputParameters: Record<string, unknown>;
  retryCount?: number;
  retryLogic?: "FIXED" | "LINEAR_BACKOFF" | "EXPONENTIAL_BACKOFF";
  retryDelaySeconds?: number;
  backoffScaleFactor?: number;
  timeoutSeconds?: number;
  responseTimeoutSeconds?: number;
}
```

And extend `ConductorWorkflowDef`:

```typescript
export interface ConductorWorkflowDef {
  name: string;
  version: number;
  schemaVersion: 2;
  tasks: ConductorTaskDef[];
  cycleVisitLimit?: number;
  /** Flow-level retry policy. Phase 5 emits but Conductor's interpretation
   *  is left to the orchestrator's resubmission logic — Phase 5 stops at the
   *  data shape; runtime retry of the whole workflow lands in Phase 7. */
  flowRetry?: { maxAttempts?: number; backoffSeconds?: number };
}
```

- [ ] **Step 8.2: update `conductor-converter.ts`'s `emitPhase` and `toEngineJson`**

Replace `emitPhase` with:

```typescript
emitPhase(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
  if (!node.phaseType) throw new FlowValidationError(`Phase node '${node.id}' missing phaseType`);
  const r = node.retry ?? {};
  const enabled = r.enabled === true;

  const task: SimpleTask = {
    type: "SIMPLE",
    name: node.phaseType,
    taskReferenceName: node.id,
    inputParameters: { ...(node.config ?? {}) },
    retryCount: enabled ? (r.maxAttempts ?? 3) : 0,
    retryLogic: enabled ? mapBackoff(r.backoff ?? "exponential") : "FIXED",
    retryDelaySeconds: enabled ? (r.backoffSeconds ?? 5) : 0,
    backoffScaleFactor: enabled ? (r.backoffMultiplier ?? 2) : 1,
    timeoutSeconds: r.timeoutSeconds ?? 600,
    responseTimeoutSeconds: r.timeoutSeconds ?? 600,
  };
  return { tasks: [task], nextNodeId: this.successor(node.id) };
}
```

Add the helper at the bottom of the file (alongside `findConvergence`):

```typescript
function mapBackoff(b: "fixed" | "linear" | "exponential"): "FIXED" | "LINEAR_BACKOFF" | "EXPONENTIAL_BACKOFF" {
  switch (b) {
    case "fixed":       return "FIXED";
    case "linear":      return "LINEAR_BACKOFF";
    case "exponential": return "EXPONENTIAL_BACKOFF";
  }
}
```

Update `toEngineJson` to read flow-level retry from the start node's `config.flowRetry`:

```typescript
toEngineJson(def: FlowGraph, opts: {
  workflowName: string;
  workflowVersion: number;
}): ConductorWorkflowDef {
  const ctx = new ConvertCtx(def);
  ctx.validate();

  const start = ctx.startNode();
  const tasks = ctx.buildSequence(ctx.successor(start.id));
  const flowRetry = (start.config as { flowRetry?: { maxAttempts?: number; backoffSeconds?: number } } | undefined)?.flowRetry;

  return {
    name: opts.workflowName,
    version: opts.workflowVersion,
    schemaVersion: 2,
    tasks,
    cycleVisitLimit: def.maxCycleVisits ?? 100,
    ...(flowRetry ? { flowRetry } : {}),
  };
}
```

---

## Task 9: Worker harness — retry classification + credential resolution

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

The worker now (a) merges declared credentials into the env it passes to the handler, and (b) classifies failures against `retry.retryOn` / `retry.stopOn` patterns to choose `FAILED` (Conductor will retry) vs `FAILED_WITH_TERMINAL_ERROR` (route via error edge).

- [ ] **Step 9.1: extend the harness with credential resolution and classification**

Inside `processOnce`, between `ackTask` and `recordVisit`, add:

```typescript
const declaredCreds = (task.inputData?.credentials ?? {}) as Record<string, string>;
const resolvedEnv = await this.deps.credentials
  .resolve(declaredCreds, { userId: null, flowId: null })
  .catch(() => ({})); // fail-open in v0; surfaces as missing env to the handler
```

Then, where the handler is invoked, change `env: process.env as Record<string, string>` to:

```typescript
env: { ...(process.env as Record<string, string>), ...resolvedEnv },
```

And replace the failure branch (the `} else {` that emits `phase.failed`) with:

```typescript
} else {
  const retry = (task.inputData?.retry ?? {}) as {
    retryOn?: string[]; stopOn?: string[];
  };
  const cls = result.failure.errorClass ?? "Error";
  const matchesAny = (patterns?: string[]) =>
    Array.isArray(patterns) && patterns.some(p => new RegExp(p).test(cls));
  const stop = matchesAny(retry.stopOn);
  const retryable = !stop && (result.failure.retryable ?? matchesAny(retry.retryOn));

  await this.deps.events.append({
    runId, nodeId, eventType: "phase.failed",
    payload: { error: result.failure, classified: { retryable, stop } },
  });
  await this.deps.client.completeTask({
    workflowInstanceId: runId, taskId: task.taskId,
    status: retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
    reasonForIncompletion: result.failure.message,
  });
}
```

(The `task.inputData` is the SIMPLE task's `inputParameters`, which the converter populated from `node.config`. The retry block is added by the converter as part of `inputParameters` — see Step 9.2.)

- [ ] **Step 9.2: tweak the converter to bundle retry/credentials inside `inputParameters`**

The Conductor `retryCount` etc. fields handle Conductor's own retry semantics. But the worker also needs the human-readable retry policy to classify failures. Pass it through.

In `conductor-converter.ts`'s `emitPhase`, change the `inputParameters` line to include `retry` and `credentials`:

```typescript
inputParameters: {
  ...(node.config ?? {}),
  retry: node.retry ?? {},
  credentials: ((node.config ?? {}) as { credentials?: Record<string, string> }).credentials ?? {},
},
```

(The converter already reads `node.retry` for the Conductor-level fields; this duplicates a minimal copy into the input payload so the worker can read it. Phase 6 may consolidate via a richer task-data wrapper.)

---

## Task 10: install + repo-wide typecheck + smoke

- [ ] **Step 10.1: `npm install`** (no new deps; just relinks).

- [ ] **Step 10.2: typecheck**

```bash
npm run typecheck
```

Expected: green across all 16 workspaces.

- [ ] **Step 10.3: smoke test (manual)**

1. `npm run infra:up && npm run migrate && npm run start:api-server & npm run start:worker & npm run dev:web`
2. Open a flow, drop an Analyze phase, click it. The right panel now has 5 tabs.
   - **Config**: change name and prompt. ✓
   - **MCP & Tools**: enable filesystem + jira; type `Bash, Read, mcp__jira__*` into Allowed tools. ✓
   - **Credentials**: add `JIRA_API_TOKEN = env:JIRA_API_TOKEN` and `JIRA_EMAIL = env:JIRA_EMAIL`. ✓
   - **Retry**: enable retry, max=3, exponential, base=5s, retry-on=`RateLimitError`, stop-on=`AuthError`. ✓
   - **I/O**: add an input `ticket` ← `step_get_ticket.output.body`; output schema `{"type":"object"}`. ✓
3. Click the **start** node. The right panel switches to "Flow settings" with flow-level retry and max-cycle-visits.
4. Save & Run. The toast appears. The Conductor UI shows the SIMPLE task with `retryCount: 3`, `retryLogic: EXPONENTIAL_BACKOFF`, and the `inputParameters` payload contains the full `retry` and `credentials` objects.
5. Force a `RateLimitError` once from the AnalyzePhaseHandler (temporary stub) — the worker should classify it as retryable, Conductor should re-dispatch the task, and the run completes after the second attempt.

---

## Self-Review Checklist

**Spec coverage (Phase 5 from §12):**
- [x] **MCP & Tools tab** — multi-select MCP picker (built-in + provided), allowed-tools whitelist — Tasks 3, 6.1
- [x] **Credentials tab** — env-var-name → credential-ref rows (`env:NAME`, `user:NAME`, `flow:NAME`) — Task 6.2 (`user:`/`flow:` resolved by `EnvCredentialStore`'s successor in Phase 7)
- [x] **Retry & Errors tab** — enabled, maxAttempts, backoff (3 strategies), backoffSeconds, multiplier, timeout, retryOn/stopOn pattern arrays, onFailure routing — Task 6.3
- [x] **Inputs/Outputs tab** — wire upstream node outputs into named inputs; output schema editor — Task 6.4
- [x] **Flow-level retry policy on start node** — Task 6.5 (FlowSettingsView)
- [x] **Converter emits Conductor retry config + flow retry** — Task 8
- [x] **Worker classifies retryable vs terminal failures** — Task 9

**Out of scope deferred (documented inline):**
- User-supplied custom MCP servers (per-user vault) — Phase 7
- Real `user:`/`flow:` credential resolution against an encrypted store — Phase 7
- Conductor-level workflow-restart driven by `flowRetry` — Phase 7 (data shape lands now)
- `retry-block` and `try-catch` region nodes — Phase 6
- Resume / fork / cancel / export run actions — Phase 6

**Type consistency:**
- `RetryPolicy` is the same shape on `FlowNode.retry` and inside the worker's `task.inputData.retry`.
- `McpServerConfig.id` matches `McpCatalogEntry.id` (catalog → enabled list).
- `defaultMcpCatalog` (in flow-editor) is the only MCP source for v1; user/flow scopes are flagged for Phase 7.
- Schema relax allows `retry: z.record(z.unknown())` so the api-server doesn't tightly couple to the policy shape — keeps backward compat if the policy grows.

**Phase 5 known limitations (deliberate):**
- The Conductor `flowRetry` field is emitted but not interpreted at runtime — it's a data-only deliverable until Phase 7 wires whole-workflow retries.
- `EnvCredentialStore` rejects any `user:` or `flow:` ref. The Credentials tab UI accepts them (so users can pre-author flows), but runtime resolution will fail until Phase 7.
- The MCP catalog's HTTP entries are placeholders — actual delivery of MCP servers to phase handlers (so the AnalyzePhase can use Jira) requires the worker to plumb MCP config into the `query()` call's `mcpServers` option, which is in scope **only for the analyze handler** in Phase 5 if time permits, otherwise Phase 7.
