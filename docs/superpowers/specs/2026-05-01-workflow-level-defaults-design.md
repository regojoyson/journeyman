# Workflow-Level Config Defaults

**Date:** 2026-05-01
**Status:** Approved

## Problem

Several `FlowNode` fields must be set redundantly on every phase node in a flow:

- `executorConfig.provider` — e.g., every coding-cli phase repeats `{ provider: "claude" }`
- `retry` — every phase repeats the same backoff policy
- `secretBindings` — every phase repeats the same slot-to-scope bindings

A flow with 8 coding-cli phases requires 8 identical `executorConfig` objects, 8 identical `retry` blocks, and 8 identical binding maps. Changing the provider means editing every node.

## Goal

Add a `defaults` block to `FlowGraph` that acts as a workflow-level fallback for per-node config. Individual phase nodes can override any field; unset fields inherit from the workflow default.

## Decisions

| Question | Decision |
|---|---|
| Which fields | `retry`, `executorConfig`, `secretBindings` |
| Merge behaviour | Field-level merge; `null` on a node field suppresses the workflow default for that field |
| Location in data model | New `FlowGraph.defaults` top-level field (not on start node) |
| Scope of executorConfig | Flat — one provider default applies to all phases that match the name |
| Editor entry point | Topbar "Flow Config" button → dedicated panel |

## Data Model

### New type: `FlowDefaults`

```ts
// packages/core/src/types/flow.types.ts

export interface FlowDefaults {
  /**
   * Default retry policy for all phase nodes.
   * Merged field-by-field into each node's `retry`.
   * null = no workflow default (suppress inheritance).
   */
  retry?: RetryPolicy | null;

  /**
   * Default executor config for all phase nodes.
   * Merged field-by-field into each node's `executorConfig`.
   * null = no workflow default.
   */
  executorConfig?: { provider?: string } | null;

  /**
   * Default secret bindings.
   * Merged slot-by-slot (key-by-key) into each node's `secretBindings`.
   * null = no workflow default.
   */
  secretBindings?: Record<string, SecretBinding> | null;
}
```

### Updated `FlowGraph`

```ts
export interface FlowGraph {
  schemaVersion: FlowSchemaVersion;
  nodes: FlowNode[];
  edges: FlowEdge[];
  maxCycleVisits?: number;
  defaults?: FlowDefaults;   // new — optional, additive
}
```

`FLOW_SCHEMA_VERSION` is **not** bumped — `defaults` is optional and additive; existing flows without it are fully valid.

### Updated `FlowNode` fields

The three fields that participate in inheritance need `| null` to express the suppress-sentinel:

```ts
// packages/core/src/types/flow.types.ts — existing FlowNode interface, updated fields only
retry?: RetryPolicy | null;                           // was: RetryPolicy
executorConfig?: { provider?: string } | null;        // was: { provider?: string }
secretBindings?: Record<string, SecretBinding> | null; // was: Record<string, SecretBinding>
```

Existing flows serialised without `null` on these fields remain valid — `undefined` continues to mean "not set."

## Merge Rules

Applied in the orchestrator before phase execution. Rules per field:

### `retry`
- Node `retry` is `undefined` → inherit workflow default as-is
- Node `retry` is an object → field-level merge: each defined key on the node wins; undefined keys fall back to the workflow default
- Node `retry` is `null` → no retry policy applied (workflow default suppressed)
- No workflow default → node `retry` used as-is (existing behaviour)

### `executorConfig`
- Same pattern as `retry`, field-by-field merge on `{ provider? }`

### `secretBindings`
- Workflow default slots are the base map
- Phase-level slots override by key (slot name)
- Phase `secretBindings: null` → clear all inherited bindings for this node
- Phase `secretBindings: {}` → inherits all workflow default slots (empty object does not suppress)

## Orchestrator Changes

### New utility: `applyFlowDefaults`

```ts
// packages/orchestrator/src/flow-json/apply-flow-defaults.ts

import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding } from "@journeyman/core";

export function applyFlowDefaults(node: FlowNode, defaults: FlowDefaults | undefined): FlowNode {
  if (!defaults) return node;
  return {
    ...node,
    retry:          mergeRetry(node.retry, defaults.retry),
    executorConfig: mergeExecutorConfig(node.executorConfig, defaults.executorConfig),
    secretBindings: mergeSecretBindings(node.secretBindings, defaults.secretBindings),
  };
}

function mergeRetry(
  node: RetryPolicy | null | undefined,
  def: RetryPolicy | null | undefined,
): RetryPolicy | undefined {
  if (node === null) return undefined;           // explicit suppress
  if (!def) return node ?? undefined;            // no workflow default
  if (!node) return def;                         // fully inherit
  return { ...def, ...node };                    // field-level merge: node wins
}

function mergeExecutorConfig(
  node: { provider?: string } | null | undefined,
  def: { provider?: string } | null | undefined,
): { provider?: string } | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) return def;
  return { ...def, ...node };
}

function mergeSecretBindings(
  node: Record<string, SecretBinding> | null | undefined,
  def: Record<string, SecretBinding> | null | undefined,
): Record<string, SecretBinding> | undefined {
  if (node === null) return undefined;
  if (!def) return node ?? undefined;
  if (!node) return def;
  return { ...def, ...node };                    // slot-by-slot: node slots win
}
```

### Integration point

`applyFlowDefaults` is called in `conductor-converter.ts` when building the resolved node for each `phase` node, passing `graph.defaults`. Phase handlers always receive an already-resolved node — they have no knowledge of the defaults system.

## Editor Changes

### Topbar — "Flow Config" button

A new icon button is added to the topbar (alongside existing save/run controls). Clicking it opens a `FlowConfigPanel` — a slide-over or right panel (same shell as the properties panel) showing all workflow-level settings:

- Existing settings currently on the start node (`runInputs`, `maxCycleVisits`, `flowRetry`) remain on the start node panel for now — they are not migrated in this change.
- The Flow Config panel shows only the new `defaults` block: provider, retry defaults, and secret binding defaults.

### `FlowConfigPanel` component

```
packages/flow-editor/src/flow-config/
├── FlowConfigPanel.tsx      — top-level panel shell
├── DefaultsRetrySection.tsx — retry defaults (reuses RetryTab internals)
├── DefaultsExecutorSection.tsx — provider default (reuses ExecutorBlock)
└── DefaultsSecretsSection.tsx  — secret binding defaults (reuses binding row components)
```

Each section is independently collapsible. All three are "not set" by default (no defaults block on new flows).

### Phase node panels — inherited value display

When a phase node's field is `undefined` (not locally set) and a workflow default exists for it, the relevant tab displays the inherited value with a subtle "Inherited from flow" label below the field. The field is visually dimmed.

- Clicking the field activates it and writes the current inherited value explicitly onto the node (override mode).
- A "Reset to flow default" affordance (small × or reset icon) removes the explicit value and restores inheritance.
- If the node field is `null` (suppressed), the field shows "Disabled (flow default suppressed)" with a "Re-enable" affordance.

Affected tabs: **Retry**, **Config** (for provider via `ExecutorBlock`), **Required Secrets**.

## Schema Validation

`packages/api-server/src/schemas/update-flow.ts` adds a `flowDefaultsSchema` Zod shape:

```ts
const flowDefaultsSchema = z.object({
  retry: retryPolicySchema.nullable().optional(),
  executorConfig: z.object({ provider: z.string().optional() }).nullable().optional(),
  secretBindings: z.record(secretBindingSchema).nullable().optional(),
}).optional();
```

Added to the existing `FlowGraph` Zod schema as `defaults: flowDefaultsSchema`.

## What Is Not In Scope

- Migrating existing start-node settings (`runInputs`, `maxCycleVisits`, `flowRetry`) to the new panel — that is a separate cleanup task.
- Default `inputs` wiring (data-flow) — kept per-phase; better addressed by canvas auto-wiring.
- Per-executor-kind scoping of `executorConfig.provider` — flat defaults are sufficient for the common case.
