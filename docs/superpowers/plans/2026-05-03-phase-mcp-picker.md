# Phase MCP Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**User overrides for this plan:** No commits during implementation. No unit tests. Run `npm run typecheck` once at the end.

**Goal:** Replace the obsolete "MCP & Tools" tab with a picker against the user's saved MCP instances. Wire the orchestrator worker to resolve `mcpInstanceIds → ResolvedMcpInstance[]` before invoking phase handlers. Drop the old `supportsMcp` flag. Strip stale `config.mcp` and `config.allowedTools` at flow load.

**Architecture:** Three layers — flow-editor UI (new tab content + load-time migration), worker harness (new injected `mcpResolver` dep mirroring `bindingResolver`), and the composition root (currying the resolver from `@journeyman/mcp`). All three coding-cli phase definitions already have `tabs.mcp: "shown"` — no opt-in change needed at that layer.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Conductor (via existing harness).

**Spec:** [`docs/superpowers/specs/2026-05-03-phase-mcp-picker-design.md`](../specs/2026-05-03-phase-mcp-picker-design.md)

---

## File Structure

### Modified
| Path | Change |
|---|---|
| `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` | Full rewrite — checkbox list against `/mcp-instances/visible`, persists `mcpInstanceIds`. |
| `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` | Pass `orgId` to `McpToolsTab`, drop `catalog` prop on the tab call. |
| `packages/flow-editor/src/FlowEditor.tsx` | Add `migrateLegacyMcpConfig` next to `autoHeal`. |
| `packages/flow-editor/src/phase-definition.ts` | Remove `supportsMcp?: boolean` field (added in earlier iteration, never consumed). |
| `packages/orchestrator/src/workers/worker-harness.ts` | New `mcpResolver` dep; resolve MCPs after secret resolution in `processOnce`. |
| `packages/orchestrator/src/cli-worker.ts` | Wire `mcpResolver` from `@journeyman/mcp`. |
| `packages/orchestrator/package.json` | Add `@journeyman/mcp` dependency. |
| `CLAUDE.md` | Update status table (picker → Implemented; worker resolution → Implemented; supportsMcp → Removed). |

### Created
- (none)

---

## Tasks

### Task 1: Migration helper — `migrateLegacyMcpConfig`

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Add the migration function next to `autoHeal`**

Open `packages/flow-editor/src/FlowEditor.tsx`. Find the existing `autoHeal` function (around line 23). Right after its closing brace, add:

```ts
/** Strip obsolete MCP-related fields from each node's config. The picker now
 *  stores `mcpInstanceIds: string[]` instead of `mcp: McpServerConfig[]`, and
 *  `allowedTools` is no longer used. We drop both unconditionally — costless
 *  when absent. The next save persists a clean shape. */
function migrateLegacyMcpConfig(flow: FlowGraph): FlowGraph {
  let touched = false;
  const nodes = flow.nodes.map((n) => {
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    if (!("mcp" in cfg) && !("allowedTools" in cfg)) return n;
    touched = true;
    const { mcp: _mcp, allowedTools: _at, ...rest } = cfg;
    return { ...n, config: rest };
  });
  return touched ? { ...flow, nodes } : flow;
}
```

- [ ] **Step 2: Apply the migration alongside `autoHeal`**

Find the `useMemo` block that produces `heal`:

```ts
  const heal = useMemo(() => {
    const result = autoHeal(props.flow);
    if (result.restored.length) {
      // eslint-disable-next-line no-console
      console.warn("[FlowEditor] autoHeal restored nodes", result.restored);
    }
    return result;
  }, [props.flow]);
```

Replace the body so the migration runs first:

```ts
  const heal = useMemo(() => {
    const migrated = migrateLegacyMcpConfig(props.flow);
    const result = autoHeal(migrated);
    if (result.restored.length) {
      // eslint-disable-next-line no-console
      console.warn("[FlowEditor] autoHeal restored nodes", result.restored);
    }
    return result;
  }, [props.flow]);
```

The existing `useEffect` that pushes `heal.healed` back via `props.onChange` will also propagate the migrated shape upstream (the parent persists it on next save).

> **Note:** The healed-signature guard at line ~80 keys off `heal.restored.join(",")`. Migration changes alone (with no `autoHeal` restorations) won't trigger an `onChange` push, so the cleaned shape only propagates when the user saves. That's acceptable — the cleanup is local until then, and the runtime tolerates the legacy fields.

---

### Task 2: Remove `supportsMcp` from `PhaseDefinition`

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Delete the field declaration**

Open `packages/flow-editor/src/phase-definition.ts`. Remove the entire block:

```ts
  /**
   * When true, the flow editor properties panel renders an MCP multi-select
   * populated from /api/orgs/:orgId/mcp-instances/visible. The chosen IDs are
   * stored on the phase config under `mcpInstanceIds: string[]`.
   */
  supportsMcp?: boolean;
```

Save. The field has zero readers in the codebase (verified during brainstorming) — the existing `tabs.mcp` covers visibility.

---

### Task 3: Replace `McpToolsTab.tsx`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/McpToolsTab.tsx`

- [ ] **Step 1: Replace the whole file with the new picker**

Overwrite `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` with:

```tsx
import { useEffect, useState } from "react";
import type { FlowNode } from "@journeyman/core";

interface VisibleMcp {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

export interface McpToolsTabProps {
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getSelectedIds(node: FlowNode): string[] {
  const cfg = (node.config ?? {}) as { mcpInstanceIds?: unknown };
  return Array.isArray(cfg.mcpInstanceIds) ? cfg.mcpInstanceIds.filter((x): x is string => typeof x === "string") : [];
}

function setSelectedIds(node: FlowNode, ids: string[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), mcpInstanceIds: ids } };
}

export function McpToolsTab({ node, orgId, onChange, readOnly }: McpToolsTabProps) {
  const [available, setAvailable] = useState<VisibleMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/orgs/${orgId}/mcp-instances/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleMcp[]) => {
        if (!alive) return;
        const sorted = [...rows]
          .filter((m) => m.enabled)
          .sort((a, b) =>
            a.scope === b.scope
              ? a.name.localeCompare(b.name)
              : a.scope === "org" ? -1 : 1
          );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId]);

  const toggle = (id: string) => {
    if (readOnly) return;
    const next = enabledIds.has(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(setSelectedIds(node, next));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>MCPs</label>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          MCPs to attach when this phase runs. Manage your MCPs at <a href="/me/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/mcps</a> or <a href="/admin/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/admin/mcps</a>.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "#888" }}>Loading…</div>
        ) : available.length === 0 ? (
          <div style={{ fontSize: 12, color: "#888" }}>
            No MCPs registered. Add some at <a href="/me/mcps" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/mcps</a>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {available.map((m) => {
              const checked = enabledIds.has(m.id);
              return (
                <label
                  key={m.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#1f1f2c",
                    border: `1px solid ${checked ? "#4a9eff" : "#2a2a3a"}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: readOnly ? "not-allowed" : "pointer",
                    opacity: readOnly ? 0.6 : 1,
                  }}
                  title={m.description ?? ""}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(m.id)}
                  />
                  <span style={{ flex: 1 }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: "#888" }}>{m.scope}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

The new file no longer imports `McpServerConfig` or `McpCatalog`. The "Allowed tools" textarea and the catalog prop are gone.

---

### Task 4: Update `PropertiesPanel.tsx` to pass `orgId` and drop `catalog`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Inspect the existing call site**

Open `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`. Locate the JSX line that invokes `<McpToolsTab ... />` (around line 117 per earlier exploration). It currently looks like:

```tsx
{effectiveActive === "mcp"             && <McpToolsTab        node={node} catalog={mcpCatalog} onChange={onChange} readOnly={readOnly} />}
```

- [ ] **Step 2: Replace the prop list**

Change the line to:

```tsx
{effectiveActive === "mcp"             && <McpToolsTab        node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
```

- [ ] **Step 3: Verify `orgId` is in scope**

Around line 63, the destructure line reads:

```ts
  const { flow, node, mcpCatalog, orgId, onChange, readOnly } = props;
```

`orgId` is already destructured from props (used by the secrets tab). No additional change needed.

- [ ] **Step 4: Remove the unused tab-content default for legacy `mcpTools`**

Around line 98, the panel currently computes badge state from `node.mcpTools` — a dead reference (no node ever sets a top-level `mcpTools` field; the legacy data lived under `node.config.mcp`). Find:

```ts
    mcp: !((node as { mcpTools?: unknown[] }).mcpTools?.length),
```

Replace with logic keyed off the new field:

```ts
    mcp: !(((node.config as { mcpInstanceIds?: unknown[] } | undefined)?.mcpInstanceIds?.length ?? 0) > 0),
```

(This computes "tab is empty / dim" when zero MCPs are picked.)

> **Note:** If the surrounding object has different keys/style, just match the existing pattern — the goal is to read `node.config.mcpInstanceIds.length` instead of `node.mcpTools`.

---

### Task 5: Add `mcpResolver` dependency to `WorkerHarness`

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Add the type import**

At the top of `packages/orchestrator/src/workers/worker-harness.ts`, alongside the existing `@journeyman/core` type imports, add `ResolvedMcpInstance`:

```ts
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
  ResolvedMcpInstance,
} from "@journeyman/core";
```

- [ ] **Step 2: Add `mcpResolver` to `WorkerHarnessDeps`**

Find the `WorkerHarnessDeps` interface. Right after the `bindingResolver` field, append:

```ts
  /**
   * Resolves `mcpInstanceIds` (declared on a phase's node config) into
   * fully-formed `ResolvedMcpInstance[]` ready to hand to coding-cli.
   * Composition root supplies the implementation (curries the pg pool
   * over `resolveMcpInstances` from `@journeyman/mcp`).
   */
  mcpResolver: (input: {
    ctx: { userId: string; orgId: string };
    instanceIds: string[];
  }) => Promise<ResolvedMcpInstance[]>;
```

- [ ] **Step 3: Resolve MCPs in `processOnce`**

Find the existing block in `processOnce` that resolves secrets. It looks roughly like this (line ~105–130):

```ts
    let resolvedEnv: Record<string, string>;
    try {
      // ...slot setup...
      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, orgId, flowId },
        slots,
        bindings: declaredBindings,
      });
      log.info({ runId, nodeId, resolvedKeys: Object.keys(resolvedEnv) }, "secrets resolved");
    } catch (err) {
      // existing error handling...
    }
```

Immediately AFTER the closing brace of that try/catch (i.e. once `resolvedEnv` is in scope), add:

```ts
    const mcpInstanceIds = Array.isArray((phaseInput as { mcpInstanceIds?: unknown }).mcpInstanceIds)
      ? ((phaseInput as { mcpInstanceIds: unknown[] }).mcpInstanceIds.filter(
          (x): x is string => typeof x === "string"
        ))
      : [];
    let mcps: ResolvedMcpInstance[] = [];
    if (mcpInstanceIds.length > 0 && userId && orgId) {
      try {
        mcps = await this.deps.mcpResolver({
          ctx: { userId, orgId },
          instanceIds: mcpInstanceIds,
        });
        log.info({ runId, nodeId, count: mcps.length }, "MCPs resolved");
      } catch (err: any) {
        log.error({ runId, nodeId, err: err?.message }, "MCP resolution failed");
        await this.deps.client.completeTask({
          workflowInstanceId: task.workflowInstanceId,
          taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `MCP resolution failed: ${err?.message ?? String(err)}`,
        });
        return;
      }
    }
    (phaseInput as { mcps?: ResolvedMcpInstance[] }).mcps = mcps;
```

This sits between secret resolution and the handler invocation. The handler (`analyze-repo`, etc.) reads `input.mcps` and passes it through to coding-cli — that wiring is already in place from earlier work.

> **Note:** If the existing secret-resolution try/catch returns early on failure (look for any `return` inside its `catch`), this new block is unreachable when secrets fail — that's correct (no point resolving MCPs if secrets already failed the task). Place the new block strictly after, never inside, the existing try/catch.

---

### Task 6: Wire `mcpResolver` in the composition (`cli-worker.ts`)

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Modify: `packages/orchestrator/package.json`

- [ ] **Step 1: Add the dependency to `package.json`**

Open `packages/orchestrator/package.json`. In `"dependencies"`, add `"@journeyman/mcp": "*"` (alphabetical placement, near the other `@journeyman/*` entries).

- [ ] **Step 2: Import `resolveMcpInstances`**

Open `packages/orchestrator/src/cli-worker.ts`. Add to the imports (alongside the `@journeyman/secrets` or similar imports at the top):

```ts
import { resolveMcpInstances } from "@journeyman/mcp";
```

- [ ] **Step 3: Provide the resolver to the harness**

Find the `new WorkerHarness({...})` call (around line 226). It looks like:

```ts
const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  events,
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
  bindingResolver: cliBindingResolver,
});
```

Add `mcpResolver` after `bindingResolver`:

```ts
const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  events,
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
  bindingResolver: cliBindingResolver,
  mcpResolver: ({ ctx, instanceIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveMcpInstances(pool, ctx, instanceIds);
  },
});
```

When `pool` is null (memory-only mode), MCP resolution short-circuits to `[]` — same defensive pattern as the events/secrets paths above.

- [ ] **Step 4: Refresh workspace links**

Run from the repo root:

```bash
npm install
```

Expected: workspace links the new dep on `@journeyman/mcp`.

---

### Task 7: Update `CLAUDE.md` status table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit the implementation status rows**

Open `CLAUDE.md`. Find the status rows for the MCP feature (added in earlier iterations). Update them:

```
| Flow-editor MCP picker UI | Implemented |
| Worker pre-resolution of `mcpInstanceIds → ResolvedMcpInstance[]` | Implemented |
| `PhaseDefinition.supportsMcp` flag | Removed (unused; replaced by existing `tabs.mcp`) |
| Legacy `config.mcp` / `config.allowedTools` migration | Implemented (load-time strip in flow editor) |
```

Search the file for the previous "Stub" entries and update those lines. Leave unrelated rows alone.

---

### Task 8: Final typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across all workspaces**

```bash
npm run typecheck
```

Expected: every workspace passes (the pre-existing `@journeyman/web/src/routes/FlowEditorPage.tsx:40` error is independent and not addressed here — treat success as: no *new* errors from these changes).

Common failure modes to anticipate:
- `ResolvedMcpInstance` not exported from `@journeyman/core` → it lives in `packages/core/src/types/mcp.types.ts` and is re-exported via `export * from "./types/mcp.types.ts";` in `core/src/index.ts`. Confirm the re-export still exists.
- `resolveMcpInstances` import path broken in `cli-worker.ts` → the function is exported from the package root in `packages/mcp/src/index.ts`. If the import errors, double-check the export list there.
- `McpToolsTabProps` callers other than `PropertiesPanel.tsx` → grep `<McpToolsTab` for any other JSX usage. If found, update to drop `catalog` and pass `orgId`.
- `node.config` shape errors — the new MCP tab uses `(node.config ?? {})` defensively. If TypeScript complains about index access, cast through `Record<string, unknown>` exactly as shown.
- `phaseInput.mcps` assignment in `worker-harness.ts` flagged as adding a property to a typed object → the cast pattern `(phaseInput as { mcps?: ResolvedMcpInstance[] }).mcps = mcps;` matches the existing style in that file (see `_flowDefaultSources` and `secretBindings` reads).

---

## Self-Review Notes

- **Spec coverage check:**
  - Migration (drop legacy fields) → Task 1
  - `supportsMcp` removal → Task 2
  - New picker UI → Task 3 + Task 4
  - Worker resolution → Task 5
  - Composition wiring → Task 6
  - Status table → Task 7
  - Typecheck → Task 8
- **Phase definitions opt-in (analyze-repo, plan-implementation, implement-changes):** verified during planning that all three already have `tabs.mcp: "shown"`. No task needed.
- **Out-of-scope items called out in the spec** (save-time validation, MCP system-prompt preview, anonymous-run resolution) are NOT in this plan — intentionally.
- **No commits / no tests** per user override. Final typecheck is the only validation step.
