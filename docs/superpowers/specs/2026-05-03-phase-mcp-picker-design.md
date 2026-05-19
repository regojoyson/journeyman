# Phase MCP Picker — Design

**Date:** 2026-05-03
**Status:** Design approved, pending spec review
**Builds on:**
- [2026-05-03-mcp-management-design.md](./2026-05-03-mcp-management-design.md)
- [2026-05-03-mcp-management-ui-design.md](./2026-05-03-mcp-management-ui-design.md)

## Problem

The MCP backend and management UI exist, but a flow author still cannot attach an MCP to a phase. The flow editor's properties panel has an "MCP & Tools" tab today, but it uses an obsolete model — it stores `node.config.mcp: McpServerConfig[]` (full server configs inlined per node) and a free-text "Allowed tools" textarea. There's no integration with the new `jm_mcp_instances` registry, and no worker-side resolution from `mcpInstanceIds` to `ResolvedMcpInstance[]`.

This iteration replaces the old tab with a picker against the user's saved MCP instances, and wires the worker to resolve them at run time.

## Goals

- Replace [`McpToolsTab.tsx`](../../../packages/flow-editor/src/properties-panel/McpToolsTab.tsx) with a checkbox list backed by `GET /api/orgs/:orgId/mcp-instances/visible`.
- Persist selections as `node.config.mcpInstanceIds: string[]`.
- Strip stale `node.config.mcp` and `node.config.allowedTools` from any flow loaded into the editor (forced re-pick).
- Make `analyze-repo`, `plan-implementation`, `implement-changes` phase definitions opt into the MCPs tab.
- Wire the worker to resolve `mcpInstanceIds → ResolvedMcpInstance[]` and attach to `PhaseInput.mcps` before the handler runs.

## Non-goals

- Auto-migrating old `config.mcp` entries to the new `mcpInstanceIds` shape. Old data is dropped at load time.
- Per-MCP tool allow/deny lists. All tools from selected MCPs are auto-allowed by the SDK adapter.
- Save-time warnings about user-scope MCPs reducing portability for other org members. Deferred.
- Inline preview of MCP system prompts. Deferred.

## Migration

When a flow JSON is loaded into the editor, a small migration step strips `mcp` and `allowedTools` from every `node.config`. The migration runs unconditionally — costless when fields are absent.

```ts
// flow-editor: applied during initial load + any external `flow` prop change
function migrateLegacyMcpConfig(flow: FlowGraph): FlowGraph {
  const nodes = flow.nodes.map((n) => {
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    if (!("mcp" in cfg) && !("allowedTools" in cfg)) return n;
    const { mcp: _mcp, allowedTools: _at, ...rest } = cfg;
    return { ...n, config: rest };
  });
  return { ...flow, nodes };
}
```

This drops the legacy fields from the in-memory state. They're not re-saved (because they're not in `config`), so the next save persists a clean shape. The runtime worker has no path that reads the legacy fields, so flows that haven't been re-saved still run safely (with no MCPs attached, as if the field were never set).

## `PhaseDefinition` cleanup

`PhaseDefinition` currently has both `tabs.mcp: TabVisibility` (consumed by the panel) and `supportsMcp?: boolean` (added during the backend plan, never consumed). Keep `tabs.mcp`, **delete `supportsMcp`**.

For each of the three coding-cli phase definitions (`analyze-repo`, `plan-implementation`, `implement-changes`), set `tabs.mcp: "shown"` (replacing the prior value if any).

## New "MCPs" tab

Replace [`McpToolsTab.tsx`](../../../packages/flow-editor/src/properties-panel/McpToolsTab.tsx) with a new implementation in the same file. The tab label becomes **"MCPs"** (drop "& Tools").

Layout:

```
┌─ MCPs ─────────────────────────────────────────────────────┐
│ MCPs to attach when this phase runs.                        │
│ Manage MCPs at /me/mcps or /admin/mcps.                     │
│                                                              │
│ Available MCPs:                                              │
│  ☑ Org Slack        (org)    • http                          │
│  ☐ My Jira          (user)   • http                          │
│  ☑ Local Filesystem (user)   • stdio                         │
│                                                              │
│  (empty state: "No MCPs registered. Add some at /me/mcps.")  │
└──────────────────────────────────────────────────────────────┘
```

Behavior:

- On mount: `GET /api/orgs/:orgId/mcp-instances/visible`. Returns `{ id, name, description, scope, enabled }[]`.
- Render only `enabled === true` rows (already filtered server-side).
- Sort: org-scope first, then user-scope; secondary sort by name.
- Each row: checkbox + name + scope chip + transport hint. Tooltip shows description on hover (when present).
- Toggling writes `node.config.mcpInstanceIds`:
  - empty array → store `[]` (don't delete the key — keeps the schema explicit).
- Empty state when the visible list is empty: small text plus a link "Manage MCPs" to `/me/mcps`.

The tab needs `orgId` to call the visible-list endpoint. The properties panel already accepts `orgId` for the secrets tab; thread the same prop into `McpToolsTab`.

The existing `catalog: McpCatalog` prop on `McpToolsTabProps` becomes unused. Remove the prop and the `catalogs.mcp` plumbing within `ConfigTab` only if it's a clean removal; otherwise leave it (the flow-editor catalog still has consumers in `MyMcpsPage`/`AdminMcpsPage`'s catalog modal — those don't go through this tab).

**Decision:** remove the `catalog` prop from `McpToolsTabProps`. Keep `catalogs.mcp` in `PhaseDefinition` and the `mcpCatalog` plumbing in `FlowEditor` / `PropertiesPanel` so other consumers (e.g. ConfigTab) keep working unchanged.

## Worker resolution

`WorkerHarness` gains an injected dependency mirroring `bindingResolver`:

```ts
export interface WorkerHarnessDeps {
  // ...existing
  mcpResolver: (input: {
    ctx: { userId: string; orgId: string };
    instanceIds: string[];
  }) => Promise<ResolvedMcpInstance[]>;
}
```

In `processOnce`, immediately after the existing secret resolution block (line ~130 in the current file):

```ts
const mcpInstanceIds = Array.isArray(phaseInput.mcpInstanceIds)
  ? (phaseInput.mcpInstanceIds as string[])
  : [];
let mcps: ResolvedMcpInstance[] = [];
if (mcpInstanceIds.length > 0 && userId && orgId) {
  try {
    mcps = await this.deps.mcpResolver({ ctx: { userId, orgId }, instanceIds: mcpInstanceIds });
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
phaseInput.mcps = mcps;
```

Failure modes (from the resolver):

- `MissingMcpInstancesError` — referenced ID is gone or disabled. Flow fails with a terminal error naming the missing IDs.
- `MissingSecretsError` — a binding's secret no longer resolves. Same handling.

Both are terminal because re-running won't fix the underlying registry state — the flow needs editing.

When `userId` or `orgId` is null (anonymous runs), MCP resolution is skipped. This matches the existing secret-resolution behavior in the same file. If a flow with `mcpInstanceIds` runs anonymously, the resolution is silently skipped — the run proceeds without MCPs. Acceptable: anonymous runs are out-of-band tooling, not the main UX path.

## Composition wiring

`packages/orchestrator/src/cli-worker.ts` imports `resolveMcpInstances` from `@journeyman/mcp` and curries the pool:

```ts
import { resolveMcpInstances } from "@journeyman/mcp";

// ...
const harness = new WorkerHarness({
  // ...existing
  mcpResolver: ({ ctx, instanceIds }) => {
    if (!pool) return Promise.resolve([]);
    return resolveMcpInstances(pool, ctx, instanceIds);
  },
});
```

When `pool` is null (memory-only mode), MCP resolution short-circuits to an empty array — same defensive pattern used elsewhere in the file.

`@journeyman/orchestrator/package.json` gets a new dependency on `@journeyman/mcp`.

## Files

### Created
- (none — all changes are modifications)

### Modified
- `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` — full rewrite (new picker against visible MCPs).
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — pass `orgId` to `McpToolsTab`; drop `catalog` prop on the tab.
- `packages/flow-editor/src/FlowEditor.tsx` (or wherever flow JSON is loaded) — apply `migrateLegacyMcpConfig` on load.
- `packages/flow-editor/src/phase-definition.ts` — remove `supportsMcp` field.
- The three phase-definition files (analyze, plan, implement) — set `tabs.mcp: "shown"`. Locate them via grep for `phaseType: "analyze-repo"` etc.
- `packages/orchestrator/src/workers/worker-harness.ts` — add `mcpResolver` dep; resolve MCPs after secrets in `processOnce`.
- `packages/orchestrator/src/cli-worker.ts` — wire `mcpResolver`.
- `packages/orchestrator/package.json` — add `@journeyman/mcp` dependency.

## Edge cases

| Scenario | Behavior |
|---|---|
| Phase config has no `mcpInstanceIds` | Worker treats as empty; no MCPs attached. |
| `mcpInstanceIds` references a disabled MCP | `MissingMcpInstancesError` → flow fails terminal. |
| `mcpInstanceIds` references a deleted MCP | Same as disabled. |
| User who saved the flow and user who runs it differ; saved MCP is user-scope of saver | Resolver can't see it — `MissingMcpInstancesError`. Author should pick org-scope instead. |
| Anonymous run | Resolution skipped silently; run proceeds without MCPs. |
| Old flow JSON with `config.mcp: [...]` opens in editor | Migration strips it; user re-picks; saving emits clean shape. |
| Old flow JSON with `config.mcp: [...]` runs without re-saving | Worker ignores `config.mcp` entirely; only reads `mcpInstanceIds`. Run proceeds with no MCPs (same as if not picked). |

## Implementation Status (post-merge)

Update CLAUDE.md:

| Feature | Status |
|---|---|
| Flow-editor MCP picker UI | Implemented |
| Worker pre-resolution of `mcpInstanceIds → ResolvedMcpInstance[]` | Implemented |
| `PhaseDefinition.supportsMcp` flag | Removed (unused; replaced by existing `tabs.mcp`) |
| Legacy `config.mcp` / `config.allowedTools` migration | Implemented (load-time strip) |
| `analyze-repo`/`plan-implementation`/`implement-changes` opt into MCPs tab | Implemented |
