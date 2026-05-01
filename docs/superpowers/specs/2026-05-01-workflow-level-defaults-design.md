# Workflow-Level Config Defaults

**Date:** 2026-05-01
**Status:** Approved

---

## Problem

Several `FlowNode` fields must be set redundantly on every phase node in a flow:

- `executorConfig.provider` — every coding-cli phase repeats `{ provider: "claude" }`
- `retry` — every phase repeats the same backoff policy
- `secretBindings` — every phase repeats the same slot-to-scope bindings
- `inputs` — common wiring (`dirPath`, `targetDir`, `workspaceDir`) is re-declared on every phase that needs it

A flow with 8 coding-cli phases requires 8 identical `executorConfig` blocks, 8 retry policies, 8 binding maps, and 8 copies of the same `dirPath` wire. Changing the provider or the workspace dir ref means editing every node.

---

## Goal

Add a `defaults` block to `FlowGraph` that acts as a workflow-level fallback for per-node config. Individual phase nodes can override any field; unset fields inherit from the workflow default. The editor surfaces clearly — per field — whether a value is inherited or locally overriding.

---

## Decisions

| Question | Decision |
|---|---|
| Which fields | `retry`, `executorConfig`, `secretBindings`, `inputs` |
| Merge behaviour | Field-level (key-by-key) merge; `null` on a **node** field suppresses the workflow default for that field |
| Location in data model | New `FlowGraph.defaults` top-level field — not on the start node |
| Scope of `executorConfig` | Flat — one provider default applies to all phases |
| Editor entry point | Topbar "Flow Config" button → dedicated `FlowConfigPanel` |
| Per-field override display | Every config field in every phase tab shows one of four states: inherited / override / local / unset |

---

## Data Model

### Extended `FlowInputValue`

A new `suppress` kind is added so a phase can explicitly opt out of one inherited input key without nulling the whole `inputs` map:

```ts
// packages/core/src/types/flow.types.ts

export type FlowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string }
  | { kind: "suppress" };   // new — cancels a specific inherited input key
```

### New type: `FlowDefaults`

```ts
// packages/core/src/types/flow.types.ts

export interface FlowDefaults {
  /** Default retry policy inherited by all phase nodes. */
  retry?: RetryPolicy;

  /** Default executor config inherited by all phase nodes. */
  executorConfig?: { provider?: string };

  /** Default secret bindings inherited slot-by-slot by all phase nodes. */
  secretBindings?: Record<string, SecretBinding>;

  /** Default input wiring inherited key-by-key by all phase nodes. */
  inputs?: Record<string, FlowInputValue>;
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

`FLOW_SCHEMA_VERSION` is **not** bumped. `defaults` is optional and additive; existing flows without it are fully valid.

### Updated `FlowNode` fields

The four fields that participate in inheritance need `| null` to allow the suppress sentinel:

```ts
// packages/core/src/types/flow.types.ts — FlowNode interface, updated fields only
retry?: RetryPolicy | null;                             // was: RetryPolicy
executorConfig?: { provider?: string } | null;          // was: { provider?: string }
secretBindings?: Record<string, SecretBinding> | null;  // was: Record<string, SecretBinding>
inputs?: Record<string, FlowInputValue> | null;         // was: Record<string, FlowInputValue>
```

Existing flows serialised without `null` remain valid — `undefined` means "not set, inherit if a default exists."

---

## Merge Rules

All merging happens in the orchestrator before a phase runs. Phase handlers always receive a fully-resolved node with no knowledge of defaults.

### Merge semantics per value

For every field that participates in inheritance, the resolution order is:

```
node value (explicit) → workflow default → system default (undefined / existing behaviour)
```

| Node value | Workflow default | Resolved value |
|---|---|---|
| `undefined` | `undefined` | `undefined` (existing behaviour) |
| `undefined` | set | workflow default |
| set | `undefined` | node value |
| set | set | field-level merge: node fields win, missing fields fall back to default |
| `null` | anything | `undefined` (suppressed — no value applied) |

### `retry` — field-level merge within `RetryPolicy`

```
resolved.retry = merge(node.retry, defaults.retry)
```

- Node `null` → resolved retry is `undefined` (suppressed)
- Node `undefined` + default set → resolved retry = default (whole object)
- Both set → `{ ...default, ...node }` — each node key wins; unset keys fall back to default

Example: default `{ maxAttempts: 3, backoff: "exponential" }`, node `{ maxAttempts: 1 }` →
resolved `{ maxAttempts: 1, backoff: "exponential" }`.

### `executorConfig` — field-level merge on `{ provider? }`

Same pattern as `retry`. Node `{ provider: "gemini" }` overrides just the provider; all other keys fall back to default.

### `secretBindings` — slot-by-slot merge

```
resolved.secretBindings = { ...defaults.secretBindings, ...node.secretBindings }
```

- Node `null` → all inherited bindings suppressed for this node
- Node `{}` → inherits all default slots (empty object does not suppress)
- Node with slots → named slots override default; unnamed slots inherited

### `inputs` — key-by-key merge

```
resolved.inputs = { ...defaults.inputs, ...node.inputs }
```

Then filter: any key whose resolved value is `{ kind: "suppress" }` is removed from the map.

- Node `null` → all inherited input wiring suppressed for this node
- Node `{ dirPath: { kind: "suppress" } }` → removes `dirPath` from the inherited map; all other inherited keys remain
- Node sets a key explicitly → that key's value wins over the default

---

## Orchestrator Changes

### New utility: `apply-flow-defaults.ts`

```ts
// packages/orchestrator/src/flow-json/apply-flow-defaults.ts

import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding, FlowInputValue } from "@journeyman/core";

export function applyFlowDefaults(node: FlowNode, defaults: FlowDefaults | undefined): FlowNode {
  if (!defaults) return node;
  return {
    ...node,
    retry:          mergeRetry(node.retry, defaults.retry),
    executorConfig: mergeExecutorConfig(node.executorConfig, defaults.executorConfig),
    secretBindings: mergeMap(node.secretBindings, defaults.secretBindings),
    inputs:         mergeInputs(node.inputs, defaults.inputs),
  };
}

function mergeRetry(
  node: RetryPolicy | null | undefined,
  def: RetryPolicy | null | undefined,
): RetryPolicy | undefined {
  if (node === null) return undefined;
  if (!def)  return node ?? undefined;
  if (!node) return def;
  return { ...def, ...node };
}

function mergeExecutorConfig(
  node: { provider?: string } | null | undefined,
  def:  { provider?: string } | null | undefined,
): { provider?: string } | undefined {
  if (node === null) return undefined;
  if (!def)  return node ?? undefined;
  if (!node) return def;
  return { ...def, ...node };
}

function mergeMap<V>(
  node: Record<string, V> | null | undefined,
  def:  Record<string, V> | null | undefined,
): Record<string, V> | undefined {
  if (node === null) return undefined;
  if (!def)  return node ?? undefined;
  if (!node) return def;
  return { ...def, ...node };
}

function mergeInputs(
  node: Record<string, FlowInputValue> | null | undefined,
  def:  Record<string, FlowInputValue> | null | undefined,
): Record<string, FlowInputValue> | undefined {
  if (node === null) return undefined;
  if (!def)  return node ?? undefined;
  if (!node) return def;
  const merged = { ...def, ...node };
  // remove any key explicitly suppressed by the node
  for (const [k, v] of Object.entries(merged)) {
    if (v.kind === "suppress") delete merged[k];
  }
  return merged;
}
```

### Integration point in `conductor-converter.ts`

`applyFlowDefaults(node, graph.defaults)` is called once per `phase` node during graph-to-conductor conversion, before the node is handed to the worker. No other layer is aware of the defaults system.

---

## Editor Changes

### 1. Topbar — "Flow Config" button

A new icon button (gear/sliders icon) is added to the topbar alongside the existing save/run controls. Clicking it toggles the `FlowConfigPanel`.

Existing start-node settings (`runInputs`, `maxCycleVisits`, `flowRetry`) remain on the start node for now and are not migrated in this change.

### 2. `FlowConfigPanel` — new component tree

```
packages/flow-editor/src/flow-config/
├── FlowConfigPanel.tsx           — panel shell (title, close button, sections)
├── DefaultsExecutorSection.tsx   — provider default (reuses ExecutorBlock)
├── DefaultsRetrySection.tsx      — retry defaults (reuses RetryTab field components)
├── DefaultsSecretsSection.tsx    — secret binding defaults (reuses binding row components)
└── DefaultsInputsSection.tsx     — input wiring defaults (reuses ValuePicker rows)
```

Each section is independently collapsible. All four sections start in "not set" state on new flows.

`FlowConfigPanel` receives `flow: FlowGraph` and `onChange: (next: FlowGraph) => void`. It writes changes to `flow.defaults` directly.

### 3. Per-field inheritance states in phase panels

Every config field in every phase tab displays one of four states. This applies to: the **Retry** tab, the **Config** tab (provider via `ExecutorBlock`), the **Required Secrets** tab, and the **IO** tab.

#### The four states

| State | When | Visual treatment |
|---|---|---|
| **Inherited** | Node does not set this field; workflow default exists | Value shown dimmed with a `FROM FLOW` chip. Read-only until activated. |
| **Override** | Node explicitly sets this field; workflow default also exists | Value shown normally with an `OVERRIDE` chip and a reset-to-default button (↺) |
| **Local** | Node sets this field; no workflow default exists | Value shown normally, no chip |
| **Unset** | Neither node nor workflow default sets this field | Empty placeholder, no chip (existing behaviour) |

#### Interaction model

- **Activating an inherited field**: clicking an inherited (dimmed) field writes the current inherited value explicitly onto the node, switching it to Override state. The user then edits from there.
- **Resetting an override**: clicking the ↺ button removes the explicit node value, reverting to Inherited state.
- **Suppressing an inherited field** (advanced): a "Don't inherit" toggle on an inherited field writes `null` (for top-level fields like `retry`) or `{ kind: "suppress" }` (for individual `inputs` keys). The field then shows a **Suppressed** sub-state with a "Re-enable" affordance.

#### Field granularity

Inheritance state is computed per field, not per tab:

- `retry`: each of `enabled`, `maxAttempts`, `backoff`, `backoffSeconds`, `backoffMultiplier`, `timeoutSeconds`, `onFailure` shows its own state chip
- `executorConfig`: `provider` shows its own chip
- `secretBindings`: each slot row shows its own chip
- `inputs`: each input key row shows its own chip

#### Hook: `useFieldInheritance`

A new hook drives the chip logic across all tabs:

```ts
// packages/flow-editor/src/hooks/use-field-inheritance.ts

export type FieldState = "inherited" | "override" | "local" | "unset";

export function useFieldInheritance(
  nodeValue: unknown,        // value on the node (undefined if not set)
  defaultValue: unknown,     // value from flow defaults (undefined if not set)
): {
  state: FieldState;
  resolvedValue: unknown;    // the effective value (node or default)
  onActivate: () => void;    // write resolved value onto node
  onReset: () => void;       // remove node override
}
```

`useFieldInheritance` is called per field inside `RetryTab`, `ExecutorBlock`, `RequiredSecretsTab`, and `IoTab`. The parent panel passes down `flowDefaults` alongside the node, so each field can compute its state.

#### Visual chip component

```tsx
// packages/flow-editor/src/properties-panel/InheritanceChip.tsx

type ChipKind = "inherited" | "override" | "suppressed";

export function InheritanceChip({ kind, onReset }: { kind: ChipKind; onReset?: () => void }) { ... }
```

Chips are small, inline, and low-contrast so they don't compete with field values. `OVERRIDE` chip includes the ↺ reset button. `INHERITED` chip is display-only.

---

## Run Execution

### How defaults are applied

`applyFlowDefaults` is called in `conductor-converter.ts` during graph compilation, before tasks are dispatched. The resolved `FlowNode` that reaches the worker always has fully merged fields — no worker-side awareness of defaults is needed.

### Traceability

When `applyFlowDefaults` modifies a field, the resolver records the source. This is stored alongside the step record for inspection:

```ts
// added to StepRecord in packages/core/src/types/pipeline.types.ts
inputSources?: Record<string, "node" | "flow-default">;
```

`inputSources` is a map of field name to where the value came from. Populated by `applyFlowDefaults` — any key that was inherited from the workflow default is tagged `"flow-default"`. Node-set values are tagged `"node"`.

### Run viewer display

The run viewer's step detail panel shows `inputSources` alongside input values:

- Fields tagged `"flow-default"` are rendered with a subtle "from flow defaults" annotation
- Fields tagged `"node"` are rendered normally

This makes it easy to diagnose why a phase ran with a particular provider, retry policy, or workspace path without having to open the flow editor.

---

## Schema Validation

`packages/api-server/src/schemas/update-flow.ts` adds a `flowDefaultsSchema`:

```ts
const flowInputValueSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("ref"),     ref: z.string() }),
  z.object({ kind: z.literal("suppress") }),
]);

const flowDefaultsSchema = z.object({
  retry:          retryPolicySchema.optional(),
  executorConfig: z.object({ provider: z.string().optional() }).optional(),
  secretBindings: z.record(secretBindingSchema).optional(),
  inputs:         z.record(flowInputValueSchema).optional(),
}).optional();

// FlowNode fields that carry | null (suppress sentinel) need nullable() in the
// existing FlowGraph node schema:
//   retry:          retryPolicySchema.nullable().optional()
//   executorConfig: executorConfigSchema.nullable().optional()
//   secretBindings: z.record(secretBindingSchema).nullable().optional()
//   inputs:         z.record(flowInputValueSchema).nullable().optional()
```

Added to the existing `FlowGraph` Zod schema as `defaults: flowDefaultsSchema`.

---

## What Is Not In Scope

- Migrating existing start-node settings (`runInputs`, `maxCycleVisits`, `flowRetry`) into the Flow Config panel — separate cleanup.
- Per-executor-kind scoping of `executorConfig.provider` — flat defaults cover the common case.
- Default `config` (free-form phase config fields) — these are too phase-specific to have meaningful workflow-level defaults; handled per-phase as today.
