# Per-Kind Provider Defaults

**Date:** 2026-05-01
**Status:** Approved

---

## Problem

`FlowDefaults.executorConfig` is currently a flat `{ provider?: string }` — one provider default for all phase types regardless of their executor kind. A flow that uses coding-cli phases (Claude), git-provider phases (GitHub), and ticket-provider phases (Jira) cannot set all three defaults at once; only one can be set, and it is applied to every phase indiscriminately.

---

## Goal

Expand `FlowDefaults.executorConfig` to hold a separate default provider per `ExecutorKind`. Individual phase nodes continue to override with a flat `{ provider?: string }` — the kind is already implicit in their `phaseType`. The Flow Config panel shows all four kinds always (one dropdown each), and the inheritance chip on each phase node resolves against the default for that phase's specific kind.

---

## Decisions

| Question | Decision |
|---|---|
| Shape of `FlowDefaults.executorConfig` | `Partial<Record<ExecutorKind, { provider?: string }>>` — keyed directly by `ExecutorKind` |
| Shape of `FlowNode.executorConfig` | Unchanged — flat `{ provider?: string } \| null` |
| Resolver knows phase kind via | `kindForPhaseType(node.phaseType)` — new helper in `provider-catalog.ts` |
| Panel shows | All 4 kinds always (one dropdown each), dimmed if unset |
| Schema version bump | Not needed — additive change, old flat shape is not in production |

---

## Data Model

### Updated `FlowDefaults` in `packages/core/src/types/flow.types.ts`

```ts
export interface FlowDefaults {
  /** Default retry policy. Merged field-by-field into each node's `retry`. */
  retry?: RetryPolicy;

  /**
   * Default executor provider per kind. Keyed by ExecutorKind.
   * Each phase looks up the default for its own kind via kindForPhaseType(phaseType).
   */
  executorConfig?: Partial<Record<ExecutorKind, { provider?: string }>>;

  /** Default secret bindings. Merged slot-by-slot into each node's `secretBindings`. */
  secretBindings?: Record<string, SecretBinding>;

  /** Default input wiring. Merged key-by-key into each node's `inputs`. */
  inputs?: Record<string, FlowInputValue>;
}
```

`FlowNode.executorConfig` remains `{ provider?: string } | null` — no change.

**Example flow JSON:**

```json
"defaults": {
  "executorConfig": {
    "coding-cli":      { "provider": "claude" },
    "git-provider":    { "provider": "github" },
    "ticket-provider": { "provider": "jira" }
  }
}
```

A kind with no entry means no default for that kind — phases of that kind inherit nothing and fall back to local or unset.

---

## Orchestrator Changes

### New helper: `kindForPhaseType` in `packages/core/src/registries/provider-catalog.ts`

The orchestrator's `applyFlowDefaults` has no access to the editor's `PhaseRegistry` (which holds `PhaseDefinition.executor.kind`). A static map in core bridges the gap:

```ts
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli
  "clone-repos":        "coding-cli",
  "analyze-repo":       "coding-cli",
  "plan":               "coding-cli",
  "implement":          "coding-cli",
  "create-workspace":   "coding-cli",
  "commit-push-repos":  "coding-cli",
  "cleanup-workspace":  "coding-cli",
  // git-provider
  "open-pull-request":          "git-provider",
  "list-pull-requests":         "git-provider",
  "list-pull-request-comments": "git-provider",
  // ticket-provider
  "get-ticket":           "ticket-provider",
  "create-ticket":        "ticket-provider",
  "transition-ticket":    "ticket-provider",
  "update-ticket-fields": "ticket-provider",
  "comment-on-ticket":    "ticket-provider",
  // notification
  "notify": "notification",
};

/** Returns the ExecutorKind for a given phaseType, or undefined if unknown. */
export function kindForPhaseType(phaseType: string): ExecutorKind | undefined {
  return PHASE_KIND_MAP[phaseType];
}
```

New phase types must be added to `PHASE_KIND_MAP` when they are introduced.

### Updated `applyFlowDefaults` in `packages/orchestrator/src/flow-json/apply-flow-defaults.ts`

Signature is unchanged: `applyFlowDefaults(node: FlowNode, defaults: FlowDefaults | undefined): FlowNode`.

The `executorConfig` merge changes from looking up `defaults.executorConfig` (flat) to looking up the per-kind entry:

```ts
const phaseKind = node.phaseType ? kindForPhaseType(node.phaseType) : undefined;
const kindDefault = phaseKind ? defaults.executorConfig?.[phaseKind] : undefined;
executorConfig: mergeExecutorConfig(node.executorConfig, kindDefault),
```

`mergeExecutorConfig` itself is unchanged — it still merges two `{ provider?: string }` objects.

Phases with no `phaseType`, or whose `phaseType` maps to no known kind, receive `undefined` for the executor default — same behaviour as before this change.

---

## Editor Changes

### `DefaultsExecutorSection.tsx` — 4 per-kind dropdowns

Replaces the current single "Provider" dropdown with four labelled dropdowns — one per `ExecutorKind`. Each dropdown:

- Shows only providers for that kind (from `providersForKind(kind)`)
- Has a "— no default —" option as the empty state
- Writes to `defaults.executorConfig[kind]` independently
- Shows "coming soon" for unimplemented providers (disabled)

The section header stays "Default providers" (plural). The collapsible shell and "Clear" affordance are retained per kind.

### `ExecutorBlock.tsx` — inheritance chip resolution

The editor already has `definition.executor.kind` from its `PhaseRegistry` context — no need to call `kindForPhaseType` here. The `defaultValue` passed to `useFieldInheritance` for the provider field changes from:

```ts
// Before
defaults?.executorConfig?.provider

// After
defaults?.executorConfig?.[definition.executor.kind]?.provider
```

No change to `useFieldInheritance` itself or the `InheritanceChip` component. Each phase node shows the correct "FROM FLOW" chip for its own kind's default.

---

## Schema Validation

In `packages/api-server/src/schemas/update-flow.ts`, the `executorConfig` field in `flowDefaultsSchema` changes:

```ts
// Before
executorConfig: z.object({ provider: z.string().optional() }).optional(),

// After
const executorKindSchema = z.enum(["coding-cli", "git-provider", "ticket-provider", "notification"]);

executorConfig: z.record(
  executorKindSchema,
  z.object({ provider: z.string().optional() })
).optional(),
```

No other schema changes.

---

## Files Changed

| File | Change |
|---|---|
| `packages/core/src/types/flow.types.ts` | `FlowDefaults.executorConfig` → `Partial<Record<ExecutorKind, { provider?: string }>>` |
| `packages/core/src/registries/provider-catalog.ts` | Add `PHASE_KIND_MAP` static map and `kindForPhaseType(phaseType): ExecutorKind \| undefined` |
| `packages/orchestrator/src/flow-json/apply-flow-defaults.ts` | Look up kind default via `kindForPhaseType`, pass to `mergeExecutorConfig` |
| `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx` | Replace single dropdown with 4 per-kind dropdowns |
| `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx` | Inheritance chip reads `defaults.executorConfig?.[phaseKind]?.provider` |
| `packages/api-server/src/schemas/update-flow.ts` | `executorConfig` in `flowDefaultsSchema` → `z.record(executorKindSchema, ...)` |

---

## What Is Not In Scope

- Adding a `kind` field to `FlowNode.executorConfig` — the kind is already implicit in `phaseType` and derivable via `kindForPhaseType`.
- Filtering the panel to show only kinds used by the current flow — all 4 kinds are always shown.
- Per-phase-type (narrower than kind) provider defaults.
